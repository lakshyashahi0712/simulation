import { randomBytes } from "node:crypto";
import { validateScenario } from "../domain/validate.js";
import type { ScenarioDefinition } from "../domain/scenario.js";

export interface ScenarioGenerationResult {
  scenario: ScenarioDefinition;
  source: "gemini" | "fallback";
  warning?: string;
}

export async function generateScenarioDraft(baseScenario: ScenarioDefinition, prompt: string, apiKey = process.env.GEMINI_API_KEY): Promise<ScenarioGenerationResult> {
  const generatedId = `${baseScenario.id}-ai-${randomBytes(3).toString("hex")}`;
  const fallback = buildFallback(baseScenario, prompt, generatedId);
  if (!apiKey?.trim()) return { scenario: fallback, source: "fallback", warning: "GEMINI_API_KEY is not configured; created a validated local draft instead." };

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: [
          "You are a scenario author for SENTINEL, a synthetic decision-training simulator.",
          "Return JSON only. Do not include markdown fences, real-world operational data, real frequencies, targeting instructions, or executable code.",
          "Use the supplied scenario as a schema-conforming base. Return a JSON object containing only replaceable fields: metadata, roles, environment, channels, reports, events, rules, decisions, objectives, scoring, aar.",
          `Author request: ${prompt}`,
          `Base scenario JSON:\n${JSON.stringify(baseScenario)}`
        ].join("\n\n") }] }],
        generationConfig: { temperature: 0.35, responseMimeType: "application/json" }
      })
    });
    if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status}.`);
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    const patch = JSON.parse(stripJsonFences(text)) as Partial<ScenarioDefinition>;
    const candidate = applySafePatch(baseScenario, patch, generatedId, prompt);
    const validation = validateScenario(candidate);
    if (!validation.valid) throw new Error(`Generated draft failed validation: ${validation.errors[0]?.message ?? "unknown validation error"}`);
    return { scenario: candidate, source: "gemini" };
  } catch (error) {
    return {
      scenario: fallback,
      source: "fallback",
      warning: `Gemini generation was unavailable; created a validated local draft instead. ${error instanceof Error ? error.message : "Unknown generation error."}`
    };
  }
}

function buildFallback(baseScenario: ScenarioDefinition, prompt: string, id: string): ScenarioDefinition {
  return applySafePatch(baseScenario, {}, id, prompt);
}

function applySafePatch(baseScenario: ScenarioDefinition, patch: Partial<ScenarioDefinition>, id: string, prompt: string): ScenarioDefinition {
  const candidate = structuredClone(baseScenario);
  const replaceableFields: Array<keyof ScenarioDefinition> = ["roles", "environment", "channels", "reports", "events", "rules", "decisions", "objectives", "scoring", "aar"];
  for (const field of replaceableFields) {
    if (patch[field] !== undefined) (candidate[field] as unknown) = structuredClone(patch[field]);
  }
  candidate.id = id;
  candidate.version = 1;
  candidate.status = "draft";
  candidate.metadata = {
    ...candidate.metadata,
    ...(patch.metadata ?? {}),
    title: patch.metadata?.title ?? `${baseScenario.metadata.title} / AI Draft`,
    description: patch.metadata?.description ?? `Synthetic training draft generated from: ${prompt.trim().slice(0, 180)}`,
    tags: [...new Set([...(candidate.metadata.tags ?? []), "ai-draft"])]
  };
  return candidate;
}

function stripJsonFences(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}
