import { type ReactElement, useEffect, useMemo, useState } from "react";
import type { Biome, PropRole } from "../biomes";
import type { River } from "../sim/types";
import { useBackNavigation } from "../ui/useBackNavigation";
import { buildCatalog, type CatalogEntry, labelFor, ROLE_LABEL, ROLE_ORDER } from "./assetCatalog";
import {
  BIOME_LABEL,
  BIOME_ORDER,
  type BrushPreset,
  BUILTIN_BRUSH_PRESETS,
  getBrushPreset,
} from "./brush";
import {
  type BrushState,
  type EditorStore,
  RIVER_MATERIALS,
  type RiverToolState,
} from "./editorCore";
import { PropPreview } from "./PropPreview";
import {
  btn,
  dangerBtn,
  fab,
  PencilIcon,
  panel,
  sliderRow,
  swatchBtn,
  swatchLabel,
} from "./panelStyles";

// Shared dev-only editor side-panel. Mounted in App.tsx behind
// import.meta.env.DEV by two thin wrappers (LevelEditorPanel /
// WorldMapEditorPanel) that hand it a store + labels + per-editor footer
// button config. The whole panel surface — undo/redo header, optional
// override toggle, brush palette + variants + sliders, river tool controls,
// per-selection transforms, asset palette with preview swatches,
// copy/download/clear footer, plus the Esc/Delete/Ctrl+Z keyboard handler —
// is driven off the store's EditorStoreApi, so both editors share one UX.

// Footer button cluster — each editor declares its own export targets
// (clipboard/download/download-all) and clear targets (clear-scope/clear-all).
export type FooterButton = {
  label: string;
  title?: string;
  onClick: () => void;
};

export type EditorPanelProps = {
  store: EditorStore;
  title: string;
  fabLabel: string;
  fabTitle: string;
  showOverride?: boolean;
  // Override checkbox value source. Level editor reads from useGame
  // (survives reloadLevel); world map would read getCurrent().override.
  // Only consulted when showOverride is true.
  override?: boolean;
  exportButtons: FooterButton[];
  clearButtons: FooterButton[];
  // Optional copy button — toggles to "Copied!" briefly after clipboard write.
  copyButton?: { title?: string; logExport: (json: string) => void };
};

// Group built-in presets by biome (undefined → "any"). Module-level since
// the preset list is itself a module-level const.
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

export const EditorPanel = ({
  store,
  title,
  fabLabel,
  fabTitle,
  showOverride = false,
  override,
  exportButtons,
  clearButtons,
  copyButton,
}: EditorPanelProps): ReactElement => {
  const active = store((s) => s.active);
  const placingUrl = store((s) => s.placingUrl);
  const selectedId = store((s) => s.selectedId);
  const moving = store((s) => s.moving);
  const brush = store((s) => s.brush);
  const riverTool = store((s) => s.riverTool);
  const version = store((s) => s.version);
  const toggleActive = store((s) => s.toggleActive);
  const history = store((s) => s.history);
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  // Browser/OS back gesture closes the editor — same behavior as the panel
  // close button. Re-uses the existing in-app navigation stack.
  useBackNavigation(active, () => {
    store.setState({
      active: false,
      placingUrl: null,
      selectedId: null,
      moving: false,
    });
  });

  void version;
  const { props: propsArr, rivers: riversArr } = store.getState().getCurrent();
  const selected = selectedId !== null ? (propsArr.find((p) => p.id === selectedId) ?? null) : null;
  const selectedRiver =
    riverTool.selectedRiverId !== null
      ? (riversArr.find((r) => r.id === riverTool.selectedRiverId) ?? null)
      : null;
  const editingRiver =
    riverTool.editingRiverId !== null
      ? (riversArr.find((r) => r.id === riverTool.editingRiverId) ?? null)
      : null;

  // Keyboard: Esc steps back (disarm → deselect → close); Delete removes;
  // Ctrl/Meta+Z undoes, Ctrl+Shift+Z / Ctrl+Y redoes. Skip undo/redo
  // shortcuts when typing in an input/textarea so native field undo wins.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const ed = store.getState();
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
  }, [active, store]);

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
      <button type="button" style={fab} onClick={toggleActive} title={fabTitle}>
        <PencilIcon />
        {fabLabel}
      </button>
    );
  }

  const onCopy = () => {
    if (!copyButton) return;
    const json = store.getState().exportJson();
    void navigator.clipboard?.writeText(json).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
    copyButton.logExport(json);
  };

  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            style={{ ...btn(), opacity: canUndo ? 1 : 0.4 }}
            disabled={!canUndo}
            onClick={() => store.getState().undo()}
            title="Undo (Ctrl/Cmd+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            style={{ ...btn(), opacity: canRedo ? 1 : 0.4 }}
            disabled={!canRedo}
            onClick={() => store.getState().redo()}
            title="Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)"
          >
            Redo
          </button>
          <button type="button" style={btn()} onClick={toggleActive}>
            Close
          </button>
        </div>
      </div>

      {showOverride && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={override ?? false}
            onChange={(e) => store.getState().setOverride(e.target.checked)}
          />
          Clear procedural placement
          <span style={{ color: "#8b93a3" }}>(reloads)</span>
        </label>
      )}

      <BrushSection store={store} brush={brush} />

      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          style={btn(riverTool.active)}
          onClick={() => store.getState().setRiverToolActive(!riverTool.active)}
          title="River-painting tool — click the map to drop spline control points"
        >
          {riverTool.active ? "River ✓" : "River"}
        </button>
        {riverTool.active && riverTool.editingRiverId !== null && (
          <button
            type="button"
            style={btn()}
            onClick={() => store.getState().finishRiver()}
            title="Finish the current river (close stroke; further clicks start a new river)"
          >
            Finish river
          </button>
        )}
      </div>

      {riverTool.active && (
        <RiverControls
          store={store}
          tool={riverTool}
          editingRiver={editingRiver}
          selectedRiver={selectedRiver}
        />
      )}

      {brush.active ? (
        <div style={{ color: "#8b93a3" }}>
          {brush.eraser
            ? "Eraser active — click-drag the map to remove props in radius. Tap Eraser again to disarm."
            : "Brush active — click-drag the map to scatter. Tap the preset again to disarm."}
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
            <button type="button" style={btn(moving)} onClick={() => store.getState().beginMove()}>
              {moving ? "Click map…" : "Move"}
            </button>
            <button
              type="button"
              style={dangerBtn}
              onClick={() => store.getState().deleteSelected()}
            >
              Delete
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              style={btn()}
              onClick={() => store.getState().rotateSelected(-Math.PI / 12)}
            >
              Rotate ⟲
            </button>
            <button
              type="button"
              style={btn()}
              onClick={() => store.getState().rotateSelected(Math.PI / 12)}
            >
              Rotate ⟳
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              style={btn()}
              onClick={() => store.getState().scaleSelected(1 / 1.15)}
            >
              Scale −
            </button>
            <button
              type="button"
              style={btn()}
              onClick={() => store.getState().scaleSelected(1.15)}
            >
              Scale +
            </button>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={selected.blocks}
              onChange={() => store.getState().toggleSelectedBlocks()}
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
          minHeight: 0,
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
                  onClick={() => store.getState().setPlacing(c.url)}
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
          <span style={{ color: "#8b93a3" }}>
            {propsArr.length} props · {riversArr.length} rivers
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            {copyButton && (
              <button
                type="button"
                style={btn()}
                onClick={onCopy}
                title={copyButton.title ?? "Copy JSON to clipboard"}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            )}
            {exportButtons.map((b) => (
              <button key={b.label} type="button" style={btn()} onClick={b.onClick} title={b.title}>
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          {clearButtons.map((b) => (
            <button
              key={b.label}
              type="button"
              style={dangerBtn}
              onClick={b.onClick}
              title={b.title}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// Brush palette: preset buttons grouped by biome, radius/density/spacing
// sliders, and a per-preset url filter (checkbox list of every variant in
// the active preset).
const BrushSection = ({ store, brush }: { store: EditorStore; brush: BrushState }) => {
  const setBrushPreset = store((s) => s.setBrushPreset);
  const setBrushEraser = store((s) => s.setBrushEraser);
  const setBrushParams = store((s) => s.setBrushParams);
  const toggleBrushUrl = store((s) => s.toggleBrushUrl);
  const resetBrushUrls = store((s) => s.resetBrushUrls);
  const activePreset = getBrushPreset(brush.presetId);
  const eraserOn = brush.active && brush.eraser;
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
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
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
        <button
          type="button"
          style={btn(eraserOn)}
          onClick={() => setBrushEraser(!eraserOn)}
          title="Eraser — click-drag the map to remove props within radius"
        >
          {eraserOn ? "Eraser ✓" : "Eraser"}
        </button>
      </div>
      {!eraserOn &&
        PRESET_GROUPS.map((group) => (
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
      {!eraserOn && (
        <>
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
        </>
      )}
    </div>
  );
};

// Collapsible checkbox list of every url in the active preset. Default =
// all-on (customUrls === null); the user unticks variants to narrow the
// brush. "Reset" clears the filter back to all-on.
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

// River-tool control panel. Renders inside the EditorPanel when the tool is
// active. Width slider drives the in-progress or selected river; delete-river
// is the explicit destroy. Per-point delete lives on the editor sphere
// overlay (shift-click).
const RiverControls = ({
  store,
  tool,
  editingRiver,
  selectedRiver,
}: {
  store: EditorStore;
  tool: RiverToolState;
  editingRiver: River | null;
  selectedRiver: River | null;
}) => {
  // editingRiver has priority — while the user is mid-stroke, the slider
  // should affect that river, not whatever was previously selected.
  const target = editingRiver ?? selectedRiver;
  const targetWidth = target?.width ?? tool.width;
  const targetMaterial = target?.material ?? tool.material;
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
          onChange={(e) => store.getState().setRiverWidth(Number(e.target.value))}
          style={{ flex: 1 }}
        />
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "#8b93a3", minWidth: 40 }}>Material</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {RIVER_MATERIALS.map((m) => (
            <button
              key={m.id}
              type="button"
              style={btn(targetMaterial === m.id)}
              onClick={() => store.getState().setRiverMaterial(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
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
          style={dangerBtn}
          onClick={() => store.getState().deleteRiver(selectedRiver.id)}
        >
          Delete river
        </button>
      )}
    </div>
  );
};
