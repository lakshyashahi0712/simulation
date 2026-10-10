import type { ScenarioDefinition } from "../domain/scenario.js";
import { SCENARIO_SCHEMA_VERSION } from "../domain/scenario.js";

const objectTransform = (x: number, z: number) => ({
  position: { x, y: 0, z },
  rotationY: 0,
  scale: { x: 1, y: 1, z: 1 }
});

export const operationSignalBreak: ScenarioDefinition = {
  schemaVersion: SCENARIO_SCHEMA_VERSION,
  id: "operation-signal-break",
  version: 1,
  status: "published",
  metadata: {
    title: "Operation Signal Break",
    category: "military",
    description: "Synthetic land-air-cyber-EW decision exercise under degraded communications.",
    durationSeconds: 600,
    seed: 42001,
    tags: ["land", "air", "cyber", "ew", "command-and-control"]
  },
  roles: [
    {
      id: "commander",
      name: "Commander",
      kind: "commander",
      briefing: "Coordinate the exercise, identify uncertainty, and submit accountable decisions.",
      permissions: ["receive_reports", "send_messages", "submit_decisions"],
      visibility: {
        objectIds: ["command-post", "north-zone", "south-zone"],
        reportIds: ["initial-sitrep", "field-route-report", "aerial-route-report", "contradictory-aerial-report"]
      }
    },
    {
      id: "operations",
      name: "Operations/Intelligence Officer",
      kind: "operations",
      briefing: "Collect observations, identify conflicts, and communicate the age and reliability of information.",
      permissions: ["receive_reports", "send_messages", "submit_decisions"],
      visibility: {
        objectIds: ["north-zone", "south-zone", "field-observation-point"],
        reportIds: ["initial-sitrep", "field-route-report", "aerial-route-report", "contradictory-aerial-report"]
      }
    },
    {
      id: "communications-ew",
      name: "Communications/EW Officer",
      kind: "communications-ew",
      briefing: "Monitor channel health, report degradation, and coordinate the move to a backup channel.",
      permissions: ["receive_reports", "send_messages", "submit_decisions", "monitor_channels"],
      visibility: {
        objectIds: ["command-post", "relay-alpha", "relay-bravo"],
        reportIds: ["initial-sitrep", "channel-health-report", "backup-channel-report"]
      }
    }
  ],
  environment: {
    world: {
      type: "low-poly-grid",
      width: 120,
      depth: 120
    },
    objects: [
      {
        id: "command-post",
        type: "command-post",
        name: "Command Post Orion",
        transform: objectTransform(0, 0),
        physics: { body: "fixed", collider: "box", trigger: false }
      },
      {
        id: "north-zone",
        type: "zone",
        name: "North Coordination Zone",
        transform: objectTransform(24, -18),
        properties: { status: "uncertain" },
        physics: { body: "fixed", collider: "box", trigger: true }
      },
      {
        id: "south-zone",
        type: "zone",
        name: "South Support Zone",
        transform: objectTransform(-22, 20),
        properties: { status: "available" },
        physics: { body: "fixed", collider: "box", trigger: true }
      },
      {
        id: "field-observation-point",
        type: "observation-point",
        name: "Field Observation Point",
        transform: objectTransform(20, -20),
        physics: { body: "fixed", collider: "sphere", trigger: true }
      },
      {
        id: "relay-alpha",
        type: "relay-node",
        name: "Alpha Relay",
        transform: objectTransform(-18, -8),
        properties: { channelId: "alpha-link" },
        physics: { body: "fixed", collider: "box", trigger: false }
      },
      {
        id: "relay-bravo",
        type: "relay-node",
        name: "Bravo Relay",
        transform: objectTransform(18, 12),
        properties: { channelId: "bravo-link" },
        physics: { body: "fixed", collider: "box", trigger: false }
      }
    ]
  },
  channels: [
    {
      id: "command-net",
      name: "Command Net",
      kind: "team",
      participants: ["commander", "operations", "communications-ew"],
      baseLatencyMs: 300,
      reliability: 1,
      backupChannelId: "bravo-link",
      status: "active"
    },
    {
      id: "alpha-link",
      name: "Alpha Link",
      kind: "team",
      participants: ["commander", "operations"],
      baseLatencyMs: 500,
      reliability: 0.95,
      backupChannelId: "bravo-link",
      status: "active"
    },
    {
      id: "bravo-link",
      name: "Bravo Link",
      kind: "team",
      participants: ["commander", "operations", "communications-ew"],
      baseLatencyMs: 700,
      reliability: 0.9,
      status: "active"
    }
  ],
  reports: [
    {
      id: "initial-sitrep",
      sourceRole: "operations",
      channelId: "command-net",
      targetRoles: ["commander", "operations", "communications-ew"],
      domain: "general",
      priority: "routine",
      generatedAtSeconds: 0,
      content: "Initial situation is stable. North and South zones require continued observation.",
      freshnessSeconds: 180,
      reliability: 0.9
    },
    {
      id: "field-route-report",
      sourceRole: "operations",
      channelId: "alpha-link",
      targetRoles: ["commander"],
      domain: "land",
      priority: "critical",
      generatedAtSeconds: 90,
      content: "Field observation reports that the North route requires verification before movement.",
      freshnessSeconds: 45,
      reliability: 0.8
    },
    {
      id: "aerial-route-report",
      sourceRole: "operations",
      channelId: "alpha-link",
      targetRoles: ["commander", "operations"],
      domain: "air",
      priority: "priority",
      generatedAtSeconds: 120,
      content: "Aerial observation indicates the North route was clear in the previous observation window.",
      freshnessSeconds: 30,
      reliability: 0.65
    },
    {
      id: "backup-channel-report",
      sourceRole: "communications-ew",
      channelId: "bravo-link",
      targetRoles: ["commander"],
      domain: "ew",
      priority: "priority",
      generatedAtSeconds: 195,
      content: "Bravo Link remains available for priority coordination.",
      freshnessSeconds: 60,
      reliability: 0.9
    },
    {
      id: "contradictory-aerial-report",
      sourceRole: "operations",
      channelId: "command-net",
      targetRoles: ["commander", "operations"],
      domain: "air",
      priority: "critical",
      generatedAtSeconds: 220,
      content: "A cached aerial observation still indicates the North route is clear.",
      freshnessSeconds: 20,
      reliability: 0.55,
      conflictsWith: "field-route-report"
    },
    {
      id: "late-verification-report",
      sourceRole: "operations",
      channelId: "bravo-link",
      targetRoles: ["commander"],
      domain: "land",
      priority: "priority",
      generatedAtSeconds: 260,
      content: "Verification team requests additional time to reconcile route observations.",
      freshnessSeconds: 45,
      reliability: 0.75
    },
    {
      id: "channel-health-report",
      sourceRole: "communications-ew",
      channelId: "command-net",
      targetRoles: ["communications-ew"],
      domain: "ew",
      priority: "priority",
      generatedAtSeconds: 60,
      content: "Alpha Link is experiencing an increasing delivery delay.",
      freshnessSeconds: 45,
      reliability: 0.95
    }
  ],
  events: [
    { id: "event-initial-sitrep", type: "message", atSeconds: 0, reportId: "initial-sitrep" },
    { id: "event-alpha-delay", type: "channel-fault", atSeconds: 60, channelId: "alpha-link", fault: "delay", delayMs: 45000, durationSeconds: 120 },
    { id: "event-channel-health", type: "message", atSeconds: 60, reportId: "channel-health-report" },
    { id: "event-field-route-report", type: "message", atSeconds: 90, reportId: "field-route-report" },
    { id: "event-aerial-route-report", type: "message", atSeconds: 120, reportId: "aerial-route-report" },
    { id: "event-bravo-dropout", type: "channel-fault", atSeconds: 180, channelId: "bravo-link", fault: "dropout", durationSeconds: 60 },
    { id: "event-backup-report", type: "message", atSeconds: 195, reportId: "backup-channel-report" },
    { id: "event-command-conflict", type: "channel-fault", atSeconds: 210, channelId: "command-net", fault: "conflict", durationSeconds: 90 },
    { id: "event-contradictory-aerial-report", type: "message", atSeconds: 220, reportId: "contradictory-aerial-report" },
    { id: "event-route-decision", type: "decision-gate", atSeconds: 240, decisionId: "route-decision" },
    { id: "event-restore-command-net", type: "channel-restore", atSeconds: 300, channelId: "command-net" },
    { id: "event-scenario-end", type: "scenario-end", atSeconds: 600, reason: "training-window-complete" }
  ],
  rules: [
    {
      id: "rule-verify-north-route",
      trigger: { type: "decision-submitted", decisionId: "route-decision" },
      conditions: [{ type: "selected-option", decisionId: "route-decision", optionId: "request-verification" }],
      actions: [{ type: "send-report", reportId: "late-verification-report", delayMs: 30000 }],
      once: true
    }
  ],
  decisions: [
    {
      id: "route-decision",
      title: "Select the next coordination action",
      targetRoles: ["commander"],
      activation: { type: "time", atSeconds: 240 },
      options: [
        { id: "north-route", label: "Continue with the North route" },
        { id: "request-verification", label: "Request verification before movement" },
        { id: "backup-route", label: "Use the backup route" }
      ],
      requireRationale: true,
      requireConfidence: true,
      timeLimitSeconds: 60
    }
  ],
  objectives: [
    {
      id: "maintain-situational-awareness",
      title: "Maintain a shared and current situation picture",
      description: "Identify information age and reconcile conflicting reports before committing to an action.",
      status: "active"
    }
  ],
  scoring: [
    { id: "decision-timeliness", name: "Decision timeliness", description: "Makes decisions within the exercise window.", weight: 0.2 },
    { id: "uncertainty-recognition", name: "Uncertainty recognition", description: "Identifies stale, incomplete, or conflicting information.", weight: 0.2 },
    { id: "communication-clarity", name: "Communication clarity", description: "Communicates intent and information status clearly.", weight: 0.2 },
    { id: "backup-channel-use", name: "Backup-channel use", description: "Uses available alternate communications when appropriate.", weight: 0.15 },
    { id: "rationale-quality", name: "Rationale quality", description: "Explains the decision using available evidence.", weight: 0.25 }
  ],
  aar: {
    metrics: [
      "decision-timeliness",
      "uncertainty-recognition",
      "communication-clarity",
      "backup-channel-use",
      "rationale-quality"
    ],
    sections: ["summary", "timeline", "perception", "decisions", "communication"]
  }
};
