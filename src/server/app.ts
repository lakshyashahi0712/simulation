import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { resolve } from "node:path";
import { registerStaticWeb } from "./static-web.js";
import type { CommunicationFault, ScenarioDefinition } from "../domain/scenario.js";
import { JsonPersistence } from "./persistence.js";
import { generateScenarioDraft } from "./gemini.js";
import { VoiceRooms } from "./voice-rooms.js";
import { ScenarioValidationError, SessionError, SessionManager } from "./session-manager.js";
import type {
  AdvanceBody,
  ControlBody,
  CreateSessionBody,
  InjectFaultBody,
  JoinByCodeBody,
  JoinSessionBody,
  SubmitDecisionBody,
  QueuedSessionAction,
  SessionActionResult
} from "./protocol.js";


const supportedFaults: CommunicationFault[] = ["delay", "dropout", "conflict", "stale", "partial", "outage"];

export interface SentinelServer {
  app: FastifyInstance;
  io: SocketIOServer;
  manager: SessionManager;
  close(): Promise<void>;
}

interface SocketContext {
  sessionId: string;
  participantId: string;
}

export interface CreateServerOptions {
  autoTickMs?: number;
  persistenceFile?: string | null;
  adminToken?: string;
  staticWebDirectory?: string;
  tls?: { cert: Buffer; key: Buffer };
}

export async function createServer(options: CreateServerOptions = {}): Promise<SentinelServer> {
  const app: FastifyInstance = options.tls
    ? Fastify({ logger: false, https: options.tls }) as FastifyInstance
    : Fastify({ logger: false });
  await app.register(cors, { origin: true });

  const persistenceFile = options.persistenceFile === undefined
    ? process.env.SENTINEL_DATA_FILE ?? resolve(process.cwd(), "data/sentinel.json")
    : options.persistenceFile;
  const manager = new SessionManager({ autoTickMs: options.autoTickMs ?? 1000, persistence: new JsonPersistence(persistenceFile) });
  const adminToken = options.adminToken ?? process.env.SENTINEL_ADMIN_TOKEN ?? "local-sentinel-admin";
  const io = new SocketIOServer(app.server, {
    cors: { origin: true }
  });
  const participantSockets = new Map<string, Socket>();
  const voiceRooms = new VoiceRooms(manager);

  const emitView = (socket: Socket, sessionId: string, participantId: string): void => {
    try {
      socket.emit("session:state", manager.getView(sessionId, participantId));
    } catch (error) {
      socket.emit("session:error", serializeError(error));
    }
  };

  const broadcastSession = (sessionId: string): void => {
    const summary = manager.getSessionSummary(sessionId);
    if (summary.status === "ended") voiceRooms.closeSession(sessionId);
    else voiceRooms.reconcileSession(sessionId);
    for (const participant of summary.participants) {
      const socket = participantSockets.get(participant.id);
      if (socket) emitView(socket, sessionId, participant.id);
    }
  };

  manager.setChangeListener(broadcastSession);

  app.get("/health", async () => ({
    status: "ok",
    service: "sentinel-server",
    timestamp: new Date().toISOString()
  }));

  app.get("/api/scenarios", async () => ({ scenarios: manager.listScenarios() }));

  app.get("/api/scenarios/:scenarioId", async (request) => {
    const { scenarioId } = request.params as { scenarioId: string };
    return manager.getPublishedScenarioSummary(scenarioId);
  });

  app.get("/api/forge/scenarios", async (request) => {
    requireAdmin(request, adminToken);
    return { scenarios: manager.listForgeScenarios() };
  });

  app.get("/api/forge/scenarios/:scenarioId", async (request) => {
    requireAdmin(request, adminToken);
    const { scenarioId } = request.params as { scenarioId: string };
    return manager.getScenario(scenarioId);
  });

  app.post("/api/forge/scenarios", async (request, reply) => {
    requireAdmin(request, adminToken);
    const body = readBody<{ baseScenarioId?: string }>(request);
    const scenario = manager.createDraft(body.baseScenarioId ?? "operation-signal-break");
    reply.code(201);
    return scenario;
  });

  app.post("/api/forge/scenarios/import", async (request, reply) => {
    requireAdmin(request, adminToken);
    const scenario = manager.importScenario(readBody<ScenarioDefinition>(request));
    reply.code(201);
    return scenario;
  });

  app.post("/api/forge/scenarios/generate", async (request, reply) => {
    requireAdmin(request, adminToken);
    const body = readBody<{ prompt?: string; baseScenarioId?: string }>(request);
    const prompt = requiredString(body.prompt, "prompt");
    const base = manager.getScenario(body.baseScenarioId ?? "operation-signal-break");
    const generated = await generateScenarioDraft(base, prompt);
    const scenario = manager.importScenario(generated.scenario);
    reply.code(201);
    return { scenario, source: generated.source, ...(generated.warning ? { warning: generated.warning } : {}) };
  });

  app.post("/api/forge/scenarios/:scenarioId/duplicate", async (request, reply) => {
    requireAdmin(request, adminToken);
    const { scenarioId } = request.params as { scenarioId: string };
    const scenario = manager.duplicateScenario(scenarioId);
    reply.code(201);
    return scenario;
  });

  app.get("/api/forge/scenarios/:scenarioId/history", async (request) => {
    requireAdmin(request, adminToken);
    const { scenarioId } = request.params as { scenarioId: string };
    return { versions: manager.getScenarioHistory(scenarioId) };
  });

  app.post("/api/forge/scenarios/:scenarioId/versions", async (request, reply) => {
    requireAdmin(request, adminToken);
    const { scenarioId } = request.params as { scenarioId: string };
    reply.code(201);
    return manager.createScenarioVersion(scenarioId);
  });

  app.put("/api/forge/scenarios/:scenarioId/archive", async (request) => {
    requireAdmin(request, adminToken);
    const { scenarioId } = request.params as { scenarioId: string };
    return manager.setScenarioArchived(scenarioId, readBody<{ archived: boolean }>(request).archived);
  });

  app.put("/api/forge/scenarios/:scenarioId", async (request) => {
    requireAdmin(request, adminToken);
    const { scenarioId } = request.params as { scenarioId: string };
    return manager.updateScenario(scenarioId, readBody<ScenarioDefinition>(request));
  });

  app.post("/api/forge/scenarios/:scenarioId/validate", async (request) => {
    requireAdmin(request, adminToken);
    const { scenarioId } = request.params as { scenarioId: string };
    return manager.validateScenarioDraft(scenarioId);
  });

  app.post("/api/forge/scenarios/:scenarioId/publish", async (request) => {
    requireAdmin(request, adminToken);
    const { scenarioId } = request.params as { scenarioId: string };
    return manager.publishScenario(scenarioId);
  });

  app.post("/api/sessions", async (request, reply) => {
    const body = readBody<CreateSessionBody>(request);
    const result = manager.createSession(body.scenarioId ?? "operation-signal-break", body.instructorName ?? "Instructor");
    reply.code(201);
    return result;
  });

  app.get("/api/sessions/:sessionId", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return manager.getSessionLobby(sessionId);
  });

  app.get("/api/sessions/:sessionId/aar", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const accessToken = requiredString(request.headers["x-access-token"], "x-access-token");
    return manager.getAar(sessionId, accessToken);
  });

  app.get("/api/sessions/:sessionId/replay", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const query = request.query as { atSeconds?: string };
    const accessToken = requiredString(request.headers["x-access-token"], "x-access-token");
    const atSeconds = query.atSeconds === undefined ? undefined : Number(query.atSeconds);
    return manager.getReplay(sessionId, accessToken, atSeconds);
  });

  app.post("/api/sessions/:sessionId/counterfactual", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = readBody<{ decisionId?: string; alternateOptionId?: string; rationale?: string }>(request);
    const accessToken = requiredString(request.headers["x-access-token"], "x-access-token");
    return manager.getCounterfactual(sessionId, accessToken, requiredString(body.decisionId, "decisionId"), requiredString(body.alternateOptionId, "alternateOptionId"), body.rationale);
  });

  app.get("/api/sessions/:sessionId/perception", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const query = request.query as { roleId?: string; atSeconds?: string };
    const accessToken = requiredString(request.headers["x-access-token"], "x-access-token");
    const roleId = requiredString(query.roleId, "roleId");
    const atSeconds = Number(query.atSeconds ?? 0);
    if (!Number.isFinite(atSeconds) || atSeconds < 0) throw new SessionError("INVALID_INPUT", "atSeconds must be a non-negative finite number.");
    return manager.getHistoricalPerception(sessionId, accessToken, roleId, atSeconds);
  });

  app.post("/api/sessions/:sessionId/join", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = readBody<JoinSessionBody>(request);
    const joined = manager.joinSession(sessionId, body.displayName ?? "Trainee", body.roleId);
    reply.code(201);
    return { ...joined, session: manager.getSessionSummary(sessionId) };
  });

  app.post("/api/sessions/join", async (request, reply) => {
    const body = readBody<JoinByCodeBody>(request);
    const result = manager.joinByRoomCode(requiredString(body.roomCode, "roomCode"), body.displayName ?? "Trainee", body.roleId);
    reply.code(201);
    return result;
  });

  app.post("/api/sessions/:sessionId/start", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = readBody<ControlBody>(request);
    manager.start(sessionId, manager.authenticateParticipant(sessionId, requiredString(body.accessToken, "accessToken")));
    return manager.getSessionSummary(sessionId);
  });

  app.post("/api/sessions/:sessionId/pause", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = readBody<ControlBody>(request);
    manager.pause(sessionId, manager.authenticateParticipant(sessionId, requiredString(body.accessToken, "accessToken")));
    return manager.getSessionSummary(sessionId);
  });

  app.post("/api/sessions/:sessionId/resume", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = readBody<ControlBody>(request);
    manager.resume(sessionId, manager.authenticateParticipant(sessionId, requiredString(body.accessToken, "accessToken")));
    return manager.getSessionSummary(sessionId);
  });

  app.post("/api/sessions/:sessionId/advance", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = readBody<AdvanceBody>(request);
    const seconds = body.seconds ?? 1;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 300) throw new SessionError("INVALID_ADVANCE", "Advance seconds must be between 0 and 300.");
    const time = manager.advance(sessionId, manager.authenticateParticipant(sessionId, requiredString(body.accessToken, "accessToken")), seconds);
    return { simulationTimeSeconds: time, session: manager.getSessionSummary(sessionId) };
  });

  app.post("/api/sessions/:sessionId/inject-fault", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = readBody<InjectFaultBody>(request);
    const fault = requiredString(body.fault, "fault") as CommunicationFault;
    if (!supportedFaults.includes(fault)) throw new SessionError("INVALID_FAULT", `Unsupported fault ${fault}.`);
    manager.injectFault(
      sessionId,
      manager.authenticateParticipant(sessionId, requiredString(body.accessToken, "accessToken")),
      requiredString(body.channelId, "channelId"),
      fault,
      {
        ...(body.delayMs === undefined ? {} : { delayMs: body.delayMs }),
        ...(body.durationSeconds === undefined ? {} : { durationSeconds: body.durationSeconds })
      }
    );
    return manager.getSessionSummary(sessionId);
  });

  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error instanceof ScenarioValidationError ? 400 : error instanceof SessionError
      ? error.code === "SESSION_NOT_FOUND" || error.code === "SCENARIO_NOT_FOUND" || error.code === "SCENARIO_ARCHIVED" ? 404 : error.code === "FORBIDDEN" ? 403 : error.code === "UNAUTHORIZED" ? 401 : 400
      : 500;
    reply.code(statusCode).send({
      error: error instanceof ScenarioValidationError ? "SCENARIO_INVALID" : error instanceof SessionError ? error.code : "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Unexpected server error.",
      ...(error instanceof ScenarioValidationError ? { validation: error.result } : {})
    });
  });

  io.use((socket, next) => {
    try {
      const auth = socket.handshake.auth as Partial<SocketContext> & { accessToken?: string };
      const sessionId = requiredString(auth.sessionId, "sessionId");
      const accessToken = requiredString(auth.accessToken, "accessToken");
      const participantId = manager.authenticateParticipant(sessionId, accessToken);
      manager.connectParticipant(sessionId, accessToken);
      socket.data.context = { sessionId, participantId } satisfies SocketContext;
      next();
    } catch (error) {
      next(new Error(error instanceof Error ? error.message : "Unable to join the session."));
    }
  });

  io.on("connection", (socket) => {
    const context = socket.data.context as SocketContext;
    const previousSocket = participantSockets.get(context.participantId);
    participantSockets.set(context.participantId, socket);
    previousSocket?.disconnect(true);
    void socket.join(context.sessionId);
    emitView(socket, context.sessionId, context.participantId);
    broadcastSession(context.sessionId);
    voiceRooms.attach(socket, context.sessionId, context.participantId);

    socket.on("session:request-state", (acknowledge?: (view: ReturnType<SessionManager["getView"]>) => void) => {
      if (typeof acknowledge === "function") acknowledge(manager.getView(context.sessionId, context.participantId));
      else emitView(socket, context.sessionId, context.participantId);
    });
    socket.on("session:action", (input: QueuedSessionAction, acknowledge?: (result: SessionActionResult) => void) => {
      if (typeof acknowledge !== "function") return;
      try {
        acknowledge(manager.executeQueuedAction(context.sessionId, context.participantId, input));
      } catch (error) {
        acknowledge({ id: input?.id ?? "", status: "rejected", ...serializeError(error) });
      }
    });
    socket.on("session:assign-role", (payload: { participantId?: string; roleId?: string }) => {
      handleSocketAction(socket, context, () => {
        manager.assignRole(context.sessionId, context.participantId, requiredString(payload.participantId, "participantId"), requiredString(payload.roleId, "roleId"));
      }, broadcastSession);
    });
    socket.on("session:start", () => {
      handleSocketAction(socket, context, () => manager.start(context.sessionId, context.participantId), broadcastSession);
    });
    socket.on("session:pause", () => {
      handleSocketAction(socket, context, () => manager.pause(context.sessionId, context.participantId), broadcastSession);
    });
    socket.on("session:resume", () => {
      handleSocketAction(socket, context, () => manager.resume(context.sessionId, context.participantId), broadcastSession);
    });
    socket.on("session:advance", (payload: { seconds?: number }) => {
      handleSocketAction(socket, context, () => {
        const seconds = payload?.seconds ?? 1;
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 300) throw new SessionError("INVALID_ADVANCE", "Advance seconds must be between 0 and 300.");
        manager.advance(context.sessionId, context.participantId, seconds);
      }, broadcastSession);
    });
    socket.on("session:inject-fault", (payload: InjectFaultBody) => {
      handleSocketAction(socket, context, () => {
        const fault = requiredString(payload?.fault, "fault") as CommunicationFault;
        if (!supportedFaults.includes(fault)) throw new SessionError("INVALID_FAULT", `Unsupported fault ${fault}.`);
        manager.injectFault(
          context.sessionId,
          context.participantId,
          requiredString(payload?.channelId, "channelId"),
          fault,
          {
            ...(payload?.delayMs === undefined ? {} : { delayMs: payload.delayMs }),
            ...(payload?.durationSeconds === undefined ? {} : { durationSeconds: payload.durationSeconds })
          }
        );
      }, broadcastSession);
    });
    socket.on("session:restore-channel", (payload: { channelId?: string }) => {
      handleSocketAction(socket, context, () => manager.restoreChannel(context.sessionId, context.participantId, requiredString(payload?.channelId, "channelId")), broadcastSession);
    });
    socket.on("session:zone-entered", (payload: { objectId?: string }) => {
      handleSocketAction(socket, context, () => manager.triggerZoneEntered(context.sessionId, context.participantId, requiredString(payload?.objectId, "objectId")), broadcastSession);
    });
    socket.on("session:object-collision", (payload: { objectId?: string; otherObjectId?: string }) => {
      handleSocketAction(socket, context, () => manager.triggerObjectCollision(context.sessionId, context.participantId, requiredString(payload?.objectId, "objectId"), requiredString(payload?.otherObjectId, "otherObjectId")), broadcastSession);
    });
    socket.on("session:move-object", (payload: { objectId?: string; position?: { x?: number; y?: number; z?: number }; velocity?: { x?: number; y?: number; z?: number } }) => {
      handleSocketAction(socket, context, () => {
        const position = payload?.position;
        if (!position || ![position.x, position.y, position.z].every((value) => typeof value === "number" && Number.isFinite(value))) throw new SessionError("INVALID_INPUT", "A finite object position is required.");
        const velocity = payload.velocity && [payload.velocity.x, payload.velocity.y, payload.velocity.z].every((value) => typeof value === "number" && Number.isFinite(value))
          ? { x: payload.velocity.x as number, y: payload.velocity.y as number, z: payload.velocity.z as number }
          : undefined;
        manager.moveObject(context.sessionId, context.participantId, requiredString(payload?.objectId, "objectId"), { x: position.x as number, y: position.y as number, z: position.z as number }, velocity);
      }, broadcastSession);
    });
    socket.on("session:send-text", (payload: { channelId?: string; content?: string }) => {
      handleSocketAction(socket, context, () => manager.sendTextMessage(context.sessionId, context.participantId, requiredString(payload?.channelId, "channelId"), requiredString(payload?.content, "content")), broadcastSession);
    });
    socket.on("session:end", () => {
      handleSocketAction(socket, context, () => manager.end(context.sessionId, context.participantId), broadcastSession);
    });
    socket.on("session:submit-decision", (payload: SubmitDecisionBody) => {
      handleSocketAction(socket, context, () => {
        manager.submitDecision(
          context.sessionId,
          context.participantId,
          requiredString(payload?.decisionId, "decisionId"),
          requiredString(payload?.optionId, "optionId"),
          requiredString(payload?.rationale, "rationale"),
          payload?.confidence
        );
      }, broadcastSession);
    });

    socket.on("disconnect", () => {
      if (participantSockets.get(context.participantId) !== socket) return;
      participantSockets.delete(context.participantId);
      try {
        manager.disconnectParticipant(context.sessionId, context.participantId);
        broadcastSession(context.sessionId);
      } catch {
        // The session may have already been closed.
      }
    });
  });

  if (options.staticWebDirectory) registerStaticWeb(app, options.staticWebDirectory);
  return {
    app,
    io,
    manager,
    async close() {
      manager.dispose();
      io.close();
      await app.close();
    }
  };
}

function handleSocketAction(
  socket: Socket,
  context: SocketContext,
  action: () => void,
  broadcast: (sessionId: string) => void
): void {
  try {
    action();
    broadcast(context.sessionId);
  } catch (error) {
    socket.emit("session:error", serializeError(error));
  }
}

function serializeError(error: unknown): { error: string; message: string } {
  return {
    error: error instanceof SessionError ? error.code : "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "Unexpected server error."
  };
}

function readBody<T>(request: FastifyRequest): T {
  return (request.body ?? {}) as T;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new SessionError("INVALID_INPUT", `${field} is required.`);
  return value.trim();
}

function requireAdmin(request: FastifyRequest, expectedToken: string): void {
  const token = request.headers["x-admin-token"];
  if (typeof token !== "string" || token !== expectedToken) {
    throw new SessionError("FORBIDDEN", "Admin authorization is required.");
  }
}
