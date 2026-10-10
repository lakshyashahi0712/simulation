import type { AfterActionReview, ChannelHealth, DecisionRecord, GroundTruthSnapshot, PerceptionSnapshot, RecordedEvent, ScoreSnapshot } from "../domain/runtime.js";
import type { ScenarioCategory, ScenarioDefinition, ScenarioRole } from "../domain/scenario.js";

export type ParticipantKind = "instructor" | "trainee";
export type SessionStatus = "waiting" | "running" | "paused" | "ended";

export interface SessionParticipant {
  id: string;
  displayName: string;
  kind: ParticipantKind;
  roleId?: string;
  connected: boolean;
  joinedAt: string;
}

export interface ScenarioSummary {
  id: string;
  version: number;
  status: ScenarioDefinition["status"];
  title: string;
  category: ScenarioCategory;
  description: string;
  durationSeconds: number;
  tags: string[];
  roleCount: number;
  library?: {
    familyId: string;
    sourceScenarioId?: string;
    archived: boolean;
    publishedAt?: string;
  };
}

export interface SessionSummary {
  id: string;
  roomCode: string;
  scenario: ScenarioSummary;
  status: SessionStatus;
  simulationTimeSeconds: number;
  participants: SessionParticipant[];
  createdAt: string;
}

export interface ClientScenarioView {
  id: string;
  version: number;
  metadata: ScenarioDefinition["metadata"];
  roles: Array<Pick<ScenarioRole, "id" | "name" | "kind" | "briefing">>;
  environment: ScenarioDefinition["environment"];
  channels: ScenarioDefinition["channels"];
  decisions: ScenarioDefinition["decisions"];
}

export interface SessionView {
  session: SessionSummary;
  participant: SessionParticipant;
  scenario: ClientScenarioView;
  perception?: PerceptionSnapshot;
  channelHealth: ChannelHealth[];
  decisions: DecisionRecord[];
  events: RecordedEvent[];
  score: ScoreSnapshot;
  physicsBodies?: GroundTruthSnapshot["physicsBodies"];
  groundTruth?: {
    activeChannelFaults: GroundTruthSnapshot["activeChannelFaults"];
    objectStates: GroundTruthSnapshot["objectStates"];
    physicsBodies: GroundTruthSnapshot["physicsBodies"];
  };
}

export type SessionAar = AfterActionReview & {
  sessionId: string;
  roomCode: string;
  scenarioTitle: string;
  status: SessionStatus;
};

export interface CreateSessionBody {
  scenarioId?: string;
  instructorName?: string;
}

export interface JoinSessionBody {
  displayName?: string;
  roleId?: string;
}

export interface JoinByCodeBody extends JoinSessionBody {
  roomCode?: string;
}

export interface ControlBody {
  accessToken?: string;
}

export interface AdvanceBody extends ControlBody {
  seconds?: number;
}

export interface InjectFaultBody extends ControlBody {
  channelId?: string;
  fault?: string;
  delayMs?: number;
  durationSeconds?: number;
}

export interface SubmitDecisionBody {
  participantId?: string;
  decisionId?: string;
  optionId?: string;
  rationale?: string;
  confidence?: number;
}

export interface QueuedSessionAction {
  id: string;
  event: "session:send-text" | "session:submit-decision";
  payload: Record<string, unknown>;
}

export interface SessionActionResult {
  id: string;
  status: "accepted" | "rejected";
  error?: string;
  message?: string;
}

export interface VoiceSignal {
  description?: { type: "offer" | "answer"; sdp: string };
  candidate?: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null };
}

export interface VoiceJoinResult {
  channelId: string;
  peers: string[];
  error?: string;
}
