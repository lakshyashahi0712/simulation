import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type SentinelServer } from "../src/server/app.js";
import type { ScenarioDefinition } from "../src/domain/scenario.js";

const exec = promisify(execFile);
const candidates = [process.env.SENTINEL_BROWSER_BIN, resolve(homedir(), ".gstack/bin/browse"), resolve(homedir(), ".claude/skills/gstack/browse/dist/browse"), resolve(homedir(), ".claude/skills/gstack/browse/dist/browse.exe"), "/mnt/c/Users/laksh/.claude/skills/gstack/browse/dist/browse.exe"];
const browser = candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
let backend: SentinelServer;
let baseUrl = "";
let tabId: number | undefined;
let traineeTabId: number | undefined;
let operationsTabId: number | undefined;
let publishedScenarioId: string | undefined;
const checks: string[] = [];
let succeeded = false;

function screenshotPath(name: string): string {
  const path = resolve("data/browser-smoke", name);
  const mounted = /^\/mnt\/([a-z])\/(.*)$/.exec(path);
  return browser?.endsWith(".exe") && mounted ? `${mounted[1]!.toUpperCase()}:/${mounted[2]}` : path;
}

async function command(...args: string[]): Promise<string> {
  if (!browser) throw new Error("Set SENTINEL_BROWSER_BIN to your gstack browse executable.");
  // Async execution is essential: the in-memory API runs on this event loop.
  // Blocking it with spawnSync deadlocks browser requests to the API.
  const result = await exec(browser, args, { timeout: 60000, maxBuffer: 1024 * 1024 });
  return result.stdout.trim();
}
async function assertPage(expression: string, description: string) {
  expect(await command("js", expression), description).toBe("true");
  checks.push(description);
}
async function until(expression: string) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (await command("js", expression) === "true") return;
    await sleep(200);
  }
  const state = await command("js", "JSON.stringify({ tab: document.querySelector('.forge-tabs [aria-selected=true]')?.id, selectedNode: document.querySelector('.rule-graph-inspector')?.dataset.selectedNode, activeTag: document.activeElement?.tagName, activeField: document.activeElement?.closest('[data-node-field]')?.dataset.nodeField, activeDisabled: document.activeElement?.matches(':disabled'), inspectorFields: [...document.querySelectorAll('.rule-graph-inspector [data-node-field]')].map(el => el.dataset.nodeField) })");
  throw new Error(`Browser state timed out: ${expression}\nState: ${state}`);
}
const button = (text: string) => `button:has-text('${text}')`;

async function captureEvidence(name: string, selector: string) {
  // A sticky header can overlap an off-screen selector during a full-height
  // crop. Hide only that unrelated header, preserving layout and test state.
  const previous = await command("js", "(() => { const bar = document.querySelector('.topbar'); const value = bar?.style.visibility ?? ''; if (bar) bar.style.visibility = 'hidden'; return value; })()");
  try { await command("screenshot", screenshotPath(name), "--selector", selector); }
  finally { await command("js", `document.querySelector('.topbar')?.style.setProperty('visibility', ${JSON.stringify(previous)})`); }
}

describe("production browser smoke", () => {
  beforeAll(async () => {
    backend = await createServer({ autoTickMs: 0, persistenceFile: null, adminToken: "local-sentinel-admin", staticWebDirectory: "dist/web" });
    await backend.app.listen({ host: "0.0.0.0", port: Number(process.env.SENTINEL_SMOKE_PORT ?? 0) });
    const address = backend.app.server.address();
    if (!address || typeof address === "string") throw new Error("Missing smoke server address.");
    baseUrl = `http://localhost:${address.port}`;
    const created = JSON.parse(await command("newtab", baseUrl, "--json")) as { tabId: number };
    tabId = created.tabId;
    await command("console", "--clear");
  });
  afterAll(async () => {
    if (operationsTabId !== undefined) await command("closetab", String(operationsTabId)).catch(() => {});
    if (traineeTabId !== undefined) await command("closetab", String(traineeTabId)).catch(() => {});
    if (tabId !== undefined) {
      await command("dialog-accept").catch(() => {});
      await command("closetab", String(tabId)).catch(() => {});
    }
    backend?.io.disconnectSockets(true);
    backend?.app.server.closeAllConnections();
    await backend?.close();
    mkdirSync("data/browser-smoke", { recursive: true });
    writeFileSync("data/browser-smoke/checks.json", JSON.stringify({ status: succeeded ? "passed" : "failed", checks, completedAt: new Date().toISOString() }, null, 2));
  });

  it("authors, recovers, validates, and publishes a visual rule graph on desktop/mobile", async () => {
    await until("document.body.textContent.includes('Open SENTINEL Forge')");
    await captureEvidence("launcher-desktop.png", ".launcher-page");
    await command("viewport", "375x812");
    await assertPage("document.documentElement.scrollWidth <= innerWidth", "mobile launcher has no horizontal overflow");
    await captureEvidence("launcher-mobile.png", ".launcher-page");
    await command("viewport", "1440x900");
    await command("click", button("Open SENTINEL Forge"));
    await command("wait", ".forge-authoring");
    await command("select", ".forge-preset-row select", "custom-blackout");
    await command("click", button("New draft"));
    await until("document.querySelector('.forge-editor-header .eyebrow')?.textContent.includes('DRAFT') === true");
    await until("document.querySelector('.forge-canvas-panel .world-canvas-host')?.dataset.rendered === 'true'");
    await assertPage("Number(document.querySelector('.forge-canvas-panel .world-canvas-host').dataset.drawCalls) > 0", "Forge renders real WebGL geometry");
    await command("fill", '.forge-meta label:has-text("Title") input', "Browser smoke recovery");
    await until("document.body.textContent.includes('Unsaved draft backed up')");
    await command("click", button("Return to launcher"));
    await command("reload");
    await command("wait", ".launch-grid");
    await command("click", button("Open SENTINEL Forge"));
    await command("wait", button("Restore recovered edits"));
    await command("click", button("Restore recovered edits"));
    await assertPage("document.querySelector('.forge-meta input').value === 'Browser smoke recovery'", "unsaved Forge draft survives navigation and reload");

    await command("click", '.forge-physics-card[data-object-id="response-team"] summary');
    await command("select", '.forge-physics-card[data-object-id="response-team"] label:has-text("Body") select', "dynamic");
    await command("select", '.forge-physics-card[data-object-id="response-team"] label:has-text("Movement owner") select', "operations");
    await command("fill", '.forge-physics-card[data-object-id="response-team"] label:has-text("Rotation Y") input', String(Math.PI / 2));
    await command("click", '.forge-visibility-card[data-role-id="commander"] label:has-text("Backup Equipment") input');
    await command("click", '#forge-tab-reports');
    await command("click", button("+ Add report"));
    await command("click", '.forge-entity:last-of-type summary');
    await command("fill", '.forge-entity:last-of-type textarea', "Synthetic browser-authored report.");
    await command("click", '.forge-entity:last-of-type button:has-text("Schedule delivery")');
    await command("click", '#forge-tab-decisions');
    await command("fill", '.forge-entity label:has-text("Activation time") input', "30");
    await command("fill", '.forge-entity label:has-text("Decision title") input', "Smoke coordination choice");
    await command("click", '#forge-tab-rules');
    await assertPage("document.querySelectorAll('.forge-rule-flow li').length === 3", "rule flow displays trigger, conditions, and ordered actions");
    const graph = '.rule-graph-editor[data-rule-id="backup-recovery-rule"]';
    const inspector = `${graph} .rule-graph-inspector`;
    await assertPage("document.querySelectorAll('.rule-graph-node').length === 6 && document.querySelectorAll('.rule-graph-edge').length === 5", "legacy rules open as connected executable graph nodes");
    await command("select", `${inspector} > label select`, "action-3");
    await command("fill", `${inspector} label:has-text("Score amount") input`, "2");
    await command("select", `${graph} label:has-text("New condition") select`, "time-window");
    await command("click", button("+ Add condition node"));
    await command("fill", `${inspector} label:has-text("Window end") input`, "90");
    await command("select", `${graph} label:has-text("New action") select`, "restore-channel");
    await command("click", button("+ Add action node"));
    await command("select", `${inspector} label:has-text("Node type") select`, "send-instructor-alert");
    await command("fill", `${inspector} textarea`, "Visual graph verified the backup-channel choice.");
    await command("click", button("+ Add action node"));
    await command("click", button("Remove selected node"));
    await command("select", `${inspector} > label select`, "node-2");
    await command("click", `${graph} [data-node-id="node-2"] .rule-port.output`);
    await command("click", `${graph} [data-node-id="action-3"] .rule-port.input`);
    await assertPage(`document.querySelector('[data-node-id="action-3"]').dataset.nodeIndex === '4' && document.querySelector('.rule-graph-edge[data-source="node-2"][data-target="action-3"]') !== null`, "compatible ports reconnect real action execution order");
    await command("select", `${inspector} label:has-text("Run after") select`, "First action (after all conditions)");
    await command("click", button("Move later"));
    await command("click", button("Move earlier"));
    await command("click", button("Arrange nodes"));
    await command("click", `${graph} [data-node-id="action-3"] .rule-node-header`);
    await command("press", "ArrowRight");
    await assertPage(`document.querySelector('[data-node-id="action-3"]').dataset.x === '624' && document.querySelectorAll('.rule-graph-node[data-node-kind="condition"]').length === 2 && document.querySelectorAll('.rule-graph-node[data-node-kind="action"]').length === 5`, "graph supports typed nodes, removal, ordering, arrangement, and keyboard layout editing");
    await until("document.body.textContent.includes('Unsaved draft backed up')");
    await command("click", button("Return to launcher"));
    await command("reload");
    await command("wait", ".launch-grid");
    await command("click", button("Open SENTINEL Forge"));
    await command("wait", button("Restore recovered edits"));
    await command("click", button("Restore recovered edits"));
    await command("click", "#forge-tab-rules");
    await assertPage(`document.querySelector('[data-node-id="action-3"]').dataset.x === '624' && document.querySelectorAll('.rule-graph-node').length === 8`, "unsaved graph layout and executable edits survive navigation and reload");
    await command("click", button("Save draft"));
    await until("document.body.textContent.includes('Draft saved.') && document.querySelector('.forge-toolbar button').disabled === false");
    const graphDraft = backend.manager.listForgeScenarios().find((item) => item.title === "Browser smoke recovery");
    expect(graphDraft, "saved graph draft is present in the Forge catalog").toBeDefined();
    expect(backend.manager.getScenario(graphDraft!.id).rules[0]?.editor?.graph.nodes.find((node) => node.id === "action-3")?.position.x).toBe(624);
    await command("select", `${inspector} > label select`, "action-3");
    await command("fill", `${inspector} label:has-text("Reason") textarea`, "   ");
    await command("click", "#forge-tab-reports");
    await command("click", button("Validate"));
    await command("wait", ".validation-banner.invalid");
    await command("click", '.validation-link:has-text("rules[0].actions[0].reason")');
    await until("document.querySelector('.rule-graph-inspector').dataset.selectedNode === 'action-3' && document.activeElement.closest('[data-node-field]')?.dataset.nodeField === 'reason'");
    // Repeating the same link with the graph already mounted must focus the
    // newly selected fields, rather than the inspector's node selector.
    await command("click", '.validation-link:has-text("rules[0].actions[0].reason")');
    await until("document.querySelector('.rule-graph-inspector').dataset.selectedNode === 'action-3' && document.activeElement.closest('[data-node-field]')?.dataset.nodeField === 'reason'");
    await command("fill", `${inspector} label:has-text("Reason") textarea`, "Visual graph verified the backup-channel choice.");
    checks.push("validation links select the graph node and focus its invalid field");
    await command("click", button("Fit graph"));
    await captureEvidence("rule-graph-desktop.png", graph);
    await command("viewport", "375x812");
    await command("select", `${inspector} > label select`, "action-3");
    await assertPage("document.documentElement.scrollWidth <= innerWidth && getComputedStyle(document.querySelector('.rule-graph-layout')).gridTemplateColumns.split(' ').length === 1", "mobile rule graph stacks its inspector without horizontal overflow");
    await captureEvidence("rule-graph-mobile.png", graph);
    await command("viewport", "1440x900");
    // Validate a real authoring error, then use its field link to open the editor.
    await command("click", "#forge-tab-reports");
    await command("click", '.forge-entity:last-of-type summary');
    await command("fill", '.forge-entity:last-of-type textarea', "   ");
    await command("click", button("Validate"));
    await command("wait", ".validation-banner.invalid");
    await command("click", '.validation-link:has-text("content")');
    await until("document.querySelector('#forge-tab-reports')?.getAttribute('aria-selected') === 'true'");
    await command("fill", '.forge-entity:last-of-type textarea', "Synthetic browser-authored report.");
    checks.push("validation identifies the empty report and links back to its editor");

    await command("viewport", "375x812");
    await assertPage("document.documentElement.scrollWidth <= innerWidth", "mobile Forge has no horizontal overflow");
    mkdirSync("data/browser-smoke", { recursive: true });
    await captureEvidence("forge-mobile.png", ".forge-world-authoring");
    await command("viewport", "1440x900");
    await command("click", button("Validate"));
    await command("wait", ".validation-banner.valid");
    await command("click", button("Publish scenario"));
    await until("document.querySelector('.forge-editor-header .eyebrow')?.textContent.includes('PUBLISHED') === true");
    await assertPage("document.querySelector('.forge-world-grid').disabled && document.querySelector('.forge-authoring-content').disabled", "published authoring is read-only");
    await command("click", "#forge-tab-rules");
    await command("select", `${inspector} > label select`, "node-2");
    await command("click", button("Fit graph"));
    await assertPage("document.querySelector('.rule-graph-editor').dataset.readOnly === 'true' && document.querySelector('.rule-graph-node-fields').disabled && document.querySelector('.rule-graph-toolbar').disabled && document.querySelector('.rule-graph-once input').disabled && !document.querySelector('.rule-graph-inspector > label select').disabled", "published graphs disable edits while keeping node inspection and navigation available");
    await command("select", '.forge-canvas-panel label:has-text("Preview object") select', "response-team");
    await command("click", button("Focus selected"));
    await until("document.querySelector('.world-canvas-host')?.dataset.camera === 'focused'");
    await captureEvidence("forge-3d-desktop.png", ".forge-canvas-panel");

    const published = backend.manager.listScenarios().find((scenario) => scenario.title === "Browser smoke recovery")!;
    const definition = backend.manager.getScenario(published.id) as ScenarioDefinition;
    expect(definition.reports.at(-1)?.content).toBe("Synthetic browser-authored report.");
    expect(definition.decisions[0]?.activation.atSeconds).toBe(30);
    expect(definition.environment.objects.find((object) => object.id === "response-team")?.physics?.body).toBe("dynamic");
    expect(definition.environment.objects.find((object) => object.id === "response-team")?.transform.rotationY).toBeCloseTo(Math.PI / 2);
    expect(definition.roles.find((role) => role.id === "commander")?.visibility.objectIds).not.toContain("supply-cache");
    expect(definition.rules[0]?.conditions[1]).toEqual({ type: "time-window", startSeconds: 0, endSeconds: 90 });
    expect(definition.rules[0]?.actions[0]).toMatchObject({ type: "add-score-event", amount: 2 });
    expect(definition.rules[0]?.actions.at(-1)).toEqual({ type: "send-instructor-alert", message: "Visual graph verified the backup-channel choice." });
    expect(definition.rules[0]?.editor?.graph.nodes.find((node) => node.id === "action-3")?.position.x).toBe(624);
    checks.push("saved publication retains report, decision, rule, visibility, and physics edits");
    publishedScenarioId = published.id;
  });

  it("executes the published graph, synchronizes 3D clients, and explains its branches in TruthLens", async () => {
    expect(publishedScenarioId, "Forge publication gate completed").toBeDefined();
    await command("tab", String(tabId));
    await command("viewport", "1440x900");
    await command("click", button("Return to launcher"));
    await until(`document.querySelector('.primary-card select')?.querySelector('option[value="${publishedScenarioId}"]') !== null`);
    await command("select", ".primary-card select", publishedScenarioId!);
    await command("click", button("Create exercise room"));
    await command("wait", ".instructor-workspace");
    await until("document.querySelector('.world-canvas-host')?.dataset.rendered === 'true'");
    const bootstrap = JSON.parse(await command("js", "sessionStorage.getItem('sentinel.session.bootstrap')")) as { sessionId: string; accessToken: string; roomCode: string };
    const traineeTab = JSON.parse(await command("newtab", baseUrl, "--json")) as { tabId: number };
    traineeTabId = traineeTab.tabId;
    await command("wait", ".launch-grid");
    await command("fill", '.launch-card label:has-text("Display name") input', "Smoke Commander");
    await command("fill", ".room-code-input", bootstrap.roomCode);
    await command("click", button("Join exercise"));
    await command("wait", ".trainee-workspace");
    await until("document.querySelector('.world-canvas-host')?.dataset.rendered === 'true'");
    await assertPage("document.querySelector('.trainee-workspace') !== null && document.querySelector('.world-canvas-host').dataset.objectCount === '4' && !document.querySelector('.playground-panel [data-object-id=\"supply-cache\"]') && !document.querySelector('.world-inspector option[value=\"supply-cache\"]')", "trainee joins with authored 3D object visibility");
    await command("select", ".world-inspector select", "response-team");
    await assertPage("!document.querySelector('.world-movement')", "Commander cannot move the Operations-owned team");
    const operationsTab = JSON.parse(await command("newtab", baseUrl, "--json")) as { tabId: number };
    operationsTabId = operationsTab.tabId;
    await command("wait", ".launch-grid");
    await command("fill", '.launch-card label:has-text("Display name") input', "Smoke Operations");
    await command("fill", ".room-code-input", bootstrap.roomCode);
    await command("select", ".launch-card:not(.primary-card) select", "operations");
    await command("click", button("Join exercise"));
    await command("wait", ".trainee-workspace");
    await until("document.querySelector('.world-canvas-host')?.dataset.rendered === 'true'");
    await assertPage("document.querySelector('[aria-label=\"Move east\"]').disabled", "world movement waits for the instructor to start");
    await command("tab", String(tabId));
    await command("click", button("Start exercise"));
    await command("wait", ".exercise-status.live");
    await command("click", button("Advance simulation seconds"));
    await until("document.querySelector('.metric-card strong')?.textContent === '00:30'");
    await captureEvidence("instructor-desktop.png", ".instructor-workspace");
    await command("viewport", "375x812");
    await assertPage("document.documentElement.scrollWidth <= innerWidth", "mobile instructor console has no horizontal overflow");
    await captureEvidence("instructor-mobile.png", ".instructor-workspace");
    await command("viewport", "1440x900");
    await command("tab", String(operationsTabId));
    await until("document.querySelector('[aria-label=\"Move east\"]')?.disabled === false");
    await command("click", '[aria-label="Move east"]');
    await until("document.querySelector('.world-position')?.textContent.includes('X 7.0') === true");
    await command("js", "document.querySelector('.world-canvas-host canvas').focus()");
    await command("press", "ArrowLeft");
    await until("document.querySelector('.world-position')?.textContent.includes('X 5.0') === true");
    await command("press", "ArrowRight");
    await until("document.querySelector('.world-position')?.textContent.includes('X 7.0') === true");
    checks.push("focused canvas keyboard controls move the owned body through the server");
    expect(backend.manager.getView(bootstrap.sessionId, backend.manager.getSessionSummary(bootstrap.sessionId).participants.find((participant) => participant.kind === "instructor")!.id).groundTruth?.physicsBodies["response-team"]?.position.x).toBe(7);
    await command("tab", String(tabId));
    await command("select", ".world-inspector select", "response-team");
    await until("document.querySelector('.world-position')?.textContent.includes('X 7.0') === true");
    await sleep(100);
    await assertPage("(() => { const labels = [...document.querySelectorAll('.world-label')].filter(label => !label.hidden); const rects = labels.map(label => label.getBoundingClientRect()); return labels.length === 5 && rects.every((a, index) => rects.slice(index + 1).every(b => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)); })()", "overview labels remain readable without overlapping");
    await captureEvidence("playground-overview.png", ".playground-panel");
    await command("click", button("Focus selected"));
    await captureEvidence("playground-desktop.png", ".playground-panel");
    checks.push("Operations movement reaches the instructor's authoritative 3D view");
    await command("tab", String(operationsTabId));
    await command("click", button("Plan view"));
    await assertPage("document.querySelector('.world-plan [data-object-id=\"response-team\"]') !== null && !document.querySelector('.world-canvas-host canvas')", "plan view preserves role-scoped objects and releases the 3D canvas");
    await command("click", button("3D view"));
    await until("document.querySelector('.world-canvas-host')?.dataset.rendered === 'true'");
    await command("click", button("Focus selected"));
    await command("viewport", "375x812");
    await assertPage("document.documentElement.scrollWidth <= innerWidth && document.querySelector('.world-movement') !== null", "mobile playground has usable movement controls without horizontal overflow");
    await captureEvidence("playground-mobile.png", ".playground-panel");
    await command("viewport", "1440x900");
    await command("js", "document.querySelector('.world-canvas-host canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()");
    await until("document.querySelector('.world-viewport')?.dataset.viewMode === 'plan'");
    await assertPage("document.querySelector('.world-notice').textContent.includes('context was lost') && document.querySelector('.world-position').textContent.includes('X 7.0')", "graphics context loss falls back without losing confirmed position");
    await command("click", button("3D view"));
    await until("document.querySelector('.world-canvas-host')?.dataset.rendered === 'true'");
    await command("tab", String(traineeTabId));
    await command("wait", ".decision-live");
    await captureEvidence("trainee-desktop.png", ".trainee-workspace");
    await command("viewport", "375x812");
    await assertPage("document.documentElement.scrollWidth <= innerWidth", "mobile trainee console has no horizontal overflow");
    await captureEvidence("trainee-mobile.png", ".trainee-workspace");
    await command("viewport", "1440x900");
    await command("click", '.decision-options input[value="verify-backup"]');
    await command("fill", ".decision-panel textarea", "Verify incomplete reports with the team on the backup channel.");
    await command("click", button("Submit decision"));
    await until("document.querySelector('.decision-live') === null && !document.querySelector('.outbox-status')");
    expect(backend.manager.getAar(bootstrap.sessionId, bootstrap.accessToken).decisions).toHaveLength(1);
    checks.push("trainee submits a decision through the acknowledged browser outbox");
    expect(backend.manager.getAar(bootstrap.sessionId, bootstrap.accessToken).events).toContainEqual(expect.objectContaining({ type: "INSTRUCTOR_ALERT", payload: expect.objectContaining({ message: "Visual graph verified the backup-channel choice." }) }));
    expect(backend.manager.getAar(bootstrap.sessionId, bootstrap.accessToken).events).toContainEqual(expect.objectContaining({ type: "SCORE_EVENT", payload: expect.objectContaining({ amount: 2, reason: "Visual graph verified the backup-channel choice." }) }));
    checks.push("visually authored conditions and actions execute after the live decision");
    await command("tab", String(tabId));
    await command("click", button("Advance simulation seconds"));
    await command("click", button("End exercise"));
    await command("wait", ".exercise-status.ended");
    await sleep(200);
    const idleFrames = await command("js", "document.querySelector('.world-canvas-host').dataset.frames");
    await sleep(1200);
    await assertPage(`document.querySelector('.world-canvas-host').dataset.frames === ${JSON.stringify(idleFrames)}`, "3D renderer sleeps when the world and camera are unchanged");
    await command("tab", String(operationsTabId));
    await until("document.querySelector('[aria-label=\"Move east\"]')?.disabled === true");
    checks.push("completed exercise disables world movement");
    await command("tab", String(tabId));
    await command("click", button("Open AAR"));
    await command("wait", ".truthlens-panel:not(.comparison-panel)");
    await command("select", ".comparison-panel label:has-text('Alternate option') select", "continue-primary");
    await command("click", button("Compare branches"));
    await command("wait", ".branch-evidence:first-child");
    await assertPage("document.querySelectorAll('.branch-evidence').length === 2 && document.querySelector('.branch-evidence').textContent.includes('recovery-status')", "TruthLens renders real actual/alternate branch evidence");
    await assertPage("document.querySelector('.branch-evidence:first-child').textContent.includes('Visual graph verified the backup-channel choice.') && !document.querySelector('.branch-evidence:last-child').textContent.includes('Visual graph verified the backup-channel choice.')", "TruthLens explains graph-authored effects in the actual branch only");
    await captureEvidence("truthlens-desktop.png", ".comparison-panel");
    await command("viewport", "375x812");
    await assertPage("document.documentElement.scrollWidth <= innerWidth && getComputedStyle(document.querySelector('.comparison-body .truthlens-grid')).gridTemplateColumns.split(' ').length === 1", "mobile TruthLens stacks branches without horizontal overflow");
    await captureEvidence("truthlens-mobile.png", ".comparison-panel");
    const errors = await command("console", "--errors");
    expect(errors).not.toContain("[error]");
    succeeded = true;
  });
});
