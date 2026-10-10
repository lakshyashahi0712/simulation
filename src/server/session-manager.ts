import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { CommunicationFault, ScenarioDefinition } from "../domain/scenario.js";
import type { CounterfactualComparison } from "../domain/runtime.js";
import { SimulationEngine, type InjectFaultOptions } from "../engine/simulation-engine.js";
import { validateScenario, type ValidationResult } from "../domain/validate.js";
import { scenarioPresets } from "../scenarios/presets.js";
import { JsonPersistence, type PersistedSession, type ScenarioLibraryEntry } from "./persistence.js";
import type {
  ClientScenarioView,
  ParticipantKind,
  ScenarioSummary,
  SessionParticipant,
  SessionAar,
  SessionStatus,
  SessionSummary,
  SessionView,
  QueuedSessionAction,
  SessionActionResult
} from "./protocol.js";

interface ExerciseSession {
  id: string;
  roomCode: string;
  scenario: ScenarioDefinition;
  engine: SimulationEngine;
  status: SessionStatus;
  createdAt: string;
  participants: Map<string, ParticipantRecord>;
  autoTick: NodeJS.Timeout | undefined;
  actionReceipts: Map<string, { fingerprint: string; result: SessionActionResult }>;
}

interface ParticipantRecord extends SessionParticipant {
  accessTokenHash: string;
}

export interface SessionManagerOptions {
  scenarios?: ScenarioDefinition[];
  autoTickMs?: number;
  onChange?: (sessionId: string) => void;
  persistence?: JsonPersistence;
}

export class SessionManager {
  private readonly scenarios: Map<string, ScenarioDefinition>;
  private readonly sessions = new Map<string, ExerciseSession>();
  private readonly autoTickMs: number;
  private readonly persistence: JsonPersistence | undefined;
  private readonly archives = new Map<string, PersistedSession>();
  private readonly scenarioLibrary = new Map<string, ScenarioLibraryEntry>();
  private changeListener: ((sessionId: string) => void) | undefined;

  constructor(options: SessionManagerOptions = {}) {
    const scenarios = options.scenarios ?? scenarioPresets;
    this.persistence = options.persistence;
    const persisted = this.persistence?.load();
    this.scenarios = new Map(scenarios.map((scenario) => [scenario.id, structuredClone(scenario)]));
    // New presets become available in existing installations; saved versions retain precedence.
    for (const scenario of persisted?.scenarios ?? []) this.scenarios.set(scenario.id, structuredClone(scenario));
    for (const scenario of this.scenarios.values()) {
      this.scenarioLibrary.set(scenario.id, structuredClone(persisted?.scenarioLibrary?.[scenario.id] ?? {
        familyId: scenario.id, archived: scenario.status === "archived"
      }));
    }
    this.autoTickMs = options.autoTickMs ?? 1000;
    this.changeListener = options.onChange;
    persisted?.sessions.forEach((persistedSession) => {
      const scenario = persistedSession.scenarioSnapshot ?? this.scenarios.get(persistedSession.scenarioId);
      if (!scenario || !persistedSession.engineSnapshot) {
        this.archives.set(persistedSession.id, {
          ...structuredClone(persistedSession),
          status: "ended"
        });
        return;
      }

      const engine = new SimulationEngine(scenario);
      const status: SessionStatus = persistedSession.status === "running" ? "paused" : persistedSession.status;
      engine.restore({
        ...structuredClone(persistedSession.engineSnapshot),
        clockState: status === "paused" ? "paused" : persistedSession.engineSnapshot.clockState
      });
      const session: ExerciseSession = {
        id: persistedSession.id,
        roomCode: persistedSession.roomCode,
        scenario,
        engine,
        status,
        createdAt: persistedSession.createdAt,
        participants: new Map(persistedSession.participants.map((participant) => [participant.id, {
          ...participant,
          connected: false,
          accessTokenHash: participant.accessTokenHash ?? ""
        }])),
        autoTick: undefined,
        actionReceipts: new Map(persistedSession.actionReceipts ?? [])
      };
      this.sessions.set(session.id, session);
    });
  }

  setChangeListener(listener: (sessionId: string) => void): void {
    this.changeListener = listener;
  }

  listScenarios(): ScenarioSummary[] {
    return [...this.scenarios.values()]
      .filter((scenario) => scenario.status === "published" && !this.scenarioLibrary.get(scenario.id)?.archived)
      .map((scenario) => this.toScenarioSummary(scenario, true));
  }

  listForgeScenarios(): ScenarioSummary[] {
    return [...this.scenarios.values()].map((scenario) => this.toScenarioSummary(scenario, true));
  }

  getScenarioSummary(scenarioId: string): ScenarioSummary {
    return this.toScenarioSummary(this.getScenario(scenarioId));
  }

  getPublishedScenarioSummary(scenarioId: string): ScenarioSummary {
    const scenario = this.getScenario(scenarioId);
    if (scenario.status !== "published" || this.scenarioLibrary.get(scenarioId)?.archived) throw new SessionError("SCENARIO_NOT_FOUND", `Unknown scenario ${scenarioId}.`);
    return this.toScenarioSummary(scenario);
  }

  getScenario(scenarioId: string): ScenarioDefinition {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) throw new SessionError("SCENARIO_NOT_FOUND", `Unknown scenario ${scenarioId}.`);
    return structuredClone(scenario);
  }

  createSession(scenarioId: string, instructorName = "Instructor"): { session: SessionSummary; instructor: SessionParticipant; accessToken: string } {
    const scenario = this.getScenario(scenarioId);
    if (scenario.status !== "published") throw new SessionError("SCENARIO_NOT_PUBLISHED", "Only published scenarios can be used for an exercise.");
    this.assertScenarioActive(scenarioId);
    const id = randomUUID();
    const session: ExerciseSession = {
      id,
      roomCode: this.createRoomCode(),
      scenario,
      engine: new SimulationEngine(scenario),
      status: "waiting",
      createdAt: new Date().toISOString(),
      participants: new Map(),
      autoTick: undefined,
      actionReceipts: new Map()
    };
    const accessToken = this.createAccessToken();
    const instructor: ParticipantRecord = {
      id: randomUUID(),
      displayName: this.cleanName(instructorName),
      kind: "instructor",
      connected: false,
      joinedAt: new Date().toISOString(),
      accessTokenHash: this.hashToken(accessToken)
    };
    session.participants.set(instructor.id, instructor);
    this.sessions.set(id, session);
    this.notify(id);
    return { session: this.toSessionSummary(session), instructor: this.toPublicParticipant(instructor), accessToken };
  }

  createDraft(baseScenarioId = "operation-signal-break"): ScenarioDefinition {
    const base = this.getScenario(baseScenarioId);
    const suffix = randomBytes(3).toString("hex");
    const draft: ScenarioDefinition = {
      ...base,
      id: `${base.id}-draft-${suffix}`,
      version: 1,
      status: "draft",
      metadata: {
        ...base.metadata,
        title: `${base.metadata.title} / Draft ${suffix.toUpperCase()}`,
        tags: [...base.metadata.tags, "draft"]
      }
    };
    this.scenarios.set(draft.id, structuredClone(draft));
    this.scenarioLibrary.set(draft.id, { familyId: draft.id, archived: false });
    this.persistNow();
    return structuredClone(draft);
  }

  updateScenario(scenarioId: string, nextScenario: ScenarioDefinition): ScenarioDefinition {
    const existing = this.getScenario(scenarioId);
    this.assertScenarioActive(scenarioId);
    if (existing.status === "published") throw new SessionError("SCENARIO_LOCKED", "Published scenarios are immutable. Duplicate it to create an editable draft.");
    if (nextScenario.id !== scenarioId) throw new SessionError("SCENARIO_ID_MISMATCH", "Scenario ID cannot change during an update.");
    if (nextScenario.version !== existing.version) throw new SessionError("SCENARIO_VERSION_LOCKED", "Use New version to allocate the next version number.");
    const updated = structuredClone({ ...nextScenario, status: "draft" as const });
    this.scenarios.set(scenarioId, updated);
    this.persistNow();
    return structuredClone(updated);
  }

  validateScenarioDraft(scenarioId: string): ValidationResult {
    return validateScenario(this.getScenario(scenarioId));
  }

  publishScenario(scenarioId: string): ScenarioDefinition {
    const scenario = this.getScenario(scenarioId);
    this.assertScenarioActive(scenarioId);
    if (scenario.status === "published") return scenario;
    const result = validateScenario(scenario);
    if (!result.valid) throw new ScenarioValidationError(result);
    const published = structuredClone({ ...scenario, status: "published" as const });
    this.scenarios.set(scenarioId, published);
    this.scenarioLibrary.set(scenarioId, { ...this.scenarioLibrary.get(scenarioId)!, publishedAt: new Date().toISOString() });
    this.persistNow();
    return structuredClone(published);
  }

  duplicateScenario(scenarioId: string): ScenarioDefinition {
    return this.createDraft(scenarioId);
  }

  createScenarioVersion(scenarioId: string): ScenarioDefinition {
    const base = this.getScenario(scenarioId);
    if (base.status !== "published") throw new SessionError("SCENARIO_NOT_PUBLISHED", "Publish a version before creating its successor.");
    const familyId = this.scenarioLibrary.get(scenarioId)!.familyId;
    const version = Math.max(...this.getScenarioHistory(scenarioId).map((item) => item.version)) + 1;
    const draft = { ...base, id: `${familyId}-v${version}-${randomBytes(3).toString("hex")}`, version, status: "draft" as const };
    this.scenarios.set(draft.id, structuredClone(draft));
    this.scenarioLibrary.set(draft.id, { familyId, sourceScenarioId: scenarioId, archived: false });
    this.persistNow();
    return structuredClone(draft);
  }

  getScenarioHistory(scenarioId: string): ScenarioSummary[] {
    this.getScenario(scenarioId);
    const familyId = this.scenarioLibrary.get(scenarioId)!.familyId;
    return this.listForgeScenarios().filter((item) => item.library?.familyId === familyId).sort((a, b) => b.version - a.version);
  }

  setScenarioArchived(scenarioId: string, archived: boolean): ScenarioSummary {
    this.getScenario(scenarioId);
    if (typeof archived !== "boolean") throw new SessionError("INVALID_INPUT", "archived must be a boolean.");
    this.scenarioLibrary.set(scenarioId, { ...this.scenarioLibrary.get(scenarioId)!, archived });
    this.persistNow();
    return this.toScenarioSummary(this.getScenario(scenarioId), true);
  }

  private assertScenarioActive(scenarioId: string): void {
    if (this.scenarioLibrary.get(scenarioId)?.archived) throw new SessionError("SCENARIO_ARCHIVED", "Restore this scenario from the archive first.");
  }

  importScenario(input: ScenarioDefinition): ScenarioDefinition {
    if (this.scenarios.has(input.id)) throw new SessionError("SCENARIO_EXISTS", `Scenario ${input.id} already exists.`);
    const draft = structuredClone({ ...input, status: "draft" as const });
    const result = validateScenario(draft);
    if (!result.valid) throw new ScenarioValidationError(result);
    this.scenarios.set(draft.id, draft);
    this.scenarioLibrary.set(draft.id, { familyId: draft.id, archived: false });
    this.persistNow();
    return structuredClone(draft);
  }

  getSessionSummary(sessionId: string): SessionSummary {
    const activeSession = this.sessions.get(sessionId);
    if (activeSession) return this.toSessionSummary(activeSession);
    const archive = this.archives.get(sessionId);
    if (!archive) throw new SessionError("SESSION_NOT_FOUND", `Unknown session ${sessionId}.`);
    const scenario = this.getScenario(archive.scenarioId);
    return {
      id: archive.id,
      roomCode: archive.roomCode,
      scenario: this.toScenarioSummary(scenario),
      status: "ended",
      simulationTimeSeconds: archive.simulationTimeSeconds,
      participants: archive.participants.map((participant) => {
        const { accessTokenHash: _accessTokenHash, ...publicParticipant } = participant;
        return { ...publicParticipant, connected: false };
      }),
      createdAt: archive.createdAt
    };
  }

  getSessionLobby(sessionId: string) {
    const summary = this.getSessionSummary(sessionId);
    return {
      id: summary.id,
      roomCode: summary.roomCode,
      scenario: summary.scenario,
      status: summary.status,
      simulationTimeSeconds: summary.simulationTimeSeconds,
      participantCount: summary.participants.length,
      createdAt: summary.createdAt
    };
  }

  getAar(sessionId: string, accessToken: string): SessionAar {
    const session = this.sessions.get(sessionId);
    if (session) {
      const actor = this.authenticateParticipantRecord(sessionId, accessToken);
      this.assertInstructor(session, actor.id);
      return {
        ...session.engine.getAfterActionReview(),
        sessionId: session.id,
        roomCode: session.roomCode,
        scenarioTitle: session.scenario.metadata.title,
        status: session.status
      };
    }

    const archive = this.archives.get(sessionId);
    if (!archive?.aar) throw new SessionError("SESSION_NOT_FOUND", `Unknown session ${sessionId}.`);
    const participant = archive.participants.find((candidate) => candidate.kind === "instructor" && candidate.accessTokenHash === this.hashToken(accessToken));
    if (!participant) throw new SessionError("UNAUTHORIZED", "Invalid instructor access token.");
    const scenario = this.getScenario(archive.scenarioId);
    return {
      ...archive.aar,
      sessionId: archive.id,
      roomCode: archive.roomCode,
      scenarioTitle: scenario.metadata.title,
      status: "ended"
    };
  }

  getReplay(sessionId: string, accessToken: string, atSeconds?: number) {
    const session = this.sessions.get(sessionId);
    if (session) {
      const actor = this.authenticateParticipantRecord(sessionId, accessToken);
      this.assertInstructor(session, actor.id);
      return session.engine.getReplayEvents(atSeconds);
    }

    const archive = this.archives.get(sessionId);
    if (!archive) throw new SessionError("SESSION_NOT_FOUND", `Unknown session ${sessionId}.`);
    const participant = archive.participants.find((candidate) => candidate.kind === "instructor" && candidate.accessTokenHash === this.hashToken(accessToken));
    if (!participant) throw new SessionError("UNAUTHORIZED", "Invalid instructor access token.");
    const safeAtSeconds = Math.min(atSeconds ?? archive.simulationTimeSeconds, archive.simulationTimeSeconds);
    return {
      scenarioId: archive.scenarioId,
      scenarioVersion: archive.scenarioVersion,
      atSeconds: safeAtSeconds,
      events: archive.events.filter((event) => event.simulationTimeSeconds <= safeAtSeconds)
    };
  }

  getCounterfactual(sessionId: string, accessToken: string, decisionId: string, alternateOptionId: string, rationale?: string): CounterfactualComparison {
    const session = this.getSession(sessionId);
    const actor = this.authenticateParticipantRecord(sessionId, accessToken);
    this.assertInstructor(session, actor.id);
    return session.engine.getCounterfactual(decisionId, alternateOptionId, rationale);
  }

  getHistoricalPerception(sessionId: string, accessToken: string, roleId: string, atSeconds: number) {
    const session = this.getSession(sessionId);
    const actor = this.authenticateParticipantRecord(sessionId, accessToken);
    this.assertInstructor(session, actor.id);
    return session.engine.getPerceptionAt(roleId, atSeconds);
  }

  joinSession(sessionId: string, displayName = "Trainee", roleId?: string): { participant: SessionParticipant; accessToken: string } {
    const session = this.getSession(sessionId);
    if (session.status === "ended") throw new SessionError("INVALID_SESSION_STATE", "This exercise has ended. Reconnect with your existing access token to review it.");
    if (roleId) this.assertRole(session, roleId);
    if (roleId && [...session.participants.values()].some((participant) => participant.roleId === roleId)) {
      throw new SessionError("ROLE_TAKEN", `Role ${roleId} is already assigned in this session.`);
    }

    const accessToken = this.createAccessToken();
    const participant: ParticipantRecord = {
      id: randomUUID(),
      displayName: this.cleanName(displayName),
      kind: "trainee",
      connected: false,
      joinedAt: new Date().toISOString(),
      ...(roleId === undefined ? {} : { roleId }),
      accessTokenHash: this.hashToken(accessToken)
    };
    session.participants.set(participant.id, participant);
    this.notify(sessionId);
    return { participant: this.toPublicParticipant(participant), accessToken };
  }

  joinByRoomCode(roomCode: string, displayName = "Trainee", roleId?: string): { session: SessionSummary; participant: SessionParticipant; accessToken: string } {
    const normalizedCode = roomCode.trim().toUpperCase();
    const session = [...this.sessions.values()].find((candidate) => candidate.roomCode === normalizedCode);
    if (!session) throw new SessionError("SESSION_NOT_FOUND", `Unknown room code ${normalizedCode}.`);
    const joined = this.joinSession(session.id, displayName, roleId);
    return { session: this.toSessionSummary(session), ...joined };
  }

  connectParticipant(sessionId: string, accessToken: string): SessionParticipant {
    const participant = this.authenticateParticipantRecord(sessionId, accessToken);
    participant.connected = true;
    this.notify(sessionId);
    return this.toPublicParticipant(participant);
  }

  authenticateParticipant(sessionId: string, accessToken: string): string {
    return this.authenticateParticipantRecord(sessionId, accessToken).id;
  }

  disconnectParticipant(sessionId: string, participantId: string): void {
    const participant = this.getParticipant(sessionId, participantId);
    participant.connected = false;
    this.notify(sessionId);
  }

  assignRole(sessionId: string, actorId: string, participantId: string, roleId: string): SessionParticipant {
    const session = this.getSession(sessionId);
    this.assertInstructor(session, actorId);
    if (session.status === "ended") throw new SessionError("INVALID_SESSION_STATE", "Completed exercises are read-only.");
    this.assertRole(session, roleId);
    const participant = this.getParticipant(sessionId, participantId);
    if (participant.kind !== "trainee") throw new SessionError("INVALID_PARTICIPANT", "Only trainees can receive a training role.");
    const assignedToAnother = [...session.participants.values()].some(
      (candidate) => candidate.id !== participantId && candidate.roleId === roleId
    );
    if (assignedToAnother) throw new SessionError("ROLE_TAKEN", `Role ${roleId} is already assigned in this session.`);
    participant.roleId = roleId;
    this.notify(sessionId);
    return this.toPublicParticipant(participant);
  }

  start(sessionId: string, actorId: string): void {
    const session = this.getSession(sessionId);
    this.assertInstructor(session, actorId);
    if (session.status === "waiting") {
      session.engine.start();
    } else if (session.status === "paused") {
      session.engine.resume();
    } else {
      throw new SessionError("INVALID_SESSION_STATE", `Cannot start a session in ${session.status} state.`);
    }
    session.status = "running";
    this.startAutoTick(session);
    this.notify(sessionId);
  }

  pause(sessionId: string, actorId: string): void {
    const session = this.getSession(sessionId);
    this.assertInstructor(session, actorId);
    if (session.status !== "running") throw new SessionError("INVALID_SESSION_STATE", "Only a running session can be paused.");
    session.engine.pause();
    session.status = "paused";
    this.stopAutoTick(session);
    this.notify(sessionId);
  }

  resume(sessionId: string, actorId: string): void {
    const session = this.getSession(sessionId);
    this.assertInstructor(session, actorId);
    if (session.status !== "paused") throw new SessionError("INVALID_SESSION_STATE", "Only a paused session can be resumed.");
    session.engine.resume();
    session.status = "running";
    this.startAutoTick(session);
    this.notify(sessionId);
  }

  advance(sessionId: string, actorId: string, seconds: number): number {
    const session = this.getSession(sessionId);
    this.assertInstructor(session, actorId);
    const time = session.engine.advanceBy(seconds);
    if (session.engine.isEnded) {
      session.status = "ended";
      this.stopAutoTick(session);
    }
    this.notify(sessionId);
    return time;
  }

  injectFault(sessionId: string, actorId: string, channelId: string, fault: CommunicationFault, options: InjectFaultOptions = {}): void {
    const session = this.getSession(sessionId);
    this.assertInstructor(session, actorId);
    session.engine.injectChannelFault(channelId, fault, options);
    this.notify(sessionId);
  }

  restoreChannel(sessionId: string, actorId: string, channelId: string): void {
    const session = this.getSession(sessionId);
    this.assertInstructor(session, actorId);
    if (session.status === "ended") throw new SessionError("INVALID_SESSION_STATE", "Completed exercises are read-only.");
    session.engine.restoreChannel(channelId);
    this.notify(sessionId);
  }

  triggerZoneEntered(sessionId: string, participantId: string, objectId: string): void {
    const session = this.getSession(sessionId);
    this.assertRunning(session);
    const participant = this.getParticipant(sessionId, participantId);
    if (participant.kind !== "trainee" || !participant.roleId) throw new SessionError("ROLE_REQUIRED", "A trainee must have an assigned role before entering a trigger zone.");
    const role = session.scenario.roles.find((candidate) => candidate.id === participant.roleId);
    const object = session.scenario.environment.objects.find((candidate) => candidate.id === objectId);
    if (!role?.visibility.objectIds.includes(objectId) || !object?.physics?.trigger) throw new SessionError("FORBIDDEN", "This trigger zone is unavailable to your role.");
    session.engine.triggerZoneEntered(participant.roleId, objectId);
    this.notify(sessionId);
  }

  triggerObjectCollision(sessionId: string, participantId: string, objectId: string, otherObjectId: string): void {
    const session = this.getSession(sessionId);
    this.assertRunning(session);
    this.assertInstructor(session, participantId);
    session.engine.triggerObjectCollision(objectId, otherObjectId);
    this.notify(sessionId);
  }

  moveObject(sessionId: string, participantId: string, objectId: string, position: { x: number; y: number; z: number }, velocity?: { x: number; y: number; z: number }): void {
    const session = this.getSession(sessionId);
    this.assertRunning(session);
    const participant = this.getParticipant(sessionId, participantId);
    if (participant.kind !== "trainee" || !participant.roleId) throw new SessionError("ROLE_REQUIRED", "A trainee must have an assigned role before moving an object.");
    const object = session.scenario.environment.objects.find((candidate) => candidate.id === objectId);
    const role = session.scenario.roles.find((candidate) => candidate.id === participant.roleId);
    if (!object || object.properties?.roleId !== participant.roleId || !role?.visibility.objectIds.includes(objectId)) throw new SessionError("FORBIDDEN", "Only a visible object assigned to your role can be moved.");
    if (!object.physics || object.physics.body === "fixed" || object.physics.collider === "none") throw new SessionError("FORBIDDEN", "This object has no movable physics body.");
    const { width, depth } = session.scenario.environment.world;
    if (![position.x, position.y, position.z].every(Number.isFinite) || Math.abs(position.x) > width / 2 || Math.abs(position.z) > depth / 2) throw new SessionError("INVALID_POSITION", "Movement must use finite coordinates inside the scenario world.");
    if (velocity && ![velocity.x, velocity.y, velocity.z].every(Number.isFinite)) throw new SessionError("INVALID_POSITION", "Movement velocity must be finite.");
    session.engine.moveObject(objectId, position, velocity);
    this.notify(sessionId);
  }

  sendTextMessage(sessionId: string, participantId: string, channelId: string, content: string): void {
    const session = this.getSession(sessionId);
    const participant = this.getParticipant(sessionId, participantId);
    if (participant.kind !== "trainee" || !participant.roleId) throw new SessionError("ROLE_REQUIRED", "A trainee must have an assigned role before sending text.");
    session.engine.sendTextMessage(participant.roleId, channelId, content);
    this.notify(sessionId);
  }

  executeQueuedAction(sessionId: string, participantId: string, input: QueuedSessionAction): SessionActionResult {
    const session = this.getSession(sessionId);
    this.getParticipant(sessionId, participantId);
    if (!input || typeof input.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(input.id)) throw new SessionError("INVALID_INPUT", "A valid action ID is required.");
    const key = `${participantId}:${input.id}`;
    const fingerprint = JSON.stringify([input.event, input.payload]);
    const receipt = session.actionReceipts.get(key);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new SessionError("ACTION_ID_CONFLICT", "Action ID was already used with a different payload.");
      return structuredClone(receipt.result);
    }
    let result: SessionActionResult;
    try {
      if (session.status !== "running") throw new SessionError("INVALID_SESSION_STATE", "Queued actions require a running exercise.");
      const payload = input.payload;
      const stringField = (name: string) => {
        const value = payload?.[name];
        if (typeof value !== "string" || !value.trim()) throw new SessionError("INVALID_INPUT", `${name} is required.`);
        return value;
      };
      if (input.event === "session:send-text") {
        this.sendTextMessage(sessionId, participantId, stringField("channelId"), stringField("content"));
      } else if (input.event === "session:submit-decision") {
        const confidence = payload.confidence;
        if (confidence !== undefined && (typeof confidence !== "number" || !Number.isFinite(confidence))) throw new SessionError("INVALID_INPUT", "Confidence must be a finite number.");
        this.submitDecision(sessionId, participantId, stringField("decisionId"), stringField("optionId"), stringField("rationale"), confidence as number | undefined);
      } else {
        throw new SessionError("INVALID_INPUT", "Only text and decisions support offline delivery.");
      }
      result = { id: input.id, status: "accepted" };
    } catch (error) {
      result = { id: input.id, status: "rejected", error: error instanceof SessionError ? error.code : "ACTION_REJECTED", message: error instanceof Error ? error.message : "Action rejected." };
    }
    session.actionReceipts.set(key, { fingerprint, result });
    this.persistNow();
    return structuredClone(result);
  }

  assertVoiceChannel(sessionId: string, participantId: string, channelId: string): void {
    const session = this.getSession(sessionId);
    const participant = this.getParticipant(sessionId, participantId);
    const channel = session.scenario.channels.find((candidate) => candidate.id === channelId);
    if (session.status === "ended") throw new SessionError("INVALID_SESSION_STATE", "Voice is closed for completed exercises.");
    if (!channel || channel.status !== "active") throw new SessionError("FORBIDDEN", "Voice channel is unavailable.");
    if (participant.kind !== "instructor" && (!participant.roleId || !channel.participants.includes(participant.roleId))) throw new SessionError("FORBIDDEN", "Your role cannot join this voice channel.");
  }

  end(sessionId: string, actorId: string, reason = "ended-by-instructor"): void {
    const session = this.getSession(sessionId);
    this.assertInstructor(session, actorId);
    if (session.status === "waiting") throw new SessionError("INVALID_SESSION_STATE", "Start the exercise before ending it.");
    session.engine.endExercise(reason);
    session.status = "ended";
    this.stopAutoTick(session);
    this.notify(sessionId);
  }

  submitDecision(sessionId: string, participantId: string, decisionId: string, optionId: string, rationale: string, confidence?: number) {
    const session = this.getSession(sessionId);
    if (session.status !== "running") throw new SessionError("INVALID_SESSION_STATE", "Decisions require a running exercise.");
    const participant = this.getParticipant(sessionId, participantId);
    if (participant.kind !== "trainee" || !participant.roleId) {
      throw new SessionError("ROLE_REQUIRED", "A trainee must have an assigned role before submitting a decision.");
    }
    const record = session.engine.submitDecision({
      roleId: participant.roleId,
      decisionId,
      optionId,
      rationale,
      ...(confidence === undefined ? {} : { confidence })
    });
    this.notify(sessionId);
    return record;
  }

  getView(sessionId: string, participantId: string): SessionView {
    const session = this.getSession(sessionId);
    const participant = this.getParticipant(sessionId, participantId);
    const roleId = participant.roleId;
    const clientScenario = this.toClientScenario(session.scenario, roleId, participant.kind === "instructor");
    const isInstructor = participant.kind === "instructor";
    const view: SessionView = {
      session: this.toSessionSummary(session),
      participant: this.toPublicParticipant(participant),
      scenario: clientScenario,
      channelHealth: isInstructor ? session.engine.getAllChannelHealth() : roleId ? session.engine.getChannelHealth(roleId) : [],
      decisions: isInstructor ? session.engine.getDecisions() : session.engine.getDecisions().filter((decision) => decision.roleId === roleId),
      events: isInstructor ? session.engine.allEvents() : roleId ? session.engine.eventLog.forRole(roleId) : [],
      score: isInstructor ? session.engine.getScoreSnapshot() : { total: 0, dimensions: [] }
    };

    const physicsBodies = session.engine.getGroundTruthSnapshot().physicsBodies;
    if (!isInstructor && roleId) {
      const visibleObjectIds = new Set(clientScenario.environment.objects.map((object) => object.id));
      view.physicsBodies = Object.fromEntries(Object.entries(physicsBodies).filter(([objectId]) => visibleObjectIds.has(objectId)));
    }

    if (isInstructor) {
      const groundTruth = session.engine.getGroundTruthSnapshot();
      view.groundTruth = {
        activeChannelFaults: groundTruth.activeChannelFaults,
        objectStates: groundTruth.objectStates,
        physicsBodies: groundTruth.physicsBodies
      };
    } else if (roleId) {
      view.perception = session.engine.getPerception(roleId);
    }

    return view;
  }

  dispose(): void {
    this.persistNow();
    for (const session of this.sessions.values()) this.stopAutoTick(session);
    this.sessions.clear();
  }

  private getSession(sessionId: string): ExerciseSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionError("SESSION_NOT_FOUND", `Unknown session ${sessionId}.`);
    return session;
  }

  private getParticipant(sessionId: string, participantId: string): ParticipantRecord {
    const participant = this.getSession(sessionId).participants.get(participantId);
    if (!participant) throw new SessionError("PARTICIPANT_NOT_FOUND", `Unknown participant ${participantId}.`);
    return participant;
  }

  private assertInstructor(session: ExerciseSession, actorId: string): void {
    const actor = session.participants.get(actorId);
    if (!actor || actor.kind !== "instructor") throw new SessionError("FORBIDDEN", "Only the instructor can perform this action.");
  }

  private assertRole(session: ExerciseSession, roleId: string): void {
    if (!session.scenario.roles.some((role) => role.id === roleId)) throw new SessionError("ROLE_NOT_FOUND", `Unknown role ${roleId}.`);
  }

  private assertRunning(session: ExerciseSession): void {
    if (session.status !== "running") throw new SessionError("INVALID_SESSION_STATE", "This action requires a running exercise.");
  }

  private startAutoTick(session: ExerciseSession): void {
    if (this.autoTickMs <= 0 || session.autoTick) return;
    session.autoTick = setInterval(() => {
      if (session.status !== "running") return;
      try {
        session.engine.advanceBy(this.autoTickMs / 1000);
        if (session.engine.isEnded) {
          session.status = "ended";
          this.stopAutoTick(session);
        }
        this.notify(session.id);
      } catch {
        this.stopAutoTick(session);
      }
    }, this.autoTickMs);
  }

  private stopAutoTick(session: ExerciseSession): void {
    if (!session.autoTick) return;
    clearInterval(session.autoTick);
    session.autoTick = undefined;
  }

  private notify(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.engine.isEnded) {
      session.status = "ended";
      this.stopAutoTick(session);
    }
    this.persistNow();
    this.changeListener?.(sessionId);
  }

  private authenticateParticipantRecord(sessionId: string, accessToken: string): ParticipantRecord {
    if (!accessToken.trim()) throw new SessionError("UNAUTHORIZED", "A participant access token is required.");
    const tokenHash = this.hashToken(accessToken);
    const participant = [...this.getSession(sessionId).participants.values()].find((candidate) => candidate.accessTokenHash === tokenHash);
    if (!participant) throw new SessionError("UNAUTHORIZED", "Invalid participant access token.");
    return participant;
  }

  private createAccessToken(): string {
    return randomBytes(32).toString("hex");
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private toPublicParticipant(participant: ParticipantRecord): SessionParticipant {
    const { accessTokenHash: _accessTokenHash, ...publicParticipant } = participant;
    return structuredClone(publicParticipant);
  }

  private persistNow(): void {
    if (!this.persistence) return;
    const activeSessions = [...this.sessions.values()].map((session) => this.toPersistedSession(session));
    const activeIds = new Set(activeSessions.map((session) => session.id));
    const archivedSessions = [...this.archives.values()].filter((session) => !activeIds.has(session.id));
    this.persistence.save({
      version: 1,
      scenarios: [...this.scenarios.values()].map((scenario) => structuredClone(scenario)),
      sessions: [...archivedSessions, ...activeSessions],
      scenarioLibrary: Object.fromEntries(this.scenarioLibrary)
    });
  }

  private toPersistedSession(session: ExerciseSession): PersistedSession {
    return {
      id: session.id,
      roomCode: session.roomCode,
      scenarioId: session.scenario.id,
      scenarioVersion: session.scenario.version,
      status: session.status,
      createdAt: session.createdAt,
      simulationTimeSeconds: session.engine.clock.timeSeconds,
      participants: [...session.participants.values()].map((participant) => {
        const publicParticipant = this.toPublicParticipant(participant);
        return {
          id: publicParticipant.id,
          displayName: publicParticipant.displayName,
          kind: publicParticipant.kind,
          joinedAt: publicParticipant.joinedAt,
          accessTokenHash: participant.accessTokenHash,
          ...(publicParticipant.roleId === undefined ? {} : { roleId: publicParticipant.roleId })
        };
      }),
      events: session.engine.allEvents(),
      decisions: session.engine.getDecisions(),
      engineSnapshot: session.engine.getSnapshot(),
      aar: session.engine.getAfterActionReview(),
      scenarioSnapshot: structuredClone(session.scenario),
      actionReceipts: [...session.actionReceipts.entries()]
    };
  }

  private createRoomCode(): string {
    let code = "";
    do {
      code = randomBytes(3).toString("hex").toUpperCase();
    } while ([...this.sessions.values()].some((session) => session.roomCode === code));
    return code;
  }

  private cleanName(value: string): string {
    const name = value.trim().slice(0, 60);
    return name || "Participant";
  }

  private toScenarioSummary(scenario: ScenarioDefinition, includeLibrary = false): ScenarioSummary {
    return {
      id: scenario.id,
      version: scenario.version,
      status: scenario.status,
      title: scenario.metadata.title,
      category: scenario.metadata.category,
      description: scenario.metadata.description,
      durationSeconds: scenario.metadata.durationSeconds,
      tags: [...scenario.metadata.tags],
      roleCount: scenario.roles.length,
      ...(includeLibrary ? { library: structuredClone(this.scenarioLibrary.get(scenario.id)!) } : {})
    };
  }

  private toSessionSummary(session: ExerciseSession): SessionSummary {
    return {
      id: session.id,
      roomCode: session.roomCode,
      scenario: this.toScenarioSummary(session.scenario),
      status: session.status,
      simulationTimeSeconds: session.engine.clock.timeSeconds,
      participants: [...session.participants.values()].map((participant) => this.toPublicParticipant(participant)),
      createdAt: session.createdAt
    };
  }

  private toClientScenario(scenario: ScenarioDefinition, roleId: string | undefined, fullAccess: boolean): ClientScenarioView {
    const visibleObjectIds = new Set(roleId ? scenario.roles.find((role) => role.id === roleId)?.visibility.objectIds ?? [] : []);
    const objects = fullAccess ? scenario.environment.objects : scenario.environment.objects.filter((object) => visibleObjectIds.has(object.id));
    const channels = fullAccess ? scenario.channels : scenario.channels.filter((channel) => roleId && channel.participants.includes(roleId));
    return {
      id: scenario.id,
      version: scenario.version,
      metadata: structuredClone(scenario.metadata),
      roles: scenario.roles.map(({ id, name, kind, briefing }) => ({ id, name, kind, briefing })),
      environment: {
        world: structuredClone(scenario.environment.world),
        objects: structuredClone(objects)
      },
      channels: structuredClone(channels),
      decisions: fullAccess
        ? structuredClone(scenario.decisions)
        : structuredClone(scenario.decisions.filter((decision) => roleId && decision.targetRoles.includes(roleId)))
    };
  }
}

export class SessionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "SessionError";
  }
}

export class ScenarioValidationError extends Error {
  constructor(public readonly result: ValidationResult) {
    super(`Scenario validation failed with ${result.errors.length} error(s).`);
    this.name = "ScenarioValidationError";
  }
}
