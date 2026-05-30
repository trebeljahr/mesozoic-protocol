import { classifyPropUrl, TARGET_SIZE_BY_ROLE } from "../biomes";
import { isOnFlowSurface } from "../flowGeometry";
import { MAP_HEIGHT, MAP_WIDTH, PATH_WIDTH } from "../level";
import { distPointToSegSq, distSq } from "../sim/vec2";
import { ROCK_FOOTPRINT, TOWER_FOOTPRINT, TREE_FOOTPRINT } from "../sim/world";
import { useGame } from "../store";
import { createEditorStore, type EditorStore } from "./editorCore";
import { clearAllLevelHistories, loadLevelHistory, saveLevelHistory } from "./historyPersist";
import { clearAllLevelEdits, readAllLevelEdits, saveLevelEdit } from "./levelEdits";

// Dev-only level-editor store. A thin adapter over the shared editorCore
// factory: the source of truth is useGame.world.{props, rivers,
// overrideActive}, which createWorld populates from localStorage on every
// level load. Edits here mutate those arrays, persist via levelEdits, and
// bump the game's geometry version so the render layers + canPlaceAt
// re-evaluate.

// Re-snapshot ui.treeVersion (the static-geometry invalidation key the
// render layers + Placement already subscribe to) so an in-place props
// mutation actually re-renders.
const bumpGeometry = (): void => {
  useGame.setState((s) => {
    const tv = s.treeVersion + 1;
    return { treeVersion: tv, ui: { ...s.ui, treeVersion: tv } };
  });
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

const saveCurrentLevelEdit = (): void => {
  const w = useGame.getState().world;
  saveLevelEdit(w.levelId, {
    v: 1,
    override: w.overrideActive,
    proceduralSeed: w.proceduralSeed,
    props: w.props,
    rivers: w.rivers,
  });
};

const snapToEdge = (point: { x: number; y: number }): { x: number; y: number } => {
  const halfW = MAP_WIDTH / 2;
  const halfH = MAP_HEIGHT / 2;
  const left = Math.abs(point.x + halfW);
  const right = Math.abs(halfW - point.x);
  const top = Math.abs(point.y + halfH);
  const bottom = Math.abs(halfH - point.y);
  const nearest = Math.min(left, right, top, bottom);
  if (nearest === left) return { x: -halfW, y: Math.max(-halfH, Math.min(halfH, point.y)) };
  if (nearest === right) return { x: halfW, y: Math.max(-halfH, Math.min(halfH, point.y)) };
  if (nearest === top) return { x: Math.max(-halfW, Math.min(halfW, point.x)), y: -halfH };
  return { x: Math.max(-halfW, Math.min(halfW, point.x)), y: halfH };
};

const canEditPlaceAt = (x: number, y: number, ignorePropId?: string | null): boolean => {
  const w = useGame.getState().world;
  const pos = { x, y };
  if (Math.abs(x) > MAP_WIDTH / 2 || Math.abs(y) > MAP_HEIGHT / 2) return false;
  const propRadius = 0.7;
  const pathRadius = PATH_WIDTH * 0.5 + propRadius;
  for (const path of w.paths) {
    for (let i = 0; i < path.length - 1; i++) {
      if (
        distPointToSegSq(x, y, path[i].x, path[i].y, path[i + 1].x, path[i + 1].y) <
        pathRadius * pathRadius
      ) {
        return false;
      }
    }
  }
  if (isOnFlowSurface(w.flowFeatures, x, y, propRadius)) return false;
  for (const t of w.towers) {
    const r = TOWER_FOOTPRINT * 0.5 + propRadius;
    if (distSq(t.pos, pos) < r * r) return false;
  }
  for (const t of w.trees) {
    const r = TREE_FOOTPRINT * t.scale + propRadius;
    if (distSq(t.pos, pos) < r * r) return false;
  }
  for (const rck of w.rocks) {
    const r = ROCK_FOOTPRINT * rck.scale + propRadius;
    if (distSq(rck.pos, pos) < r * r) return false;
  }
  for (const o of w.outposts) {
    const r = o.radius + propRadius;
    if (distSq(o.pos, pos) < r * r) return false;
  }
  for (const p of w.props) {
    if (p.id === ignorePropId) continue;
    const r = TARGET_SIZE_BY_ROLE[classifyPropUrl(p.url)] * p.scale * 0.5 + propRadius;
    if (distSq(p.pos, pos) < r * r) return false;
  }
  return true;
};

// PURE annotation: the createEditorStore call has no observable side effects,
// so when the editor's only consumers (EditorProps / LevelEditorPanel) are
// dead-coded in production, Rollup drops this store — and levelEdits — entirely.
export const useEditor: EditorStore = /* @__PURE__ */ createEditorStore(() => ({
  getCurrent: () => {
    const w = useGame.getState().world;
    return {
      props: w.props,
      override: w.overrideActive,
      rivers: w.rivers,
      proceduralSeed: w.proceduralSeed,
    };
  },
  commit: ({ props, override, rivers, proceduralSeed }) => {
    const w = useGame.getState().world;
    w.props = props;
    w.overrideActive = override;
    w.rivers = rivers;
    w.proceduralSeed = proceduralSeed ?? w.proceduralSeed;
    bumpGeometry();
    saveCurrentLevelEdit();
  },
  clear: () => {
    const w = useGame.getState().world;
    w.props = [];
    w.rivers = [];
    w.overrideActive = true;
    bumpGeometry();
    saveCurrentLevelEdit();
  },
  clearManual: () => {
    const w = useGame.getState().world;
    w.props = [];
    w.rivers = [];
    bumpGeometry();
    saveCurrentLevelEdit();
  },
  clearProcedural: () => {
    const w = useGame.getState().world;
    w.overrideActive = true;
    bumpGeometry();
    saveCurrentLevelEdit();
    reloadLevel();
  },
  reloadProcedural: () => {
    const w = useGame.getState().world;
    w.overrideActive = false;
    w.proceduralSeed = Math.floor(Math.random() * 1_000_000_000);
    bumpGeometry();
    saveCurrentLevelEdit();
    reloadLevel();
  },
  canPlaceAt: canEditPlaceAt,
  snapToEdge,
  // History is persisted per-level so each level keeps its own undo/redo
  // stacks across reloads. A useGame.subscribe below swaps the in-memory
  // history when the active levelId changes.
  loadHistory: () => loadLevelHistory(useGame.getState().world.levelId),
  saveHistory: (history) => saveLevelHistory(useGame.getState().world.levelId, history),
  // Export adds metadata (scope/levelId/generatedAt) on top of the
  // persisted shape so a downloaded file is self-describing.
  exportJson: () => {
    const w = useGame.getState().world;
    return JSON.stringify(
      {
        v: 1,
        scope: "level",
        levelId: w.levelId,
        generatedAt: new Date().toISOString(),
        override: w.overrideActive,
        proceduralSeed: w.proceduralSeed,
        props: w.props,
        rivers: w.rivers,
      },
      null,
      2,
    );
  },
  onActivate: () => {
    // Drop any in-flight gameplay selection so map clicks belong to the
    // editor, not tower placement / robot move orders.
    useGame.getState().clearSelection();
  },
  onOverrideChange: reloadLevel,
  onClear: reloadLevel,
}));

// Swap the in-memory undo/redo stack when the active level changes so each
// level's persisted history is reflected. Gated on import.meta.env.DEV so
// production bundles can tree-shake the subscription (a raw top-level
// subscribe is a side effect Rollup wouldn't drop).
if (import.meta.env.DEV) {
  let lastLevelId: number | null = useGame.getState().world.levelId;
  useGame.subscribe((state) => {
    const id = state.world.levelId;
    if (id === lastLevelId) return;
    lastLevelId = id;
    useEditor.setState({ history: loadLevelHistory(id) });
  });
}

// Wipe every authored level layout in one shot. Bypasses the per-level
// history (the undo stack only spans one level's edits anyway) and rebuilds
// the current level so the in-memory world reflects the wipe. Caller MUST
// gate this on a user confirm — it's irreversible.
export const clearAllLevels = (): void => {
  clearAllLevelEdits();
  clearAllLevelHistories();
  useEditor.setState({ history: { past: [], future: [] } });
  const w = useGame.getState().world;
  w.props = [];
  w.rivers = [];
  w.overrideActive = false;
  w.proceduralSeed = 0;
  bumpGeometry();
  reloadLevel();
};

// Bundle every authored level into one JSON. Uses the persisted store
// directly so the dump is a faithful snapshot of disk-state.
export const exportAllLevelsJson = (): string => {
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
};
