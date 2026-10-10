import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextScenarioId, putDecision, scenarioReferences, syncReportVisibility } from "../src/domain/authoring.js";
import { validateScenario } from "../src/domain/validate.js";
import { SimulationEngine } from "../src/engine/simulation-engine.js";
import { customBlackout, floodResponse, scenarioPresets } from "../src/scenarios/presets.js";
import { operationSignalBreak } from "../src/scenarios/operation-signal-break.js";
import { createServer } from "../src/server/app.js";
import { JsonPersistence } from "../src/server/persistence.js";
import { SessionManager } from "../src/server/session-manager.js";

describe("Forge no-code authoring", () => {
  it.each(scenarioPresets)("runs the $metadata.category preset to completion and preserves role isolation", (preset) => {
    expect(validateScenario(preset)).toMatchObject({ valid: true, errors: [] });
    const engine = new SimulationEngine(preset);
    engine.start();
    engine.advanceBy(preset.metadata.durationSeconds);
    expect(engine.isEnded).toBe(true);
    for (const role of preset.roles) {
      expect(engine.getPerception(role.id).reports.every((observed) => preset.reports.find((report) => report.id === observed.reportId)?.targetRoles.includes(role.id))).toBe(true);
    }
  });

  it("publishes a no-code report, retimed decision, and conditional action chain that executes in an exercise", async () => {
    const server = await createServer({ persistenceFile: null, autoTickMs: 0, adminToken: "forge-test" });
    const headers = { "x-admin-token": "forge-test" };
    try {
      const created = await server.app.inject({ method: "POST", url: "/api/forge/scenarios", headers, payload: { baseScenarioId: "custom-blackout" } });
      expect(created.statusCode).toBe(201);
      let draft = created.json() as typeof customBlackout;
      const original = structuredClone(server.manager.getScenario("custom-blackout"));
      const reportId = nextScenarioId(draft, "report");
      draft = syncReportVisibility({ ...draft, reports: [...draft.reports, { ...draft.reports[0]!, id: reportId, content: "Fresh custom recovery evidence.", targetRoles: ["commander"], reliability: 1 }] });
      draft = putDecision(draft, { ...draft.decisions[0]!, activation: { type: "time", atSeconds: 30 }, options: [...draft.decisions[0]!.options, { id: "custom-response", label: "Request the new evidence" }] });
      draft.rules.push({ id: "custom-response-rule", trigger: { type: "decision-submitted", decisionId: "recovery-decision" }, conditions: [{ type: "selected-option", decisionId: "recovery-decision", optionId: "custom-response" }, { type: "time-window", startSeconds: 0, endSeconds: 60 }], actions: [{ type: "send-report", reportId, delayMs: 5000 }, { type: "change-object-state", objectId: "primary-zone", property: "verified", value: true }, { type: "add-score-event", dimensionId: "uncertainty-recognition", amount: 2, reason: "Requested fresh custom evidence." }], once: true });
      const saved = await server.app.inject({ method: "PUT", url: `/api/forge/scenarios/${draft.id}`, headers, payload: draft });
      expect(saved.statusCode).toBe(200);
      const validation = await server.app.inject({ method: "POST", url: `/api/forge/scenarios/${draft.id}/validate`, headers });
      expect(validation.json()).toMatchObject({ valid: true, errors: [] });
      const published = await server.app.inject({ method: "POST", url: `/api/forge/scenarios/${draft.id}/publish`, headers });
      expect(published.statusCode).toBe(200);
      const engine = new SimulationEngine(published.json());
      engine.start();
      engine.advanceBy(29);
      expect(engine.getPerception("commander").activeDecisionIds).not.toContain("recovery-decision");
      engine.advanceBy(1);
      expect(engine.getPerception("commander").activeDecisionIds).toContain("recovery-decision");
      engine.submitDecision({ roleId: "commander", decisionId: "recovery-decision", optionId: "custom-response", rationale: "Request fresh evidence to verify uncertainty before recovery.", confidence: 0.8 });
      expect(engine.getPerception("commander").reports.some((report) => report.reportId === reportId)).toBe(false);
      engine.advanceBy(5);
      expect(engine.getPerception("commander").reports).toContainEqual(expect.objectContaining({ reportId, content: "Fresh custom recovery evidence.", receivedAtSeconds: 35 }));
      expect(engine.getPerception("operations").reports.some((report) => report.reportId === reportId)).toBe(false);
      expect(engine.getGroundTruthSnapshot().objectStates["primary-zone"]).toMatchObject({ verified: true });
      expect(engine.allEvents()).toContainEqual(expect.objectContaining({ type: "SCORE_EVENT", payload: expect.objectContaining({ amount: 2, reason: "Requested fresh custom evidence." }) }));
      expect(server.manager.getScenario("custom-blackout")).toEqual(original);
      const locked = await server.app.inject({ method: "PUT", url: `/api/forge/scenarios/${draft.id}`, headers, payload: draft });
      expect(locked.statusCode).toBe(400);
      expect(locked.json().error).toBe("SCENARIO_LOCKED");
    } finally { await server.close(); }
  });

  it("switches a scheduled decision to rule activation without retaining its old timeline event", () => {
    let draft = putDecision(structuredClone(customBlackout), { ...customBlackout.decisions[0]!, activation: { type: "trigger", triggerRuleId: "activate-recovery" } });
    draft.rules.push({ id: "activate-recovery", trigger: { type: "time-reached", atSeconds: 20 }, conditions: [], actions: [{ type: "activate-decision", decisionId: "recovery-decision" }], once: true });
    expect(draft.events.some((event) => event.type === "decision-gate")).toBe(false);
    expect(validateScenario(draft).valid).toBe(true);
    const engine = new SimulationEngine(draft);
    engine.start();
    engine.advanceBy(20);
    expect(engine.getPerception("commander").activeDecisionIds).toContain("recovery-decision");
    expect(scenarioReferences(draft, "activate-recovery")).toContain("decisions[0].activation.triggerRuleId");
    expect(scenarioReferences(draft, "verify-backup", "recovery-decision")).toContain("rules[0].conditions[0].optionId");
  });

  it("creates real disaster branch differences under the verification choice", () => {
    const engine = new SimulationEngine(floodResponse);
    engine.start();
    engine.advanceBy(180);
    engine.submitDecision({ roleId: "commander", decisionId: "shelter-decision", optionId: "verify-shelter", rationale: "Verify conflicting shelter reports with current field evidence over the backup link.", confidence: 0.7 });
    engine.advanceBy(20);
    const comparison = engine.getCounterfactual("shelter-decision", "riverside");
    expect(comparison.actualBranch?.perceptions.find((perception) => perception.roleId === "commander")?.reports.some((report) => report.reportId === "shelter-verification")).toBe(true);
    expect(comparison.alternateBranch?.perceptions.find((perception) => perception.roleId === "commander")?.reports.some((report) => report.reportId === "shelter-verification")).toBe(false);
    expect(comparison.actualBranch?.objectStates["primary-zone"]).toMatchObject({ status: "restricted" });
    expect(comparison.alternateBranch?.objectStates["primary-zone"]).toMatchObject({ status: "uncertain" });
  });

  it("rejects unresolved options, invalid rules, empty recipients, and unexecutable decision schedules", () => {
    const invalid = structuredClone(customBlackout);
    invalid.reports[0]!.targetRoles = [];
    invalid.decisions[0]!.options[1]!.id = invalid.decisions[0]!.options[0]!.id;
    invalid.decisions[0]!.activation.atSeconds = 121;
    invalid.rules[0]!.conditions = [{ type: "selected-option", decisionId: "recovery-decision", optionId: "not-an-option" }, { type: "time-window", startSeconds: 100, endSeconds: 50 }];
    invalid.rules[0]!.actions = [{ type: "delay-report", reportId: "service-status", delayMs: -1 }, { type: "add-score-event", dimensionId: "unknown-score", amount: 1, reason: "" }];
    const result = validateScenario(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining(["NO_RECIPIENTS", "INVALID_OPTION_ID", "MISSING_DECISION_EVENT", "UNKNOWN_OPTION", "INVALID_TIME_WINDOW", "INVALID_RULE_NUMBER", "UNKNOWN_DIMENSION", "EMPTY_SCORE_REASON"]));
    expect(result.errors.every((error) => error.path.length > 0)).toBe(true);
  });

  it("uses the conflict report chosen by the rule without mutating its report template", () => {
    const scenario = structuredClone(customBlackout);
    scenario.rules.push({ id: "custom-conflict", trigger: { type: "time-reached", atSeconds: 10 }, conditions: [], actions: [{ type: "create-conflict", reportId: "recovery-status", conflictsWith: "blackout-brief" }], once: true });
    const engine = new SimulationEngine(scenario);
    engine.start();
    engine.advanceBy(10);
    expect(engine.getPerception("commander").reports).toContainEqual(expect.objectContaining({ reportId: "recovery-status", status: "conflicting", conflictsWith: "blackout-brief" }));
    expect(engine.getPerceptionAt("commander", 10).reports).toContainEqual(expect.objectContaining({ reportId: "recovery-status", conflictsWith: "blackout-brief" }));
    expect(scenario.reports.find((report) => report.id === "recovery-status")?.conflictsWith).toBeUndefined();
  });

  it("honors inactive channels and lets authored dropped-status conditions react", () => {
    const scenario = structuredClone(customBlackout);
    scenario.channels.find((channel) => channel.id === "coordination-net")!.status = "inactive";
    scenario.rules.push({
      id: "react-to-dropped-status",
      trigger: { type: "message-ignored", reportId: "blackout-brief", roleId: "commander" },
      conditions: [{ type: "report-status", reportId: "blackout-brief", status: "dropped" }],
      actions: [{ type: "send-instructor-alert", message: "The inactive coordination channel dropped the brief." }],
      once: true
    });
    expect(validateScenario(scenario)).toMatchObject({ valid: true, errors: [] });
    const engine = new SimulationEngine(scenario);
    engine.start();
    expect(engine.getChannelHealth("commander").find((channel) => channel.channelId === "coordination-net")).toMatchObject({ status: "offline" });
    expect(engine.getPerception("commander").reports).not.toContainEqual(expect.objectContaining({ reportId: "blackout-brief" }));
    expect(engine.allEvents()).toContainEqual(expect.objectContaining({ type: "REPORT_DROPPED", payload: expect.objectContaining({ reportId: "blackout-brief", reason: "channel-inactive" }) }));
    expect(engine.allEvents()).toContainEqual(expect.objectContaining({ type: "INSTRUCTOR_ALERT", payload: expect.objectContaining({ message: "The inactive coordination channel dropped the brief." }) }));
  });

  it("uses the latest checkpoint when a rule reactivates a decision gate", () => {
    const scenario = structuredClone(customBlackout);
    scenario.rules.push({ id: "reactivate-recovery", trigger: { type: "time-reached", atSeconds: 150 }, conditions: [], actions: [{ type: "activate-decision", decisionId: "recovery-decision" }], once: true });
    const engine = new SimulationEngine(scenario);
    engine.start(); engine.advanceBy(120);
    engine.submitDecision({ roleId: "commander", decisionId: "recovery-decision", optionId: "verify-backup", rationale: "Verify the incomplete picture before recovery.", confidence: 0.7 });
    engine.advanceBy(30);
    engine.submitDecision({ roleId: "commander", decisionId: "recovery-decision", optionId: "hold-response", rationale: "Wait for current evidence before moving.", confidence: 0.7 });
    const comparison = engine.getCounterfactual("recovery-decision", "continue-primary");
    expect(comparison.actualOptionId).toBe("hold-response");
    expect(comparison.actualBranch?.fromSeconds).toBe(150);
  });

  it("validates authored role visibility, movement ownership, properties, and physics", () => {
    const scenario = structuredClone(customBlackout);
    const commander = scenario.roles.find((role) => role.id === "commander")!;
    commander.visibility.objectIds = commander.visibility.objectIds.filter((id) => id !== "supply-cache");
    scenario.reports[0]!.targetRoles = scenario.reports[0]!.targetRoles.filter((roleId) => roleId !== "commander");
    const team = scenario.environment.objects.find((object) => object.id === "response-team")!;
    team.properties = { ...team.properties, roleId: "operations", readiness: "staged" };
    team.physics = { body: "dynamic", collider: "capsule", trigger: false, mass: 2 };
    expect(validateScenario(scenario)).toMatchObject({ valid: true, errors: [] });
    const engine = new SimulationEngine(scenario);
    engine.start();
    expect(engine.getGroundTruthSnapshot().physicsBodies["response-team"]).toBeDefined();
    expect(engine.getPerception("commander").reports).not.toContainEqual(expect.objectContaining({ reportId: scenario.reports[0]!.id }));
  });

  it("adds presets to an existing installation while retaining its saved versions and drafts", () => {
    const path = `/tmp/omnirush/sentinel-forge-${randomUUID()}.json`;
    const persistence = new JsonPersistence(path);
    const saved = structuredClone(operationSignalBreak);
    saved.metadata.title = "Saved military scenario";
    persistence.save({ version: 1, scenarios: [saved], sessions: [] });
    let first: SessionManager | undefined;
    let restored: SessionManager | undefined;
    try {
      first = new SessionManager({ persistence, autoTickMs: 0 });
      expect(first.getScenario(saved.id).metadata.title).toBe("Saved military scenario");
      expect(first.listScenarios().map((scenario) => scenario.category)).toEqual(expect.arrayContaining(["military", "disaster", "synthetic"]));
      const draft = first.createDraft("flood-response");
      draft.metadata.title = "Saved custom flood exercise";
      first.updateScenario(draft.id, draft);
      restored = new SessionManager({ persistence, autoTickMs: 0 });
      expect(restored.getScenario(draft.id).metadata.title).toBe("Saved custom flood exercise");
      expect(restored.getScenario(saved.id).metadata.title).toBe("Saved military scenario");
    } finally { first?.dispose(); restored?.dispose(); unlinkSync(path); }
  });

  it("organizes scenario families with tags, archived entries, and immutable successor versions", async () => {
    const server = await createServer({ persistenceFile: null, autoTickMs: 0, adminToken: "library-test" });
    const headers = { "x-admin-token": "library-test" };
    try {
      const versionResponse = await server.app.inject({ method: "POST", url: "/api/forge/scenarios/custom-blackout/versions", headers });
      expect(versionResponse.statusCode).toBe(201);
      const version = versionResponse.json() as typeof customBlackout;
      expect(version.version).toBe(2);
      expect(version.status).toBe("draft");
      expect(version.id).not.toBe("custom-blackout");

      const saved = structuredClone(version);
      saved.metadata.tags = [...saved.metadata.tags, "demo"];
      expect((await server.app.inject({ method: "PUT", url: `/api/forge/scenarios/${version.id}`, headers, payload: saved })).statusCode).toBe(200);
      expect((await server.app.inject({ method: "POST", url: `/api/forge/scenarios/${version.id}/publish`, headers })).statusCode).toBe(200);
      const history = await server.app.inject({ method: "GET", url: `/api/forge/scenarios/${version.id}/history`, headers });
      expect(history.json().versions.map((item: { version: number }) => item.version)).toEqual([2, 1]);
      expect(history.json().versions.find((item: { id: string }) => item.id === version.id).tags).toContain("demo");

      const archived = await server.app.inject({ method: "PUT", url: `/api/forge/scenarios/${version.id}/archive`, headers, payload: { archived: true } });
      expect(archived.statusCode).toBe(200);
      expect(archived.json().library.archived).toBe(true);
      expect(server.manager.listScenarios().some((item) => item.id === version.id)).toBe(false);
      expect(server.manager.listForgeScenarios().find((item) => item.id === version.id)?.library?.archived).toBe(true);
      const blocked = await server.app.inject({ method: "POST", url: "/api/sessions", payload: { scenarioId: version.id } });
      expect(blocked.statusCode).toBe(404);
    } finally { await server.close(); }
  });

  it("bounds cyclic rule chains while allowing a repeatable rule to run on later triggers", () => {
    const scenario = structuredClone(customBlackout);
    scenario.rules.push(
      { id: "start-restoration", trigger: { type: "time-reached", atSeconds: 10 }, conditions: [], actions: [{ type: "restore-channel", channelId: "field-link" }], once: true },
      { id: "repeat-restoration", trigger: { type: "channel-restored", channelId: "field-link" }, conditions: [], actions: [{ type: "restore-channel", channelId: "field-link" }, { type: "send-instructor-alert", message: "Restoration observed." }], once: false },
      { id: "later-restoration", trigger: { type: "time-reached", atSeconds: 20 }, conditions: [], actions: [{ type: "restore-channel", channelId: "field-link" }], once: true }
    );
    const engine = new SimulationEngine(scenario);
    engine.start();
    engine.advanceBy(10);
    expect(engine.allEvents().filter((event) => event.type === "INSTRUCTOR_ALERT" && event.payload.message === "Restoration observed.")).toHaveLength(1);
    engine.advanceBy(10);
    expect(engine.allEvents().filter((event) => event.type === "INSTRUCTOR_ALERT" && event.payload.message === "Restoration observed.")).toHaveLength(2);
  });
});
