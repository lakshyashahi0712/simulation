import type { ScenarioDefinition } from "../../src/domain/scenario.js";

interface RecoveryRecord { scenario: ScenarioDefinition; savedAt: string }
const prefix = "sentinel.forge.recovery.";

export class ForgeRecovery {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {}
  save(scenario: ScenarioDefinition): void {
    if (scenario.status === "published") return;
    this.storage.setItem(`${prefix}${scenario.id}`, JSON.stringify({ scenario, savedAt: new Date().toISOString() }));
    this.storage.setItem(`${prefix}last`, scenario.id);
  }
  read(id: string): RecoveryRecord | undefined {
    try {
      const raw = this.storage.getItem(`${prefix}${id}`);
      if (!raw) return;
      const record = JSON.parse(raw) as RecoveryRecord;
      if (record.scenario?.id !== id || record.scenario.status !== "draft" || !Array.isArray(record.scenario.roles) || !Array.isArray(record.scenario.reports)) return;
      return record;
    } catch { return; }
  }
  get lastId(): string | undefined { return this.storage.getItem(`${prefix}last`) ?? undefined; }
  clear(id: string): void {
    this.storage.removeItem(`${prefix}${id}`);
    if (this.lastId === id) this.storage.removeItem(`${prefix}last`);
  }
}
