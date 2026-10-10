import "./environment.js";
const apiBase = (process.env.SENTINEL_API_URL ?? `${process.env.SENTINEL_TLS_CERT ? "https" : "http"}://127.0.0.1:${process.env.PORT ?? "3001"}`).replace(/\/$/, "");
const webUrl = process.env.SENTINEL_WEB_URL;

async function check(url: string): Promise<Response> {
  try { return await fetch(url, { signal: AbortSignal.timeout(5000) }); }
  catch (error) { throw new Error(`Cannot reach ${url}: ${error instanceof Error ? error.message : "request failed"}`); }
}

const health = await check(`${apiBase}/health`);
if (!health.ok) throw new Error(`API health failed: HTTP ${health.status}`);
const healthPayload = await health.json() as { status?: string };
if (healthPayload.status !== "ok") throw new Error("API health response did not report status=ok.");

const scenarios = await check(`${apiBase}/api/scenarios`);
if (!scenarios.ok) throw new Error(`Scenario catalog failed: HTTP ${scenarios.status}`);
const scenarioPayload = await scenarios.json() as { scenarios?: unknown[] };
if (!Array.isArray(scenarioPayload.scenarios) || scenarioPayload.scenarios.length === 0) throw new Error("Published scenario catalog is empty.");
console.log(`PASS API health and published scenario catalog (${scenarioPayload.scenarios.length} scenario(s)).`);

if (webUrl) {
  const web = await check(webUrl);
  if (!web.ok) throw new Error(`Web health failed: HTTP ${web.status}`);
  const html = await web.text();
  if (!html.includes("SENTINEL") || !html.includes('id="root"')) throw new Error("Web response did not contain the SENTINEL shell.");
  const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map((match) => match[1]!);
  if (assetPaths.length === 0) throw new Error("No built web assets found. Use npm run start:release.");
  for (const path of assetPaths) {
    const asset = await check(new URL(path, webUrl).href);
    if (!asset.ok) throw new Error(`Built asset failed: ${path} HTTP ${asset.status}`);
  }
  console.log(`PASS web shell ${webUrl}`);
}
