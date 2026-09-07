// One landscape field per level, shared by everything that places props.
//
// The sim (clearable trees/rocks) and the render layer (grass, bushes,
// mushrooms, cosmetics) each run their own placement pass. If they sampled
// independent noise, the undergrowth would clump where the trees don't and
// the map would look *more* incoherent than plain uniform scatter. Both
// sides go through this helper so a grove, its bushes and its mushroom
// carpet all sit on the same patch of ground.

import type { Biome } from "../biomes";
import { buildWetnessProbe, type FlowFeatures } from "../flowGeometry";
import { MAP_HEIGHT, MAP_WIDTH } from "../level";
import {
  createLandscapeField,
  getLandscapeField,
  type LandscapeBounds,
  type LandscapeField,
} from "./landscape";

// Matches the padded rect buildTrees/buildRocks scatter into, so the field
// is defined everywhere any prop can land. Decor layers use a tighter
// placement rect but sample the same field.
export const LANDSCAPE_PAD_X = 11;
export const LANDSCAPE_PAD_Y = 9;

export const landscapeBounds = (): LandscapeBounds => ({
  minX: -(MAP_WIDTH / 2 + LANDSCAPE_PAD_X),
  maxX: MAP_WIDTH / 2 + LANDSCAPE_PAD_X,
  minY: -(MAP_HEIGHT / 2 + LANDSCAPE_PAD_Y),
  maxY: MAP_HEIGHT / 2 + LANDSCAPE_PAD_Y,
});

// Edge thickening is measured against the playable map, not the padded
// field — the point is to frame the lanes the player looks at.
const edgeBounds = (): LandscapeBounds => ({
  minX: -MAP_WIDTH / 2,
  maxX: MAP_WIDTH / 2,
  minY: -MAP_HEIGHT / 2,
  maxY: MAP_HEIGHT / 2,
});

/**
 * Landscape field for a level. `proceduralKey` is the same
 * `levelId + proceduralSeed` value the rest of the generation uses, so
 * re-rolling the seed re-rolls the terrain and a given seed always
 * reproduces the same layout.
 */
export const levelLandscape = (
  proceduralKey: number,
  biome: Biome,
  flow: FlowFeatures | null,
): LandscapeField =>
  getLandscapeField(`${biome}:${proceduralKey}`, () =>
    createLandscapeField({
      seed: (proceduralKey * 2654435761) >>> 0,
      bounds: landscapeBounds(),
      edgeBounds: edgeBounds(),
      wetnessAt: buildWetnessProbe(flow),
    }),
  );
