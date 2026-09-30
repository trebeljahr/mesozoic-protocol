import { useEffect, useMemo } from "react";
import { BIOME_STYLE } from "../biomes";
import { useGame } from "../store";
import { buildTerrainSurface } from "./terrainSurfaceGeometry";

export const TerrainSurface = () => {
  const paths = useGame((s) => s.world.paths);
  const flow = useGame((s) => s.world.flowFeatures);
  const level = useGame((s) => s.world.levelId);
  const biome = useGame((s) => s.world.biome);
  const override = useGame((s) => s.world.overrideActive);
  const geometry = useMemo(() => {
    // Authored layouts retain their exact rendering; their fluid curves
    // need the editor's spline sampling before this surface can be reused.
    if (override || (level !== 4 && !flow)) return null;
    return buildTerrainSurface(
      paths,
      flow?.rivers ?? [],
      flow?.lakes ?? [],
      BIOME_STYLE[biome].groundColor,
      level === 4,
      biome === "lava"
        ? { wet: "#332822", gravel: "#5a4636" }
        : biome === "alien"
          ? { wet: "#2a3039", gravel: "#51535b" }
          : undefined,
    );
  }, [paths, flow, level, biome, override]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} receiveShadow raycast={() => {}}>
      <meshStandardMaterial vertexColors roughness={0.98} />
    </mesh>
  );
};
