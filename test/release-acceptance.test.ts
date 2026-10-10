import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { createServer, type SentinelServer } from "../src/server/app.js";
import type { QueuedSessionAction, SessionActionResult, SessionView, VoiceJoinResult } from "../src/server/protocol.js";

const servers: SentinelServer[] = [];
const clients: Socket[] = [];
const files: string[] = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => client.disconnect());
  for (const server of servers.splice(0)) await server.close();
  files.splice(0).forEach((file) => unlinkSync(file));
});

async function server(persistenceFile: string | null = null) {
  const instance = await createServer({ autoTickMs: 0, persistenceFile });
  servers.push(instance);
  await instance.app.listen({ host: "127.0.0.1", port: 0 });
  return instance;
}

async function connect(server: SentinelServer, sessionId: string, accessToken: string): Promise<Socket> {
  const address = server.app.server.address();
  if (!address || typeof address === "string") throw new Error("Server address unavailable.");
  const socket = io(`http://127.0.0.1:${address.port}`, { transports: ["websocket"], reconnection: false, auth: { sessionId, accessToken } });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}

function state(socket: Socket): Promise<SessionView> {
  return new Promise((resolve, reject) => socket.timeout(3000).emit("session:request-state", (error: Error | null, view: SessionView) => error ? reject(error) : resolve(view)));
}

function action(socket: Socket, input: QueuedSessionAction): Promise<SessionActionResult> {
  return new Promise((resolve, reject) => socket.timeout(3000).emit("session:action", input, (error: Error | null, result: SessionActionResult) => error ? reject(error) : resolve(result)));
}

function voiceJoin(socket: Socket, channelId: string): Promise<VoiceJoinResult> {
  return new Promise((resolve, reject) => socket.timeout(3000).emit("voice:join", { channelId }, (error: Error | null, result: VoiceJoinResult) => error ? reject(error) : resolve(result)));
}

describe("release acceptance over real HTTP and WebSocket transports", () => {
  it("synchronizes four clients, delivers delayed text once, and reconciles an offline client", async () => {
    const host = await server();
    const created = host.manager.createSession("operation-signal-break");
    const commander = host.manager.joinSession(created.session.id, "Commander", "commander");
    const operations = host.manager.joinSession(created.session.id, "Operations", "operations");
    const communications = host.manager.joinSession(created.session.id, "Comms", "communications-ew");
    const [instructorSocket, commanderSocket, operationsSocket, commsSocket] = await Promise.all([
      connect(host, created.session.id, created.accessToken), connect(host, created.session.id, commander.accessToken),
      connect(host, created.session.id, operations.accessToken), connect(host, created.session.id, communications.accessToken)
    ]);
    host.manager.start(created.session.id, created.instructor.id);
    host.manager.advance(created.session.id, created.instructor.id, 10);
    for (const socket of [instructorSocket, commanderSocket, operationsSocket, commsSocket]) expect((await state(socket)).session.simulationTimeSeconds).toBe(10);
    expect((await state(operationsSocket)).groundTruth).toBeUndefined();
    host.manager.injectFault(created.session.id, created.instructor.id, "alpha-link", "delay", { delayMs: 45000, durationSeconds: 60 });
    const input: QueuedSessionAction = { id: randomUUID(), event: "session:send-text", payload: { channelId: "alpha-link", content: "Verify the synthetic North route." } };
    expect(await action(operationsSocket, input)).toMatchObject({ status: "accepted" });
    expect(await action(operationsSocket, input)).toMatchObject({ status: "accepted" });
    expect(await action(operationsSocket, { ...input, payload: { ...input.payload, content: "Changed retry" } })).toMatchObject({ status: "rejected", error: "ACTION_ID_CONFLICT" });
    expect((await state(commanderSocket)).events.filter((event) => event.type === "TEXT_MESSAGE_SENT")).toHaveLength(0);
    commanderSocket.disconnect();
    host.manager.advance(created.session.id, created.instructor.id, 45);
    const reconnected = await connect(host, created.session.id, commander.accessToken);
    const restored = await state(reconnected);
    expect(restored.events.filter((event) => event.type === "TEXT_MESSAGE_SENT")).toHaveLength(1);
    expect(restored.events.find((event) => event.type === "TEXT_MESSAGE_SENT")?.payload).toMatchObject({ content: input.payload.content, generatedAtSeconds: 10, receivedAtSeconds: 55 });
    expect((await state(commsSocket)).events.some((event) => event.type === "TEXT_MESSAGE_SENT")).toBe(false);
    expect(await action(commsSocket, { ...input, id: randomUUID() })).toMatchObject({ status: "rejected" });
    host.manager.advance(created.session.id, created.instructor.id, 195);
    const decision: QueuedSessionAction = { id: randomUUID(), event: "session:submit-decision", payload: { decisionId: "route-decision", optionId: "request-verification", rationale: "Reports conflict; verify with the team before movement.", confidence: 0.8 } };
    expect(await action(reconnected, decision)).toMatchObject({ status: "accepted" });
    expect(await action(reconnected, decision)).toMatchObject({ status: "accepted" });
    const finalDecisions = (await state(instructorSocket)).decisions;
    expect(finalDecisions).toHaveLength(1);
    expect(finalDecisions[0]?.perceptionSnapshot.textMessages).toEqual([expect.objectContaining({ content: input.payload.content, receivedAtSeconds: 55 })]);
    const historical = await host.app.inject({ method: "GET", url: `/api/sessions/${created.session.id}/perception?roleId=commander&atSeconds=54`, headers: { "x-access-token": created.accessToken } });
    expect(historical.statusCode).toBe(200);
    expect(historical.json().textMessages).toEqual([]);
    expect((await host.app.inject({ method: "GET", url: `/api/sessions/${created.session.id}/perception?roleId=commander&atSeconds=54`, headers: { "x-access-token": commander.accessToken } })).statusCode).toBe(403);
    expect((await host.app.inject({ method: "GET", url: `/api/sessions/${created.session.id}/perception?roleId=commander&atSeconds=NaN`, headers: { "x-access-token": created.accessToken } })).statusCode).toBe(400);
  }, 20000);

  it("restores running and completed sessions, token access, receipts, AAR, and counterfactuals after restart", async () => {
    const file = `/tmp/omnirush/sentinel-release-${randomUUID()}.json`;
    files.push(file);
    const first = await server(file);
    const room = first.manager.createSession("operation-signal-break");
    const commander = first.manager.joinSession(room.session.id, "Commander", "commander");
    first.manager.start(room.session.id, room.instructor.id);
    first.manager.advance(room.session.id, room.instructor.id, 250);
    const decision: QueuedSessionAction = { id: randomUUID(), event: "session:submit-decision", payload: { decisionId: "route-decision", optionId: "request-verification", rationale: "Verify conflicting reports through backup coordination.", confidence: 0.8 } };
    first.manager.executeQueuedAction(room.session.id, commander.participant.id, decision);
    await first.close();
    servers.splice(servers.indexOf(first), 1);

    const second = await server(file);
    const instructorSocket = await connect(second, room.session.id, room.accessToken);
    expect((await state(instructorSocket)).session).toMatchObject({ status: "paused", simulationTimeSeconds: 250 });
    second.manager.resume(room.session.id, room.instructor.id);
    expect(second.manager.executeQueuedAction(room.session.id, commander.participant.id, decision).status).toBe("accepted");
    second.manager.end(room.session.id, room.instructor.id);
    const originalAar = second.manager.getAar(room.session.id, room.accessToken);
    await second.close();
    servers.splice(servers.indexOf(second), 1);

    const third = await server(file);
    const restoredSocket = await connect(third, room.session.id, room.accessToken);
    expect((await state(restoredSocket)).session.status).toBe("ended");
    expect(third.manager.executeQueuedAction(room.session.id, commander.participant.id, decision).status).toBe("accepted");
    expect(third.manager.getAar(room.session.id, room.accessToken)).toEqual(originalAar);
    expect(third.manager.getCounterfactual(room.session.id, room.accessToken, "route-decision", "backup-route")).toMatchObject({ alternateOptionId: "backup-route", replayMode: "branch", alternateBranch: { ended: true } });
    expect(() => third.manager.restoreChannel(room.session.id, room.instructor.id, "command-net")).toThrow("read-only");
    expect(() => third.manager.sendTextMessage(room.session.id, commander.participant.id, "command-net", "Too late")).toThrow("running");
    expect(() => third.manager.getAar(room.session.id, commander.accessToken)).toThrow("instructor");
    expect(third.manager.getAar(room.session.id, room.accessToken)).toEqual(originalAar);
  }, 20000);

  it("restricts voice to opted-in same-session/channel peers and notifies leave/disconnect", async () => {
    const host = await server();
    const room = host.manager.createSession("operation-signal-break");
    const commander = host.manager.joinSession(room.session.id, "Commander", "commander");
    const operations = host.manager.joinSession(room.session.id, "Ops", "operations");
    const comms = host.manager.joinSession(room.session.id, "Comms", "communications-ew");
    const other = host.manager.createSession("operation-signal-break");
    const [left, right, separate, foreign] = await Promise.all([
      connect(host, room.session.id, commander.accessToken), connect(host, room.session.id, operations.accessToken),
      connect(host, room.session.id, comms.accessToken), connect(host, other.session.id, other.accessToken)
    ]);
    expect((await voiceJoin(left, "command-net")).peers).toEqual([]);
    expect((await voiceJoin(right, "command-net")).peers).toEqual([commander.participant.id]);
    expect((await voiceJoin(separate, "alpha-link")).error).toBeTruthy();
    await voiceJoin(separate, "bravo-link");
    await voiceJoin(foreign, "command-net");
    const unexpected: unknown[] = [];
    separate.on("voice:signal", (signal) => unexpected.push(signal));
    foreign.on("voice:signal", (signal) => unexpected.push(signal));
    const signal = { description: { type: "offer", sdp: "synthetic-test-sdp" } };
    left.emit("voice:signal", { targetParticipantId: comms.participant.id, signal });
    left.emit("voice:signal", { targetParticipantId: other.instructor.id, signal });
    const relayed = new Promise<{ fromParticipantId: string }>((resolve) => right.once("voice:signal", resolve));
    left.emit("voice:signal", { targetParticipantId: operations.participant.id, signal });
    expect((await relayed).fromParticipantId).toBe(commander.participant.id);
    expect(unexpected).toHaveLength(0);
    const leftEvent = new Promise<{ participantId: string }>((resolve) => left.once("voice:peer-left", resolve));
    right.disconnect();
    expect((await leftEvent).participantId).toBe(operations.participant.id);
    const closed = new Promise<void>((resolve) => left.once("voice:closed", resolve));
    host.manager.start(room.session.id, room.instructor.id);
    host.manager.end(room.session.id, room.instructor.id);
    await closed;
  }, 20000);

  it("keeps participant presence correct when replacing a socket", async () => {
    const host = await server();
    const room = host.manager.createSession("operation-signal-break");
    const oldSocket = await connect(host, room.session.id, room.accessToken);
    const replacement = await connect(host, room.session.id, room.accessToken);
    expect((await state(replacement)).participant.connected).toBe(true);
    expect(host.manager.getSessionSummary(room.session.id).participants[0]?.connected).toBe(true);
    await new Promise<void>((resolve) => { if (!oldSocket.connected) resolve(); else oldSocket.once("disconnect", () => resolve()); });
    expect((await state(replacement)).participant.connected).toBe(true);
  }, 20000);
});
