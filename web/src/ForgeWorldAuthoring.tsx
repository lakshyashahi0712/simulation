import type { ScenarioDefinition, ScenarioObject, PhysicsBody, ColliderType } from "../../src/domain/scenario.js";
import { syncReportVisibility } from "../../src/domain/authoring.js";
import { ScalarField } from "./ForgeAuthoring.js";
import { useEffect, useState } from "react";

type ChangeScenario = (update: (scenario: ScenarioDefinition) => ScenarioDefinition) => void;

const bodies: PhysicsBody[] = ["fixed", "kinematic", "dynamic"];
const colliders: ColliderType[] = ["box", "sphere", "capsule", "none"];

function toggleValue(values: string[], value: string, enabled: boolean): string[] {
  return enabled ? [...values, value] : values.filter((candidate) => candidate !== value);
}

function patchObject(scenario: ScenarioDefinition, objectId: string, patch: Partial<ScenarioObject>): ScenarioDefinition {
  return {
    ...scenario,
    environment: {
      ...scenario.environment,
      objects: scenario.environment.objects.map((object) => object.id === objectId ? { ...object, ...patch } : object)
    }
  };
}

export function ForgeWorldAuthoring({ scenario, onChange, busy, focusPath }: { scenario: ScenarioDefinition; onChange: ChangeScenario; busy: boolean; focusPath?: string | undefined }) {
  const [propertyNames, setPropertyNames] = useState<Record<string, string>>({});
  const disabled = busy || scenario.status === "published";
  useEffect(() => {
    if (!focusPath) return;
    const object = /^environment\.objects\[(\d+)\]/.exec(focusPath);
    const role = /^roles\[(\d+)\]/.exec(focusPath);
    const id = object ? scenario.environment.objects[Number(object[1])]?.id : role ? scenario.roles[Number(role[1])]?.id : undefined;
    if (!id) return;
    const card = [...document.querySelectorAll<HTMLDetailsElement>(object ? ".forge-physics-card" : ".forge-visibility-card")].find((candidate) => (object ? candidate.dataset.objectId : candidate.dataset.roleId) === id);
    if (card) { card.open = true; card.scrollIntoView({ block: "center" }); card.querySelector<HTMLInputElement>("input, select, textarea")?.focus(); }
  }, [focusPath]);
  function updateProperty(object: ScenarioObject, name: string, value: unknown) {
    onChange((current) => patchObject(current, object.id, { properties: { ...object.properties, [name]: value } }));
  }
  return <section className="panel forge-world-authoring" aria-label="Role visibility and physics editor">
    <div className="panel-title"><div><p className="eyebrow">WORLD / ACCESS AUTHORING</p><h3>Choose who sees what and how objects move.</h3></div></div>
    <fieldset className="forge-world-grid" disabled={disabled}>
      <section className="forge-world-section">
        <h4>Role visibility</h4>
        <p className="panel-copy">Visibility controls the trainee view. Instructor ground truth remains separate.</p>
        {scenario.roles.map((role) => <details className="forge-visibility-card" key={role.id} data-role-id={role.id} open>
          <summary><strong>{role.name}</strong><code>{role.id}</code></summary>
          <div className="forge-fields forge-role-brief"><label>Role name<input value={role.name} onChange={(event) => onChange((current) => ({ ...current, roles: current.roles.map((candidate) => candidate.id === role.id ? { ...candidate, name: event.target.value } : candidate) }))} /></label><label>Role briefing<textarea rows={2} value={role.briefing} onChange={(event) => onChange((current) => ({ ...current, roles: current.roles.map((candidate) => candidate.id === role.id ? { ...candidate, briefing: event.target.value } : candidate) }))} /></label></div>
          <div className="forge-visibility-groups">
            <fieldset><legend>Objects</legend>{scenario.environment.objects.map((object) => <label key={object.id}><input type="checkbox" disabled={busy} checked={role.visibility.objectIds.includes(object.id)} onChange={(event) => onChange((current) => ({ ...current, roles: current.roles.map((candidate) => candidate.id === role.id ? { ...candidate, visibility: { ...candidate.visibility, objectIds: toggleValue(candidate.visibility.objectIds, object.id, event.target.checked) } } : candidate) }))} />{object.name}</label>)}</fieldset>
            <fieldset><legend>Report recipients</legend>{scenario.reports.map((report) => <label key={report.id}><input type="checkbox" checked={report.targetRoles.includes(role.id)} onChange={(event) => onChange((current) => syncReportVisibility({ ...current, reports: current.reports.map((candidate) => candidate.id === report.id ? { ...candidate, targetRoles: toggleValue(candidate.targetRoles, role.id, event.target.checked) } : candidate) }))} />{report.id}</label>)}</fieldset>
          </div>
        </details>)}
      </section>
      <section className="forge-world-section">
        <h4>Object physics</h4>
        <p className="panel-copy">Set the simplified runtime body, collider, trigger behavior, and map position.</p>
        {scenario.environment.objects.map((object) => <details className="forge-physics-card" key={object.id} data-object-id={object.id}>
          <summary><strong>{object.name}</strong><code>{object.id}</code></summary>
          <div className="forge-fields">
            <label>Name<input disabled={busy} value={object.name} onChange={(event) => onChange((current) => patchObject(current, object.id, { name: event.target.value }))} /></label>
            <label>Body<select disabled={busy} value={object.physics?.body ?? "fixed"} onChange={(event) => onChange((current) => patchObject(current, object.id, { physics: { ...(object.physics ?? { collider: "box", trigger: false }), body: event.target.value as PhysicsBody } }))}>{bodies.map((body) => <option value={body} key={body}>{body}</option>)}</select></label>
            <label>Collider<select disabled={busy} value={object.physics?.collider ?? "box"} onChange={(event) => onChange((current) => patchObject(current, object.id, { physics: { ...(object.physics ?? { body: "fixed", trigger: false }), collider: event.target.value as ColliderType } }))}>{colliders.map((collider) => <option value={collider} key={collider}>{collider}</option>)}</select></label>
            {(["x", "y", "z"] as const).map((axis) => <label key={axis}>Position {axis.toUpperCase()}<input type="number" step="0.1" value={object.transform.position[axis]} onChange={(event) => onChange((current) => patchObject(current, object.id, { transform: { ...object.transform, position: { ...object.transform.position, [axis]: Number(event.target.value) } } }))} /></label>)}
            {(["x", "y", "z"] as const).map((axis) => <label key={axis}>Scale {axis.toUpperCase()}<input type="number" min="0.1" step="0.1" value={object.transform.scale[axis]} onChange={(event) => onChange((current) => patchObject(current, object.id, { transform: { ...object.transform, scale: { ...object.transform.scale, [axis]: Number(event.target.value) } } }))} /></label>)}
            <label>Rotation Y (radians)<input type="number" step="0.1" value={object.transform.rotationY} onChange={(event) => onChange((current) => patchObject(current, object.id, { transform: { ...object.transform, rotationY: Number(event.target.value) } }))} /></label>
            <label>Movement owner<select value={String(object.properties?.roleId ?? "")} onChange={(event) => { const properties = { ...object.properties }; if (event.target.value) properties.roleId = event.target.value; else delete properties.roleId; onChange((current) => patchObject(current, object.id, { properties })); }}><option value="">No trainee movement</option>{scenario.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
          </div>
          <label className="forge-checkbox"><input disabled={busy} type="checkbox" checked={object.physics?.trigger ?? false} onChange={(event) => onChange((current) => patchObject(current, object.id, { physics: { ...(object.physics ?? { body: "fixed", collider: "box" }), trigger: event.target.checked } }))} />Trigger zone</label>
          <div className="forge-properties"><h4>Initial state properties</h4>{Object.entries(object.properties ?? {}).filter(([name]) => name !== "roleId").map(([name, value]) => <div key={name}><ScalarField label={name} value={value} onChange={(next) => updateProperty(object, name, next)} /><button className="button button-ghost" onClick={() => { const properties = { ...object.properties }; delete properties[name]; onChange((current) => patchObject(current, object.id, { properties })); }}>Remove {name}</button></div>)}<div className="forge-add-row"><label>New property name<input value={propertyNames[object.id] ?? ""} onChange={(event) => setPropertyNames({ ...propertyNames, [object.id]: event.target.value })} /></label><button className="button button-ghost" disabled={!propertyNames[object.id]?.trim() || propertyNames[object.id]?.trim() === "roleId" || Object.hasOwn(object.properties ?? {}, propertyNames[object.id]?.trim() ?? "")} onClick={() => { updateProperty(object, propertyNames[object.id]!.trim(), ""); setPropertyNames({ ...propertyNames, [object.id]: "" }); }}>Add property</button></div></div>
        </details>)}
      </section>
    </fieldset>
  </section>;
}
