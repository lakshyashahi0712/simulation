import type { RuleAction, RuleCondition, RuleGraphNodeKind, RuleGraphNodeLayout, RuleTrigger, ScenarioRule } from "./scenario.js";

export const RULE_TRIGGER_TYPES: RuleTrigger["type"][] = ["time-reached", "zone-entered", "message-received", "message-ignored", "decision-submitted", "channel-disabled", "channel-restored", "object-collision", "instructor-injection"];
export const RULE_CONDITION_TYPES: RuleCondition["type"][] = ["role-is", "object-state", "channel-state", "report-age", "report-status", "selected-option", "decision-count", "objective-state", "time-window"];
export const RULE_ACTION_TYPES: RuleAction["type"][] = ["send-report", "delay-report", "drop-report", "create-conflict", "disable-channel", "restore-channel", "activate-decision", "change-object-state", "send-instructor-alert", "add-score-event", "end-exercise"];
export const GRAPH_NODE_WIDTH = 236;
export const GRAPH_NODE_HEIGHT = 112;
export const GRAPH_POSITION_LIMIT = 4096;

export interface RuleGraphNode extends RuleGraphNodeLayout { value: RuleTrigger | RuleCondition | RuleAction }
export interface RuleGraphEdge { source: string; target: string }
export interface RuleGraph { nodes: RuleGraphNode[]; edges: RuleGraphEdge[] }

const validId = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
const validCoordinate = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= GRAPH_POSITION_LIMIT;
function defaultPosition(kind: RuleGraphNodeKind, index: number) {
  return { x: kind === "trigger" ? 32 : kind === "condition" ? 320 : 608, y: Math.min(48 + index * 144, GRAPH_POSITION_LIMIT) };
}

/** Old rules acquire a view without mutation; connections come from executable order. */
export function toRuleGraph(rule: ScenarioRule): RuleGraph {
  const layouts = Array.isArray(rule.editor?.graph?.nodes) ? rule.editor.graph.nodes : [];
  const used = new Set<string>();
  const node = (kind: RuleGraphNodeKind, index: number, value: RuleGraphNode["value"]): RuleGraphNode => {
    const saved = layouts.find((layout) => layout && layout.kind === kind && layout.index === index);
    let id = saved && validId(saved.id) && !used.has(saved.id) ? saved.id : `${kind}-${index}`;
    while (used.has(id)) id = `${id}-new`;
    used.add(id);
    const position = saved?.position && validCoordinate(saved.position.x) && validCoordinate(saved.position.y) ? { ...saved.position } : defaultPosition(kind, index);
    return { id, kind, index, position, value };
  };
  const nodes = [node("trigger", 0, rule.trigger), ...rule.conditions.map((value, index) => node("condition", index, value)), ...rule.actions.map((value, index) => node("action", index, value))];
  return { nodes, edges: nodes.slice(1).map((target, index) => ({ source: nodes[index]!.id, target: target.id })) };
}

/** Compile a typed graph to the existing rule schema, keeping local node identities. */
export function compileRuleGraph(rule: ScenarioRule, nodes: RuleGraphNode[]): ScenarioRule {
  const triggers = nodes.filter((node) => node.kind === "trigger");
  const conditions = nodes.filter((node) => node.kind === "condition");
  const actions = nodes.filter((node) => node.kind === "action");
  if (triggers.length !== 1) throw new Error("A rule needs exactly one trigger.");
  if (!actions.length) throw new Error("Keep at least one action in the rule.");
  const ids = new Set<string>();
  for (const node of nodes) {
    if (!["trigger", "condition", "action"].includes(node.kind)) throw new Error("Choose a supported graph lane.");
    if (!validId(node.id) || ids.has(node.id)) throw new Error("Graph node IDs must be valid and unique within the rule.");
    ids.add(node.id);
    const types: readonly string[] = node.kind === "trigger" ? RULE_TRIGGER_TYPES : node.kind === "condition" ? RULE_CONDITION_TYPES : RULE_ACTION_TYPES;
    if (!types.includes(node.value.type)) throw new Error("Node type does not belong in this graph lane.");
    if (!validCoordinate(node.position.x) || !validCoordinate(node.position.y)) throw new Error("Node positions must be finite and inside the graph workspace.");
  }
  const ordered = [...triggers, ...conditions, ...actions];
  const counts = { trigger: 0, condition: 0, action: 0 };
  return {
    ...rule,
    trigger: triggers[0]!.value as RuleTrigger,
    conditions: conditions.map((node) => node.value as RuleCondition),
    actions: actions.map((node) => node.value as RuleAction),
    editor: { graph: { version: 1, nodes: ordered.map(({ id, kind, position }) => ({ id, kind, index: counts[kind]++, position: { ...position } })) } }
  };
}

export function replaceRuleGraphNode(rule: ScenarioRule, id: string, value: RuleGraphNode["value"]): ScenarioRule {
  const { nodes } = toRuleGraph(rule);
  if (!nodes.some((node) => node.id === id)) throw new Error("Select an existing graph node.");
  return compileRuleGraph(rule, nodes.map((node) => node.id === id ? { ...node, value } : node));
}

export function addRuleGraphNode(rule: ScenarioRule, kind: "condition" | "action", value: RuleCondition | RuleAction): ScenarioRule {
  const { nodes } = toRuleGraph(rule);
  let number = 1;
  while (nodes.some((node) => node.id === `node-${number}`)) number++;
  const index = nodes.filter((node) => node.kind === kind).length;
  return compileRuleGraph(rule, [...nodes, { id: `node-${number}`, kind, index, value, position: defaultPosition(kind, index) }]);
}

export function removeRuleGraphNode(rule: ScenarioRule, id: string): ScenarioRule {
  const { nodes } = toRuleGraph(rule);
  const selected = nodes.find((node) => node.id === id);
  if (!selected) throw new Error("Select an existing graph node.");
  if (selected.kind === "trigger") throw new Error("A rule needs exactly one trigger.");
  return compileRuleGraph(rule, nodes.filter((node) => node.id !== id));
}

export function positionRuleGraphNode(rule: ScenarioRule, id: string, position: { x: number; y: number }): ScenarioRule {
  const { nodes } = toRuleGraph(rule);
  if (!nodes.some((node) => node.id === id)) throw new Error("Select an existing graph node.");
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error("Node positions must be finite.");
  const bounded = { x: Math.max(0, Math.min(GRAPH_POSITION_LIMIT, position.x)), y: Math.max(0, Math.min(GRAPH_POSITION_LIMIT, position.y)) };
  return compileRuleGraph(rule, nodes.map((node) => node.id === id ? { ...node, position: bounded } : node));
}

export function arrangeRuleGraph(rule: ScenarioRule): ScenarioRule {
  return compileRuleGraph(rule, toRuleGraph(rule).nodes.map((node) => ({ ...node, position: defaultPosition(node.kind, node.index) })));
}

export function reorderRuleGraphNode(rule: ScenarioRule, id: string, offset: -1 | 1): ScenarioRule {
  const { nodes } = toRuleGraph(rule);
  const selected = nodes.find((node) => node.id === id);
  if (!selected || selected.kind === "trigger") return rule;
  const group = nodes.filter((node) => node.kind === selected.kind);
  const index = group.findIndex((node) => node.id === id);
  const target = index + offset;
  if (target < 0 || target >= group.length) return rule;
  [group[index], group[target]] = [group[target]!, group[index]!];
  return compileRuleGraph(rule, [...nodes.filter((node) => node.kind !== selected.kind), ...group]);
}

export function canConnectRuleGraphNodes(rule: ScenarioRule, sourceId: string, targetId: string): boolean {
  const { nodes } = toRuleGraph(rule);
  const source = nodes.find((node) => node.id === sourceId);
  const target = nodes.find((node) => node.id === targetId);
  if (!source || !target || source.id === target.id || target.kind === "trigger") return false;
  if (source.kind === target.kind) return true;
  if (source.kind === "trigger") return target.kind === "condition" || rule.conditions.length === 0;
  return source.kind === "condition" && target.kind === "action" && source.index === rule.conditions.length - 1;
}

/** Reconnect by reordering within a lane; never introduce unsupported branches/cycles. */
export function connectRuleGraphNodes(rule: ScenarioRule, sourceId: string, targetId: string): ScenarioRule {
  if (!canConnectRuleGraphNodes(rule, sourceId, targetId)) throw new Error("Connect conditions before actions; keep one trigger and an ordered action chain.");
  const { nodes } = toRuleGraph(rule);
  const source = nodes.find((node) => node.id === sourceId)!;
  const target = nodes.find((node) => node.id === targetId)!;
  const group = nodes.filter((node) => node.kind === target.kind && node.id !== target.id);
  const index = source.kind === target.kind ? group.findIndex((node) => node.id === source.id) + 1 : 0;
  group.splice(index, 0, target);
  return compileRuleGraph(rule, [...nodes.filter((node) => node.kind !== target.kind), ...group]);
}

/** Validate untrusted optional layout metadata without throwing on malformed JSON. */
export function ruleGraphLayoutIssues(rule: ScenarioRule): Array<{ path: string; message: string }> {
  if (rule.editor === undefined) return [];
  const graph = rule.editor?.graph;
  if (!graph || graph.version !== 1 || !Array.isArray(graph.nodes)) return [{ path: "editor.graph", message: "Graph layout requires version 1 and a node array." }];
  const issues: Array<{ path: string; message: string }> = [];
  const ids = new Set<string>();
  const slots = new Set<string>();
  graph.nodes.forEach((node, index) => {
    const path = `editor.graph.nodes[${index}]`;
    if (!node || !validId(node.id) || ids.has(node.id)) { issues.push({ path, message: "Graph node IDs must be valid and unique within the rule." }); return; }
    ids.add(node.id);
    const length = node.kind === "trigger" ? 1 : node.kind === "condition" ? rule.conditions.length : node.kind === "action" ? rule.actions.length : 0;
    const slot = `${node.kind}:${node.index}`;
    if (!Number.isInteger(node.index) || node.index < 0 || node.index >= length || slots.has(slot)) issues.push({ path, message: "Graph node must identify one existing trigger, condition, or action." });
    slots.add(slot);
    if (!node.position || !validCoordinate(node.position.x) || !validCoordinate(node.position.y)) issues.push({ path: `${path}.position`, message: "Graph coordinates must be finite and between 0 and 4096." });
  });
  if (slots.size !== 1 + rule.conditions.length + rule.actions.length) issues.push({ path: "editor.graph.nodes", message: "Graph layout must cover every executable node exactly once." });
  return issues;
}
