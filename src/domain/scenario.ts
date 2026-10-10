export const SCENARIO_SCHEMA_VERSION = "1.0" as const;

export type ScenarioStatus = "draft" | "validated" | "published" | "archived";
export type ScenarioCategory = "military" | "disaster" | "synthetic";
export type RoleKind = "commander" | "operations" | "communications-ew" | "custom";

export type ScenarioObjectType =
  | "zone"
  | "location"
  | "route"
  | "checkpoint"
  | "hazard"
  | "objective-area"
  | "spawn-point"
  | "team"
  | "unit"
  | "sensor"
  | "observation-point"
  | "resource"
  | "command-post"
  | "channel-node"
  | "report-source"
  | "relay-node";

export type PhysicsBody = "fixed" | "kinematic" | "dynamic";
export type ColliderType = "box" | "sphere" | "capsule" | "none";

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface ObjectTransform {
  position: Vector3;
  rotationY: number;
  scale: Vector3;
}

export interface PhysicsProperties {
  body: PhysicsBody;
  collider: ColliderType;
  trigger: boolean;
  mass?: number;
  restitution?: number;
}

export interface ScenarioObject {
  id: string;
  type: ScenarioObjectType;
  name: string;
  transform: ObjectTransform;
  properties?: Record<string, unknown>;
  physics?: PhysicsProperties;
}

export interface ScenarioRole {
  id: string;
  name: string;
  kind: RoleKind;
  briefing: string;
  permissions: string[];
  visibility: {
    objectIds: string[];
    reportIds: string[];
  };
}

export type ChannelKind = "team" | "broadcast" | "private" | "voice";

export interface CommunicationChannel {
  id: string;
  name: string;
  kind: ChannelKind;
  participants: string[];
  baseLatencyMs: number;
  reliability: number;
  backupChannelId?: string;
  status: "active" | "inactive";
}

export type ReportDomain = "land" | "air" | "cyber" | "ew" | "logistics" | "medical" | "general";
export type ReportPriority = "routine" | "priority" | "critical";

export interface ReportTemplate {
  id: string;
  sourceRole: string;
  channelId: string;
  targetRoles: string[];
  domain: ReportDomain;
  priority: ReportPriority;
  generatedAtSeconds: number;
  content: string;
  freshnessSeconds: number;
  reliability: number;
  conflictsWith?: string;
}

export type CommunicationFault = "delay" | "dropout" | "conflict" | "stale" | "partial" | "outage";

export interface MessageScenarioEvent {
  id: string;
  type: "message";
  atSeconds: number;
  reportId: string;
}

export interface ChannelFaultScenarioEvent {
  id: string;
  type: "channel-fault";
  atSeconds: number;
  channelId: string;
  fault: CommunicationFault;
  delayMs?: number;
  durationSeconds?: number;
}

export interface ChannelRestoreScenarioEvent {
  id: string;
  type: "channel-restore";
  atSeconds: number;
  channelId: string;
}

export interface StateChangeScenarioEvent {
  id: string;
  type: "state-change";
  atSeconds: number;
  objectId: string;
  property: string;
  value: unknown;
}

export interface DecisionGateScenarioEvent {
  id: string;
  type: "decision-gate";
  atSeconds: number;
  decisionId: string;
}

export interface InstructorAlertScenarioEvent {
  id: string;
  type: "instructor-alert";
  atSeconds: number;
  message: string;
  targetRoles?: string[];
}

export interface ObjectiveUpdateScenarioEvent {
  id: string;
  type: "objective-update";
  atSeconds: number;
  objectiveId: string;
  status: "pending" | "active" | "completed" | "failed";
}

export interface ScenarioEndEvent {
  id: string;
  type: "scenario-end";
  atSeconds: number;
  reason?: string;
}

export type ScenarioEvent =
  | MessageScenarioEvent
  | ChannelFaultScenarioEvent
  | ChannelRestoreScenarioEvent
  | StateChangeScenarioEvent
  | DecisionGateScenarioEvent
  | InstructorAlertScenarioEvent
  | ObjectiveUpdateScenarioEvent
  | ScenarioEndEvent;

export type RuleTrigger =
  | { type: "time-reached"; atSeconds: number }
  | { type: "zone-entered"; objectId: string; roleId?: string }
  | { type: "message-received"; reportId: string; roleId?: string }
  | { type: "message-ignored"; reportId: string; roleId?: string }
  | { type: "decision-submitted"; decisionId: string; roleId?: string; optionId?: string }
  | { type: "channel-disabled"; channelId: string }
  | { type: "channel-restored"; channelId: string }
  | { type: "object-collision"; objectId: string; otherObjectId: string }
  | { type: "instructor-injection"; eventType: string };

export type RuleCondition =
  | { type: "role-is"; roleId: string }
  | { type: "object-state"; objectId: string; property: string; equals: unknown }
  | { type: "channel-state"; channelId: string; state: "active" | "faulted" }
  | { type: "report-age"; reportId: string; greaterThanSeconds: number }
  | { type: "report-status"; reportId: string; status: string }
  | { type: "selected-option"; decisionId: string; optionId: string }
  | { type: "decision-count"; greaterThanOrEqual: number }
  | { type: "objective-state"; objectiveId: string; state: string }
  | { type: "time-window"; startSeconds: number; endSeconds: number };

export type RuleAction =
  | { type: "send-report"; reportId: string; delayMs?: number }
  | { type: "delay-report"; reportId: string; delayMs: number }
  | { type: "drop-report"; reportId: string }
  | { type: "create-conflict"; reportId: string; conflictsWith: string }
  | { type: "disable-channel"; channelId: string; fault: CommunicationFault; durationSeconds?: number; delayMs?: number }
  | { type: "restore-channel"; channelId: string }
  | { type: "activate-decision"; decisionId: string }
  | { type: "change-object-state"; objectId: string; property: string; value: unknown }
  | { type: "send-instructor-alert"; message: string }
  | { type: "add-score-event"; dimensionId: string; amount: number; reason: string }
  | { type: "end-exercise"; reason: string };

export type RuleGraphNodeKind = "trigger" | "condition" | "action";

export interface RuleGraphNodeLayout {
  id: string;
  kind: RuleGraphNodeKind;
  index: number;
  position: { x: number; y: number };
}

export interface RuleGraphLayout {
  version: 1;
  nodes: RuleGraphNodeLayout[];
}

export interface ScenarioRule {
  id: string;
  trigger: RuleTrigger;
  conditions: RuleCondition[];
  actions: RuleAction[];
  once?: boolean;
  /** Visual layout only; execution uses trigger, conditions, and actions. */
  editor?: { graph: RuleGraphLayout };
}

export interface DecisionOption {
  id: string;
  label: string;
}

export interface DecisionActivation {
  type: "time" | "trigger";
  atSeconds?: number;
  triggerRuleId?: string;
}

export interface DecisionGate {
  id: string;
  title: string;
  targetRoles: string[];
  activation: DecisionActivation;
  options: DecisionOption[];
  requireRationale: boolean;
  requireConfidence: boolean;
  timeLimitSeconds?: number;
}

export interface ScenarioObjective {
  id: string;
  title: string;
  description: string;
  status: "pending" | "active" | "completed" | "failed";
}

export interface ScoringDimension {
  id: string;
  name: string;
  description: string;
  weight: number;
}

export interface ScenarioDefinition {
  schemaVersion: typeof SCENARIO_SCHEMA_VERSION;
  id: string;
  version: number;
  status: ScenarioStatus;
  metadata: {
    title: string;
    category: ScenarioCategory;
    description: string;
    durationSeconds: number;
    seed: number;
    tags: string[];
  };
  roles: ScenarioRole[];
  environment: {
    world: {
      type: "low-poly-grid";
      width: number;
      depth: number;
    };
    objects: ScenarioObject[];
  };
  channels: CommunicationChannel[];
  reports: ReportTemplate[];
  events: ScenarioEvent[];
  rules: ScenarioRule[];
  decisions: DecisionGate[];
  objectives: ScenarioObjective[];
  scoring: ScoringDimension[];
  aar: {
    metrics: string[];
    sections: string[];
  };
}
