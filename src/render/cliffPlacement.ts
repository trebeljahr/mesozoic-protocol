import type { Biome } from "../biomes";
import { buildFlowFeatures, hasFlowFeatures, isOnFlowSurface } from "../flowGeometry";
import { MAP_HEIGHT, MAP_WIDTH, PATH_WIDTH } from "../level";
import { mulberry32 } from "../sim/random";
import type { Vec2 } from "../sim/types";
import { distPointToSegSq } from "../sim/vec2";

export const CLIFF_ROCKS: Partial<Record<Biome, string[]>> = {
  desert: [
    "/models/natural/DesertRock1.glb",
    "/models/natural/DesertRock2.glb",
    "/models/natural/DesertRock3.glb",
  ],
  wasteland: [
    "/models/natural/WasteRock1.glb",
    "/models/natural/WasteRock3.glb",
    "/models/natural/WasteRock5.glb",
  ],
  alien: [
    "/models/natural/WasteRock1.glb",
    "/models/natural/WasteRock3.glb",
    "/models/natural/WasteRock5.glb",
  ],
};

export type CliffRock = { url: string; pos: Vec2; scale: number; rotY: number; radius: number };

// Two broken escarpments, with overlapping stones and smaller tapered ends.
// Every stone's full bounding disc stays outside playable ground. The gaps
// preserve entrances and sightlines instead of enclosing the map in a wall.
export const buildCliffs = (
  biome: Biome,
  seed: number,
  paths: Vec2[][],
  blockers: { pos: Vec2; radius: number }[] = [],
): CliffRock[] => {
  const urls = CLIFF_ROCKS[biome];
  if (!urls) return [];
  const rng = mulberry32(seed * 7919 + 28183);
  const flow = hasFlowFeatures(biome) ? buildFlowFeatures(paths, seed, biome) : null;
  const result: CliffRock[] = [];
  const firstSide = Math.floor(rng() * 4);
  for (const side of [firstSide, (firstSide + 2) % 4]) {
    const horizontal = side < 2;
    const sign = side % 2 === 0 ? 1 : -1;
    const half = horizontal ? MAP_HEIGHT / 2 : MAP_WIDTH / 2;
    const along = (rng() - 0.5) * (horizontal ? MAP_WIDTH * 0.55 : MAP_HEIGHT * 0.45);
    const yaw = rng() * Math.PI;
    for (let i = 0; i < 7; i++) {
      const taper = Math.sin((i / 6) * Math.PI);
      // Scale is the target largest dimension, normalized by the renderer.
      const scale = 2.5 + taper * 2.7 + rng() * 0.45;
      const radius = scale * Math.SQRT1_2;
      const tangent = along + (i - 3) * 1.7;
      const normal = sign * (half + 4.5 + Math.sin(i * 0.7) * 0.45);
      const pos = horizontal ? { x: tangent, y: normal } : { x: normal, y: tangent };
      if (
        blockers.some((b) => Math.hypot(b.pos.x - pos.x, b.pos.y - pos.y) < b.radius + radius + 0.5)
      )
        continue;
      if (isOnFlowSurface(flow, pos.x, pos.y, radius + 0.3)) continue;
      if (
        paths.some((path) =>
          path.some(
            (point, index) =>
              index > 0 &&
              distPointToSegSq(
                pos.x,
                pos.y,
                path[index - 1].x,
                path[index - 1].y,
                point.x,
                point.y,
              ) <
                (radius + PATH_WIDTH / 2 + 1) ** 2,
          ),
        )
      )
        continue;
      result.push({ url: urls[i % urls.length], pos, scale, radius, rotY: yaw + rng() * 0.7 });
    }
  }
  return result;
};
