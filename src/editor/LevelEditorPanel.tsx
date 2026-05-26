import { useEffect, useMemo, useState } from "react";
import type { Biome, PropRole } from "../biomes";
import type { River } from "../sim/types";
import { useGame } from "../store";
import { buildCatalog, type CatalogEntry, labelFor, ROLE_LABEL, ROLE_ORDER } from "./assetCatalog";
import {
  BIOME_LABEL,
  BIOME_ORDER,
  type BrushPreset,
  BUILTIN_BRUSH_PRESETS,
  getBrushPreset,
} from "./brush";
import { downloadJson } from "./download";
import { useEditor } from "./editorStore";
import { PropPreview } from "./PropPreview";

// Dev-only level-editor UI. Floating toggle + a side panel: asset palette
// (place), per-selection controls (move / delete / rotate / scale / blocks),
// and the per-level "override procedural" switch. Mounted in App.tsx behind
// import.meta.env.DEV so it never ships to production.

const panel: React.CSSProperties = {
  position: "fixed",
  top: 8,
  right: 8,
  bottom: 8,
  width: 340,
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

// Compact swatch button — preview thumbnail above a truncated label. Fixed
// width so the palette grid wraps cleanly across role groups.
const swatchBtn = (on = false): React.CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 3,
  padding: 4,
  width: 64,
  borderRadius: 5,
  border: `1px solid ${on ? "#6aa9ff" : "#3a4150"}`,
  background: on ? "#1d3a66" : "#1a1f29",
  color: "#e6e9ef",
  cursor: "pointer",
  fontSize: 9,
  lineHeight: 1.15,
});

const swatchLabel: React.CSSProperties = {
  width: "100%",
  textAlign: "center",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
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

// Dev-only river-tool control panel. Renders inside the LevelEditorPanel
// when the tool is active. Width slider drives the in-progress or selected
// river; delete-river is the explicit destroy. Per-point delete is wired
// through the spheres rendered by EditorProps (the user shift-clicks them).
const RiverControls = ({
  tool,
  editingRiver,
  selectedRiver,
}: {
  tool: { width: number; editingRiverId: string | null; selectedRiverId: string | null };
  editingRiver: River | null;
  selectedRiver: River | null;
}) => {
  // editingRiver has priority — while the user is mid-stroke, the slider
  // should affect that river, not whatever was previously selected.
  const target = editingRiver ?? selectedRiver;
  const targetWidth = target?.width ?? tool.width;
  return (
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
        <span style={{ fontWeight: 600 }}>
          {editingRiver ? "Painting river…" : selectedRiver ? "River selected" : "River tool"}
        </span>
        <span style={{ color: "#8b93a3" }}>{targetWidth.toFixed(2)}w</span>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "#8b93a3", minWidth: 40 }}>Width</span>
        <input
          type="range"
          min={0.5}
          max={20}
          step={0.1}
          value={targetWidth}
          onChange={(e) => useEditor.getState().setRiverWidth(Number(e.target.value))}
          style={{ flex: 1 }}
        />
      </label>
      <div style={{ color: "#8b93a3", fontSize: 11 }}>
        {editingRiver
          ? "Click map to add points. Finish river to commit. Shift-click a point to delete it."
          : selectedRiver
            ? `${selectedRiver.points.length} pts. Drag spheres to move. Shift-click to delete a point.`
            : "Click map to start a new river. Click an existing point to select that river."}
      </div>
      {selectedRiver && !editingRiver && (
        <button
          type="button"
          style={{
            padding: "5px 8px",
            borderRadius: 5,
            border: "1px solid #7a3a3a",
            background: "#3a1c1c",
            color: "#e6e9ef",
            cursor: "pointer",
            fontSize: 12,
          }}
          onClick={() => useEditor.getState().deleteRiver(selectedRiver.id)}
        >
          Delete river
        </button>
      )}
    </div>
  );
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
  const brush = useEditor((s) => s.brush);
  const riverTool = useEditor((s) => s.riverTool);
  const toggleActive = useEditor((s) => s.toggleActive);
  // Subscribe to history so Undo/Redo button enabled state refreshes on push.
  const history = useEditor((s) => s.history);
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const version = useGame((s) => s.ui.treeVersion);
  const levelId = useGame((s) => s.world.levelId);
  const overrideActive = useGame((s) => s.world.overrideActive);

  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  // Re-read live props each render; `version` (subscribed above) drives the refresh.
  void version;
  const propsArr = useGame.getState().world.props;
  const riversArr = useGame.getState().world.rivers;
  const selected = selectedId !== null ? (propsArr.find((p) => p.id === selectedId) ?? null) : null;
  const selectedRiver =
    riverTool.selectedRiverId !== null
      ? (riversArr.find((r) => r.id === riverTool.selectedRiverId) ?? null)
      : null;

  // Keyboard: Esc steps back (disarm → deselect → close); Delete removes;
  // Ctrl/Meta+Z undoes, Ctrl+Shift+Z / Ctrl+Y redoes. Skip undo/redo
  // shortcuts when typing in an input/textarea so native field undo wins.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const ed = useEditor.getState();
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

  const onDownload = () => {
    const json = useEditor.getState().exportJson();
    downloadJson(`mz-level-${levelId}.json`, json);
  };

  const onDownloadAll = () => {
    const json = useEditor.getState().exportAllJson();
    downloadJson("mz-all-levels.json", json);
  };

  const onClearAll = () => {
    if (
      !window.confirm(
        "Clear hand-placed props for EVERY level? This is irreversible (history is per-session).",
      )
    ) {
      return;
    }
    useEditor.getState().clearAllLevels();
  };

  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 13 }}>Level Editor · L{levelId}</strong>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            style={{ ...btn(), opacity: canUndo ? 1 : 0.4 }}
            disabled={!canUndo}
            onClick={() => useEditor.getState().undo()}
            title="Undo (Ctrl/Cmd+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            style={{ ...btn(), opacity: canRedo ? 1 : 0.4 }}
            disabled={!canRedo}
            onClick={() => useEditor.getState().redo()}
            title="Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)"
          >
            Redo
          </button>
          <button type="button" style={btn()} onClick={toggleActive}>
            Close
          </button>
        </div>
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

      <BrushSection brush={brush} />

      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          style={btn(riverTool.active)}
          onClick={() => useEditor.getState().setRiverToolActive(!riverTool.active)}
          title="River-painting tool — click the map to drop spline control points"
        >
          {riverTool.active ? "River ✓" : "River"}
        </button>
        {riverTool.active && riverTool.editingRiverId !== null && (
          <button
            type="button"
            style={btn()}
            onClick={() => useEditor.getState().finishRiver()}
            title="Finish the current river (close stroke; further clicks start a new river)"
          >
            Finish river
          </button>
        )}
      </div>

      {riverTool.active && (
        <RiverControls
          tool={riverTool}
          selectedRiver={selectedRiver}
          editingRiver={
            riverTool.editingRiverId !== null
              ? (riversArr.find((r) => r.id === riverTool.editingRiverId) ?? null)
              : null
          }
        />
      )}

      {brush.active ? (
        <div style={{ color: "#8b93a3" }}>
          Brush active — click-drag the map to scatter. Tap the preset again to disarm.
        </div>
      ) : selected ? (
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
          opacity: brush.active ? 0.5 : 1,
        }}
      />

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          opacity: brush.active ? 0.5 : 1,
        }}
      >
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
                  title={`${c.label}\n${c.url}`}
                  style={swatchBtn(placingUrl === c.url)}
                  onClick={() => useEditor.getState().setPlacing(c.url)}
                >
                  <PropPreview url={c.url} size={42} />
                  <span style={swatchLabel}>{c.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          borderTop: "1px solid #2a313d",
          paddingTop: 8,
        }}
      >
        <div
          style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "space-between" }}
        >
          <span style={{ color: "#8b93a3" }}>{propsArr.length} props</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" style={btn()} onClick={onExport} title="Copy JSON to clipboard">
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              type="button"
              style={btn()}
              onClick={onDownload}
              title={`Download mz-level-${levelId}.json`}
            >
              Download
            </button>
            <button
              type="button"
              style={btn()}
              onClick={onDownloadAll}
              title="Download every level's edits in one file"
            >
              Download all
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button
            type="button"
            style={{ ...btn(), borderColor: "#7a3a3a", background: "#3a1c1c" }}
            onClick={() => useEditor.getState().clearLevel()}
            title={`Clear hand-placed props on L${levelId}`}
          >
            Clear level
          </button>
          <button
            type="button"
            style={{ ...btn(), borderColor: "#7a3a3a", background: "#3a1c1c" }}
            onClick={onClearAll}
            title="Wipe authored props on EVERY level (irreversible)"
          >
            Clear all
          </button>
        </div>
      </div>
    </div>
  );
};

// Brush palette: preset buttons grouped by biome, radius/density/spacing
// sliders, and a per-preset url filter (checkbox list of every variant in
// the active preset). Active preset is highlighted; tapping it again
// disarms brush mode. Shared layout with WorldMapEditorPanel — re-declared
// per panel to keep each editor's store binding explicit at the call site.
type BrushSnapshot = {
  active: boolean;
  presetId: string | null;
  radius: number;
  density: number;
  minSpacing: number;
  customUrls: string[] | null;
};

const sliderRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "70px 1fr 36px",
  alignItems: "center",
  gap: 6,
};

// Group built-in presets by biome (undefined → "any"). Memo-free since the
// preset list is a module-level const.
const PRESET_GROUPS: { biome: Biome | "any"; label: string; presets: BrushPreset[] }[] = [
  {
    biome: "any",
    label: "Any biome",
    presets: BUILTIN_BRUSH_PRESETS.filter((p) => p.biome === undefined),
  },
  ...BIOME_ORDER.map((biome) => ({
    biome,
    label: BIOME_LABEL[biome],
    presets: BUILTIN_BRUSH_PRESETS.filter((p) => p.biome === biome),
  })).filter((g) => g.presets.length > 0),
];

const BrushSection = ({ brush }: { brush: BrushSnapshot }) => {
  const setBrushPreset = useEditor((s) => s.setBrushPreset);
  const setBrushParams = useEditor((s) => s.setBrushParams);
  const toggleBrushUrl = useEditor((s) => s.toggleBrushUrl);
  const resetBrushUrls = useEditor((s) => s.resetBrushUrls);
  const activePreset = getBrushPreset(brush.presetId);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 8,
        background: brush.active ? "#142036" : "#11151d",
        border: `1px solid ${brush.active ? "#3a6aa0" : "#2a313d"}`,
        borderRadius: 6,
      }}
    >
      <div
        style={{
          color: "#8b93a3",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          fontSize: 10,
        }}
      >
        Brush
      </div>
      {PRESET_GROUPS.map((group) => (
        <div key={group.biome} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ color: "#8b93a3", fontSize: 10 }}>{group.label}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {group.presets.map((p) => {
              const empty = p.urls.length === 0;
              const on = brush.active && brush.presetId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  title={
                    empty ? `${p.label} (no assets)` : `${p.label} · ${p.urls.length} variants`
                  }
                  disabled={empty}
                  style={{ ...btn(on), opacity: empty ? 0.4 : 1 }}
                  onClick={() => setBrushPreset(p.id)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div style={sliderRow}>
        <span style={{ color: "#8b93a3" }}>Radius</span>
        <input
          type="range"
          min={1}
          max={12}
          step={0.5}
          value={brush.radius}
          onChange={(e) => setBrushParams({ radius: Number(e.target.value) })}
        />
        <span>{brush.radius.toFixed(1)}</span>
      </div>
      <div style={sliderRow}>
        <span style={{ color: "#8b93a3" }}>Density</span>
        <input
          type="range"
          min={1}
          max={30}
          step={1}
          value={brush.density}
          onChange={(e) => setBrushParams({ density: Number(e.target.value) })}
        />
        <span>{brush.density}</span>
      </div>
      <div style={sliderRow}>
        <span style={{ color: "#8b93a3" }}>Spacing</span>
        <input
          type="range"
          min={0.3}
          max={3}
          step={0.1}
          value={brush.minSpacing}
          onChange={(e) => setBrushParams({ minSpacing: Number(e.target.value) })}
        />
        <span>{brush.minSpacing.toFixed(1)}</span>
      </div>
      {activePreset && (
        <BrushVariants
          preset={activePreset}
          customUrls={brush.customUrls}
          onToggle={toggleBrushUrl}
          onReset={resetBrushUrls}
        />
      )}
    </div>
  );
};

// Collapsible checkbox list of every url in the active preset. Default =
// all-on (customUrls === null); the user unticks variants to narrow the
// brush. "Reset" clears the filter back to all-on. Persists open/closed
// state per panel via local React state so re-renders during paint don't
// snap it shut.
const BrushVariants = ({
  preset,
  customUrls,
  onToggle,
  onReset,
}: {
  preset: BrushPreset;
  customUrls: string[] | null;
  onToggle: (url: string) => void;
  onReset: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const enabled = useMemo(() => new Set(customUrls ?? preset.urls), [customUrls, preset]);
  const filtered = customUrls !== null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          style={{ ...btn(), padding: "3px 7px", fontSize: 11, flex: 1, textAlign: "left" }}
          onClick={() => setOpen((s) => !s)}
          title="Toggle which variants the brush draws from"
        >
          {open ? "▾" : "▸"} Variants ({enabled.size}/{preset.urls.length})
          {filtered ? " · filtered" : ""}
        </button>
        {filtered && (
          <button
            type="button"
            style={{ ...btn(), padding: "3px 7px", fontSize: 11 }}
            onClick={onReset}
            title="Re-enable every variant"
          >
            Reset
          </button>
        )}
      </div>
      {open && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
            gap: 4,
            maxHeight: 220,
            overflowY: "auto",
            padding: 4,
            background: "#0d1118",
            border: "1px solid #2a313d",
            borderRadius: 4,
          }}
        >
          {preset.urls.map((url) => {
            const on = enabled.has(url);
            return (
              <button
                key={url}
                type="button"
                style={{
                  ...swatchBtn(on),
                  width: "auto",
                  opacity: on ? 1 : 0.45,
                }}
                onClick={() => onToggle(url)}
                title={`${labelFor(url)}\n${url}`}
              >
                <PropPreview url={url} size={42} />
                <span style={swatchLabel}>{labelFor(url)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
