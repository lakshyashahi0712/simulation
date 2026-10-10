import { useEffect, useState, type ReactNode } from "react";
import type { DecisionGate, ReportTemplate, ScenarioDefinition, ScenarioEvent } from "../../src/domain/scenario.js";
import { defaultAction, defaultEvent, defaultTrigger, nextScenarioId, putDecision, scenarioReferences, syncReportVisibility } from "../../src/domain/authoring.js";
import { NodeFields, NumberField, SelectField, patchNode } from "./ForgeFields.js";
import { RuleGraphEditor } from "./RuleGraphEditor.js";
export { ScalarField } from "./ForgeFields.js";

type ChangeScenario = (update: (scenario: ScenarioDefinition) => ScenarioDefinition) => void;

const EVENTS: ScenarioEvent["type"][] = ["message", "channel-fault", "channel-restore", "state-change", "instructor-alert", "objective-update", "scenario-end"];
const OBJECTIVE_STATES = ["pending", "active", "completed", "failed"];
const labelFor = (value: string) => value.replaceAll("-", " ");

function RoleSelection({ scenario, selected, onChange, label = "Recipients" }: {
  scenario: ScenarioDefinition; selected: string[]; onChange: (ids: string[]) => void; label?: string;
}) {
  return <fieldset className="forge-role-selection"><legend>{label}</legend>{scenario.roles.map((role) =>
    <label key={role.id}><input type="checkbox" checked={selected.includes(role.id)} onChange={(event) => onChange(event.target.checked ? [...selected, role.id] : selected.filter((id) => id !== role.id))} />{role.name}</label>
  )}</fieldset>;
}

function EntityCard({ title, id, children, open = false }: { title: string; id: string; children: ReactNode; open?: boolean }) {
  return <details className="forge-entity" data-entity-id={id} open={open}><summary><strong>{title || "Untitled"}</strong><code>{id}</code></summary><div className="forge-entity-body">{children}</div></details>;
}

function DeleteControl({ scenario, id, label, onDelete, decisionId, blocked = false }: {
  scenario: ScenarioDefinition; id: string; label: string; onDelete: () => void; decisionId?: string; blocked?: boolean;
}) {
  const references = scenarioReferences(scenario, id, decisionId);
  return <div className="forge-delete"><button className="button button-ghost danger-button" disabled={blocked || references.length > 0} onClick={onDelete}>{label}</button>
    {references.length > 0 && <small>Referenced by {references.join(", ")}. Change those references first.</small>}</div>;
}

function ReportsEditor({ scenario, onChange }: { scenario: ScenarioDefinition; onChange: ChangeScenario }) {
  function update(report: ReportTemplate) {
    onChange((current) => syncReportVisibility({ ...current, reports: current.reports.map((item) => item.id === report.id ? report : item) }));
  }
  function add() {
    onChange((current) => syncReportVisibility({ ...current, reports: [...current.reports, {
      id: nextScenarioId(current, "report"), sourceRole: current.roles.find((role) => role.kind === "operations")?.id ?? current.roles[0]?.id ?? "",
      channelId: current.channels[0]?.id ?? "", targetRoles: current.roles.slice(0, 1).map((role) => role.id), domain: "general", priority: "routine",
      generatedAtSeconds: 0, content: "New field observation. Replace this with the information trainees should receive.", freshnessSeconds: 60, reliability: 1
    }] }));
  }
  return <>
    <p className="panel-copy">Reports are reusable evidence. Schedule a delivery here or send one from a rule; unscheduled reports stay hidden until sent.</p>
    <button className="button button-secondary" onClick={add}>+ Add report</button>
    {scenario.reports.map((report, index) => <EntityCard key={report.id} id={report.id} title={`${report.priority.toUpperCase()} / ${report.content.slice(0, 72)}`} open={index === 0}>
      <div className="forge-fields">
        <SelectField label="Source role" value={report.sourceRole} choices={scenario.roles} onChange={(sourceRole) => update({ ...report, sourceRole })} />
        <SelectField label="Delivery channel" value={report.channelId} choices={scenario.channels} onChange={(channelId) => update({ ...report, channelId })} />
        <SelectField label="Domain" value={report.domain} choices={["land", "air", "cyber", "ew", "logistics", "medical", "general"].map((id) => ({ id }))} onChange={(domain) => update({ ...report, domain: domain as ReportTemplate["domain"] })} />
        <SelectField label="Priority" value={report.priority} choices={["routine", "priority", "critical"].map((id) => ({ id }))} onChange={(priority) => update({ ...report, priority: priority as ReportTemplate["priority"] })} />
        <NumberField label="Observation time (s)" value={report.generatedAtSeconds} onChange={(generatedAtSeconds) => update({ ...report, generatedAtSeconds: generatedAtSeconds ?? 0 })} />
        <NumberField label="Freshness window (s)" value={report.freshnessSeconds} onChange={(freshnessSeconds) => update({ ...report, freshnessSeconds: freshnessSeconds ?? 0 })} />
        <NumberField label="Reliability (0–1)" value={report.reliability} max={1} step={0.05} onChange={(reliability) => update({ ...report, reliability: reliability ?? 0 })} />
        <SelectField label="Conflicts with" value={report.conflictsWith ?? ""} optional choices={scenario.reports.filter((item) => item.id !== report.id)} onChange={(conflictsWith) => { const next = { ...report }; if (conflictsWith) next.conflictsWith = conflictsWith; else delete next.conflictsWith; update(next); }} />
      </div>
      <RoleSelection scenario={scenario} selected={report.targetRoles} onChange={(targetRoles) => update({ ...report, targetRoles })} />
      <label>Report content<textarea rows={3} value={report.content} onChange={(event) => update({ ...report, content: event.target.value })} /></label>
      <div className="forge-schedule">{scenario.events.filter((event) => event.type === "message" && event.reportId === report.id).map((event) => <span key={event.id}>Delivery at {event.atSeconds}s</span>)}
        <button className="button button-ghost" onClick={() => onChange((current) => ({ ...current, events: [...current.events, { id: nextScenarioId(current, "report-event"), type: "message", atSeconds: report.generatedAtSeconds, reportId: report.id }] }))}>+ Schedule delivery</button>
      </div>
      <DeleteControl scenario={scenario} id={report.id} label="Delete report" onDelete={() => onChange((current) => syncReportVisibility({ ...current, reports: current.reports.filter((item) => item.id !== report.id) }))} />
    </EntityCard>)}
  </>;
}

function DecisionsEditor({ scenario, onChange }: { scenario: ScenarioDefinition; onChange: ChangeScenario }) {
  const update = (decision: DecisionGate) => onChange((current) => putDecision(current, decision));
  return <>
    <p className="panel-copy">Timed decisions update their executable timeline event automatically. Triggered decisions are activated by a rule action.</p>
    <button className="button button-secondary" onClick={() => onChange((current) => {
      const id = nextScenarioId(current, "decision");
      return putDecision(current, { id, title: "New coordination decision", targetRoles: current.roles.slice(0, 1).map((role) => role.id), activation: { type: "time", atSeconds: Math.min(120, current.metadata.durationSeconds) }, options: [{ id: `${id}-option-1`, label: "Request verification" }, { id: `${id}-option-2`, label: "Use an available backup" }], requireRationale: true, requireConfidence: true, timeLimitSeconds: 60 });
    })}>+ Add decision</button>
    {scenario.decisions.map((decision, index) => <EntityCard key={decision.id} id={decision.id} title={decision.title} open={index === 0}>
      <label>Decision title<input value={decision.title} onChange={(event) => update({ ...decision, title: event.target.value })} /></label>
      <RoleSelection scenario={scenario} selected={decision.targetRoles} onChange={(targetRoles) => update({ ...decision, targetRoles })} />
      <div className="forge-fields">
        <SelectField label="Activation" value={decision.activation.type} choices={[{ id: "time", name: "Scheduled time" }, { id: "trigger", name: "Rule action" }]} onChange={(type) => update({ ...decision, activation: type === "time" ? { type, atSeconds: Math.min(120, scenario.metadata.durationSeconds) } : { type: "trigger" } })} />
        {decision.activation.type === "time" ? <NumberField label="Activation time (s)" value={decision.activation.atSeconds} max={scenario.metadata.durationSeconds} onChange={(atSeconds) => update({ ...decision, activation: { type: "time", atSeconds: atSeconds ?? 0 } })} />
          : <SelectField label="Activating rule" value={decision.activation.triggerRuleId ?? ""} choices={scenario.rules.filter((rule) => rule.actions.some((action) => action.type === "activate-decision" && action.decisionId === decision.id))} onChange={(triggerRuleId) => update({ ...decision, activation: triggerRuleId ? { type: "trigger", triggerRuleId } : { type: "trigger" } })} />}
        <NumberField label="Time limit (s)" value={decision.timeLimitSeconds} optional onChange={(timeLimitSeconds) => { const next = { ...decision }; if (timeLimitSeconds === undefined) delete next.timeLimitSeconds; else next.timeLimitSeconds = timeLimitSeconds; update(next); }} />
      </div>
      <div className="forge-checks"><label><input type="checkbox" checked={decision.requireRationale} onChange={(event) => update({ ...decision, requireRationale: event.target.checked })} />Require rationale</label><label><input type="checkbox" checked={decision.requireConfidence} onChange={(event) => update({ ...decision, requireConfidence: event.target.checked })} />Require confidence</label></div>
      <h4>Decision options</h4>
      {decision.options.map((option) => <div className="forge-option" key={option.id}><label>Option label<input value={option.label} onChange={(event) => update({ ...decision, options: decision.options.map((item) => item.id === option.id ? { ...item, label: event.target.value } : item) })} /><small>{option.id}</small></label>
        <DeleteControl scenario={scenario} id={option.id} decisionId={decision.id} blocked={decision.options.length <= 2} label="Remove option" onDelete={() => update({ ...decision, options: decision.options.filter((item) => item.id !== option.id) })} />
      </div>)}
      <button className="button button-ghost" onClick={() => update({ ...decision, options: [...decision.options, { id: nextScenarioId(scenario, `${decision.id}-option`), label: "New option" }] })}>+ Add option</button>
      <DeleteControl scenario={{ ...scenario, events: scenario.events.filter((event) => event.type !== "decision-gate" || event.decisionId !== decision.id) }} id={decision.id} label="Delete decision" onDelete={() => onChange((current) => ({ ...current, decisions: current.decisions.filter((item) => item.id !== decision.id), events: current.events.filter((event) => event.type !== "decision-gate" || event.decisionId !== decision.id) }))} />
    </EntityCard>)}
  </>;
}

function RulesEditor({ scenario, onChange, readOnly, focusPath }: { scenario: ScenarioDefinition; onChange: ChangeScenario; readOnly: boolean; focusPath?: string | undefined }) {
  return <>
    <p className="panel-copy">WHEN a trigger fires, IF every condition matches, THEN run the actions in order. IDs stay fixed so existing references remain intact.</p>
    <button className="button button-secondary" disabled={readOnly} onClick={() => onChange((current) => ({ ...current, rules: [...current.rules, { id: nextScenarioId(current, "rule"), trigger: defaultTrigger("time-reached", current), conditions: [], actions: [defaultAction("send-instructor-alert", current)], once: true }] }))}>+ Add rule</button>
    {scenario.rules.map((rule, index) => <EntityCard key={rule.id} id={rule.id} title={`When ${labelFor(rule.trigger.type)} → ${rule.actions.map((action) => labelFor(action.type)).join(", ")}`} open={index === 0}>
      <details className="rule-overview"><summary>Rule overview / WHEN · IF · THEN</summary><ol className="forge-rule-flow" aria-label={`Rule flow ${rule.id}`}>
        <li><strong>WHEN</strong><span>{labelFor(rule.trigger.type)}</span><code>{Object.entries(rule.trigger).filter(([key]) => key !== "type").map(([key, value]) => `${key}: ${value}`).join(" · ")}</code></li>
        <li><strong>IF</strong><span>{rule.conditions.length ? `${rule.conditions.length} condition(s), all required` : "Always"}</span>{rule.conditions.map((condition, i) => <code key={i}>{labelFor(condition.type)}</code>)}</li>
        <li><strong>THEN</strong>{rule.actions.map((action, i) => <span key={i}>{i + 1}. {labelFor(action.type)}</span>)}<code>{rule.once ? "Once" : "Repeat on later triggers"}</code></li>
      </ol></details>
      <RuleGraphEditor rule={rule} scenario={scenario} readOnly={readOnly} focusPath={focusPath} onChange={(update) => { if (!readOnly) onChange((current) => ({ ...current, rules: current.rules.map((item) => item.id === rule.id ? update(item) : item) })); }} />
      <DeleteControl scenario={scenario} id={rule.id} blocked={readOnly} label="Delete rule" onDelete={() => onChange((current) => ({ ...current, rules: current.rules.filter((item) => item.id !== rule.id) }))} />
    </EntityCard>)}
  </>;
}

function EventsEditor({ scenario, onChange }: { scenario: ScenarioDefinition; onChange: ChangeScenario }) {
  const [type, setType] = useState<ScenarioEvent["type"]>("message");
  const update = (event: ScenarioEvent) => onChange((current) => ({ ...current, events: current.events.map((item) => item.id === event.id ? event : item) }));
  return <>
    <p className="panel-copy">Schedule report delivery, communication faults, recovery, state changes, alerts, and completion. Decision timing is edited in Decisions.</p>
    <div className="forge-add-row"><SelectField label="New event type" value={type} choices={EVENTS.map((id) => ({ id }))} onChange={(next) => setType(next as ScenarioEvent["type"])} /><button className="button button-secondary" onClick={() => onChange((current) => ({ ...current, events: [...current.events, defaultEvent(type, current, nextScenarioId(current, "event"))] }))}>+ Add event</button></div>
    {[...scenario.events].sort((a, b) => a.atSeconds - b.atSeconds).map((event) => <EntityCard key={event.id} id={event.id} title={`${event.atSeconds}s / ${labelFor(event.type)}`}>
      {event.type === "decision-gate" ? <p className="panel-copy">{event.decisionId}: edit its activation time in Decisions.</p> : <>
        <NumberField label="Event time (s)" value={event.atSeconds} max={scenario.metadata.durationSeconds} onChange={(atSeconds) => update({ ...event, atSeconds: atSeconds ?? 0 })} />
        <NodeFields node={event} scenario={scenario} onPatch={(patch) => update(patchNode(event, patch))} />
        <button className="button button-ghost danger-button" disabled={event.type === "scenario-end" && scenario.events.filter((item) => item.type === "scenario-end").length <= 1} onClick={() => onChange((current) => ({ ...current, events: current.events.filter((item) => item.id !== event.id) }))}>Delete event</button>
      </>}
    </EntityCard>)}
  </>;
}

function ChannelsEditor({ scenario, onChange }: { scenario: ScenarioDefinition; onChange: ChangeScenario }) {
  return <><p className="panel-copy">Choose who shares each channel and which backup remains available during a fault.</p>
    <button className="button button-secondary" onClick={() => onChange((current) => ({ ...current, channels: [...current.channels, { id: nextScenarioId(current, "channel"), name: "New Channel", kind: "team", participants: current.roles.map((role) => role.id), baseLatencyMs: 0, reliability: 1, status: "active" }] }))}>+ Add channel</button>
    {scenario.channels.map((channel, index) => {
      const update = (patch: Partial<typeof channel>) => onChange((current) => ({ ...current, channels: current.channels.map((item) => item.id === channel.id ? { ...item, ...patch } : item) }));
      return <EntityCard key={channel.id} id={channel.id} title={channel.name} open={index === 0}>
        <div className="forge-fields"><label>Channel name<input value={channel.name} onChange={(event) => update({ name: event.target.value })} /></label>
          <SelectField label="Channel kind" value={channel.kind} choices={["team", "broadcast", "private", "voice"].map((id) => ({ id }))} onChange={(kind) => update({ kind: kind as typeof channel.kind })} />
          <NumberField label="Base latency (ms)" value={channel.baseLatencyMs} onChange={(baseLatencyMs) => update({ baseLatencyMs: baseLatencyMs ?? 0 })} />
          <NumberField label="Channel reliability (0–1)" value={channel.reliability} max={1} step={0.05} onChange={(reliability) => update({ reliability: reliability ?? 0 })} />
          <SelectField label="Initial status" value={channel.status} choices={[{ id: "active" }, { id: "inactive" }]} onChange={(status) => update({ status: status as typeof channel.status })} />
          <SelectField label="Backup channel" value={channel.backupChannelId ?? ""} optional choices={scenario.channels.filter((item) => item.id !== channel.id)} onChange={(backupChannelId) => onChange((current) => ({ ...current, channels: current.channels.map((item) => { if (item.id !== channel.id) return item; const next = { ...item }; if (backupChannelId) next.backupChannelId = backupChannelId; else delete next.backupChannelId; return next; }) }))} />
        </div><RoleSelection scenario={scenario} selected={channel.participants} label="Channel participants" onChange={(participants) => update({ participants })} />
        <DeleteControl scenario={scenario} id={channel.id} label="Delete channel" onDelete={() => onChange((current) => ({ ...current, channels: current.channels.filter((item) => item.id !== channel.id) }))} />
      </EntityCard>;
    })}
  </>;
}

function GoalsEditor({ scenario, onChange }: { scenario: ScenarioDefinition; onChange: ChangeScenario }) {
  return <>
    <h3>Scoring dimensions</h3><p className="panel-copy">Weights shape the after-action score. Rule score actions must reference one of these dimensions.</p>
    <button className="button button-secondary" onClick={() => onChange((current) => { const id = nextScenarioId(current, "score"); return { ...current, scoring: [...current.scoring, { id, name: "Custom training outcome", description: "Explain the evidence that earns this score.", weight: 0.2 }], aar: { ...current.aar, metrics: [...current.aar.metrics, id] } }; })}>+ Add scoring dimension</button>
    {scenario.scoring.map((dimension) => <EntityCard key={dimension.id} id={dimension.id} title={`${dimension.name} / weight ${dimension.weight}`}>
      <label>Dimension name<input value={dimension.name} onChange={(event) => onChange((current) => ({ ...current, scoring: current.scoring.map((item) => item.id === dimension.id ? { ...item, name: event.target.value } : item) }))} /></label>
      <label>Score description<textarea value={dimension.description} onChange={(event) => onChange((current) => ({ ...current, scoring: current.scoring.map((item) => item.id === dimension.id ? { ...item, description: event.target.value } : item) }))} /></label>
      <NumberField label="Weight" value={dimension.weight} step={0.05} onChange={(weight) => onChange((current) => ({ ...current, scoring: current.scoring.map((item) => item.id === dimension.id ? { ...item, weight: weight ?? 0 } : item) }))} />
      <DeleteControl scenario={{ ...scenario, aar: { ...scenario.aar, metrics: [] } }} id={dimension.id} label="Delete dimension" blocked={scenario.scoring.length <= 1} onDelete={() => onChange((current) => ({ ...current, scoring: current.scoring.filter((item) => item.id !== dimension.id), aar: { ...current.aar, metrics: current.aar.metrics.filter((id) => id !== dimension.id) } }))} />
    </EntityCard>)}
    <h3>Exercise objectives</h3><button className="button button-secondary" onClick={() => onChange((current) => ({ ...current, objectives: [...current.objectives, { id: nextScenarioId(current, "objective"), title: "New training objective", description: "Describe the desired outcome.", status: "active" }] }))}>+ Add objective</button>
    {scenario.objectives.map((objective) => <EntityCard key={objective.id} id={objective.id} title={objective.title}>
      <label>Objective title<input value={objective.title} onChange={(event) => onChange((current) => ({ ...current, objectives: current.objectives.map((item) => item.id === objective.id ? { ...item, title: event.target.value } : item) }))} /></label>
      <label>Objective description<textarea value={objective.description} onChange={(event) => onChange((current) => ({ ...current, objectives: current.objectives.map((item) => item.id === objective.id ? { ...item, description: event.target.value } : item) }))} /></label>
      <SelectField label="Starting objective status" value={objective.status} choices={OBJECTIVE_STATES.map((id) => ({ id }))} onChange={(status) => onChange((current) => ({ ...current, objectives: current.objectives.map((item) => item.id === objective.id ? { ...item, status: status as typeof objective.status } : item) }))} />
      <DeleteControl scenario={scenario} id={objective.id} label="Delete objective" onDelete={() => onChange((current) => ({ ...current, objectives: current.objectives.filter((item) => item.id !== objective.id) }))} />
    </EntityCard>)}
  </>;
}

export function ForgeAuthoring({ scenario, onChange, busy, focusPath }: { scenario: ScenarioDefinition; onChange: ChangeScenario; busy: boolean; focusPath?: string | undefined }) {
  const [tab, setTab] = useState("reports");
  const tabs = [
    ["reports", `Reports (${scenario.reports.length})`], ["decisions", `Decisions (${scenario.decisions.length})`],
    ["rules", `Rules (${scenario.rules.length})`], ["events", `Timeline (${scenario.events.length})`],
    ["channels", `Channels (${scenario.channels.length})`], ["goals", "Scoring & objectives"]
  ];
  useEffect(() => {
    if (!focusPath) return;
    const match = /^(reports|decisions|rules|events|channels|scoring|objectives)\[(\d+)\]/.exec(focusPath);
    if (!match) return;
    const collection = match[1] as "reports" | "decisions" | "rules" | "events" | "channels" | "scoring" | "objectives";
    setTab(collection === "scoring" || collection === "objectives" ? "goals" : collection);
    const id = scenario[collection][Number(match[2])]?.id;
    const frame = requestAnimationFrame(() => {
      const card = [...document.querySelectorAll<HTMLElement>(".forge-entity")].find((element) => element.dataset.entityId === id);
      if (card instanceof HTMLDetailsElement) { card.open = true; card.scrollIntoView({ block: "center" }); if (collection !== "rules") card.querySelector<HTMLInputElement>("input, select, textarea")?.focus(); }
    });
    return () => cancelAnimationFrame(frame);
  }, [focusPath]);
  return <section className="panel forge-authoring" aria-label="Scenario logic editor">
    <div className="panel-title"><div><p className="eyebrow">NO-CODE SCENARIO LOGIC</p><h3>Shape the evidence and its consequences.</h3></div></div>
    {scenario.status === "published" && <p className="panel-copy">This published version is read-only. Duplicate it to edit a new draft.</p>}
    <div className="forge-tabs" role="tablist" aria-label="Scenario authoring sections">{tabs.map(([id, label], index) => <button key={id} id={`forge-tab-${id}`} role="tab" tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} aria-controls="forge-authoring-panel" className={tab === id ? "selected" : ""} onClick={() => setTab(id!)} onKeyDown={(event) => {
      const nextIndex = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : undefined;
      if (nextIndex === undefined) return;
      event.preventDefault();
      const nextTab = tabs[nextIndex]![0]!;
      setTab(nextTab);
      document.getElementById(`forge-tab-${nextTab}`)?.focus();
    }}>{label}</button>)}</div>
    <fieldset id="forge-authoring-panel" role="tabpanel" aria-labelledby={`forge-tab-${tab}`} className="forge-authoring-content" disabled={busy || scenario.status === "published" && tab !== "rules"}>
      {tab === "reports" && <ReportsEditor scenario={scenario} onChange={onChange} />}
      {tab === "decisions" && <DecisionsEditor scenario={scenario} onChange={onChange} />}
      {tab === "rules" && <RulesEditor scenario={scenario} onChange={onChange} readOnly={busy || scenario.status === "published"} focusPath={focusPath} />}
      {tab === "events" && <EventsEditor scenario={scenario} onChange={onChange} />}
      {tab === "channels" && <ChannelsEditor scenario={scenario} onChange={onChange} />}
      {tab === "goals" && <GoalsEditor scenario={scenario} onChange={onChange} />}
    </fieldset>
  </section>;
}
