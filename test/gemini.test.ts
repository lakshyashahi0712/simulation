import { describe, expect, it } from "vitest";
import { generateScenarioDraft } from "../src/server/gemini.js";
import { operationSignalBreak } from "../src/scenarios/operation-signal-break.js";

describe("optional Gemini scenario generation", () => {
  it("falls back to a validated local draft without an API key", async () => {
    const result = await generateScenarioDraft(operationSignalBreak, "Create a synthetic logistics exercise", "");
    expect(result.source).toBe("fallback");
    expect(result.scenario.status).toBe("draft");
    expect(result.scenario.id).not.toBe(operationSignalBreak.id);
    expect(result.scenario.metadata.tags).toContain("ai-draft");
  });
});
