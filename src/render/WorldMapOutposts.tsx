import { useMemo } from "react";
import { useWorldMapEditor } from "../editor/worldMapEditorStore";
import { OutpostClusters } from "./OutpostClusters";
import { outpostKey, worldMapOutposts } from "./worldMapOutpostPlan";

// Renders the world map's generated colonies. Layout lives in
// worldMapOutpostPlan.ts; in DEV the world-map editor's suppress / erase
// mask is applied on top so authors can clear or click away generated
// colonies just like any other prop.

export const WorldMapOutposts = () => {
  if (import.meta.env.DEV) return <DevWorldMapOutposts />;
  return <OutpostClusters clusters={worldMapOutposts()} />;
};

const DevWorldMapOutposts = () => {
  const version = useWorldMapEditor((s) => s.version);
  const { override, erasedProcedural } = useWorldMapEditor.getState().getCurrent();
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the intended invalidation key
  const clusters = useMemo(() => {
    if (override) return [];
    const erased = new Set(erasedProcedural ?? []);
    if (erased.size === 0) return worldMapOutposts();
    return worldMapOutposts().filter((o) => !erased.has(outpostKey(o.pos)));
  }, [version]);
  return <OutpostClusters clusters={clusters} />;
};
