import type { RuleAction, RuleCondition, RuleTrigger, ScenarioDefinition, ScenarioEvent } from "../../src/domain/scenario.js";

type Choice = { id: string; name?: string; title?: string; label?: string };
export type RuleNode = RuleTrigger | RuleCondition | RuleAction | ScenarioEvent;
const FAULTS = ["delay", "dropout", "conflict", "stale", "partial", "outage"];
const REPORT_STATUSES = ["delivered", "delayed", "dropped", "conflicting", "stale", "partial"];
const OBJECTIVE_STATES = ["pending", "active", "completed", "failed"];
const labelFor = (value: string) => value.replaceAll("-", " ");

export function SelectField({ label, value, choices, onChange, optional = false, fieldKey }: {
  label: string; value: string; choices: Choice[]; onChange: (value: string) => void; optional?: boolean; fieldKey?: string;
}) {
  const unknown = value !== "" && !choices.some((choice) => choice.id === value);
  return <label data-node-field={fieldKey}>{label}<select value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="" disabled={!optional}>{optional ? "Any / none" : "Select an item"}</option>
    {unknown && <option value={value}>Missing: {value}</option>}
    {choices.map((choice) => <option value={choice.id} key={choice.id}>{choice.name ?? choice.title ?? choice.label ?? labelFor(choice.id)}</option>)}
  </select></label>;
}

export function NumberField({ label, value, onChange, min = 0, max, step = 1, optional = false, fieldKey }: {
  label: string; value: number | undefined; onChange: (value: number | undefined) => void; min?: number; max?: number; step?: number; optional?: boolean; fieldKey?: string;
}) {
  return <label data-node-field={fieldKey}>{label}<input type="number" min={min} max={max} step={step} value={value ?? ""}
    placeholder={optional ? "No limit / override" : undefined}
    onChange={(event) => onChange(event.target.value === "" && optional ? undefined : Number(event.target.value))} /></label>;
}

export function ScalarField({ label, value, onChange, fieldKey }: { label: string; value: unknown; onChange: (value: unknown) => void; fieldKey?: string }) {
  const kind = typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : typeof value === "string" ? "text" : "structured";
  return <div className="forge-scalar" data-node-field={fieldKey}>
    <SelectField label={`${label} type`} value={kind} choices={[{ id: "text" }, { id: "number" }, { id: "boolean" }, ...(kind === "structured" ? [{ id: "structured", name: "Imported structured value" }] : [])]}
      onChange={(next) => onChange(next === "number" ? 0 : next === "boolean" ? false : "")} />
    {kind === "boolean" ? <SelectField label={label} value={String(value)} choices={[{ id: "true" }, { id: "false" }]} onChange={(next) => onChange(next === "true")} />
      : kind === "number" ? <NumberField label={label} value={value as number} min={-Number.MAX_VALUE} step={0.1} onChange={(next) => onChange(next ?? 0)} />
        : <label>{label}<input value={kind === "structured" ? JSON.stringify(value) ?? "null" : String(value ?? "")} readOnly={kind === "structured"} onChange={(event) => onChange(event.target.value)} /></label>}
  </div>;
}

export function NodeFields({ node, scenario, onPatch }: { node: RuleNode; scenario: ScenarioDefinition; onPatch: (patch: Record<string, unknown>) => void }) {
  const choices = (values: string[]) => values.map((id) => ({ id }));
  const reference = (key: string, label: string, items: Choice[], optional = false) => {
    const value = (node as unknown as Record<string, unknown>)[key];
    return <SelectField label={label} fieldKey={key} value={typeof value === "string" ? value : ""} choices={items} optional={optional} onChange={(next) => onPatch({ [key]: optional && !next ? undefined : next })} />;
  };
  const number = (key: string, label: string, optional = false, min = 0, step = 1) => {
    const value = (node as unknown as Record<string, unknown>)[key];
    return <NumberField label={label} fieldKey={key} value={typeof value === "number" ? value : undefined} optional={optional} min={min} step={step} onChange={(next) => onPatch({ [key]: next })} />;
  };
  const decisionId = "decisionId" in node ? node.decisionId : "";
  return <div className="forge-fields">
    {"objectId" in node && reference("objectId", "Object", scenario.environment.objects)}
    {"otherObjectId" in node && reference("otherObjectId", "Other object", scenario.environment.objects)}
    {"reportId" in node && reference("reportId", "Report", scenario.reports)}
    {"conflictsWith" in node && reference("conflictsWith", "Conflicting report", scenario.reports.filter((report) => !("reportId" in node) || report.id !== node.reportId))}
    {"channelId" in node && reference("channelId", "Channel", scenario.channels)}
    {"objectiveId" in node && reference("objectiveId", "Objective", scenario.objectives)}
    {"dimensionId" in node && reference("dimensionId", "Score dimension", scenario.scoring)}
    {"decisionId" in node && <SelectField label="Decision" fieldKey="decisionId" value={node.decisionId} choices={scenario.decisions} onChange={(next) => onPatch({ decisionId: next, ...((node.type === "selected-option" || node.type === "decision-submitted") ? { optionId: node.type === "selected-option" ? scenario.decisions.find((decision) => decision.id === next)?.options[0]?.id ?? "" : undefined } : {}) })} />}
    {(node.type === "selected-option" || node.type === "decision-submitted") && <SelectField label="Selected option" fieldKey="optionId" value={node.optionId ?? ""} optional={node.type === "decision-submitted"} choices={scenario.decisions.find((decision) => decision.id === decisionId)?.options ?? []} onChange={(next) => onPatch({ optionId: node.type === "decision-submitted" && !next ? undefined : next })} />}
    {(["role-is", "zone-entered", "message-received", "message-ignored", "decision-submitted"].includes(node.type)) && reference("roleId", "Role", scenario.roles, node.type !== "role-is")}
    {"property" in node && <label data-node-field="property">Property<input value={node.property} onChange={(event) => onPatch({ property: event.target.value })} /></label>}
    {"equals" in node && <ScalarField label="Expected value" fieldKey="equals" value={node.equals} onChange={(equals) => onPatch({ equals })} />}
    {"value" in node && <ScalarField label="New value" fieldKey="value" value={node.value} onChange={(value) => onPatch({ value })} />}
    {"fault" in node && reference("fault", "Fault", choices(FAULTS))}
    {(node.type === "send-report" || node.type === "delay-report" || node.type === "disable-channel" || node.type === "channel-fault") && number("delayMs", "Delivery delay (ms)", node.type !== "delay-report")}
    {(node.type === "disable-channel" || node.type === "channel-fault") && number("durationSeconds", "Fault duration (s)", true)}
    {node.type === "time-reached" && number("atSeconds", "Trigger time (s)")}
    {node.type === "report-age" && number("greaterThanSeconds", "Age greater than (s)")}
    {node.type === "decision-count" && number("greaterThanOrEqual", "At least this many decisions")}
    {node.type === "time-window" && <>{number("startSeconds", "Window start (s)")}{number("endSeconds", "Window end (s)")}</>}
    {node.type === "channel-state" && reference("state", "Channel state", choices(["active", "faulted"]))}
    {node.type === "report-status" && reference("status", "Delivery status", choices(REPORT_STATUSES))}
    {node.type === "objective-state" && reference("state", "Objective state", choices(OBJECTIVE_STATES))}
    {node.type === "objective-update" && reference("status", "Objective status", choices(OBJECTIVE_STATES))}
    {node.type === "instructor-injection" && reference("eventType", "Injection event", [{ id: "channel-fault", name: "Instructor channel-fault injection" }])}
    {"message" in node && <label data-node-field="message">Instructor message<textarea rows={2} value={node.message} onChange={(event) => onPatch({ message: event.target.value })} /></label>}
    {"reason" in node && <label data-node-field="reason">Reason<textarea rows={2} value={node.reason ?? ""} onChange={(event) => onPatch({ reason: event.target.value })} /></label>}
    {node.type === "add-score-event" && number("amount", "Score amount", false, -Number.MAX_VALUE, 0.1)}
  </div>;
}

export function patchNode<T extends RuleNode>(node: T, patch: Record<string, unknown>): T {
  const updated = { ...node, ...patch };
  for (const key of Object.keys(updated)) if ((updated as Record<string, unknown>)[key] === undefined) delete (updated as Record<string, unknown>)[key];
  return updated;
}
