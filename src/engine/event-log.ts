import type { RecordedEvent, RuntimeEventType, RuntimeVisibility } from "../domain/runtime.js";

export interface AppendEventInput {
  type: RuntimeEventType;
  simulationTimeSeconds: number;
  visibility: RuntimeVisibility;
  roleId?: string;
  causedByEventId?: string;
  payload: Record<string, unknown>;
}

const clone = <T>(value: T): T => structuredClone(value);

export class EventLog {
  private readonly entries: RecordedEvent[] = [];

  append(input: AppendEventInput): RecordedEvent {
    const sequence = this.entries.length + 1;
    const event: RecordedEvent = {
      id: `event-${String(sequence).padStart(6, "0")}`,
      sequence,
      type: input.type,
      simulationTimeSeconds: input.simulationTimeSeconds,
      visibility: input.visibility,
      payload: clone(input.payload),
      ...(input.roleId === undefined ? {} : { roleId: input.roleId }),
      ...(input.causedByEventId === undefined ? {} : { causedByEventId: input.causedByEventId })
    };

    this.entries.push(event);
    return clone(event);
  }

  all(): RecordedEvent[] {
    return clone(this.entries);
  }

  forRole(roleId: string): RecordedEvent[] {
    return clone(this.entries.filter((event) => event.visibility === "role" && event.roleId === roleId));
  }

  latest(): RecordedEvent | undefined {
    const latest = this.entries.at(-1);
    return latest === undefined ? undefined : clone(latest);
  }

  atOrBefore(simulationTimeSeconds: number): RecordedEvent[] {
    return clone(this.entries.filter((event) => event.simulationTimeSeconds <= simulationTimeSeconds));
  }

  restore(entries: RecordedEvent[]): void {
    this.entries.splice(0, this.entries.length, ...clone(entries));
  }
}
