import { useEffect, useMemo, useState } from "react";
import { ALL_BIOME_URLS, classifyPropUrl, type PropRole } from "../biomes";
import { useGame } from "../store";
import { useEditor } from "./editorStore";

// Dev-only level-editor UI. Floating toggle + a side panel: asset palette
// (place), per-selection controls (move / delete / rotate / scale / blocks),
// and the per-level "override procedural" switch. Mounted in App.tsx behind
// import.meta.env.DEV so it never ships to production.

const ROLE_ORDER: PropRole[] = ["building", "tree", "bush", "rock", "grass", "cosmetic"];
const ROLE_LABEL: Record<PropRole, string> = {
  building: "Buildings",
  tree: "Trees",
  bush: "Bushes",
  rock: "Rocks",
  grass: "Grass",
  cosmetic: "Cosmetics",
};

const labelFor = (url: string): string =>
  url
    .split("/")
    .pop()
    ?.replace(/\.(glb|gltf)$/i, "") ?? url;

type CatalogEntry = { role: PropRole; url: string; label: string };

// Deduped, role-grouped catalog of every biome asset. A function (not an
// eager module const) so this module stays side-effect-free and Rollup can
// tree-shake the whole editor out of production builds.
const buildCatalog = (): CatalogEntry[] =>
  Array.from(new Set(ALL_BIOME_URLS))
    .map((url) => ({ role: classifyPropUrl(url), url, label: labelFor(url) }))
    .sort(
      (a, b) =>
        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.label.localeCompare(b.label),
    );

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

export const LevelEditorPanel = () => {
  const active = useEditor((s) => s.active);
  const placingUrl = useEditor((s) => s.placingUrl);
  const selectedId = useEditor((s) => s.selectedId);
  const moving = useEditor((s) => s.moving);
  const toggleActive = useEditor((s) => s.toggleActive);

  const version = useGame((s) => s.ui.treeVersion);
  const levelId = useGame((s) => s.world.levelId);
  const overrideActive = useGame((s) => s.world.overrideActive);

  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  // Re-read live props each render; `version` (subscribed above) drives the refresh.
  void version;
  const propsArr = useGame.getState().world.props;
  const selected = selectedId !== null ? (propsArr.find((p) => p.id === selectedId) ?? null) : null;

  // Keyboard: Esc steps back (disarm → deselect → close); Delete removes.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const ed = useEditor.getState();
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
      <button type="button" style={fab} onClick={toggleActive} title="Open level editor (dev only)">
        <PencilIcon />
        Edit Level
      </button>
    );
  }

  const onExport = () => {
    const json = useEditor.getState().exportJson();
    void navigator.clipboard?.writeText(json).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
    // Also log so it's recoverable if clipboard is blocked.
    console.log("[level-editor] export L%d:\n%s", levelId, json);
  };

  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 13 }}>Level Editor · L{levelId}</strong>
        <button type="button" style={btn()} onClick={toggleActive}>
          Close
        </button>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={overrideActive}
          onChange={(e) => useEditor.getState().setOverride(e.target.checked)}
        />
        Override procedural placement
        <span style={{ color: "#8b93a3" }}>(reloads)</span>
      </label>

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
              onClick={() => useEditor.getState().beginMove()}
            >
              {moving ? "Click map…" : "Move"}
            </button>
            <button
              type="button"
              style={{ ...btn(), borderColor: "#7a3a3a", background: "#3a1c1c" }}
              onClick={() => useEditor.getState().deleteSelected()}
            >
              Delete
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              style={btn()}
              onClick={() => useEditor.getState().rotateSelected(-Math.PI / 12)}
            >
              Rotate ⟲
            </button>
            <button
              type="button"
              style={btn()}
              onClick={() => useEditor.getState().rotateSelected(Math.PI / 12)}
            >
              Rotate ⟳
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              style={btn()}
              onClick={() => useEditor.getState().scaleSelected(1 / 1.15)}
            >
              Scale −
            </button>
            <button
              type="button"
              style={btn()}
              onClick={() => useEditor.getState().scaleSelected(1.15)}
            >
              Scale +
            </button>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={selected.blocks}
              onChange={() => useEditor.getState().toggleSelectedBlocks()}
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
                  onClick={() => useEditor.getState().setPlacing(c.url)}
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
            onClick={() => useEditor.getState().clearLevel()}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
};
