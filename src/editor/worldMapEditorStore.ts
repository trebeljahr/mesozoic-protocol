import type { PlacedProp, River } from "../sim/types";
import { createEditorStore, type EditorStore } from "./editorCore";
import { clearWorldMapEdit, loadWorldMapEdit, saveWorldMapEdit } from "./worldMapEdits";

// Dev-only world-map editor store. A thin adapter over the shared
// editorCore factory: unlike the level editor (which writes through
// useGame.world.props/rivers), the world map owns its own arrays in the
// adapter's closure and persists to a single localStorage entry — the world
// map is global, not level-scoped.

// PURE annotation: tree-shake the whole world-map editor surface out of
// production builds where the only consumers (WorldMapEditorPanel /
// WorldMapEditorProps) are dead-coded behind import.meta.env.DEV. The
// localStorage seed lives inside the factory so it only runs when
// createEditorStore actually executes (i.e. when a DEV consumer subscribes).
export const useWorldMapEditor: EditorStore = /* @__PURE__ */ createEditorStore(() => {
  const seed = loadWorldMapEdit();
  // Closure-owned source of truth. The factory reads via getCurrent() and
  // writes via commit() — and bumps its version counter on each commit so
  // the panel + render layer re-render without subscribing to these refs.
  let props: PlacedProp[] = seed?.props ?? [];
  // Additive field — older v:1 blobs without rivers load with [].
  let rivers: River[] = seed?.rivers ?? [];
  let override: boolean = seed?.override ?? false;
  return {
    getCurrent: () => ({ props, override, rivers }),
    commit: (next) => {
      props = next.props;
      rivers = next.rivers;
      override = next.override;
      saveWorldMapEdit({ v: 1, override, props, rivers });
    },
    clear: () => {
      clearWorldMapEdit();
      props = [];
      rivers = [];
      override = false;
    },
    // Export adds metadata (scope/generatedAt) on top of the persisted
    // shape so a downloaded file is self-describing.
    exportJson: () =>
      JSON.stringify(
        {
          v: 1,
          scope: "worldMap",
          generatedAt: new Date().toISOString(),
          override,
          props,
          rivers,
        },
        null,
        2,
      ),
  };
});
