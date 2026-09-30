import { useMemo } from "react";
import { useWorldMapEditor } from "../editor/worldMapEditorStore";
import { ResearchDeck, ServiceAnnex } from "./ContainmentCompound";
import { MAP_FACILITIES, type MapFacility } from "./worldMapLandscape";
import { outpostKey, worldMapOutposts } from "./worldMapOutpostPlan";

// Renders the world map's generated colonies. Layout lives in
// worldMapOutpostPlan.ts; in DEV the world-map editor's suppress / erase
// mask is applied on top so authors can clear or click away generated
// colonies just like any other prop.

export const WorldMapOutposts = () => {
  if (import.meta.env.DEV) return <DevWorldMapOutposts />;
  return <MapFacilities clusters={worldMapOutposts()} />;
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
  return <MapFacilities clusters={clusters} />;
};

const MapFacilities = ({ clusters }: { clusters: MapFacility[] }) => (
  <>
    {clusters.map((cluster) => {
      const index = MAP_FACILITIES.findIndex((f) => f.pos === cluster.pos);
      const facility = MAP_FACILITIES[index];
      if (!facility) return null;
      const outpost = {
        id: index + 1,
        templateId: facility.research ? "map-research" : "map-annex",
        pos: { x: 0, y: 0 },
        yaw: 0,
        scale: 1,
        radius: 4.12,
        interior: facility.research,
      };
      return (
        <group
          key={outpostKey(cluster.pos)}
          position={[cluster.pos.x, 0, -cluster.pos.y]}
          rotation={[0, cluster.yaw, 0]}
          scale={0.55}
        >
          {facility.research ? (
            <ResearchDeck outpost={outpost} biome={facility.biome} />
          ) : (
            <ServiceAnnex outpost={outpost} biome={facility.biome} />
          )}
        </group>
      );
    })}
  </>
);
