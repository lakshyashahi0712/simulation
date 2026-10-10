import { SCENARIO_SCHEMA_VERSION, type ScenarioDefinition } from "../domain/scenario.js";
import { operationSignalBreak } from "./operation-signal-break.js";

function coordinationBase(id: string, title: string, category: "disaster" | "synthetic", description: string): ScenarioDefinition {
  const roles = ["commander", "operations", "communications-ew"];
  const objects: ScenarioDefinition["environment"]["objects"] = [
    { id: "coordination-center", type: "command-post", name: "Coordination Center", transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } }, physics: { body: "fixed", collider: "box", trigger: false } },
    { id: "primary-zone", type: "zone", name: category === "disaster" ? "Riverside Shelter" : "Primary Service Zone", transform: { position: { x: 24, y: 0, z: -18 }, rotationY: 0, scale: { x: 8, y: 1, z: 8 } }, properties: { status: "uncertain" }, physics: { body: "fixed", collider: "box", trigger: true } },
    { id: "backup-zone", type: "zone", name: category === "disaster" ? "Hilltop Shelter" : "Backup Service Zone", transform: { position: { x: -22, y: 0, z: 20 }, rotationY: 0, scale: { x: 8, y: 1, z: 8 } }, properties: { status: "available" }, physics: { body: "fixed", collider: "box", trigger: true } },
    { id: "response-team", type: "team", name: "Response Team", transform: { position: { x: 5, y: 0, z: 5 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } }, properties: { roleId: "operations" }, physics: { body: "kinematic", collider: "capsule", trigger: false } },
    { id: "supply-cache", type: "resource", name: category === "disaster" ? "Relief Supplies" : "Backup Equipment", transform: { position: { x: -15, y: 0, z: 15 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } }, physics: { body: "fixed", collider: "box", trigger: false } }
  ];
  return {
    schemaVersion: SCENARIO_SCHEMA_VERSION, id, version: 1, status: "published",
    metadata: { title, category, description, durationSeconds: 600, seed: category === "disaster" ? 52001 : 62001, tags: [category, "coordination", "communications"] },
    roles: roles.map((roleId, index) => ({
      id: roleId, kind: roleId as "commander" | "operations" | "communications-ew",
      name: ["Response Coordinator", "Field Operations", "Communications Lead"][index]!,
      briefing: ["Coordinate the response using current verified evidence.", "Reconcile field observations and communicate information age.", "Monitor link health and coordinate backup communications."][index]!,
      permissions: ["receive_reports", "send_messages", "submit_decisions", ...(index === 2 ? ["monitor_channels"] : [])],
      visibility: { objectIds: objects.map((object) => object.id), reportIds: [] }
    })),
    environment: { world: { type: "low-poly-grid", width: 120, depth: 120 }, objects },
    channels: [
      { id: "coordination-net", name: "Coordination Net", kind: "team", participants: roles, baseLatencyMs: 0, reliability: 1, backupChannelId: "backup-link", status: "active" },
      { id: "field-link", name: "Field Link", kind: "team", participants: roles, baseLatencyMs: 0, reliability: 1, backupChannelId: "backup-link", status: "active" },
      { id: "backup-link", name: "Backup Link", kind: "team", participants: roles, baseLatencyMs: 0, reliability: 1, status: "active" }
    ],
    reports: [], events: [], rules: [], decisions: [],
    objectives: [{ id: "shared-picture", title: "Restore a verified shared picture", description: "Explain uncertainty and coordinate a response through available channels.", status: "active" }],
    scoring: structuredClone(operationSignalBreak.scoring), aar: structuredClone(operationSignalBreak.aar)
  };
}

const flood = coordinationBase("flood-response", "Flood Response / Broken Links", "disaster", "Coordinate fictional shelter support while delayed water-level reports and conflicting access updates disrupt the shared picture.");
flood.reports = [
  { id: "flood-brief", sourceRole: "operations", channelId: "coordination-net", targetRoles: ["commander", "operations", "communications-ew"], domain: "general", priority: "routine", generatedAtSeconds: 0, content: "Riverside and Hilltop shelters are open. A field team is checking access as water levels rise.", freshnessSeconds: 180, reliability: 1 },
  { id: "riverside-warning", sourceRole: "operations", channelId: "field-link", targetRoles: ["commander", "operations"], domain: "logistics", priority: "critical", generatedAtSeconds: 90, content: "A current field observation reports restricted Riverside access. Verify before assigning relief supplies.", freshnessSeconds: 60, reliability: 0.9 },
  { id: "cached-access", sourceRole: "operations", channelId: "coordination-net", targetRoles: ["commander", "operations"], domain: "logistics", priority: "priority", generatedAtSeconds: 120, content: "An earlier shelter update lists Riverside access as open. Its observation age is uncertain.", freshnessSeconds: 30, reliability: 0.55, conflictsWith: "riverside-warning" },
  { id: "backup-health", sourceRole: "communications-ew", channelId: "backup-link", targetRoles: ["commander", "communications-ew"], domain: "general", priority: "priority", generatedAtSeconds: 150, content: "Backup Link is available for direct shelter verification.", freshnessSeconds: 120, reliability: 1 },
  { id: "shelter-verification", sourceRole: "operations", channelId: "backup-link", targetRoles: ["commander", "operations"], domain: "logistics", priority: "critical", generatedAtSeconds: 180, content: "Fresh verification confirms Hilltop access is available; Riverside access remains restricted.", freshnessSeconds: 90, reliability: 1 }
];
flood.events = [
  { id: "flood-start", type: "message", atSeconds: 0, reportId: "flood-brief" },
  { id: "flood-delay", type: "channel-fault", atSeconds: 60, channelId: "field-link", fault: "delay", delayMs: 45000, durationSeconds: 120 },
  { id: "flood-field", type: "message", atSeconds: 90, reportId: "riverside-warning" },
  { id: "flood-cached", type: "message", atSeconds: 120, reportId: "cached-access" },
  { id: "flood-backup", type: "message", atSeconds: 150, reportId: "backup-health" },
  { id: "flood-gate", type: "decision-gate", atSeconds: 180, decisionId: "shelter-decision" },
  { id: "flood-end", type: "scenario-end", atSeconds: 600, reason: "Shelter coordination window complete." }
];
flood.decisions = [{ id: "shelter-decision", title: "Choose the next shelter-support action", targetRoles: ["commander"], activation: { type: "time", atSeconds: 180 }, options: [{ id: "riverside", label: "Use the earlier Riverside access report" }, { id: "verify-shelter", label: "Verify shelter access through Backup Link" }, { id: "backup-shelter", label: "Coordinate support at Hilltop shelter" }], requireRationale: true, requireConfidence: true, timeLimitSeconds: 90 }];
flood.rules = [{ id: "verify-shelter-rule", trigger: { type: "decision-submitted", decisionId: "shelter-decision" }, conditions: [{ type: "selected-option", decisionId: "shelter-decision", optionId: "verify-shelter" }], actions: [{ type: "send-report", reportId: "shelter-verification", delayMs: 15000 }, { type: "change-object-state", objectId: "primary-zone", property: "status", value: "restricted" }, { type: "add-score-event", dimensionId: "uncertainty-recognition", amount: 1, reason: "Requested current shelter evidence rather than relying on a conflicting cached update." }], once: true }];

const blackout = coordinationBase("custom-blackout", "Custom Blackout Protocol", "synthetic", "An editable fictional service-recovery exercise: replace the brief, reports, choices, and rules with your own training situation.");
blackout.reports = [
  { id: "blackout-brief", sourceRole: "operations", channelId: "coordination-net", targetRoles: ["commander", "operations", "communications-ew"], domain: "general", priority: "routine", generatedAtSeconds: 0, content: "A fictional service interruption affects the primary zone. Confirm status before assigning the response team.", freshnessSeconds: 180, reliability: 1 },
  { id: "service-status", sourceRole: "operations", channelId: "field-link", targetRoles: ["commander", "operations"], domain: "general", priority: "critical", generatedAtSeconds: 90, content: "Primary service status is not yet verified. The backup service zone remains available.", freshnessSeconds: 60, reliability: 0.75 },
  { id: "recovery-status", sourceRole: "communications-ew", channelId: "backup-link", targetRoles: ["commander", "operations", "communications-ew"], domain: "general", priority: "priority", generatedAtSeconds: 120, content: "Backup communications verified. The response team can coordinate a controlled service recovery.", freshnessSeconds: 120, reliability: 1 }
];
blackout.events = [
  { id: "blackout-start", type: "message", atSeconds: 0, reportId: "blackout-brief" },
  { id: "blackout-outage", type: "channel-fault", atSeconds: 60, channelId: "field-link", fault: "outage", durationSeconds: 120 },
  { id: "blackout-status", type: "message", atSeconds: 90, reportId: "service-status" },
  { id: "blackout-gate", type: "decision-gate", atSeconds: 120, decisionId: "recovery-decision" },
  { id: "blackout-end", type: "scenario-end", atSeconds: 600, reason: "Custom recovery window complete." }
];
blackout.decisions = [{ id: "recovery-decision", title: "Choose a service-recovery action", targetRoles: ["commander"], activation: { type: "time", atSeconds: 120 }, options: [{ id: "continue-primary", label: "Continue using the unverified primary picture" }, { id: "verify-backup", label: "Verify through the backup channel before recovery" }, { id: "hold-response", label: "Hold the response team until more evidence arrives" }], requireRationale: true, requireConfidence: true, timeLimitSeconds: 90 }];
blackout.rules = [{ id: "backup-recovery-rule", trigger: { type: "decision-submitted", decisionId: "recovery-decision" }, conditions: [{ type: "selected-option", decisionId: "recovery-decision", optionId: "verify-backup" }], actions: [{ type: "send-report", reportId: "recovery-status", delayMs: 0 }, { type: "restore-channel", channelId: "field-link" }, { type: "change-object-state", objectId: "primary-zone", property: "status", value: "recovering" }, { type: "add-score-event", dimensionId: "backup-channel-use", amount: 1, reason: "Verified recovery coordination on an available backup link." }], once: true }];

for (const preset of [flood, blackout]) {
  for (const role of preset.roles) role.visibility.reportIds = preset.reports.filter((report) => report.targetRoles.includes(role.id)).map((report) => report.id);
}

export const floodResponse = flood;
export const customBlackout = blackout;
export const scenarioPresets = [operationSignalBreak, floodResponse, customBlackout];
