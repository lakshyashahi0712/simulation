import { useEffect, useMemo, useRef, useState } from "react";
import type { CounterfactualBranch, CounterfactualComparison, PerceptionSnapshot, RecordedEvent } from "../../src/domain/runtime.js";
import type { SessionAar, SessionView } from "../../src/server/protocol.js";
import { reconstructPerception } from "../../src/engine/perception-replay.js";

const timeLabel = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

function Title({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <div className="panel-title"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div></div>;
}

function ReportEvidence({ perception }: { perception: PerceptionSnapshot }) {
  return <div className="truthlens-report-list">
    {perception.reports.length === 0 && <p className="panel-copy">No report had arrived for this role yet.</p>}
    {perception.reports.map((report) => <article className="truthlens-report" key={report.reportId}>
      <strong>{report.reportId}</strong><p>{report.content}</p>
      <span>{report.status} · generated {timeLabel(report.generatedAtSeconds)} · received {timeLabel(report.receivedAtSeconds)} · transport delay {report.delayMs} ms</span>
      {report.conflictsWith && <span>Conflicts with {report.conflictsWith}</span>}
    </article>)}
    {(perception.textMessages ?? []).map((message) => <article className="truthlens-report" key={message.messageId}>
      <strong>{message.senderRole} / {message.channelId}</strong><p>{message.content}</p>
      <span>Sent {timeLabel(message.generatedAtSeconds)} · received {timeLabel(message.receivedAtSeconds)}</span>
    </article>)}
  </div>;
}

function Events({ events }: { events: RecordedEvent[] }) {
  return <div className="event-list truthlens-events">{events.map((event) => <details key={event.sequence} className="replay-event">
    <summary>{timeLabel(event.simulationTimeSeconds)} · {event.type.replaceAll("_", " ")} · #{event.sequence}{event.roleId ? ` / ${event.roleId}` : ""}</summary>
    <pre>{JSON.stringify(event.payload, null, 2)}</pre>
    {event.causedByEventId && <small>Caused by {event.causedByEventId}</small>}
  </details>)}</div>;
}

function InformationFlow({ events, decisions }: { events: RecordedEvent[]; decisions: SessionAar["decisions"] }) {
  const reportIds = [...new Set(events.flatMap((event) => typeof event.payload.reportId === "string" ? [event.payload.reportId] : []))];
  return <div className="flow-graph"><div className="flow-graph-heading"><p className="eyebrow">INFORMATION FLOW / REPORT LIFECYCLES</p><span>{reportIds.length} reports · {decisions.length} decision checkpoints</span></div>
    {reportIds.length === 0 && <p className="panel-copy">No report events were recorded.</p>}
    {reportIds.map((reportId) => {
      const lifecycle = events.filter((event) => event.payload.reportId === reportId);
      const deliveredTo = lifecycle.filter((event) => event.type === "REPORT_DELIVERED").map((event) => event.roleId).filter(Boolean).join(", ") || "no role";
      const first = lifecycle[0];
      return <details key={reportId} className="flow-report"><summary><strong>{reportId}</strong><span>{lifecycle.map((event) => event.type.replace("REPORT_", "").toLowerCase()).join(" → ")}</span></summary>
        <p>Generated {first ? timeLabel(first.simulationTimeSeconds) : "—"} · delivered to {deliveredTo}</p>
        <div className="flow-events">{lifecycle.map((event) => <span key={event.id} className={`flow-event flow-${event.type.toLowerCase()}`}>{event.roleId ?? "ground truth"} / {event.type.replaceAll("_", " ")} / {timeLabel(event.simulationTimeSeconds)}</span>)}</div>
      </details>;
    })}
    <div className="flow-decisions"><strong>Decision checkpoints</strong>{decisions.length === 0 ? <span>No submitted decisions.</span> : decisions.map((decision) => <span key={decision.id}>{decision.decisionId} · {decision.optionId} · {decision.perceptionSnapshot.reports.length} reports available at {timeLabel(decision.submittedAtSeconds)}</span>)}</div>
  </div>;
}

export function TruthLensTimeline({ aar, roles }: { aar: SessionAar; roles: SessionView["scenario"]["roles"] }) {
  const [time, setTime] = useState(aar.simulationTimeSeconds);
  const [roleId, setRoleId] = useState(aar.roles[0]?.roleId ?? "");
  const perception = useMemo(() => reconstructPerception(aar.events, roleId, time, aar.reportTemplates), [aar, roleId, time]);
  const events = aar.events.filter((event) => event.simulationTimeSeconds <= time);
  const decisions = aar.decisions.filter((decision) => decision.submittedAtSeconds <= time && decision.roleId === roleId);
  const roleName = roles.find((role) => role.id === roleId)?.name ?? roleId;
  useEffect(() => { setTime(aar.simulationTimeSeconds); }, [aar]);
  return <section className="panel truthlens-panel">
    <Title eyebrow="TRUTHLENS / HISTORICAL REPLAY" title="Ground truth versus perception" />
    <div className="truthlens-controls">
      <label>Timeline <strong>{timeLabel(time)}</strong><input aria-label="Replay time" type="range" min="0" max={Math.max(1, aar.simulationTimeSeconds)} step="1" value={time} onChange={(event) => setTime(Number(event.target.value))} /></label>
      <label>Perception view<select value={roleId} onChange={(event) => setRoleId(event.target.value)}>{aar.roles.map((role) => <option key={role.roleId} value={role.roleId}>{roles.find((candidate) => candidate.id === role.roleId)?.name ?? role.roleId}</option>)}</select></label>
      <button className="button button-ghost" onClick={() => window.print()}>Print / PDF</button>
    </div>
    <p className="panel-copy">Snapshot at {timeLabel(time)} / {aar.scenarioTitle} v{aar.scenarioVersion}. Newer deliveries never replace the report shown at an earlier time.</p>
    <div className="truthlens-grid">
      <div><p className="eyebrow">GROUND-TRUTH EVENTS / {events.length}</p><Events events={[...events].reverse()} /></div>
      <div><p className="eyebrow">{roleName.toUpperCase()} PERCEPTION / {perception.reports.length} REPORTS</p><ReportEvidence perception={perception} />
        <p className="panel-copy">Active decisions: {perception.activeDecisionIds.join(", ") || "none"}</p>
        <p className="eyebrow provenance-label">DECISION PROVENANCE</p>
        {decisions.length === 0 && <p className="panel-copy">No decision submitted yet.</p>}
        {decisions.map((decision) => <details className="provenance-card" key={decision.id}>
          <summary>{decision.decisionId} / {decision.optionId} · {timeLabel(decision.submittedAtSeconds)}</summary>
          <p>{decision.rationale}</p><small>Confidence {decision.confidence === undefined ? "n/a" : `${Math.round(decision.confidence * 100)}%`} / exact decision-time evidence</small>
          <ReportEvidence perception={decision.perceptionSnapshot} />
        </details>)}
      </div>
    </div>
    <InformationFlow events={events} decisions={aar.decisions.filter((decision) => decision.submittedAtSeconds <= time)} />
  </section>;
}

export function CounterfactualPanel({ aar, gates, accessToken, apiBase }: { aar: SessionAar; gates: SessionView["scenario"]["decisions"]; accessToken: string; apiBase: string }) {
  const [decisionId, setDecisionId] = useState(aar.decisions[0]?.decisionId ?? "");
  const actual = aar.decisions.find((decision) => decision.decisionId === decisionId);
  const options = gates.find((gate) => gate.id === decisionId)?.options ?? [];
  const [optionId, setOptionId] = useState(options.find((option) => option.id !== actual?.optionId)?.id ?? "");
  const [rationale, setRationale] = useState("");
  const [result, setResult] = useState<CounterfactualComparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  useEffect(() => {
    requestId.current += 1;
    setBusy(false); setError(null);
    setOptionId(options.find((option) => option.id !== actual?.optionId)?.id ?? "");
    setRationale(""); setResult(null);
  }, [decisionId, aar]);

  async function compare() {
    const id = ++requestId.current;
    setBusy(true); setError(null); setResult(null);
    try {
      const response = await fetch(`${apiBase}/api/sessions/${aar.sessionId}/counterfactual`, {
        method: "POST", headers: { "content-type": "application/json", "x-access-token": accessToken },
        body: JSON.stringify({ decisionId, alternateOptionId: optionId, ...(rationale.trim() ? { rationale } : {}) })
      });
      const payload = await response.json() as CounterfactualComparison & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Unable to replay branch.");
      if (id === requestId.current) setResult(payload);
    } catch (failure) { if (id === requestId.current) setError(failure instanceof Error ? failure.message : "Replay failed."); }
    finally { if (id === requestId.current) setBusy(false); }
  }
  function exportComparison() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${aar.sessionId}-${decisionId}-comparison.json`; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="panel truthlens-panel comparison-panel">
    <Title eyebrow="TRUTHLENS / COUNTERFACTUAL" title="Replay an alternate decision" />
    {aar.decisions.length === 0 ? <p className="panel-copy">Submit a decision to compare its alternate branches.</p> : <>
      <div className="truthlens-controls">
        <label>Decision<select disabled={busy} value={decisionId} onChange={(event) => setDecisionId(event.target.value)}>{aar.decisions.map((decision) => <option key={decision.id} value={decision.decisionId}>{decision.decisionId} / {decision.roleId}</option>)}</select></label>
        <label>Alternate option<select disabled={busy} value={optionId} onChange={(event) => { setOptionId(event.target.value); setResult(null); }}>{options.map((option) => <option key={option.id} value={option.id}>{option.label}{option.id === actual?.optionId ? " (actual)" : ""}</option>)}</select></label>
        <button className="button button-primary" disabled={busy || !optionId} onClick={() => void compare()}>{busy ? "Replaying…" : "Compare branches"}</button>
      </div>
      <div className="comparison-rationale"><label>Alternate rationale (leave empty to keep the recorded rationale)<textarea rows={2} disabled={busy} value={rationale} onChange={(event) => { setRationale(event.target.value); setResult(null); }} /></label></div>
    </>}
    {error && <p className="error-copy" role="alert">{error}</p>}
    {result && <div className="comparison-body">
       <div className="comparison-summary" aria-label="Comparison summary"><div><span>Actual decision score</span><strong>{result.actualScore.toFixed(2)}</strong></div><div><span>Alternate decision score</span><strong>{result.alternateScore.toFixed(2)}</strong></div><div><span>Decision delta</span><strong className={result.delta < 0 ? "summary-negative" : "summary-delta"}>{result.delta.toFixed(2)}</strong></div></div>
      <details><summary>Decision-only scoring explanation (raw dimensions)</summary>{result.dimensions.map((dimension) => <div className="branch-score" key={dimension.dimensionId}>
        <div className="score-row"><span>{dimension.dimensionId}</span><strong>{dimension.actual.toFixed(2)} → {dimension.alternate.toFixed(2)}</strong></div><p>{dimension.reason}</p>
      </div>)}</details>
      {result.replayMode === "branch" && <p className="comparison-delta">Branch score delta: {(result.futureDelta ?? 0).toFixed(2)} (including immediate rule effects)</p>}
      <ul>{result.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
      <button className="button button-ghost" onClick={exportComparison}>Export comparison JSON</button>
      {result.actualBranch && result.alternateBranch && <div className="truthlens-grid"><Branch title="Actual option replay" branch={result.actualBranch} /><Branch title="Alternate option replay" branch={result.alternateBranch} /></div>}
    </div>}
  </section>;
}

function Branch({ title, branch }: { title: string; branch: CounterfactualBranch }) {
  return <div className="branch-evidence"><h3>{title}</h3>
    <p>{timeLabel(branch.fromSeconds)} → {timeLabel(branch.throughSeconds)} / {branch.ended ? "ended" : "open"} / weighted score {branch.score.total.toFixed(2)}</p>
    <p>{branch.events.length} events · {branch.skippedInputs.length} skipped input(s)</p>
    <details><summary>Score dimensions and evidence</summary>{branch.score.dimensions.map((dimension) => <div className="branch-score" key={dimension.dimensionId}>
      <div className="score-row"><span>{dimension.name} / weight {dimension.weight}</span><strong>{dimension.weighted.toFixed(2)}</strong></div>
      {dimension.events.map((event) => <p key={event.id}>{timeLabel(event.simulationTimeSeconds)} · {event.amount.toFixed(2)} raw · {event.reason}</p>)}
    </div>)}</details>
    {branch.skippedInputs.length > 0 && <ul>{branch.skippedInputs.map((input) => <li key={input.sequence}>#{input.sequence} {input.type}: {input.reason}</li>)}</ul>}
    <details><summary>Final object states</summary><pre>{JSON.stringify(branch.objectStates, null, 2)}</pre></details>
    {branch.perceptions.map((perception) => <details key={perception.roleId}><summary>{perception.roleId} / {perception.reports.length} reports</summary><ReportEvidence perception={perception} /></details>)}
    <Events events={branch.events} />
  </div>;
}
