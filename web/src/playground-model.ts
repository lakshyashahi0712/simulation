import type { ChannelHealth, GroundTruthSnapshot } from "../../src/domain/runtime.js";
import type { ScenarioObject, Vector3 } from "../../src/domain/scenario.js";
import type { ClientScenarioView, SessionView } from "../../src/server/protocol.js";

export type PlaygroundEnvironment = ClientScenarioView["environment"];
export type PlaygroundBodies = GroundTruthSnapshot["physicsBodies"];

export interface PlaygroundModel {
  environment: PlaygroundEnvironment;
  bodies?: PlaygroundBodies | undefined;
  channelHealth?: ChannelHealth[] | undefined;
  objectStates?: GroundTruthSnapshot["objectStates"] | undefined;
  selectedId: string | null;
}

export function worldPosition(object: ScenarioObject, bodies?: PlaygroundBodies): Vector3 {
  const position = bodies?.[object.id]?.position ?? object.transform.position;
  return { x: finite(position.x), y: finite(position.y), z: finite(position.z) };
}

export function worldDimensions(environment: PlaygroundEnvironment): { width: number; depth: number } {
  const { width, depth } = environment.world;
  return { width: Number.isFinite(width) && width > 0 ? width : 120, depth: Number.isFinite(depth) && depth > 0 ? depth : 120 };
}

export function boundedPosition(position: Vector3, environment: PlaygroundEnvironment): Vector3 {
  const { width, depth } = worldDimensions(environment);
  return { x: Math.max(-width / 2, Math.min(width / 2, finite(position.x))), y: finite(position.y), z: Math.max(-depth / 2, Math.min(depth / 2, finite(position.z))) };
}

export function canMoveWorldObject(object: ScenarioObject, view: SessionView): boolean {
  return view.participant.kind === "trainee" && Boolean(view.participant.roleId)
    && object.properties?.roleId === view.participant.roleId
    && Boolean(object.physics && object.physics.collider !== "none" && object.physics.body !== "fixed");
}

export function objectTint(object: ScenarioObject, model: PlaygroundModel): number {
  const channelId = object.properties?.channelId;
  const channel = model.channelHealth?.find((candidate) => candidate.channelId === channelId);
  if (channel?.status === "offline") return 0xd47a70;
  if (channel?.status === "degraded") return 0xd4a261;
  const status = model.objectStates?.[object.id]?.status ?? object.properties?.status;
  if (["failed", "restricted", "blocked", "offline"].includes(String(status))) return 0xd47a70;
  if (["uncertain", "unknown", "recovering"].includes(String(status)) || object.type === "hazard") return 0xd4a261;
  if (["relay-node", "channel-node", "sensor", "report-source"].includes(object.type)) return 0x75a9be;
  return 0x9fc3b0;
}

function finite(value: number): number { return Number.isFinite(value) ? value : 0; }
