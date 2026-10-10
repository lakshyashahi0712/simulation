import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/server/session-manager.js";
import { JsonPersistence } from "../src/server/persistence.js";
import { customBlackout } from "../src/scenarios/presets.js";

const managers: SessionManager[] = [];
afterEach(() => { managers.splice(0).forEach((manager) => manager.dispose()); });

function exercise() {
  const manager = new SessionManager({ autoTickMs: 0, persistence: new JsonPersistence(null) });
  managers.push(manager);
  const scenario = structuredClone(customBlackout);
  scenario.id = "playground-test";
  const zone = scenario.environment.objects.find((object) => object.id === "primary-zone")!;
  zone.transform.position = { x: 8, y: 0, z: 5 };
  zone.transform.scale = { x: 1, y: 1, z: 1 };
  const hidden = scenario.environment.objects.find((object) => object.id === "supply-cache")!;
  hidden.properties = { roleId: "operations" };
  hidden.physics!.body = "kinematic";
  scenario.roles.find((role) => role.id === "operations")!.visibility.objectIds = scenario.roles.find((role) => role.id === "operations")!.visibility.objectIds.filter((id) => id !== "supply-cache");
  scenario.rules.push({ id: "world-zone-entry", trigger: { type: "zone-entered", objectId: "primary-zone", roleId: "operations" }, conditions: [], actions: [{ type: "add-score-event", dimensionId: scenario.scoring[0]!.id, amount: 1, reason: "Confirmed physical zone entry" }], once: false });
  const draft = manager.importScenario(scenario);
  manager.publishScenario(draft.id);
  const room = manager.createSession(draft.id);
  const commander = manager.joinSession(room.session.id, "Commander", "commander");
  const operations = manager.joinSession(room.session.id, "Operations", "operations");
  const communications = manager.joinSession(room.session.id, "Comms", "communications-ew");
  manager.start(room.session.id, room.instructor.id);
  return { manager, room, commander, operations, communications };
}

describe("authoritative playground integration", () => {
  it("shares confirmed movement across roles while keeping invisible bodies out of trainee views", () => {
    const { manager, room, commander, operations, communications } = exercise();
    manager.moveObject(room.session.id, operations.participant.id, "response-team", { x: 7, y: 0, z: 5 });
    expect(manager.getView(room.session.id, room.instructor.id).groundTruth?.physicsBodies["response-team"]?.position.x).toBe(7);
    for (const participant of [commander, operations, communications]) {
      const view = manager.getView(room.session.id, participant.participant.id);
      expect(view.physicsBodies?.["response-team"]?.position.x).toBe(7);
      expect(view.groundTruth).toBeUndefined();
    }
    const operationsView = manager.getView(room.session.id, operations.participant.id);
    expect(operationsView.physicsBodies?.["supply-cache"]).toBeUndefined();
    expect(operationsView.scenario.environment.objects.some((object) => object.id === "supply-cache")).toBe(false);
  });

  it("rejects another role's movement, hidden ownership, invalid coordinates, and paused/completed controls", () => {
    const { manager, room, commander, operations } = exercise();
    const move = (id: string, objectId = "response-team", x = 7) => manager.moveObject(room.session.id, id, objectId, { x, y: 0, z: 5 });
    expect(() => move(commander.participant.id)).toThrow("assigned to your role");
    expect(() => move(operations.participant.id, "supply-cache")).toThrow("visible object");
    expect(() => move(operations.participant.id, "response-team", 61)).toThrow("inside the scenario world");
    expect(() => move(operations.participant.id, "response-team", NaN)).toThrow("finite coordinates");
    manager.pause(room.session.id, room.instructor.id);
    expect(() => move(operations.participant.id)).toThrow("running");
    manager.resume(room.session.id, room.instructor.id);
    manager.end(room.session.id, room.instructor.id);
    expect(() => move(operations.participant.id)).toThrow("running");
  });

  it("fires physical zone entry once per contact and again after exiting", () => {
    const { manager, room, operations } = exercise();
    const move = (x: number) => manager.moveObject(room.session.id, operations.participant.id, "response-team", { x, y: 0, z: 5 });
    const entryScores = () => manager.getAar(room.session.id, room.accessToken).score.dimensions.flatMap((dimension) => dimension.events).filter((event) => event.reason === "Confirmed physical zone entry");
    move(7); move(7.5);
    expect(entryScores()).toHaveLength(1);
    move(0); move(8);
    expect(entryScores()).toHaveLength(2);
    expect(manager.getAar(room.session.id, room.accessToken).events).toContainEqual(expect.objectContaining({ type: "RULE_TRIGGERED", payload: expect.objectContaining({ trigger: "zone-entered", source: "physics", roleId: "operations" }) }));
  });

  it("replays physical entry without treating the derived trigger as a second human input", () => {
    const { manager, room, commander, operations } = exercise();
    manager.advance(room.session.id, room.instructor.id, 120);
    manager.submitDecision(room.session.id, commander.participant.id, "recovery-decision", "hold-response", "Wait for current evidence.", 0.8);
    manager.moveObject(room.session.id, operations.participant.id, "response-team", { x: 8, y: 0, z: 5 });
    manager.advance(room.session.id, room.instructor.id, 30);
    manager.end(room.session.id, room.instructor.id);
    const comparison = manager.getCounterfactual(room.session.id, room.accessToken, "recovery-decision", "continue-primary");
    for (const branch of [comparison.actualBranch!, comparison.alternateBranch!]) {
      expect(branch.score.dimensions.flatMap((dimension) => dimension.events).filter((event) => event.reason === "Confirmed physical zone entry")).toHaveLength(1);
    }
  });

  it("provides instructor-wide fault health without exposing another role's private channel", () => {
    const manager = new SessionManager({ autoTickMs: 0, persistence: new JsonPersistence(null) });
    managers.push(manager);
    const room = manager.createSession("operation-signal-break");
    const comms = manager.joinSession(room.session.id, "Comms", "communications-ew");
    manager.start(room.session.id, room.instructor.id);
    manager.injectFault(room.session.id, room.instructor.id, "alpha-link", "outage", { durationSeconds: 60 });
    expect(manager.getView(room.session.id, room.instructor.id).channelHealth).toContainEqual(expect.objectContaining({ channelId: "alpha-link", status: "offline" }));
    expect(manager.getView(room.session.id, comms.participant.id).channelHealth.some((channel) => channel.channelId === "alpha-link")).toBe(false);
  });
});
