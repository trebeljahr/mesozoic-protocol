import { nanoid } from "nanoid";
import { create } from "zustand";
import { classifyPropUrl } from "../biomes";
import type { PlacedProp } from "../sim/types";
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
};

type WorldMapEditorState = {
  active: boolean;
  placingUrl: string | null;
  selectedId: string | null;
  moving: boolean;
  props: PlacedProp[];
  override: boolean;
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
  beginStroke: () => void;
  paintAt: (x: number, y: number) => void;
  endStroke: () => void;
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
};

const persist = (props: PlacedProp[], override: boolean): void => {
  const edit: WorldMapEdit = { v: 1, override, props };
  saveWorldMapEdit(edit);
};

// PURE annotation: tree-shake the whole world-map editor surface out of
// production builds where the only consumers (WorldMapEditorPanel /
// WorldMapEditorProps) are dead-coded behind import.meta.env.DEV. The
// localStorage seed lives inside the factory so it only runs when create()
// actually executes (i.e. when a DEV consumer subscribes).
export const useWorldMapEditor = /* @__PURE__ */ create<WorldMapEditorState>((set, get) => {
  const seed = loadWorldMapEdit();

  const snapshot = (): Snapshot => ({ props: [...get().props], override: get().override });

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
    override: seed?.override ?? false,
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
      }));
    },

    setPlacing: (url) =>
      set((s) => ({
        placingUrl: s.placingUrl === url ? null : url,
        selectedId: null,
        moving: false,
        brush: { ...s.brush, active: false },
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
      persist(next, get().override);
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
      persist(next, get().override);
      set((s) => ({ props: next, moving: false, version: s.version + 1 }));
    },

    deleteSelected: () => {
      const id = get().selectedId;
      if (id === null) return;
      snapshotAndPush();
      const next = get().props.filter((p) => p.id !== id);
      persist(next, get().override);
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
      persist(next, get().override);
      set((s) => ({ props: next, version: s.version + 1 }));
    },

    scaleSelected: (mul) => {
      const id = get().selectedId;
      if (id === null) return;
      snapshotAndPush();
      const next = get().props.map((p) =>
        p.id === id ? { ...p, scale: clampScale(p.scale * mul) } : p,
      );
      persist(next, get().override);
      set((s) => ({ props: next, version: s.version + 1 }));
    },

    toggleSelectedBlocks: () => {
      const id = get().selectedId;
      if (id === null) return;
      snapshotAndPush();
      const next = get().props.map((p) => (p.id === id ? { ...p, blocks: !p.blocks } : p));
      persist(next, get().override);
      set((s) => ({ props: next, version: s.version + 1 }));
    },

    setOverride: (on) => {
      snapshotAndPush();
      persist(get().props, on);
      set((s) => ({ override: on, version: s.version + 1 }));
    },

    clearAll: () => {
      clearWorldMapEdit();
      // Fresh state is the new baseline — drop history.
      set((s) => ({
        props: [],
        override: false,
        selectedId: null,
        moving: false,
        placingUrl: null,
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
        set({ brush: { ...cur, active: false } });
        return;
      }
      set((s) => ({
        brush: { ...s.brush, presetId: id, active: id !== null },
        placingUrl: null,
        selectedId: null,
        moving: false,
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
      set({ strokeAnchor: snapshot(), strokeOpen: true, strokePushed: false });
    },

    paintAt: (x, y) => {
      const s = get();
      const preset = getBrushPreset(s.brush.presetId);
      if (!preset || preset.urls.length === 0) return;
      if (!s.brush.active) return;
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
        url: pickWeighted(preset),
        pos: pt,
        scale: randRange(preset.scaleJitter[0], preset.scaleJitter[1]),
        rot: randRange(preset.rotateRange[0], preset.rotateRange[1]),
        blocks: preset.defaultBlocks,
      }));
      const next = [...s.props, ...additions];
      persist(next, s.override);
      set((ss) => ({ props: next, version: ss.version + 1 }));
    },

    endStroke: () => {
      set({ strokeAnchor: null, strokeOpen: false, strokePushed: false });
    },

    undo: () => {
      const result = undoHistory(get().history, snapshot());
      if (!result) return;
      persist(result.restored.props, result.restored.override);
      set((s) => ({
        props: result.restored.props,
        override: result.restored.override,
        history: result.next,
        selectedId: null,
        moving: false,
        version: s.version + 1,
        strokeAnchor: null,
        strokeOpen: false,
        strokePushed: false,
      }));
    },

    redo: () => {
      const result = redoHistory(get().history, snapshot());
      if (!result) return;
      persist(result.restored.props, result.restored.override);
      set((s) => ({
        props: result.restored.props,
        override: result.restored.override,
        history: result.next,
        selectedId: null,
        moving: false,
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
        },
        null,
        2,
      );
    },
  };
});
