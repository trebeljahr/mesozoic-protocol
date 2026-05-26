import { nanoid } from "nanoid";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { classifyPropUrl } from "../biomes";
import type { PlacedProp, River, RiverPoint } from "../sim/types";
import { getBrushPreset, pickFromUrls, randRange, resolveBrushUrls, samplePoints } from "./brush";
import {
  canRedo as canRedoH,
  canUndo as canUndoH,
  type History,
  pushHistory,
  redoHistory,
  type Snapshot,
  undoHistory,
} from "./history";

// Shared dev-only editor store factory. The level editor and world-map editor
// run the same UX (palette + selection + transform + brush + variants + river
// tool + history + persistence + export) over two data sources: level edits
// live on useGame.world.{props,rivers,overrideActive} and are rebuilt by
// createWorld; world-map edits own their own arrays in localStorage. The
// adapter parameter is the only thing that differs — it hands the factory a
// read/write/clear triple over its source plus a scope-aware exportJson()
// (each editor stamps its own scope metadata) and a few lifecycle hooks
// (activate / reload). Everything else collapses to one implementation.

const BLOCKING_ROLES = new Set(["building", "tree", "bush", "rock"]);
const defaultBlocks = (url: string): boolean => BLOCKING_ROLES.has(classifyPropUrl(url));

const MIN_SCALE = 0.15;
const MAX_SCALE = 6;
const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

// River width clamp — keeps the ribbon usable (no zero-width or absurd widths).
const MIN_RIVER_WIDTH = 0.5;
const MAX_RIVER_WIDTH = 20;
export const DEFAULT_RIVER_WIDTH = 2.5;
const clampRiverWidth = (w: number): number =>
  Math.min(MAX_RIVER_WIDTH, Math.max(MIN_RIVER_WIDTH, w));

export type EditorSource = { props: PlacedProp[]; override: boolean; rivers: River[] };

export type EditorAdapter = {
  // Authoritative read of the underlying data source. Called on every
  // mutation; return live references — the factory clones via spreads/maps
  // when it builds undo snapshots.
  getCurrent: () => EditorSource;
  // Replace the source with `next`, persist, and invalidate downstream
  // renderers. Every mutation (place/move/rotate/scale/blocks/setOverride/
  // river edits/undo/redo/paint stroke) flows through here.
  commit: (next: EditorSource) => void;
  // Drop persistence + reset the source to empty. Called by clear() before
  // the factory wipes its own history and fires onClear (e.g. reloadLevel).
  clear: () => void;
  // Scope-aware JSON dump. Each adapter stamps its own metadata (scope,
  // levelId, generatedAt) on top of the persisted { v, override, props,
  // rivers } shape so a downloaded file is self-describing.
  exportJson: () => string;
  // Optional lifecycle hooks. onActivate: editor opens (level editor clears
  // gameplay selection). onOverrideChange: setOverride committed (level
  // rebuilds world). onClear: clear() ran (level rebuilds world).
  onActivate?: () => void;
  onOverrideChange?: () => void;
  onClear?: () => void;
};

export type BrushState = {
  active: boolean;
  presetId: string | null;
  radius: number;
  density: number;
  minSpacing: number;
  // Url filter: null = use every url in the active preset; an array =
  // restrict the brush to this subset. Reset to null whenever the preset
  // changes — the subset is meaningless against a different roster.
  customUrls: string[] | null;
};

// River-tool state. `active` flips the editor into river-painting mode
// (mutually exclusive with placingUrl / brush / prop-select). While editing
// a single river, `editingRiverId` points at the in-progress river so map
// clicks append points. `finishRiver` commits one undo entry for the whole
// stroke. `selectedRiverId` is the post-finish selection for editing
// existing rivers (drag points, set width, delete).
export type RiverToolState = {
  active: boolean;
  editingRiverId: string | null;
  selectedRiverId: string | null;
  width: number;
};

const DEFAULT_BRUSH: BrushState = {
  active: false,
  presetId: null,
  radius: 4,
  density: 8,
  minSpacing: 1.0,
  customUrls: null,
};

const DEFAULT_RIVER_TOOL: RiverToolState = {
  active: false,
  editingRiverId: null,
  selectedRiverId: null,
  width: DEFAULT_RIVER_WIDTH,
};

export type EditorStoreApi = {
  active: boolean;
  // Asset url armed for placement — each map click drops one. null = select mode.
  placingUrl: string | null;
  selectedId: string | null;
  // When true the next map click relocates the selected prop.
  moving: boolean;
  // Static-geometry invalidation key. Bumped on every commit so subscribers
  // re-render without having to subscribe to the underlying source directly.
  version: number;
  history: History;
  brush: BrushState;
  // Stroke gate so a click-drag scatter stroke produces a single undo entry.
  strokeAnchor: Snapshot | null;
  strokeOpen: boolean;
  strokePushed: boolean;
  riverTool: RiverToolState;
  // Authoritative read of the underlying props/override/rivers. Defers to
  // the adapter so callers don't need to know whether state lives on the
  // store itself (world map) or on useGame.world (level editor).
  getCurrent: () => EditorSource;
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
  clear: () => void;
  setBrushPreset: (id: string | null) => void;
  setBrushParams: (p: { radius?: number; density?: number; minSpacing?: number }) => void;
  toggleBrushUrl: (url: string) => void;
  resetBrushUrls: () => void;
  beginStroke: () => void;
  paintAt: (x: number, y: number) => void;
  endStroke: () => void;
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
};

export type EditorStore = UseBoundStore<StoreApi<EditorStoreApi>>;

const STROKE_CLEAR = {
  strokeAnchor: null,
  strokeOpen: false,
  strokePushed: false,
} as const;

const cloneRivers = (rs: River[]): River[] =>
  rs.map((r) => ({ ...r, points: r.points.map((p) => ({ ...p })) }));

// `makeAdapter` runs inside create() so adapters with internal mutable state
// (e.g. the world-map adapter's seed/closure) initialise lazily — production
// never runs it because the bound store is never read.
export const createEditorStore = (makeAdapter: () => EditorAdapter): EditorStore =>
  create<EditorStoreApi>((set, get) => {
    const adapter = makeAdapter();

    const snapshot = (): Snapshot => {
      const cur = adapter.getCurrent();
      return {
        props: [...cur.props],
        override: cur.override,
        rivers: cloneRivers(cur.rivers),
      };
    };

    // Capture pre-mutation state onto the undo stack. Call BEFORE applying
    // a mutation. Resets the redo stack.
    const snapshotAndPush = (): void => {
      set((s) => ({ history: pushHistory(s.history, snapshot()) }));
    };

    // Persist + invalidate downstream, then bump the store version so panel
    // and render-layer subscribers re-render.
    const commit = (next: EditorSource): void => {
      adapter.commit(next);
      set((s) => ({ version: s.version + 1 }));
    };

    // Replace just the props array, keeping override + rivers unchanged.
    const commitProps = (props: PlacedProp[]): void => {
      const cur = adapter.getCurrent();
      commit({ props, override: cur.override, rivers: cur.rivers });
    };

    // Replace just the rivers array, keeping props + override unchanged.
    const commitRivers = (rivers: River[]): void => {
      const cur = adapter.getCurrent();
      commit({ props: cur.props, override: cur.override, rivers });
    };

    // Single-prop transform shorthand for rotate/scale/toggleBlocks.
    const mutateSelected = (transform: (p: PlacedProp) => PlacedProp): void => {
      const id = get().selectedId;
      if (id === null) return;
      snapshotAndPush();
      const cur = adapter.getCurrent();
      commitProps(cur.props.map((p) => (p.id === id ? transform(p) : p)));
    };

    return {
      active: false,
      placingUrl: null,
      selectedId: null,
      moving: false,
      version: 0,
      history: { past: [], future: [] },
      brush: DEFAULT_BRUSH,
      ...STROKE_CLEAR,
      riverTool: DEFAULT_RIVER_TOOL,

      getCurrent: () => adapter.getCurrent(),

      toggleActive: () => {
        const next = !get().active;
        if (next) adapter.onActivate?.();
        set((s) => ({
          active: next,
          placingUrl: null,
          selectedId: null,
          moving: false,
          brush: { ...s.brush, active: false },
          ...STROKE_CLEAR,
          riverTool: { ...s.riverTool, active: false, editingRiverId: null, selectedRiverId: null },
        }));
      },

      setPlacing: (url) =>
        set((s) => ({
          // Clicking the armed asset again disarms back to select mode.
          // Arming a url drops any active brush/river — they share the click plane.
          placingUrl: s.placingUrl === url ? null : url,
          selectedId: null,
          moving: false,
          brush: { ...s.brush, active: false },
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
        const cur = adapter.getCurrent();
        commitProps([...cur.props, prop]);
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
        const cur = adapter.getCurrent();
        commitProps(cur.props.map((p) => (p.id === id ? { ...p, pos: { x, y } } : p)));
        set({ moving: false });
      },

      deleteSelected: () => {
        const id = get().selectedId;
        if (id === null) return;
        snapshotAndPush();
        const cur = adapter.getCurrent();
        commitProps(cur.props.filter((p) => p.id !== id));
        set({ selectedId: null, moving: false });
      },

      rotateSelected: (deltaRad) => mutateSelected((p) => ({ ...p, rot: p.rot + deltaRad })),
      scaleSelected: (mul) => mutateSelected((p) => ({ ...p, scale: clampScale(p.scale * mul) })),
      toggleSelectedBlocks: () => mutateSelected((p) => ({ ...p, blocks: !p.blocks })),

      setOverride: (on) => {
        snapshotAndPush();
        const cur = adapter.getCurrent();
        commit({ props: cur.props, override: on, rivers: cur.rivers });
        set({ selectedId: null, moving: false, placingUrl: null });
        adapter.onOverrideChange?.();
      },

      clear: () => {
        adapter.clear();
        set((s) => ({
          selectedId: null,
          moving: false,
          placingUrl: null,
          history: { past: [], future: [] },
          version: s.version + 1,
          ...STROKE_CLEAR,
          riverTool: { ...s.riverTool, active: false, editingRiverId: null, selectedRiverId: null },
        }));
        adapter.onClear?.();
      },

      setBrushPreset: (id) => {
        const cur = get().brush;
        // Tap the active preset to disarm; tap any other preset to switch /
        // arm. Switching brush on disarms placingUrl + moving + selection.
        // The url filter is preset-scoped — drop it on every switch (incl.
        // disarm) so a re-arm of the same preset starts with the full roster.
        if (id !== null && cur.presetId === id && cur.active) {
          set({ brush: { ...cur, active: false, customUrls: null } });
          return;
        }
        set((s) => ({
          brush: { ...s.brush, presetId: id, active: id !== null, customUrls: null },
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

      toggleBrushUrl: (url) => {
        const cur = get().brush;
        const preset = getBrushPreset(cur.presetId);
        if (!preset) return;
        // Materialise the effective set, flip the url, then collapse back to
        // null when the result matches the full roster — canonical "all on".
        const effective = new Set(cur.customUrls ?? preset.urls);
        if (effective.has(url)) {
          // Refuse to drop the last url — an empty filter makes the brush a
          // silent no-op. Keeping the checkbox checked surfaces the floor.
          if (effective.size <= 1) return;
          effective.delete(url);
        } else {
          if (!preset.urls.includes(url)) return;
          effective.add(url);
        }
        // Re-order to follow preset.urls so the stored subset matches panel order.
        const next = preset.urls.filter((u) => effective.has(u));
        const allOn = next.length === preset.urls.length;
        set({ brush: { ...cur, customUrls: allOn ? null : next } });
      },

      resetBrushUrls: () => set((s) => ({ brush: { ...s.brush, customUrls: null } })),

      beginStroke: () => {
        set({ strokeAnchor: snapshot(), strokeOpen: true, strokePushed: false });
      },

      paintAt: (x, y) => {
        const s = get();
        const preset = getBrushPreset(s.brush.presetId);
        if (!preset) return;
        if (!s.brush.active) return;
        const urls = resolveBrushUrls(preset, s.brush.customUrls);
        if (urls.length === 0) return;
        const cur = adapter.getCurrent();
        const existing = cur.props.map((p) => p.pos);
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
          set((ss) => ({ history: pushHistory(ss.history, snapshot()) }));
        }
        const additions: PlacedProp[] = points.map((pt) => ({
          id: nanoid(8),
          url: pickFromUrls(urls),
          pos: pt,
          scale: randRange(preset.scaleJitter[0], preset.scaleJitter[1]),
          rot: randRange(preset.rotateRange[0], preset.rotateRange[1]),
          blocks: preset.defaultBlocks,
        }));
        commitProps([...cur.props, ...additions]);
      },

      endStroke: () => {
        set(STROKE_CLEAR);
      },

      setRiverToolActive: (on) => {
        if (on) adapter.onActivate?.();
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
        const cur = adapter.getCurrent();
        commitRivers([...cur.rivers, seed]);
        set((s) => ({
          riverTool: { ...s.riverTool, editingRiverId: id, selectedRiverId: id },
        }));
      },

      addRiverPoint: (x, y) => {
        const editingId = get().riverTool.editingRiverId;
        if (editingId === null) return;
        // No history push during a stroke — beginRiver pushed the creation
        // entry. Without this gate each map click would pollute undo.
        const cur = adapter.getCurrent();
        const next = cur.rivers.map((r) => {
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
        set((s) => ({ riverTool: { ...s.riverTool, editingRiverId: null } }));
      },

      selectRiver: (id) => {
        set((s) => ({
          riverTool: { ...s.riverTool, selectedRiverId: id, editingRiverId: null },
        }));
      },

      dragRiverPointStart: () => {
        // One undo entry per drag — snapshot here, then mutate freely via
        // dragRiverPoint until dragRiverPointEnd.
        snapshotAndPush();
      },

      dragRiverPoint: (riverId, index, x, y) => {
        // Pure mutation — history was captured at drag start.
        const cur = adapter.getCurrent();
        const next = cur.rivers.map((r) => {
          if (r.id !== riverId) return r;
          if (index < 0 || index >= r.points.length) return r;
          return { ...r, points: r.points.map((p, i) => (i === index ? { x, y } : p)) };
        });
        commitRivers(next);
      },

      dragRiverPointEnd: () => {
        // No-op for now; the undo entry was opened at drag start.
      },

      deleteRiverPoint: (riverId, index) => {
        const cur = adapter.getCurrent();
        const river = cur.rivers.find((r) => r.id === riverId);
        if (!river) return;
        // A river needs ≥2 points to render — refuse the delete instead of
        // silently destroying the river.
        if (river.points.length <= 2) return;
        snapshotAndPush();
        const next = cur.rivers.map((r) =>
          r.id === riverId ? { ...r, points: r.points.filter((_, i) => i !== index) } : r,
        );
        commitRivers(next);
      },

      deleteRiver: (id) => {
        snapshotAndPush();
        const cur = adapter.getCurrent();
        const next = cur.rivers.filter((r) => r.id !== id);
        commitRivers(next);
        set((s) => ({
          riverTool: {
            ...s.riverTool,
            selectedRiverId:
              s.riverTool.selectedRiverId === id ? null : s.riverTool.selectedRiverId,
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
        const cur = adapter.getCurrent();
        const next = cur.rivers.map((r) => (r.id === targetId ? { ...r, width: w } : r));
        commitRivers(next);
        set((s) => ({ riverTool: { ...s.riverTool, width: w } }));
      },

      undo: () => {
        const result = undoHistory(get().history, snapshot());
        if (!result) return;
        commit(result.restored);
        set((s) => ({
          history: result.next,
          selectedId: null,
          moving: false,
          ...STROKE_CLEAR,
          riverTool: { ...s.riverTool, editingRiverId: null, selectedRiverId: null },
        }));
      },

      redo: () => {
        const result = redoHistory(get().history, snapshot());
        if (!result) return;
        commit(result.restored);
        set((s) => ({
          history: result.next,
          selectedId: null,
          moving: false,
          ...STROKE_CLEAR,
          riverTool: { ...s.riverTool, editingRiverId: null, selectedRiverId: null },
        }));
      },

      canUndo: () => canUndoH(get().history),
      canRedo: () => canRedoH(get().history),

      exportJson: () => adapter.exportJson(),
    };
  });
