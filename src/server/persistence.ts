import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { AfterActionReview, DecisionRecord, RecordedEvent } from "../domain/runtime.js";
import type { ScenarioDefinition } from "../domain/scenario.js";
import type { SimulationEngineSnapshot } from "../engine/simulation-engine.js";
import type { ParticipantKind, SessionActionResult, SessionStatus } from "./protocol.js";

export interface PersistedParticipant {
  id: string;
  displayName: string;
  kind: ParticipantKind;
  roleId?: string;
  joinedAt: string;
  accessTokenHash?: string;
}

export interface PersistedSession {
  id: string;
  roomCode: string;
  scenarioId: string;
  scenarioVersion: number;
  status: SessionStatus;
  createdAt: string;
  simulationTimeSeconds: number;
  participants: PersistedParticipant[];
  events: RecordedEvent[];
  decisions: DecisionRecord[];
  engineSnapshot?: SimulationEngineSnapshot;
  aar?: AfterActionReview;
  scenarioSnapshot?: ScenarioDefinition;
  actionReceipts?: Array<[string, { fingerprint: string; result: SessionActionResult }]>;
}

export interface PersistedSentinelData {
  version: 1;
  scenarios: ScenarioDefinition[];
  sessions: PersistedSession[];
  scenarioLibrary?: Record<string, ScenarioLibraryEntry>;
}

/** Library organization is separate from immutable published exercise data. */
export interface ScenarioLibraryEntry {
  familyId: string;
  sourceScenarioId?: string;
  archived: boolean;
  publishedAt?: string;
}

const EMPTY_DATA: PersistedSentinelData = {
  version: 1,
  scenarios: [],
  sessions: []
};

export class JsonPersistence {
  private readonly filePath: string | null;

  constructor(filePath: string | null) {
    this.filePath = filePath;
  }

  load(): PersistedSentinelData {
    if (!this.filePath || !existsSync(this.filePath)) return structuredClone(EMPTY_DATA);
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<PersistedSentinelData>;
      return {
        version: 1,
        scenarios: Array.isArray(parsed.scenarios) ? structuredClone(parsed.scenarios) : [],
        sessions: Array.isArray(parsed.sessions) ? structuredClone(parsed.sessions) : [],
        scenarioLibrary: structuredClone(parsed.scenarioLibrary ?? {})
      };
    } catch (error) {
      throw new Error(`Unable to read SENTINEL persistence file: ${error instanceof Error ? error.message : "invalid JSON"}`);
    }
  }

  save(data: PersistedSentinelData): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(data, null, 2), "utf8");
    renameSync(temporaryPath, this.filePath);
  }
}
