import { nanoid } from "nanoid";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { classifyPropUrl, TARGET_SIZE_BY_ROLE } from "../biomes";
import type { AutoBridge, PlacedProp, River, RiverMaterial, RiverPoint, Vec2 } from "../sim/types";
import { distPointToSegSq } from "../sim/vec2";
import { resolveBridges } from "./bridgeResolver";
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

// Effective half-footprint of a placed prop in world units. Single source of
// truth shared by canPlaceAt (level + world map) and brush sampling so the
// collision radius always matches the rendered silhouette: role-target size
// times the per-prop scale, halved (target size is full-extent, not radius).
export const propRadius = (url: string, scale: number): number =>
  TARGET_SIZE_BY_ROLE[classifyPropUrl(url)] * scale * 0.5;

// True if (x, y) lies within `padding` world units of any hand-painted
// river's polyline. Mirrors the per-segment scan in isOnFlowSurface's river
// loop. Used by the editor placement gate to refuse props that would
// overlap an authored river ribbon.
export const isOnRiver = (rivers: River[], x: number, y: number, padding: number): boolean => {
  for (const river of rivers) {
    const half = river.width / 2 + padding;
    const r2 = half * half;
    const pts = river.points;
    for (let i = 0; i < pts.length - 1; i++) {
      if (distPointToSegSq(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) < r2) return true;
    }
  }
  return false;
};

// River width clamp — keeps the ribbon usable (no zero-width or absurd widths).
const MIN_RIVER_WIDTH = 0.5;
const MAX_RIVER_WIDTH = 20;
export const DEFAULT_RIVER_WIDTH = 2.5;
const clampRiverWidth = (w: number): number =>
  Math.min(MAX_RIVER_WIDTH, Math.max(MIN_RIVER_WIDTH, w));
export const RIVER_MATERIALS: { id: RiverMaterial; label: string }[] = [
  { id: "water", label: "Water" },
  { id: "lava", label: "Lava" },
  { id: "toxic", label: "Toxic" },
];

// Distance (world units) inside which the river end-point is treated as
// "already at the edge" and snaps perpendicular. Outside that, the editor
// extrapolates the user's last stroke direction out to the nearest wall
// instead of warping the tail sideways — so a river drawn mid-map gets a
// natural tangent extension rather than a perpendicular jog.
export const RIVER_EDGE_SNAP_THRESHOLD = 1.5;

export type MapBounds = { halfW: number; halfH: number };

// Project `p` onto the nearest cardinal edge of the bounding rectangle,
// clamping the perpendicular coordinate so the result lands on the edge
// itself. Tie-break order Left, Right, Bottom, Top — deterministic across
// runs so identical rivers re-snap identically.
export const projectToEdge = (p: Vec2, b: MapBounds): Vec2 => {
  const left = Math.abs(p.x + b.halfW);
  const right = Math.abs(b.halfW - p.x);
  const bottom = Math.abs(p.y + b.halfH);
  const top = Math.abs(b.halfH - p.y);
  const nearest = Math.min(left, right, bottom, top);
  if (nearest === left) return { x: -b.halfW, y: Math.max(-b.halfH, Math.min(b.halfH, p.y)) };
  if (nearest === right) return { x: b.halfW, y: Math.max(-b.halfH, Math.min(b.halfH, p.y)) };
  if (nearest === bottom) return { x: Math.max(-b.halfW, Math.min(b.halfW, p.x)), y: -b.halfH };
  return { x: Math.max(-b.halfW, Math.min(b.halfW, p.x)), y: b.halfH };
};

// Signed distance to the nearest cardinal edge; positive inside the
// bounding box. Negative would mean the point already sits outside the
// rectangle, which the editor's clamps shouldn't allow, but the formula
// stays well-defined.
export const distToNearestEdge = (p: Vec2, b: MapBounds): number =>
  Math.min(b.halfW - Math.abs(p.x), b.halfH - Math.abs(p.y));

// Parametric ray-march from `last` along `(last - prev)` to the smallest
// positive `t` that hits a wall, then clamp the perpendicular onto the
// edge. Returns null if the direction is degenerate (lenSq < 1e-6) so the
// caller can fall back to projectToEdge.
export const extendToEdge = (prev: Vec2, last: Vec2, b: MapBounds): Vec2 | null => {
  const dx = last.x - prev.x;
  const dy = last.y - prev.y;
  if (dx * dx + dy * dy < 1e-6) return null;
  // Candidate ts: positive intersections with each wall.
  let bestT = Number.POSITIVE_INFINITY;
  if (dx > 0) {
    const t = (b.halfW - last.x) / dx;
    if (t > 0 && t < bestT) bestT = t;
  } else if (dx < 0) {
    const t = (-b.halfW - last.x) / dx;
    if (t > 0 && t < bestT) bestT = t;
  }
  if (dy > 0) {
    const t = (b.halfH - last.y) / dy;
    if (t > 0 && t < bestT) bestT = t;
  } else if (dy < 0) {
    const t = (-b.halfH - last.y) / dy;
    if (t > 0 && t < bestT) bestT = t;
  }
  if (!Number.isFinite(bestT)) return null;
  const x = last.x + dx * bestT;
  const y = last.y + dy * bestT;
  return {
    x: Math.max(-b.halfW, Math.min(b.halfW, x)),
    y: Math.max(-b.halfH, Math.min(b.halfH, y)),
  };
};

export type EditorSource = {
  props: PlacedProp[];
  override: boolean;
  rivers: River[];
  // Editor-managed bridges resolved per commit from rivers × paths and
  // persisted alongside the river polylines so they get stable ids,
  // material-themed palettes, and survive reloads.
  bridges: AutoBridge[];
  proceduralSeed?: number;
};

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
  clearManual?: () => void;
  clearProcedural?: () => void;
  reloadProcedural?: () => void;
  canPlaceAt?: (
    x: number,
    y: number,
    candidateRadius: number,
    ignorePropId?: string | null,
  ) => boolean;
  // Map bounds for the editable area. Used by the river tool to snap
  // endpoints to the nearest edge (with a threshold + direction-aware
  // extension) and by the auto-bridge resolver to find path crossings.
  // Returning null suppresses edge snapping entirely so the user keeps
  // whatever endpoint they painted.
  getMapBounds?: () => MapBounds | null;
  // Live paths the editor's bridge resolver should consider. The level
  // adapter reads useGame.world.paths; the world map has no path
  // geometry today so its adapter returns []. Called once per commit.
  getPaths?: () => Vec2[][];
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
  // Optional history persistence — load on store init, save on every
  // history mutation (push / undo / redo / clear). Adapters that omit
  // these keep history per-session in memory only.
  loadHistory?: () => History;
  saveHistory?: (history: History) => void;
};

export type BrushState = {
  active: boolean;
  presetId: string | null;
  // When true, paintAt removes props within radius instead of scattering.
  // Mutually exclusive with presetId — arming the eraser drops the preset,
  // and picking a preset disarms the eraser. Uses the same radius slider
  // and the same stroke-anchor gating as the scatter brush.
  eraser: boolean;
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
  material: RiverMaterial;
};

const DEFAULT_BRUSH: BrushState = {
  active: false,
  presetId: null,
  eraser: false,
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
  material: "water",
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
  clearManual: () => void;
  clearProcedural: () => void;
  reloadProcedural: () => void;
  setBrushPreset: (id: string | null) => void;
  setBrushEraser: (on: boolean) => void;
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
  setRiverMaterial: (material: RiverMaterial) => void;
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
        bridges: cur.bridges.map((b) => ({ ...b })),
        proceduralSeed: cur.proceduralSeed,
      };
    };

    // Persist history alongside the in-memory state. Every history mutation
    // (push / undo / redo / clear-reset) flows through here so the adapter
    // can mirror the change to localStorage.
    const setHistory = (h: History): void => {
      set({ history: h });
      adapter.saveHistory?.(h);
    };

    // Capture pre-mutation state onto the undo stack. Call BEFORE applying
    // a mutation. Resets the redo stack.
    const snapshotAndPush = (): void => {
      setHistory(pushHistory(get().history, snapshot()));
    };

    // Persist + invalidate downstream, then bump the store version so panel
    // and render-layer subscribers re-render.
    const commit = (next: EditorSource): void => {
      adapter.commit(next);
      set((s) => ({ version: s.version + 1 }));
    };

    // Replace just the props array, keeping override + rivers + bridges unchanged.
    const commitProps = (props: PlacedProp[]): void => {
      const cur = adapter.getCurrent();
      commit({
        props,
        override: cur.override,
        rivers: cur.rivers,
        bridges: cur.bridges,
        proceduralSeed: cur.proceduralSeed,
      });
    };

    // Replace just the rivers array, keeping props + override unchanged.
    // Every river edit funnels through here, so this is the single point
    // where editor-managed bridges get re-resolved (preserving stable ids +
    // user overrides via bridgeResolver). When the adapter doesn't expose
    // a path source (world-map editor today), the resolver runs against an
    // empty path set — i.e. no bridges, which matches the current world-map
    // render behaviour.
    const commitRivers = (rivers: River[]): void => {
      const cur = adapter.getCurrent();
      const paths = adapter.getPaths?.() ?? [];
      const bridges = resolveBridges(paths, rivers, cur.bridges);
      commit({
        props: cur.props,
        override: cur.override,
        rivers,
        bridges,
        proceduralSeed: cur.proceduralSeed,
      });
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
      history: adapter.loadHistory?.() ?? { past: [], future: [] },
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
          brush: { ...s.brush, active: false, eraser: false },
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
          brush: { ...s.brush, active: false, eraser: false },
          riverTool: { ...s.riverTool, active: false, editingRiverId: null, selectedRiverId: null },
        })),

      placeAt: (x, y) => {
        const url = get().placingUrl;
        if (!url) return;
        const radius = propRadius(url, 1);
        if (adapter.canPlaceAt && !adapter.canPlaceAt(x, y, radius, null)) return;
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
        const cur = adapter.getCurrent();
        const sel = cur.props.find((p) => p.id === id);
        if (!sel) return;
        const radius = propRadius(sel.url, sel.scale);
        if (adapter.canPlaceAt && !adapter.canPlaceAt(x, y, radius, id)) return;
        snapshotAndPush();
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
        commit({
          props: cur.props,
          override: on,
          rivers: cur.rivers,
          bridges: cur.bridges,
          proceduralSeed: cur.proceduralSeed,
        });
        set({ selectedId: null, moving: false, placingUrl: null });
        adapter.onOverrideChange?.();
      },

      clear: () => {
        adapter.clear();
        const fresh: History = { past: [], future: [] };
        set((s) => ({
          selectedId: null,
          moving: false,
          placingUrl: null,
          history: fresh,
          version: s.version + 1,
          ...STROKE_CLEAR,
          riverTool: { ...s.riverTool, active: false, editingRiverId: null, selectedRiverId: null },
        }));
        adapter.saveHistory?.(fresh);
        adapter.onClear?.();
      },

      clearManual: () => {
        snapshotAndPush();
        const cur = adapter.getCurrent();
        if (adapter.clearManual) {
          adapter.clearManual();
        } else {
          commit({
            props: [],
            override: cur.override,
            rivers: [],
            bridges: [],
            proceduralSeed: cur.proceduralSeed,
          });
        }
        set((s) => ({
          selectedId: null,
          moving: false,
          placingUrl: null,
          version: s.version + 1,
          ...STROKE_CLEAR,
          riverTool: { ...s.riverTool, editingRiverId: null, selectedRiverId: null },
        }));
      },

      clearProcedural: () => {
        snapshotAndPush();
        const cur = adapter.getCurrent();
        if (adapter.clearProcedural) {
          adapter.clearProcedural();
        } else {
          commit({
            props: cur.props,
            override: true,
            rivers: cur.rivers,
            bridges: cur.bridges,
            proceduralSeed: cur.proceduralSeed,
          });
        }
        set((s) => ({
          selectedId: null,
          moving: false,
          placingUrl: null,
          version: s.version + 1,
        }));
      },

      reloadProcedural: () => {
        snapshotAndPush();
        if (adapter.reloadProcedural) {
          adapter.reloadProcedural();
          set((s) => ({
            selectedId: null,
            moving: false,
            placingUrl: null,
            version: s.version + 1,
          }));
          return;
        }
        const cur = adapter.getCurrent();
        commit({
          props: cur.props,
          override: false,
          rivers: cur.rivers,
          bridges: cur.bridges,
          proceduralSeed: Date.now(),
        });
      },

      setBrushPreset: (id) => {
        const cur = get().brush;
        // Tap the active preset to disarm; tap any other preset to switch /
        // arm. Switching brush on disarms placingUrl + moving + selection.
        // The url filter is preset-scoped — drop it on every switch (incl.
        // disarm) so a re-arm of the same preset starts with the full roster.
        // Arming any preset also kicks the eraser off — they share the brush slot.
        if (id !== null && cur.presetId === id && cur.active && !cur.eraser) {
          set({ brush: { ...cur, active: false, customUrls: null } });
          return;
        }
        set((s) => ({
          brush: {
            ...s.brush,
            presetId: id,
            eraser: false,
            active: id !== null,
            customUrls: null,
          },
          placingUrl: null,
          selectedId: null,
          moving: false,
          // Arming a brush disarms the river tool — both consume the click plane.
          riverTool: { ...s.riverTool, active: false, editingRiverId: null, selectedRiverId: null },
        }));
      },

      setBrushEraser: (on) => {
        if (!on) {
          set((s) => ({ brush: { ...s.brush, eraser: false, active: false } }));
          return;
        }
        set((s) => ({
          brush: {
            ...s.brush,
            eraser: true,
            active: true,
            presetId: null,
            customUrls: null,
          },
          placingUrl: null,
          selectedId: null,
          moving: false,
          // Eraser shares the click plane with placement/river/scatter brush.
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
        if (!s.brush.active) return;

        // Open a stroke history entry once per drag — paint and eraser share
        // the same gating so one drag = one undo entry regardless of mode.
        const openStrokeEntry = (): void => {
          if (s.strokeOpen) {
            if (!s.strokePushed && s.strokeAnchor) {
              const anchor = s.strokeAnchor;
              setHistory(pushHistory(get().history, anchor));
              set({ strokePushed: true });
            }
          } else {
            // Out-of-stroke paint (defensive) — push a single history entry.
            setHistory(pushHistory(get().history, snapshot()));
          }
        };

        if (s.brush.eraser) {
          const cur = adapter.getCurrent();
          const radSq = s.brush.radius * s.brush.radius;
          const next = cur.props.filter((p) => {
            const dx = p.pos.x - x;
            const dy = p.pos.y - y;
            return dx * dx + dy * dy > radSq;
          });
          if (next.length === cur.props.length) return;
          openStrokeEntry();
          commitProps(next);
          if (s.selectedId !== null && !next.some((p) => p.id === s.selectedId)) {
            set({ selectedId: null });
          }
          return;
        }

        const preset = getBrushPreset(s.brush.presetId);
        if (!preset) return;
        const urls = resolveBrushUrls(preset, s.brush.customUrls);
        if (urls.length === 0) return;
        const cur = adapter.getCurrent();
        // Radius-tagged existing props so the per-candidate collision test
        // can compare sums-of-radii against actual rendered silhouettes (a
        // bare-point list would let small candidates clip into big trees).
        const existing: { x: number; y: number; r: number }[] = cur.props.map((p) => ({
          x: p.pos.x,
          y: p.pos.y,
          r: propRadius(p.url, p.scale),
        }));
        const candidates = samplePoints({ x, y }, s.brush.radius, s.brush.density);
        if (candidates.length === 0) return;
        // Same-stroke siblings — accepted candidates from earlier in THIS
        // paintAt call. Keeps intra-stroke spawns from overlapping each
        // other in dense bursts.
        const accepted: { x: number; y: number; r: number; url: string; scale: number }[] = [];
        // `minSpacing` is now an extra floor on top of role-radius gaps so
        // the slider semantics still make sense — boosts the effective
        // candidate radius when the author wants extra breathing room.
        const spacingFloor = Math.max(0, s.brush.minSpacing);
        const targetCount = s.brush.density;
        for (const pt of candidates) {
          if (accepted.length >= targetCount) break;
          const url = pickFromUrls(urls);
          const scale = randRange(preset.scaleJitter[0], preset.scaleJitter[1]);
          const r = Math.max(propRadius(url, scale), spacingFloor);
          let collides = false;
          for (const e of existing) {
            const sum = r + e.r;
            const dx = e.x - pt.x;
            const dy = e.y - pt.y;
            if (dx * dx + dy * dy < sum * sum) {
              collides = true;
              break;
            }
          }
          if (collides) continue;
          for (const sib of accepted) {
            const sum = r + sib.r;
            const dx = sib.x - pt.x;
            const dy = sib.y - pt.y;
            if (dx * dx + dy * dy < sum * sum) {
              collides = true;
              break;
            }
          }
          if (collides) continue;
          if (adapter.canPlaceAt && !adapter.canPlaceAt(pt.x, pt.y, r, null)) continue;
          accepted.push({ x: pt.x, y: pt.y, r, url, scale });
        }
        if (accepted.length === 0) return;
        openStrokeEntry();
        const additions: PlacedProp[] = accepted.map((a) => ({
          id: nanoid(8),
          url: a.url,
          pos: { x: a.x, y: a.y },
          scale: a.scale,
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
          brush: { ...s.brush, active: false, eraser: false },
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
        // Always snap the start to the nearest map edge — rivers as a
        // policy enter the playfield from off-screen, never start
        // mid-map. When the adapter doesn't know its bounds (world-map
        // editor today), keep the click position verbatim.
        const id = nanoid(8);
        const bounds = adapter.getMapBounds?.() ?? null;
        const start = bounds ? projectToEdge({ x, y }, bounds) : { x, y };
        const seed: River = {
          id,
          points: [start, { x: start.x + 0.01, y: start.y + 0.01 }],
          width: get().riverTool.width,
          material: get().riverTool.material,
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
          if (
            r.points.length === 2 &&
            r.points[1].x === r.points[0].x + 0.01 &&
            r.points[1].y === r.points[0].y + 0.01
          ) {
            return { ...r, points: [r.points[0], { x, y }] };
          }
          return { ...r, points: [...r.points, { x, y } as RiverPoint] };
        });
        commitRivers(next);
      },

      finishRiver: () => {
        const editingId = get().riverTool.editingRiverId;
        if (editingId === null) return;
        const bounds = adapter.getMapBounds?.() ?? null;
        if (!bounds) {
          set((s) => ({ riverTool: { ...s.riverTool, editingRiverId: null } }));
          return;
        }
        const cur = adapter.getCurrent();
        const river = cur.rivers.find((r) => r.id === editingId);
        if (!river) {
          set((s) => ({ riverTool: { ...s.riverTool, editingRiverId: null } }));
          return;
        }
        // Single-click finish: only the placeholder seed exists. Drop the
        // river entirely rather than persisting an unrenderable stub.
        const pts = river.points;
        const isPlaceholder =
          pts.length === 2 && pts[1].x === pts[0].x + 0.01 && pts[1].y === pts[0].y + 0.01;
        if (isPlaceholder) {
          commitRivers(cur.rivers.filter((r) => r.id !== editingId));
          set((s) => ({
            riverTool: {
              ...s.riverTool,
              editingRiverId: null,
              selectedRiverId:
                s.riverTool.selectedRiverId === editingId ? null : s.riverTool.selectedRiverId,
            },
          }));
          return;
        }
        const lastIdx = pts.length - 1;
        const last = pts[lastIdx];
        const prev = lastIdx >= 1 ? pts[lastIdx - 1] : null;
        const distAbs = Math.abs(distToNearestEdge(last, bounds));
        let nextPts: RiverPoint[];
        if (distAbs <= RIVER_EDGE_SNAP_THRESHOLD || !prev) {
          // Tail already sits near an edge (or there's no direction to
          // extrapolate from): replace the last point in place.
          const snapped = projectToEdge(last, bounds);
          nextPts = pts.map((p, i) => (i === lastIdx ? snapped : p));
        } else {
          // Extend the last stroke direction out to the nearest wall so the
          // river continues off-map along the tangent the user was drawing,
          // instead of jogging perpendicular to it.
          const edgePt = extendToEdge(prev, last, bounds);
          if (edgePt) {
            nextPts = [...pts, edgePt];
          } else {
            const snapped = projectToEdge(last, bounds);
            nextPts = pts.map((p, i) => (i === lastIdx ? snapped : p));
          }
        }
        commitRivers(cur.rivers.map((r) => (r.id === editingId ? { ...r, points: nextPts } : r)));
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
        const bounds = adapter.getMapBounds?.() ?? null;
        const next = cur.rivers.map((r) => {
          if (r.id !== riverId) return r;
          if (index < 0 || index >= r.points.length) return r;
          const last = r.points.length - 1;
          // Endpoint drags re-snap to the edge so a river always enters
          // and exits the map at the perimeter, matching the policy in
          // beginRiver/finishRiver. Interior point drags are free-form.
          const nextPoint =
            bounds && (index === 0 || index === last) ? projectToEdge({ x, y }, bounds) : { x, y };
          return { ...r, points: r.points.map((p, i) => (i === index ? nextPoint : p)) };
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

      setRiverMaterial: (material) => {
        const targetId = get().riverTool.editingRiverId ?? get().riverTool.selectedRiverId ?? null;
        if (targetId === null) {
          set((s) => ({ riverTool: { ...s.riverTool, material } }));
          return;
        }
        snapshotAndPush();
        const cur = adapter.getCurrent();
        commitRivers(cur.rivers.map((r) => (r.id === targetId ? { ...r, material } : r)));
        set((s) => ({ riverTool: { ...s.riverTool, material } }));
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
        adapter.saveHistory?.(result.next);
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
        adapter.saveHistory?.(result.next);
      },

      canUndo: () => canUndoH(get().history),
      canRedo: () => canRedoH(get().history),

      exportJson: () => adapter.exportJson(),
    };
  });
