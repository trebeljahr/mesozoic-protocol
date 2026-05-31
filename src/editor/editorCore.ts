import { nanoid } from "nanoid";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { classifyPropUrl, TARGET_SIZE_BY_ROLE } from "../biomes";
import type {
  AutoBridge,
  PlacedEasterEgg,
  PlacedProp,
  River,
  RiverMaterial,
  RiverPoint,
  Vec2,
} from "../sim/types";
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
import {
  computeCentroid,
  expandSelectionByGroup,
  pointInRect,
  type Rect,
  rectFromCorners,
  rotatePointAround,
  scalePointAround,
} from "./selectionCore";
import { addStamp, getStamp, removeStamp, type Stamp, type StampChild } from "./stampLibrary";

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

// Hover snap radius for the river tool's live cursor. Wider than the finish
// snap so the preview marker visibly "catches" on the edge before the user
// commits, and stays caught through small inward drift — without dragging
// mid-map control points sideways.
export const RIVER_EDGE_HOVER_SNAP_THRESHOLD = 3.5;

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

// Snap `p` to the nearest map edge if within `threshold` units, else
// return `p` unchanged. Shared by the hover preview and the click commit
// so what the user sees on hover is exactly what they get on click.
export const snapToEdgeIfNear = (p: Vec2, b: MapBounds, threshold: number): Vec2 =>
  distToNearestEdge(p, b) <= threshold ? projectToEdge(p, b) : p;

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
  // Author-placed easter eggs. Persisted alongside props/rivers; replaces
  // the random per-level egg pick at world build when non-empty. Level
  // adapter wires through; world-map adapter feeds an empty array.
  easterEggs: PlacedEasterEgg[];
  proceduralSeed?: number;
  // Per-position keys identifying procedural trees/rocks/outposts the
  // author erased or overwrote (createWorld filters the seeded set
  // through these on every load). Sources without procedural items
  // (world-map editor) leave this undefined.
  erasedProcedural?: string[];
};

// Single procedural item from an adapter that owns a seeded set-dressing
// layer (trees/rocks/outposts). x/y/r is its footprint in world units;
// `key` is the stable id the editor stores in `erasedProcedural`.
export type ProceduralItem = { x: number; y: number; r: number; key: string };

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
    // Widened to accept a single id, a (Readonly)Set of ids, or null. Single-
    // string callers (placeAt, moveSelectedTo) and Set callers (marquee /
    // group / stamp validation) take the same code path inside the adapter,
    // which normalises to a Set before the prop loop.
    ignorePropId?: string | ReadonlySet<string> | null,
  ) => boolean;
  // Snapshot of the adapter's seeded procedural items (trees/rocks/
  // outposts on the level editor; undefined on world-map). Called by the
  // eraser brush and placement actions so they can extend the editor's
  // erased-procedural mask to also bulldoze procedural decor that the
  // hand-placed action overlaps. Already-erased keys SHOULD be omitted —
  // the level adapter prunes them so the result is a live snapshot.
  getProceduralItems?: () => ProceduralItem[];
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

// Easter-egg tool state. `active` flips the editor into egg-placement mode
// (mutually exclusive with brush / river / prop placement). `placingDefId`
// is the armed egg type — every map click drops a fresh PlacedEasterEgg at
// the click pos with rotY=0. `selectedId` is the post-place selection for
// editing existing eggs (set direction, delete). `settingDirection`, when
// true, makes the next map click set the selected egg's rotY to the angle
// from its position toward the click pos.
export type EasterEggToolState = {
  active: boolean;
  placingDefId: string | null;
  selectedId: string | null;
  settingDirection: boolean;
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

const DEFAULT_EASTER_EGG_TOOL: EasterEggToolState = {
  active: false,
  placingDefId: null,
  selectedId: null,
  settingDirection: false,
};

// Marquee drag-rect state. `active` arms the tool (toggle button in the
// panel) and disables placing / brush / river (they share the click plane).
// `rect` holds the in-progress drag rectangle as normalised world-space AABB
// while the user is dragging — null between drags. `anchor` carries the
// press point so updateMarquee can rebuild the normalised AABB from
// (anchor, current) regardless of drag direction (drag-back-across-press
// works correctly because rectFromCorners normalises every call).
export type MarqueeToolState = {
  active: boolean;
  rect: Rect | null;
  anchor: Vec2 | null;
};

const DEFAULT_MARQUEE_TOOL: MarqueeToolState = {
  active: false,
  rect: null,
  anchor: null,
};

export type EditorStoreApi = {
  active: boolean;
  panelCollapsed: boolean;
  chromeHidden: boolean;
  // Asset url armed for placement — each map click drops one. null = select mode.
  placingUrl: string | null;
  // Authoritative multi-select set. Single-pick is just `selectedIds` with
  // size <= 1; the `selectedId` field below is a derived mirror kept in sync
  // on every mutation so unmigrated single-id readers stay green during the
  // transition to bulk operations.
  selectedIds: Set<string>;
  // Derived: first id in `selectedIds`, or null when empty. Every setter
  // that touches `selectedIds` also writes this field so subscribers using
  // `s.selectedId` re-render without needing to consume the Set directly.
  // First-in-set is deterministic in JS — insertion order is preserved.
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
  // Hold-to-rotate gate. While open, repeated rotateSelected calls collapse
  // into a single undo entry (snapshot pushed on the first call only). Closed
  // by default — UI buttons keep their one-press-one-entry behavior.
  rotateStrokeOpen: boolean;
  rotateStrokePushed: boolean;
  riverTool: RiverToolState;
  // Marquee drag-rect tool. Mutually exclusive with placing / brush / river
  // — arming any of those drops marquee and vice versa. While `active` is
  // false the rect is always null; while `active` is true the rect tracks
  // the in-progress drag (null between gestures).
  marqueeTool: MarqueeToolState;
  // Stamp armed for placement — when non-null, each map click drops the
  // stamp's children at the cursor (centroid-anchored). Mutually exclusive
  // with placingUrl / brush / river / moving / marquee. The id refers to a
  // stamp in the global library (loadStampLibrary().stamps); the resolution
  // is lazy inside placeStampAt so a stamp deleted mid-arm is a no-op rather
  // than a crash.
  placingStampId: string | null;
  // Bumped on every stamp-library mutation (save/delete) so EditorPanel's
  // catalog useMemo invalidates and re-merges stamp entries into the palette
  // without subscribing to localStorage. Lives on the store so both editors
  // (level + world map) see the same monotonically-increasing counter — a
  // stamp saved on one editor's panel surfaces in the other's palette as
  // soon as the user toggles their store's version (next interaction).
  // Intentionally NOT pushed onto the undo stack — stamps are tool config,
  // not map data, and Ctrl+Z restoring a deleted stamp would be surprising
  // behaviour.
  stampLibraryVersion: number;
  // Authoritative read of the underlying props/override/rivers. Defers to
  // the adapter so callers don't need to know whether state lives on the
  // store itself (world map) or on useGame.world (level editor).
  getCurrent: () => EditorSource;
  // Map bounds passthrough so the render layer can preview river-tool snap
  // targets with the same projection the commit path uses. Returns null
  // when the active adapter doesn't define an editable perimeter (world
  // map today) — render code should skip snap visualization in that case.
  getMapBounds: () => MapBounds | null;
  toggleActive: () => void;
  setPanelCollapsed: (collapsed: boolean) => void;
  setChromeHidden: (hidden: boolean) => void;
  setPlacing: (url: string | null) => void;
  placeAt: (x: number, y: number) => void;
  // Single-arg call (legacy back-compat): `select(id)` = replace; `select(null)` = clear.
  // `mode='add'` unions into existing selection; `mode='toggle'` flips one id
  // in/out (shift-click semantics). Passing `null` ignores `mode` and clears.
  select: (id: string | null, mode?: "replace" | "add" | "toggle") => void;
  // Bulk replacement (or addition) — used by marquee in a later step but
  // also fine to call directly for any "select N props" path.
  selectMany: (ids: string[], mode?: "replace" | "add") => void;
  // Drop selection without touching `moving` (kept for callers that want a
  // pure clear distinct from `select(null)`, e.g. background click).
  clearSelection: () => void;
  beginMove: () => void;
  moveSelectedTo: (x: number, y: number) => void;
  deleteSelected: () => void;
  // Bulk delete every prop in `selectedIds` as one snapshotAndPush. Safe to
  // call with size 0/1 — falls through to no-op / single-delete equivalents.
  deleteSelection: () => void;
  // Stamp a freshly minted groupId onto every prop in `selectedIds`. Reuses
  // a single nanoid(8) across all members so they share identity. Existing
  // groupIds are overwritten — re-grouping a mixed selection unifies them.
  // Selection is preserved post-mutation (the same ids stay selected, just
  // now sharing a groupId so a subsequent single-click on any member
  // expands back to the whole group). One snapshotAndPush.
  groupSelection: () => void;
  // Clear groupId on every prop in `selectedIds`. No-op for ungrouped
  // members. One snapshotAndPush.
  ungroupSelection: () => void;
  rotateSelected: (deltaRad: number) => void;
  beginRotateStroke: () => void;
  endRotateStroke: () => void;
  scaleSelected: (mul: number) => void;
  toggleSelectedBlocks: () => void;
  // Bulk transforms around the selection's centroid. Each is one
  // snapshotAndPush + one commitProps; all-or-nothing — if any member would
  // land in an invalid spot (path / river / colliding prop), the whole
  // gesture is rejected and nothing commits. Pre-existing groupId on each
  // member is preserved so groups survive transforms intact. Safe to call
  // with size 0/1: size 0 is a no-op; size 1 still works but the centroid
  // collapses to that single prop's position so rotate/scale become
  // identity for position (rot/scale on the prop itself still update).
  moveSelectionBy: (dx: number, dy: number) => void;
  // `targetCentroid` is the world-space point the user wants the cluster's
  // centroid to land on. We compute the delta off the current centroid and
  // shift every member by it — preserves relative layout exactly. Mirrors
  // single-prop `moveSelectedTo` UX (click map to relocate).
  moveSelectionToCentroid: (x: number, y: number) => void;
  rotateSelectionAroundCentroid: (deltaRad: number) => void;
  scaleSelectionAroundCentroid: (mul: number) => void;
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
  // Stamps. saveSelectionAsStamp captures the current selection into a new
  // stamp in the global library (localStorage key mz:stamplib:v1). Children
  // are stored centroid-normalised so re-dropping at any cursor position
  // preserves the authored layout. NOT pushed to undo — stamps are tool
  // config, not map data. `label` comes from a window.prompt in the panel.
  // No-op below 1 selected prop (a "stamp" of nothing isn't useful).
  saveSelectionAsStamp: (label: string) => void;
  // Remove a stamp from the global library. NOT pushed to undo. Caller
  // (EditorPanel) gates with a window.confirm before calling.
  deleteStamp: (stampId: string) => void;
  // Arm a stamp for placement. `setPlacingStamp(id)` arms; `setPlacingStamp(null)`
  // or passing the already-armed id disarms. Mutually exclusive with every
  // other click-plane tool — arming drops placingUrl / brush / river /
  // marquee / moving and clears the current selection (matches setPlacing's
  // contract). The id is resolved against loadStampLibrary().stamps inside
  // placeStampAt, so a stamp deleted while armed becomes a no-op drop.
  setPlacingStamp: (stampId: string | null) => void;
  // Drop the armed stamp at world (x, y) with the cursor treated as the
  // target centroid — every child's final position is (x + child.relPos.x,
  // y + child.relPos.y). All-or-nothing: any child colliding with a path /
  // river / existing prop / earlier-in-batch sibling aborts the whole drop
  // (no partial commits). On a successful drop: mint a fresh groupId,
  // snapshotAndPush once, commit the props in a single batch, and set the
  // selection to the newly minted ids so the user can immediately drag /
  // rotate / re-save the cluster. No-op when not armed.
  placeStampAt: (x: number, y: number) => void;
  setRiverToolActive: (on: boolean) => void;
  // Marquee gestures. `setMarqueeActive` toggles the tool (mutually
  // exclusive with placing/brush/river). `beginMarquee`/`updateMarquee`/
  // `endMarquee` form one drag — endMarquee finalises selectedIds from
  // every prop whose pos lies inside the rect's AABB (additive when
  // shift held on release).
  setMarqueeActive: (on: boolean) => void;
  beginMarquee: (x: number, y: number) => void;
  updateMarquee: (x: number, y: number) => void;
  endMarquee: (additive: boolean) => void;
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
  easterEggTool: EasterEggToolState;
  setEasterEggToolActive: (on: boolean) => void;
  setEasterEggPlacing: (defId: string | null) => void;
  placeEasterEggAt: (x: number, y: number) => void;
  selectEasterEgg: (id: string | null) => void;
  beginSetEasterEggDirection: () => void;
  setEasterEggDirectionAt: (x: number, y: number) => void;
  setEasterEggRotation: (rotY: number) => void;
  deleteEasterEgg: (id: string) => void;
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

// Reset both the authoritative Set and the derived single-id mirror in
// one shape — every "drop the current selection" site (toggleActive,
// setPlacing, brush toggles, undo/redo, …) spreads this so the two fields
// can never drift apart. Factory (not a shared const) because each clear
// must produce a fresh Set — sharing one instance would let any future
// in-place mutation in the store leak into every other cleared state.
const clearSelectionFields = (): { selectedIds: Set<string>; selectedId: null } => ({
  selectedIds: new Set<string>(),
  selectedId: null,
});

// Derive the single-id mirror from a Set. Empty -> null, otherwise the
// first id (insertion-order, which JS Sets preserve deterministically).
const firstOf = (ids: Set<string>): string | null => {
  if (ids.size === 0) return null;
  for (const id of ids) return id;
  return null;
};

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
        easterEggs: cur.easterEggs.map((e) => ({ ...e, pos: { ...e.pos } })),
        proceduralSeed: cur.proceduralSeed,
        erasedProcedural: cur.erasedProcedural ? [...cur.erasedProcedural] : undefined,
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
        easterEggs: cur.easterEggs,
        proceduralSeed: cur.proceduralSeed,
        erasedProcedural: cur.erasedProcedural,
      });
    };

    // Replace the props array AND extend the procedural-erase mask in one
    // commit. Used by the eraser brush (erases hand-placed and procedural
    // in a single stroke step) and by placement actions (auto-bulldozes
    // any procedural decor the new prop's footprint overlaps so the user
    // doesn't have to switch tools).
    const commitPropsAndErasedProcedural = (props: PlacedProp[], newErasedKeys: string[]): void => {
      const cur = adapter.getCurrent();
      const merged = newErasedKeys.length
        ? Array.from(new Set([...(cur.erasedProcedural ?? []), ...newErasedKeys]))
        : cur.erasedProcedural;
      commit({
        props,
        override: cur.override,
        rivers: cur.rivers,
        bridges: cur.bridges,
        easterEggs: cur.easterEggs,
        proceduralSeed: cur.proceduralSeed,
        erasedProcedural: merged,
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
        easterEggs: cur.easterEggs,
        proceduralSeed: cur.proceduralSeed,
      });
    };

    // Replace just the easterEggs array, keeping everything else unchanged.
    const commitEasterEggs = (easterEggs: PlacedEasterEgg[]): void => {
      const cur = adapter.getCurrent();
      commit({
        props: cur.props,
        override: cur.override,
        rivers: cur.rivers,
        bridges: cur.bridges,
        easterEggs,
        proceduralSeed: cur.proceduralSeed,
        erasedProcedural: cur.erasedProcedural,
      });
    };

    // Procedural-decor overlap probe shared by placement + brush scatter.
    // Returns the stable keys of procedural items whose footprint overlaps
    // a candidate of radius `r` at (x, y). Used to compute "what to also
    // erase" when a hand-placed action lands on top of seeded set-dressing.
    const collectOverlappingProcedural = (
      x: number,
      y: number,
      r: number,
      alreadyErased: ReadonlySet<string>,
    ): string[] => {
      const items = adapter.getProceduralItems?.() ?? [];
      if (items.length === 0) return [];
      const keys: string[] = [];
      for (const item of items) {
        if (alreadyErased.has(item.key)) continue;
        const sum = item.r + r;
        const dx = item.x - x;
        const dy = item.y - y;
        if (dx * dx + dy * dy < sum * sum) keys.push(item.key);
      }
      return keys;
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
      panelCollapsed: false,
      chromeHidden: false,
      placingUrl: null,
      ...clearSelectionFields(),
      moving: false,
      version: 0,
      history: adapter.loadHistory?.() ?? { past: [], future: [] },
      brush: DEFAULT_BRUSH,
      ...STROKE_CLEAR,
      rotateStrokeOpen: false,
      rotateStrokePushed: false,
      riverTool: DEFAULT_RIVER_TOOL,
      marqueeTool: DEFAULT_MARQUEE_TOOL,
      placingStampId: null,
      stampLibraryVersion: 0,

      getCurrent: () => adapter.getCurrent(),

      getMapBounds: () => adapter.getMapBounds?.() ?? null,

      toggleActive: () => {
        const next = !get().active;
        if (next) adapter.onActivate?.();
        set((s) => ({
          active: next,
          panelCollapsed: false,
          chromeHidden: next,
          placingUrl: null,
          ...clearSelectionFields(),
          moving: false,
          brush: { ...s.brush, active: false, eraser: false },
          ...STROKE_CLEAR,
          riverTool: { ...s.riverTool, active: false, editingRiverId: null, selectedRiverId: null },
          easterEggTool: {
            ...s.easterEggTool,
            active: false,
            placingDefId: null,
            selectedId: null,
            settingDirection: false,
          },
          marqueeTool: DEFAULT_MARQUEE_TOOL,
          placingStampId: null,
        }));
      },

      setPanelCollapsed: (collapsed) => set({ panelCollapsed: collapsed }),

      setChromeHidden: (hidden) => set({ chromeHidden: hidden }),

      setPlacing: (url) =>
        set((s) => ({
          // Clicking the armed asset again disarms back to select mode.
          // Arming a url drops any active brush/river/egg-tool — they share the click plane.
          placingUrl: s.placingUrl === url ? null : url,
          ...clearSelectionFields(),
          moving: false,
          brush: { ...s.brush, active: false, eraser: false },
          riverTool: { ...s.riverTool, active: false, editingRiverId: null, selectedRiverId: null },
          easterEggTool: {
            ...s.easterEggTool,
            active: false,
            placingDefId: null,
            selectedId: null,
            settingDirection: false,
          },
          marqueeTool: DEFAULT_MARQUEE_TOOL,
          placingStampId: null,
        })),

      placeAt: (x, y) => {
        const url = get().placingUrl;
        if (!url) return;
        const radius = propRadius(url, 1);
        const cur = adapter.getCurrent();
        // Overlapping authored props get overwritten so a click never silently
        // fails just because another prop sits underneath. Hard blockers
        // (paths/rivers/towers/trees/rocks/outposts/bounds) still refuse —
        // we hand the gate the overlap set so it tests as if those props were
        // already gone.
        const overlap = new Set<string>();
        for (const p of cur.props) {
          const r = propRadius(p.url, p.scale) + radius;
          const dx = p.pos.x - x;
          const dy = p.pos.y - y;
          if (dx * dx + dy * dy < r * r) overlap.add(p.id);
        }
        if (
          adapter.canPlaceAt &&
          !adapter.canPlaceAt(x, y, radius, overlap.size > 0 ? overlap : null)
        ) {
          return;
        }
        const prop: PlacedProp = {
          id: nanoid(8),
          url,
          pos: { x, y },
          scale: 1,
          rot: 0,
          blocks: defaultBlocks(url),
        };
        snapshotAndPush();
        // Procedural decor (trees/rocks/outposts) the new prop's footprint
        // covers gets bulldozed too — same overwrite logic as for hand-placed
        // props above, but routed through the erased-procedural mask.
        const procOverlap = collectOverlappingProcedural(
          x,
          y,
          radius,
          new Set(cur.erasedProcedural ?? []),
        );
        const kept = overlap.size > 0 ? cur.props.filter((p) => !overlap.has(p.id)) : cur.props;
        commitPropsAndErasedProcedural([...kept, prop], procOverlap);
        // Auto-select the freshly placed prop. Mirror the single id into both
        // the authoritative Set and the derived single-id field so legacy
        // subscribers and bulk-op readers see the same selection.
        set({ selectedIds: new Set([prop.id]), selectedId: prop.id });
      },

      // Mode-aware select. Default mode 'replace' keeps single-id back-compat
      // (every legacy single-arg call still works as before). 'add' unions
      // the id into the existing Set; 'toggle' flips it in/out (shift-click
      // semantics in PropHitTargets). Passing id=null always clears, even
      // when mode is non-default — there's no useful interpretation of
      // "add nothing" / "toggle nothing".
      //
      // Group expansion: 'replace' and 'toggle' both honour groupId — if the
      // clicked prop carries a groupId, every sibling sharing that groupId is
      // pulled into the seed. Ungrouped props expand to themselves only.
      // 'add' deliberately keeps single-id semantics so a user can still
      // build precise mixed selections via the API; the marquee / shift-
      // click UX paths use 'toggle' or 'replace' and so do expand.
      select: (id, mode = "replace") => {
        if (id === null) {
          set({ ...clearSelectionFields(), moving: false });
          return;
        }
        const propsArr = adapter.getCurrent().props;
        if (mode === "replace") {
          const expanded = expandSelectionByGroup(propsArr, new Set([id]));
          set({ selectedIds: expanded, selectedId: firstOf(expanded), moving: false });
          return;
        }
        const cur = get().selectedIds;
        if (mode === "add") {
          if (cur.has(id)) return;
          const next = new Set(cur);
          next.add(id);
          set({ selectedIds: next, selectedId: firstOf(next), moving: false });
          return;
        }
        // toggle — group-aware. If the clicked prop has a groupId and any
        // sibling in that group is currently selected, treat the group as
        // a unit and toggle the whole group in/out. Otherwise toggle just
        // the id (preserves shift-click semantics for ungrouped props and
        // for picking-additional-singletons paths).
        const clicked = propsArr.find((p) => p.id === id);
        const gid = clicked?.groupId;
        const next = new Set(cur);
        if (gid !== undefined) {
          const groupMembers = propsArr.filter((p) => p.groupId === gid).map((p) => p.id);
          const allSelected = groupMembers.every((mid) => next.has(mid));
          if (allSelected) {
            for (const mid of groupMembers) next.delete(mid);
          } else {
            for (const mid of groupMembers) next.add(mid);
          }
        } else if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        set({ selectedIds: next, selectedId: firstOf(next), moving: false });
      },

      selectMany: (ids, mode = "replace") => {
        const base = mode === "add" ? new Set(get().selectedIds) : new Set<string>();
        for (const id of ids) base.add(id);
        set({ selectedIds: base, selectedId: firstOf(base), moving: false });
      },

      // Match the legacy `select(null)` semantics by also dropping the
      // pending move — `moving` is only meaningful while a single prop is
      // selected, so a clear has no target left to relocate.
      clearSelection: () => set({ ...clearSelectionFields(), moving: false }),

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
        const ignore: ReadonlySet<string> = new Set([id]);
        if (adapter.canPlaceAt && !adapter.canPlaceAt(x, y, radius, ignore)) return;
        snapshotAndPush();
        const overlap = collectOverlappingProcedural(
          x,
          y,
          radius,
          new Set(cur.erasedProcedural ?? []),
        );
        commitPropsAndErasedProcedural(
          cur.props.map((p) => (p.id === id ? { ...p, pos: { x, y } } : p)),
          overlap,
        );
        set({ moving: false });
      },

      deleteSelected: () => {
        const id = get().selectedId;
        if (id === null) return;
        snapshotAndPush();
        const cur = adapter.getCurrent();
        commitProps(cur.props.filter((p) => p.id !== id));
        set({ ...clearSelectionFields(), moving: false });
      },

      deleteSelection: () => {
        const ids = get().selectedIds;
        if (ids.size === 0) return;
        snapshotAndPush();
        const cur = adapter.getCurrent();
        commitProps(cur.props.filter((p) => !ids.has(p.id)));
        set({ ...clearSelectionFields(), moving: false });
      },

      groupSelection: () => {
        const ids = get().selectedIds;
        // Single-prop "group" is meaningless — there's nothing to bind to.
        // Refuse below 2 to keep the action self-evidently useful.
        if (ids.size < 2) return;
        snapshotAndPush();
        const cur = adapter.getCurrent();
        const gid = nanoid(8);
        commitProps(cur.props.map((p) => (ids.has(p.id) ? { ...p, groupId: gid } : p)));
        // Selection unchanged — same ids stay selected, now sharing groupId.
        // Re-write the mirror to flush subscribers even though the Set
        // identity isn't strictly different; safe to skip and not needed.
      },

      ungroupSelection: () => {
        const ids = get().selectedIds;
        if (ids.size === 0) return;
        const cur = adapter.getCurrent();
        // Avoid a no-op snapshot when every selected prop is already
        // ungrouped — keeps the undo stack clean.
        const anyGrouped = cur.props.some((p) => ids.has(p.id) && p.groupId !== undefined);
        if (!anyGrouped) return;
        snapshotAndPush();
        commitProps(
          cur.props.map((p) => {
            if (!ids.has(p.id)) return p;
            if (p.groupId === undefined) return p;
            // Strip groupId. Use destructuring rest to drop the key cleanly
            // rather than setting it to undefined (which would still serialise
            // as { groupId: undefined } in some flows — the levelEdits blob
            // uses JSON.stringify which already drops undefined, but the
            // destructuring form keeps the in-memory shape clean too).
            const { groupId: _drop, ...rest } = p;
            return rest;
          }),
        );
      },

      rotateSelected: (deltaRad) => {
        const id = get().selectedId;
        if (id === null) return;
        const s = get();
        // While a rotate stroke is open (q/r held), only the first call pushes
        // history — subsequent calls fold into the same undo entry. Outside
        // a stroke (UI buttons) each press is its own entry, matching the
        // pre-stroke behavior.
        if (s.rotateStrokeOpen) {
          if (!s.rotateStrokePushed) {
            snapshotAndPush();
            set({ rotateStrokePushed: true });
          }
        } else {
          snapshotAndPush();
        }
        const cur = adapter.getCurrent();
        commitProps(cur.props.map((p) => (p.id === id ? { ...p, rot: p.rot + deltaRad } : p)));
      },
      beginRotateStroke: () => set({ rotateStrokeOpen: true, rotateStrokePushed: false }),
      endRotateStroke: () => set({ rotateStrokeOpen: false, rotateStrokePushed: false }),
      scaleSelected: (mul) => mutateSelected((p) => ({ ...p, scale: clampScale(p.scale * mul) })),
      toggleSelectedBlocks: () => mutateSelected((p) => ({ ...p, blocks: !p.blocks })),

      // Shift every selected prop by (dx, dy). Validates per-member with
      // Set-aware canPlaceAt so members landing on a path/river/another
      // (non-selected) prop reject the whole gesture. Same-selection members
      // are ignored during validation via the Set so a cluster sliding past
      // its own footprint can't self-collide. One snapshotAndPush.
      moveSelectionBy: (dx, dy) => {
        const ids = get().selectedIds;
        if (ids.size === 0) return;
        if (dx === 0 && dy === 0) return;
        const cur = adapter.getCurrent();
        // Build the next positions first so canPlaceAt can validate against
        // the post-move geometry. Reject the whole gesture if any landing
        // spot fails — partial moves would leave the group split.
        const updates = new Map<string, { x: number; y: number }>();
        for (const p of cur.props) {
          if (!ids.has(p.id)) continue;
          updates.set(p.id, { x: p.pos.x + dx, y: p.pos.y + dy });
        }
        if (adapter.canPlaceAt) {
          for (const p of cur.props) {
            const next = updates.get(p.id);
            if (!next) continue;
            const r = propRadius(p.url, p.scale);
            if (!adapter.canPlaceAt(next.x, next.y, r, ids)) return;
          }
        }
        snapshotAndPush();
        commitProps(
          cur.props.map((p) => {
            const next = updates.get(p.id);
            return next ? { ...p, pos: next } : p;
          }),
        );
      },

      // Convenience wrapper — click-to-pick-target-centroid UX. Computes the
      // delta from current centroid to the target and delegates to
      // moveSelectionBy so the validation + snapshot semantics stay identical.
      moveSelectionToCentroid: (x, y) => {
        const ids = get().selectedIds;
        if (ids.size === 0) return;
        const cur = adapter.getCurrent();
        const centroid = computeCentroid(cur.props, ids);
        const dx = x - centroid.x;
        const dy = y - centroid.y;
        if (dx === 0 && dy === 0) {
          // Still drop the pending move so the click "consumed" the gesture.
          set({ moving: false });
          return;
        }
        // Inline the same logic as moveSelectionBy so we don't push two
        // snapshots when invoked back-to-back from a UI handler — but reuse
        // the per-member validation pattern verbatim.
        const updates = new Map<string, { x: number; y: number }>();
        for (const p of cur.props) {
          if (!ids.has(p.id)) continue;
          updates.set(p.id, { x: p.pos.x + dx, y: p.pos.y + dy });
        }
        if (adapter.canPlaceAt) {
          for (const p of cur.props) {
            const next = updates.get(p.id);
            if (!next) continue;
            const r = propRadius(p.url, p.scale);
            if (!adapter.canPlaceAt(next.x, next.y, r, ids)) return;
          }
        }
        snapshotAndPush();
        commitProps(
          cur.props.map((p) => {
            const next = updates.get(p.id);
            return next ? { ...p, pos: next } : p;
          }),
        );
        set({ moving: false });
      },

      // Rotate every selected prop's position around the cluster centroid
      // and fold the delta into each prop's own `rot` so individual prop
      // orientations follow the cluster spin. Validates each member's new
      // landing spot; rejects whole gesture on any collision. One snapshot.
      rotateSelectionAroundCentroid: (deltaRad) => {
        const ids = get().selectedIds;
        if (ids.size === 0) return;
        if (deltaRad === 0) return;
        const cur = adapter.getCurrent();
        const centroid = computeCentroid(cur.props, ids);
        // Pre-compute next positions so canPlaceAt sees the final shape.
        const updates = new Map<string, { x: number; y: number }>();
        for (const p of cur.props) {
          if (!ids.has(p.id)) continue;
          updates.set(p.id, rotatePointAround(p.pos, centroid, deltaRad));
        }
        if (adapter.canPlaceAt) {
          for (const p of cur.props) {
            const next = updates.get(p.id);
            if (!next) continue;
            const r = propRadius(p.url, p.scale);
            if (!adapter.canPlaceAt(next.x, next.y, r, ids)) return;
          }
        }
        snapshotAndPush();
        commitProps(
          cur.props.map((p) => {
            const next = updates.get(p.id);
            if (!next) return p;
            return { ...p, pos: next, rot: p.rot + deltaRad };
          }),
        );
      },

      // Scale every selected prop's distance from the centroid by `mul` and
      // multiply each prop's own `scale` so silhouettes grow/shrink in
      // lockstep with the layout spread. Per-member scale is clamped to
      // [MIN_SCALE, MAX_SCALE]; the position scale itself is unclamped (a
      // cluster spread of `mul=0.2` is still a valid layout). Validates each
      // landing spot — rejects the whole gesture on any collision.
      scaleSelectionAroundCentroid: (mul) => {
        const ids = get().selectedIds;
        if (ids.size === 0) return;
        if (mul === 1 || mul <= 0) return;
        const cur = adapter.getCurrent();
        const centroid = computeCentroid(cur.props, ids);
        const updates = new Map<string, { pos: { x: number; y: number }; scale: number }>();
        for (const p of cur.props) {
          if (!ids.has(p.id)) continue;
          updates.set(p.id, {
            pos: scalePointAround(p.pos, centroid, mul),
            scale: clampScale(p.scale * mul),
          });
        }
        if (adapter.canPlaceAt) {
          for (const p of cur.props) {
            const next = updates.get(p.id);
            if (!next) continue;
            // Validate against the new (scaled) silhouette — a cluster
            // growing by 1.5× pushes outward AND each silhouette swells, so
            // both contribute to the candidate radius.
            const r = propRadius(p.url, next.scale);
            if (!adapter.canPlaceAt(next.pos.x, next.pos.y, r, ids)) return;
          }
        }
        snapshotAndPush();
        commitProps(
          cur.props.map((p) => {
            const next = updates.get(p.id);
            if (!next) return p;
            return { ...p, pos: next.pos, scale: next.scale };
          }),
        );
      },

      setOverride: (on) => {
        snapshotAndPush();
        const cur = adapter.getCurrent();
        commit({
          props: cur.props,
          override: on,
          rivers: cur.rivers,
          bridges: cur.bridges,
          easterEggs: cur.easterEggs,
          proceduralSeed: cur.proceduralSeed,
          erasedProcedural: cur.erasedProcedural,
        });
        set({
          ...clearSelectionFields(),
          moving: false,
          placingUrl: null,
          marqueeTool: DEFAULT_MARQUEE_TOOL,
          placingStampId: null,
        });
        adapter.onOverrideChange?.();
      },

      clear: () => {
        adapter.clear();
        const fresh: History = { past: [], future: [] };
        set((s) => ({
          ...clearSelectionFields(),
          moving: false,
          placingUrl: null,
          history: fresh,
          version: s.version + 1,
          ...STROKE_CLEAR,
          riverTool: { ...s.riverTool, active: false, editingRiverId: null, selectedRiverId: null },
          easterEggTool: {
            ...s.easterEggTool,
            active: false,
            placingDefId: null,
            selectedId: null,
            settingDirection: false,
          },
          marqueeTool: DEFAULT_MARQUEE_TOOL,
          placingStampId: null,
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
            easterEggs: [],
            proceduralSeed: cur.proceduralSeed,
            erasedProcedural: cur.erasedProcedural,
          });
        }
        set((s) => ({
          ...clearSelectionFields(),
          moving: false,
          placingUrl: null,
          version: s.version + 1,
          ...STROKE_CLEAR,
          riverTool: { ...s.riverTool, editingRiverId: null, selectedRiverId: null },
          easterEggTool: {
            ...s.easterEggTool,
            placingDefId: null,
            selectedId: null,
            settingDirection: false,
          },
          marqueeTool: DEFAULT_MARQUEE_TOOL,
          placingStampId: null,
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
            easterEggs: cur.easterEggs,
            proceduralSeed: cur.proceduralSeed,
            erasedProcedural: [],
          });
        }
        set((s) => ({
          ...clearSelectionFields(),
          moving: false,
          placingUrl: null,
          version: s.version + 1,
          marqueeTool: DEFAULT_MARQUEE_TOOL,
          placingStampId: null,
        }));
      },

      reloadProcedural: () => {
        snapshotAndPush();
        if (adapter.reloadProcedural) {
          adapter.reloadProcedural();
          set((s) => ({
            ...clearSelectionFields(),
            moving: false,
            placingUrl: null,
            version: s.version + 1,
            marqueeTool: DEFAULT_MARQUEE_TOOL,
            placingStampId: null,
          }));
          return;
        }
        const cur = adapter.getCurrent();
        commit({
          props: cur.props,
          override: false,
          rivers: cur.rivers,
          bridges: cur.bridges,
          easterEggs: cur.easterEggs,
          proceduralSeed: Date.now(),
          erasedProcedural: [],
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
          ...clearSelectionFields(),
          moving: false,
          // Arming a brush disarms the river + egg tools — they share the click plane.
          riverTool: { ...s.riverTool, active: false, editingRiverId: null, selectedRiverId: null },
          easterEggTool: {
            ...s.easterEggTool,
            active: false,
            placingDefId: null,
            selectedId: null,
            settingDirection: false,
          },
          marqueeTool: DEFAULT_MARQUEE_TOOL,
          placingStampId: null,
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
          ...clearSelectionFields(),
          moving: false,
          // Eraser shares the click plane with placement/river/egg/scatter brush.
          riverTool: { ...s.riverTool, active: false, editingRiverId: null, selectedRiverId: null },
          easterEggTool: {
            ...s.easterEggTool,
            active: false,
            placingDefId: null,
            selectedId: null,
            settingDirection: false,
          },
          marqueeTool: DEFAULT_MARQUEE_TOOL,
          placingStampId: null,
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
          // Procedural decor (trees/rocks/outposts) is keyed in the
          // erased-procedural mask the same way hand-placed props are
          // dropped from the props array — center-in-radius, matching
          // the rule above so one brush stroke clears both layers
          // uniformly.
          const already = new Set(cur.erasedProcedural ?? []);
          const procItems = adapter.getProceduralItems?.() ?? [];
          const newErased: string[] = [];
          for (const item of procItems) {
            if (already.has(item.key)) continue;
            const dx = item.x - x;
            const dy = item.y - y;
            if (dx * dx + dy * dy <= radSq) newErased.push(item.key);
          }
          const erasedProps = next.length !== cur.props.length;
          const erasedProc = newErased.length > 0;
          if (!erasedProps && !erasedProc) return;
          openStrokeEntry();
          commitPropsAndErasedProcedural(next, newErased);
          if (s.selectedId !== null && !next.some((p) => p.id === s.selectedId)) {
            // Re-derive the mirror from a filtered Set so multi-select
            // survives partial eraser overlaps (single-select unchanged).
            const remaining = new Set<string>();
            for (const id of s.selectedIds) {
              if (next.some((p) => p.id === id)) remaining.add(id);
            }
            set({ selectedIds: remaining, selectedId: firstOf(remaining) });
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
        const erasedSoFar = new Set(cur.erasedProcedural ?? []);
        const newErased: string[] = [];
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
          // Per-candidate procedural bulldozing — each accepted sample
          // contributes its overlaps to the stroke's erase batch. The
          // erasedSoFar set keeps duplicates and re-hits from compounding.
          const overlap = collectOverlappingProcedural(pt.x, pt.y, r, erasedSoFar);
          for (const key of overlap) {
            erasedSoFar.add(key);
            newErased.push(key);
          }
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
        commitPropsAndErasedProcedural([...cur.props, ...additions], newErased);
      },

      endStroke: () => {
        set(STROKE_CLEAR);
      },

      // Capture the current selection into a new stamp. Children are stored
      // centroid-normalised (relPos = pos - centroid) so the authored layout
      // survives any re-drop position. The stamp's role is the role of the
      // child closest to the centroid — that picks the palette bucket so a
      // tree-heavy "campsite" lands under Trees rather than spawning a new
      // "Stamps" tab. Intentionally NOT pushed onto the undo stack —
      // stamps are tool config (saved to localStorage outside the per-level
      // / world-map blobs), not map data; Ctrl+Z restoring a deleted stamp
      // would be surprising.
      saveSelectionAsStamp: (label) => {
        const ids = get().selectedIds;
        if (ids.size === 0) return;
        const trimmed = label.trim();
        if (trimmed.length === 0) return;
        const cur = adapter.getCurrent();
        const selected = cur.props.filter((p) => ids.has(p.id));
        if (selected.length === 0) return;
        const centroid = computeCentroid(cur.props, ids);
        // Pick the role of the child closest to the centroid — drives the
        // palette bucket (so stamps slot in next to similar-role models).
        // Squared distance keeps the comparison branch-free.
        let nearest = selected[0];
        let nearestDistSq = Number.POSITIVE_INFINITY;
        for (const p of selected) {
          const dx = p.pos.x - centroid.x;
          const dy = p.pos.y - centroid.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < nearestDistSq) {
            nearestDistSq = d2;
            nearest = p;
          }
        }
        const children: StampChild[] = selected.map((p) => ({
          url: p.url,
          relPos: { x: p.pos.x - centroid.x, y: p.pos.y - centroid.y },
          scale: p.scale,
          rot: p.rot,
          blocks: p.blocks,
        }));
        const stamp: Stamp = {
          id: nanoid(8),
          label: trimmed,
          role: classifyPropUrl(nearest.url),
          childCount: children.length,
          children,
          createdAt: new Date().toISOString(),
        };
        addStamp(stamp);
        set((s) => ({ stampLibraryVersion: s.stampLibraryVersion + 1 }));
      },

      // Remove a stamp from the global library. NOT pushed onto undo —
      // matches saveSelectionAsStamp; the panel gates with a window.confirm.
      // Bumping stampLibraryVersion invalidates EditorPanel's catalog memo
      // so the swatch disappears on the next render.
      deleteStamp: (stampId) => {
        removeStamp(stampId);
        set((s) => ({
          stampLibraryVersion: s.stampLibraryVersion + 1,
          // If the deleted stamp was armed, disarm it so a stale id isn't
          // left dangling on the next click (placeStampAt would no-op via
          // getStamp returning null, but disarming is the clean state).
          placingStampId: s.placingStampId === stampId ? null : s.placingStampId,
        }));
      },

      // Arm / disarm a stamp for placement. Mutually exclusive with every
      // other click-plane tool — arming drops placingUrl / brush / river /
      // marquee / moving and clears the current selection. Passing the
      // already-armed id (or null) disarms. This mirrors setPlacing's
      // toggle-on-rearm UX so a second click on a swatch disarms.
      setPlacingStamp: (stampId) => {
        set((s) => ({
          placingStampId: s.placingStampId === stampId ? null : stampId,
          placingUrl: null,
          ...clearSelectionFields(),
          moving: false,
          brush: { ...s.brush, active: false, eraser: false },
          riverTool: { ...s.riverTool, active: false, editingRiverId: null, selectedRiverId: null },
          easterEggTool: {
            ...s.easterEggTool,
            active: false,
            placingDefId: null,
            selectedId: null,
            settingDirection: false,
          },
          marqueeTool: DEFAULT_MARQUEE_TOOL,
        }));
      },

      // Drop the armed stamp at (x, y). All-or-nothing: a single child
      // colliding with a path / river / existing prop / earlier-in-batch
      // sibling aborts the whole drop. The cursor IS the target centroid —
      // every child's final position is (x + relPos.x, y + relPos.y),
      // matching saveSelectionAsStamp's centroid-normalised storage.
      //
      // Same-batch siblings are validated via an `accepted` accumulator
      // (mirrors paintAt's same-stroke collision pattern), since
      // canPlaceAt iterates cur.props and can't see in-flight siblings.
      //
      // On success: mint a fresh groupId, one snapshotAndPush, one
      // commitProps([...cur, ...stamped]), and set selectedIds to the new
      // child ids so the user can immediately drag / rotate / re-save the
      // dropped cluster. The armed stamp is left armed — the user can
      // drop multiples by clicking repeatedly; Esc / re-clicking the
      // swatch disarms.
      placeStampAt: (x, y) => {
        const stampId = get().placingStampId;
        if (stampId === null) return;
        const stamp = getStamp(stampId);
        // Defend against a stamp that was deleted while armed (the disarm
        // hook in deleteStamp handles the common case, but another tab
        // could have removed the entry).
        if (!stamp || stamp.children.length === 0) {
          set({ placingStampId: null });
          return;
        }
        const cur = adapter.getCurrent();
        // Pre-mint a shared groupId and per-child ids so a successful drop
        // can commit in one batch with stable identity. Children walk in
        // stamp.children order: canPlaceAt validates each against cur.props
        // (paths / rivers / pre-existing props) and a separate pairwise
        // pass validates against accepted siblings (which aren't in
        // cur.props yet, so canPlaceAt can't see them). This is the same
        // accepted-accumulator pattern paintAt uses for same-stroke
        // collision (editorCore.ts paintAt loop).
        const groupId = nanoid(8);
        const childIds: string[] = stamp.children.map(() => nanoid(8));
        const accepted: PlacedProp[] = [];
        for (let i = 0; i < stamp.children.length; i++) {
          const child = stamp.children[i];
          const finalX = x + child.relPos.x;
          const finalY = y + child.relPos.y;
          const radius = propRadius(child.url, child.scale);
          if (adapter.canPlaceAt && !adapter.canPlaceAt(finalX, finalY, radius, null)) {
            // Any collision with existing geometry aborts the whole drop.
            return;
          }
          // Same-batch sibling collision check — required because canPlaceAt
          // iterates cur.props, not our pending batch. Mirrors paintAt's
          // same-stroke gate.
          let siblingCollides = false;
          for (const sib of accepted) {
            const sumR = radius + propRadius(sib.url, sib.scale);
            const dx = sib.pos.x - finalX;
            const dy = sib.pos.y - finalY;
            if (dx * dx + dy * dy < sumR * sumR) {
              siblingCollides = true;
              break;
            }
          }
          if (siblingCollides) return;
          accepted.push({
            id: childIds[i],
            url: child.url,
            pos: { x: finalX, y: finalY },
            scale: child.scale,
            rot: child.rot,
            blocks: child.blocks,
            groupId,
          });
        }
        if (accepted.length === 0) return;
        snapshotAndPush();
        commitProps([...cur.props, ...accepted]);
        // Auto-select the freshly stamped group so the user can immediately
        // drag / rotate / re-save without re-picking. Mirrors placeAt's
        // post-drop selection behaviour. Leaves placingStampId armed so the
        // user can drop multiples — Esc or re-clicking the swatch disarms.
        const sel = new Set(childIds);
        set({ selectedIds: sel, selectedId: firstOf(sel), moving: false });
      },

      setRiverToolActive: (on) => {
        if (on) adapter.onActivate?.();
        set((s) => ({
          // Mutually exclusive with prop placement / move / brush / egg tool.
          placingUrl: null,
          ...clearSelectionFields(),
          moving: false,
          brush: { ...s.brush, active: false, eraser: false },
          riverTool: {
            ...s.riverTool,
            active: on,
            // Disarm in-progress stroke when toggling off; preserve selection
            // so a re-toggle still has the last-edited river highlighted.
            editingRiverId: on ? s.riverTool.editingRiverId : null,
          },
          easterEggTool: on
            ? {
                ...s.easterEggTool,
                active: false,
                placingDefId: null,
                selectedId: null,
                settingDirection: false,
              }
            : s.easterEggTool,
          // Arming the river tool drops the marquee + any armed stamp paste —
          // they share the click plane. Toggling off leaves them untouched
          // (the user might have been mid-marquee on a separate gesture, but
          // a river-tool toggle is a hard re-arm boundary in practice).
          marqueeTool: on ? DEFAULT_MARQUEE_TOOL : s.marqueeTool,
          placingStampId: on ? null : s.placingStampId,
        }));
      },

      setMarqueeActive: (on) => {
        set((s) => ({
          // Mutually exclusive with prop placement / move / brush / river /
          // egg-tool — all five consume the click plane. Toggling marquee
          // off drops the in-progress rect; toggling on clears any other
          // armed tool.
          placingUrl: on ? null : s.placingUrl,
          moving: on ? false : s.moving,
          brush: on ? { ...s.brush, active: false, eraser: false } : s.brush,
          riverTool: on
            ? { ...s.riverTool, active: false, editingRiverId: null, selectedRiverId: null }
            : s.riverTool,
          easterEggTool: on
            ? {
                ...s.easterEggTool,
                active: false,
                placingDefId: null,
                selectedId: null,
                settingDirection: false,
              }
            : s.easterEggTool,
          marqueeTool: { active: on, rect: null, anchor: null },
          // Arming marquee disarms any stamp paste. Disarming marquee
          // leaves placingStampId untouched (toolbar transitions between
          // marquee → stamp are handled by setPlacingStamp itself).
          placingStampId: on ? null : s.placingStampId,
        }));
      },

      beginMarquee: (x, y) => {
        // Stash the press point as the anchor and seed a degenerate rect at
        // the same location. updateMarquee rebuilds the normalised AABB from
        // (anchor, current) each move so drag-back-across-press works
        // correctly without per-frame anchor inference.
        set((s) => ({
          marqueeTool: {
            ...s.marqueeTool,
            anchor: { x, y },
            rect: { minX: x, minY: y, maxX: x, maxY: y },
          },
        }));
      },

      updateMarquee: (x, y) => {
        const cur = get().marqueeTool;
        if (!cur.active || !cur.anchor) return;
        set((s) => {
          const anchor = s.marqueeTool.anchor;
          if (!anchor) return s;
          return {
            marqueeTool: {
              ...s.marqueeTool,
              rect: rectFromCorners(anchor.x, anchor.y, x, y),
            },
          };
        });
      },

      endMarquee: (additive) => {
        const cur = get().marqueeTool;
        if (!cur.active) return;
        const rect = cur.rect;
        // Always close the rect (drop the in-progress overlay + anchor) —
        // selection resolves below.
        set((s) => ({ marqueeTool: { ...s.marqueeTool, rect: null, anchor: null } }));
        if (!rect) return;
        const props = adapter.getCurrent().props;
        const hits = new Set<string>();
        for (const p of props) {
          if (pointInRect(p.pos, rect)) hits.add(p.id);
        }
        // Empty marquee + non-additive = clear selection.
        if (hits.size === 0 && !additive) {
          set({ ...clearSelectionFields(), moving: false });
          return;
        }
        const base = additive ? new Set(get().selectedIds) : new Set<string>();
        for (const id of hits) base.add(id);
        set({ selectedIds: base, selectedId: firstOf(base), moving: false });
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

      easterEggTool: DEFAULT_EASTER_EGG_TOOL,

      setEasterEggToolActive: (on) => {
        // Mutually exclusive with every other click-plane tool — turning the
        // egg tool on disarms placingUrl + brush + river + marquee + stamp
        // so map clicks go through the egg handler.
        set((s) => ({
          easterEggTool: {
            ...s.easterEggTool,
            active: on,
            placingDefId: on ? s.easterEggTool.placingDefId : null,
            selectedId: on ? s.easterEggTool.selectedId : null,
            settingDirection: false,
          },
          placingUrl: on ? null : s.placingUrl,
          // Clear prop selection (Set + derived mirror) when egg tool turns
          // on so the egg-tool selection is the only live selection. When
          // turning off, preserve the existing prop selection — the user
          // might have toggled the egg tool by accident.
          ...(on ? clearSelectionFields() : {}),
          moving: false,
          brush: { ...s.brush, active: on ? false : s.brush.active, eraser: false },
          riverTool: {
            ...s.riverTool,
            active: on ? false : s.riverTool.active,
            editingRiverId: on ? null : s.riverTool.editingRiverId,
            selectedRiverId: on ? null : s.riverTool.selectedRiverId,
          },
          marqueeTool: on ? DEFAULT_MARQUEE_TOOL : s.marqueeTool,
          placingStampId: on ? null : s.placingStampId,
        }));
      },

      setEasterEggPlacing: (defId) =>
        set((s) => ({
          easterEggTool: {
            ...s.easterEggTool,
            active: true,
            placingDefId: s.easterEggTool.placingDefId === defId ? null : defId,
            // Arming a fresh egg type clears any prior selection so the next
            // click drops a new egg rather than relocating the selected one.
            selectedId: null,
            settingDirection: false,
          },
        })),

      placeEasterEggAt: (x, y) => {
        const tool = get().easterEggTool;
        if (!tool.active || !tool.placingDefId) return;
        const egg: PlacedEasterEgg = {
          id: nanoid(8),
          defId: tool.placingDefId,
          pos: { x, y },
          rotY: 0,
        };
        snapshotAndPush();
        const cur = adapter.getCurrent();
        commitEasterEggs([...cur.easterEggs, egg]);
        set((s) => ({
          easterEggTool: { ...s.easterEggTool, selectedId: egg.id, settingDirection: false },
        }));
      },

      selectEasterEgg: (id) =>
        set((s) => ({
          easterEggTool: {
            ...s.easterEggTool,
            active: true,
            selectedId: id,
            placingDefId: null,
            settingDirection: false,
          },
        })),

      beginSetEasterEggDirection: () => {
        if (get().easterEggTool.selectedId === null) return;
        set((s) => ({ easterEggTool: { ...s.easterEggTool, settingDirection: true } }));
      },

      setEasterEggDirectionAt: (x, y) => {
        const tool = get().easterEggTool;
        if (!tool.settingDirection || tool.selectedId === null) return;
        const cur = adapter.getCurrent();
        const sel = cur.easterEggs.find((e) => e.id === tool.selectedId);
        if (!sel) return;
        // Heading from egg toward click pos. Same convention as
        // spawnMovingEasterEgg: rotY = atan2(dx, -dy) so model-forward at
        // rotY=0 points up the game-y axis (-z in render space).
        const dx = x - sel.pos.x;
        const dy = y - sel.pos.y;
        if (dx * dx + dy * dy < 1e-4) return;
        const rotY = Math.atan2(dx, -dy);
        snapshotAndPush();
        commitEasterEggs(cur.easterEggs.map((e) => (e.id === sel.id ? { ...e, rotY } : e)));
        set((s) => ({ easterEggTool: { ...s.easterEggTool, settingDirection: false } }));
      },

      setEasterEggRotation: (rotY) => {
        const tool = get().easterEggTool;
        if (tool.selectedId === null) return;
        snapshotAndPush();
        const cur = adapter.getCurrent();
        commitEasterEggs(
          cur.easterEggs.map((e) => (e.id === tool.selectedId ? { ...e, rotY } : e)),
        );
      },

      deleteEasterEgg: (id) => {
        snapshotAndPush();
        const cur = adapter.getCurrent();
        commitEasterEggs(cur.easterEggs.filter((e) => e.id !== id));
        set((s) => ({
          easterEggTool: {
            ...s.easterEggTool,
            selectedId: s.easterEggTool.selectedId === id ? null : s.easterEggTool.selectedId,
            settingDirection: false,
          },
        }));
      },

      undo: () => {
        const result = undoHistory(get().history, snapshot());
        if (!result) return;
        commit(result.restored);
        set((s) => ({
          history: result.next,
          ...clearSelectionFields(),
          moving: false,
          ...STROKE_CLEAR,
          riverTool: { ...s.riverTool, editingRiverId: null, selectedRiverId: null },
          marqueeTool: { ...s.marqueeTool, rect: null, anchor: null },
        }));
        adapter.saveHistory?.(result.next);
      },

      redo: () => {
        const result = redoHistory(get().history, snapshot());
        if (!result) return;
        commit(result.restored);
        set((s) => ({
          history: result.next,
          ...clearSelectionFields(),
          moving: false,
          ...STROKE_CLEAR,
          riverTool: { ...s.riverTool, editingRiverId: null, selectedRiverId: null },
          marqueeTool: { ...s.marqueeTool, rect: null, anchor: null },
        }));
        adapter.saveHistory?.(result.next);
      },

      canUndo: () => canUndoH(get().history),
      canRedo: () => canRedoH(get().history),

      exportJson: () => adapter.exportJson(),
    };
  });
