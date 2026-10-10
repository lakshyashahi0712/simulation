import { useState } from "react";
import type { ScenarioSummary } from "../../src/server/protocol.js";

export function ScenarioLibrary({ items, selectedId, onOpen, onVersion, onArchive, dirty }: {
  items: ScenarioSummary[]; selectedId?: string; onOpen: (id: string) => void;
  onVersion: () => void; onArchive: (archived: boolean) => void; dirty: boolean;
}) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const selected = items.find((item) => item.id === selectedId);
  const familyId = selected?.library?.familyId ?? selected?.id;
  const history = items.filter((item) => (item.library?.familyId ?? item.id) === familyId).sort((a, b) => b.version - a.version);
  const filtered = items.filter((item) => (showArchived || !item.library?.archived)
    && (!tag || item.tags.includes(tag))
    && `${item.title} ${item.description} ${item.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  return <aside className="panel forge-library">
    <div className="panel-title"><h2>Scenario library</h2><span>{filtered.length} / {items.length}</span></div>
    <div className="forge-form library-filters">
      <label>Search library<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label>Filter by tag<select value={tag} onChange={(event) => setTag(event.target.value)}><option value="">All tags</option>{[...new Set(items.flatMap((item) => item.tags))].sort().map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="library-checkbox"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived</label>
    </div>
    <div className="forge-scenario-list">{filtered.map((item) => <button key={item.id} className={`forge-scenario-card ${selectedId === item.id ? "selected" : ""}`} onClick={() => onOpen(item.id)}>
      <span className={`forge-status status-${item.status}`}>{item.library?.archived ? "archived" : item.status}</span><strong>{item.title}</strong><small>{item.category} · v{item.version}</small><small>{item.tags.join(" · ")}</small>
    </button>)}{filtered.length === 0 && <p className="panel-copy">No scenarios match these filters.</p>}</div>
    {selected && <div className="library-history">
      <h3>Version history</h3><p className="panel-copy">New version continues this history. Duplicate selected starts a separate exercise family.</p>
      <button className="button button-primary" disabled={selected.status !== "published" || dirty} onClick={onVersion}>New version</button>{" "}
      <button className="button button-ghost" disabled={dirty} onClick={() => onArchive(!selected.library?.archived)}>{selected.library?.archived ? "Restore from archive" : "Archive selected"}</button>
      {dirty && <p className="panel-copy">Save the draft before archiving.</p>}
      <ol>{history.map((item) => <li key={item.id}><button className="validation-link" onClick={() => onOpen(item.id)}>v{item.version} · {item.library?.archived ? "archived / " : ""}{item.status}</button>{item.library?.publishedAt && <small>Published {new Date(item.library.publishedAt).toLocaleString()}</small>}{item.library?.sourceScenarioId && <small>Based on v{items.find((source) => source.id === item.library?.sourceScenarioId)?.version ?? "?"}</small>}</li>)}</ol>
    </div>}
  </aside>;
}
