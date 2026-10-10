import { describe, expect, it } from "vitest";
import { SessionOutbox } from "../web/src/session-outbox.js";

function store() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

describe("durable browser outbox", () => {
  it("keeps unacknowledged actions across refresh and retries the same ID", async () => {
    const storage = store();
    const original = new SessionOutbox("room", storage);
    original.enqueue("session:send-text", { channelId: "command-net", content: "Verify" });
    let sentId = "";
    await original.flush(async (action) => { sentId = action.id; throw new Error("Ack lost"); }, () => true, () => {});
    expect(original.count).toBe(1);
    const refreshed = new SessionOutbox("room", storage);
    await refreshed.flush(async (action) => {
      expect(action.id).toBe(sentId);
      return { id: action.id, status: "accepted" };
    }, () => true, () => {});
    expect(new SessionOutbox("room", storage).count).toBe(0);
  });

  it("waits for authoritative state and surfaces definitive rejections without retrying them", async () => {
    const outbox = new SessionOutbox("room", store());
    outbox.enqueue("session:submit-decision", { decisionId: "gate" });
    expect(() => outbox.enqueue("session:submit-decision", { decisionId: "gate" })).toThrow("awaiting acknowledgement");
    await outbox.flush(async () => { throw new Error("Should not send"); }, () => false, () => {});
    expect(outbox.count).toBe(1);
    let reason = "";
    await outbox.flush(async (action) => ({ id: action.id, status: "rejected", message: "Decision expired" }), () => true, (result) => { reason = result.message ?? ""; });
    expect(reason).toBe("Decision expired");
    expect(outbox.count).toBe(0);
  });
});
