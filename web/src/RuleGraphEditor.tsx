import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { RuleCondition, RuleGraphNodeKind, RuleTrigger, RuleAction, ScenarioDefinition, ScenarioRule } from "../../src/domain/scenario.js";
import { defaultAction, defaultCondition, defaultTrigger } from "../../src/domain/authoring.js";
import {
  addRuleGraphNode, arrangeRuleGraph, canConnectRuleGraphNodes, connectRuleGraphNodes,
  GRAPH_NODE_HEIGHT, GRAPH_NODE_WIDTH, GRAPH_POSITION_LIMIT, positionRuleGraphNode,
  removeRuleGraphNode, reorderRuleGraphNode, replaceRuleGraphNode, RULE_ACTION_TYPES,
  RULE_CONDITION_TYPES, RULE_TRIGGER_TYPES, toRuleGraph, type RuleGraphNode
} from "../../src/domain/rule-graph.js";
import { NodeFields, NumberField, SelectField, patchNode } from "./ForgeFields.js";
import "./rule-graph.css";

type RuleUpdate = (rule: ScenarioRule) => ScenarioRule;
interface Props { rule: ScenarioRule; scenario: ScenarioDefinition; readOnly: boolean; onChange: (update: RuleUpdate) => void; focusPath?: string | undefined }
interface Camera { x: number; y: number; scale: number }
interface Gesture { kind: "node" | "pan"; id: string; pointerId: number; element: HTMLElement; start: { x: number; y: number }; origin: { x: number; y: number }; position: { x: number; y: number } }
const nameFor = (value: string) => value.replaceAll("-", " ");
const nodeLabel = (node: RuleGraphNode) => node.kind === "trigger" ? "WHEN" : `${node.kind === "condition" ? "IF" : "THEN"} ${node.index + 1}`;

export function RuleGraphEditor(props: Props) {
  const { rule, scenario, readOnly, onChange, focusPath } = props;
  const graph = toRuleGraph(rule);
  const [selectedId, setSelectedId] = useState(graph.nodes[0]!.id);
  const selected = graph.nodes.find((node) => node.id === selectedId) ?? graph.nodes[0]!;
  const [camera, setCamera] = useState<Camera>({ x: 16, y: 16, scale: 0.75 });
  const [ghost, setGhost] = useState<{ id: string; position: { x: number; y: number } } | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [conditionType, setConditionType] = useState<RuleCondition["type"]>(rule.trigger.type === "decision-submitted" ? "selected-option" : "time-window");
  const [actionType, setActionType] = useState<RuleAction["type"]>("send-instructor-alert");
  const [notice, setNotice] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ nodeId: string; field: string | undefined } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const arrowId = `rule-arrow-${useId().replace(/[^a-z0-9_-]/gi, "")}`;
  const nodes = graph.nodes.map((node) => ghost?.id === node.id ? { ...node, position: ghost.position } : node);
  const width = Math.max(880, ...nodes.map((node) => node.position.x + GRAPH_NODE_WIDTH + 32));
  const height = Math.max(220, ...nodes.map((node) => node.position.y + GRAPH_NODE_HEIGHT + 32));

  function apply(update: RuleUpdate) {
    if (readOnly) return;
    try {
      update(rule); // Show command errors before entering a React state updater.
      onChange((current) => { try { return update(current); } catch { return current; } });
      setNotice(null);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to edit this rule."); }
  }
  function fit() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const current = toRuleGraph(latest.current.rule).nodes;
    const w = Math.max(880, ...current.map((node) => node.position.x + GRAPH_NODE_WIDTH + 32));
    const h = Math.max(220, ...current.map((node) => node.position.y + GRAPH_NODE_HEIGHT + 32));
    const scale = Math.max(0.1, Math.min(1, (viewport.clientWidth - 32) / w, (viewport.clientHeight - 32) / h));
    setCamera({ x: (viewport.clientWidth - w * scale) / 2, y: (viewport.clientHeight - h * scale) / 2, scale });
  }
  function focus(node = selected) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const scale = Math.max(cameraRef.current.scale, 0.85);
    setCamera({ x: viewport.clientWidth / 2 - (node.position.x + GRAPH_NODE_WIDTH / 2) * scale, y: viewport.clientHeight / 2 - (node.position.y + GRAPH_NODE_HEIGHT / 2) * scale, scale });
  }
  function zoom(factor: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setCamera((current) => {
      const scale = Math.max(0.1, Math.min(1.6, current.scale * factor));
      const x = viewport.clientWidth / 2, y = viewport.clientHeight / 2;
      return { scale, x: x - (x - current.x) * scale / current.scale, y: y - (y - current.y) * scale / current.scale };
    });
  }
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [rule.id]);

  useEffect(() => {
    pendingFocus.current = null;
    if (!focusPath) return;
    const match = /^rules\[(\d+)\](?:\.(trigger|conditions|actions)(?:\[(\d+)\])?)?/.exec(focusPath);
    if (!match || scenario.rules[Number(match[1])]?.id !== rule.id) return;
    const kind: RuleGraphNodeKind = match[2] === "conditions" ? "condition" : match[2] === "actions" ? "action" : "trigger";
    const node = graph.nodes.find((item) => item.kind === kind && item.index === Number(match[3] ?? 0)) ?? graph.nodes[0]!;
    const card = viewportRef.current?.closest(".forge-entity");
    if (card instanceof HTMLDetailsElement) card.open = true;
    pendingFocus.current = { nodeId: node.id, field: focusPath.split(".").at(-1) };
    setSelectedId(node.id);
    focus(node);
  }, [focusPath, rule.id]);

  useEffect(() => {
    // A frame after setSelectedId can precede React's commit. Wait for the
    // selected node's fields to render before resolving the focus target.
    const request = pendingFocus.current;
    if (!request || selected.id !== request.nodeId) return;
    const frame = requestAnimationFrame(() => {
      inspectorRef.current?.scrollIntoView({ block: "center" });
      const target = [...(inspectorRef.current?.querySelectorAll<HTMLElement>("[data-node-field]") ?? [])].find((element) => element.dataset.nodeField === request.field);
      (target ?? inspectorRef.current)?.querySelector<HTMLInputElement>("input,select,textarea")?.focus();
      pendingFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [focusPath, rule.id, selected.id]);

  function begin(event: ReactPointerEvent<HTMLElement>, kind: Gesture["kind"], node?: RuleGraphNode) {
    if (event.button !== 0 || kind === "node" && readOnly) return;
    if (kind === "pan" && event.target instanceof Element && event.target.closest(".rule-graph-node,button")) return;
    event.preventDefault(); event.stopPropagation();
    if (node) event.currentTarget.focus({ preventScroll: true });
    const origin = node?.position ?? { x: camera.x, y: camera.y };
    gesture.current = { kind, id: node?.id ?? "", pointerId: event.pointerId, element: event.currentTarget, start: { x: event.clientX, y: event.clientY }, origin, position: origin };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (node) setSelectedId(node.id);
  }
  function moveGesture(event: ReactPointerEvent<HTMLElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const divisor = active.kind === "node" ? cameraRef.current.scale : 1;
    let x = active.origin.x + (event.clientX - active.start.x) / divisor;
    let y = active.origin.y + (event.clientY - active.start.y) / divisor;
    if (active.kind === "node") {
      x = Math.max(0, Math.min(GRAPH_POSITION_LIMIT, x)); y = Math.max(0, Math.min(GRAPH_POSITION_LIMIT, y));
      active.position = { x, y }; setGhost({ id: active.id, position: active.position });
    } else setCamera((current) => ({ ...current, x, y }));
  }
  function finishGesture(cancel = false) {
    const active = gesture.current;
    gesture.current = null;
    setGhost(null);
    if (!active) return;
    if (active.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
    if (!cancel && active.kind === "node" && !latest.current.readOnly && (active.position.x !== active.origin.x || active.position.y !== active.origin.y)) apply((current) => positionRuleGraphNode(current, active.id, active.position));
  }
  function add(kind: "condition" | "action") {
    if (readOnly) return;
    try {
      const value = kind === "condition" ? conditionDefault(conditionType, rule, scenario) : defaultAction(actionType, scenario);
      const next = addRuleGraphNode(rule, kind, value);
      const added = toRuleGraph(next).nodes.find((node) => !graph.nodes.some((current) => current.id === node.id))!;
      apply((current) => addRuleGraphNode(current, kind, value));
      setConnecting(null); setSelectedId(added.id); focus(added);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to add this node."); }
  }
  function connect(source: string, target: string) {
    apply((current) => connectRuleGraphNodes(current, source, target));
    setConnecting(null); setSelectedId(target);
  }
  function replaceType(type: string) {
    const value = selected.kind === "trigger" ? defaultTrigger(type as RuleTrigger["type"], scenario) : selected.kind === "condition" ? conditionDefault(type as RuleCondition["type"], rule, scenario) : defaultAction(type as RuleAction["type"], scenario);
    apply((current) => replaceRuleGraphNode(current, selected.id, value));
  }
  const group = graph.nodes.filter((node) => node.kind === selected.kind);
  const predecessor = group[group.findIndex((node) => node.id === selected.id) - 1]?.id ?? "";
  const firstPredecessor = selected.kind === "action" ? graph.nodes.filter((node) => node.kind === "condition").at(-1)?.id ?? graph.nodes[0]!.id : graph.nodes[0]!.id;
  const removable = selected.kind !== "trigger" && (selected.kind !== "action" || rule.actions.length > 1);

  return <div className="rule-graph-editor" data-rule-id={rule.id} data-read-only={readOnly}>
    <fieldset className="rule-graph-toolbar" disabled={readOnly}>
      <SelectField label="New condition" value={conditionType} choices={RULE_CONDITION_TYPES.map((id) => ({ id }))} onChange={(value) => setConditionType(value as RuleCondition["type"])} />
      <button type="button" className="button button-ghost" disabled={readOnly} onClick={() => add("condition")}>+ Add condition node</button>
      <SelectField label="New action" value={actionType} choices={RULE_ACTION_TYPES.map((id) => ({ id }))} onChange={(value) => setActionType(value as RuleAction["type"])} />
      <button type="button" className="button button-ghost" disabled={readOnly} onClick={() => add("action")}>+ Add action node</button>
    </fieldset>
    <div className="rule-graph-tools"><button type="button" className="button button-ghost" onClick={fit}>Fit graph</button><button type="button" className="button button-ghost" onClick={() => focus()}>Focus node</button><button type="button" className="button button-ghost" aria-label="Zoom graph in" onClick={() => zoom(1.25)}>+</button><button type="button" className="button button-ghost" aria-label="Zoom graph out" onClick={() => zoom(0.8)}>−</button><span>{Math.round(camera.scale * 100)}%</span><button type="button" className="button button-ghost" disabled={readOnly} onClick={() => { apply(arrangeRuleGraph); requestAnimationFrame(fit); }}>Arrange nodes</button></div>
    {notice && <p className="rule-graph-notice" role="alert">{notice}</p>}
    <p className="rule-graph-help" role="status">{connecting ? "Choose a compatible input port to reconnect the sequence. Escape cancels." : "Drag a node header to arrange it; arrow keys move the focused header. Drag the background to pan. All IF nodes must match; THEN nodes run in numbered order."}</p>
    <div className="rule-graph-layout">
      <div className="rule-graph-viewport" ref={viewportRef} tabIndex={0} aria-label={`Rule graph workspace ${rule.id}`} onPointerDown={(event) => begin(event, "pan")} onPointerMove={moveGesture} onPointerUp={() => finishGesture()} onPointerCancel={() => finishGesture(true)} onLostPointerCapture={() => finishGesture(true)} onKeyDown={(event) => {
        if (event.key === "Escape") { finishGesture(true); setConnecting(null); }
        if (event.target !== event.currentTarget) return;
        const direction: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
        const delta = direction[event.key];
        if (delta) { event.preventDefault(); setCamera((current) => ({ ...current, x: current.x + delta[0], y: current.y + delta[1] })); }
      }}>
        <div className="rule-graph-canvas" style={{ width, height, transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
          <div className="rule-graph-lanes"><span>WHEN / trigger</span><span>IF / all conditions{!rule.conditions.length ? " · always" : ""}</span><span>THEN / ordered actions</span></div>
          <svg className="rule-graph-edges" width={width} height={height} aria-label="Executable rule connections">
            <defs><marker id={arrowId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="currentColor" /></marker></defs>
            {graph.edges.map((edge) => {
              const source = nodes.find((node) => node.id === edge.source)!;
              const target = nodes.find((node) => node.id === edge.target)!;
              const sx = source.position.x + GRAPH_NODE_WIDTH, sy = source.position.y + GRAPH_NODE_HEIGHT / 2;
              const tx = target.position.x, ty = target.position.y + GRAPH_NODE_HEIGHT / 2;
              const path = `M ${sx} ${sy} C ${sx + 64} ${sy}, ${tx - 64} ${ty}, ${tx} ${ty}`;
              return <g key={`${edge.source}-${edge.target}`} data-source={edge.source} data-target={edge.target} className="rule-graph-edge"><path d={path} markerEnd={`url(#${arrowId})`} /><path className="rule-graph-edge-hit" d={path} onClick={() => setSelectedId(target.id)}><title>{nodeLabel(source)} → {nodeLabel(target)}</title></path></g>;
            })}
          </svg>
          {nodes.map((node) => <div key={node.id} className={`rule-graph-node kind-${node.kind}${selected.id === node.id ? " selected" : ""}`} data-node-id={node.id} data-node-kind={node.kind} data-node-index={node.index} data-node-type={node.value.type} data-x={node.position.x} data-y={node.position.y} style={{ left: node.position.x, top: node.position.y, width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT }}>
            <button type="button" className="rule-node-header" aria-label={`Select ${nodeLabel(node)} ${nameFor(node.value.type)}`} aria-pressed={selected.id === node.id} onClick={() => setSelectedId(node.id)} onPointerDown={(event) => begin(event, "node", node)} onKeyDown={(event) => {
              if (readOnly) return;
              const delta: Record<string, [number, number]> = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
              const direction = delta[event.key];
              if (direction) { event.preventDefault(); event.stopPropagation(); apply((current) => positionRuleGraphNode(current, node.id, { x: node.position.x + direction[0], y: node.position.y + direction[1] })); }
            }}><span>{nodeLabel(node)}</span><span>{readOnly ? "VIEW" : "MOVE"}</span></button>
            <button type="button" className="rule-node-select" onClick={() => setSelectedId(node.id)}><strong>{nameFor(node.value.type)}</strong><span>{nodeSummary(node, scenario)}</span></button>
            {node.kind !== "trigger" && <button type="button" className={`rule-port input${connecting && canConnectRuleGraphNodes(rule, connecting, node.id) ? " compatible" : ""}`} aria-label={`Connect into ${nodeLabel(node)}`} disabled={readOnly || !connecting || !canConnectRuleGraphNodes(rule, connecting, node.id)} onClick={() => connecting && connect(connecting, node.id)} />}
            <button type="button" className={`rule-port output${connecting === node.id ? " armed" : ""}`} aria-label={`Connect from ${nodeLabel(node)}`} disabled={readOnly} aria-pressed={connecting === node.id} onClick={() => setConnecting(connecting === node.id ? null : node.id)} />
          </div>)}
        </div>
      </div>
      <div className="rule-graph-inspector" ref={inspectorRef} data-selected-node={selected.id}>
        <label>Selected graph node<select value={selected.id} onChange={(event) => { const node = graph.nodes.find((item) => item.id === event.target.value)!; setSelectedId(node.id); focus(node); }}>{graph.nodes.map((node) => <option value={node.id} key={node.id}>{nodeLabel(node)} · {nameFor(node.value.type)}</option>)}</select></label>
        <h4>{nodeLabel(selected)} / {nameFor(selected.value.type)}</h4>
        <fieldset disabled={readOnly} className="rule-graph-node-fields">
          <SelectField label="Node type" fieldKey="type" value={selected.value.type} choices={(selected.kind === "trigger" ? RULE_TRIGGER_TYPES : selected.kind === "condition" ? RULE_CONDITION_TYPES : RULE_ACTION_TYPES).map((id) => ({ id }))} onChange={replaceType} />
          <NodeFields node={selected.value} scenario={scenario} onPatch={(patch) => apply((current) => { const node = toRuleGraph(current).nodes.find((item) => item.id === selected.id)!; return replaceRuleGraphNode(current, selected.id, patchNode(node.value, patch)); })} />
          {selected.kind !== "trigger" && <>
            <label>Run after<select value={predecessor} onChange={(event) => connect(event.target.value || firstPredecessor, selected.id)}><option value="">{selected.kind === "condition" ? "First condition (after trigger)" : "First action (after all conditions)"}</option>{group.filter((node) => node.id !== selected.id).map((node) => <option value={node.id} key={node.id}>{nodeLabel(node)} · {nameFor(node.value.type)}</option>)}</select></label>
            <div className="rule-node-order"><button type="button" className="button button-ghost" disabled={selected.index === 0} onClick={() => apply((current) => reorderRuleGraphNode(current, selected.id, -1))}>Move earlier</button><button type="button" className="button button-ghost" disabled={selected.index === group.length - 1} onClick={() => apply((current) => reorderRuleGraphNode(current, selected.id, 1))}>Move later</button></div>
          </>}
          <details className="rule-node-layout"><summary>Node position / visual layout</summary><div className="rule-node-position-fields"><NumberField label="Canvas X" value={selected.position.x} max={GRAPH_POSITION_LIMIT} onChange={(x) => apply((current) => positionRuleGraphNode(current, selected.id, { ...selected.position, x: x ?? 0 }))} /><NumberField label="Canvas Y" value={selected.position.y} max={GRAPH_POSITION_LIMIT} onChange={(y) => apply((current) => positionRuleGraphNode(current, selected.id, { ...selected.position, y: y ?? 0 }))} /></div></details>
          <button type="button" className="button button-ghost danger-button" disabled={!removable} onClick={() => { apply((current) => removeRuleGraphNode(current, selected.id)); setConnecting(null); setSelectedId(graph.nodes.find((node) => node.id !== selected.id)!.id); }}>Remove selected node</button>
        </fieldset>
        <small>{selected.kind === "trigger" ? "Every rule has one trigger." : selected.kind === "condition" ? "All conditions must match before any action runs." : "Actions execute in the numbered order shown by the connections."} Layout changes do not alter execution order.</small>
      </div>
    </div>
    <label className="forge-checkbox rule-graph-once"><input type="checkbox" disabled={readOnly} checked={rule.once ?? false} onChange={(event) => { const once = event.target.checked; apply((current) => ({ ...current, once })); }} />Run this rule only once</label>
  </div>;
}

function conditionDefault(type: RuleCondition["type"], rule: ScenarioRule, scenario: ScenarioDefinition): RuleCondition {
  if (type === "selected-option" && rule.trigger.type === "decision-submitted") {
    const decisionId = rule.trigger.decisionId;
    return { type, decisionId, optionId: scenario.decisions.find((decision) => decision.id === decisionId)?.options[0]?.id ?? "" };
  }
  return defaultCondition(type, scenario);
}

function nodeSummary(node: RuleGraphNode, scenario: ScenarioDefinition): string {
  const value = node.value;
  if (value.type === "time-reached") return `At ${value.atSeconds}s`;
  if (value.type === "time-window") return `${value.startSeconds}s – ${value.endSeconds}s`;
  if (value.type === "add-score-event") return `${scenario.scoring.find((item) => item.id === value.dimensionId)?.name ?? value.dimensionId}: ${value.amount}`;
  if (value.type === "send-instructor-alert") return value.message;
  if (value.type === "end-exercise") return value.reason;
  if ("decisionId" in value) {
    const decision = scenario.decisions.find((item) => item.id === value.decisionId);
    return "optionId" in value && value.optionId ? decision?.options.find((item) => item.id === value.optionId)?.label ?? value.optionId : decision?.title ?? value.decisionId;
  }
  if ("reportId" in value) return scenario.reports.find((item) => item.id === value.reportId)?.content ?? value.reportId;
  if ("channelId" in value) return scenario.channels.find((item) => item.id === value.channelId)?.name ?? value.channelId;
  if ("objectId" in value) return scenario.environment.objects.find((item) => item.id === value.objectId)?.name ?? value.objectId;
  if ("roleId" in value && value.roleId) return scenario.roles.find((item) => item.id === value.roleId)?.name ?? value.roleId;
  if ("objectiveId" in value) return scenario.objectives.find((item) => item.id === value.objectiveId)?.title ?? value.objectiveId;
  return Object.entries(value).filter(([key]) => key !== "type").map(([key, entry]) => `${key}: ${String(entry)}`).join(" · ");
}
