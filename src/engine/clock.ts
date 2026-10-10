export type ClockState = "stopped" | "running" | "paused" | "ended";

export class SimulationClock {
  private currentTimeSeconds = 0;
  private currentState: ClockState = "stopped";

  get timeSeconds(): number {
    return this.currentTimeSeconds;
  }

  get state(): ClockState {
    return this.currentState;
  }

  start(): void {
    if (this.currentState !== "stopped") {
      throw new Error(`Cannot start a clock in ${this.currentState} state.`);
    }
    this.currentState = "running";
  }

  pause(): void {
    if (this.currentState !== "running") {
      throw new Error(`Cannot pause a clock in ${this.currentState} state.`);
    }
    this.currentState = "paused";
  }

  resume(): void {
    if (this.currentState !== "paused") {
      throw new Error(`Cannot resume a clock in ${this.currentState} state.`);
    }
    this.currentState = "running";
  }

  end(): void {
    if (this.currentState === "stopped" || this.currentState === "ended") {
      throw new Error(`Cannot end a clock in ${this.currentState} state.`);
    }
    this.currentState = "ended";
  }

  restore(timeSeconds: number, state: ClockState): void {
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
      throw new Error("Clock restore time must be a non-negative finite number.");
    }
    this.currentTimeSeconds = timeSeconds;
    this.currentState = state;
  }

  advanceTo(nextTimeSeconds: number): void {
    if (this.currentState !== "running") {
      throw new Error(`Cannot advance a clock in ${this.currentState} state.`);
    }
    if (!Number.isFinite(nextTimeSeconds) || nextTimeSeconds < this.currentTimeSeconds) {
      throw new Error("Clock time must move forward to a finite value.");
    }
    this.currentTimeSeconds = nextTimeSeconds;
  }
}
