import { describe, expect, it } from "vitest";
import { SimulationClock } from "../src/engine/clock.js";

describe("SimulationClock", () => {
  it("supports start, pause, resume, and end transitions", () => {
    const clock = new SimulationClock();

    clock.start();
    expect(clock.state).toBe("running");
    clock.advanceTo(10);
    expect(clock.timeSeconds).toBe(10);
    clock.pause();
    expect(clock.state).toBe("paused");
    clock.resume();
    clock.advanceTo(25);
    clock.end();

    expect(clock.timeSeconds).toBe(25);
    expect(clock.state).toBe("ended");
  });

  it("rejects backwards movement", () => {
    const clock = new SimulationClock();
    clock.start();
    clock.advanceTo(10);

    expect(() => clock.advanceTo(9)).toThrow("move forward");
  });
});
