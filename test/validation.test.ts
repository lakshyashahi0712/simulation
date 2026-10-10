import { describe, expect, it } from "vitest";
import { operationSignalBreak } from "../src/scenarios/operation-signal-break.js";
import { validateScenario } from "../src/domain/validate.js";

describe("SENTINEL scenario validation", () => {
  it("accepts the Operation Signal Break fixture", () => {
    const result = validateScenario(operationSignalBreak);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects unresolved report references", () => {
    const invalid = structuredClone(operationSignalBreak);
    const firstEvent = invalid.events[0];
    if (!firstEvent || firstEvent.type !== "message") throw new Error("Fixture must start with a message event.");
    invalid.events[0] = { ...firstEvent, reportId: "missing-report" };

    const result = validateScenario(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNKNOWN_REPORT" }));
  });

  it("rejects a decision without enough options", () => {
    const invalid = structuredClone(operationSignalBreak);
    invalid.decisions[0]!.options = [{ id: "only-option", label: "Only option" }];

    const result = validateScenario(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "INSUFFICIENT_OPTIONS" }));
  });

  it("rejects a scenario without a completion event or scoring", () => {
    const invalid = structuredClone(operationSignalBreak);
    invalid.events = invalid.events.filter((event) => event.type !== "scenario-end");
    invalid.scoring = [];

    const result = validateScenario(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MISSING_COMPLETION_EVENT" }),
      expect.objectContaining({ code: "NO_SCORING" })
    ]));
  });

  it("rejects invalid world transforms and movement owners before publication", () => {
    const invalid = structuredClone(operationSignalBreak);
    const object = invalid.environment.objects[0]!;
    object.transform.position.x = Infinity;
    object.transform.scale.z = 0;
    object.transform.rotationY = NaN;
    object.properties = { roleId: "missing-role" };
    const result = validateScenario(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "INVALID_POSITION", path: "environment.objects[0].transform.position.x" }),
      expect.objectContaining({ code: "INVALID_SCALE", path: "environment.objects[0].transform.scale.z" }),
      expect.objectContaining({ code: "INVALID_ROTATION" }),
      expect.objectContaining({ code: "UNKNOWN_ROLE", path: "environment.objects[0].properties.roleId" })
    ]));
  });
});
