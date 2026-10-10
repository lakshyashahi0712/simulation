import type { QueuedSessionAction, SessionActionResult } from "../../src/server/protocol.js";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Remove an action only when the authoritative server acknowledges it. */
export class SessionOutbox {
  private readonly key: string;
  private readonly actions: QueuedSessionAction[];
  private flushing = false;

  constructor(sessionId: string, private readonly store: Store) {
    this.key = `sentinel.outbox.${sessionId}`;
    try {
      const data: unknown = JSON.parse(store.getItem(this.key) ?? "[]");
      this.actions = Array.isArray(data) ? data.filter((action): action is QueuedSessionAction => Boolean(action && typeof action.id === "string" && ["session:send-text", "session:submit-decision"].includes(action.event) && action.payload && typeof action.payload === "object")).slice(0, 50) : [];
    } catch {
      this.actions = [];
    }
  }

  get count(): number { return this.actions.length; }

  enqueue(event: QueuedSessionAction["event"], payload: Record<string, unknown>): void {
    if (this.actions.length >= 50) throw new Error("Offline queue is full. Reconnect before sending more actions.");
    if (event === "session:submit-decision" && this.actions.some((action) => action.event === event && action.payload.decisionId === payload.decisionId)) throw new Error("This decision is already awaiting acknowledgement.");
    // getRandomValues works on HTTP LAN origins; randomUUID requires a secure context.
    const id = `action-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join("")}`;
    this.actions.push({ id, event, payload: structuredClone(payload) });
    this.save();
  }

  async flush(send: (action: QueuedSessionAction) => Promise<SessionActionResult>, canSend: () => boolean, onResult: (result: SessionActionResult) => void): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.actions.length > 0 && canSend()) {
        const action = this.actions[0];
        if (!action) break;
        let result: SessionActionResult;
        try { result = await send(structuredClone(action)); } catch { break; }
        if (result.id !== action.id || !["accepted", "rejected"].includes(result.status)) break;
        this.actions.shift();
        this.save();
        onResult(result);
      }
    } finally { this.flushing = false; }
  }

  clear(): void {
    this.actions.splice(0);
    this.store.removeItem(this.key);
  }

  private save(): void { this.store.setItem(this.key, JSON.stringify(this.actions)); }
}
