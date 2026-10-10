import type { DecisionGate, RuleAction, RuleCondition, RuleTrigger, ScenarioDefinition, ScenarioEvent } from "./scenario.js";

export function nextScenarioId(scenario: ScenarioDefinition, prefix: string): string {
  const ids = new Set([
    ...scenario.roles, ...scenario.environment.objects, ...scenario.channels, ...scenario.reports,
    ...scenario.events, ...scenario.rules, ...scenario.decisions, ...scenario.objectives, ...scenario.scoring,
    ...scenario.decisions.flatMap((decision) => decision.options)
  ].map((item) => item.id));
  let number = 1;
  while (ids.has(`${prefix}-${number}`)) number++;
  return `${prefix}-${number}`;
}

/** Keep the executable event schedule in sync with the decision's authoring metadata. */
export function putDecision(scenario: ScenarioDefinition, decision: DecisionGate): ScenarioDefinition {
  const previous = scenario.decisions.find((item) => item.id === decision.id);
  let events = scenario.events;
  if (!previous || previous.activation.type !== decision.activation.type || previous.activation.atSeconds !== decision.activation.atSeconds) {
    const scheduled = events.find((event) => event.type === "decision-gate" && event.decisionId === decision.id);
    events = events.filter((event) => event.type !== "decision-gate" || event.decisionId !== decision.id);
    if (decision.activation.type === "time") {
      events = [...events, {
        id: scheduled?.id ?? nextScenarioId(scenario, "decision-event"),
        type: "decision-gate", decisionId: decision.id, atSeconds: decision.activation.atSeconds ?? 0
      }];
    }
  }
  return {
    ...scenario, events,
    decisions: previous ? scenario.decisions.map((item) => item.id === decision.id ? decision : item) : [...scenario.decisions, decision]
  };
}

/** Report visibility describes the current recipients, not a second independent access list. */
export function syncReportVisibility(scenario: ScenarioDefinition): ScenarioDefinition {
  return {
    ...scenario,
    roles: scenario.roles.map((role) => ({
      ...role,
      visibility: { ...role.visibility, reportIds: scenario.reports.filter((report) => report.targetRoles.includes(role.id)).map((report) => report.id) }
    }))
  };
}

const referenceKeys = new Set([
  "objectId", "otherObjectId", "channelId", "backupChannelId", "reportId", "conflictsWith", "decisionId",
  "triggerRuleId", "roleId", "sourceRole", "objectiveId", "dimensionId", "targetRoles", "participants", "objectIds", "metrics"
]);

/** Used by delete controls so removing an entity cannot silently break a rule or event. */
export function scenarioReferences(scenario: ScenarioDefinition, id: string, decisionId?: string): string[] {
  const references: string[] = [];
  function visit(value: unknown, path: string): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      const matchesOption = key === "optionId" && record.decisionId === decisionId;
      if ((referenceKeys.has(key) || matchesOption) && (child === id || Array.isArray(child) && child.includes(id))) {
        references.push(`${path}.${key}`);
      } else if (key !== "properties") visit(child, path ? `${path}.${key}` : key);
    }
  }
  visit(scenario, "");
  return references;
}

export function defaultTrigger(type: RuleTrigger["type"], scenario: ScenarioDefinition): RuleTrigger {
  const roleId = scenario.roles[0]?.id ?? "";
  const objectId = scenario.environment.objects[0]?.id ?? "";
  const reportId = scenario.reports[0]?.id ?? "";
  const channelId = scenario.channels[0]?.id ?? "";
  switch (type) {
    case "time-reached": return { type, atSeconds: 0 };
    case "zone-entered": return { type, objectId: scenario.environment.objects.find((object) => object.type === "zone")?.id ?? objectId };
    case "object-collision": return { type, objectId, otherObjectId: scenario.environment.objects[1]?.id ?? objectId };
    case "message-received": case "message-ignored": return { type, reportId, roleId };
    case "decision-submitted": return { type, decisionId: scenario.decisions[0]?.id ?? "" };
    case "channel-disabled": case "channel-restored": return { type, channelId };
    case "instructor-injection": return { type, eventType: "channel-fault" };
  }
}

export function defaultCondition(type: RuleCondition["type"], scenario: ScenarioDefinition): RuleCondition {
  switch (type) {
    case "role-is": return { type, roleId: scenario.roles[0]?.id ?? "" };
    case "object-state": return { type, objectId: scenario.environment.objects[0]?.id ?? "", property: "status", equals: "available" };
    case "channel-state": return { type, channelId: scenario.channels[0]?.id ?? "", state: "faulted" };
    case "report-age": return { type, reportId: scenario.reports[0]?.id ?? "", greaterThanSeconds: 60 };
    case "report-status": return { type, reportId: scenario.reports[0]?.id ?? "", status: "delivered" };
    case "selected-option": return { type, decisionId: scenario.decisions[0]?.id ?? "", optionId: scenario.decisions[0]?.options[0]?.id ?? "" };
    case "decision-count": return { type, greaterThanOrEqual: 1 };
    case "objective-state": return { type, objectiveId: scenario.objectives[0]?.id ?? "", state: "completed" };
    case "time-window": return { type, startSeconds: 0, endSeconds: scenario.metadata.durationSeconds };
  }
}

export function defaultAction(type: RuleAction["type"], scenario: ScenarioDefinition): RuleAction {
  const reportId = scenario.reports[0]?.id ?? "";
  const channelId = scenario.channels[0]?.id ?? "";
  switch (type) {
    case "send-report": return { type, reportId, delayMs: 0 };
    case "delay-report": return { type, reportId, delayMs: 15000 };
    case "drop-report": return { type, reportId };
    case "create-conflict": return { type, reportId, conflictsWith: scenario.reports[1]?.id ?? "" };
    case "disable-channel": return { type, channelId, fault: "outage", durationSeconds: 60, delayMs: 0 };
    case "restore-channel": return { type, channelId };
    case "activate-decision": return { type, decisionId: scenario.decisions[0]?.id ?? "" };
    case "change-object-state": return { type, objectId: scenario.environment.objects[0]?.id ?? "", property: "status", value: "available" };
    case "send-instructor-alert": return { type, message: "Review the current information picture." };
    case "add-score-event": return { type, dimensionId: scenario.scoring[0]?.id ?? "", amount: 1, reason: "Exercise objective achieved." };
    case "end-exercise": return { type, reason: "Exercise complete." };
  }
}

export function defaultEvent(type: ScenarioEvent["type"], scenario: ScenarioDefinition, id: string, atSeconds = 0): ScenarioEvent {
  switch (type) {
    case "message": return { id, type, atSeconds, reportId: scenario.reports[0]?.id ?? "" };
    case "channel-fault": return { id, type, atSeconds, channelId: scenario.channels[0]?.id ?? "", fault: "delay", delayMs: 15000, durationSeconds: 60 };
    case "channel-restore": return { id, type, atSeconds, channelId: scenario.channels[0]?.id ?? "" };
    case "decision-gate": return { id, type, atSeconds, decisionId: scenario.decisions[0]?.id ?? "" };
    case "state-change": return { id, type, atSeconds, objectId: scenario.environment.objects[0]?.id ?? "", property: "status", value: "available" };
    case "instructor-alert": return { id, type, atSeconds, message: "Review the current information picture." };
    case "objective-update": return { id, type, atSeconds, objectiveId: scenario.objectives[0]?.id ?? "", status: "completed" };
    case "scenario-end": return { id, type, atSeconds: scenario.metadata.durationSeconds, reason: "Training window complete." };
  }
}
