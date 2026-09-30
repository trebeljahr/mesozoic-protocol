import { Suspense, useEffect, useMemo } from "react";
import { BIOME_STYLE } from "../biomes";
import { useGame } from "../store";
import { TerrainSoilMaterial } from "./TerrainSoilMaterial";
import { TERRAIN_EDGE } from "./terrainPalette";
import { buildTerrainSurface } from "./terrainSurfaceGeometry";

export const TerrainSurface = () => {
  const paths = useGame((s) => s.world.paths);
  const flow = useGame((s) => s.world.flowFeatures);
  const biome = useGame((s) => s.world.biome);
  const override = useGame((s) => s.world.overrideActive);
  const geometry = useMemo(() => {
    // Authored layouts retain their exact rendering; their fluid curves
    // need the editor's spline sampling before this surface can be reused.
    if (override) return null;
    return buildTerrainSurface(
      paths,
      flow?.rivers ?? [],
      flow?.lakes ?? [],
      BIOME_STYLE[biome].groundColor,
      true,
      biome === "lava"
        ? { wet: "#332822", gravel: "#5a4636" }
        : biome === "alien"
          ? { wet: "#2a3039", gravel: "#51535b" }
          : undefined,
    );
  }, [paths, flow, biome, override]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} receiveShadow raycast={() => {}}>
      <Suspense fallback={<meshStandardMaterial vertexColors roughness={0.98} />}>
        <TerrainSoilMaterial groundColor={TERRAIN_EDGE[biome]} biome={biome} />
      </Suspense>
    </mesh>
  );
};
