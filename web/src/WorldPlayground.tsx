import { useEffect, useRef, useState } from "react";
import type { Vector3 } from "../../src/domain/scenario.js";
import type { SessionView } from "../../src/server/protocol.js";
import type { PlaygroundScene } from "./playground-scene.js";
import { boundedPosition, canMoveWorldObject, objectTint, worldDimensions, worldPosition, type PlaygroundModel } from "./playground-model.js";
import "./playground.css";

interface WorldViewportProps extends PlaygroundModel {
  onSelect: (objectId: string) => void;
  onMoveTo?: (position: Vector3) => void;
}

export function WorldViewport(props: WorldViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PlaygroundScene | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [mode, setMode] = useState<"3d" | "plan">("3d");
  const [failure, setFailure] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const { width, depth } = worldDimensions(props.environment);

  useEffect(() => {
    if (mode !== "3d" || !hostRef.current) return;
    let cancelled = false;
    let scene: PlaygroundScene | undefined;
    setReady(false);
    const unavailable = (message: string) => { if (!cancelled) { setFailure(message); setMode("plan"); } };
    void import("./playground-scene.js").then(({ PlaygroundScene }) => {
      if (cancelled || !hostRef.current) return;
      scene = new PlaygroundScene(hostRef.current, latest.current, (id) => latest.current.onSelect(id), (position) => latest.current.onMoveTo?.(position), unavailable);
      sceneRef.current = scene;
      setReady(true);
    }).catch(() => unavailable("3D requires WebGL2. You can use the interactive plan view on this device."));
    return () => { cancelled = true; scene?.dispose(); sceneRef.current = null; };
  }, [mode, width, depth]);

  useEffect(() => { sceneRef.current?.update(props); }, [props.environment, props.bodies, props.channelHealth, props.objectStates, props.selectedId]);

  return <div className="world-viewport" data-view-mode={mode}>
    <div className="world-toolbar" aria-label="Playground camera controls">
      <div className="world-view-switch"><button type="button" className="button button-ghost" aria-pressed={mode === "3d"} onClick={() => { setFailure(null); setMode("3d"); }}>3D view</button><button type="button" className="button button-ghost" aria-pressed={mode === "plan"} onClick={() => setMode("plan")}>Plan view</button></div>
      <button type="button" className="button button-ghost" disabled={mode !== "3d" || !ready} onClick={() => sceneRef.current?.resetCamera()}>Reset camera</button>
      <button type="button" className="button button-ghost" disabled={mode !== "3d" || !ready} onClick={() => sceneRef.current?.resetCamera(true)}>Overhead</button>
      <button type="button" className="button button-ghost" disabled={mode !== "3d" || !ready || !props.selectedId} onClick={() => sceneRef.current?.focusSelected()}>Focus selected</button>
    </div>
    {failure && <p className="world-notice" role="status">{failure}</p>}
    <div className="world-stage">
      {mode === "3d" ? <><div className="world-canvas-host" ref={hostRef} />{!ready && <p className="world-loading" role="status">Loading 3D playground…</p>}</> : <WorldPlanView model={props} onSelect={props.onSelect} />}
      <span className="world-dimensions">{width} × {depth} m · {props.environment.objects.length} visible objects</span>
    </div>
    <p className="world-help">{mode === "3d" ? "Drag to orbit · right-drag / two fingers to pan · scroll / pinch to zoom · select a label or object" : "Select a marker or use the object selector below"}</p>
  </div>;
}

function WorldPlanView({ model, onSelect }: { model: PlaygroundModel; onSelect: (id: string) => void }) {
  const { width, depth } = worldDimensions(model.environment);
  const unit = Math.max(width, depth) / 90;
  return <svg className="world-plan" viewBox={`${-width / 2} ${-depth / 2} ${width} ${depth}`} aria-label="Interactive playground plan view">
    <rect x={-width / 2} y={-depth / 2} width={width} height={depth} fill="#142c35" />
    {model.environment.objects.map((object) => {
      const position = worldPosition(object, model.bodies);
      const tint = `#${objectTint(object, model).toString(16).padStart(6, "0")}`;
      return <g key={object.id} role="button" tabIndex={0} aria-label={`Select ${object.name}`} aria-pressed={object.id === model.selectedId} data-object-id={object.id} transform={`translate(${position.x} ${position.z})`} onClick={() => onSelect(object.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(object.id); } }}>
        <title>{object.name}</title><circle r={unit * 1.5} fill={tint} stroke={object.id === model.selectedId ? "white" : "#0b1d29"} strokeWidth={unit / 3} /><text y={-unit * 2.5} textAnchor="middle" fontSize={unit * 2} fill="#e4edf7">{object.name}</text>
      </g>;
    })}
  </svg>;
}

export function ExercisePlayground({ view, connected, emit }: { view: SessionView; connected: boolean; emit: (event: string, payload?: unknown) => void }) {
  const objects = view.scenario.environment.objects;
  const initialSelection = objects.find((object) => canMoveWorldObject(object, view))?.id ?? objects[0]?.id ?? null;
  const [selection, setSelection] = useState<string | null>(initialSelection);
  const selected = objects.find((object) => object.id === selection) ?? objects[0];
  const selectedId = selected?.id ?? null;
  const [step, setStep] = useState("2");
  const instructor = view.participant.kind === "instructor";
  const bodies = instructor ? view.groundTruth?.physicsBodies : view.physicsBodies;
  const position = selected ? worldPosition(selected, bodies) : undefined;
  const movable = Boolean(selected && canMoveWorldObject(selected, view));
  const active = connected && view.session.status === "running";
  const distance = Math.max(0.25, Math.min(10, Number(step) || 2));

  function moveTo(target: Vector3) {
    if (!selected || !position || !movable || !active) return;
    const destination = boundedPosition({ ...target, y: position.y }, view.scenario.environment);
    // No speculative pose is rendered; the next authoritative state supplies it.
    emit("session:move-object", { objectId: selected.id, position: destination, velocity: { x: 0, y: 0, z: 0 } });
  }
  function move(dx: number, dz: number) { if (position) moveTo({ x: position.x + dx * distance, y: position.y, z: position.z + dz * distance }); }
  const status = selected ? (instructor ? view.groundTruth?.objectStates[selected.id]?.status : undefined) ?? selected.properties?.status : undefined;
  return <section className="panel playground-panel" onKeyDown={(event) => {
    if (!movable || !active || event.target instanceof HTMLElement && event.target.closest("input,select,textarea,button")) return;
    const direction: Record<string, [number, number]> = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
    const delta = direction[event.key];
    if (delta && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); move(...delta); }
  }}>
    <div className="panel-title"><div><p className="eyebrow">{instructor ? "GROUND TRUTH / LIVE WORLD" : "YOUR ROLE / LIVE WORLD"}</p><h2>3D playground</h2></div><span className="world-scope">{instructor ? "Instructor view" : "Role-filtered view"}</span></div>
    <WorldViewport environment={view.scenario.environment} bodies={bodies} channelHealth={view.channelHealth} objectStates={instructor ? view.groundTruth?.objectStates : undefined} selectedId={selectedId} onSelect={setSelection} onMoveTo={moveTo} />
    <div className="world-inspector">
      <label>Selected world object<select value={selectedId ?? ""} disabled={!objects.length} onChange={(event) => setSelection(event.target.value)}>{!objects.length && <option value="">No objects visible to this role</option>}{objects.map((object) => <option value={object.id} key={object.id}>{object.name}</option>)}</select></label>
      {selected && <div className="world-object-summary" data-selected-object={selected.id}><strong>{selected.name}</strong><span>{selected.type} · {selected.physics?.body ?? "no physics"}{selected.physics?.trigger ? " · trigger" : ""}</span><span className="world-position">X {position?.x.toFixed(1)} · Y {position?.y.toFixed(1)} · Z {position?.z.toFixed(1)}</span>{status !== undefined && <span>{instructor ? "Current state" : "Initial briefing state"}: {String(status)}</span>}</div>}
      {movable && <div className="world-movement"><label>Move step (metres)<input type="number" min="0.25" max="10" step="0.25" value={step} onChange={(event) => setStep(event.target.value)} /></label><div className="world-direction-pad" aria-label="Move selected object"><button className="button button-ghost" disabled={!active} aria-label="Move north" onClick={() => move(0, -1)}>↑</button><button className="button button-ghost" disabled={!active} aria-label="Move west" onClick={() => move(-1, 0)}>←</button><button className="button button-ghost" disabled={!active} aria-label="Move south" onClick={() => move(0, 1)}>↓</button><button className="button button-ghost" disabled={!active} aria-label="Move east" onClick={() => move(1, 0)}>→</button></div><small>Arrow keys / WASD with canvas focused · Shift-click ground to move. Positions are confirmed by the server.</small></div>}
      {!instructor && selected?.physics?.trigger && <button className="button button-secondary" disabled={!active} onClick={() => emit("session:zone-entered", { objectId: selected.id })}>Activate selected trigger</button>}
    </div>
    {!connected && <p className="world-notice" role="status">Connection lost. Showing the last confirmed world; reconnect to move or interact.</p>}
    {view.session.status !== "running" && <p className="world-help">{view.session.status === "ended" ? "Completed exercise: world controls are read-only." : "Start or resume the exercise to move and interact."}</p>}
  </section>;
}
