import { describe, expect, it } from "vitest";
import { reconstructPerception } from "../src/engine/perception-replay.js";
import { SimulationEngine } from "../src/engine/simulation-engine.js";
import { operationSignalBreak } from "../src/scenarios/operation-signal-break.js";
import { SessionManager } from "../src/server/session-manager.js";

const submit = (engine: SimulationEngine, optionId = "request-verification", decisionId = "route-decision") => engine.submitDecision({
  roleId: "commander", decisionId, optionId, rationale: "Verify conflicting reports with the team before movement.", confidence: 0.8
});

describe("historical perception and isolated branch replay", () => {
  it("shows earlier report revisions and hides reports/text that had not yet arrived", () => {
    const scenario = structuredClone(operationSignalBreak);
    scenario.rules.push({ id: "repeat-initial", once: true, trigger: { type: "time-reached", atSeconds: 30 }, conditions: [], actions: [{ type: "send-report", reportId: "initial-sitrep" }] });
    const engine = new SimulationEngine(scenario);
    engine.start(); engine.advanceBy(10);
    engine.sendTextMessage("operations", "alpha-link", "Private observation");
    engine.advanceBy(30);
    expect(engine.getPerception("commander").reports.find((report) => report.reportId === "initial-sitrep")?.generatedAtSeconds).toBe(30);
    expect(engine.getPerceptionAt("commander", 5).reports.find((report) => report.reportId === "initial-sitrep")?.generatedAtSeconds).toBe(0);
    expect(engine.getPerceptionAt("commander", 5).textMessages).toEqual([]);
    expect(engine.getPerceptionAt("commander", 11).textMessages).toHaveLength(1);
    expect(engine.getPerceptionAt("communications-ew", 40).textMessages).toEqual([]);
    const exported = engine.getAfterActionReview();
    expect(reconstructPerception(exported.events, "commander", 5, exported.reportTemplates)).toEqual(engine.getPerceptionAt("commander", 5));
    const editedTemplates = structuredClone(exported.reportTemplates!);
    editedTemplates.find((report) => report.id === "initial-sitrep")!.content = "Future edit";
    expect(reconstructPerception(exported.events, "commander", 5, editedTemplates)).toEqual(engine.getPerceptionAt("commander", 5));
    const legacyEvents = structuredClone(exported.events);
    legacyEvents.forEach((event) => { delete event.payload.observedReport; });
    expect(reconstructPerception(legacyEvents, "commander", 5, exported.reportTemplates)).toEqual(engine.getPerceptionAt("commander", 5));
    expect(() => engine.getPerceptionAt("commander", NaN)).toThrow("finite");
  });

  it("reconstructs gate submission and expiry from ground-truth lifecycle events", () => {
    const engine = new SimulationEngine(operationSignalBreak);
    engine.start(); engine.advanceBy(250); submit(engine);
    engine.advanceBy(100);
    expect(engine.getPerceptionAt("commander", 245).activeDecisionIds).toContain("route-decision");
    expect(engine.getPerceptionAt("commander", 250).activeDecisionIds).not.toContain("route-decision");
    const unsubmitted = new SimulationEngine(operationSignalBreak);
    unsubmitted.start(); unsubmitted.advanceBy(301);
    expect(unsubmitted.getPerceptionAt("commander", 299).activeDecisionIds).toContain("route-decision");
    expect(unsubmitted.getPerceptionAt("commander", 300).activeDecisionIds).toEqual([]);
  });

  it("counts immediate rule scores, changes downstream state/reports, and never mutates the exercise", () => {
    const scenario = structuredClone(operationSignalBreak);
    scenario.rules.push({
      id: "north-risk", once: true,
      trigger: { type: "decision-submitted", decisionId: "route-decision", optionId: "north-route" }, conditions: [],
      actions: [
        { type: "change-object-state", objectId: "north-zone", property: "status", value: "committed" },
        { type: "add-score-event", dimensionId: "uncertainty-recognition", amount: -2, reason: "Movement committed under conflicting reports." }
      ]
    });
    const engine = new SimulationEngine(scenario);
    engine.start(); engine.advanceBy(250); submit(engine);
    engine.advanceBy(40);
    const before = engine.getSnapshot();
    const compared = engine.getCounterfactual("route-decision", "north-route");
    expect(compared.replayMode).toBe("branch");
    expect(compared.futureDelta).toBeCloseTo(-0.4);
    expect(compared.alternateBranch?.objectStates["north-zone"]?.status).toBe("committed");
    expect(compared.actualBranch?.perceptions.find((role) => role.roleId === "commander")?.reports.some((report) => report.reportId === "late-verification-report")).toBe(true);
    expect(compared.alternateBranch?.perceptions.find((role) => role.roleId === "commander")?.reports.some((report) => report.reportId === "late-verification-report")).toBe(false);
    expect(engine.getSnapshot()).toEqual(before);
    const restored = new SimulationEngine(scenario); restored.restore(JSON.parse(JSON.stringify(before)));
    expect(restored.getCounterfactual("route-decision", "north-route")).toEqual(compared);
  });

  it("replays later instructor controls/text and includes same-timestamp post-decision inputs", () => {
    const scenario = structuredClone(operationSignalBreak);
    scenario.environment.objects.find((object) => object.id === "north-zone")!.physics!.body = "kinematic";
    const engine = new SimulationEngine(scenario);
    engine.start(); engine.advanceBy(250); submit(engine);
    engine.injectChannelFault("bravo-link", "delay", { delayMs: 5000, durationSeconds: 10 });
    engine.sendTextMessage("operations", "command-net", "Continue synthetic verification");
    engine.triggerZoneEntered("operations", "north-zone");
    engine.triggerObjectCollision("north-zone", "south-zone");
    engine.moveObject("north-zone", { x: 45, y: 0, z: 40 });
    engine.pause(); engine.resume(); engine.advanceBy(35);
    engine.restoreChannel("bravo-link"); engine.endExercise();
    const compared = engine.getCounterfactual("route-decision", "request-verification");
    expect(compared.actualBranch).toEqual(compared.alternateBranch);
    expect(compared.alternateBranch?.skippedInputs).toEqual([]);
    expect(compared.alternateBranch?.throughSeconds).toBe(285);
    expect(compared.alternateBranch?.ended).toBe(true);
    expect(compared.alternateBranch?.events).toEqual(engine.allEvents().slice(engine.getSnapshot().decisionSnapshots?.["route-decision"]?.events.length));
  });

  it("lists later inputs skipped by an early-ending branch", () => {
    const scenario = structuredClone(operationSignalBreak);
    scenario.rules.push({ id: "end-on-north", once: true, trigger: { type: "decision-submitted", decisionId: "route-decision", optionId: "north-route" }, conditions: [], actions: [
      { type: "end-exercise", reason: "alternate-ended" },
      { type: "add-score-event", dimensionId: "uncertainty-recognition", amount: 999, reason: "Must not execute after end." },
      { type: "change-object-state", objectId: "north-zone", property: "status", value: "must-not-happen" }
    ] });
    const engine = new SimulationEngine(scenario);
    engine.start(); engine.advanceBy(250); submit(engine); engine.advanceBy(10);
    engine.sendTextMessage("operations", "command-net", "Later text"); engine.advanceBy(20);
    const compared = engine.getCounterfactual("route-decision", "north-route");
    expect(compared.alternateBranch?.throughSeconds).toBe(250);
    expect(compared.alternateBranch?.skippedInputs).toContainEqual(expect.objectContaining({ type: "TEXT_MESSAGE_QUEUED" }));
    expect(compared.alternateBranch?.events.at(-1)?.type).toBe("SCENARIO_ENDED");
    expect(compared.alternateBranch?.objectStates["north-zone"]?.status).not.toBe("must-not-happen");
  });

  it("marks a rule-ended real session read-only immediately after its decision", () => {
    const scenario = structuredClone(operationSignalBreak);
    scenario.rules.push({ id: "decision-ending", once: true, trigger: { type: "decision-submitted", decisionId: "route-decision" }, conditions: [], actions: [{ type: "end-exercise", reason: "rule-ended" }] });
    const manager = new SessionManager({ scenarios: [scenario], autoTickMs: 0 });
    try {
      const room = manager.createSession(scenario.id);
      const commander = manager.joinSession(room.session.id, "Commander", "commander");
      manager.start(room.session.id, room.instructor.id); manager.advance(room.session.id, room.instructor.id, 250);
      manager.submitDecision(room.session.id, commander.participant.id, "route-decision", "north-route", "Verify the reports with the team.", 0.8);
      expect(manager.getSessionSummary(room.session.id).status).toBe("ended");
      expect(manager.executeQueuedAction(room.session.id, commander.participant.id, { id: "later-action", event: "session:send-text", payload: { channelId: "command-net", content: "Too late" } })).toMatchObject({ status: "rejected", error: "INVALID_SESSION_STATE" });
    } finally { manager.dispose(); }
  });

  it("stores flat checkpoints for multiple decisions and provides an explicit legacy fallback", () => {
    const scenario = structuredClone(operationSignalBreak);
    const second = structuredClone(scenario.decisions[0]!);
    second.id = "second-gate"; second.activation = { type: "time", atSeconds: 320 };
    scenario.decisions.push(second);
    scenario.events.push({ id: "second-gate-event", type: "decision-gate", atSeconds: 320, decisionId: second.id });
    const engine = new SimulationEngine(scenario);
    engine.start(); engine.advanceBy(250); submit(engine); engine.advanceBy(80); submit(engine, "north-route", "second-gate");
    const snapshot = engine.getSnapshot();
    expect(Object.keys(snapshot.decisionSnapshots ?? {})).toHaveLength(2);
    expect(snapshot.decisionSnapshots?.["second-gate"]?.decisionSnapshots).toBeUndefined();
    delete snapshot.decisionSnapshots;
    const legacy = new SimulationEngine(scenario); legacy.restore(snapshot);
    expect(legacy.getCounterfactual("route-decision", "north-route")).toMatchObject({ replayMode: "score-only", assumptions: [expect.stringContaining("older exercise")] });
  });
});
