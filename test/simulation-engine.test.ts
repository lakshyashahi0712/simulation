import { describe, expect, it } from "vitest";
import { SimulationEngine } from "../src/engine/simulation-engine.js";
import { operationSignalBreak } from "../src/scenarios/operation-signal-break.js";

describe("SENTINEL simulation engine", () => {
  it("delivers the initial report to all configured roles", () => {
    const engine = new SimulationEngine(operationSignalBreak);
    engine.start();

    expect(engine.clock.timeSeconds).toBe(0);
    expect(engine.getPerception("commander").reports.map((report) => report.reportId)).toContain("initial-sitrep");
    expect(engine.getPerception("operations").reports.map((report) => report.reportId)).toContain("initial-sitrep");
    expect(engine.getPerception("communications-ew").reports.map((report) => report.reportId)).toContain("initial-sitrep");
    expect(engine.allEvents().some((event) => event.type === "REPORT_GENERATED")).toBe(true);
  });

  it("applies authored state changes and time-triggered rule actions", () => {
    const scenario = structuredClone(operationSignalBreak);
    scenario.events = [
      ...scenario.events,
      { id: "event-zone-status", type: "state-change", atSeconds: 10, objectId: "north-zone", property: "status", value: "contested" }
    ];
    scenario.rules = [
      ...scenario.rules,
      {
        id: "rule-mark-south-ready",
        trigger: { type: "time-reached", atSeconds: 30 },
        conditions: [],
        actions: [
          { type: "change-object-state", objectId: "south-zone", property: "status", value: "ready" },
          { type: "add-score-event", dimensionId: "communication-clarity", amount: 2, reason: "South zone confirmed ready." }
        ],
        once: true
      }
    ];

    const engine = new SimulationEngine(scenario);
    engine.start();
    engine.advanceBy(30);

    expect(engine.getGroundTruthSnapshot().objectStates).toMatchObject({
      "north-zone": { status: "contested" },
      "south-zone": { status: "ready" }
    });
    expect(engine.allEvents()).toContainEqual(expect.objectContaining({
      type: "SCORE_EVENT",
      payload: expect.objectContaining({ dimensionId: "communication-clarity", amount: 2 })
    }));

    engine.advanceBy(1);
    expect(engine.clock.timeSeconds).toBe(31);
  });

  it("uses seeded reliability and executes interaction triggers", () => {
    const scenario = structuredClone(operationSignalBreak);
    scenario.reports = scenario.reports.map((report) => report.id === "initial-sitrep" ? { ...report, reliability: 0 } : report);
    scenario.rules = [
      ...scenario.rules,
      {
        id: "rule-zone-confirmed",
        trigger: { type: "zone-entered", objectId: "north-zone", roleId: "commander" },
        conditions: [],
        actions: [{ type: "change-object-state", objectId: "north-zone", property: "status", value: "occupied" }],
        once: true
      }
    ];
    const engine = new SimulationEngine(scenario);
    engine.start();

    expect(engine.getPerception("commander").reports).toHaveLength(0);
    expect(engine.allEvents()).toContainEqual(expect.objectContaining({
      type: "REPORT_DROPPED",
      payload: expect.objectContaining({ reason: "reliability-threshold" })
    }));

    engine.triggerZoneEntered("commander", "north-zone");
    expect(engine.getGroundTruthSnapshot().objectStates["north-zone"]).toMatchObject({ status: "occupied" });
    expect(engine.allEvents()).toContainEqual(expect.objectContaining({ type: "RULE_TRIGGERED" }));
  });

  it("keeps a delayed report out of perception until its delivery time", () => {
    const engine = new SimulationEngine(operationSignalBreak);
    engine.start();

    engine.advanceBy(100);
    expect(engine.getPerception("commander").reports.map((report) => report.reportId)).not.toContain("field-route-report");
    expect(engine.allEvents()).toContainEqual(expect.objectContaining({
      type: "REPORT_DELAYED",
      roleId: "commander"
    }));

    engine.advanceBy(40);
    const fieldReport = engine.getPerception("commander").reports.find((report) => report.reportId === "field-route-report");
    expect(fieldReport).toMatchObject({
      reportId: "field-route-report",
      status: "delivered",
      receivedAtSeconds: 135,
      delayMs: 45000
    });
  });

  it("drops reports during a dropout and marks contradictory reports", () => {
    const engine = new SimulationEngine(operationSignalBreak);
    engine.start();
    engine.advanceBy(250);

    expect(engine.getPerception("commander").reports.map((report) => report.reportId)).not.toContain("backup-channel-report");
    expect(engine.allEvents()).toContainEqual(expect.objectContaining({
      type: "REPORT_DROPPED",
      roleId: "commander",
      payload: expect.objectContaining({ reportId: "backup-channel-report" })
    }));

    const conflictingReport = engine.getPerception("commander").reports.find((report) => report.reportId === "contradictory-aerial-report");
    expect(conflictingReport).toMatchObject({
      status: "conflicting",
      conflictsWith: "field-route-report"
    });
  });

  it("captures the role perception snapshot with a decision", () => {
    const engine = new SimulationEngine(operationSignalBreak);
    engine.start();
    engine.advanceBy(250);

    const decision = engine.submitDecision({
      roleId: "commander",
      decisionId: "route-decision",
      optionId: "request-verification",
      rationale: "The field report and aerial report conflict, so verification is required before movement.",
      confidence: 0.72
    });

    expect(decision.optionId).toBe("request-verification");
    expect(decision.perceptionSnapshot.roleId).toBe("commander");
    expect(decision.perceptionSnapshot.reports.map((report) => report.reportId)).toContain("contradictory-aerial-report");
    expect(engine.getPerception("commander").activeDecisionIds).not.toContain("route-decision");
    expect(engine.allEvents()).toContainEqual(expect.objectContaining({ type: "DECISION_SUBMITTED" }));
    expect(engine.eventLog.forRole("commander")).toContainEqual(expect.objectContaining({
      type: "DECISION_REQUIRED",
      roleId: "commander"
    }));
    expect(engine.getScoreSnapshot().total).toBeGreaterThan(0);

    const counterfactual = engine.getCounterfactual("route-decision", "north-route");
    expect(counterfactual).toMatchObject({
      decisionId: "route-decision",
      actualOptionId: "request-verification",
      alternateOptionId: "north-route"
    });
    expect(counterfactual.delta).toBeLessThanOrEqual(0);

    engine.advanceBy(30);
    expect(engine.getPerception("commander").reports).toContainEqual(expect.objectContaining({
      reportId: "late-verification-report",
      receivedAtSeconds: 280,
      delayMs: 30000
    }));
  });

  it("supports instructor fault injection and automatic expiry", () => {
    const engine = new SimulationEngine(operationSignalBreak);
    engine.start();
    engine.advanceBy(10);
    engine.injectChannelFault("command-net", "outage", { durationSeconds: 20 });

    expect(engine.getGroundTruthSnapshot().activeChannelFaults).toHaveLength(1);
    expect(engine.allEvents()).toContainEqual(expect.objectContaining({
      type: "CHANNEL_FAULT_INJECTED",
      payload: expect.objectContaining({ source: "instructor", channelId: "command-net" })
    }));

    engine.advanceBy(25);

    expect(engine.getGroundTruthSnapshot().activeChannelFaults).toHaveLength(0);
    expect(engine.allEvents()).toContainEqual(expect.objectContaining({
      type: "CHANNEL_RESTORED",
      payload: expect.objectContaining({ channelId: "command-net", source: "duration-expired" })
    }));
  });

  it("ends at the authored scenario-end event", () => {
    const engine = new SimulationEngine(operationSignalBreak);
    engine.start();
    engine.advanceBy(600);

    expect(engine.isEnded).toBe(true);
    expect(engine.clock.state).toBe("ended");
    expect(engine.clock.timeSeconds).toBe(600);
    expect(engine.allEvents()).toContainEqual(expect.objectContaining({
      type: "SCENARIO_ENDED",
      simulationTimeSeconds: 600
    }));
  });

  it("preserves pending text delivery across engine restore without leaking it early", () => {
    const engine = new SimulationEngine(operationSignalBreak);
    engine.start();
    engine.advanceBy(10);
    engine.injectChannelFault("command-net", "delay", { delayMs: 45000, durationSeconds: 100 });
    engine.sendTextMessage("operations", "command-net", "Verification pending.");
    const restored = new SimulationEngine(operationSignalBreak);
    restored.restore(engine.getSnapshot());
    restored.advanceBy(44);
    expect(restored.eventLog.forRole("commander").filter((event) => event.type === "TEXT_MESSAGE_SENT")).toHaveLength(0);
    restored.advanceBy(1);
    expect(restored.eventLog.forRole("commander").filter((event) => event.type === "TEXT_MESSAGE_SENT")).toHaveLength(1);
    expect(restored.eventLog.forRole("commander").find((event) => event.type === "TEXT_MESSAGE_SENT")?.payload).toMatchObject({ generatedAtSeconds: 10, receivedAtSeconds: 55, content: "Verification pending." });
  });
});
