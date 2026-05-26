import { Html } from "@react-three/drei";
import { useGame } from "../store";
import { useEditor } from "./editorStore";

// Dev-only "jump into editor on this level" affordance shown on each world-map
// LevelNode. Routes through startLevel so the level loads with editor.active
// already true — skipping the mode picker since the editor is mode-agnostic.
// Lives in src/editor/ so the whole surface stays tree-shakeable behind the
// import.meta.env.DEV gate at the LevelNode call site.

const buttonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  padding: 0,
  borderRadius: 999,
  border: "1px solid rgba(106, 169, 255, 0.5)",
  background: "rgba(8, 12, 18, 0.86)",
  color: "#9aebff",
  cursor: "pointer",
  boxShadow: "0 3px 10px rgba(0, 0, 0, 0.4)",
  backdropFilter: "blur(6px)",
};

const PencilSvg = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

type Props = { levelId: number };

export const EditLevelButton = ({ levelId }: Props) => (
  <Html
    center
    position={[1.95, 0.05, -1.4]}
    zIndexRange={[9, 9]}
    wrapperClass="edit-level-button-wrap"
  >
    <button
      type="button"
      style={buttonStyle}
      title={`Edit level ${levelId} (dev only)`}
      aria-label={`Edit level ${levelId}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        const game = useGame.getState();
        game.clearSelection();
        useEditor.setState({
          active: true,
          placingUrl: null,
          selectedId: null,
          moving: false,
        });
        game.startLevel(levelId);
      }}
    >
      <PencilSvg />
    </button>
  </Html>
);
