import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ScenarioRule } from "../src/domain/scenario.js";
import { addRuleGraphNode, arrangeRuleGraph, compileRuleGraph, connectRuleGraphNodes, positionRuleGraphNode, removeRuleGraphNode, reorderRuleGraphNode, replaceRuleGraphNode, toRuleGraph } from "../src/domain/rule-graph.js";
import { validateScenario } from "../src/domain/validate.js";
import { SimulationEngine } from "../src/engine/simulation-engine.js";
import { customBlackout } from "../src/scenarios/presets.js";
import { JsonPersistence } from "../src/server/persistence.js";
import { SessionManager } from "../src/server/session-manager.js";
import { ForgeRecovery } from "../web/src/forge-recovery.js";

function chain(): ScenarioRule {
  return { id: "visual-chain", trigger: { type: "time-reached", atSeconds: 5 }, conditions: [], actions: [
    { type: "change-object-state", objectId: "primary-zone", property: "graph-stage", value: "first" },
    { type: "change-object-state", objectId: "primary-zone", property: "graph-stage", value: "second" }
  ], once: true };
}
function run(rule: ScenarioRule) {
  const scenario = structuredClone(customBlackout);
  scenario.rules = [rule];
  const engine = new SimulationEngine(scenario);
  engine.start(); engine.advanceBy(5);
  return engine;
}

describe("visual rule graph authoring", () => {
  it("renders legacy rules without rewriting them and retains execution when layout is changed", () => {
    const original = chain();
    const before = structuredClone(original);
    const graph = toRuleGraph(original);
    expect(original).toEqual(before);
    expect(graph.edges).toHaveLength(2);
    const laidOut = positionRuleGraphNode(original, graph.nodes[1]!.id, { x: 800, y: 320 });
    expect(laidOut.actions).toEqual(original.actions);
    expect(run(laidOut).getGroundTruthSnapshot().objectStates["primary-zone"]?.["graph-stage"]).toBe("second");
    expect(toRuleGraph(JSON.parse(JSON.stringify(laidOut))).nodes[1]?.position).toEqual({ x: 800, y: 320 });
  });

  it("reconnecting action ports changes real execution order while preserving node IDs and positions", () => {
    const original = arrangeRuleGraph(chain());
    const graph = toRuleGraph(original);
    const first = graph.nodes[1]!, second = graph.nodes[2]!;
    const reordered = connectRuleGraphNodes(original, second.id, first.id);
    expect(toRuleGraph(reordered).nodes.filter((node) => node.kind === "action").map((node) => node.id)).toEqual([second.id, first.id]);
    expect(toRuleGraph(reordered).nodes.find((node) => node.id === first.id)?.position).toEqual(first.position);
    expect(run(original).getGroundTruthSnapshot().objectStates["primary-zone"]?.["graph-stage"]).toBe("second");
    expect(run(reordered).getGroundTruthSnapshot().objectStates["primary-zone"]?.["graph-stage"]).toBe("first");
  });

  it("keeps all conditions required and prevents unsupported connections or loss of required nodes", () => {
    let rule = addRuleGraphNode(chain(), "condition", { type: "time-window", startSeconds: 0, endSeconds: 10 });
    rule = addRuleGraphNode(rule, "condition", { type: "decision-count", greaterThanOrEqual: 1 });
    const graph = toRuleGraph(rule);
    const trigger = graph.nodes[0]!, condition = graph.nodes.find((node) => node.kind === "condition")!, action = graph.nodes.find((node) => node.kind === "action")!;
    expect(() => connectRuleGraphNodes(rule, trigger.id, action.id)).toThrow("conditions before actions");
    expect(() => connectRuleGraphNodes(rule, action.id, condition.id)).toThrow("conditions before actions");
    expect(() => connectRuleGraphNodes(rule, action.id, action.id)).toThrow();
    expect(() => removeRuleGraphNode(rule, trigger.id)).toThrow("one trigger");
    expect(run(rule).getGroundTruthSnapshot().objectStates["primary-zone"]?.["graph-stage"]).toBeUndefined();
    const withoutFalseCondition = removeRuleGraphNode(rule, graph.nodes.find((node) => node.value.type === "decision-count")!.id);
    expect(run(withoutFalseCondition).getGroundTruthSnapshot().objectStates["primary-zone"]?.["graph-stage"]).toBe("second");
    const oneAction = removeRuleGraphNode(chain(), toRuleGraph(chain()).nodes[1]!.id);
    expect(() => removeRuleGraphNode(oneAction, toRuleGraph(oneAction).nodes[1]!.id)).toThrow("at least one action");
    expect(() => compileRuleGraph(chain(), toRuleGraph(chain()).nodes.map((node) => node.kind === "trigger" ? { ...node, value: { type: "end-exercise", reason: "wrong lane" } } : node))).toThrow("type does not belong");
  });

  it("retains identities through typed edits, insertion, deletion, rearrangement, and action reordering", () => {
    let rule = arrangeRuleGraph(chain());
    const first = toRuleGraph(rule).nodes[1]!;
    rule = replaceRuleGraphNode(rule, first.id, { type: "send-instructor-alert", message: "Graph-authored alert" });
    rule = addRuleGraphNode(rule, "action", { type: "add-score-event", dimensionId: "backup-channel-use", amount: 2, reason: "Graph-authored evidence" });
    const added = toRuleGraph(rule).nodes.at(-1)!;
    rule = reorderRuleGraphNode(rule, added.id, -1);
    rule = removeRuleGraphNode(rule, toRuleGraph(rule).nodes.find((node) => node.value.type === "change-object-state")!.id);
    rule = arrangeRuleGraph(rule);
    expect(toRuleGraph(rule).nodes.find((node) => node.id === first.id)?.value.type).toBe("send-instructor-alert");
    expect(toRuleGraph(rule).nodes.find((node) => node.id === added.id)?.value.type).toBe("add-score-event");
    expect(run(rule).allEvents()).toContainEqual(expect.objectContaining({ type: "INSTRUCTOR_ALERT", payload: expect.objectContaining({ message: "Graph-authored alert" }) }));
  });

  it("rejects malformed, duplicated, or nonfinite imported layout data with structured field paths", () => {
    const scenario = structuredClone(customBlackout);
    scenario.rules[0] = arrangeRuleGraph(scenario.rules[0]!);
    const layout = scenario.rules[0].editor!.graph;
    layout.nodes[1]!.id = layout.nodes[0]!.id;
    layout.nodes[2]!.position.x = Infinity;
    layout.nodes[3]!.index = 999;
    const result = validateScenario(scenario);
    expect(result.valid).toBe(false);
    expect(result.errors.filter((issue) => issue.code === "INVALID_RULE_GRAPH")).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "rules[0].editor.graph.nodes[1]" }),
      expect.objectContaining({ path: "rules[0].editor.graph.nodes[2].position" }),
      expect.objectContaining({ path: "rules[0].editor.graph.nodes[3]" })
    ]));
    (scenario.rules[0] as unknown as { editor: unknown }).editor = { graph: { version: 1, nodes: [null] } };
    expect(() => validateScenario(scenario)).not.toThrow();
    expect(validateScenario(scenario).valid).toBe(false);
  });

  it("recovers, saves, publishes, restores, and executes a graph while keeping published versions immutable", () => {
    const path = `/tmp/omnirush/sentinel-rule-graph-${randomUUID()}.json`;
    const persistence = new JsonPersistence(path);
    const manager = new SessionManager({ persistence, autoTickMs: 0 });
    let restored: SessionManager | undefined;
    try {
      const draft = manager.createDraft("custom-blackout");
      draft.rules = [positionRuleGraphNode(chain(), "action-0", { x: 950, y: 180 })];
      const values = new Map<string, string>();
      const recovery = new ForgeRecovery({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } });
      recovery.save(draft);
      manager.updateScenario(draft.id, recovery.read(draft.id)!.scenario);
      const published = manager.publishScenario(draft.id);
      restored = new SessionManager({ persistence, autoTickMs: 0 });
      const definition = restored.getScenario(published.id);
      expect(definition.rules[0]!.editor).toEqual(draft.rules[0]!.editor);
      const exported: typeof definition = JSON.parse(JSON.stringify(definition));
      exported.id = `${definition.id}-imported`;
      const imported = restored.importScenario(exported);
      expect(imported.rules[0]!.editor).toEqual(definition.rules[0]!.editor);
      const duplicated = restored.createDraft(definition.id);
      expect(duplicated.rules[0]!.editor).toEqual(definition.rules[0]!.editor);
      expect(new SimulationEngine(definition).scenarioId).toBe(definition.id);
      expect(run(definition.rules[0]!).getGroundTruthSnapshot().objectStates["primary-zone"]?.["graph-stage"]).toBe("second");
      expect(() => restored!.updateScenario(definition.id, definition)).toThrow("Published scenarios are immutable");
    } finally { manager.dispose(); restored?.dispose(); unlinkSync(path); }
  });
});
