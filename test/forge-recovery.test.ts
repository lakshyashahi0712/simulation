import { describe, expect, it } from "vitest";
import { ForgeRecovery } from "../web/src/forge-recovery.js";
import { customBlackout } from "../src/scenarios/presets.js";

function storage() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
}

describe("Forge browser recovery", () => {
  it("preserves unsaved edits across a new instance and clears only the acknowledged draft", () => {
    const local = storage();
    const first = new ForgeRecovery(local);
    const draft = structuredClone(customBlackout); draft.status = "draft"; draft.metadata.title = "Unsaved custom work";
    first.save(draft);
    const second = new ForgeRecovery(local);
    expect(second.read(draft.id)?.scenario).toEqual(draft);
    expect(second.lastId).toBe(draft.id);
    const another = { ...draft, id: "other-draft" };
    second.save(another); second.clear(draft.id);
    expect(second.read(draft.id)).toBeUndefined();
    expect(second.read(another.id)?.scenario.id).toBe(another.id);
    expect(second.lastId).toBe(another.id);
  });
  it("does not restore malformed recovery data or save published versions", () => {
    const local = storage(); const recovery = new ForgeRecovery(local);
    local.setItem("sentinel.forge.recovery.bad", "{bad");
    expect(recovery.read("bad")).toBeUndefined();
    recovery.save(customBlackout);
    expect(recovery.read(customBlackout.id)).toBeUndefined();
  });
});
