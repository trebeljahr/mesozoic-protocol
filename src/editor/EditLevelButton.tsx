import { useGame } from "../store";
import { useEditor } from "./editorStore";

// Dev-only action in the map menu’s developer panel. Routes through startLevel so the level loads with editor.active
// already true — skipping the mode picker since the editor is mode-agnostic.
// Lives in src/editor/ so the whole surface stays tree-shakeable behind the
// import.meta.env.DEV gate at the MapDeveloperTools call site.

type Props = { levelId: number };

export const EditLevelButton = ({ levelId }: Props) => (
  <button
    type="button"
    className="btn btn-ghost btn--sm"
    title={`Edit level ${levelId} (dev only)`}
    aria-label={`Edit level ${levelId}`}
    onPointerDown={(e) => e.stopPropagation()}
    onClick={(e) => {
      e.stopPropagation();
      const game = useGame.getState();
      game.clearSelection();
      useEditor.setState({
        active: true,
        panelCollapsed: false,
        chromeHidden: true,
        placingUrl: null,
        selectedIds: new Set(),
        selectedId: null,
        moving: false,
      });
      game.startLevel(levelId);
    }}
  >
    Edit selected level
  </button>
);
