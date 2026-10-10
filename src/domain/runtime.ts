import type { CommunicationFault, ReportTemplate, ScenarioDefinition, Vector3 } from "./scenario.js";

export type RuntimeEventType =
  | "SCENARIO_STARTED"
  | "SCENARIO_PAUSED"
  | "SCENARIO_RESUMED"
  | "SCENARIO_ENDED"
  | "CHANNEL_FAULT_INJECTED"
  | "CHANNEL_RESTORED"
  | "REPORT_GENERATED"
  | "REPORT_DELAYED"
  | "REPORT_DROPPED"
  | "REPORT_DELIVERED"
  | "DECISION_REQUIRED"
  | "DECISION_SUBMITTED"
  | "DECISION_EXPIRED"
  | "STATE_CHANGED"
  | "SCORE_EVENT"
  | "RULE_TRIGGERED"
  | "TEXT_MESSAGE_SENT"
  | "TEXT_MESSAGE_QUEUED"
  | "TEXT_MESSAGE_DROPPED"
  | "INSTRUCTOR_ALERT";

export type RuntimeVisibility = "ground-truth" | "role" | "instructor";

export interface RecordedEvent {
  id: string;
  sequence: number;
  type: RuntimeEventType;
  simulationTimeSeconds: number;
  visibility: RuntimeVisibility;
  roleId?: string;
  causedByEventId?: string;
  payload: Record<string, unknown>;
}

export type DeliveryStatus = "delivered" | "delayed" | "dropped" | "conflicting" | "stale" | "partial";

export interface ObservedReport {
  reportId: string;
  sourceRole: string;
  channelId: string;
  domain: ReportTemplate["domain"];
  priority: ReportTemplate["priority"];
  content: string;
  generatedAtSeconds: number;
  receivedAtSeconds: number;
  delayMs: number;
  status: DeliveryStatus;
  reliability: number;
  conflictsWith?: string;
}

export interface PerceptionSnapshot {
  roleId: string;
  reports: ObservedReport[];
  activeDecisionIds: string[];
  capturedAtSeconds: number;
  textMessages?: Array<{
    messageId: string;
    senderRole: string;
    channelId: string;
    content: string;
    generatedAtSeconds: number;
    receivedAtSeconds: number;
  }>;
}

export interface ChannelHealth {
  channelId: string;
  name: string;
  status: "active" | "degraded" | "offline";
  latencyMs: number;
  fault?: CommunicationFault;
}

export interface DecisionRecord {
  id: string;
  decisionId: string;
  roleId: string;
  optionId: string;
  rationale: string;
  confidence?: number;
  submittedAtSeconds: number;
  perceptionSnapshot: PerceptionSnapshot;
}

export interface ScoreEventRecord {
  id: string;
  dimensionId: string;
  amount: number;
  reason: string;
  simulationTimeSeconds: number;
  causedByEventId?: string;
}

export interface ScoreDimensionSummary {
  dimensionId: string;
  name: string;
  weight: number;
  raw: number;
  weighted: number;
  events: ScoreEventRecord[];
}

export interface ScoreSnapshot {
  total: number;
  dimensions: ScoreDimensionSummary[];
}

export interface RoleAarSummary {
  roleId: string;
  reportCount: number;
  deliveredReportCount: number;
  decisionCount: number;
  decisions: DecisionRecord[];
  finalPerception: PerceptionSnapshot;
}

export interface AfterActionReview {
  scenarioId: string;
  scenarioVersion: number;
  simulationTimeSeconds: number;
  events: RecordedEvent[];
  decisions: DecisionRecord[];
  score: ScoreSnapshot;
  roles: RoleAarSummary[];
  reportTemplates?: ReportTemplate[];
}

export interface CounterfactualComparison {
  decisionId: string;
  roleId: string;
  actualOptionId: string;
  alternateOptionId: string;
  actualScore: number;
  alternateScore: number;
  delta: number;
  actualFutureScore?: number;
  alternateFutureScore?: number;
  futureDelta?: number;
  actualFutureEventCount?: number;
  alternateFutureEventCount?: number;
  replayMode: "branch" | "score-only";
  assumptions: string[];
  actualBranch?: CounterfactualBranch;
  alternateBranch?: CounterfactualBranch;
  dimensions: Array<{
    dimensionId: string;
    actual: number;
    alternate: number;
    delta: number;
    reason: string;
  }>;
}

export interface CounterfactualBranch {
  fromSeconds: number;
  throughSeconds: number;
  ended: boolean;
  score: ScoreSnapshot;
  events: RecordedEvent[];
  objectStates: Record<string, Record<string, unknown>>;
  perceptions: PerceptionSnapshot[];
  skippedInputs: Array<{ sequence: number; type: RuntimeEventType; reason: string }>;
}

export interface GroundTruthSnapshot {
  scenarioId: string;
  scenarioVersion: number;
  simulationTimeSeconds: number;
  scenario: ScenarioDefinition;
  activeChannelFaults: Array<{
    id: string;
    channelId: string;
    fault: string;
    startedAtSeconds: number;
    endsAtSeconds?: number;
    delayMs?: number;
  }>;
  objectStates: Record<string, Record<string, unknown>>;
  physicsBodies: Record<string, { position: Vector3; velocity: Vector3 }>;
  decisions: DecisionRecord[];
}
