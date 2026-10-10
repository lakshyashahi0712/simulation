import type {
  CommunicationFault,
  CommunicationChannel,
  ReportTemplate,
  RuleAction,
  RuleCondition,
  RuleTrigger,
  ScenarioDefinition,
  ScenarioEvent
} from "../domain/scenario.js";
import { assertValidScenario } from "../domain/validate.js";
import type {
  AfterActionReview,
  CounterfactualComparison,
  CounterfactualBranch,
  RecordedEvent,
  DecisionRecord,
  ChannelHealth,
  DeliveryStatus,
  GroundTruthSnapshot,
  ObservedReport,
  PerceptionSnapshot,
  ScoreDimensionSummary,
  ScoreEventRecord,
  ScoreSnapshot
} from "../domain/runtime.js";
import { EventLog } from "./event-log.js";
import { SimulationClock, type ClockState } from "./clock.js";
import { PhysicsWorld, type PhysicsWorldSnapshot } from "./physics-world.js";
import { reconstructPerception } from "./perception-replay.js";

interface ActiveChannelFault {
  id: string;
  channelId: string;
  fault: CommunicationFault;
  startedAtSeconds: number;
  endsAtSeconds?: number;
  delayMs?: number;
}

interface PendingDelivery {
  id: string;
  reportId: string;
  roleId: string;
  channelId: string;
  deliverAtSeconds: number;
  queuedAtSeconds: number;
  generatedAtSeconds: number;
}

interface ActiveDecision {
  decisionId: string;
  roleIds: string[];
  activatedAtSeconds: number;
  expiresAtSeconds?: number;
}

interface PendingTextMessage {
  id: string;
  senderRole: string;
  channelId: string;
  content: string;
  targetRoles: string[];
  generatedAtSeconds: number;
  deliverAtSeconds: number;
  causedByEventId: string;
}

export interface SimulationEngineSnapshot {
  scenarioId: string;
  scenarioVersion: number;
  clockTimeSeconds: number;
  clockState: ClockState;
  nextScenarioEventIndex: number;
  nextFaultNumber: number;
  ended: boolean;
  activeFaults: Array<[string, ActiveChannelFault[]]>;
  pendingDeliveries: PendingDelivery[];
  activeDecisions: ActiveDecision[];
  decisions: DecisionRecord[];
  objectStates: Record<string, Record<string, unknown>>;
  objectiveStates: Record<string, string>;
  executedRules: string[];
  evaluatedTimeRules: string[];
  perceptions: Record<string, ObservedReport[]>;
  events: ReturnType<EventLog["all"]>;
  physicsWorld?: PhysicsWorldSnapshot;
  pendingTextMessages?: PendingTextMessage[];
  nextTextNumber?: number;
  decisionSnapshots?: Record<string, SimulationEngineSnapshot>;
}

export interface InjectFaultOptions {
  delayMs?: number;
  durationSeconds?: number;
}

export interface SubmitDecisionInput {
  roleId: string;
  decisionId: string;
  optionId: string;
  rationale: string;
  confidence?: number;
}

export class SimulationEngine {
  readonly clock = new SimulationClock();
  readonly eventLog = new EventLog();

  private readonly scenario: ScenarioDefinition;
  private readonly events: ScenarioEvent[];
  private readonly reportsById: Map<string, ReportTemplate>;
  private readonly channelsById: Map<string, CommunicationChannel>;
  private readonly perceptions = new Map<string, Map<string, ObservedReport>>();
  private readonly activeFaults = new Map<string, ActiveChannelFault[]>();
  private readonly pendingDeliveries: PendingDelivery[] = [];
  private readonly pendingTextMessages: PendingTextMessage[] = [];
  private nextTextNumber = 1;
  private readonly activeDecisions = new Map<string, ActiveDecision>();
  private readonly decisions: DecisionRecord[] = [];
  private readonly decisionSnapshots = new Map<string, SimulationEngineSnapshot>();
  private readonly objectStates = new Map<string, Record<string, unknown>>();
  private readonly objectiveStates = new Map<string, string>();
  private readonly executedRules = new Set<string>();
  private readonly executingRules = new Set<string>();
  private readonly evaluatedTimeRules = new Set<string>();
  private readonly physicsWorld: PhysicsWorld;
  private activeRuleCauseEventId: string | undefined;
  private nextScenarioEventIndex = 0;
  private nextFaultNumber = 1;
  private ended = false;

  constructor(scenario: ScenarioDefinition) {
    assertValidScenario(scenario);
    this.scenario = structuredClone(scenario);
    this.events = [...this.scenario.events].sort((left, right) => left.atSeconds - right.atSeconds);
    this.reportsById = new Map(this.scenario.reports.map((report) => [report.id, report]));
    this.channelsById = new Map(this.scenario.channels.map((channel) => [channel.id, channel]));
    this.physicsWorld = new PhysicsWorld(this.scenario.environment.objects);

    this.scenario.roles.forEach((role) => {
      this.perceptions.set(role.id, new Map());
    });
    this.scenario.environment.objects.forEach((object) => {
      this.objectStates.set(object.id, structuredClone(object.properties ?? {}));
    });
    this.scenario.objectives.forEach((objective) => {
      this.objectiveStates.set(objective.id, objective.status);
    });
  }

  get scenarioId(): string {
    return this.scenario.id;
  }

  get scenarioVersion(): number {
    return this.scenario.version;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  start(): void {
    this.clock.start();
    this.append("SCENARIO_STARTED", "ground-truth", {
      scenarioId: this.scenario.id,
      scenarioVersion: this.scenario.version
    });
    this.processDueItems();
  }

  pause(): void {
    this.clock.pause();
    this.append("SCENARIO_PAUSED", "ground-truth", {});
  }

  resume(): void {
    this.clock.resume();
    this.append("SCENARIO_RESUMED", "ground-truth", {});
  }

  advanceBy(seconds: number): number {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error("Advance duration must be greater than zero.");
    }
    if (this.clock.state !== "running") {
      throw new Error("The simulation must be running before it can advance.");
    }

    const targetTime = Math.min(this.scenario.metadata.durationSeconds, this.clock.timeSeconds + seconds);
    this.processDueItems();

    while (!this.ended && this.clock.timeSeconds < targetTime) {
      const nextTime = Math.min(targetTime, this.nextInternalTime(targetTime));
      const previousTime = this.clock.timeSeconds;
      this.clock.advanceTo(nextTime);
      this.processPhysics(nextTime - previousTime);
      this.processDueItems();

      if (nextTime === targetTime) break;
    }

    return this.clock.timeSeconds;
  }

  injectChannelFault(channelId: string, fault: CommunicationFault, options: InjectFaultOptions = {}): void {
    this.assertChannel(channelId);
    if (this.clock.state !== "running") throw new Error("A fault can only be injected while the simulation is running.");

    const activeFault = this.createFault(channelId, fault, options, "instructor");
    const faultEvent = this.append("CHANNEL_FAULT_INJECTED", "ground-truth", {
      channelId,
      fault,
      delayMs: activeFault.delayMs,
      durationSeconds: activeFault.endsAtSeconds === undefined ? undefined : activeFault.endsAtSeconds - this.clock.timeSeconds,
      source: "instructor"
    });
    this.runRules({ type: "instructor-injection", eventType: "channel-fault" }, faultEvent.id);
    if (fault === "dropout" || fault === "outage") this.runRules({ type: "channel-disabled", channelId }, faultEvent.id);
  }

  restoreChannel(channelId: string): void {
    this.assertChannel(channelId);
    this.activeFaults.delete(channelId);
    this.append("CHANNEL_RESTORED", "ground-truth", { channelId, source: "instructor" });
    this.runRules({ type: "channel-restored", channelId });
  }

  getPerception(roleId: string): PerceptionSnapshot {
    this.assertRole(roleId);
    return this.getPerceptionAt(roleId, this.clock.timeSeconds);
  }

  getPerceptionAt(roleId: string, atSeconds = this.clock.timeSeconds): PerceptionSnapshot {
    this.assertRole(roleId);
    if (!Number.isFinite(atSeconds) || atSeconds < 0) throw new Error("Perception time must be a non-negative finite number.");
    return reconstructPerception(this.eventLog.all(), roleId, Math.min(atSeconds, this.clock.timeSeconds), this.scenario.reports);
  }

  getDecisions(): DecisionRecord[] {
    return structuredClone(this.decisions);
  }

  getScoreSnapshot(): ScoreSnapshot {
    const scoreEvents = this.eventLog.all()
      .filter((event) => event.type === "SCORE_EVENT")
      .map((event): ScoreEventRecord => ({
        id: event.id,
        dimensionId: String(event.payload.dimensionId ?? "unknown"),
        amount: Number(event.payload.amount ?? 0),
        reason: String(event.payload.reason ?? "Unspecified score event."),
        simulationTimeSeconds: event.simulationTimeSeconds,
        ...(event.causedByEventId === undefined ? {} : { causedByEventId: event.causedByEventId })
      }));
    const dimensions: ScoreDimensionSummary[] = this.scenario.scoring.map((dimension) => {
      const events = scoreEvents.filter((event) => event.dimensionId === dimension.id);
      const raw = events.reduce((total, event) => total + event.amount, 0);
      return {
        dimensionId: dimension.id,
        name: dimension.name,
        weight: dimension.weight,
        raw,
        weighted: raw * dimension.weight,
        events
      };
    });
    return structuredClone({
      total: dimensions.reduce((total, dimension) => total + dimension.weighted, 0),
      dimensions
    });
  }

  getAfterActionReview(): AfterActionReview {
    return structuredClone({
      scenarioId: this.scenario.id,
      scenarioVersion: this.scenario.version,
      simulationTimeSeconds: this.clock.timeSeconds,
      events: this.eventLog.all(),
      reportTemplates: structuredClone(this.scenario.reports),
      decisions: this.decisions,
      score: this.getScoreSnapshot(),
      roles: this.scenario.roles.map((role) => {
        const perception = this.getPerception(role.id);
        const decisions = this.decisions.filter((decision) => decision.roleId === role.id);
        return {
          roleId: role.id,
          reportCount: perception.reports.length,
          deliveredReportCount: perception.reports.filter((report) => report.status === "delivered").length,
          decisionCount: decisions.length,
          decisions,
          finalPerception: perception
        };
      })
    });
  }

  getReplayEvents(atSeconds = this.clock.timeSeconds) {
    if (!Number.isFinite(atSeconds) || atSeconds < 0) throw new Error("Replay time must be a non-negative finite number.");
    return {
      scenarioId: this.scenario.id,
      scenarioVersion: this.scenario.version,
      atSeconds: Math.min(atSeconds, this.clock.timeSeconds),
      events: this.eventLog.atOrBefore(Math.min(atSeconds, this.clock.timeSeconds))
    };
  }

  getCounterfactual(decisionId: string, alternateOptionId: string, rationale?: string): CounterfactualComparison {
    // A rule can reactivate a decision gate. The latest submission is paired
    // with the latest checkpoint retained for that gate ID.
    const actual = [...this.decisions].reverse().find((candidate) => candidate.decisionId === decisionId);
    const decision = this.scenario.decisions.find((candidate) => candidate.id === decisionId);
    if (!actual || !decision) throw new Error(`Unknown submitted decision ${decisionId}.`);
    if (!decision.options.some((option) => option.id === alternateOptionId)) throw new Error(`Unknown option ${alternateOptionId} for decision ${decisionId}.`);
    const alternate = { ...actual, optionId: alternateOptionId, rationale: rationale?.trim() || actual.rationale };
    const actualScores = this.calculateDecisionScores(actual, decision);
    const alternateScores = this.calculateDecisionScores(alternate, decision);
    const dimensions = this.scenario.scoring.map((dimension) => ({
      dimensionId: dimension.id,
      actual: actualScores[dimension.id]?.amount ?? 0,
      alternate: alternateScores[dimension.id]?.amount ?? 0,
      delta: (alternateScores[dimension.id]?.amount ?? 0) - (actualScores[dimension.id]?.amount ?? 0),
      reason: alternateScores[dimension.id]?.reason ?? "No authored scoring rule for this dimension."
    }));
    const weighted = (scores: Record<string, { amount: number }>) => this.scenario.scoring.reduce((total, dimension) => total + (scores[dimension.id]?.amount ?? 0) * dimension.weight, 0);
    const actualScore = weighted(actualScores);
    const alternateScore = weighted(alternateScores);
    const decisionSnapshot = this.decisionSnapshots.get(decisionId);
    const comparison = { decisionId, roleId: actual.roleId, actualOptionId: actual.optionId, alternateOptionId, actualScore, alternateScore, delta: alternateScore - actualScore, dimensions };
    if (!decisionSnapshot) return {
      ...comparison, replayMode: "score-only", assumptions: ["This older exercise has no pre-decision checkpoint; only decision scoring can be compared."]
    };
    const actualBranch = this.replayDecisionBranch(decisionSnapshot, actual);
    const alternateBranch = this.replayDecisionBranch(decisionSnapshot, alternate);
    return {
      ...comparison, replayMode: "branch", actualBranch, alternateBranch,
      actualFutureScore: actualBranch.score.total, alternateFutureScore: alternateBranch.score.total,
      futureDelta: alternateBranch.score.total - actualBranch.score.total,
      actualFutureEventCount: actualBranch.events.length, alternateFutureEventCount: alternateBranch.events.length,
      assumptions: [
        "Both branches start at the same pre-decision checkpoint and run to the recorded exercise horizon, unless a branch ends earlier.",
        "The scenario version, seed, pending deliveries, and information available at decision time are held constant.",
        "Later recorded instructor controls, text, movement, and decisions are replayed in order. Inputs invalid in a branch are listed as skipped.",
        "Future scores include the selected decision and its immediate consequences. Simulated branches do not modify the original exercise."
      ]
    };
  }

  private replayDecisionBranch(checkpoint: SimulationEngineSnapshot, selected: DecisionRecord): CounterfactualBranch {
    const engine = new SimulationEngine(this.scenario);
    engine.restore(checkpoint);
    engine.submitDecision(selected);
    const skippedInputs: CounterfactualBranch["skippedInputs"] = [];
    // The first event after the checkpoint is the selected decision itself, already substituted above.
    const inputs = this.eventLog.all().filter((event) => event.sequence > checkpoint.events.length + 1 && this.isReplayInput(event));
    for (const event of inputs) {
      try {
        const seconds = event.simulationTimeSeconds - engine.clock.timeSeconds;
        if (seconds > 0) engine.advanceBy(seconds);
        if (engine.isEnded) throw new Error("The branch has already ended.");
        engine.applyReplayInput(event);
      } catch (error) {
        skippedInputs.push({ sequence: event.sequence, type: event.type, reason: error instanceof Error ? error.message : "Invalid replay input." });
      }
    }
    const remaining = this.clock.timeSeconds - engine.clock.timeSeconds;
    if (remaining > 0 && engine.clock.state === "running") engine.advanceBy(remaining);
    const futureEvents = engine.allEvents().slice(checkpoint.events.length);
    const fullScore = engine.getScoreSnapshot();
    const dimensions = fullScore.dimensions.map((dimension) => {
      const events = dimension.events.filter((event) => futureEvents.some((future) => future.id === event.id));
      const raw = events.reduce((total, event) => total + event.amount, 0);
      return { ...dimension, events, raw, weighted: raw * dimension.weight };
    });
    return {
      fromSeconds: checkpoint.clockTimeSeconds, throughSeconds: engine.clock.timeSeconds, ended: engine.isEnded,
      score: { total: dimensions.reduce((total, dimension) => total + dimension.weighted, 0), dimensions },
      events: futureEvents, objectStates: engine.getGroundTruthSnapshot().objectStates,
      perceptions: this.scenario.roles.map((role) => engine.getPerception(role.id)), skippedInputs
    };
  }

  private isReplayInput(event: RecordedEvent): boolean {
    return event.type === "DECISION_SUBMITTED" || event.type === "TEXT_MESSAGE_QUEUED"
      || event.type === "SCENARIO_PAUSED" || event.type === "SCENARIO_RESUMED"
      || (event.type === "SCENARIO_ENDED" && (event.payload.source === "instructor" || event.payload.reason === "ended-by-instructor"))
      || (event.type === "CHANNEL_FAULT_INJECTED" && event.payload.source === "instructor")
      || (event.type === "CHANNEL_RESTORED" && event.payload.source === "instructor")
      || (event.type === "STATE_CHANGED" && event.payload.source === "physics")
      || (event.type === "RULE_TRIGGERED" && event.payload.source !== "physics" && ["zone-entered", "object-collision"].includes(String(event.payload.trigger)));
  }

  private applyReplayInput(event: RecordedEvent): void {
    const payload = event.payload;
    switch (event.type) {
      case "DECISION_SUBMITTED":
        this.submitDecision({ roleId: String(payload.roleId), decisionId: String(payload.decisionId), optionId: String(payload.optionId), rationale: String(payload.rationale), ...(typeof payload.confidence === "number" ? { confidence: payload.confidence } : {}) });
        break;
      case "TEXT_MESSAGE_QUEUED": this.sendTextMessage(String(payload.senderRole), String(payload.channelId), String(payload.content)); break;
      case "SCENARIO_PAUSED": this.pause(); break;
      case "SCENARIO_RESUMED": this.resume(); break;
      case "SCENARIO_ENDED": this.endExercise(String(payload.reason)); break;
      case "CHANNEL_FAULT_INJECTED":
        this.injectChannelFault(String(payload.channelId), payload.fault as CommunicationFault, {
          ...(typeof payload.delayMs === "number" ? { delayMs: payload.delayMs } : {}),
          ...(typeof payload.durationSeconds === "number" ? { durationSeconds: payload.durationSeconds } : {})
        });
        break;
      case "CHANNEL_RESTORED": this.restoreChannel(String(payload.channelId)); break;
      case "STATE_CHANGED": this.moveObject(String(payload.objectId), payload.position as { x: number; y: number; z: number }, payload.velocity as { x: number; y: number; z: number }); break;
      case "RULE_TRIGGERED":
        if (payload.trigger === "zone-entered") this.triggerZoneEntered(String(payload.roleId), String(payload.objectId));
        else this.triggerObjectCollision(String(payload.objectId), String(payload.otherObjectId));
        break;
    }
  }

  triggerZoneEntered(roleId: string, objectId: string): void {
    this.assertRole(roleId);
    this.assertObject(objectId);
    const triggerEvent = this.append("RULE_TRIGGERED", "ground-truth", { trigger: "zone-entered", roleId, objectId, source: "interaction" });
    this.runRules({ type: "zone-entered", roleId, objectId }, triggerEvent.id);
  }

  triggerObjectCollision(objectId: string, otherObjectId: string): void {
    this.assertObject(objectId);
    this.assertObject(otherObjectId);
    const triggerEvent = this.append("RULE_TRIGGERED", "ground-truth", { trigger: "object-collision", objectId, otherObjectId, source: "interaction" });
    this.runRules({ type: "object-collision", objectId, otherObjectId }, triggerEvent.id);
  }

  sendTextMessage(roleId: string, channelId: string, content: string): void {
    if (this.clock.state !== "running") throw new Error("Text messages require a running exercise.");
    this.assertRole(roleId);
    this.assertChannel(channelId);
    const trimmed = content.trim();
    if (!trimmed) throw new Error("A text message cannot be empty.");
    if (trimmed.length > 500) throw new Error("Text messages are limited to 500 characters.");
    const channel = this.channelsById.get(channelId);
    if (!channel?.participants.includes(roleId) || channel.status !== "active") throw new Error(`Role ${roleId} cannot use channel ${channelId}.`);
    const messageId = `text-${this.nextTextNumber++}`;
    const sent = this.append("TEXT_MESSAGE_QUEUED", "ground-truth", { messageId, senderRole: roleId, channelId, content: trimmed, generatedAtSeconds: this.clock.timeSeconds, targetRoles: channel.participants });
    const fault = this.selectFault(this.activeFaults.get(channelId) ?? []);
    if (fault?.fault === "dropout" || fault?.fault === "outage") {
      this.append("TEXT_MESSAGE_DROPPED", "ground-truth", { messageId, senderRole: roleId, channelId, content: trimmed, reason: fault.fault }, undefined, sent.id);
      return;
    }
    const message: PendingTextMessage = {
      id: messageId, senderRole: roleId, channelId, content: trimmed, targetRoles: [...channel.participants],
      generatedAtSeconds: this.clock.timeSeconds,
      deliverAtSeconds: this.clock.timeSeconds + (fault?.fault === "delay" ? fault.delayMs ?? 0 : 0) / 1000,
      causedByEventId: sent.id
    };
    if (message.deliverAtSeconds > this.clock.timeSeconds) this.pendingTextMessages.push(message);
    else this.deliverTextMessage(message);
  }

  private deliverTextMessage(message: PendingTextMessage): void {
    const fault = this.selectFault(this.activeFaults.get(message.channelId) ?? []);
    if (fault?.fault === "dropout" || fault?.fault === "outage") {
      this.append("TEXT_MESSAGE_DROPPED", "ground-truth", { messageId: message.id, senderRole: message.senderRole, channelId: message.channelId, content: message.content, reason: "channel-failed-before-delivery" }, undefined, message.causedByEventId);
      return;
    }
    for (const recipientRoleId of message.targetRoles) {
      this.append("TEXT_MESSAGE_SENT", "role", { messageId: message.id, senderRole: message.senderRole, channelId: message.channelId, content: message.content, generatedAtSeconds: message.generatedAtSeconds, receivedAtSeconds: this.clock.timeSeconds, status: "delivered" }, recipientRoleId, message.causedByEventId);
    }
  }

  endExercise(reason = "ended-by-instructor"): void {
    this.end(reason, "instructor");
  }

  moveObject(objectId: string, position: { x: number; y: number; z: number }, velocity?: { x: number; y: number; z: number }): void {
    this.assertObject(objectId);
    const body = this.physicsWorld.setPose(objectId, position, velocity);
    this.append("STATE_CHANGED", "ground-truth", { objectId, position: body.position, velocity: body.velocity, source: "physics" });
    this.processPhysicsContacts();
  }

  getChannelHealth(roleId: string): ChannelHealth[] {
    this.assertRole(roleId);
    return this.channelHealthSnapshot(roleId);
  }

  getAllChannelHealth(): ChannelHealth[] {
    return this.channelHealthSnapshot();
  }

  private channelHealthSnapshot(roleId?: string): ChannelHealth[] {
    return [...this.channelsById.values()]
      .filter((channel) => roleId === undefined || channel.participants.includes(roleId))
      .map((channel) => {
        const fault = this.selectFault(this.activeFaults.get(channel.id) ?? []);
        if (channel.status !== "active") {
          return {
            channelId: channel.id,
            name: channel.name,
            status: "offline",
            latencyMs: channel.baseLatencyMs
          } satisfies ChannelHealth;
        }
        if (!fault) {
          return {
            channelId: channel.id,
            name: channel.name,
            status: "active",
            latencyMs: channel.baseLatencyMs
          } satisfies ChannelHealth;
        }

        const offline = fault.fault === "outage" || fault.fault === "dropout";
        return {
          channelId: channel.id,
          name: channel.name,
          status: offline ? "offline" : "degraded",
          latencyMs: Math.max(channel.baseLatencyMs, fault.delayMs ?? channel.baseLatencyMs),
          fault: fault.fault
        } satisfies ChannelHealth;
      });
  }

  getGroundTruthSnapshot(): GroundTruthSnapshot {
    return {
      scenarioId: this.scenario.id,
      scenarioVersion: this.scenario.version,
      simulationTimeSeconds: this.clock.timeSeconds,
      scenario: structuredClone(this.scenario),
      activeChannelFaults: [...this.activeFaults.values()].flat().map((fault) => structuredClone(fault)),
      objectStates: Object.fromEntries([...this.objectStates.entries()].map(([id, state]) => [id, structuredClone(state)])),
      physicsBodies: Object.fromEntries(this.physicsWorld.snapshot().bodies.map((body) => [body.objectId, { position: body.position, velocity: body.velocity }])),
      decisions: structuredClone(this.decisions)
    };
  }

  getSnapshot(includeDecisionSnapshots = true): SimulationEngineSnapshot {
    return structuredClone({
      scenarioId: this.scenario.id,
      scenarioVersion: this.scenario.version,
      clockTimeSeconds: this.clock.timeSeconds,
      clockState: this.clock.state,
      nextScenarioEventIndex: this.nextScenarioEventIndex,
      nextFaultNumber: this.nextFaultNumber,
      ended: this.ended,
      activeFaults: [...this.activeFaults.entries()],
      pendingDeliveries: this.pendingDeliveries,
      activeDecisions: [...this.activeDecisions.values()],
      decisions: this.decisions,
      objectStates: Object.fromEntries(this.objectStates),
      objectiveStates: Object.fromEntries(this.objectiveStates),
      executedRules: [...this.executedRules],
      evaluatedTimeRules: [...this.evaluatedTimeRules],
      perceptions: Object.fromEntries([...this.perceptions.entries()].map(([roleId, reports]) => [roleId, [...reports.values()]])),
      events: this.eventLog.all(),
      physicsWorld: this.physicsWorld.snapshot(),
      pendingTextMessages: this.pendingTextMessages,
      nextTextNumber: this.nextTextNumber,
      ...(includeDecisionSnapshots ? { decisionSnapshots: Object.fromEntries(this.decisionSnapshots.entries()) } : {})
    });
  }

  restore(snapshot: SimulationEngineSnapshot): void {
    if (snapshot.scenarioId !== this.scenario.id || snapshot.scenarioVersion !== this.scenario.version) {
      throw new Error("Engine snapshot does not match the scenario version.");
    }

    this.clock.restore(snapshot.clockTimeSeconds, snapshot.clockState);
    this.nextScenarioEventIndex = snapshot.nextScenarioEventIndex;
    this.nextFaultNumber = snapshot.nextFaultNumber;
    this.ended = snapshot.ended;
    this.activeFaults.clear();
    for (const [channelId, faults] of snapshot.activeFaults) this.activeFaults.set(channelId, structuredClone(faults));
    this.pendingDeliveries.splice(0, this.pendingDeliveries.length, ...structuredClone(snapshot.pendingDeliveries));
    this.pendingTextMessages.splice(0, this.pendingTextMessages.length, ...structuredClone(snapshot.pendingTextMessages ?? []));
    this.nextTextNumber = snapshot.nextTextNumber ?? 1;
    this.decisionSnapshots.clear();
    for (const [decisionId, decisionSnapshot] of Object.entries(snapshot.decisionSnapshots ?? {})) this.decisionSnapshots.set(decisionId, structuredClone(decisionSnapshot));
    this.activeDecisions.clear();
    for (const decision of snapshot.activeDecisions) this.activeDecisions.set(decision.decisionId, structuredClone(decision));
    this.decisions.splice(0, this.decisions.length, ...structuredClone(snapshot.decisions));
    this.objectStates.clear();
    for (const [objectId, state] of Object.entries(snapshot.objectStates)) this.objectStates.set(objectId, structuredClone(state));
    this.objectiveStates.clear();
    for (const [objectiveId, state] of Object.entries(snapshot.objectiveStates)) this.objectiveStates.set(objectiveId, state);
    this.executedRules.clear();
    snapshot.executedRules.forEach((ruleId) => this.executedRules.add(ruleId));
    this.evaluatedTimeRules.clear();
    snapshot.evaluatedTimeRules.forEach((ruleKey) => this.evaluatedTimeRules.add(ruleKey));
    this.perceptions.forEach((reports, roleId) => {
      reports.clear();
      for (const report of snapshot.perceptions[roleId] ?? []) reports.set(report.reportId, structuredClone(report));
    });
    this.eventLog.restore(snapshot.events);
    if (snapshot.physicsWorld) this.physicsWorld.restore(snapshot.physicsWorld);
  }

  submitDecision(input: SubmitDecisionInput): DecisionRecord {
    this.assertRole(input.roleId);
    const decision = this.scenario.decisions.find((candidate) => candidate.id === input.decisionId);
    if (!decision) throw new Error(`Unknown decision ${input.decisionId}.`);

    const activeDecision = this.activeDecisions.get(input.decisionId);
    if (!activeDecision || !activeDecision.roleIds.includes(input.roleId)) {
      throw new Error(`Decision ${input.decisionId} is not active for ${input.roleId}.`);
    }
    if (!decision.options.some((option) => option.id === input.optionId)) {
      throw new Error(`Unknown option ${input.optionId} for decision ${input.decisionId}.`);
    }
    if (decision.requireRationale && !input.rationale.trim()) {
      throw new Error(`Decision ${input.decisionId} requires a rationale.`);
    }
    if (decision.requireConfidence && (input.confidence === undefined || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)) {
      throw new Error(`Decision ${input.decisionId} requires confidence between 0 and 1.`);
    }

    this.decisionSnapshots.set(input.decisionId, this.getSnapshot(false));
    const record: DecisionRecord = {
      id: `decision-record-${this.decisions.length + 1}`,
      decisionId: input.decisionId,
      roleId: input.roleId,
      optionId: input.optionId,
      rationale: input.rationale,
      submittedAtSeconds: this.clock.timeSeconds,
      perceptionSnapshot: this.getPerception(input.roleId),
      ...(input.confidence === undefined ? {} : { confidence: input.confidence })
    };

    this.decisions.push(structuredClone(record));
    this.activeDecisions.delete(input.decisionId);
    const decisionEvent = this.append("DECISION_SUBMITTED", "ground-truth", {
      decisionId: input.decisionId,
      roleId: input.roleId,
      optionId: input.optionId,
      rationale: input.rationale,
      confidence: input.confidence,
      perceptionSnapshot: record.perceptionSnapshot
    });
    this.scoreDecision(record, decision, decisionEvent.id);
    this.runRules({ type: "decision-submitted", decisionId: input.decisionId, roleId: input.roleId, optionId: input.optionId }, decisionEvent.id);

    return structuredClone(record);
  }

  allEvents() {
    return this.eventLog.all();
  }

  private nextInternalTime(targetTime: number): number {
    const candidates: number[] = [targetTime];
    const nextScenarioEvent = this.events[this.nextScenarioEventIndex];
    if (nextScenarioEvent && nextScenarioEvent.atSeconds >= this.clock.timeSeconds) candidates.push(nextScenarioEvent.atSeconds);

    this.pendingDeliveries.forEach((delivery) => {
      if (delivery.deliverAtSeconds >= this.clock.timeSeconds) candidates.push(delivery.deliverAtSeconds);
    });
    this.pendingTextMessages.forEach((message) => candidates.push(message.deliverAtSeconds));

    this.activeFaults.forEach((faults) => {
      faults.forEach((fault) => {
        if (fault.endsAtSeconds !== undefined && fault.endsAtSeconds >= this.clock.timeSeconds) candidates.push(fault.endsAtSeconds);
      });
    });

    this.activeDecisions.forEach((decision) => {
      if (decision.expiresAtSeconds !== undefined && decision.expiresAtSeconds >= this.clock.timeSeconds) candidates.push(decision.expiresAtSeconds);
    });

    this.scenario.rules.forEach((rule) => {
      if (rule.trigger.type === "time-reached" && rule.trigger.atSeconds > this.clock.timeSeconds) {
        candidates.push(rule.trigger.atSeconds);
      }
    });

    return Math.min(...candidates.filter((candidate) => candidate >= this.clock.timeSeconds));
  }

  private processDueItems(): void {
    if (this.ended) return;
    this.expireFaults();
    if (this.ended) return;
    this.expireDecisions();

    while (this.nextScenarioEventIndex < this.events.length) {
      const event = this.events[this.nextScenarioEventIndex];
      if (!event || event.atSeconds > this.clock.timeSeconds) break;
      this.nextScenarioEventIndex += 1;
      this.applyScenarioEvent(event);
      if (this.ended) return;
    }

    if (!this.ended) this.runTimeRules();
    if (this.ended) return;

    const deliveries = this.pendingDeliveries.filter((delivery) => delivery.deliverAtSeconds <= this.clock.timeSeconds);
    for (const delivery of deliveries) {
      this.pendingDeliveries.splice(this.pendingDeliveries.indexOf(delivery), 1);
      this.deliverPending(delivery);
      if (this.ended) return;
    }
    for (const message of this.pendingTextMessages.filter((candidate) => candidate.deliverAtSeconds <= this.clock.timeSeconds)) {
      this.pendingTextMessages.splice(this.pendingTextMessages.indexOf(message), 1);
      this.deliverTextMessage(message);
    }
  }

  private processPhysics(seconds: number): void {
    this.processPhysicsContacts(this.physicsWorld.step(seconds));
  }

  private processPhysicsContacts(contacts = this.physicsWorld.step(0)): void {
    for (const contact of contacts) {
      if (this.ended) return;
      const triggerEvent = this.append("RULE_TRIGGERED", "ground-truth", {
        trigger: contact.trigger ? "physics-trigger" : "object-collision",
        objectId: contact.objectId,
        otherObjectId: contact.otherObjectId,
        source: "physics"
      });
      this.runRules({ type: "object-collision", objectId: contact.objectId, otherObjectId: contact.otherObjectId }, triggerEvent.id);
      if (this.ended) return;
      if (contact.trigger) {
        // A confirmed contact by a role-owned body enters its trigger zone.
        // Physics provenance prevents replaying this again as a manual input.
        for (const [zoneId, bodyId] of [[contact.objectId, contact.otherObjectId], [contact.otherObjectId, contact.objectId]]) {
          const zone = this.scenario.environment.objects.find((object) => object.id === zoneId);
          const body = this.scenario.environment.objects.find((object) => object.id === bodyId);
          const roleId = body?.properties?.roleId;
          if (!zone?.physics?.trigger || body?.physics?.body === "fixed" || typeof roleId !== "string") continue;
          const entered = this.append("RULE_TRIGGERED", "ground-truth", { trigger: "zone-entered", roleId, objectId: zoneId, source: "physics" }, undefined, triggerEvent.id);
          this.runRules({ type: "zone-entered", objectId: zoneId!, roleId }, entered.id);
          if (this.ended) return;
        }
      }
    }
  }

  private applyScenarioEvent(event: ScenarioEvent): void {
    switch (event.type) {
      case "message":
        this.generateReport(event.reportId);
        break;
      case "channel-fault":
        this.createFault(event.channelId, event.fault, {
          ...(event.delayMs === undefined ? {} : { delayMs: event.delayMs }),
          ...(event.durationSeconds === undefined ? {} : { durationSeconds: event.durationSeconds })
        }, "scenario");
        this.append("CHANNEL_FAULT_INJECTED", "ground-truth", {
          channelId: event.channelId,
          fault: event.fault,
          delayMs: event.delayMs,
          durationSeconds: event.durationSeconds,
          source: "scenario",
          sourceEventId: event.id
        });
        if (event.fault === "dropout" || event.fault === "outage") {
          this.runRules({ type: "channel-disabled", channelId: event.channelId });
        }
        break;
      case "channel-restore":
        this.activeFaults.delete(event.channelId);
        this.append("CHANNEL_RESTORED", "ground-truth", { channelId: event.channelId, source: "scenario", sourceEventId: event.id });
        this.runRules({ type: "channel-restored", channelId: event.channelId });
        break;
      case "state-change":
        this.setObjectState(event.objectId, event.property, event.value);
        this.append("STATE_CHANGED", "ground-truth", {
          objectId: event.objectId,
          property: event.property,
          value: event.value,
          sourceEventId: event.id
        });
        break;
      case "decision-gate":
        this.activateDecision(event.decisionId, event.id);
        break;
      case "instructor-alert":
        this.append("INSTRUCTOR_ALERT", "instructor", {
          message: event.message,
          targetRoles: event.targetRoles,
          sourceEventId: event.id
        });
        break;
      case "objective-update":
        this.objectiveStates.set(event.objectiveId, event.status);
        this.append("STATE_CHANGED", "ground-truth", {
          objectiveId: event.objectiveId,
          status: event.status,
          sourceEventId: event.id
        });
        break;
      case "scenario-end":
        this.end(event.reason ?? "scenario-end event");
        break;
    }
  }

  private generateReport(reportId: string, override?: { forceFault?: CommunicationFault; delayMs?: number; generatedAtSeconds?: number; conflictsWith?: string }): void {
    const report = this.reportsById.get(reportId);
    if (!report) throw new Error(`Unknown report ${reportId}.`);

    const generatedAtSeconds = override?.generatedAtSeconds ?? report.generatedAtSeconds;
    const effectiveReport = { ...report, generatedAtSeconds, ...(override?.conflictsWith === undefined ? {} : { conflictsWith: override.conflictsWith }) };
    const generatedEvent = this.append("REPORT_GENERATED", "ground-truth", {
      reportId: effectiveReport.id,
      sourceRole: effectiveReport.sourceRole,
      channelId: effectiveReport.channelId,
      targetRoles: effectiveReport.targetRoles,
      generatedAtSeconds
    });

    const faults = this.activeFaults.get(effectiveReport.channelId) ?? [];
    for (const roleId of effectiveReport.targetRoles) {
      if (this.ended) return;
      if (this.channelsById.get(effectiveReport.channelId)?.status !== "active") {
        this.dropReport(effectiveReport, roleId, "channel-inactive", generatedEvent.id);
        continue;
      }
      const fault = override?.forceFault ? undefined : this.selectFault(faults);
      const reliabilityDrop = !override?.forceFault && !fault && !this.passesReliability(effectiveReport);
      if (override?.forceFault === "dropout" || override?.forceFault === "outage") {
        this.dropReport(effectiveReport, roleId, "rule-forced-dropout", generatedEvent.id);
      } else if (reliabilityDrop) {
        this.dropReport(effectiveReport, roleId, "reliability-threshold", generatedEvent.id);
      } else if (override?.delayMs !== undefined) {
        this.queueDelayedReport(effectiveReport, roleId, override.delayMs, generatedEvent.id);
      } else if (override?.forceFault || !fault || fault.fault === "conflict" || fault.fault === "stale" || fault.fault === "partial") {
        this.deliverReport(effectiveReport, roleId, this.statusForFaultKind(override?.forceFault) ?? this.statusForFault(fault), generatedEvent.id);
      } else if (fault.fault === "dropout" || fault.fault === "outage") {
        this.dropReport(effectiveReport, roleId, "communication-fault", generatedEvent.id);
      } else if (fault.fault === "delay") {
        this.queueDelayedReport(effectiveReport, roleId, fault.delayMs ?? 0, generatedEvent.id);
      }
    }
  }

  private queueDelayedReport(report: ReportTemplate, roleId: string, delayMs: number, causedByEventId: string): void {
    const pending: PendingDelivery = {
      id: `pending-${this.pendingDeliveries.length + 1}`,
      reportId: report.id,
      roleId,
      channelId: report.channelId,
      deliverAtSeconds: this.clock.timeSeconds + delayMs / 1000,
      queuedAtSeconds: this.clock.timeSeconds,
      generatedAtSeconds: report.generatedAtSeconds
    };
    this.pendingDeliveries.push(pending);
    this.append("REPORT_DELAYED", "role", {
      reportId: report.id,
      channelId: report.channelId,
      generatedAtSeconds: report.generatedAtSeconds,
      queuedAtSeconds: pending.queuedAtSeconds,
      deliverAtSeconds: pending.deliverAtSeconds,
      delayMs
    }, roleId, causedByEventId);
  }

  private deliverPending(delivery: PendingDelivery): void {
    const report = this.reportsById.get(delivery.reportId);
    if (!report) return;
    if (this.channelsById.get(delivery.channelId)?.status !== "active") {
      this.dropReport(report, delivery.roleId, "channel-inactive-before-delivery");
      return;
    }
    const fault = this.selectFault(this.activeFaults.get(delivery.channelId) ?? []);
    if (fault?.fault === "dropout" || fault?.fault === "outage") {
      this.dropReport(report, delivery.roleId, "channel-failed-before-delivery");
      return;
    }
    const effectiveReport = delivery.generatedAtSeconds === report.generatedAtSeconds
      ? report
      : { ...report, generatedAtSeconds: delivery.generatedAtSeconds };
    this.deliverReport(effectiveReport, delivery.roleId, this.statusForFault(fault), undefined, delivery.queuedAtSeconds);
  }

  private deliverReport(
    report: ReportTemplate,
    roleId: string,
    status: DeliveryStatus,
    causedByEventId?: string,
    queuedAtSeconds?: number
  ): void {
    const receivedAtSeconds = this.clock.timeSeconds;
    const delayMs = Math.max(0, Math.round((receivedAtSeconds - report.generatedAtSeconds) * 1000));
    const observed: ObservedReport = {
      reportId: report.id,
      sourceRole: report.sourceRole,
      channelId: report.channelId,
      domain: report.domain,
      priority: report.priority,
      content: report.content,
      generatedAtSeconds: report.generatedAtSeconds,
      receivedAtSeconds,
      delayMs,
      status,
      reliability: report.reliability,
      ...(report.conflictsWith === undefined ? {} : { conflictsWith: report.conflictsWith })
    };
    this.perceptions.get(roleId)?.set(report.id, observed);
    this.append("REPORT_DELIVERED", "role", {
      reportId: report.id,
      channelId: report.channelId,
      generatedAtSeconds: report.generatedAtSeconds,
      receivedAtSeconds,
      delayMs,
      status,
      queuedAtSeconds,
      observedReport: structuredClone(observed)
    }, roleId, causedByEventId);
    this.runRules({ type: "message-received", reportId: report.id, roleId }, this.eventLog.latest()?.id);
  }

  private dropReport(report: ReportTemplate, roleId: string, reason: string, causedByEventId?: string): void {
    this.append("REPORT_DROPPED", "role", {
      reportId: report.id,
      channelId: report.channelId,
      generatedAtSeconds: report.generatedAtSeconds,
      reason
    }, roleId, causedByEventId);
    this.runRules({ type: "message-ignored", reportId: report.id, roleId }, this.eventLog.latest()?.id);
  }

  private activateDecision(decisionId: string, causedByEventId?: string): void {
    const decision = this.scenario.decisions.find((candidate) => candidate.id === decisionId);
    if (!decision) throw new Error(`Unknown decision ${decisionId}.`);
    const active: ActiveDecision = {
      decisionId,
      roleIds: [...decision.targetRoles],
      activatedAtSeconds: this.clock.timeSeconds,
      ...(decision.timeLimitSeconds === undefined ? {} : { expiresAtSeconds: this.clock.timeSeconds + decision.timeLimitSeconds })
    };
    this.activeDecisions.set(decisionId, active);
    for (const roleId of decision.targetRoles) {
      this.append("DECISION_REQUIRED", "role", {
        decisionId,
        title: decision.title,
        options: decision.options,
        activatedAtSeconds: this.clock.timeSeconds,
        expiresAtSeconds: active.expiresAtSeconds,
        sourceEventId: causedByEventId
      }, roleId);
    }
  }

  private expireDecisions(): void {
    for (const active of this.activeDecisions.values()) {
      if (active.expiresAtSeconds !== undefined && active.expiresAtSeconds <= this.clock.timeSeconds) {
        this.activeDecisions.delete(active.decisionId);
        this.append("DECISION_EXPIRED", "ground-truth", {
          decisionId: active.decisionId,
          expiredAtSeconds: this.clock.timeSeconds
        });
      }
    }
  }

  private createFault(channelId: string, fault: CommunicationFault, options: InjectFaultOptions, source: "scenario" | "instructor"): ActiveChannelFault {
    const activeFault: ActiveChannelFault = {
      id: `fault-${this.nextFaultNumber++}`,
      channelId,
      fault,
      startedAtSeconds: this.clock.timeSeconds,
      ...(options.durationSeconds === undefined ? {} : { endsAtSeconds: this.clock.timeSeconds + options.durationSeconds }),
      ...(options.delayMs === undefined ? {} : { delayMs: options.delayMs })
    };
    const faults = this.activeFaults.get(channelId) ?? [];
    faults.push(activeFault);
    this.activeFaults.set(channelId, faults);
    if (source === "instructor") this.processDueItems();
    return activeFault;
  }

  private expireFaults(): void {
    for (const [channelId, faults] of this.activeFaults.entries()) {
      if (this.ended) return;
      const remaining = faults.filter((fault) => fault.endsAtSeconds === undefined || fault.endsAtSeconds > this.clock.timeSeconds);
      if (remaining.length === 0) {
        this.activeFaults.delete(channelId);
      } else if (remaining.length !== faults.length) {
        this.activeFaults.set(channelId, remaining);
      }
      if (remaining.length !== faults.length) {
        this.append("CHANNEL_RESTORED", "ground-truth", {
          channelId,
          source: "duration-expired"
        });
        if (remaining.length === 0) this.runRules({ type: "channel-restored", channelId });
      }
    }
  }

  private selectFault(faults: ActiveChannelFault[]): ActiveChannelFault | undefined {
    const priority: CommunicationFault[] = ["outage", "dropout", "delay", "conflict", "stale", "partial"];
    return [...faults].sort((left, right) => priority.indexOf(left.fault) - priority.indexOf(right.fault))[0];
  }

  private statusForFault(fault: ActiveChannelFault | undefined): DeliveryStatus {
    if (!fault) return "delivered";
    if (fault.fault === "conflict") return "conflicting";
    if (fault.fault === "stale") return "stale";
    if (fault.fault === "partial") return "partial";
    return "delivered";
  }

  private statusForFaultKind(fault: CommunicationFault | undefined): DeliveryStatus | undefined {
    if (fault === "conflict") return "conflicting";
    if (fault === "stale") return "stale";
    if (fault === "partial") return "partial";
    return fault === undefined ? undefined : "delivered";
  }

  private setObjectState(objectId: string, property: string, value: unknown): void {
    const state = this.objectStates.get(objectId);
    if (!state) throw new Error(`Unknown object ${objectId}.`);
    state[property] = structuredClone(value);
  }

  private passesReliability(report: ReportTemplate): boolean {
    if (report.reliability >= 1) return true;
    let hash = this.scenario.metadata.seed >>> 0;
    for (const character of `simulation:${report.id}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
    const draw = (hash % 10000) / 10000;
    return draw < report.reliability;
  }

  private scoreDecision(record: DecisionRecord, decision: ScenarioDefinition["decisions"][number], causedByEventId: string): void {
    const scoreByDimension = this.calculateDecisionScores(record, decision);
    for (const dimension of this.scenario.scoring) {
      const score = scoreByDimension[dimension.id];
      if (!score) continue;
      this.append("SCORE_EVENT", "ground-truth", {
        dimensionId: dimension.id,
        amount: score.amount,
        reason: score.reason
      }, undefined, causedByEventId);
    }
  }

  private calculateDecisionScores(record: Pick<DecisionRecord, "optionId" | "rationale" | "submittedAtSeconds">, decision: ScenarioDefinition["decisions"][number]): Record<string, { amount: number; reason: string }> {
    const rationale = record.rationale.trim();
    const option = decision.options.find((candidate) => candidate.id === record.optionId);
    const hasUncertaintyLanguage = /uncertain|conflict|verify|verification|stale|incomplete|unknown/i.test(rationale);
    const hasCommunicationLanguage = /report|channel|team|coordinate|communicat/i.test(rationale);
    const scoreByDimension: Record<string, { amount: number; reason: string }> = {
      "decision-timeliness": {
        amount: Math.max(0, 1 - record.submittedAtSeconds / Math.max(1, this.scenario.metadata.durationSeconds)),
        reason: `Decision submitted at ${record.submittedAtSeconds}s.`
      },
      "uncertainty-recognition": {
        amount: hasUncertaintyLanguage ? 1 : 0,
        reason: hasUncertaintyLanguage ? "Rationale identifies uncertainty or information quality." : "Rationale does not identify information uncertainty."
      },
      "communication-clarity": {
        amount: hasCommunicationLanguage ? 1 : 0,
        reason: hasCommunicationLanguage ? "Rationale references communication or shared information." : "Rationale does not reference communication or shared information."
      },
      "rationale-quality": {
        amount: Math.min(1, rationale.length / 140),
        reason: `Rationale length: ${rationale.length} characters.`
      },
      "backup-channel-use": {
        amount: /backup/i.test(`${record.optionId} ${option?.label ?? ""}`) ? 1 : 0,
        reason: /backup/i.test(`${record.optionId} ${option?.label ?? ""}`) ? "Decision selected a backup-channel option." : "Decision did not select a backup-channel option."
      }
    };

    return scoreByDimension;
  }

  private runRules(trigger: RuleTrigger, causedByEventId?: string): void {
    if (this.ended) return;
    const previousCause = this.activeRuleCauseEventId;
    this.activeRuleCauseEventId = causedByEventId;
    try {
      for (const rule of this.scenario.rules) {
        if (this.ended) return;
        // Authored action chains can emit their own triggers. Do not recursively re-enter an active rule.
        if (this.executingRules.has(rule.id)) continue;
        if (rule.once && this.executedRules.has(rule.id)) continue;
        if (trigger.type === "time-reached" && this.evaluatedTimeRules.has(`${rule.id}@${trigger.atSeconds}`)) continue;
        if (!this.triggerMatches(rule.trigger, trigger)) continue;
        if (!rule.conditions.every((condition) => this.conditionMatches(condition, trigger))) continue;
        if (trigger.type === "time-reached") this.evaluatedTimeRules.add(`${rule.id}@${trigger.atSeconds}`);
        if (rule.once) this.executedRules.add(rule.id);
        this.executingRules.add(rule.id);
        try {
          for (const action of rule.actions) {
            if (this.ended) return;
            this.executeRuleAction(action);
          }
        } finally { this.executingRules.delete(rule.id); }
      }
    } finally {
      this.activeRuleCauseEventId = previousCause;
    }
  }

  private runTimeRules(): void {
    for (const rule of this.scenario.rules) {
      if (rule.trigger.type === "time-reached" && rule.trigger.atSeconds === this.clock.timeSeconds) {
        this.runRules({ type: "time-reached", atSeconds: this.clock.timeSeconds });
      }
    }
  }

  private triggerMatches(expected: RuleTrigger, actual: RuleTrigger): boolean {
    if (expected.type !== actual.type) return false;
    switch (expected.type) {
      case "time-reached":
        return actual.type === "time-reached" && expected.atSeconds === actual.atSeconds;
      case "zone-entered":
        return actual.type === "zone-entered" && expected.objectId === actual.objectId && (expected.roleId === undefined || expected.roleId === actual.roleId);
      case "message-received":
      case "message-ignored":
        return actual.type === expected.type && actual.reportId === expected.reportId && (expected.roleId === undefined || expected.roleId === actual.roleId);
      case "decision-submitted":
        return actual.type === "decision-submitted" && actual.decisionId === expected.decisionId
          && (expected.roleId === undefined || expected.roleId === actual.roleId)
          && (expected.optionId === undefined || expected.optionId === actual.optionId);
      case "channel-disabled":
      case "channel-restored":
        return actual.type === expected.type && actual.channelId === expected.channelId;
      case "object-collision":
        return actual.type === "object-collision" && actual.objectId === expected.objectId && actual.otherObjectId === expected.otherObjectId;
      case "instructor-injection":
        return actual.type === "instructor-injection" && actual.eventType === expected.eventType;
    }
  }

  private conditionMatches(condition: RuleCondition, trigger: RuleTrigger): boolean {
    switch (condition.type) {
      case "role-is":
        return "roleId" in trigger && trigger.roleId === condition.roleId;
      case "object-state":
        return this.objectStates.get(condition.objectId)?.[condition.property] === condition.equals;
      case "channel-state":
        return (this.channelsById.get(condition.channelId)?.status !== "active" || (this.activeFaults.get(condition.channelId)?.length ?? 0) > 0) === (condition.state === "faulted");
      case "report-age": {
        const report = this.reportsById.get(condition.reportId);
        return report !== undefined && this.clock.timeSeconds - report.generatedAtSeconds > condition.greaterThanSeconds;
      }
      case "report-status": {
        const roleId = "roleId" in trigger ? trigger.roleId : undefined;
        if (!roleId) return false;
        return this.latestRoleReportStatus(roleId, condition.reportId) === condition.status;
      }
      case "selected-option":
        return trigger.type === "decision-submitted" && trigger.decisionId === condition.decisionId && trigger.optionId === condition.optionId;
      case "decision-count":
        return this.decisions.length >= condition.greaterThanOrEqual;
      case "objective-state":
        return this.objectiveStates.get(condition.objectiveId) === condition.state;
      case "time-window":
        return this.clock.timeSeconds >= condition.startSeconds && this.clock.timeSeconds <= condition.endSeconds;
    }
  }

  private latestRoleReportStatus(roleId: string, reportId: string): string | undefined {
    let status: string | undefined;
    for (const event of this.eventLog.all()) {
      if (event.roleId !== roleId) continue;
      if (event.type === "REPORT_DELIVERED" && String(event.payload.reportId) === reportId) {
        status = String(event.payload.status ?? "delivered");
      } else if (event.type === "REPORT_DELAYED" && String(event.payload.reportId) === reportId) {
        status = "delayed";
      } else if (event.type === "REPORT_DROPPED" && String(event.payload.reportId) === reportId) {
        status = "dropped";
      }
    }
    return status;
  }

  private executeRuleAction(action: RuleAction): void {
    switch (action.type) {
      case "send-report":
        this.generateReport(action.reportId, {
          generatedAtSeconds: this.clock.timeSeconds,
          ...(action.delayMs === undefined ? {} : { delayMs: action.delayMs })
        });
        break;
      case "delay-report":
        this.generateReport(action.reportId, { generatedAtSeconds: this.clock.timeSeconds, delayMs: action.delayMs });
        break;
      case "drop-report":
        this.generateReport(action.reportId, { generatedAtSeconds: this.clock.timeSeconds, forceFault: "dropout" });
        break;
      case "create-conflict":
        this.generateReport(action.reportId, { generatedAtSeconds: this.clock.timeSeconds, forceFault: "conflict", conflictsWith: action.conflictsWith });
        break;
      case "disable-channel":
        this.createFault(action.channelId, action.fault, {
          ...(action.durationSeconds === undefined ? {} : { durationSeconds: action.durationSeconds }),
          ...(action.delayMs === undefined ? {} : { delayMs: action.delayMs })
        }, "scenario");
        this.append("CHANNEL_FAULT_INJECTED", "ground-truth", { channelId: action.channelId, fault: action.fault, source: "rule" });
        if (action.fault === "dropout" || action.fault === "outage") this.runRules({ type: "channel-disabled", channelId: action.channelId });
        break;
      case "restore-channel":
        this.activeFaults.delete(action.channelId);
        this.append("CHANNEL_RESTORED", "ground-truth", { channelId: action.channelId, source: "rule" });
        this.runRules({ type: "channel-restored", channelId: action.channelId });
        break;
      case "activate-decision":
        this.activateDecision(action.decisionId);
        break;
      case "change-object-state":
        this.setObjectState(action.objectId, action.property, action.value);
        this.append("STATE_CHANGED", "ground-truth", { objectId: action.objectId, property: action.property, value: action.value, source: "rule" }, undefined, this.activeRuleCauseEventId);
        break;
      case "send-instructor-alert":
        this.append("INSTRUCTOR_ALERT", "instructor", { message: action.message, source: "rule" });
        break;
      case "add-score-event":
        this.append("SCORE_EVENT", "ground-truth", { dimensionId: action.dimensionId, amount: action.amount, reason: action.reason }, undefined, this.activeRuleCauseEventId);
        break;
      case "end-exercise":
        this.end(action.reason, "rule");
        break;
    }
  }

  private append(
    type: Parameters<EventLog["append"]>[0]["type"],
    visibility: Parameters<EventLog["append"]>[0]["visibility"],
    payload: Record<string, unknown>,
    roleId?: string,
    causedByEventId?: string
  ) {
    return this.eventLog.append({
      type,
      visibility,
      payload,
      simulationTimeSeconds: this.clock.timeSeconds,
      ...(roleId === undefined ? {} : { roleId }),
      ...(causedByEventId === undefined ? {} : { causedByEventId })
    });
  }

  private assertRole(roleId: string): void {
    if (!this.perceptions.has(roleId)) throw new Error(`Unknown role ${roleId}.`);
  }

  private assertChannel(channelId: string): void {
    if (!this.channelsById.has(channelId)) throw new Error(`Unknown channel ${channelId}.`);
  }

  private assertObject(objectId: string): void {
    if (!this.objectStates.has(objectId)) throw new Error(`Unknown object ${objectId}.`);
  }

  private end(reason: string, source: "scenario" | "instructor" | "rule" = "scenario"): void {
    if (this.ended) return;
    this.ended = true;
    this.append("SCENARIO_ENDED", "ground-truth", { reason, source });
    this.clock.end();
  }
}
