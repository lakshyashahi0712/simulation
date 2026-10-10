import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { io as connect, type Socket } from "socket.io-client";
import { createServer, type SentinelServer } from "../src/server/app.js";

interface StatePayload {
  session: {
    status: string;
    simulationTimeSeconds: number;
  };
  participant: {
    id: string;
    roleId?: string;
  };
  perception?: {
    reports: Array<{ reportId: string }>;
    activeDecisionIds: string[];
  };
  events: Array<{ type: string }>;
  groundTruth?: unknown;
  decisions: Array<{ decisionId: string }>;
}

describe("SENTINEL Phase 2 server", () => {
  let server: SentinelServer;
  let baseUrl: string;
  const clients: Socket[] = [];

  beforeEach(async () => {
    server = await createServer({ autoTickMs: 0, persistenceFile: null, adminToken: "test-admin" });
    await server.app.listen({ host: "127.0.0.1", port: 0 });
    const address = server.app.server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP address.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.disconnect();
    await server.close();
  });

  it("serves health, scenarios, creates sessions, and joins roles", async () => {
    const health = await server.app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", service: "sentinel-server" });

    const scenarios = await server.app.inject({ method: "GET", url: "/api/scenarios" });
    expect(scenarios.statusCode).toBe(200);
    expect(scenarios.json().scenarios).toContainEqual(expect.objectContaining({ id: "operation-signal-break" }));

    const created = await server.app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { instructorName: "Range Instructor" }
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json() as { session: { id: string; roomCode: string }; instructor: { id: string } };

    const joined = await server.app.inject({
      method: "POST",
      url: `/api/sessions/${createdBody.session.id}/join`,
      payload: { displayName: "Commander One", roleId: "commander" }
    });
    expect(joined.statusCode).toBe(201);
    expect(joined.json().participant).toMatchObject({ displayName: "Commander One", roleId: "commander", kind: "trainee" });

    const joinedByCode = await server.app.inject({
      method: "POST",
      url: "/api/sessions/join",
      payload: { roomCode: createdBody.session.roomCode, displayName: "Operations One", roleId: "operations" }
    });
    expect(joinedByCode.statusCode).toBe(201);
    expect(joinedByCode.json().participant).toMatchObject({ displayName: "Operations One", roleId: "operations" });

    const summary = await server.app.inject({ method: "GET", url: `/api/sessions/${createdBody.session.id}` });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().session).toBeUndefined();
    expect(summary.json()).toMatchObject({ id: createdBody.session.id, roomCode: createdBody.session.roomCode });
  });

  it("keeps instructor ground truth separate from a trainee state over Socket.IO", async () => {
    const created = await createSession("Instructor");
    const commander = await join(created.sessionId, "Commander One", "commander");
    const instructorSocket = await connectParticipant(created.sessionId, created.instructorToken);
    const commanderSocket = await connectParticipant(created.sessionId, commander.accessToken);

    const running = waitForState(commanderSocket, (state) => state.session.status === "running");
    instructorSocket.emit("session:start");
    await running;

    const advanced = waitForState(commanderSocket, (state) => state.session.simulationTimeSeconds >= 250);
    instructorSocket.emit("session:advance", { seconds: 250 });
    const commanderState = await advanced;
    expect(commanderState.groundTruth).toBeUndefined();
    expect(commanderState.perception?.reports.map((report) => report.reportId)).toContain("contradictory-aerial-report");
    expect(commanderState.perception?.activeDecisionIds).toContain("route-decision");
    expect(commanderState.events.every((event) => event.type !== "REPORT_GENERATED")).toBe(true);

    const instructorStatePromise = waitForState(instructorSocket, (state) => state.session.simulationTimeSeconds >= 250);
    instructorSocket.emit("session:request-state");
    const instructorState = await instructorStatePromise;
    expect(instructorState.groundTruth).toBeDefined();
    expect(instructorState.events.some((event) => event.type === "REPORT_GENERATED")).toBe(true);

    const submitted = waitForState(commanderSocket, (state) => state.decisions.some((decision) => decision.decisionId === "route-decision"));
    commanderSocket.emit("session:submit-decision", {
      decisionId: "route-decision",
      optionId: "request-verification",
      rationale: "The current reports conflict, so verification is required before movement.",
      confidence: 0.8
    });
    const finalState = await submitted;
    expect(finalState.perception?.activeDecisionIds).not.toContain("route-decision");
    expect(finalState.decisions).toContainEqual(expect.objectContaining({ decisionId: "route-decision" }));

    const textDelivered = waitForState(commanderSocket, (state) => state.events.some((event) => event.type === "TEXT_MESSAGE_SENT"));
    commanderSocket.emit("session:send-text", { channelId: "command-net", content: "Commander intent is verification before movement." });
    await textDelivered;

    const ended = waitForState(instructorSocket, (state) => state.session.status === "ended");
    instructorSocket.emit("session:end");
    await ended;

    const aar = await server.app.inject({
      method: "GET",
      url: `/api/sessions/${created.sessionId}/aar`,
      headers: { "x-access-token": created.instructorToken }
    });
    expect(aar.statusCode).toBe(200);
    expect(aar.json()).toMatchObject({ sessionId: created.sessionId, decisions: [expect.objectContaining({ decisionId: "route-decision" })] });
    expect(aar.json().score.total).toBeGreaterThan(0);

    const replay = await server.app.inject({
      method: "GET",
      url: `/api/sessions/${created.sessionId}/replay?atSeconds=250`,
      headers: { "x-access-token": created.instructorToken }
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().events.every((event: { simulationTimeSeconds: number }) => event.simulationTimeSeconds <= 250)).toBe(true);

    const counterfactual = await server.app.inject({
      method: "POST",
      url: `/api/sessions/${created.sessionId}/counterfactual`,
      headers: { "x-access-token": created.instructorToken },
      payload: { decisionId: "route-decision", alternateOptionId: "north-route" }
    });
    expect(counterfactual.statusCode).toBe(200);
    expect(counterfactual.json()).toMatchObject({ actualOptionId: "request-verification", alternateOptionId: "north-route" });
  });

  it("rejects a trainee attempt to control the exercise", async () => {
    const created = await createSession("Instructor");
    const commander = await join(created.sessionId, "Commander One", "commander");
    const response = await server.app.inject({
      method: "POST",
      url: `/api/sessions/${created.sessionId}/start`,
      payload: { accessToken: commander.accessToken }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "FORBIDDEN" });
  });

  it("creates, edits, validates, publishes, and launches a Forge scenario", async () => {
    const created = await server.app.inject({
      method: "POST",
      url: "/api/forge/scenarios",
      headers: { "x-admin-token": "test-admin" },
      payload: { baseScenarioId: "operation-signal-break" }
    });
    expect(created.statusCode).toBe(201);
    const draft = created.json() as { id: string; status: string; metadata: { title: string } };
    expect(draft.status).toBe("draft");

    const fullDraftResponse = await server.app.inject({ method: "GET", url: `/api/forge/scenarios/${draft.id}`, headers: { "x-admin-token": "test-admin" } });
    const fullDraft = fullDraftResponse.json() as Record<string, unknown> & { metadata: { title: string } };
    fullDraft.metadata.title = "Custom Signal Break";
    const updated = await server.app.inject({
      method: "PUT",
      url: `/api/forge/scenarios/${draft.id}`,
      headers: { "x-admin-token": "test-admin" },
      payload: fullDraft
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().metadata.title).toBe("Custom Signal Break");

    const validation = await server.app.inject({ method: "POST", url: `/api/forge/scenarios/${draft.id}/validate`, headers: { "x-admin-token": "test-admin" } });
    expect(validation.statusCode).toBe(200);
    expect(validation.json()).toMatchObject({ valid: true, errors: [] });

    const published = await server.app.inject({ method: "POST", url: `/api/forge/scenarios/${draft.id}/publish`, headers: { "x-admin-token": "test-admin" } });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({ id: draft.id, status: "published", metadata: { title: "Custom Signal Break" } });

    const imported = await server.app.inject({
      method: "POST",
      url: "/api/forge/scenarios/import",
      headers: { "x-admin-token": "test-admin" },
      payload: { ...fullDraft, id: `${draft.id}-imported`, status: "published" }
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({ id: `${draft.id}-imported`, status: "draft" });

    const session = await server.app.inject({ method: "POST", url: "/api/sessions", payload: { scenarioId: draft.id } });
    expect(session.statusCode).toBe(201);
  });

  it("does not expose participant credentials or full scenario intelligence publicly", async () => {
    const created = await server.app.inject({ method: "POST", url: "/api/sessions", payload: { instructorName: "Protected Instructor" } });
    const createdBody = created.json() as { session: { id: string }; accessToken: string; instructor: { id: string } };

    const lobby = await server.app.inject({ method: "GET", url: `/api/sessions/${createdBody.session.id}` });
    expect(lobby.statusCode).toBe(200);
    expect(lobby.json().participants).toBeUndefined();
    expect(JSON.stringify(lobby.json())).not.toContain(createdBody.instructor.id);
    expect(JSON.stringify(lobby.json())).not.toContain(createdBody.accessToken);

    const publicScenario = await server.app.inject({ method: "GET", url: "/api/scenarios/operation-signal-break" });
    expect(publicScenario.statusCode).toBe(200);
    expect(publicScenario.json().reports).toBeUndefined();
    expect(publicScenario.json().events).toBeUndefined();

    const forgeWithoutAdmin = await server.app.inject({ method: "GET", url: "/api/forge/scenarios" });
    expect(forgeWithoutAdmin.statusCode).toBe(403);
  });

  it("persists published scenarios and active sessions across server instances", async () => {
    const persistenceFile = `/tmp/omnirush/sentinel-${randomUUID()}.json`;
    const first = await createServer({ autoTickMs: 0, persistenceFile, adminToken: "test-admin" });
    await first.app.listen({ host: "127.0.0.1", port: 0 });
    let draftBody: { id: string };
    let createdBody: { session: { id: string }; accessToken: string };
    try {
      const draft = await first.app.inject({ method: "POST", url: "/api/forge/scenarios", headers: { "x-admin-token": "test-admin" }, payload: {} });
      draftBody = draft.json() as { id: string };
      await first.app.inject({ method: "POST", url: `/api/forge/scenarios/${draftBody.id}/publish`, headers: { "x-admin-token": "test-admin" } });
      const created = await first.app.inject({ method: "POST", url: "/api/sessions", payload: { scenarioId: draftBody.id } });
      createdBody = created.json() as { session: { id: string }; accessToken: string };
    } finally {
      await first.close();
    }

    const second = await createServer({ autoTickMs: 0, persistenceFile, adminToken: "test-admin" });
    try {
      await second.app.listen({ host: "127.0.0.1", port: 0 });
      const scenarios = await second.app.inject({ method: "GET", url: "/api/scenarios" });
      expect(scenarios.json().scenarios).toContainEqual(expect.objectContaining({ id: draftBody.id, status: "published" }));
      const archivedSession = await second.app.inject({ method: "GET", url: `/api/sessions/${createdBody.session.id}` });
      expect(archivedSession.statusCode).toBe(200);
      expect(archivedSession.json()).toMatchObject({ id: createdBody.session.id, status: "waiting", participantCount: 1 });
      const restartedStart = await second.app.inject({
        method: "POST",
        url: `/api/sessions/${createdBody.session.id}/start`,
        payload: { accessToken: createdBody.accessToken }
      });
      expect(restartedStart.statusCode).toBe(200);
      expect(restartedStart.json().status).toBe("running");
    } finally {
      await second.close();
      unlinkSync(persistenceFile);
    }
  });

  async function createSession(instructorName: string): Promise<{ sessionId: string; instructorToken: string }> {
    const response = await server.app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { instructorName }
    });
    const body = response.json() as { session: { id: string }; accessToken: string };
    return { sessionId: body.session.id, instructorToken: body.accessToken };
  }

  async function join(sessionId: string, displayName: string, roleId: string): Promise<{ participantId: string; accessToken: string }> {
    const response = await server.app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/join`,
      payload: { displayName, roleId }
    });
    const body = response.json() as { participant: { id: string }; accessToken: string };
    return { participantId: body.participant.id, accessToken: body.accessToken };
  }

  async function connectParticipant(sessionId: string, accessToken: string): Promise<Socket> {
    const socket = connect(baseUrl, {
      transports: ["websocket"],
      auth: { sessionId, accessToken }
    });
    clients.push(socket);
    await waitForConnect(socket);
    return socket;
  }
});

function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Socket connection timed out.")), 5000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForState(socket: Socket, predicate: (state: StatePayload) => boolean): Promise<StatePayload> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("session:state", onState);
      reject(new Error("Timed out waiting for session state."));
    }, 5000);
    const onState = (state: StatePayload) => {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      socket.off("session:state", onState);
      resolve(state);
    };
    socket.on("session:state", onState);
  });
}
