import { nanoid } from "nanoid";
import { create } from "zustand";
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
import {
  clearWorldMapEdit,
  loadWorldMapEdit,
  saveWorldMapEdit,
  type WorldMapEdit,
} from "./worldMapEdits";

// Dev-only world-map editor state. Mirrors editorStore.ts but owns its own
// props array + version invalidation (no dependency on useGame.treeVersion)
// because the world map scene is not a per-level world. Persisted to a
// single localStorage entry — the world map is global, not level-scoped.

const BLOCKING_ROLES = new Set(["building", "tree", "bush", "rock"]);
const defaultBlocks = (url: string): boolean => BLOCKING_ROLES.has(classifyPropUrl(url));

const MIN_SCALE = 0.15;
const MAX_SCALE = 6;
const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

type BrushState = {
  active: boolean;
  presetId: string | null;
  radius: number;
  density: number;
  minSpacing: number;
  customUrls: string[] | null;
};

// River width clamp — mirrors editorStore.ts. Kept duplicated rather than
// extracted to a shared module so the two editor stores stay independent of
// each other (per-level editor has no need to import the world-map editor).
const MIN_RIVER_WIDTH = 0.5;
const MAX_RIVER_WIDTH = 20;
const DEFAULT_RIVER_WIDTH = 2.5;
const clampRiverWidth = (w: number): number =>
  Math.min(MAX_RIVER_WIDTH, Math.max(MIN_RIVER_WIDTH, w));

// See RiverToolState in editorStore.ts for the field semantics. Mirrored
// here for the world-map editor; the two stores stay independent.
type RiverToolState = {
  active: boolean;
  editingRiverId: string | null;
  selectedRiverId: string | null;
  width: number;
};

type WorldMapEditorState = {
  active: boolean;
  placingUrl: string | null;
  selectedId: string | null;
  moving: boolean;
  props: PlacedProp[];
  rivers: River[];
  override: boolean;
  riverTool: RiverToolState;
  // Static-geometry invalidation key. Bumped on every mutation so the
  // render layer can re-derive its instanced groups.
  version: number;
  brush: BrushState;
  strokeAnchor: Snapshot | null;
  strokeOpen: boolean;
  strokePushed: boolean;
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
  clearAll: () => void;
  setBrushPreset: (id: string | null) => void;
  setBrushParams: (p: { radius?: number; density?: number; minSpacing?: number }) => void;
  toggleBrushUrl: (url: string) => void;
  resetBrushUrls: () => void;
  beginStroke: () => void;
  paintAt: (x: number, y: number) => void;
  endStroke: () => void;
  // River-tool actions. See editorStore.ts for behavior parity.
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

const DEFAULT_BRUSH: BrushState = {
  active: false,
  presetId: null,
  radius: 4,
  density: 8,
  minSpacing: 1.0,
  customUrls: null,
};

const persist = (props: PlacedProp[], override: boolean, rivers: River[]): void => {
  const edit: WorldMapEdit = { v: 1, override, props, rivers };
  saveWorldMapEdit(edit);
};

// PURE annotation: tree-shake the whole world-map editor surface out of
// production builds where the only consumers (WorldMapEditorPanel /
// WorldMapEditorProps) are dead-coded behind import.meta.env.DEV. The
// localStorage seed lives inside the factory so it only runs when create()
// actually executes (i.e. when a DEV consumer subscribes).
export const useWorldMapEditor = /* @__PURE__ */ create<WorldMapEditorState>((set, get) => {
  const seed = loadWorldMapEdit();

  const snapshot = (): Snapshot => ({
    props: [...get().props],
    override: get().override,
    rivers: get().rivers.map((r) => ({ ...r, points: r.points.map((p) => ({ ...p })) })),
  });

  // Capture pre-mutation state onto the undo stack. Resets redo stack.
  const snapshotAndPush = (): void => {
    set((s) => ({ history: pushHistory(s.history, snapshot()) }));
  };

  return {
    active: false,
    placingUrl: null,
    selectedId: null,
    moving: false,
    props: seed?.props ?? [],
    // Additive field — older v:1 blobs without rivers load with [].
    rivers: seed?.rivers ?? [],
    override: seed?.override ?? false,
    riverTool: {
      active: false,
      editingRiverId: null,
      selectedRiverId: null,
      width: DEFAULT_RIVER_WIDTH,
    },
    version: 0,
    brush: DEFAULT_BRUSH,
    strokeAnchor: null,
    strokeOpen: false,
    strokePushed: false,
    history: { past: [], future: [] },

    toggleActive: () => {
      set((s) => ({
        active: !s.active,
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
      const next = [...get().props, prop];
      persist(next, get().override, get().rivers);
      set((s) => ({ props: next, selectedId: prop.id, version: s.version + 1 }));
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
      const next = get().props.map((p) => (p.id === id ? { ...p, pos: { x, y } } : p));
      persist(next, get().override, get().rivers);
      set((s) => ({ props: next, moving: false, version: s.version + 1 }));
    },

    deleteSelected: () => {
      const id = get().selectedId;
      if (id === null) return;
      snapshotAndPush();
      const next = get().props.filter((p) => p.id !== id);
      persist(next, get().override, get().rivers);
      set((s) => ({
        props: next,
        selectedId: null,
        moving: false,
        version: s.version + 1,
      }));
    },

    rotateSelected: (deltaRad) => {
      const id = get().selectedId;
      if (id === null) return;
      snapshotAndPush();
      const next = get().props.map((p) => (p.id === id ? { ...p, rot: p.rot + deltaRad } : p));
      persist(next, get().override, get().rivers);
      set((s) => ({ props: next, version: s.version + 1 }));
    },

    scaleSelected: (mul) => {
      const id = get().selectedId;
      if (id === null) return;
      snapshotAndPush();
      const next = get().props.map((p) =>
        p.id === id ? { ...p, scale: clampScale(p.scale * mul) } : p,
      );
      persist(next, get().override, get().rivers);
      set((s) => ({ props: next, version: s.version + 1 }));
    },

    toggleSelectedBlocks: () => {
      const id = get().selectedId;
      if (id === null) return;
      snapshotAndPush();
      const next = get().props.map((p) => (p.id === id ? { ...p, blocks: !p.blocks } : p));
      persist(next, get().override, get().rivers);
      set((s) => ({ props: next, version: s.version + 1 }));
    },

    setOverride: (on) => {
      snapshotAndPush();
      persist(get().props, on, get().rivers);
      set((s) => ({ override: on, version: s.version + 1 }));
    },

    clearAll: () => {
      clearWorldMapEdit();
      // Fresh state is the new baseline — drop history.
      set((s) => ({
        props: [],
        rivers: [],
        override: false,
        selectedId: null,
        moving: false,
        placingUrl: null,
        riverTool: {
          ...s.riverTool,
          active: false,
          editingRiverId: null,
          selectedRiverId: null,
        },
        version: s.version + 1,
        history: { past: [], future: [] },
        strokeAnchor: null,
        strokeOpen: false,
        strokePushed: false,
      }));
    },

    setBrushPreset: (id) => {
      const cur = get().brush;
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
      const effective = new Set(cur.customUrls ?? preset.urls);
      if (effective.has(url)) {
        if (effective.size <= 1) return;
        effective.delete(url);
      } else {
        if (!preset.urls.includes(url)) return;
        effective.add(url);
      }
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
      const existing = s.props.map((p) => p.pos);
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
      const next = [...s.props, ...additions];
      persist(next, s.override, s.rivers);
      set((ss) => ({ props: next, version: ss.version + 1 }));
    },

    endStroke: () => {
      set({ strokeAnchor: null, strokeOpen: false, strokePushed: false });
    },

    setRiverToolActive: (on) => {
      set((s) => ({
        placingUrl: null,
        selectedId: null,
        moving: false,
        // Arming the river tool disarms the brush — both consume map clicks.
        brush: { ...s.brush, active: false },
        riverTool: {
          ...s.riverTool,
          active: on,
          editingRiverId: on ? s.riverTool.editingRiverId : null,
        },
      }));
    },

    beginRiver: (x, y) => {
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
      const next = [...get().rivers, seed];
      persist(get().props, get().override, next);
      set((s) => ({
        rivers: next,
        riverTool: { ...s.riverTool, editingRiverId: id, selectedRiverId: id },
        version: s.version + 1,
      }));
    },

    addRiverPoint: (x, y) => {
      const editingId = get().riverTool.editingRiverId;
      if (editingId === null) return;
      const next = get().rivers.map((r) => {
        if (r.id !== editingId) return r;
        if (r.points.length === 2 && r.points[1].x === r.points[0].x + 0.01) {
          return { ...r, points: [r.points[0], { x, y }] };
        }
        return { ...r, points: [...r.points, { x, y } as RiverPoint] };
      });
      persist(get().props, get().override, next);
      set((s) => ({ rivers: next, version: s.version + 1 }));
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
      snapshotAndPush();
    },

    dragRiverPoint: (riverId, index, x, y) => {
      const next = get().rivers.map((r) => {
        if (r.id !== riverId) return r;
        if (index < 0 || index >= r.points.length) return r;
        return { ...r, points: r.points.map((p, i) => (i === index ? { x, y } : p)) };
      });
      persist(get().props, get().override, next);
      set((s) => ({ rivers: next, version: s.version + 1 }));
    },

    dragRiverPointEnd: () => {
      // Drag-end hook reserved for future diff-coalescing. The undo entry
      // was opened on drag start.
    },

    deleteRiverPoint: (riverId, index) => {
      const river = get().rivers.find((r) => r.id === riverId);
      if (!river) return;
      if (river.points.length <= 2) return;
      snapshotAndPush();
      const next = get().rivers.map((r) =>
        r.id === riverId ? { ...r, points: r.points.filter((_, i) => i !== index) } : r,
      );
      persist(get().props, get().override, next);
      set((s) => ({ rivers: next, version: s.version + 1 }));
    },

    deleteRiver: (id) => {
      snapshotAndPush();
      const next = get().rivers.filter((r) => r.id !== id);
      persist(get().props, get().override, next);
      set((s) => ({
        rivers: next,
        riverTool: {
          ...s.riverTool,
          selectedRiverId: s.riverTool.selectedRiverId === id ? null : s.riverTool.selectedRiverId,
          editingRiverId: s.riverTool.editingRiverId === id ? null : s.riverTool.editingRiverId,
        },
        version: s.version + 1,
      }));
    },

    setRiverWidth: (width) => {
      const w = clampRiverWidth(width);
      const targetId = get().riverTool.editingRiverId ?? get().riverTool.selectedRiverId ?? null;
      if (targetId === null) {
        set((s) => ({ riverTool: { ...s.riverTool, width: w } }));
        return;
      }
      snapshotAndPush();
      const next = get().rivers.map((r) => (r.id === targetId ? { ...r, width: w } : r));
      persist(get().props, get().override, next);
      set((s) => ({
        rivers: next,
        riverTool: { ...s.riverTool, width: w },
        version: s.version + 1,
      }));
    },

    undo: () => {
      const result = undoHistory(get().history, snapshot());
      if (!result) return;
      persist(result.restored.props, result.restored.override, result.restored.rivers);
      set((s) => ({
        props: result.restored.props,
        rivers: result.restored.rivers,
        override: result.restored.override,
        history: result.next,
        selectedId: null,
        moving: false,
        riverTool: { ...s.riverTool, editingRiverId: null, selectedRiverId: null },
        version: s.version + 1,
        strokeAnchor: null,
        strokeOpen: false,
        strokePushed: false,
      }));
    },

    redo: () => {
      const result = redoHistory(get().history, snapshot());
      if (!result) return;
      persist(result.restored.props, result.restored.override, result.restored.rivers);
      set((s) => ({
        props: result.restored.props,
        rivers: result.restored.rivers,
        override: result.restored.override,
        history: result.next,
        selectedId: null,
        moving: false,
        riverTool: { ...s.riverTool, editingRiverId: null, selectedRiverId: null },
        version: s.version + 1,
        strokeAnchor: null,
        strokeOpen: false,
        strokePushed: false,
      }));
    },

    canUndo: () => canUndoH(get().history),
    canRedo: () => canRedoH(get().history),

    // Export adds metadata (scope/generatedAt) on top of the persisted
    // shape so a downloaded file is self-describing. The localStorage
    // shape stays minimal — extra fields are ignored by the loader.
    exportJson: () => {
      const s = get();
      return JSON.stringify(
        {
          v: 1,
          scope: "worldMap",
          generatedAt: new Date().toISOString(),
          override: s.override,
          props: s.props,
          rivers: s.rivers,
        },
        null,
        2,
      );
    },
  };
});
