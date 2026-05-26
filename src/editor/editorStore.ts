import { nanoid } from "nanoid";
import { create } from "zustand";
import { classifyPropUrl } from "../biomes";
import type { PlacedProp } from "../sim/types";
import { useGame } from "../store";
import {
  canRedo as canRedoH,
  canUndo as canUndoH,
  type History,
  pushHistory,
  redoHistory,
  type Snapshot,
  undoHistory,
} from "./history";
import { clearLevelEdit, saveLevelEdit } from "./levelEdits";

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
  saveLevelEdit(w.levelId, { v: 1, override: w.overrideActive, props: w.props });
};

const currentSnapshot = (): Snapshot => {
  const w = useGame.getState().world;
  return { props: [...w.props], override: w.overrideActive };
};

// Replace world.props with a fresh array, invalidate render, and persist.
const commitProps = (next: PlacedProp[]): void => {
  useGame.getState().world.props = next;
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

type EditorState = {
  active: boolean;
  // Asset url armed for placement — each map click drops one. null = select mode.
  placingUrl: string | null;
  selectedId: string | null;
  // When true the next map click relocates the selected prop.
  moving: boolean;
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
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  exportJson: () => string;
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
    history: { past: [], future: [] },

    toggleActive: () => {
      const next = !get().active;
      if (next) {
        // Drop any in-flight gameplay selection so map clicks belong to the
        // editor, not tower placement / robot move orders.
        useGame.getState().clearSelection();
      }
      set({ active: next, placingUrl: null, selectedId: null, moving: false });
    },

    setPlacing: (url) =>
      set((s) => ({
        // Clicking the armed asset again disarms back to select mode.
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
      w.overrideActive = false;
      // Fresh state is the new baseline — drop history.
      set({
        selectedId: null,
        moving: false,
        placingUrl: null,
        history: { past: [], future: [] },
      });
      bumpGeometry();
      reloadLevel();
    },

    undo: () => {
      const result = undoHistory(get().history, currentSnapshot());
      if (!result) return;
      const w = useGame.getState().world;
      w.props = result.restored.props;
      w.overrideActive = result.restored.override;
      bumpGeometry();
      persist();
      // Restored selection may no longer exist.
      set({ history: result.next, selectedId: null, moving: false });
    },

    redo: () => {
      const result = redoHistory(get().history, currentSnapshot());
      if (!result) return;
      const w = useGame.getState().world;
      w.props = result.restored.props;
      w.overrideActive = result.restored.override;
      bumpGeometry();
      persist();
      set({ history: result.next, selectedId: null, moving: false });
    },

    canUndo: () => canUndoH(get().history),
    canRedo: () => canRedoH(get().history),

    exportJson: () => {
      const w = useGame.getState().world;
      return JSON.stringify({ v: 1, override: w.overrideActive, props: w.props }, null, 2);
    },
  };
});
