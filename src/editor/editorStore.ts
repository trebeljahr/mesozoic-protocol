import { nanoid } from "nanoid";
import { create } from "zustand";
import { classifyPropUrl } from "../biomes";
import type { PlacedProp, River, RiverPoint } from "../sim/types";
import { useGame } from "../store";
import { getBrushPreset, pickWeighted, randRange, samplePoints } from "./brush";
import {
  canRedo as canRedoH,
  canUndo as canUndoH,
  type History,
  pushHistory,
  redoHistory,
  type Snapshot,
  undoHistory,
} from "./history";
import { clearAllLevelEdits, clearLevelEdit, readAllLevelEdits, saveLevelEdit } from "./levelEdits";

// Dev-only editor state. Kept in its own store so the giant game store stays
// untouched and the whole editor surface (this module + its UI/render
// components) is only imported behind import.meta.env.DEV — production never
// bundles it. World mutation flows through useGame: hand-placed props live on
// world.props (created by createWorld from the localStorage overrides), and
// edits here mutate that array, persist it, and bump the game's geometry
// version so the render layers + canPlaceAt re-evaluate.

// Roles that read as solid obstacles default to blocking tower placement;
// grass/cosmetic props default to walk-over decor.
const BLOCKING_ROLES = new Set(["building", "tree", "bush", "rock"]);
const defaultBlocks = (url: string): boolean => BLOCKING_ROLES.has(classifyPropUrl(url));

const MIN_SCALE = 0.15;
const MAX_SCALE = 6;
const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

// River width clamp — keeps the ribbon usable (no zero-width or absurd widths).
const MIN_RIVER_WIDTH = 0.5;
const MAX_RIVER_WIDTH = 20;
const DEFAULT_RIVER_WIDTH = 2.5;
const clampRiverWidth = (w: number): number =>
  Math.min(MAX_RIVER_WIDTH, Math.max(MIN_RIVER_WIDTH, w));

// Re-snapshot ui.treeVersion (the static-geometry invalidation key the
// render layers + Placement already subscribe to) so an in-place props
// mutation actually re-renders.
const bumpGeometry = (): void => {
  useGame.setState((s) => {
    const tv = s.treeVersion + 1;
    return { treeVersion: tv, ui: { ...s.ui, treeVersion: tv } };
  });
};

const persist = (): void => {
  const w = useGame.getState().world;
  saveLevelEdit(w.levelId, {
    v: 1,
    override: w.overrideActive,
    props: w.props,
    rivers: w.rivers,
  });
};

const currentSnapshot = (): Snapshot => {
  const w = useGame.getState().world;
  return {
    props: [...w.props],
    override: w.overrideActive,
    rivers: w.rivers.map((r) => ({ ...r, points: r.points.map((p) => ({ ...p })) })),
  };
};

// Replace world.props with a fresh array, invalidate render, and persist.
const commitProps = (next: PlacedProp[]): void => {
  useGame.getState().world.props = next;
  bumpGeometry();
  persist();
};

// Replace world.rivers with a fresh array, invalidate render, and persist.
// Mirrors commitProps so the same treeVersion bump invalidates Rivers as well.
const commitRivers = (next: River[]): void => {
  useGame.getState().world.rivers = next;
  bumpGeometry();
  persist();
};

// Rebuild the current level so createWorld re-reads the override flag (the
// only way to suppress / restore the procedural set-dressing cleanly).
const reloadLevel = (): void => {
  const g = useGame.getState();
  if (g.selectedLevelId !== null) {
    g.startLevel(g.selectedLevelId, g.world.mode);
    return;
  }
  const endlessMapId = g.world.endless?.mapId;
  if (endlessMapId) g.startEndless(endlessMapId);
};

type BrushState = {
  active: boolean;
  presetId: string | null;
  radius: number;
  density: number;
  minSpacing: number;
};

// River-tool state. `active` flips the editor into river-painting mode
// (mutually exclusive with placingUrl / brush / prop-select). While editing
// a single river, `editingRiverId` points at the in-progress river so map
// clicks append points. `finishRiver` commits one undo entry for the whole
// stroke (per-point clicks don't pollute history). `selectedRiverId` is the
// post-finish selection for editing existing rivers (drag points, set width,
// delete).
type RiverToolState = {
  active: boolean;
  editingRiverId: string | null;
  selectedRiverId: string | null;
  width: number;
};

type EditorState = {
  active: boolean;
  // Asset url armed for placement — each map click drops one. null = select mode.
  placingUrl: string | null;
  selectedId: string | null;
  // When true the next map click relocates the selected prop.
  moving: boolean;
  brush: BrushState;
  // Stroke gate so a click-drag scatter stroke produces a single undo entry.
  // strokeAnchor is captured pre-stroke and pushed onto the undo stack on the
  // first paintAt that actually places props; subsequent paints during the
  // same stroke skip the history push.
  strokeAnchor: Snapshot | null;
  strokeOpen: boolean;
  strokePushed: boolean;
  riverTool: RiverToolState;
  history: History;
  toggleActive: () => void;
  setPlacing: (url: string | null) => void;
  placeAt: (x: number, y: number) => void;
  select: (id: string | null) => void;
  beginMove: () => void;
  moveSelectedTo: (x: number, y: number) => void;
  deleteSelected: () => void;
  rotateSelected: (deltaRad: number) => void;
  scaleSelected: (mul: number) => void;
  toggleSelectedBlocks: () => void;
  setOverride: (on: boolean) => void;
  clearLevel: () => void;
  clearAllLevels: () => void;
  setBrushPreset: (id: string | null) => void;
  setBrushParams: (p: { radius?: number; density?: number; minSpacing?: number }) => void;
  beginStroke: () => void;
  paintAt: (x: number, y: number) => void;
  endStroke: () => void;
  // River-tool actions. See RiverToolState docstring.
  setRiverToolActive: (on: boolean) => void;
  beginRiver: (x: number, y: number) => void;
  addRiverPoint: (x: number, y: number) => void;
  finishRiver: () => void;
  selectRiver: (id: string | null) => void;
  dragRiverPointStart: () => void;
  dragRiverPoint: (riverId: string, index: number, x: number, y: number) => void;
  dragRiverPointEnd: () => void;
  deleteRiverPoint: (riverId: string, index: number) => void;
  deleteRiver: (id: string) => void;
  setRiverWidth: (width: number) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  exportJson: () => string;
  exportAllJson: () => string;
};

const DEFAULT_BRUSH: BrushState = {
  active: false,
  presetId: null,
  radius: 4,
  density: 8,
  minSpacing: 1.0,
};

// PURE annotation: the create() call has no observable side effects, so when
// the editor's only consumers (EditorProps / LevelEditorPanel) are dead-coded
// in production, Rollup drops this store — and levelEdits — entirely.
export const useEditor = /* @__PURE__ */ create<EditorState>((set, get) => {
  // snapshotAndPush: capture pre-mutation state and push it onto the undo
  // stack. Call BEFORE applying any mutation. Resets the redo stack.
  const snapshotAndPush = (): void => {
    set((s) => ({ history: pushHistory(s.history, currentSnapshot()) }));
  };

  return {
    active: false,
    placingUrl: null,
    selectedId: null,
    moving: false,
    brush: DEFAULT_BRUSH,
    strokeAnchor: null,
    strokeOpen: false,
    strokePushed: false,
    riverTool: {
      active: false,
      editingRiverId: null,
      selectedRiverId: null,
      width: DEFAULT_RIVER_WIDTH,
    },
    history: { past: [], future: [] },

    toggleActive: () => {
      const next = !get().active;
      if (next) {
        // Drop any in-flight gameplay selection so map clicks belong to the
        // editor, not tower placement / robot move orders.
        useGame.getState().clearSelection();
      }
      set((s) => ({
        active: next,
        placingUrl: null,
        selectedId: null,
        moving: false,
        brush: { ...s.brush, active: false },
        strokeAnchor: null,
        strokeOpen: false,
        strokePushed: false,
        riverTool: { ...s.riverTool, active: false, editingRiverId: null, selectedRiverId: null },
      }));
    },

    setPlacing: (url) =>
      set((s) => ({
        // Clicking the armed asset again disarms back to select mode. Brush
        // mode is mutually exclusive with placement, so arming a url drops
        // any active brush.
        placingUrl: s.placingUrl === url ? null : url,
        selectedId: null,
        moving: false,
        brush: { ...s.brush, active: false },
        // Picking an asset disarms the river tool — they share the click plane.
        riverTool: { ...s.riverTool, active: false, editingRiverId: null, selectedRiverId: null },
      })),

    placeAt: (x, y) => {
      const url = get().placingUrl;
      if (!url) return;
      const prop: PlacedProp = {
        id: nanoid(8),
        url,
        pos: { x, y },
        scale: 1,
        rot: 0,
        blocks: defaultBlocks(url),
      };
      snapshotAndPush();
      commitProps([...useGame.getState().world.props, prop]);
      // Keep the asset armed for rapid placement; surface the new prop as
      // selected so its controls are one disarm away.
      set({ selectedId: prop.id });
    },

    select: (id) => set({ selectedId: id, moving: false }),

    beginMove: () => {
      if (get().selectedId === null) return;
      set({ moving: true });
    },

    moveSelectedTo: (x, y) => {
      const id = get().selectedId;
      if (id === null) return;
      snapshotAndPush();
      commitProps(
        useGame.getState().world.props.map((p) => (p.id === id ? { ...p, pos: { x, y } } : p)),
      );
      set({ moving: false });
    },

    deleteSelected: () => {
      const id = get().selectedId;
      if (id === null) return;
      snapshotAndPush();
      commitProps(useGame.getState().world.props.filter((p) => p.id !== id));
      set({ selectedId: null, moving: false });
    },

    rotateSelected: (deltaRad) => {
      const id = get().selectedId;
      if (id === null) return;
      snapshotAndPush();
      commitProps(
        useGame
          .getState()
          .world.props.map((p) => (p.id === id ? { ...p, rot: p.rot + deltaRad } : p)),
      );
    },

    scaleSelected: (mul) => {
      const id = get().selectedId;
      if (id === null) return;
      snapshotAndPush();
      commitProps(
        useGame
          .getState()
          .world.props.map((p) => (p.id === id ? { ...p, scale: clampScale(p.scale * mul) } : p)),
      );
    },

    toggleSelectedBlocks: () => {
      const id = get().selectedId;
      if (id === null) return;
      snapshotAndPush();
      commitProps(
        useGame.getState().world.props.map((p) => (p.id === id ? { ...p, blocks: !p.blocks } : p)),
      );
    },

    setOverride: (on) => {
      const w = useGame.getState().world;
      snapshotAndPush();
      w.overrideActive = on;
      persist();
      set({ selectedId: null, moving: false, placingUrl: null });
      // Rebuild so procedural set-dressing is suppressed (or restored).
      reloadLevel();
    },

    clearLevel: () => {
      const w = useGame.getState().world;
      clearLevelEdit(w.levelId);
      w.props = [];
      w.rivers = [];
      w.overrideActive = false;
      // Fresh state is the new baseline — drop history.
      set((s) => ({
        selectedId: null,
        moving: false,
        placingUrl: null,
        riverTool: {
          ...s.riverTool,
          active: false,
          editingRiverId: null,
          selectedRiverId: null,
        },
        history: { past: [], future: [] },
        strokeAnchor: null,
        strokeOpen: false,
        strokePushed: false,
      }));
      bumpGeometry();
      reloadLevel();
    },

    // Wipe every authored level layout in one shot. Bypasses the per-level
    // history (the undo stack only spans one level's edits anyway) and
    // rebuilds the current level so the in-memory world reflects the wipe.
    // Caller MUST gate this on a user confirm — it's irreversible.
    clearAllLevels: () => {
      clearAllLevelEdits();
      const w = useGame.getState().world;
      w.props = [];
      w.rivers = [];
      w.overrideActive = false;
      set((s) => ({
        selectedId: null,
        moving: false,
        placingUrl: null,
        riverTool: {
          ...s.riverTool,
          active: false,
          editingRiverId: null,
          selectedRiverId: null,
        },
        history: { past: [], future: [] },
      }));
      bumpGeometry();
      reloadLevel();
    },

    setBrushPreset: (id) => {
      const cur = get().brush;
      // Tap the active preset to disarm; tap any other preset to switch /
      // arm. Switching brush on disarms placingUrl + moving + selection.
      if (id !== null && cur.presetId === id && cur.active) {
        set({ brush: { ...cur, active: false } });
        return;
      }
      set((s) => ({
        brush: { ...s.brush, presetId: id, active: id !== null },
        placingUrl: null,
        selectedId: null,
        moving: false,
        // Arming a brush disarms the river tool — both consume the click plane.
        riverTool: { ...s.riverTool, active: false, editingRiverId: null, selectedRiverId: null },
      }));
    },

    setBrushParams: (p) =>
      set((s) => ({
        brush: {
          ...s.brush,
          radius: p.radius ?? s.brush.radius,
          density: p.density ?? s.brush.density,
          minSpacing: p.minSpacing ?? s.brush.minSpacing,
        },
      })),

    beginStroke: () => {
      // Stash a snapshot but don't push yet — only paintAt that actually
      // produces props during the stroke commits the history entry, so a
      // mis-click drag with zero scattered props leaves the undo stack
      // untouched.
      set({ strokeAnchor: currentSnapshot(), strokeOpen: true, strokePushed: false });
    },

    paintAt: (x, y) => {
      const s = get();
      const preset = getBrushPreset(s.brush.presetId);
      if (!preset || preset.urls.length === 0) return;
      if (!s.brush.active) return;
      const world = useGame.getState().world;
      const existing = world.props.map((p) => p.pos);
      const points = samplePoints(
        { x, y },
        s.brush.radius,
        s.brush.density,
        s.brush.minSpacing,
        existing,
      );
      if (points.length === 0) return;
      if (s.strokeOpen) {
        if (!s.strokePushed && s.strokeAnchor) {
          const anchor = s.strokeAnchor;
          set((ss) => ({ history: pushHistory(ss.history, anchor), strokePushed: true }));
        }
      } else {
        // Out-of-stroke paint (defensive) — push a single history entry.
        set((ss) => ({ history: pushHistory(ss.history, currentSnapshot()) }));
      }
      const additions: PlacedProp[] = points.map((pt) => ({
        id: nanoid(8),
        url: pickWeighted(preset),
        pos: pt,
        scale: randRange(preset.scaleJitter[0], preset.scaleJitter[1]),
        rot: randRange(preset.rotateRange[0], preset.rotateRange[1]),
        blocks: preset.defaultBlocks,
      }));
      commitProps([...world.props, ...additions]);
    },

    endStroke: () => {
      set({ strokeAnchor: null, strokeOpen: false, strokePushed: false });
    },

    setRiverToolActive: (on) => {
      if (on) useGame.getState().clearSelection();
      set((s) => ({
        // Mutually exclusive with prop placement / move / brush.
        placingUrl: null,
        selectedId: null,
        moving: false,
        brush: { ...s.brush, active: false },
        riverTool: {
          ...s.riverTool,
          active: on,
          // Disarm in-progress stroke when toggling off; preserve selection
          // so a re-toggle still has the last-edited river highlighted.
          editingRiverId: on ? s.riverTool.editingRiverId : null,
        },
      }));
    },

    beginRiver: (x, y) => {
      // First click of a new river: seed two coincident-ish points so the
      // Catmull-Rom curve has enough samples to render immediately. The
      // second click (addRiverPoint) replaces the placeholder offset.
      const id = nanoid(8);
      const seed: River = {
        id,
        points: [
          { x, y },
          { x: x + 0.01, y: y + 0.01 },
        ],
        width: get().riverTool.width,
      };
      snapshotAndPush();
      commitRivers([...useGame.getState().world.rivers, seed]);
      set((s) => ({
        riverTool: { ...s.riverTool, editingRiverId: id, selectedRiverId: id },
      }));
    },

    addRiverPoint: (x, y) => {
      const editingId = get().riverTool.editingRiverId;
      if (editingId === null) return;
      // No history push during a stroke — finishRiver commits one entry for
      // the whole creation. Without snapshotAndPush each map click would
      // pollute undo with N intermediate states.
      const next = useGame.getState().world.rivers.map((r) => {
        if (r.id !== editingId) return r;
        // Replace the placeholder seed point on the second click; append after.
        if (r.points.length === 2 && r.points[1].x === r.points[0].x + 0.01) {
          return { ...r, points: [r.points[0], { x, y }] };
        }
        return { ...r, points: [...r.points, { x, y } as RiverPoint] };
      });
      commitRivers(next);
    },

    finishRiver: () => {
      // Commit-only — the initial snapshotAndPush in beginRiver already
      // covered the creation. Just clear the editing handle so further
      // map clicks don't extend this river.
      set((s) => ({ riverTool: { ...s.riverTool, editingRiverId: null } }));
    },

    selectRiver: (id) => {
      set((s) => ({
        riverTool: { ...s.riverTool, selectedRiverId: id, editingRiverId: null },
      }));
    },

    dragRiverPointStart: () => {
      // One undo entry per drag — snapshot here, then mutate freely via
      // dragRiverPoint until dragRiverPointEnd. The drag points are
      // controlled by pointer events on the editor sphere.
      snapshotAndPush();
    },

    dragRiverPoint: (riverId, index, x, y) => {
      // Pure mutation — history was captured at drag start.
      const next = useGame.getState().world.rivers.map((r) => {
        if (r.id !== riverId) return r;
        if (index < 0 || index >= r.points.length) return r;
        const points = r.points.map((p, i) => (i === index ? { x, y } : p));
        return { ...r, points };
      });
      commitRivers(next);
    },

    dragRiverPointEnd: () => {
      // No-op for now; the undo entry was opened at drag start. Hook left
      // in place for future "commit on release" diff-coalescing.
    },

    deleteRiverPoint: (riverId, index) => {
      const river = useGame.getState().world.rivers.find((r) => r.id === riverId);
      if (!river) return;
      // A river needs ≥2 points to render — refuse the delete instead of
      // silently destroying the river.
      if (river.points.length <= 2) return;
      snapshotAndPush();
      const next = useGame
        .getState()
        .world.rivers.map((r) =>
          r.id === riverId ? { ...r, points: r.points.filter((_, i) => i !== index) } : r,
        );
      commitRivers(next);
    },

    deleteRiver: (id) => {
      snapshotAndPush();
      const next = useGame.getState().world.rivers.filter((r) => r.id !== id);
      commitRivers(next);
      set((s) => ({
        riverTool: {
          ...s.riverTool,
          selectedRiverId: s.riverTool.selectedRiverId === id ? null : s.riverTool.selectedRiverId,
          editingRiverId: s.riverTool.editingRiverId === id ? null : s.riverTool.editingRiverId,
        },
      }));
    },

    setRiverWidth: (width) => {
      const w = clampRiverWidth(width);
      const targetId = get().riverTool.editingRiverId ?? get().riverTool.selectedRiverId ?? null;
      if (targetId === null) {
        // No active river — just update the tool default for the next river.
        set((s) => ({ riverTool: { ...s.riverTool, width: w } }));
        return;
      }
      snapshotAndPush();
      const next = useGame
        .getState()
        .world.rivers.map((r) => (r.id === targetId ? { ...r, width: w } : r));
      commitRivers(next);
      set((s) => ({ riverTool: { ...s.riverTool, width: w } }));
    },

    undo: () => {
      const result = undoHistory(get().history, currentSnapshot());
      if (!result) return;
      const w = useGame.getState().world;
      w.props = result.restored.props;
      w.overrideActive = result.restored.override;
      w.rivers = result.restored.rivers;
      bumpGeometry();
      persist();
      // Restored selection may no longer exist. Drop any open stroke + river-edit handle.
      set((s) => ({
        history: result.next,
        selectedId: null,
        moving: false,
        strokeAnchor: null,
        strokeOpen: false,
        strokePushed: false,
        riverTool: { ...s.riverTool, editingRiverId: null, selectedRiverId: null },
      }));
    },

    redo: () => {
      const result = redoHistory(get().history, currentSnapshot());
      if (!result) return;
      const w = useGame.getState().world;
      w.props = result.restored.props;
      w.overrideActive = result.restored.override;
      w.rivers = result.restored.rivers;
      bumpGeometry();
      persist();
      set((s) => ({
        history: result.next,
        selectedId: null,
        moving: false,
        strokeAnchor: null,
        strokeOpen: false,
        strokePushed: false,
        riverTool: { ...s.riverTool, editingRiverId: null, selectedRiverId: null },
      }));
    },

    canUndo: () => canUndoH(get().history),
    canRedo: () => canRedoH(get().history),

    // Export adds export-only metadata (scope/levelId/generatedAt) on top
    // of the persisted shape so a downloaded file is self-describing. The
    // persistence shape in localStorage stays minimal — extra fields are
    // ignored by loaders that only look for `v`, `override`, `props`.
    exportJson: () => {
      const w = useGame.getState().world;
      return JSON.stringify(
        {
          v: 1,
          scope: "level",
          levelId: w.levelId,
          generatedAt: new Date().toISOString(),
          override: w.overrideActive,
          props: w.props,
          rivers: w.rivers,
        },
        null,
        2,
      );
    },

    // Bundle every authored level into one JSON. Skips the in-memory
    // mutation of the currently-playing level — uses the persisted store
    // directly so the dump is a faithful snapshot of disk-state.
    exportAllJson: () => {
      const all = readAllLevelEdits();
      return JSON.stringify(
        {
          v: 1,
          scope: "all-levels",
          generatedAt: new Date().toISOString(),
          levels: all,
        },
        null,
        2,
      );
    },
  };
});
