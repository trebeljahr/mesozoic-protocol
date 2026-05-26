import { useWorldMapEditor } from "../editor/worldMapEditorStore";
import { EditorPropsLayer } from "./EditorPropsLayer";
import { PAN_LIMIT_X, PAN_LIMIT_Z } from "./worldMapBounds";

// Dev-only world-map editor render layer. Thin wrapper over the shared
// EditorPropsLayer — sizes the click plane to the pan-clamped content area
// (placing props past the pan limit would orphan them off-screen forever)
// and uses the world-map store's own `version` counter as the invalidation
// key (no per-level world to follow).

const PLANE_PAD = 12;

export const WorldMapEditorProps = () => {
  const version = useWorldMapEditor((s) => s.version);
  return (
    <EditorPropsLayer
      store={useWorldMapEditor}
      planeHalfExtent={{ x: PAN_LIMIT_X + PLANE_PAD, z: PAN_LIMIT_Z + PLANE_PAD }}
      version={version}
    />
  );
};
