import { type ReactElement, useEffect, useMemo, useState } from "react";
import type { Biome, PropRole } from "../biomes";
import { EASTER_EGG_BY_ID, EASTER_EGG_DEFS, type EasterEggDef } from "../easterEggs";
import type { River } from "../sim/types";
import { useBackNavigation } from "../ui/useBackNavigation";
import {
  buildCatalog,
  buildStampEntries,
  type CatalogEntry,
  labelFor,
  ROLE_LABEL,
  ROLE_ORDER,
} from "./assetCatalog";
import {
  BIOME_LABEL,
  BIOME_ORDER,
  type BrushPreset,
  BUILTIN_BRUSH_PRESETS,
  getBrushPreset,
} from "./brush";
import {
  type BrushState,
  type EasterEggToolState,
  type EditorStore,
  RIVER_MATERIALS,
  type RiverToolState,
} from "./editorCore";
import { PropPreview } from "./PropPreview";
import {
  btn,
  dangerBtn,
  fab,
  miniPanel,
  PencilIcon,
  panel,
  sliderRow,
  swatchBtn,
  swatchLabel,
} from "./panelStyles";
import { StampPreview } from "./StampPreview";
import { loadStampLibrary } from "./stampLibrary";

// Shared dev-only editor side-panel. Mounted in App.tsx behind
// import.meta.env.DEV by two thin wrappers (LevelEditorPanel /
// WorldMapEditorPanel) that hand it a store + labels + per-editor footer
// button config. The whole panel surface — undo/redo header, brush palette
// + variants + sliders, river tool controls, per-selection transforms,
// asset palette with preview swatches, copy/download/clear footer, plus
// the Esc/Delete/Ctrl+Z keyboard handler — is driven off the store's
// EditorStoreApi, so both editors share one UX.

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
  exportButtons: FooterButton[];
  clearButtons: FooterButton[];
  // Optional copy button — toggles to "Copied!" briefly after clipboard write.
  copyButton?: { title?: string; logExport: (json: string) => void };
  // When set, the asset palette + brush preset list default to this biome's
  // roster. Users can override per-session via the "All biomes" toggle. Pass
  // null to disable filtering entirely (world-map editor — it spans every
  // biome band, so there's no single "current" biome to filter on).
  biomeFilter?: Biome | null;
};

type PresetGroup = { biome: Biome | "any"; label: string; presets: BrushPreset[] };

// Group built-in presets by biome (undefined → "any"). Module-level since
// the preset list is itself a module-level const. The runtime filter below
// trims this down to the active biome's group (+ cross-biome) when the
// editor passes a biomeFilter.
const ALL_PRESET_GROUPS: PresetGroup[] = [
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

const ROLE_ICON: Record<PropRole, string> = {
  building: "HQ",
  tree: "TR",
  bush: "BU",
  rock: "RK",
  grass: "GR",
  cosmetic: "FX",
};

const shortModelLabel = (url: string): string => {
  const compact = labelFor(url).replace(/[^a-z0-9]/gi, "");
  return compact.slice(0, 3).toUpperCase();
};

export const EditorPanel = ({
  store,
  title,
  fabLabel,
  fabTitle,
  exportButtons,
  clearButtons,
  copyButton,
  biomeFilter = null,
}: EditorPanelProps): ReactElement => {
  const active = store((s) => s.active);
  const panelCollapsed = store((s) => s.panelCollapsed);
  const chromeHidden = store((s) => s.chromeHidden);
  const placingUrl = store((s) => s.placingUrl);
  const selectedIds = store((s) => s.selectedIds);
  const selectedId = store((s) => s.selectedId);
  const selectionSize = selectedIds.size;
  const moving = store((s) => s.moving);
  const brush = store((s) => s.brush);
  const riverTool = store((s) => s.riverTool);
  const easterEggTool = store((s) => s.easterEggTool);
  const marqueeActive = store((s) => s.marqueeTool.active);
  const placingStampId = store((s) => s.placingStampId);
  const version = store((s) => s.version);
  const stampLibraryVersion = store((s) => s.stampLibraryVersion);
  const toggleActive = store((s) => s.toggleActive);
  const setPanelCollapsed = store((s) => s.setPanelCollapsed);
  const setChromeHidden = store((s) => s.setChromeHidden);
  const history = store((s) => s.history);
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;
  const clearAllButton = clearButtons.find((b) => b.label.toLowerCase() === "clear all");

  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  // When biomeFilter is set, the asset palette + brush presets default to
  // that biome's roster. The "All biomes" toggle escapes back to the full
  // cross-biome list per session (state is component-local — it resets on
  // editor close so a fresh open re-locks to the current biome).
  const [showAllBiomes, setShowAllBiomes] = useState(false);
  const effectiveBiome: Biome | null = biomeFilter && !showAllBiomes ? biomeFilter : null;

  // Browser/OS back gesture closes the editor — same behavior as the panel
  // close button. Re-uses the existing in-app navigation stack.
  useBackNavigation(active, () => {
    store.getState().toggleActive();
  });

  void version;
  const { props: propsArr, rivers: riversArr, bridges: bridgesArr } = store.getState().getCurrent();
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
  // Ctrl/Meta+Z undoes, Ctrl+Shift+Z / Ctrl+Y redoes. Q/R rotate the selected
  // prop — tap = small step, hold = continuous rotation (rAF-driven so the
  // speed doesn't depend on OS auto-repeat rate). A held rotation collapses
  // into one undo entry via the rotateStroke gate. Skip undo/redo shortcuts
  // when typing in an input/textarea so native field undo wins.
  useEffect(() => {
    if (!active) return;
    const ROTATE_TAP = Math.PI / 24; // 7.5° per tap
    const ROTATE_HOLD_RATE = Math.PI; // 180°/sec while held
    const held: { q: boolean; r: boolean } = { q: false, r: false };
    let raf: number | null = null;
    let lastT = 0;
    let strokeOpen = false;

    const stopHold = () => {
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      if (strokeOpen) {
        store.getState().endRotateStroke();
        strokeOpen = false;
      }
    };

    const tick = (now: number) => {
      raf = null;
      const ed = store.getState();
      if (ed.selectedId === null) {
        stopHold();
        return;
      }
      const dt = (now - lastT) / 1000;
      lastT = now;
      const dir = (held.q ? -1 : 0) + (held.r ? 1 : 0);
      if (dir === 0) {
        stopHold();
        return;
      }
      ed.rotateSelected(dir * ROTATE_HOLD_RATE * dt);
      raf = requestAnimationFrame(tick);
    };

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
      if (!inField && !mod && (e.key === "q" || e.key === "Q" || e.key === "r" || e.key === "R")) {
        if (ed.selectedId === null) return;
        e.preventDefault();
        // Browser auto-repeat is ignored — rAF drives the hold rotation at a
        // stable rate. The initial press still applies one tap step.
        if (e.repeat) return;
        const key = e.key.toLowerCase() as "q" | "r";
        if (!strokeOpen) {
          ed.beginRotateStroke();
          strokeOpen = true;
        }
        held[key] = true;
        ed.rotateSelected((key === "q" ? -1 : 1) * ROTATE_TAP);
        if (raf === null) {
          lastT = performance.now();
          raf = requestAnimationFrame(tick);
        }
        return;
      }
      if (e.key === "Escape") {
        // Step back through armed tools first, then selection, then close.
        // Stamp paste sits ahead of placingUrl because both are "armed click
        // tools" but the stamp arm is the more recently introduced surface
        // and feels closer to the user's intent (just-clicked-a-swatch).
        if (ed.placingStampId) ed.setPlacingStamp(null);
        else if (ed.placingUrl) ed.setPlacing(ed.placingUrl);
        else if (ed.marqueeTool.active) ed.setMarqueeActive(false);
        else if (ed.selectedIds.size > 0) ed.clearSelection();
        else ed.toggleActive();
      } else if ((e.key === "Delete" || e.key === "Backspace") && ed.selectedIds.size > 0) {
        e.preventDefault();
        // deleteSelection covers both single- and multi-id cases as one
        // undo entry; deleteSelected stays around for the single-prop card.
        ed.deleteSelection();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "q" || k === "r") {
        held[k] = false;
        if (!held.q && !held.r) stopHold();
      }
    };

    const onBlur = () => {
      held.q = false;
      held.r = false;
      stopHold();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      stopHold();
    };
  }, [active, store]);

  const catalog = useMemo(() => buildCatalog(effectiveBiome ?? undefined), [effectiveBiome]);

  const presetGroups = useMemo<PresetGroup[]>(
    () =>
      effectiveBiome
        ? ALL_PRESET_GROUPS.filter((g) => g.biome === "any" || g.biome === effectiveBiome)
        : ALL_PRESET_GROUPS,
    [effectiveBiome],
  );

  // Stamp entries are merged in here (not into the base catalog) so stamps
  // can be re-derived without rebuilding the atomic-model catalog. The
  // explicit dep on stampLibraryVersion invalidates this memo whenever the
  // store bumps the counter (save/delete), so the palette reflects library
  // changes immediately. localStorage reads stay lazy — buildStampEntries
  // runs only when this memo recomputes. The `void` reads the counter so
  // the dep isn't flagged as "more than necessary" — the closure itself
  // doesn't reference it (the source of truth is localStorage), but the
  // counter is the invalidation signal.
  const stampEntries = useMemo(() => {
    void stampLibraryVersion;
    return buildStampEntries(loadStampLibrary().stamps);
  }, [stampLibraryVersion]);

  // Resolve the armed stamp's catalog entry off the same derived list so the
  // status label and ghost preview share one source of truth. Null when no
  // stamp is armed (or the armed id no longer matches any library entry,
  // e.g. mid-deletion).
  const placingStamp =
    placingStampId !== null
      ? (stampEntries.find((e) => e.kind === "stamp" && e.stampId === placingStampId) ?? null)
      : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const combined: CatalogEntry[] = [...catalog, ...stampEntries];
    const items = q ? combined.filter((c) => c.label.toLowerCase().includes(q)) : combined;
    const byRole = new Map<PropRole, CatalogEntry[]>();
    for (const c of items) {
      const list = byRole.get(c.role) ?? [];
      list.push(c);
      byRole.set(c.role, list);
    }
    return ROLE_ORDER.filter((r) => byRole.has(r)).map((r) => [r, byRole.get(r)!] as const);
  }, [query, catalog, stampEntries]);

  if (!active) {
    return (
      <button type="button" style={fab} onClick={toggleActive} title={fabTitle}>
        <PencilIcon />
        {fabLabel}
      </button>
    );
  }

  const statusLabel = brush.active
    ? brush.eraser
      ? "Eraser"
      : `Brush${brush.presetId ? ` · ${getBrushPreset(brush.presetId)?.label ?? brush.presetId}` : ""}`
    : riverTool.active
      ? riverTool.editingRiverId
        ? "River · drawing"
        : riverTool.selectedRiverId
          ? "River · selected"
          : "River"
      : placingStamp && placingStamp.kind === "stamp"
        ? `Stamping · ${placingStamp.label} (×${placingStamp.childCount})`
        : marqueeActive
          ? selectionSize > 0
            ? `Marquee · ${selectionSize} selected`
            : "Marquee"
          : moving
            ? selectionSize > 1
              ? `Move ${selectionSize} props · click target centroid`
              : "Move prop"
            : placingUrl
              ? `Placing · ${labelFor(placingUrl)}`
              : selectionSize > 1
                ? `${selectionSize} props selected`
                : selected
                  ? "Prop selected"
                  : selectedRiver
                    ? "River selected"
                    : "Select";

  const toggleUiLabel = chromeHidden ? "Show UI" : "Hide UI";

  if (panelCollapsed) {
    return (
      <div style={miniPanel} onPointerDownCapture={(e) => e.stopPropagation()}>
        <button
          type="button"
          style={btn()}
          onClick={() => setPanelCollapsed(false)}
          title="Show the editor panel"
        >
          Show Panel
        </button>
        <span
          style={{
            minWidth: 0,
            maxWidth: 180,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "#aeb7c6",
          }}
          title={statusLabel}
        >
          {statusLabel}
        </span>
        <button
          type="button"
          style={btn(chromeHidden)}
          onClick={() => setChromeHidden(!chromeHidden)}
          title={`${toggleUiLabel} while editing`}
        >
          {toggleUiLabel}
        </button>
        <button type="button" style={dangerBtn} onClick={toggleActive} title="Exit editor">
          Exit
        </button>
      </div>
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

  // Prompt the user for a label and save the current selection as a stamp.
  // Cancel / empty input is a no-op (the store-side action also no-ops on
  // empty trim, but the early return avoids a flashed "Saved" feeling for
  // a cancelled dialog). Stamps don't go through undo — see editorCore's
  // saveSelectionAsStamp comment for the rationale.
  const onSaveAsStamp = () => {
    const ed = store.getState();
    if (ed.selectedIds.size === 0) return;
    const defaultLabel = `Stamp ${ed.selectedIds.size}`;
    const label = window.prompt("Stamp name:", defaultLabel);
    if (label === null) return;
    const trimmed = label.trim();
    if (trimmed.length === 0) return;
    ed.saveSelectionAsStamp(trimmed);
  };

  // Confirm + delete a stamp from the library. Right-click on a palette
  // swatch fires this. Stamps don't go through undo, so the destructive
  // confirm matters more than for in-map mutations.
  const onDeleteStamp = (stampId: string, label: string) => {
    if (!window.confirm(`Delete stamp "${label}"?`)) return;
    store.getState().deleteStamp(stampId);
  };

  return (
    // Stop pointerdown at the panel root so panel clicks don't bubble to the
    // canvas-level OrbitControls drag gate (which listens at document level)
    // and don't get mistaken for a deselect on the editor click plane.
    <div style={panel} onPointerDownCapture={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: "block", fontSize: 13 }}>{title}</strong>
            <span
              style={{
                display: "block",
                color: "#8b93a3",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={statusLabel}
            >
              {statusLabel}
            </span>
          </div>
          <button type="button" style={dangerBtn} onClick={toggleActive} title="Exit editor">
            Exit
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
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
          <button
            type="button"
            style={btn()}
            onClick={() => setPanelCollapsed(true)}
            title="Hide this panel without leaving editor mode"
          >
            Hide Panel
          </button>
          <button
            type="button"
            style={btn(chromeHidden)}
            onClick={() => setChromeHidden(!chromeHidden)}
            title={`${toggleUiLabel} while editing`}
          >
            {toggleUiLabel}
          </button>
          {clearAllButton && (
            <button
              type="button"
              style={dangerBtn}
              onClick={clearAllButton.onClick}
              title={clearAllButton.title}
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      <BrushSection store={store} brush={brush} presetGroups={presetGroups} />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          style={btn(riverTool.active)}
          onClick={() => store.getState().setRiverToolActive(!riverTool.active)}
          title="River-painting tool — click the map to drop spline control points"
        >
          {riverTool.active ? "River ✓" : "River"}
        </button>
        <button
          type="button"
          style={btn(marqueeActive)}
          onClick={() => store.getState().setMarqueeActive(!marqueeActive)}
          title="Marquee — drag a rectangle on empty ground to select every prop inside. Shift on release adds to existing selection."
        >
          {marqueeActive ? "Marquee ✓" : "Marquee"}
        </button>
        {riverTool.active && riverTool.editingRiverId !== null && (
          <button
            type="button"
            style={btn()}
            onClick={() => store.getState().finishRiver()}
            title="Finish the current river — start and end snap to the nearest map edge"
          >
            Finish river
          </button>
        )}
        {biomeFilter && (
          <button
            type="button"
            style={btn(easterEggTool.active)}
            onClick={() => store.getState().setEasterEggToolActive(!easterEggTool.active)}
            title="Easter-egg placement — choose an egg type and click the map to drop it. Direction arrows show heading for moving eggs."
          >
            {easterEggTool.active ? "Egg ✓" : "Egg"}
          </button>
        )}
      </div>

      {riverTool.active && (
        <RiverControls
          store={store}
          tool={riverTool}
          editingRiver={editingRiver}
          selectedRiver={selectedRiver}
          bridgeCount={bridgesArr.length}
        />
      )}

      {easterEggTool.active && biomeFilter && (
        <EasterEggSection store={store} tool={easterEggTool} biome={biomeFilter} />
      )}

      {brush.active ? (
        <div style={{ color: "#8b93a3" }}>
          {brush.eraser
            ? "Eraser active — click-drag the map to remove props in radius. Tap Eraser again to disarm."
            : "Brush active — click-drag the map to scatter. Tap the preset again to disarm."}
        </div>
      ) : selectionSize > 1 ? (
        (() => {
          // Derive group state from the live props array. "Single group" =
          // every selected member shares the same defined groupId. That's
          // the only state where Ungroup is the natural action and Group
          // would be a no-op rebind. Mixed / partial / ungrouped → Group is
          // the natural action (it unifies into one fresh groupId).
          const selectedPropsList = propsArr.filter((p) => selectedIds.has(p.id));
          const firstGroupId = selectedPropsList[0]?.groupId;
          const allSameGroup =
            firstGroupId !== undefined &&
            selectedPropsList.every((p) => p.groupId === firstGroupId);
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
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span style={{ fontWeight: 600 }}>
                  {allSameGroup ? `Grouped (${selectionSize})` : `${selectionSize} props selected`}
                </span>
                <span style={{ color: "#8b93a3" }}>Shift-click to add/remove</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={btn(moving)}
                  onClick={() => store.getState().beginMove()}
                  title="Move — click the map to relocate the cluster's centroid there; relative layout is preserved"
                >
                  {moving ? "Click map…" : "Move"}
                </button>
                <button
                  type="button"
                  style={dangerBtn}
                  onClick={() => store.getState().deleteSelection()}
                  title="Delete every selected prop as one undo entry"
                >
                  Delete
                </button>
                {allSameGroup ? (
                  <button
                    type="button"
                    style={btn()}
                    onClick={() => store.getState().ungroupSelection()}
                    title="Clear groupId on every selected prop — single-click no longer expands to the group"
                  >
                    Ungroup
                  </button>
                ) : (
                  <button
                    type="button"
                    style={btn()}
                    onClick={() => store.getState().groupSelection()}
                    title="Bind every selected prop with a shared groupId — clicking any member will select the whole group"
                  >
                    Group
                  </button>
                )}
                <button
                  type="button"
                  style={btn()}
                  onClick={onSaveAsStamp}
                  title="Save the selection to the global stamp library — re-droppable from the palette. Right-click a stamp swatch to delete it."
                >
                  Save as stamp
                </button>
                <button
                  type="button"
                  style={btn()}
                  onClick={() => store.getState().clearSelection()}
                  title="Clear selection (Esc)"
                >
                  Clear
                </button>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={btn()}
                  onClick={() => store.getState().rotateSelectionAroundCentroid(-Math.PI / 12)}
                  title="Rotate the cluster 15° counter-clockwise around its centroid"
                >
                  Rotate ⟲
                </button>
                <button
                  type="button"
                  style={btn()}
                  onClick={() => store.getState().rotateSelectionAroundCentroid(Math.PI / 12)}
                  title="Rotate the cluster 15° clockwise around its centroid"
                >
                  Rotate ⟳
                </button>
                <button
                  type="button"
                  style={btn()}
                  onClick={() => store.getState().scaleSelectionAroundCentroid(1 / 1.15)}
                  title="Shrink the cluster toward its centroid by 15%"
                >
                  Scale −
                </button>
                <button
                  type="button"
                  style={btn()}
                  onClick={() => store.getState().scaleSelectionAroundCentroid(1.15)}
                  title="Grow the cluster away from its centroid by 15%"
                >
                  Scale +
                </button>
              </div>
            </div>
          );
        })()
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
              title="Rotate counter-clockwise (or hold Q)"
            >
              Rotate ⟲
            </button>
            <button
              type="button"
              style={btn()}
              onClick={() => store.getState().rotateSelected(Math.PI / 12)}
              title="Rotate clockwise (or hold R)"
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
          {selected.groupId !== undefined && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ color: "#8b93a3", fontSize: 11, flex: 1 }}>
                In a group — single-click expands to all members.
              </span>
              <button
                type="button"
                style={btn()}
                onClick={() => store.getState().ungroupSelection()}
                title="Clear groupId on this prop (and any other selected members)"
              >
                Ungroup
              </button>
            </div>
          )}
          <button
            type="button"
            style={btn()}
            onClick={onSaveAsStamp}
            title="Save this prop to the global stamp library — useful for re-using a tweaked rot/scale variant. Right-click a stamp swatch to delete it."
          >
            Save as stamp
          </button>
        </div>
      ) : (
        <div style={{ color: "#8b93a3" }}>
          {placingStamp && placingStamp.kind === "stamp"
            ? `Stamping ${placingStamp.label} (${placingStamp.childCount} props) — click map to drop centred on the cursor. Click swatch again or Esc to disarm.`
            : placingUrl
              ? `Placing ${labelFor(placingUrl)} — click map to drop. Click asset again or Esc to stop.`
              : marqueeActive
                ? "Marquee armed — drag the map to select props in a rectangle. Hold Shift on release to add to the current selection. Esc disarms."
                : "Pick an asset to place, or click a placed prop to select it."}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Search assets…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: 1,
            padding: "5px 7px",
            borderRadius: 5,
            border: "1px solid #3a4150",
            background: "#11151d",
            color: "#e6e9ef",
            opacity: brush.active ? 0.5 : 1,
          }}
        />
        {biomeFilter && (
          <button
            type="button"
            style={btn(showAllBiomes)}
            onClick={() => setShowAllBiomes((s) => !s)}
            title={
              showAllBiomes
                ? `Show only ${BIOME_LABEL[biomeFilter]} assets + brushes`
                : `Show every biome's assets + brushes (currently ${BIOME_LABEL[biomeFilter]} only)`
            }
          >
            {showAllBiomes ? "All biomes ✓" : `${BIOME_LABEL[biomeFilter]} only`}
          </button>
        )}
      </div>

      <div
        style={{
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
              {items.map((c) =>
                c.kind === "model" ? (
                  <button
                    key={`model:${c.url}`}
                    type="button"
                    title={`${c.label}\n${c.url}`}
                    style={swatchBtn(placingUrl === c.url)}
                    onClick={() => store.getState().setPlacing(c.url)}
                  >
                    <PropPreview url={c.url} size={56} />
                    <span style={swatchLabel}>{c.label}</span>
                  </button>
                ) : (
                  <button
                    key={`stamp:${c.stampId}`}
                    type="button"
                    title={`${c.label} (${c.childCount} props)\nClick to arm — then click the map to drop. Right-click to delete this stamp.`}
                    style={swatchBtn(placingStampId === c.stampId)}
                    onClick={() => store.getState().setPlacingStamp(c.stampId)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onDeleteStamp(c.stampId, c.label);
                    }}
                  >
                    <StampPreview sampleUrls={c.sampleUrls} childCount={c.childCount} size={56} />
                    <span style={swatchLabel}>{c.label}</span>
                  </button>
                ),
              )}
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
const BrushSection = ({
  store,
  brush,
  presetGroups,
}: {
  store: EditorStore;
  brush: BrushState;
  presetGroups: PresetGroup[];
}) => {
  const setBrushPreset = store((s) => s.setBrushPreset);
  const setBrushEraser = store((s) => s.setBrushEraser);
  const setBrushParams = store((s) => s.setBrushParams);
  const toggleBrushUrl = store((s) => s.toggleBrushUrl);
  const resetBrushUrls = store((s) => s.resetBrushUrls);
  const activePreset = getBrushPreset(brush.presetId);
  const eraserOn = brush.active && brush.eraser;
  const [open, setOpen] = useState(true);
  const activeLabel = eraserOn ? "Eraser" : activePreset?.label;
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
        <button
          type="button"
          style={{
            ...btn(),
            display: "inline-flex",
            alignItems: "center",
            flex: 1,
            justifyContent: "space-between",
            padding: "4px 7px",
            textAlign: "left",
            color: "#8b93a3",
            textTransform: "uppercase",
            letterSpacing: 0.5,
            fontSize: 10,
          }}
          onClick={() => setOpen((s) => !s)}
          title="Collapse brush controls"
        >
          <span>{open ? "v" : ">"} Brush</span>
          {activeLabel && <span style={{ color: "#d7deea" }}>{activeLabel}</span>}
        </button>
        {open && (
          <button
            type="button"
            style={btn(eraserOn)}
            onClick={() => setBrushEraser(!eraserOn)}
            title="Eraser — click-drag the map to remove props within radius"
          >
            {eraserOn ? "Eraser ✓" : "Eraser"}
          </button>
        )}
      </div>
      {!open && activeLabel && (
        <div style={{ color: "#8b93a3", fontSize: 11 }}>
          {eraserOn ? "Eraser armed" : `${activeLabel} armed`} · radius {brush.radius.toFixed(1)}
        </div>
      )}
      {open &&
        !eraserOn &&
        presetGroups.map((group) => (
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
                    style={{
                      ...btn(on),
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      minHeight: 34,
                      maxWidth: 124,
                      opacity: empty ? 0.4 : 1,
                    }}
                    onClick={() => setBrushPreset(p.id)}
                  >
                    <span
                      aria-hidden
                      style={{
                        minWidth: 22,
                        height: 22,
                        borderRadius: 4,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: on ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)",
                        color: "#d7deea",
                        fontSize: 9,
                        fontWeight: 800,
                      }}
                    >
                      {p.role ? ROLE_ICON[p.role] : "??"}
                    </span>
                    <span
                      aria-hidden
                      style={{ display: "inline-flex", alignItems: "center", marginLeft: -2 }}
                    >
                      {p.urls.slice(0, 2).map((url) => (
                        <span
                          key={url}
                          style={{
                            position: "relative",
                            width: 22,
                            height: 22,
                            marginLeft: -4,
                            borderRadius: 4,
                            overflow: "hidden",
                            border: "1px solid rgba(255,255,255,0.18)",
                            background: "#0d1118",
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              position: "absolute",
                              inset: 0,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#8b93a3",
                              fontSize: 7,
                              fontWeight: 800,
                              letterSpacing: 0,
                            }}
                          >
                            {shortModelLabel(url)}
                          </span>
                          <PropPreview url={url} size={22} />
                        </span>
                      ))}
                    </span>
                    <span
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      {open && (
        <>
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
            gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
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
                <PropPreview url={url} size={56} />
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
  bridgeCount,
}: {
  store: EditorStore;
  tool: RiverToolState;
  editingRiver: River | null;
  selectedRiver: River | null;
  bridgeCount: number;
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
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#8b93a3" }}>
        <span style={{ minWidth: 40 }}>Bridges</span>
        <span>{bridgeCount}</span>
      </div>
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

// Egg-tool panel. Lists every easter-egg def whose biomes[] includes the
// current level biome (so the forest level only sees forest eggs, etc.),
// plus the placement/select/delete controls for the currently authored
// egg list on this level. Selected egg gets a "Set direction" affordance
// — the next map click writes its rotY from (egg.pos → click) heading.
const EasterEggSection = ({
  store,
  tool,
  biome,
}: {
  store: EditorStore;
  tool: EasterEggToolState;
  biome: Biome;
}) => {
  // Subscribe to the editor's version counter so commits that mutate the
  // authored egg list trigger a re-render here (the list itself is pulled
  // imperatively via getCurrent below).
  const version = store((s) => s.version);
  void version;
  const { easterEggs } = store.getState().getCurrent();
  const matching = useMemo<EasterEggDef[]>(
    () => EASTER_EGG_DEFS.filter((d) => d.biomes.includes(biome)),
    [biome],
  );
  const selected = tool.selectedId
    ? (easterEggs.find((e) => e.id === tool.selectedId) ?? null)
    : null;
  const selectedDef = selected ? (EASTER_EGG_BY_ID[selected.defId] ?? null) : null;
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
      <div
        style={{
          color: "#8b93a3",
          margin: 0,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          fontSize: 10,
        }}
      >
        Easter eggs · {biome}
      </div>
      {matching.length === 0 ? (
        <div style={{ color: "#8b93a3" }}>No easter eggs match this biome.</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {matching.map((d) => {
            const on = tool.placingDefId === d.id;
            return (
              <button
                key={d.id}
                type="button"
                style={btn(on)}
                title={`${d.id}${d.motion ? " (moves)" : ""} · click map to place`}
                onClick={() => store.getState().setEasterEggPlacing(d.id)}
              >
                {on ? `${d.id} ✓` : d.id}
                {d.motion ? " ↝" : ""}
              </button>
            );
          })}
        </div>
      )}
      {selected && selectedDef ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: 6,
            background: "#0d1118",
            border: `1px solid ${tool.settingDirection ? "#ffae20" : "#2a313d"}`,
            borderRadius: 5,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600 }}>
              {selected.defId}
              {selectedDef.motion ? " ↝" : ""}
            </span>
            <span style={{ color: "#8b93a3" }}>
              ({selected.pos.x.toFixed(1)}, {selected.pos.y.toFixed(1)})
            </span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              style={btn(tool.settingDirection)}
              onClick={() => store.getState().beginSetEasterEggDirection()}
              title={
                selectedDef.motion
                  ? "Set travel heading — next map click sets the direction the egg moves from its spawn position."
                  : "Set facing — next map click rotates the static egg toward the click position."
              }
            >
              {tool.settingDirection ? "Click map…" : "Set direction"}
            </button>
            <button
              type="button"
              style={btn()}
              onClick={() => store.getState().setEasterEggRotation(0)}
              title="Reset heading to north (game-y axis)"
            >
              ↥ Reset
            </button>
            <button
              type="button"
              style={dangerBtn}
              onClick={() => store.getState().deleteEasterEgg(selected.id)}
            >
              Delete
            </button>
          </div>
          {selectedDef.motion && (
            <div style={{ color: "#8b93a3", fontSize: 11 }}>
              Moves at speed {selectedDef.motion.speed}/s — spawns at the authored point traveling
              along the arrow.
            </div>
          )}
        </div>
      ) : easterEggs.length === 0 ? (
        <div style={{ color: "#8b93a3" }}>Pick an egg above, then click the map to drop it.</div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 3,
            maxHeight: 160,
            overflowY: "auto",
          }}
        >
          {easterEggs.map((egg) => {
            const def = EASTER_EGG_BY_ID[egg.defId];
            return (
              <button
                key={egg.id}
                type="button"
                style={{
                  ...btn(false),
                  textAlign: "left",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 6,
                }}
                onClick={() => store.getState().selectEasterEgg(egg.id)}
                title={`Select ${egg.defId} at (${egg.pos.x.toFixed(1)}, ${egg.pos.y.toFixed(1)})`}
              >
                <span>
                  {egg.defId}
                  {def?.motion ? " ↝" : ""}
                </span>
                <span style={{ color: "#8b93a3" }}>
                  ({egg.pos.x.toFixed(0)}, {egg.pos.y.toFixed(0)})
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
