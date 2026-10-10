import type { ObservedReport, PerceptionSnapshot, RecordedEvent } from "../domain/runtime.js";
import type { ReportTemplate } from "../domain/scenario.js";

/** Reconstruct only information delivered to a role, in append order, at a simulation time. */
export function reconstructPerception(
  events: RecordedEvent[], roleId: string, atSeconds: number, templates: ReportTemplate[] = []
): PerceptionSnapshot {
  if (!Number.isFinite(atSeconds) || atSeconds < 0) throw new Error("Perception time must be a non-negative finite number.");
  const reports = new Map<string, ObservedReport>();
  const messages = new Map<string, NonNullable<PerceptionSnapshot["textMessages"]>[number]>();
  const gates = new Map<string, number | undefined>();
  const byId = new Map(templates.map((report) => [report.id, report]));
  for (const event of events) {
    if (event.simulationTimeSeconds > atSeconds) continue;
    if (event.type === "SCENARIO_ENDED") gates.clear();
    if (event.type === "DECISION_EXPIRED" || event.type === "DECISION_SUBMITTED") gates.delete(String(event.payload.decisionId));
    if (event.visibility !== "role" || event.roleId !== roleId) continue;
    if (event.type === "REPORT_DELIVERED") {
      const id = String(event.payload.reportId);
      const recorded = event.payload.observedReport as ObservedReport | undefined;
      const template = byId.get(id);
      // Old logs used the immutable scenario template; new logs freeze the exact delivered report.
      if (recorded) reports.set(id, structuredClone(recorded));
      else if (template) reports.set(id, {
        reportId: id, sourceRole: template.sourceRole, channelId: template.channelId,
        domain: template.domain, priority: template.priority, content: template.content,
        generatedAtSeconds: Number(event.payload.generatedAtSeconds ?? template.generatedAtSeconds),
        receivedAtSeconds: Number(event.payload.receivedAtSeconds ?? event.simulationTimeSeconds),
        delayMs: Number(event.payload.delayMs ?? 0), status: (event.payload.status as ObservedReport["status"]) ?? "delivered",
        reliability: template.reliability,
        ...(template.conflictsWith === undefined ? {} : { conflictsWith: template.conflictsWith })
      });
    } else if (event.type === "TEXT_MESSAGE_SENT") {
      const id = String(event.payload.messageId ?? event.id);
      messages.set(id, {
        messageId: id, senderRole: String(event.payload.senderRole), channelId: String(event.payload.channelId),
        content: String(event.payload.content), generatedAtSeconds: Number(event.payload.generatedAtSeconds ?? event.simulationTimeSeconds),
        receivedAtSeconds: Number(event.payload.receivedAtSeconds ?? event.simulationTimeSeconds)
      });
    } else if (event.type === "DECISION_REQUIRED") {
      gates.set(String(event.payload.decisionId), typeof event.payload.expiresAtSeconds === "number" ? event.payload.expiresAtSeconds : undefined);
    }
  }
  return {
    roleId, reports: [...reports.values()], capturedAtSeconds: atSeconds, textMessages: [...messages.values()],
    activeDecisionIds: [...gates].filter(([, deadline]) => deadline === undefined || deadline > atSeconds).map(([id]) => id)
  };
}
