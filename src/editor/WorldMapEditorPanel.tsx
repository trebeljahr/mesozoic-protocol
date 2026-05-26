import { useEffect, useMemo, useState } from "react";
import type { PropRole } from "../biomes";
import { buildCatalog, type CatalogEntry, labelFor, ROLE_LABEL, ROLE_ORDER } from "./assetCatalog";
import { useWorldMapEditor } from "./worldMapEditorStore";

// Dev-only world-map editor UI. Same layout as LevelEditorPanel but writes
// to the global world-map edit store (single persistence shape, no
// per-level keying, no "override procedural" toggle yet). Mounted in
// App.tsx behind import.meta.env.DEV && screen === "worldMap".

const panel: React.CSSProperties = {
  position: "fixed",
  top: 8,
  right: 8,
  bottom: 8,
  width: 290,
  zIndex: 10000,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 10,
  background: "rgba(14,16,22,0.94)",
  border: "1px solid #3a4150",
  borderRadius: 8,
  color: "#e6e9ef",
  font: "12px/1.4 system-ui, sans-serif",
  boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
};

const btn = (on = false): React.CSSProperties => ({
  padding: "5px 8px",
  borderRadius: 5,
  border: `1px solid ${on ? "#6aa9ff" : "#3a4150"}`,
  background: on ? "#1d3a66" : "#1a1f29",
  color: "#e6e9ef",
  cursor: "pointer",
  fontSize: 12,
});

const fab: React.CSSProperties = {
  position: "fixed",
  left: 10,
  bottom: 10,
  zIndex: 10000,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 11px",
  borderRadius: 7,
  border: "1px solid #3a4150",
  background: "rgba(14,16,22,0.92)",
  color: "#e6e9ef",
  cursor: "pointer",
  font: "12px/1 system-ui, sans-serif",
};

const PencilIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    role="img"
  >
    <title>Edit</title>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

export const WorldMapEditorPanel = () => {
  const active = useWorldMapEditor((s) => s.active);
  const placingUrl = useWorldMapEditor((s) => s.placingUrl);
  const selectedId = useWorldMapEditor((s) => s.selectedId);
  const moving = useWorldMapEditor((s) => s.moving);
  const version = useWorldMapEditor((s) => s.version);
  const toggleActive = useWorldMapEditor((s) => s.toggleActive);
  // Subscribe to history so Undo/Redo button enabled state refreshes on push.
  const history = useWorldMapEditor((s) => s.history);
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  void version;
  const propsArr = useWorldMapEditor.getState().props;
  const selected = selectedId !== null ? (propsArr.find((p) => p.id === selectedId) ?? null) : null;

  // Keyboard: Esc steps back (disarm → deselect → close); Delete removes;
  // Ctrl/Meta+Z undoes, Ctrl+Shift+Z / Ctrl+Y redoes. Skip undo/redo
  // shortcuts when typing in an input/textarea so native field undo wins.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const ed = useWorldMapEditor.getState();
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA";
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !inField && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) ed.redo();
        else ed.undo();
        return;
      }
      if (mod && !inField && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        ed.redo();
        return;
      }
      if (e.key === "Escape") {
        if (ed.placingUrl) ed.setPlacing(ed.placingUrl);
        else if (ed.selectedId !== null) ed.select(null);
        else ed.toggleActive();
      } else if ((e.key === "Delete" || e.key === "Backspace") && ed.selectedId !== null) {
        e.preventDefault();
        ed.deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const catalog = useMemo(() => buildCatalog(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = q ? catalog.filter((c) => c.label.toLowerCase().includes(q)) : catalog;
    const byRole = new Map<PropRole, CatalogEntry[]>();
    for (const c of items) {
      const list = byRole.get(c.role) ?? [];
      list.push(c);
      byRole.set(c.role, list);
    }
    return ROLE_ORDER.filter((r) => byRole.has(r)).map((r) => [r, byRole.get(r)!] as const);
  }, [query, catalog]);

  if (!active) {
    return (
      <button
        type="button"
        style={fab}
        onClick={toggleActive}
        title="Open world-map editor (dev only)"
      >
        <PencilIcon />
        Edit Map
      </button>
    );
  }

  const onExport = () => {
    const json = useWorldMapEditor.getState().exportJson();
    void navigator.clipboard?.writeText(json).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
    console.log("[worldmap-editor] export:\n%s", json);
  };

  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 13 }}>World Map Editor</strong>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            style={{ ...btn(), opacity: canUndo ? 1 : 0.4 }}
            disabled={!canUndo}
            onClick={() => useWorldMapEditor.getState().undo()}
            title="Undo (Ctrl/Cmd+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            style={{ ...btn(), opacity: canRedo ? 1 : 0.4 }}
            disabled={!canRedo}
            onClick={() => useWorldMapEditor.getState().redo()}
            title="Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)"
          >
            Redo
          </button>
          <button type="button" style={btn()} onClick={toggleActive}>
            Close
          </button>
        </div>
      </div>

      {selected ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: 8,
            background: "#11151d",
            border: "1px solid #2a313d",
            borderRadius: 6,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600 }}>{labelFor(selected.url)}</span>
            <span style={{ color: "#8b93a3" }}>×{selected.scale.toFixed(2)}</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              style={btn(moving)}
              onClick={() => useWorldMapEditor.getState().beginMove()}
            >
              {moving ? "Click map…" : "Move"}
            </button>
            <button
              type="button"
              style={{ ...btn(), borderColor: "#7a3a3a", background: "#3a1c1c" }}
              onClick={() => useWorldMapEditor.getState().deleteSelected()}
            >
              Delete
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              style={btn()}
              onClick={() => useWorldMapEditor.getState().rotateSelected(-Math.PI / 12)}
            >
              Rotate ⟲
            </button>
            <button
              type="button"
              style={btn()}
              onClick={() => useWorldMapEditor.getState().rotateSelected(Math.PI / 12)}
            >
              Rotate ⟳
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              style={btn()}
              onClick={() => useWorldMapEditor.getState().scaleSelected(1 / 1.15)}
            >
              Scale −
            </button>
            <button
              type="button"
              style={btn()}
              onClick={() => useWorldMapEditor.getState().scaleSelected(1.15)}
            >
              Scale +
            </button>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={selected.blocks}
              onChange={() => useWorldMapEditor.getState().toggleSelectedBlocks()}
            />
            Blocks tower placement
          </label>
        </div>
      ) : (
        <div style={{ color: "#8b93a3" }}>
          {placingUrl
            ? `Placing ${labelFor(placingUrl)} — click map to drop. Click asset again or Esc to stop.`
            : "Pick an asset to place, or click a placed prop to select it."}
        </div>
      )}

      <input
        type="text"
        placeholder="Search assets…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          padding: "5px 7px",
          borderRadius: 5,
          border: "1px solid #3a4150",
          background: "#11151d",
          color: "#e6e9ef",
        }}
      />

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map(([role, items]) => (
          <div key={role}>
            <div
              style={{
                color: "#8b93a3",
                margin: "2px 0 4px",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                fontSize: 10,
              }}
            >
              {ROLE_LABEL[role]}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {items.map((c) => (
                <button
                  key={c.url}
                  type="button"
                  title={c.url}
                  style={btn(placingUrl === c.url)}
                  onClick={() => useWorldMapEditor.getState().setPlacing(c.url)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: "1px solid #2a313d",
          paddingTop: 8,
        }}
      >
        <span style={{ color: "#8b93a3" }}>{propsArr.length} props</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" style={btn()} onClick={onExport}>
            {copied ? "Copied!" : "Export"}
          </button>
          <button
            type="button"
            style={{ ...btn(), borderColor: "#7a3a3a", background: "#3a1c1c" }}
            onClick={() => useWorldMapEditor.getState().clearAll()}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
};
