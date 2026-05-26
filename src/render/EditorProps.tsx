import { useEditor } from "../editor/editorStore";
import { MAP_HEIGHT, MAP_WIDTH } from "../level";
import { useGame } from "../store";
import { EditorPropsLayer } from "./EditorPropsLayer";

// Dev-only level-editor render layer. Thin wrapper over the shared
// EditorPropsLayer — supplies the level-editor store, click-plane size
// (per-level MAP_WIDTH × MAP_HEIGHT plus an authoring pad so props can be
// placed just outside the playfield), and the invalidation key
// (ui.treeVersion — bumped both by editor commits and by createWorld
// rebuilds, so this layer always reflects live world.props). Mounted in
// Scene.tsx behind import.meta.env.DEV.

const PLANE_PAD = 8;

export const EditorProps = () => {
  const treeVersion = useGame((s) => s.ui.treeVersion);
  return (
    <EditorPropsLayer
      store={useEditor}
      planeHalfExtent={{ x: MAP_WIDTH / 2 + PLANE_PAD, z: MAP_HEIGHT / 2 + PLANE_PAD }}
      version={treeVersion}
    />
  );
};
