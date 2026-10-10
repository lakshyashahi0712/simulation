import { describe, expect, it } from "vitest";
import { PhysicsWorld } from "../src/engine/physics-world.js";

describe("SENTINEL physics world", () => {
  it("advances dynamic bodies and emits a trigger contact once", () => {
    const world = new PhysicsWorld([
      {
        id: "unit",
        type: "unit",
        name: "Moving unit",
        transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } },
        physics: { body: "dynamic", collider: "sphere", trigger: false }
      },
      {
        id: "zone",
        type: "zone",
        name: "Trigger zone",
        transform: { position: { x: 2, y: 0, z: 0 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } },
        physics: { body: "fixed", collider: "sphere", trigger: true }
      }
    ]);

    world.setPose("unit", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(world.step(1)).toEqual([{ objectId: "unit", otherObjectId: "zone", trigger: true }]);
    expect(world.step(0)).toEqual([]);
    expect(world.getBody("unit").position.x).toBe(1);
  });
});
