import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { io, type Socket } from "socket.io-client";
import { createServer } from "../src/server/app.js";
import type { CounterfactualComparison, PerceptionSnapshot } from "../src/domain/runtime.js";
import type { QueuedSessionAction, SessionActionResult, SessionAar, SessionView } from "../src/server/protocol.js";

const args = process.argv.slice(2);
if (args.length && (args[0] !== "--output" || !args[1] || args.length !== 2)) throw new Error("Usage: npm run test:synthetic -- [--output path/to/report.json]");
const output = resolve(args[1] ?? "data/synthetic-acceptance.json");
const server = await createServer({ autoTickMs: 0, persistenceFile: null });
const clients: Socket[] = [];
const checks: string[] = [];
const passed = (description: string) => { checks.push(description); console.log(`PASS ${description}`); };

try {
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const address = server.app.server.address();
  if (!address || typeof address === "string") throw new Error("No server address.");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  async function request<T>(path: string, method = "GET", body?: unknown, token?: string): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method, headers: { "content-type": "application/json", ...(token ? { "x-access-token": token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000)
    });
    const result = await response.json() as T & { message?: string };
    if (!response.ok) throw new Error(result.message ?? `HTTP ${response.status}`);
    return result;
  }
  async function connect(sessionId: string, accessToken: string) {
    const socket = io(baseUrl, { transports: ["websocket"], reconnection: false, auth: { sessionId, accessToken } });
    clients.push(socket);
    await new Promise<void>((resolveConnection, reject) => {
      const timeout = setTimeout(() => reject(new Error("Connection timed out.")), 5000);
      socket.once("connect", () => { clearTimeout(timeout); resolveConnection(); });
      socket.once("connect_error", (error) => { clearTimeout(timeout); reject(error); });
    });
    return socket;
  }
  const state = (socket: Socket) => new Promise<SessionView>((done, reject) => socket.timeout(5000).emit("session:request-state", (error: Error | null, view: SessionView) => error ? reject(error) : done(view)));
  const send = (socket: Socket, action: QueuedSessionAction) => new Promise<SessionActionResult>((done, reject) => socket.timeout(5000).emit("session:action", action, (error: Error | null, result: SessionActionResult) => error ? reject(error) : done(result)));
  const created = await request<{ session: { id: string; roomCode: string }; accessToken: string }>("/api/sessions", "POST", { instructorName: "Synthetic Instructor" });
  const sessionPath = `/api/sessions/${created.session.id}`;
  const joined = await Promise.all(["commander", "operations", "communications-ew"].map((roleId) => request<{ accessToken: string; participant: { id: string } }>("/api/sessions/join", "POST", { roomCode: created.session.roomCode, displayName: `Synthetic ${roleId}`, roleId })));
  const commander = joined[0]!; const operations = joined[1]!; const comms = joined[2]!;
  const [instructorSocket, commanderSocket, operationsSocket, commsSocket] = await Promise.all([created, commander, operations, comms].map((participant) => connect(created.session.id, participant.accessToken)));
  assert(instructorSocket && commanderSocket && operationsSocket && commsSocket);
  passed("Instructor plus three role clients joined over HTTP/WebSocket");

  await request(`${sessionPath}/start`, "POST", { accessToken: created.accessToken });
  await request(`${sessionPath}/advance`, "POST", { accessToken: created.accessToken, seconds: 10 });
  const views = await Promise.all([instructorSocket, commanderSocket, operationsSocket, commsSocket].map(state));
  assert(views.every((view) => view.session.simulationTimeSeconds === 10));
  assert(views.slice(1).every((view) => !view.groundTruth));
  passed("Synchronized simulation clock and role-scoped views");

  await request(`${sessionPath}/inject-fault`, "POST", { accessToken: created.accessToken, channelId: "alpha-link", fault: "delay", delayMs: 45000, durationSeconds: 60 });
  const textAction: QueuedSessionAction = { id: randomUUID(), event: "session:send-text", payload: { channelId: "alpha-link", content: "Synthetic verification pending." } };
  assert.equal((await send(operationsSocket, textAction)).status, "accepted");
  assert.equal((await send(operationsSocket, textAction)).status, "accepted");
  assert.equal((await state(commanderSocket)).perception?.textMessages?.length, 0);
  commanderSocket.disconnect();
  await request(`${sessionPath}/advance`, "POST", { accessToken: created.accessToken, seconds: 45 });
  const reconnected = await connect(created.session.id, commander.accessToken);
  const restored = await state(reconnected);
  assert.equal(restored.perception?.textMessages?.length, 1);
  assert.equal(restored.perception?.textMessages?.[0]?.receivedAtSeconds, 55);
  assert.equal((await state(commsSocket)).perception?.textMessages?.length, 0);
  passed("45-second text delay, private-channel isolation, reconnect, duplicate retry");

  await request(`${sessionPath}/advance`, "POST", { accessToken: created.accessToken, seconds: 195 });
  const decisionAction: QueuedSessionAction = { id: randomUUID(), event: "session:submit-decision", payload: { decisionId: "route-decision", optionId: "request-verification", rationale: "Reports conflict; verify with the team before movement.", confidence: 0.8 } };
  assert.equal((await send(reconnected, decisionAction)).status, "accepted");
  assert.equal((await send(reconnected, decisionAction)).status, "accepted");
  await request(`${sessionPath}/advance`, "POST", { accessToken: created.accessToken, seconds: 50 });
  instructorSocket.emit("session:end");
  assert.equal((await state(instructorSocket)).session.status, "ended");
  const aar = await request<SessionAar>(`${sessionPath}/aar`, "GET", undefined, created.accessToken);
  assert.equal(aar.decisions.length, 1);
  assert.equal(aar.decisions[0]?.perceptionSnapshot.textMessages?.length, 1);
  passed("One decision with report/text evidence; instructor ended the exercise");

  const beforeDelivery = await request<PerceptionSnapshot>(`${sessionPath}/perception?roleId=commander&atSeconds=54`, "GET", undefined, created.accessToken);
  const afterDelivery = await request<PerceptionSnapshot>(`${sessionPath}/perception?roleId=commander&atSeconds=55`, "GET", undefined, created.accessToken);
  assert.equal(beforeDelivery.textMessages?.length, 0); assert.equal(afterDelivery.textMessages?.length, 1);
  const comparison = await request<CounterfactualComparison>(`${sessionPath}/counterfactual`, "POST", { decisionId: "route-decision", alternateOptionId: "north-route" }, created.accessToken);
  assert.equal(comparison.replayMode, "branch");
  assert(comparison.actualBranch?.perceptions.find((role) => role.roleId === "commander")?.reports.some((report) => report.reportId === "late-verification-report"));
  assert(!comparison.alternateBranch?.perceptions.find((role) => role.roleId === "commander")?.reports.some((report) => report.reportId === "late-verification-report"));
  assert.deepEqual(await request<SessionAar>(`${sessionPath}/aar`, "GET", undefined, created.accessToken), aar);
  passed("Historical perception and isolated alternate branch with different future reports");
  const unauthorized = await fetch(`${baseUrl}${sessionPath}/perception?roleId=commander&atSeconds=55`, { headers: { "x-access-token": commander.accessToken } });
  assert.equal(unauthorized.status, 403);
  passed("Trainee cannot retrieve instructor-only historical perception");

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ status: "passed", scope: "synthetic-four-client", recordedAt: new Date().toISOString(), checks, aar, comparison }, null, 2), "utf8");
  console.log(`Synthetic acceptance passed. Report: ${output}`);
} finally {
  clients.forEach((socket) => socket.disconnect());
  await server.close();
}
