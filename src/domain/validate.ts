import type {
  CommunicationChannel,
  ScenarioDefinition,
  ScenarioEvent,
  ScenarioRule,
  DecisionGate,
} from "./scenario.js";
import { SCENARIO_SCHEMA_VERSION } from "./scenario.js";
import { ruleGraphLayoutIssues } from "./rule-graph.js";

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

const issue = (code: string, path: string, message: string): ValidationIssue => ({ code, path, message });

const isNonNegativeNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function addIds(
  ids: Map<string, string>,
  values: Array<{ id: string }>,
  collection: string,
  errors: ValidationIssue[],
): void {
  values.forEach((value, index) => {
    if (!value.id.trim()) {
      errors.push(issue("EMPTY_ID", `${collection}[${index}].id`, "ID must not be empty."));
      return;
    }

    const previous = ids.get(value.id);
    if (previous) {
      errors.push(issue("DUPLICATE_ID", `${collection}[${index}].id`, `ID is already used by ${previous}.`));
      return;
    }

    ids.set(value.id, `${collection}[${index}]`);
  });
}

function validateChannelReferences(
  channels: CommunicationChannel[],
  roleIds: Set<string>,
  channelIds: Set<string>,
  errors: ValidationIssue[],
): void {
  channels.forEach((channel, index) => {
    if (!isNonNegativeNumber(channel.baseLatencyMs)) {
      errors.push(issue("INVALID_LATENCY", `channels[${index}].baseLatencyMs`, "Base latency must be a non-negative number."));
    }
    if (channel.reliability < 0 || channel.reliability > 1 || !Number.isFinite(channel.reliability)) {
      errors.push(issue("INVALID_RELIABILITY", `channels[${index}].reliability`, "Reliability must be between 0 and 1."));
    }
    channel.participants.forEach((roleId, participantIndex) => {
      if (!roleIds.has(roleId)) {
        errors.push(issue("UNKNOWN_ROLE", `channels[${index}].participants[${participantIndex}]`, `Unknown role ${roleId}.`));
      }
    });
    if (channel.backupChannelId && !channelIds.has(channel.backupChannelId)) {
      errors.push(issue("UNKNOWN_CHANNEL", `channels[${index}].backupChannelId`, `Unknown backup channel ${channel.backupChannelId}.`));
    }
    if (channel.backupChannelId === channel.id) errors.push(issue("SELF_BACKUP_CHANNEL", `channels[${index}].backupChannelId`, "Backup must be a different channel."));
  });
}

function validateEvents(
  events: ScenarioEvent[],
  reportIds: Set<string>,
  channelIds: Set<string>,
  objectIds: Set<string>,
  decisionIds: Set<string>,
  objectiveIds: Set<string>,
  roleIds: Set<string>,
  durationSeconds: number,
  errors: ValidationIssue[],
): void {
  events.forEach((event, index) => {
    if (!isNonNegativeNumber(event.atSeconds)) {
      errors.push(issue("INVALID_EVENT_TIME", `events[${index}].atSeconds`, "Event time must be non-negative."));
    }
    if (event.atSeconds > durationSeconds) errors.push(issue("EVENT_AFTER_END", `events[${index}].atSeconds`, "Event must occur within the scenario duration."));

    switch (event.type) {
      case "message":
        if (!reportIds.has(event.reportId)) {
          errors.push(issue("UNKNOWN_REPORT", `events[${index}].reportId`, `Unknown report ${event.reportId}.`));
        }
        break;
      case "channel-fault":
        if (!["delay", "dropout", "conflict", "stale", "partial", "outage"].includes(event.fault)) errors.push(issue("INVALID_FAULT", `events[${index}].fault`, "Unknown communication fault."));
        if (!channelIds.has(event.channelId)) {
          errors.push(issue("UNKNOWN_CHANNEL", `events[${index}].channelId`, `Unknown channel ${event.channelId}.`));
        }
        if (event.delayMs !== undefined && !isNonNegativeNumber(event.delayMs)) {
          errors.push(issue("INVALID_DELAY", `events[${index}].delayMs`, "Delay must be a non-negative number."));
        }
        if (event.durationSeconds !== undefined && !isNonNegativeNumber(event.durationSeconds)) {
          errors.push(issue("INVALID_DURATION", `events[${index}].durationSeconds`, "Duration must be a non-negative number."));
        }
        break;
      case "channel-restore":
        if (!channelIds.has(event.channelId)) {
          errors.push(issue("UNKNOWN_CHANNEL", `events[${index}].channelId`, `Unknown channel ${event.channelId}.`));
        }
        break;
      case "state-change":
        if (!objectIds.has(event.objectId)) {
          errors.push(issue("UNKNOWN_OBJECT", `events[${index}].objectId`, `Unknown object ${event.objectId}.`));
        }
        if (!event.property.trim()) errors.push(issue("EMPTY_PROPERTY", `events[${index}].property`, "State changes require a property name."));
        break;
      case "decision-gate":
        if (!decisionIds.has(event.decisionId)) {
          errors.push(issue("UNKNOWN_DECISION", `events[${index}].decisionId`, `Unknown decision ${event.decisionId}.`));
        }
        break;
      case "instructor-alert":
        if (!event.message.trim()) errors.push(issue("EMPTY_MESSAGE", `events[${index}].message`, "Instructor alert must not be empty."));
        for (const roleId of event.targetRoles ?? []) if (!roleIds.has(roleId)) errors.push(issue("UNKNOWN_ROLE", `events[${index}].targetRoles`, `Unknown role ${roleId}.`));
        break;
      case "objective-update":
        if (!objectiveIds.has(event.objectiveId)) errors.push(issue("UNKNOWN_OBJECTIVE", `events[${index}].objectiveId`, `Unknown objective ${event.objectiveId}.`));
        if (!["pending", "active", "completed", "failed"].includes(event.status)) errors.push(issue("INVALID_OBJECTIVE_STATE", `events[${index}].status`, "Unknown objective status."));
        break;
      case "scenario-end":
        break;
      default:
        errors.push(issue("UNKNOWN_EVENT_TYPE", `events[${index}].type`, "Unknown event type."));
    }
  });
}

function validateRules(
  rules: ScenarioRule[],
  roleIds: Set<string>,
  channelIds: Set<string>,
  reportIds: Set<string>,
  decisionIds: Set<string>,
  objectIds: Set<string>,
  objectiveIds: Set<string>,
  dimensionIds: Set<string>,
  decisions: DecisionGate[],
  durationSeconds: number,
  errors: ValidationIssue[],
): void {
  rules.forEach((rule, index) => {
    const path = `rules[${index}]`;
    for (const layoutIssue of ruleGraphLayoutIssues(rule)) errors.push(issue("INVALID_RULE_GRAPH", `${path}.${layoutIssue.path}`, layoutIssue.message));
    const nonNegative = (value: unknown, field: string) => {
      if (!isNonNegativeNumber(value)) errors.push(issue("INVALID_RULE_NUMBER", field, "Value must be a finite non-negative number."));
    };
    const checkOption = (decisionId: string, optionId: string, field: string) => {
      if (!decisions.find((decision) => decision.id === decisionId)?.options.some((option) => option.id === optionId)) errors.push(issue("UNKNOWN_OPTION", field, `Option ${optionId} does not belong to decision ${decisionId}.`));
    };
    if (!["time-reached", "zone-entered", "message-received", "message-ignored", "decision-submitted", "channel-disabled", "channel-restored", "object-collision", "instructor-injection"].includes(rule.trigger.type)) errors.push(issue("UNKNOWN_TRIGGER", `${path}.trigger.type`, "Unknown rule trigger."));
    if ("roleId" in rule.trigger && rule.trigger.roleId !== undefined && !roleIds.has(rule.trigger.roleId)) errors.push(issue("UNKNOWN_ROLE", `${path}.trigger.roleId`, `Unknown role ${rule.trigger.roleId}.`));
    if (rule.trigger.type === "time-reached") {
      nonNegative(rule.trigger.atSeconds, `${path}.trigger.atSeconds`);
      if (!Number.isInteger(rule.trigger.atSeconds) || rule.trigger.atSeconds > durationSeconds) errors.push(issue("INVALID_TRIGGER_TIME", `${path}.trigger.atSeconds`, "Time triggers require a whole second within the scenario duration."));
    }
    if (rule.trigger.type === "decision-submitted" && rule.trigger.optionId !== undefined) checkOption(rule.trigger.decisionId, rule.trigger.optionId, `${path}.trigger.optionId`);
    if (rule.trigger.type === "instructor-injection" && rule.trigger.eventType !== "channel-fault") errors.push(issue("UNKNOWN_INJECTION", `${path}.trigger.eventType`, "Supported instructor injection is channel-fault."));
    if (rule.actions.length === 0) errors.push(issue("NO_RULE_ACTIONS", `${path}.actions`, "A rule requires at least one action."));
    if (rule.trigger.type === "zone-entered" || rule.trigger.type === "object-collision") {
      if (!objectIds.has(rule.trigger.objectId)) {
        errors.push(issue("UNKNOWN_OBJECT", `rules[${index}].trigger.objectId`, `Unknown object ${rule.trigger.objectId}.`));
      }
    }
    if (rule.trigger.type === "object-collision" && !objectIds.has(rule.trigger.otherObjectId)) {
      errors.push(issue("UNKNOWN_OBJECT", `rules[${index}].trigger.otherObjectId`, `Unknown object ${rule.trigger.otherObjectId}.`));
    }
    if (rule.trigger.type === "message-received" || rule.trigger.type === "message-ignored") {
      if (!reportIds.has(rule.trigger.reportId)) {
        errors.push(issue("UNKNOWN_REPORT", `rules[${index}].trigger.reportId`, `Unknown report ${rule.trigger.reportId}.`));
      }
    }
    if (rule.trigger.type === "decision-submitted" && !decisionIds.has(rule.trigger.decisionId)) {
      errors.push(issue("UNKNOWN_DECISION", `rules[${index}].trigger.decisionId`, `Unknown decision ${rule.trigger.decisionId}.`));
    }
    if ((rule.trigger.type === "channel-disabled" || rule.trigger.type === "channel-restored") && !channelIds.has(rule.trigger.channelId)) {
      errors.push(issue("UNKNOWN_CHANNEL", `rules[${index}].trigger.channelId`, `Unknown channel ${rule.trigger.channelId}.`));
    }

    rule.conditions.forEach((condition, conditionIndex) => {
      const conditionPath = `${path}.conditions[${conditionIndex}]`;
      if (!["role-is", "object-state", "channel-state", "report-age", "report-status", "selected-option", "decision-count", "objective-state", "time-window"].includes(condition.type)) errors.push(issue("UNKNOWN_CONDITION", `${conditionPath}.type`, "Unknown rule condition."));
      if (condition.type === "selected-option") checkOption(condition.decisionId, condition.optionId, `${conditionPath}.optionId`);
      if (condition.type === "report-age") nonNegative(condition.greaterThanSeconds, `${conditionPath}.greaterThanSeconds`);
      if (condition.type === "decision-count") {
        nonNegative(condition.greaterThanOrEqual, `${conditionPath}.greaterThanOrEqual`);
        if (!Number.isInteger(condition.greaterThanOrEqual)) errors.push(issue("INVALID_DECISION_COUNT", `${conditionPath}.greaterThanOrEqual`, "Decision count must be a whole number."));
      }
      if (condition.type === "time-window") {
        nonNegative(condition.startSeconds, `${conditionPath}.startSeconds`);
        nonNegative(condition.endSeconds, `${conditionPath}.endSeconds`);
        if (condition.endSeconds < condition.startSeconds || condition.endSeconds > durationSeconds) errors.push(issue("INVALID_TIME_WINDOW", conditionPath, "Time window must end after it starts and within the scenario duration."));
      }
      if (condition.type === "object-state" && !condition.property.trim()) errors.push(issue("EMPTY_PROPERTY", `${conditionPath}.property`, "Object-state conditions require a property name."));
      if (condition.type === "channel-state" && !["active", "faulted"].includes(condition.state)) errors.push(issue("INVALID_CHANNEL_STATE", `${conditionPath}.state`, "Unknown channel state."));
      if (condition.type === "report-status" && !["delivered", "delayed", "dropped", "conflicting", "stale", "partial"].includes(condition.status)) errors.push(issue("INVALID_REPORT_STATUS", `${conditionPath}.status`, "Unknown report status."));
      if (condition.type === "objective-state") {
        if (!objectiveIds.has(condition.objectiveId)) errors.push(issue("UNKNOWN_OBJECTIVE", `${conditionPath}.objectiveId`, `Unknown objective ${condition.objectiveId}.`));
        if (!["pending", "active", "completed", "failed"].includes(condition.state)) errors.push(issue("INVALID_OBJECTIVE_STATE", `${conditionPath}.state`, "Unknown objective state."));
      }
      if (condition.type === "role-is" && !roleIds.has(condition.roleId)) {
        errors.push(issue("UNKNOWN_ROLE", `rules[${index}].conditions[${conditionIndex}]`, `Unknown role ${condition.roleId}.`));
      }
      if (condition.type === "object-state" && !objectIds.has(condition.objectId)) {
        errors.push(issue("UNKNOWN_OBJECT", `rules[${index}].conditions[${conditionIndex}]`, `Unknown object ${condition.objectId}.`));
      }
      if ((condition.type === "channel-state") && !channelIds.has(condition.channelId)) {
        errors.push(issue("UNKNOWN_CHANNEL", `rules[${index}].conditions[${conditionIndex}]`, `Unknown channel ${condition.channelId}.`));
      }
      if ((condition.type === "report-age" || condition.type === "report-status") && !reportIds.has(condition.reportId)) {
        errors.push(issue("UNKNOWN_REPORT", `rules[${index}].conditions[${conditionIndex}]`, `Unknown report ${condition.reportId}.`));
      }
      if (condition.type === "selected-option" && !decisionIds.has(condition.decisionId)) {
        errors.push(issue("UNKNOWN_DECISION", `rules[${index}].conditions[${conditionIndex}]`, `Unknown decision ${condition.decisionId}.`));
      }
    });

    rule.actions.forEach((action, actionIndex) => {
      const actionPath = `${path}.actions[${actionIndex}]`;
      if (!["send-report", "delay-report", "drop-report", "create-conflict", "disable-channel", "restore-channel", "activate-decision", "change-object-state", "send-instructor-alert", "add-score-event", "end-exercise"].includes(action.type)) errors.push(issue("UNKNOWN_ACTION", `${actionPath}.type`, "Unknown rule action."));
      if ("delayMs" in action && action.delayMs !== undefined) nonNegative(action.delayMs, `${actionPath}.delayMs`);
      if (action.type === "delay-report" && action.delayMs === undefined) nonNegative(action.delayMs, `${actionPath}.delayMs`);
      if (action.type === "disable-channel") {
        if (action.durationSeconds !== undefined) nonNegative(action.durationSeconds, `${actionPath}.durationSeconds`);
        if (!["delay", "dropout", "conflict", "stale", "partial", "outage"].includes(action.fault)) errors.push(issue("INVALID_FAULT", `${actionPath}.fault`, "Unknown communication fault."));
      }
      if (action.type === "create-conflict" && (!reportIds.has(action.conflictsWith) || action.reportId === action.conflictsWith)) errors.push(issue("UNKNOWN_CONFLICT_REPORT", `${actionPath}.conflictsWith`, "Choose a different existing report to conflict with."));
      if (action.type === "change-object-state" && !action.property.trim()) errors.push(issue("EMPTY_PROPERTY", `${actionPath}.property`, "State changes require a property name."));
      if (action.type === "send-instructor-alert" && !action.message.trim()) errors.push(issue("EMPTY_MESSAGE", `${actionPath}.message`, "Instructor alert must not be empty."));
      if (action.type === "add-score-event") {
        if (!dimensionIds.has(action.dimensionId)) errors.push(issue("UNKNOWN_DIMENSION", `${actionPath}.dimensionId`, `Unknown scoring dimension ${action.dimensionId}.`));
        if (!Number.isFinite(action.amount)) errors.push(issue("INVALID_SCORE", `${actionPath}.amount`, "Score amount must be finite."));
        if (!action.reason.trim()) errors.push(issue("EMPTY_SCORE_REASON", `${actionPath}.reason`, "Score events require an explainable reason."));
      }
      if ((action.type === "send-report" || action.type === "delay-report" || action.type === "drop-report" || action.type === "create-conflict") && !reportIds.has(action.reportId)) {
        errors.push(issue("UNKNOWN_REPORT", `rules[${index}].actions[${actionIndex}]`, `Unknown report ${action.reportId}.`));
      }
      if ((action.type === "disable-channel" || action.type === "restore-channel") && !channelIds.has(action.channelId)) {
        errors.push(issue("UNKNOWN_CHANNEL", `rules[${index}].actions[${actionIndex}]`, `Unknown channel ${action.channelId}.`));
      }
      if (action.type === "activate-decision" && !decisionIds.has(action.decisionId)) {
        errors.push(issue("UNKNOWN_DECISION", `rules[${index}].actions[${actionIndex}]`, `Unknown decision ${action.decisionId}.`));
      }
      if (action.type === "change-object-state" && !objectIds.has(action.objectId)) {
        errors.push(issue("UNKNOWN_OBJECT", `rules[${index}].actions[${actionIndex}]`, `Unknown object ${action.objectId}.`));
      }
    });
  });

}

export function validateScenario(scenario: ScenarioDefinition): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (scenario.schemaVersion !== SCENARIO_SCHEMA_VERSION) {
    errors.push(issue("UNSUPPORTED_SCHEMA", "schemaVersion", `Expected schema ${SCENARIO_SCHEMA_VERSION}.`));
  }
  if (!scenario.id.trim()) errors.push(issue("EMPTY_SCENARIO_ID", "id", "Scenario ID must not be empty."));
  if (!scenario.metadata.title.trim()) errors.push(issue("EMPTY_TITLE", "metadata.title", "Scenario title must not be empty."));
  if (!Number.isInteger(scenario.version) || scenario.version < 1) errors.push(issue("INVALID_VERSION", "version", "Version must be a positive integer."));
  if (!isNonNegativeNumber(scenario.metadata.durationSeconds) || scenario.metadata.durationSeconds <= 0) {
    errors.push(issue("INVALID_DURATION", "metadata.durationSeconds", "Duration must be greater than zero."));
  }
  if (!Number.isInteger(scenario.metadata.seed)) errors.push(issue("INVALID_SEED", "metadata.seed", "Seed must be an integer."));

  const ids = new Map<string, string>();
  addIds(ids, scenario.roles, "roles", errors);
  addIds(ids, scenario.environment.objects, "environment.objects", errors);
  addIds(ids, scenario.channels, "channels", errors);
  addIds(ids, scenario.reports, "reports", errors);
  addIds(ids, scenario.events, "events", errors);
  addIds(ids, scenario.rules, "rules", errors);
  addIds(ids, scenario.decisions, "decisions", errors);
  addIds(ids, scenario.objectives, "objectives", errors);
  addIds(ids, scenario.scoring, "scoring", errors);

  const roleIds = new Set(scenario.roles.map((role) => role.id));
  const objectIds = new Set(scenario.environment.objects.map((object) => object.id));
  const channelIds = new Set(scenario.channels.map((channel) => channel.id));
  const reportIds = new Set(scenario.reports.map((report) => report.id));
  const decisionIds = new Set(scenario.decisions.map((decision) => decision.id));
  const objectiveIds = new Set(scenario.objectives.map((objective) => objective.id));
  const dimensionIds = new Set(scenario.scoring.map((dimension) => dimension.id));

  scenario.roles.forEach((role, index) => {
    if (!role.name.trim()) errors.push(issue("EMPTY_ROLE_NAME", `roles[${index}].name`, "Role name must not be empty."));
    role.visibility.objectIds.forEach((objectId) => {
      if (!objectIds.has(objectId)) errors.push(issue("UNKNOWN_OBJECT", `roles[${index}].visibility.objectIds`, `Unknown object ${objectId}.`));
    });
    role.visibility.reportIds.forEach((reportId) => {
      if (!reportIds.has(reportId)) errors.push(issue("UNKNOWN_REPORT", `roles[${index}].visibility.reportIds`, `Unknown report ${reportId}.`));
    });
  });

  scenario.environment.objects.forEach((object, index) => {
    const path = `environment.objects[${index}]`;
    for (const axis of ["x", "y", "z"] as const) {
      if (!Number.isFinite(object.transform.position[axis])) errors.push(issue("INVALID_POSITION", `${path}.transform.position.${axis}`, "Position must be finite."));
      if (!Number.isFinite(object.transform.scale[axis]) || object.transform.scale[axis] <= 0) errors.push(issue("INVALID_SCALE", `${path}.transform.scale.${axis}`, "Scale must be finite and greater than zero."));
    }
    if (!Number.isFinite(object.transform.rotationY)) errors.push(issue("INVALID_ROTATION", `${path}.transform.rotationY`, "Rotation must be finite."));
    if (object.physics) {
      if (!["fixed", "kinematic", "dynamic"].includes(object.physics.body)) errors.push(issue("INVALID_BODY", `${path}.physics.body`, "Choose a supported physics body."));
      if (!["box", "sphere", "capsule", "none"].includes(object.physics.collider)) errors.push(issue("INVALID_COLLIDER", `${path}.physics.collider`, "Choose a supported collider."));
    }
    if (object.properties?.roleId !== undefined && !roleIds.has(String(object.properties.roleId))) errors.push(issue("UNKNOWN_ROLE", `${path}.properties.roleId`, "Movement owner must be an existing role."));
  });

  validateChannelReferences(scenario.channels, roleIds, channelIds, errors);

  scenario.reports.forEach((report, index) => {
    if (!report.content.trim()) errors.push(issue("EMPTY_REPORT", `reports[${index}].content`, "Report content must not be empty."));
    if (report.targetRoles.length === 0) errors.push(issue("NO_RECIPIENTS", `reports[${index}].targetRoles`, "Report requires at least one recipient."));
    if (!roleIds.has(report.sourceRole)) errors.push(issue("UNKNOWN_ROLE", `reports[${index}].sourceRole`, `Unknown source role ${report.sourceRole}.`));
    if (!channelIds.has(report.channelId)) errors.push(issue("UNKNOWN_CHANNEL", `reports[${index}].channelId`, `Unknown channel ${report.channelId}.`));
    report.targetRoles.forEach((roleId) => {
      if (!roleIds.has(roleId)) errors.push(issue("UNKNOWN_ROLE", `reports[${index}].targetRoles`, `Unknown target role ${roleId}.`));
    });
    if (report.conflictsWith && (!reportIds.has(report.conflictsWith) || report.conflictsWith === report.id)) {
      errors.push(issue("UNKNOWN_REPORT", `reports[${index}].conflictsWith`, `Unknown conflict report ${report.conflictsWith}.`));
    }
    if (!isNonNegativeNumber(report.generatedAtSeconds)) errors.push(issue("INVALID_REPORT_TIME", `reports[${index}].generatedAtSeconds`, "Generated time must be non-negative."));
    if (!isNonNegativeNumber(report.freshnessSeconds)) errors.push(issue("INVALID_FRESHNESS", `reports[${index}].freshnessSeconds`, "Freshness must be non-negative."));
    if (report.reliability < 0 || report.reliability > 1 || !Number.isFinite(report.reliability)) {
      errors.push(issue("INVALID_RELIABILITY", `reports[${index}].reliability`, "Reliability must be between 0 and 1."));
    }
  });

  scenario.decisions.forEach((decision, index) => {
    if (!decision.title.trim()) errors.push(issue("EMPTY_DECISION_TITLE", `decisions[${index}].title`, "Decision title must not be empty."));
    if (decision.targetRoles.length === 0) errors.push(issue("NO_RECIPIENTS", `decisions[${index}].targetRoles`, "Decision requires at least one participant role."));
    const optionIds = new Set<string>();
    decision.options.forEach((option, optionIndex) => {
      if (!option.id.trim() || optionIds.has(option.id)) errors.push(issue("INVALID_OPTION_ID", `decisions[${index}].options[${optionIndex}].id`, "Option IDs must be non-empty and unique within the decision."));
      optionIds.add(option.id);
      if (!option.label.trim()) errors.push(issue("EMPTY_OPTION_LABEL", `decisions[${index}].options[${optionIndex}].label`, "Option label must not be empty."));
    });
    if (decision.options.length < 2) errors.push(issue("INSUFFICIENT_OPTIONS", `decisions[${index}].options`, "A decision must have at least two options."));
    decision.targetRoles.forEach((roleId) => {
      if (!roleIds.has(roleId)) errors.push(issue("UNKNOWN_ROLE", `decisions[${index}].targetRoles`, `Unknown target role ${roleId}.`));
    });
    if (decision.activation.type === "time" && (!isNonNegativeNumber(decision.activation.atSeconds) || decision.activation.atSeconds > scenario.metadata.durationSeconds)) {
      errors.push(issue("INVALID_ACTIVATION_TIME", `decisions[${index}].activation.atSeconds`, "Decision activation must occur within the scenario duration."));
    }
    if (decision.timeLimitSeconds !== undefined && !isNonNegativeNumber(decision.timeLimitSeconds)) {
      errors.push(issue("INVALID_DECISION_LIMIT", `decisions[${index}].timeLimitSeconds`, "Decision time limit must be non-negative."));
    }
    if (decision.activation.type === "time" && !scenario.events.some((event) => event.type === "decision-gate" && event.decisionId === decision.id && event.atSeconds === decision.activation.atSeconds)) errors.push(issue("MISSING_DECISION_EVENT", `decisions[${index}].activation`, "Timed decisions require a matching scheduled decision-gate event."));
    if (decision.activation.type === "trigger") {
      const activatingRules = scenario.rules.filter((rule) => rule.actions.some((action) => action.type === "activate-decision" && action.decisionId === decision.id));
      if (activatingRules.length === 0 || decision.activation.triggerRuleId && !activatingRules.some((rule) => rule.id === decision.activation.triggerRuleId)) errors.push(issue("MISSING_ACTIVATING_RULE", `decisions[${index}].activation`, "Choose a rule with an activate-decision action referencing this decision."));
    }
  });

  scenario.scoring.forEach((dimension, index) => {
    if (!dimension.name.trim()) errors.push(issue("EMPTY_DIMENSION_NAME", `scoring[${index}].name`, "Scoring dimension requires a name."));
    if (!isNonNegativeNumber(dimension.weight)) errors.push(issue("INVALID_WEIGHT", `scoring[${index}].weight`, "Scoring weight must be finite and non-negative."));
  });
  if (scenario.scoring.length > 0 && !scenario.scoring.some((dimension) => dimension.weight > 0)) errors.push(issue("ZERO_SCORING_WEIGHT", "scoring", "At least one scoring dimension must have a positive weight."));
  validateEvents(scenario.events, reportIds, channelIds, objectIds, decisionIds, objectiveIds, roleIds, scenario.metadata.durationSeconds, errors);
  validateRules(scenario.rules, roleIds, channelIds, reportIds, decisionIds, objectIds, objectiveIds, dimensionIds, scenario.decisions, scenario.metadata.durationSeconds, errors);

  if (!scenario.events.some((event) => event.type === "scenario-end")) {
    errors.push(issue("MISSING_COMPLETION_EVENT", "events", "Scenario requires at least one scenario-end event."));
  }
  if (!scenario.events.some((event) => event.atSeconds === 0)) {
    warnings.push(issue("NO_START_EVENT", "events", "No event is scheduled at time zero."));
  }
  if (scenario.rules.length === 0) {
    warnings.push(issue("NO_RULES", "rules", "Scenario has no trigger-condition-action rules."));
  }
  if (scenario.scoring.length === 0) {
    errors.push(issue("NO_SCORING", "scoring", "Published scenarios require at least one scoring dimension."));
  }

  return { valid: errors.length === 0, errors, warnings };
}

export class ScenarioValidationError extends Error {
  constructor(public readonly result: ValidationResult) {
    super(`Scenario validation failed with ${result.errors.length} error(s).`);
    this.name = "ScenarioValidationError";
  }
}

export function assertValidScenario(scenario: ScenarioDefinition): void {
  const result = validateScenario(scenario);
  if (!result.valid) throw new ScenarioValidationError(result);
}
