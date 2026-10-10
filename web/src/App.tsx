import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { SessionAar, SessionView, SessionActionResult, ScenarioSummary } from "../../src/server/protocol.js";
import { ScenarioLibrary } from "./ScenarioLibrary.js";
import { SessionOutbox } from "./session-outbox.js";
import { VoiceControls } from "./VoiceControls.js";
import { TruthLensTimeline, CounterfactualPanel } from "./TruthLens.js";
import { ForgeAuthoring } from "./ForgeAuthoring.js";
import { ForgeWorldAuthoring } from "./ForgeWorldAuthoring.js";
import { ForgeRecovery } from "./forge-recovery.js";
import { ExercisePlayground, WorldViewport } from "./WorldPlayground.js";
import { nextScenarioId, scenarioReferences } from "../../src/domain/authoring.js";
import type { CommunicationChannel, ScenarioDefinition, ScenarioEvent, ScenarioObject, ScenarioObjectType } from "../../src/domain/scenario.js";

const API_BASE = import.meta.env.VITE_API_URL || window.location.origin;
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN ?? "local-sentinel-admin";
const SESSION_BOOTSTRAP_KEY = "sentinel.session.bootstrap";

const ROLE_OPTIONS = [
  { id: "commander", label: "Commander", description: "Owns the primary decision and intent." },
  { id: "operations", label: "Operations / Intelligence", description: "Tracks observations, freshness, and conflicts." },
  { id: "communications-ew", label: "Communications / EW", description: "Monitors channels and fallback coordination." }
];

const FAULT_OPTIONS = [
  { id: "delay", label: "Delay reports" },
  { id: "dropout", label: "Drop reports" },
  { id: "conflict", label: "Create conflicting reports" },
  { id: "stale", label: "Mark reports stale" },
  { id: "partial", label: "Make reports partial" },
  { id: "outage", label: "Disable channel" }
] as const;

type Mode = "launcher" | "instructor" | "trainee" | "forge";
type ConnectionState = "connecting" | "connected" | "disconnected";

interface SessionBootstrap {
  sessionId: string;
  accessToken: string;
  roomCode?: string;
  mode: "instructor" | "trainee";
}

export function App() {
  const [storedBootstrap] = useState(readStoredBootstrap);
  const [mode, setMode] = useState<Mode>(storedBootstrap?.mode ?? "launcher");
  const [bootstrap, setBootstrap] = useState<SessionBootstrap | null>(storedBootstrap);
  const [view, setView] = useState<SessionView | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const outboxRef = useRef<SessionOutbox | null>(null);
  const flushRef = useRef<(() => void) | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const emitSessionAction = useCallback((event: string, payload?: unknown) => {
    const socket = socketRef.current;
    if (event === "session:send-text" || event === "session:submit-decision") {
      try {
        outboxRef.current?.enqueue(event, (payload ?? {}) as Record<string, unknown>);
        setPendingCount(outboxRef.current?.count ?? 0);
        flushRef.current?.();
      } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Unable to queue action."); }
      return;
    }
    if (socket?.connected) socket.emit(event, payload);
    else setError("Reconnect before using exercise controls.");
  }, []);

  const connectToSession = useCallback((nextBootstrap: SessionBootstrap) => {
    setBootstrap(nextBootstrap);
    sessionStorage.setItem(SESSION_BOOTSTRAP_KEY, JSON.stringify(nextBootstrap));
    setMode(nextBootstrap.mode);
    setView(null);
    setError(null);
    setConnection("connecting");

  }, []);

  useEffect(() => {
    if (!bootstrap) return;
    const outbox = new SessionOutbox(bootstrap.sessionId, sessionStorage);
    outboxRef.current = outbox;
    setPendingCount(outbox.count);
    let stateReady = false;
    let sessionStatus: SessionView["session"]["status"] = "waiting";
    const socket = io(API_BASE, {
      // Prefer WebSocket on the public one-origin deployment, but retain
      // polling so restrictive judge networks can still join and reconnect.
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      auth: {
        sessionId: bootstrap.sessionId,
        accessToken: bootstrap.accessToken
      }
    });
    socketRef.current = socket;
    const flush = () => {
      void outbox.flush((action) => new Promise<SessionActionResult>((resolve, reject) => {
        socket.timeout(5000).emit("session:action", action, (ackError: Error | null, result: SessionActionResult) => {
          if (ackError) reject(ackError); else resolve(result);
        });
      }), () => socket.connected && stateReady && (sessionStatus === "running" || sessionStatus === "ended"), (result) => {
        setPendingCount(outbox.count);
        if (result.status === "rejected") setError(result.message ?? "Queued action rejected by the server.");
      });
    };
    flushRef.current = flush;
    const retry = window.setInterval(flush, 2000);
    socket.on("connect", () => {
      setConnection("connected");
      stateReady = false;
      socket.emit("session:request-state");
    });
    socket.on("disconnect", () => { stateReady = false; setConnection("disconnected"); });
    socket.on("connect_error", (socketError) => {
      setConnection("disconnected");
      setError(socketError.message);
    });
    socket.on("session:state", (nextView: SessionView) => {
      setView(nextView);
      stateReady = true;
      sessionStatus = nextView.session.status;
      flush();
    });
    socket.on("session:error", (payload: { message?: string }) => {
      setError(payload.message ?? "The server rejected that action.");
    });
    return () => {
      window.clearInterval(retry);
      socket.removeAllListeners();
      socket.disconnect();
      flushRef.current = null;
    };
  }, [bootstrap]);

  const leaveSession = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    outboxRef.current?.clear();
    sessionStorage.removeItem(SESSION_BOOTSTRAP_KEY);
    setBootstrap(null);
    setView(null);
    setMode("launcher");
    setConnection("disconnected");
    setError(null);
  }, []);

  if (mode === "forge") {
    return <ForgeConsole onExit={() => setMode("launcher")} />;
  }

  if (mode === "launcher" || !bootstrap) {
    return <Launcher onConnect={connectToSession} onOpenForge={() => setMode("forge")} error={error} />;
  }

  if (!view) {
    return (
      <LoadingScreen
        title={mode === "instructor" ? "Opening instructor console" : "Joining exercise"}
        connection={connection}
        error={error}
        onLeave={leaveSession}
      />
    );
  }

  return (
    <div className="app-shell">
      <Header view={view} mode={mode} connection={connection} onLeave={leaveSession} />
      {error && <div className="toast error-toast">{error}</div>}
      {pendingCount > 0 && <div className="outbox-status" role="status">{pendingCount} action(s) awaiting server acknowledgement{connection !== "connected" ? " · reconnecting" : ""}</div>}
      {mode === "instructor" ? (
        <InstructorConsole view={view} emit={emitSessionAction} accessToken={bootstrap.accessToken} socket={socketRef.current} connected={connection === "connected"} />
      ) : (
        <TraineeConsole view={view} emit={emitSessionAction} socket={socketRef.current} connected={connection === "connected"} />
      )}
    </div>
  );
}

function Launcher({ onConnect, onOpenForge, error }: { onConnect: (bootstrap: SessionBootstrap) => void; onOpenForge: () => void; error: string | null }) {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [scenarioId, setScenarioId] = useState("operation-signal-break");
  const [instructorName, setInstructorName] = useState("Range Instructor");
  const [traineeName, setTraineeName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [roleId, setRoleId] = useState("commander");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(error);

  useEffect(() => {
    void fetch(`${API_BASE}/api/scenarios`)
      .then(async (response) => {
        if (!response.ok) throw new Error("SENTINEL server is unavailable.");
        return response.json() as Promise<{ scenarios: ScenarioSummary[] }>;
      })
      .then((payload) => {
        setScenarios(payload.scenarios);
        setScenarioId((current) => payload.scenarios.some((item) => item.id === current) ? current : payload.scenarios[0]?.id ?? "");
      })
      .catch((requestError: Error) => setLocalError(requestError.message));
  }, []);

  useEffect(() => setLocalError(error), [error]);

  const selectedScenario = scenarios.find((scenario) => scenario.id === scenarioId);

  async function createExercise() {
    setBusy(true);
    setLocalError(null);
    try {
      const response = await fetch(`${API_BASE}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioId, instructorName })
      });
      const payload = await readJson<{ session: { id: string; roomCode: string }; accessToken: string }>(response);
      onConnect({
        sessionId: payload.session.id,
        accessToken: payload.accessToken,
        roomCode: payload.session.roomCode,
        mode: "instructor"
      });
    } catch (requestError) {
      setLocalError(requestError instanceof Error ? requestError.message : "Unable to create exercise.");
    } finally {
      setBusy(false);
    }
  }

  async function joinExercise() {
    setBusy(true);
    setLocalError(null);
    try {
      const response = await fetch(`${API_BASE}/api/sessions/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomCode, displayName: traineeName, roleId })
      });
      const payload = await readJson<{ session: { id: string; roomCode: string }; accessToken: string }>(response);
      onConnect({
        sessionId: payload.session.id,
        accessToken: payload.accessToken,
        roomCode: payload.session.roomCode,
        mode: "trainee"
      });
    } catch (requestError) {
      setLocalError(requestError instanceof Error ? requestError.message : "Unable to join exercise.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="launcher-page">
      <section className="hero-panel">
        <div className="brand-lockup"><span className="brand-mark">S</span><span>SENTINEL</span></div>
        <p className="eyebrow">DEGRADED COMMUNICATION DECISION TRAINER</p>
        <h1>Command clearly when the picture is incomplete.</h1>
        <p className="hero-copy">
          A synthetic multiplayer exercise for teams that must act on delayed, dropped, stale, and contradictory information.
        </p>
        <div className="hero-pills">
          <span>Role-scoped information</span>
          <span>Live instructor control</span>
          <span>Evidence-based AAR</span>
        </div>
        <button className="button button-ghost forge-entry" onClick={onOpenForge}>Open SENTINEL Forge</button>
      </section>

      <section className="launch-grid">
        <article className="launch-card primary-card">
          <div className="card-kicker">INSTRUCTOR</div>
          <h2>Open a new exercise</h2>
          <p>Set up a room, assign roles, inject disruptions, and watch the team’s information picture diverge.</p>
          <label>Instructor name<input value={instructorName} onChange={(event) => setInstructorName(event.target.value)} /></label>
          <label>Scenario<select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>
            {scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.title} · v{scenario.version}</option>)}
          </select></label>
          {selectedScenario && <div className="scenario-preview"><strong>{selectedScenario.category.toUpperCase()}</strong><span>{selectedScenario.description}</span></div>}
          <button className="button button-primary" disabled={busy || !selectedScenario} onClick={() => void createExercise()}>{busy ? "Preparing room…" : "Create exercise room"}</button>
        </article>

        <article className="launch-card">
          <div className="card-kicker">TRAINEE</div>
          <h2>Join a team exercise</h2>
          <p>Enter the room code from your instructor and take a role in the live exercise.</p>
          <label>Display name<input placeholder="Your name" value={traineeName} onChange={(event) => setTraineeName(event.target.value)} /></label>
          <label>Room code<input className="room-code-input" placeholder="ABC123" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} /></label>
          <label>Training role<select value={roleId} onChange={(event) => setRoleId(event.target.value)}>
            {ROLE_OPTIONS.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}
          </select></label>
          <div className="role-note">{ROLE_OPTIONS.find((role) => role.id === roleId)?.description}</div>
          <button className="button button-secondary" disabled={busy} onClick={() => void joinExercise()}>{busy ? "Joining…" : "Join exercise"}</button>
        </article>
      </section>
      {localError && <div className="toast error-toast launcher-error">{localError}</div>}
      <footer className="footer-note">SENTINEL / SYNTHETIC TRAINING ENVIRONMENT / WEB RELEASE 0.1</footer>
    </main>
  );
}

interface ForgeValidation {
  valid: boolean;
  errors: Array<{ code: string; path: string; message: string }>;
  warnings: Array<{ code: string; path: string; message: string }>;
}

const FORGE_OBJECT_TYPES: ScenarioObjectType[] = ["location", "zone", "route", "checkpoint", "hazard", "team", "unit", "sensor", "observation-point", "resource", "command-post", "relay-node"];

function ForgeConsole({ onExit }: { onExit: () => void }) {
  const [library, setLibrary] = useState<ScenarioSummary[]>([]);
  const [scenario, setScenario] = useState<ScenarioDefinition | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [validation, setValidation] = useState<ForgeValidation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [presetId, setPresetId] = useState("operation-signal-break");
  const [focusPath, setFocusPath] = useState<string | undefined>();
  const [recovery, setRecovery] = useState<{ scenario: ScenarioDefinition; savedAt: string } | undefined>();
  const [recoveryNotice, setRecoveryNotice] = useState<string | undefined>();
  const recoveryStore = useMemo(() => new ForgeRecovery(localStorage), []);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [generationPrompt, setGenerationPrompt] = useState("Create a synthetic communications failure exercise with a delayed infrastructure report and a verification decision.");
  const archived = Boolean(library.find((item) => item.id === scenario?.id)?.library?.archived);

  const loadLibrary = useCallback(async () => {
    const response = await fetch(`${API_BASE}/api/forge/scenarios`, { headers: { "x-admin-token": ADMIN_TOKEN } });
    const payload = await readJson<{ scenarios: ScenarioSummary[] }>(response);
    setLibrary(payload.scenarios);
    return payload.scenarios;
  }, []);

  const openScenario = useCallback(async (scenarioId: string) => {
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/forge/scenarios/${scenarioId}`, { headers: { "x-admin-token": ADMIN_TOKEN } });
      const payload = await readJson<ScenarioDefinition>(response);
      setScenario(payload);
      const recovered = recoveryStore.read(scenarioId);
      if (payload.status === "published") { recoveryStore.clear(scenarioId); setRecovery(undefined); }
      else setRecovery(recovered && JSON.stringify(recovered.scenario) !== JSON.stringify(payload) ? recovered : undefined);
      setSelectedObjectId(payload.environment.objects[0]?.id ?? null);
      setValidation(null);
      setDirty(false);
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to open scenario.");
    } finally {
      setBusy(false);
    }
  }, [recoveryStore]);

  useEffect(() => {
    void loadLibrary().then((items) => {
      const first = items.find((item) => item.id === recoveryStore.lastId && item.status === "draft") ?? items.find((item) => item.status === "draft") ?? items[0];
      if (first) void openScenario(first.id);
    }).catch((error: Error) => {
      setNotice(error.message);
      setBusy(false);
    });
  }, [loadLibrary, openScenario]);

  useEffect(() => {
    if (!scenario || !dirty) return;
    try { recoveryStore.save(scenario); setRecoveryNotice("Unsaved draft backed up in this browser."); }
    catch { setRecoveryNotice("Browser recovery storage is full or unavailable. Save the draft to the server."); }
  }, [scenario, dirty, recoveryStore]);

  useEffect(() => {
    const onUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  async function createDraft(baseScenarioId = presetId) {
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/forge/scenarios`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN_TOKEN }, body: JSON.stringify({ baseScenarioId }) });
      const created = await readJson<ScenarioDefinition>(response);
      setScenario(created);
      setRecovery(undefined); setRecoveryNotice(undefined);
      setSelectedObjectId(created.environment.objects[0]?.id ?? null);
      setValidation(null);
      setDirty(false);
      await loadLibrary();
      setNotice("Draft created. Edit it, validate it, then publish a version.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to create draft.");
    } finally {
      setBusy(false);
    }
  }

  async function persistDraft() {
    if (archived) throw new Error("Restore this scenario from the archive first.");
    if (!scenario || scenario.status === "published") throw new Error("Select an editable draft first.");
    const response = await fetch(`${API_BASE}/api/forge/scenarios/${scenario.id}`, { method: "PUT", headers: { "content-type": "application/json", "x-admin-token": ADMIN_TOKEN }, body: JSON.stringify(scenario) });
    const saved = await readJson<ScenarioDefinition>(response);
    recoveryStore.clear(saved.id);
    setRecovery(undefined); setRecoveryNotice(undefined);
    setScenario(saved);
    setDirty(false);
    await loadLibrary();
    return saved;
  }

  async function saveScenario() {
    setBusy(true);
    try {
      await persistDraft();
      setNotice("Draft saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save draft.");
    } finally {
      setBusy(false);
    }
  }

  async function validateScenario() {
    if (!scenario) return;
    setBusy(true);
    try {
      await persistDraft();
      const response = await fetch(`${API_BASE}/api/forge/scenarios/${scenario.id}/validate`, { method: "POST", headers: { "x-admin-token": ADMIN_TOKEN } });
      const result = await readJson<ForgeValidation>(response);
      setValidation(result);
      setNotice(result.valid ? "Scenario is valid and ready to publish." : "Validation found issues to resolve.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to validate scenario.");
    } finally {
      setBusy(false);
    }
  }

  async function publishScenario() {
    if (!scenario) return;
    setBusy(true);
    try {
      await persistDraft();
      const response = await fetch(`${API_BASE}/api/forge/scenarios/${scenario.id}/publish`, { method: "POST", headers: { "x-admin-token": ADMIN_TOKEN } });
      const published = await readJson<ScenarioDefinition>(response);
      setScenario(published);
      await loadLibrary();
      setValidation({ valid: true, errors: [], warnings: [] });
      setNotice("Published. This scenario can now be selected for a live exercise.");
    } catch (error) {
      const typed = error as Error & { validation?: ForgeValidation };
      setValidation(typed.validation ?? validation);
      setNotice(typed.message || "Unable to publish scenario.");
    } finally {
      setBusy(false);
    }
  }

  function exportScenario() {
    if (!scenario) return;
    const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${scenario.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Scenario JSON exported.");
  }

  async function importScenario(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const imported = JSON.parse(await file.text()) as ScenarioDefinition;
      const response = await fetch(`${API_BASE}/api/forge/scenarios/import`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": ADMIN_TOKEN },
        body: JSON.stringify(imported)
      });
      const created = await readJson<ScenarioDefinition>(response);
      setScenario(created);
      setSelectedObjectId(created.environment.objects[0]?.id ?? null);
      setValidation(null);
      setDirty(false);
      await loadLibrary();
      setNotice("Scenario imported as a draft.");
    } catch (error) {
      const typed = error as Error & { validation?: ForgeValidation };
      setValidation(typed.validation ?? null);
      setNotice(typed.message || "Unable to import scenario JSON.");
    } finally {
      setBusy(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function generateScenario() {
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/forge/scenarios/generate`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": ADMIN_TOKEN },
        body: JSON.stringify({ prompt: generationPrompt, baseScenarioId: scenario?.id ?? "operation-signal-break" })
      });
      const result = await readJson<{ scenario: ScenarioDefinition; source: string; warning?: string }>(response);
      setScenario(result.scenario);
      setSelectedObjectId(result.scenario.environment.objects[0]?.id ?? null);
      setValidation(null);
      setDirty(false);
      await loadLibrary();
      setNotice(result.warning ?? `Scenario generated with ${result.source}. Review, validate, and publish it.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to generate scenario.");
    } finally {
      setBusy(false);
    }
  }

  function editScenario(update: (current: ScenarioDefinition) => ScenarioDefinition) {
    if (busy || archived || scenario?.status === "published") return;
    setScenario((current) => current ? { ...update(current), status: "draft" } : current);
    setValidation(null);
    setDirty(true);
  }

  function updateMetadata<K extends keyof ScenarioDefinition["metadata"]>(key: K, value: ScenarioDefinition["metadata"][K]) {
    editScenario((current) => ({ ...current, metadata: { ...current.metadata, [key]: value } }));
  }

  function addObject() {
    editScenario((current) => {
      const id = nextScenarioId(current, "custom-object");
      const object: ScenarioObject = {
        id,
        type: "location",
        name: "New Location",
        transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } },
        properties: { status: "unknown" },
        physics: { body: "fixed", collider: "box", trigger: false }
      };
      return {
        ...current,
        environment: { ...current.environment, objects: [...current.environment.objects, object] },
        roles: current.roles.map((role) => ({ ...role, visibility: { ...role.visibility, objectIds: [...role.visibility.objectIds, id] } }))
      };
    });
    setSelectedObjectId(null);
  }

  function updateObject(objectId: string, patch: Partial<ScenarioObject>) {
    editScenario((current) => ({ ...current, environment: { ...current.environment, objects: current.environment.objects.map((object) => object.id === objectId ? { ...object, ...patch } : object) } }));
  }

  function updateObjectPosition(objectId: string, axis: "x" | "z", value: number) {
    editScenario((current) => ({ ...current, environment: { ...current.environment, objects: current.environment.objects.map((object) => object.id === objectId ? { ...object, transform: { ...object.transform, position: { ...object.transform.position, [axis]: value } } } : object) } }));
  }

  function removeObject(objectId: string) {
    if (!scenario) return;
    const references = scenarioReferences({ ...scenario, roles: [] }, objectId);
    if (references.length) { setNotice(`Object is referenced by ${references.join(", ")}. Change those references first.`); return; }
    editScenario((current) => ({ ...current, environment: { ...current.environment, objects: current.environment.objects.filter((object) => object.id !== objectId) }, roles: current.roles.map((role) => ({ ...role, visibility: { ...role.visibility, objectIds: role.visibility.objectIds.filter((id) => id !== objectId) } })) }));
    setSelectedObjectId(null);
  }

  function addChannel() {
    editScenario((current) => {
      const id = nextScenarioId(current, "channel");
      const channel: CommunicationChannel = { id, name: "New Channel", kind: "team", participants: current.roles.map((role) => role.id), baseLatencyMs: 500, reliability: 0.9, status: "active" };
      return { ...current, channels: [...current.channels, channel] };
    });
  }

  function removeChannel(channelId: string) {
    if (!scenario) return;
    const references = scenarioReferences(scenario, channelId);
    if (references.length) { setNotice(`Channel is referenced by ${references.join(", ")}. Change those references first.`); return; }
    editScenario((current) => ({ ...current, channels: current.channels.filter((channel) => channel.id !== channelId) }));
  }

  function addFaultEvent() {
    editScenario((current) => {
      const channel = current.channels[0];
      if (!channel) return current;
      const event: ScenarioEvent = { id: nextScenarioId(current, "event-custom"), type: "channel-fault", atSeconds: Math.max(0, Math.min(360, current.metadata.durationSeconds - 1)), channelId: channel.id, fault: "delay", delayMs: 15000, durationSeconds: 45 };
      return { ...current, events: [...current.events, event] };
    });
  }

  function removeEvent(eventId: string) {
    if (scenario?.events.find((event) => event.id === eventId)?.type === "decision-gate") { setNotice("Edit decision timing or delete the gate in the Decisions section."); return; }
    editScenario((current) => ({ ...current, events: current.events.filter((event) => event.id !== eventId) }));
  }

  const selectedObject = scenario?.environment.objects.find((object) => object.id === selectedObjectId);

  async function libraryAction(action: "versions" | "archive", archive?: boolean) {
    if (!scenario) return;
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/forge/scenarios/${scenario.id}/${action}`, {
        method: action === "archive" ? "PUT" : "POST",
        headers: { "content-type": "application/json", "x-admin-token": ADMIN_TOKEN },
        body: JSON.stringify(action === "archive" ? { archived: archive } : {})
      });
      const result = await readJson<{ id: string }>(response);
      await loadLibrary();
      await openScenario(result.id);
      setNotice(action === "versions" ? "New version created. Earlier published versions and exercise records are preserved." : archive ? "Archived. Existing exercises remain available." : "Scenario restored to the library.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Library update failed."); }
    finally { setBusy(false); }
  }

  return (
    <main className="workspace forge-workspace">
      <section className="workspace-heading forge-heading"><div><p className="eyebrow">SENTINEL FORGE / SCENARIO AUTHORING</p><h1>Build the exercise the team will face.</h1><p className="heading-copy">Configure a synthetic playground, communication conditions, and event timeline without changing source code.</p></div><button className="button button-ghost" onClick={onExit}>Return to launcher</button></section>
       <div className="forge-toolbar"><div className="forge-toolbar-left"><button className="button button-primary" disabled={busy} onClick={() => void createDraft()}>New draft</button><button className="button button-ghost" disabled={busy || !scenario} onClick={() => scenario && void createDraft(scenario.id)}>Duplicate selected</button><button className="button button-ghost" disabled={busy} onClick={() => importInputRef.current?.click()}>Import JSON</button><input className="forge-ai-input" value={generationPrompt} onChange={(event) => setGenerationPrompt(event.target.value)} aria-label="AI scenario prompt" /><button className="button button-secondary" disabled={busy || !generationPrompt.trim()} onClick={() => void generateScenario()}>Generate draft</button><input ref={importInputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void importScenario(event.target.files?.[0])} /></div><div className="forge-toolbar-right"><button className="button button-ghost" disabled={busy || !scenario} onClick={exportScenario}>Export JSON</button><button className="button button-ghost" disabled={busy || !scenario || scenario.status === "published"} onClick={() => void saveScenario()}>Save draft</button><button className="button button-secondary" disabled={busy || !scenario || scenario.status === "published"} onClick={() => void validateScenario()}>Validate</button><button className="button button-primary" disabled={busy || !scenario || scenario.status === "published"} onClick={() => void publishScenario()}>Publish scenario</button></div></div>
      {notice && <div className="forge-notice">{notice}</div>}
      {recovery && <div className="forge-notice" role="status"><p>Unsaved edits recovered from {new Date(recovery.savedAt).toLocaleString()}. Review them before saving over the server draft.</p><button className="button button-primary" onClick={() => { setScenario(recovery.scenario); setDirty(true); setValidation(null); setRecovery(undefined); }}>Restore recovered edits</button> <button className="button button-ghost" onClick={() => { recoveryStore.clear(recovery.scenario.id); setRecovery(undefined); }}>Discard recovery</button></div>}
      {recoveryNotice && <p className="panel-copy" role="status">{recoveryNotice}</p>}
      {validation && <div className={`validation-banner ${validation.valid ? "valid" : "invalid"}`}><strong>{validation.valid ? "VALIDATION PASSED" : `${validation.errors.length} VALIDATION ERROR(S)`}</strong>{validation.errors.length > 0 && <ul className="validation-issues">{validation.errors.map((item) => <li key={`${item.path}-${item.code}`}><button className="validation-link" onClick={() => { setFocusPath(undefined); requestAnimationFrame(() => setFocusPath(item.path)); }}><code>{item.path}</code></button><span>{item.message}</span></li>)}</ul>}{validation.warnings.length > 0 && <span className="validation-warning">{validation.warnings.length} warning(s)</span>}</div>}
      <div className="forge-preset-row"><label>New draft preset<select value={presetId} disabled={busy} onChange={(event) => setPresetId(event.target.value)}><option value="operation-signal-break">Military / Operation Signal Break</option><option value="flood-response">Disaster / Flood Response</option><option value="custom-blackout">Custom / Blackout Protocol</option></select></label><span role="status">{dirty ? "Unsaved changes. Validate and Publish save your current edits." : scenario?.status === "published" ? "Published version / duplicate to edit" : "All changes saved"}</span></div>
      <fieldset className="forge-frame" disabled={busy}><div className="forge-layout">
        <ScenarioLibrary items={library} {...(scenario ? { selectedId: scenario.id } : {})} onOpen={(id) => void openScenario(id)} onVersion={() => void libraryAction("versions")} onArchive={(value) => void libraryAction("archive", value)} dirty={dirty} />
        {scenario ? <fieldset className="forge-editor" disabled={archived}>
          <div className="forge-editor-header"><div><p className="eyebrow">{archived ? "ARCHIVED / " : ""}{scenario.status.toUpperCase()} / VERSION {scenario.version}</p><h2>{scenario.metadata.title}</h2></div><span className="schema-chip">SCHEMA {scenario.schemaVersion}</span></div>
          <label className="library-tags">Tags (comma-separated)<input value={scenario.metadata.tags.join(", ")} disabled={scenario.status === "published"} onChange={(event) => updateMetadata("tags", event.target.value.split(",").map((tag) => tag.trim()))} onBlur={() => updateMetadata("tags", [...new Set(scenario.metadata.tags.filter(Boolean))])} /></label>
          <div className="forge-editor-grid">
            <section className="panel forge-meta"><PanelTitle eyebrow="SCENARIO BRIEF" title="Metadata" /><div className="forge-form"><label>Title<input value={scenario.metadata.title} onChange={(event) => updateMetadata("title", event.target.value)} disabled={scenario.status === "published"} /></label><label>Category<select value={scenario.metadata.category} onChange={(event) => updateMetadata("category", event.target.value as ScenarioDefinition["metadata"]["category"])} disabled={scenario.status === "published"}><option value="military">Military</option><option value="disaster">Disaster response</option><option value="synthetic">Synthetic</option></select></label><label>Duration (seconds)<input type="number" value={scenario.metadata.durationSeconds} onChange={(event) => updateMetadata("durationSeconds", Number(event.target.value))} disabled={scenario.status === "published"} /></label><label>Description<textarea rows={3} value={scenario.metadata.description} onChange={(event) => updateMetadata("description", event.target.value)} disabled={scenario.status === "published"} /></label></div></section>
             <section className="panel forge-canvas-panel"><PanelTitle eyebrow="PLAYGROUND / 3D PREVIEW" title="Environment" />
              <WorldViewport key={scenario.id} environment={scenario.environment} selectedId={selectedObjectId} onSelect={setSelectedObjectId} onMoveTo={(position) => { if (selectedObject && scenario.status !== "published" && !busy) updateObject(selectedObject.id, { transform: { ...selectedObject.transform, position: { ...selectedObject.transform.position, x: position.x, z: position.z } } }); }} />
              <div className="forge-canvas-actions"><button className="button button-ghost" disabled={scenario.status === "published"} onClick={addObject}>+ Add object</button><span>{scenario.status === "published" ? "Published preview / duplicate to edit" : "Select an object to inspect · Shift-click ground to place it"}</span></div>
               <div className="forge-form"><label>Preview object<select value={selectedObjectId ?? ""} onChange={(event) => setSelectedObjectId(event.target.value)}><option value="">Select an object</option>{scenario.environment.objects.map((object) => <option value={object.id} key={object.id}>{object.name}</option>)}</select></label></div>
             </section>
             <ScenarioPreview scenario={scenario} />
            <section className="panel forge-inspector"><PanelTitle eyebrow="OBJECT INSPECTOR" title={selectedObject?.name ?? "Select an object"} />{selectedObject ? <div className="forge-form"><label>Name<input value={selectedObject.name} onChange={(event) => updateObject(selectedObject.id, { name: event.target.value })} disabled={scenario.status === "published"} /></label><label>Type<select value={selectedObject.type} onChange={(event) => updateObject(selectedObject.id, { type: event.target.value as ScenarioObjectType })} disabled={scenario.status === "published"}>{FORGE_OBJECT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><div className="axis-grid"><label>X<input type="number" value={selectedObject.transform.position.x} onChange={(event) => updateObjectPosition(selectedObject.id, "x", Number(event.target.value))} disabled={scenario.status === "published"} /></label><label>Z<input type="number" value={selectedObject.transform.position.z} onChange={(event) => updateObjectPosition(selectedObject.id, "z", Number(event.target.value))} disabled={scenario.status === "published"} /></label></div><button className="button button-ghost danger-button" disabled={scenario.status === "published"} onClick={() => removeObject(selectedObject.id)}>Delete object</button></div> : <EmptyState text="Select an object on the playground." />}</section>
            <section className="panel forge-communications"><PanelTitle eyebrow="COMMUNICATION FABRIC" title={`${scenario.channels.length} channels`} /><div className="forge-list">{scenario.channels.map((channel) => <div className="forge-list-row" key={channel.id}><div><strong>{channel.name}</strong><span>{channel.kind} · {channel.baseLatencyMs} ms · {Math.round(channel.reliability * 100)}% reliable</span></div><button className="icon-button" disabled={scenario.status === "published"} onClick={() => removeChannel(channel.id)}>×</button></div>)}</div><button className="button button-ghost compact-button" disabled={scenario.status === "published"} onClick={addChannel}>+ Add communication channel</button></section>
            <section className="panel forge-events"><PanelTitle eyebrow="EVENT TIMELINE" title={`${scenario.events.length} scheduled events`} /><div className="forge-list">{[...scenario.events].sort((a, b) => a.atSeconds - b.atSeconds).map((event) => <div className="forge-list-row" key={event.id}><div><strong>{formatTime(event.atSeconds)} · {event.type.replaceAll("-", " ")}</strong><span>{event.type === "channel-fault" ? `${event.channelId} / ${event.fault}` : event.type === "message" ? event.reportId : event.type}</span></div><button className="icon-button" disabled={scenario.status === "published" || event.type === "scenario-end"} onClick={() => removeEvent(event.id)}>×</button></div>)}</div><button className="button button-ghost compact-button" disabled={scenario.status === "published" || scenario.channels.length === 0} onClick={addFaultEvent}>+ Add delay event</button></section>
          </div>
        </fieldset> : <section className="panel forge-empty"><span className="large-mark brand-mark">S</span><h2>Select a scenario to begin.</h2><p>Choose a draft from the library or create one from the military preset.</p></section>}
      </div>
       {scenario && <ForgeWorldAuthoring key={`world-${scenario.id}`} scenario={scenario} onChange={editScenario} busy={busy || archived} focusPath={focusPath} />}
       {scenario && <ForgeAuthoring key={scenario.id} scenario={scenario} onChange={editScenario} busy={busy || archived} focusPath={focusPath} />}
      </fieldset>
    </main>
  );
}

function ScenarioPreview({ scenario }: { scenario: ScenarioDefinition }) {
  const [time, setTime] = useState(0);
  const reports = scenario.reports.filter((report) => report.generatedAtSeconds <= time);
  const events = scenario.events.filter((event) => event.atSeconds <= time).sort((a, b) => a.atSeconds - b.atSeconds);
  const activeDecisions = scenario.decisions.filter((decision) => decision.activation.type === "time" && decision.activation.atSeconds !== undefined && decision.activation.atSeconds <= time);
  return <section className="panel scenario-preview-panel">
    <PanelTitle eyebrow="SCENARIO PREVIEW / READ ONLY" title="Walk the authored exercise" />
    <p className="panel-copy">Preview follows authored timing and role access. It does not create a room or execute live rules.</p>
    <label>Preview time <strong>{formatTime(time)}</strong><input aria-label="Scenario preview time" type="range" min="0" max={scenario.metadata.durationSeconds} step="1" value={time} onChange={(event) => setTime(Number(event.target.value))} /></label>
    <div className="preview-summary"><span><strong>{events.length}</strong> events reached</span><span><strong>{reports.length}</strong> reports generated</span><span><strong>{activeDecisions.length}</strong> decision gates active</span></div>
    <div className="preview-columns"><div><p className="eyebrow">TIMELINE</p>{events.length === 0 ? <p className="panel-copy">Move the timeline forward to inspect the briefing and disruptions.</p> : <ol>{events.map((event) => <li key={event.id}><strong>{formatTime(event.atSeconds)}</strong> {event.type.replaceAll("-", " ")}{event.type === "message" && "reportId" in event ? ` / ${event.reportId}` : ""}</li>)}</ol>}</div><div><p className="eyebrow">ROLE-SCOPED REPORTS</p>{scenario.roles.map((role) => <div className="preview-role" key={role.id}><strong>{role.name}</strong><span>{reports.filter((report) => role.visibility.reportIds.includes(report.id)).map((report) => report.id).join(" · ") || "No permitted reports yet"}</span></div>)}</div></div>
  </section>;
}

function Header({ view, mode, connection, onLeave }: { view: SessionView; mode: Exclude<Mode, "launcher">; connection: ConnectionState; onLeave: () => void }) {
  const statusClass = view.session.status === "running" ? "live" : view.session.status === "ended" ? "ended" : "paused";
  return (
    <header className="topbar">
      <div className="brand-lockup"><span className="brand-mark">S</span><span>SENTINEL</span></div>
      <div className="topbar-context"><span className="context-title">{view.session.scenario.title}</span><span className="context-divider">/</span><span>{mode === "instructor" ? "Instructor Control" : view.participant.roleId ?? "Role pending"}</span></div>
      <div className="topbar-actions"><span className={`connection-state ${connection}`}>{connection === "connected" ? "● LINKED" : connection === "connecting" ? "◌ CONNECTING" : "○ OFFLINE"}</span><span className={`exercise-status ${statusClass}`}>{view.session.status.toUpperCase()}</span><button className="button button-ghost" onClick={onLeave}>Leave</button></div>
    </header>
  );
}

function InstructorConsole({ view, emit, accessToken, socket, connected }: { view: SessionView; emit: (event: string, payload?: unknown) => void; accessToken: string; socket: Socket | null; connected: boolean }) {
  const [fault, setFault] = useState<(typeof FAULT_OPTIONS)[number]["id"]>("delay");
  const [channelId, setChannelId] = useState(view.scenario.channels[0]?.id ?? "");
  const [delayMs, setDelayMs] = useState("45000");
  const [durationSeconds, setDurationSeconds] = useState("60");
  const [seconds, setSeconds] = useState("30");
  const [aar, setAar] = useState<SessionAar | null>(null);
  const [aarBusy, setAarBusy] = useState(false);
  const [aarError, setAarError] = useState<string | null>(null);

  const trainees = view.session.participants.filter((participant) => participant.kind === "trainee");
  const recentEvents = [...view.events].slice(-14).reverse();
  const activeFaultCount = view.groundTruth?.activeChannelFaults.length ?? 0;
  const objectStates = Object.entries(view.groundTruth?.objectStates ?? {});

  async function loadAar() {
    setAarBusy(true);
    setAarError(null);
    try {
      const response = await fetch(`${API_BASE}/api/sessions/${view.session.id}/aar`, { headers: { "x-access-token": accessToken } });
      setAar(await readJson<SessionAar>(response));
    } catch (error) {
      setAarError(error instanceof Error ? error.message : "Unable to load the AAR.");
    } finally {
      setAarBusy(false);
    }
  }

  function exportAar() {
    if (!aar) return;
    const blob = new Blob([JSON.stringify(aar, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${aar.sessionId}-aar.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="workspace instructor-workspace">
      <section className="workspace-heading">
        <div><p className="eyebrow">LIVE EXERCISE / CONTROL CENTER</p><h1>Run the exercise. Watch the information picture.</h1></div>
        <div className="heading-actions"><VoiceControls view={view} socket={socket} /><div className="room-badge"><span>ROOM</span><strong>{view.session.roomCode}</strong></div></div>
      </section>
      <div className="metric-row">
        <Metric label="Simulation time" value={formatTime(view.session.simulationTimeSeconds)} detail={`of ${formatTime(view.session.scenario.durationSeconds)}`} />
        <Metric label="Trainees" value={`${trainees.filter((participant) => participant.connected).length}/${trainees.length}`} detail="linked participants" />
        <Metric label="Active faults" value={String(activeFaultCount)} detail="communication conditions" {...(activeFaultCount > 0 ? { accent: "warning" as const } : {})} />
        <Metric label="Decisions" value={String(view.decisions.length)} detail="recorded with context" />
        <Metric label="Score" value={view.score.total.toFixed(2)} detail="weighted evidence" />
      </div>
      <div className="console-grid instructor-grid">
        <ExercisePlayground view={view} connected={connected} emit={emit} />
        <section className="panel participants-panel"><PanelTitle eyebrow="TEAM STATUS" title="Participants" /><div className="participant-list">{view.session.participants.map((participant) => <ParticipantRow key={participant.id} participant={participant} view={view} emit={emit} />)}</div></section>
        <section className="panel control-panel"><PanelTitle eyebrow="EXERCISE CLOCK" title="Control" /><div className="control-actions"><button className="button button-primary" disabled={view.session.status === "running" || view.session.status === "ended"} onClick={() => emit(view.session.status === "paused" ? "session:resume" : "session:start")}>{view.session.status === "paused" ? "Resume exercise" : "Start exercise"}</button><button className="button button-secondary" disabled={view.session.status !== "running"} onClick={() => emit("session:pause")}>Pause</button><button className="button button-warning" disabled={view.session.status === "waiting" || view.session.status === "ended"} onClick={() => emit("session:end")}>End exercise</button></div><div className="advance-row"><input value={seconds} onChange={(event) => setSeconds(event.target.value)} inputMode="numeric" /><button className="button button-ghost" disabled={view.session.status !== "running"} onClick={() => emit("session:advance", { seconds: Number(seconds) || 1 })}>Advance simulation seconds</button></div><div className="clock-track"><span style={{ width: `${Math.min(100, (view.session.simulationTimeSeconds / view.session.scenario.durationSeconds) * 100)}%` }} /></div></section>
        <section className="panel fault-panel"><PanelTitle eyebrow="INSTRUCTOR INJECTION" title="Change the communication picture" /><div className="form-grid"><label>Channel<select value={channelId} onChange={(event) => setChannelId(event.target.value)}>{view.scenario.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label><label>Fault<select value={fault} onChange={(event) => setFault(event.target.value as typeof fault)}>{FAULT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><label>Delay (ms)<input value={delayMs} onChange={(event) => setDelayMs(event.target.value)} /></label><label>Duration (s)<input value={durationSeconds} onChange={(event) => setDurationSeconds(event.target.value)} /></label></div><div className="control-actions"><button className="button button-warning" disabled={view.session.status !== "running" || !channelId} onClick={() => emit("session:inject-fault", { channelId, fault, delayMs: Number(delayMs) || 0, durationSeconds: Number(durationSeconds) || 0 })}>Inject fault</button><button className="button button-ghost" disabled={!channelId} onClick={() => emit("session:restore-channel", { channelId })}>Restore channel</button></div></section>
        <section className="panel event-panel"><PanelTitle eyebrow="AUDIT STREAM" title="Ground-truth events" /><div className="event-list">{recentEvents.length === 0 ? <EmptyState text="Events will appear when the exercise starts." /> : recentEvents.map((event) => <EventRow key={event.id} event={event} />)}</div></section>
        <section className="panel ground-panel"><PanelTitle eyebrow="GROUND TRUTH" title="Active conditions" />{activeFaultCount === 0 ? <EmptyState text="No active communication faults." /> : <div className="fault-list">{view.groundTruth?.activeChannelFaults.map((activeFault) => <div className="fault-item" key={activeFault.id}><span className="status-dot warning" /><div><strong>{activeFault.channelId}</strong><span>{activeFault.fault} / started at {formatTime(activeFault.startedAtSeconds)}</span></div></div>)}</div>}<div className="state-list"><p className="eyebrow">OBJECT STATES</p>{objectStates.length === 0 ? <span className="muted-copy">No mutable object state.</span> : objectStates.slice(0, 8).map(([objectId, state]) => <div className="state-row" key={objectId}><strong>{objectId}</strong><span>{Object.entries(state).map(([key, value]) => `${key}: ${String(value)}`).join(" · ") || "static"}</span></div>)}</div></section>
        <section className="panel aar-panel"><PanelTitle eyebrow="TRUTHLENS" title="After-action review" /><p className="panel-copy">Compare decisions with the information each role had at the time.</p><div className="aar-actions"><button className="button button-primary" disabled={aarBusy} onClick={() => void loadAar()}>{aarBusy ? "Loading review…" : aar ? "Refresh AAR" : "Open AAR"}</button>{aar && <button className="button button-ghost" onClick={exportAar}>Export JSON</button>}</div>{aarError && <p className="error-copy">{aarError}</p>}{aar && <div className="aar-summary"><strong>{aar.score.total.toFixed(2)} weighted score</strong><span>{aar.events.length} events · {aar.decisions.length} decisions</span>{aar.score.dimensions.map((dimension) => <div className="score-row" key={dimension.dimensionId}><span>{dimension.name}</span><strong>{dimension.weighted.toFixed(2)}</strong></div>)}</div>}</section>
        {aar && <TruthLensTimeline aar={aar} roles={view.scenario.roles} />}
        {aar && <CounterfactualPanel aar={aar} gates={view.scenario.decisions} accessToken={accessToken} apiBase={API_BASE} />}
      </div>
    </main>
  );
}

function TraineeConsole({ view, emit, socket, connected }: { view: SessionView; emit: (event: string, payload?: unknown) => void; socket: Socket | null; connected: boolean }) {
  const reports = view.perception?.reports ?? [];
  const activeDecisionId = view.perception?.activeDecisionIds[0];
  const decision = view.scenario.decisions.find((candidate) => candidate.id === activeDecisionId);
  const [selectedOption, setSelectedOption] = useState("");
  const [rationale, setRationale] = useState("");
  const [confidence, setConfidence] = useState("0.70");
  const [message, setMessage] = useState("");
  const [messageChannel, setMessageChannel] = useState(view.scenario.channels[0]?.id ?? "");

  useEffect(() => {
    setSelectedOption(decision?.options[0]?.id ?? "");
    setRationale("");
  }, [activeDecisionId]);

  const role = view.scenario.roles.find((candidate) => candidate.id === view.participant.roleId);

  return (
    <main className="workspace trainee-workspace">
        <section className="workspace-heading"><div><p className="eyebrow">LIVE EXERCISE / TRAINEE CONSOLE</p><h1>{role?.name ?? "Role briefing"}</h1><p className="heading-copy">{role?.briefing ?? "Waiting for the instructor to assign your role."}</p></div><div className="heading-actions"><VoiceControls view={view} socket={socket} /><div className="simulation-clock"><span>SIMULATION TIME</span><strong>{formatTime(view.session.simulationTimeSeconds)}</strong></div></div></section>
      <div className="console-grid trainee-grid">
        <ExercisePlayground view={view} connected={connected} emit={emit} />
        <section className="panel channel-panel"><PanelTitle eyebrow="COMMUNICATIONS" title="Channel health" /><div className="channel-list">{view.channelHealth.map((channel) => <div className="channel-row" key={channel.channelId}><span className={`status-dot ${channel.status === "active" ? "good" : channel.status === "offline" ? "danger" : "warning"}`} /><div><strong>{channel.name}</strong><span>{channel.status} / {channel.latencyMs} ms{channel.fault ? ` / ${channel.fault}` : ""}</span></div><small>{channel.status === "active" ? "NOMINAL" : channel.status.toUpperCase()}</small></div>)}</div></section>
        <section className="panel text-panel"><PanelTitle eyebrow="TEAM COMMS" title="Send text" /><div className="text-composer"><label>Channel<select value={messageChannel} onChange={(event) => setMessageChannel(event.target.value)}>{view.scenario.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label><textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={3} maxLength={500} placeholder="Share an observation or intent with the channel." /><button className="button button-secondary" disabled={!message.trim() || !messageChannel || view.session.status !== "running"} onClick={() => { emit("session:send-text", { channelId: messageChannel, content: message }); setMessage(""); }}>Send message</button></div></section>
        <section className="panel report-panel"><PanelTitle eyebrow="INFORMATION FEED" title="Received reports" /><div className="report-list">{reports.length === 0 ? <EmptyState text="No reports received yet." /> : [...reports].reverse().map((report) => <ReportCard key={report.reportId} report={report} />)}</div></section>
        <section className={`panel decision-panel ${decision ? "decision-live" : ""}`}><PanelTitle eyebrow="DECISION GATE" title={decision?.title ?? "No decision required"} />{decision ? <><div className="decision-options">{decision.options.map((option) => <label className={`option-card ${selectedOption === option.id ? "selected" : ""}`} key={option.id}><input type="radio" name="decision-option" value={option.id} checked={selectedOption === option.id} onChange={() => setSelectedOption(option.id)} /><span>{option.label}</span></label>)}</div><label>Rationale<textarea value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="State what you know, what is uncertain, and why this action is appropriate." rows={4} /></label><label>Confidence <span className="confidence-value">{Math.round(Number(confidence) * 100)}%</span><input type="range" min="0" max="1" step="0.05" value={confidence} onChange={(event) => setConfidence(event.target.value)} /></label><button className="button button-primary full-width" disabled={!selectedOption || !rationale.trim()} onClick={() => emit("session:submit-decision", { decisionId: decision.id, optionId: selectedOption, rationale, confidence: Number(confidence) })}>Submit decision</button></> : <EmptyState text={view.session.status === "waiting" ? "The instructor has not started the exercise." : "Maintain awareness. The next decision gate will appear here."} />}</section>
        <section className="panel role-events-panel"><PanelTitle eyebrow="YOUR LOG" title="Role-visible events" /><div className="event-list">{view.events.length === 0 ? <EmptyState text="Your role events will appear here." /> : [...view.events].slice(-10).reverse().map((event) => <EventRow key={event.id} event={event} />)}</div></section>
      </div>
    </main>
  );
}

function ParticipantRow({ participant, view, emit }: { participant: SessionView["session"]["participants"][number]; view: SessionView; emit: (event: string, payload?: unknown) => void }) {
  const [roleId, setRoleId] = useState(participant.roleId ?? "");
  return <div className="participant-row"><span className={`status-dot ${participant.connected ? "good" : "muted"}`} /><div className="participant-identity"><strong>{participant.displayName}</strong><span>{participant.connected ? "Connected" : "Waiting to connect"}</span></div>{participant.kind === "trainee" ? <select aria-label={`Role for ${participant.displayName}`} disabled={view.session.status === "ended"} value={roleId} onChange={(event) => { setRoleId(event.target.value); if (event.target.value) emit("session:assign-role", { participantId: participant.id, roleId: event.target.value }); }}><option value="">Assign role</option>{ROLE_OPTIONS.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select> : <span className="role-badge">INSTRUCTOR</span>}</div>;
}

function ReportCard({ report }: { report: NonNullable<SessionView["perception"]>["reports"][number] }) {
  return <article className={`report-card report-${report.status}`}><div className="report-topline"><span className="report-domain">{report.domain.toUpperCase()}</span><span className={`report-status status-${report.status}`}>{report.status}</span></div><p>{report.content}</p><div className="report-meta"><span>Source: {report.sourceRole}</span><span>Age: {formatTime(Math.max(0, report.receivedAtSeconds - report.generatedAtSeconds))}</span><span>Received: {formatTime(report.receivedAtSeconds)}</span></div>{report.conflictsWith && <div className="conflict-callout">CONFLICTS WITH {report.conflictsWith}</div>}</article>;
}

function EventRow({ event }: { event: SessionView["events"][number] }) {
  return <div className="event-row"><span className="event-time">{formatTime(event.simulationTimeSeconds)}</span><span className="event-type">{event.type === "TEXT_MESSAGE_SENT" ? `${String(event.payload.senderRole)} / ${String(event.payload.channelId)}: ${String(event.payload.content)}` : event.type.replaceAll("_", " ")}</span><span className="event-sequence">#{event.sequence}</span></div>;
}

function PanelTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <div className="panel-title"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div></div>;
}

function Metric({ label, value, detail, accent }: { label: string; value: string; detail: string; accent?: "warning" }) {
  return <div className={`metric-card ${accent ? `metric-${accent}` : ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><span>—</span><p>{text}</p></div>;
}

function LoadingScreen({ title, connection, error, onLeave }: { title: string; connection: ConnectionState; error: string | null; onLeave: () => void }) {
  return <main className="loading-page"><div className="loading-card"><span className="brand-mark large-mark">S</span><p className="eyebrow">SENTINEL / {connection.toUpperCase()}</p><h1>{title}</h1><div className="loading-spinner" />{error && <p className="error-copy">{error}</p>}<button className="button button-ghost" onClick={onLeave}>Return to launcher</button></div></main>;
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function readStoredBootstrap(): SessionBootstrap | null {
  try {
    const raw = sessionStorage.getItem(SESSION_BOOTSTRAP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionBootstrap>;
    if (typeof parsed.sessionId !== "string" || typeof parsed.accessToken !== "string" || (parsed.mode !== "instructor" && parsed.mode !== "trainee")) return null;
    return { sessionId: parsed.sessionId, accessToken: parsed.accessToken, mode: parsed.mode, ...(typeof parsed.roomCode === "string" ? { roomCode: parsed.roomCode } : {}) };
  } catch {
    return null;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { message?: string; validation?: ForgeValidation };
  if (!response.ok) {
    const error = new Error(payload.message ?? "Request failed.") as Error & { validation?: ForgeValidation };
    if (payload.validation) error.validation = payload.validation;
    throw error;
  }
  return payload;
}
