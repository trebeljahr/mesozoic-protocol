import { nanoid } from "nanoid";
import { create } from "zustand";
import { classifyPropUrl } from "../biomes";
import type { PlacedProp } from "../sim/types";
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
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  exportJson: () => string;
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
    history: { past: [], future: [] },

    toggleActive: () => {
      set((s) => ({
        active: !s.active,
        placingUrl: null,
        selectedId: null,
        moving: false,
      }));
    },

    setPlacing: (url) =>
      set((s) => ({
        placingUrl: s.placingUrl === url ? null : url,
        selectedId: null,
        moving: false,
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
      }));
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
      }));
    },

    canUndo: () => canUndoH(get().history),
    canRedo: () => canRedoH(get().history),

    exportJson: () => {
      const s = get();
      return JSON.stringify({ v: 1, override: s.override, props: s.props }, null, 2);
    },
  };
});
