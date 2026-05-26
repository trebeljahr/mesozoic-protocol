import { useGame } from "../store";
import { createEditorStore, type EditorStore } from "./editorCore";
import { clearAllLevelEdits, clearLevelEdit, readAllLevelEdits, saveLevelEdit } from "./levelEdits";

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

// PURE annotation: the createEditorStore call has no observable side effects,
// so when the editor's only consumers (EditorProps / LevelEditorPanel) are
// dead-coded in production, Rollup drops this store — and levelEdits — entirely.
export const useEditor: EditorStore = /* @__PURE__ */ createEditorStore(() => ({
  getCurrent: () => {
    const w = useGame.getState().world;
    return { props: w.props, override: w.overrideActive, rivers: w.rivers };
  },
  commit: ({ props, override, rivers }) => {
    const w = useGame.getState().world;
    w.props = props;
    w.overrideActive = override;
    w.rivers = rivers;
    bumpGeometry();
    saveLevelEdit(w.levelId, { v: 1, override, props, rivers });
  },
  clear: () => {
    const w = useGame.getState().world;
    clearLevelEdit(w.levelId);
    w.props = [];
    w.rivers = [];
    w.overrideActive = false;
    bumpGeometry();
  },
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

// Wipe every authored level layout in one shot. Bypasses the per-level
// history (the undo stack only spans one level's edits anyway) and rebuilds
// the current level so the in-memory world reflects the wipe. Caller MUST
// gate this on a user confirm — it's irreversible.
export const clearAllLevels = (): void => {
  clearAllLevelEdits();
  const w = useGame.getState().world;
  w.props = [];
  w.rivers = [];
  w.overrideActive = false;
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
