import { BIOME_LAYERS, type Biome, type BiomeLayer } from "../biomes";
import {
  buildFlowFeatures,
  type FlowFeatures,
  hasFlowFeatures,
  isOnFlowSurface,
} from "../flowGeometry";
import { MAP_HEIGHT, MAP_WIDTH } from "../level";
import {
  composeEnvironment,
  compositionDensity,
  compositionMask,
  compositionSeeds,
  type EnvironmentMass,
  nearestMass,
} from "../sim/environmentComposition";
import {
  type LandscapeField,
  landscapeMaskForUrls,
  passesDensityCut,
  scaleTFromDensity,
  spacingForDensity,
} from "../sim/landscape";
import { levelLandscape } from "../sim/levelLandscape";
import { evenSpreadSpacing, poissonDiskSample } from "../sim/poisson";
import { mulberry32 } from "../sim/random";
import type { Vec2 } from "../sim/types";
import { distPointToSegSq } from "../sim/vec2";
import { sampleStratifiedFeatures } from "../sim/worley";
import { memoizeCandidate } from "./sceneryCandidateCache";

const nearAnyPath = (paths: Vec2[][], x: number, y: number, clearance: number) => {
  const r2 = clearance * clearance;
  for (const path of paths) {
    for (let i = 0; i < path.length - 1; i++) {
      if (distPointToSegSq(x, y, path[i].x, path[i].y, path[i + 1].x, path[i + 1].y) < r2)
        return true;
    }
  }
  return false;
};

export type Placement = { x: number; y: number; scale: number; rot: number; r: number };

type DecorEntry = Placement & { layerIndex: number; groundCover: boolean };

// Default footprint guesses by URL family — used when a BiomeLayer omits
// `footprint`. Grass is small, bushes are mid, anything else falls back
// to a conservative 0.5 so unfamiliar packs still get reasonable spacing.
const defaultFootprint = (url: string): number => {
  const f = url.toLowerCase();
  if (/grass/.test(f)) return 0.28;
  if (/bush/.test(f)) return 0.6;
  if (/rock/.test(f)) return 0.55;
  return 0.5;
};

const layerFootprint = (spec: BiomeLayer): number =>
  spec.footprint ?? defaultFootprint(spec.urls[0] ?? "");

// Margin between placements on top of summed footprint-radii. Keeps
// neighbours visually distinct without forcing them to never touch.
const PROP_SPACING_SLACK = 0.35;

// Cross-groundCover-layer slack — smaller than PROP_SPACING_SLACK so a
// dense grass field still leaves room for mushrooms/flowers to slot in
// between tufts instead of being completely shut out. Footprint sums
// still keep meshes from physically overlapping.
const GROUND_COVER_CROSS_SLACK = 0.05;

// How far the Poisson radius may open up in the sparsest ground, relative
// to the layer's even-spread spacing. 2.4 is enough for a clearing to read
// as a clearing without leaving the map looking half-empty.
const SPARSE_SPACING_MUL = 2.4;
// Ground-cover carpets keep a much tighter range — they should thin, not
// disappear, or the map stops reading as "alive and full".
const GROUND_COVER_SPARSE_MUL = 1.5;

// Fill shared landscape masses with small detail. Hard mass boundaries leave
// the gaps empty; Poisson spacing and the seeded cut soften each group within
// those boundaries. External clearance checks remain authoritative.
const prepareLayer = (
  paths: Vec2[][],
  spec: BiomeLayer,
  flow: FlowFeatures | null,
  levelId: number,
  layerIndex: number,
  field: LandscapeField,
  masses: EnvironmentMass[],
) => {
  const footprint = layerFootprint(spec);
  const halfW = MAP_WIDTH * 0.475;
  const halfH = MAP_HEIGHT * 0.475;
  const bounds = { minX: -halfW, maxX: halfW, minY: -halfH, maxY: halfH };
  const isGroundCover = spec.groundCover === true;

  const seedBase = spec.seed + levelId * 1103 + layerIndex * 149;

  // Footprint spacing is the lower bound; count-implied spacing controls
  // detail within a mass without trying to cover the entire playable map.
  const avgScale = (spec.minScale + spec.maxScale) / 2;
  const collisionRMin = 2 * footprint * avgScale + PROP_SPACING_SLACK;
  const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
  const even = evenSpreadSpacing(area, spec.count);
  const dense = Math.max(collisionRMin, even * 0.38);
  const sparseMul = isGroundCover ? GROUND_COVER_SPARSE_MUL : SPARSE_SPACING_MUL;
  const sparse = Math.max(dense, even * sparseMul);
  const mask = compositionMask(spec.urls, landscapeMaskForUrls(spec.urls, isGroundCover));
  const meadow = isGroundCover && spec.urls[0]?.includes("/natural/Grass");
  const densityAt = (x: number, y: number): number =>
    meadow ? field.density("groundCover", x, y) : compositionDensity(masses, mask, x, y);
  // Ground cover keeps a high floor so clearings stay grassy; sparser
  // layers get a real cut so their clearings are actually clear.
  const cutFloor = isGroundCover ? 0.45 : 0.12;

  // Conservative footprints for external checks — use max scale so a
  // max-scale instance at the candidate position couldn't graze any
  // blocker either.
  const candidateR = footprint * spec.maxScale;
  const flowFootprint = footprint * spec.maxScale + 0.2;

  const candidateAt = memoizeCandidate((x: number, y: number) => {
    if (nearAnyPath(paths, x, y, spec.clearance)) return null;
    const density = densityAt(x, y);
    if (density <= 0) return null;
    if (!passesDensityCut(field, density, x, y, cutFloor)) return null;
    if (isOnFlowSurface(flow, x, y, flowFootprint)) return null;
    return { density, radius: spacingForDensity(density, dense, sparse) };
  });
  // The sampler requests radius only after isValid accepted this coordinate.
  const radiusAt = (x: number, y: number): number => candidateAt(x, y)!.radius;

  return (decor: DecorEntry[], blockers: { x: number; y: number; r: number }[]): Placement[][] => {
    const buckets: Placement[][] = spec.urls.map(() => []);
    const isValid = (x: number, y: number): boolean => {
      if (!candidateAt(x, y)) return false;
      for (const b of blockers) {
        const dx = b.x - x;
        const dy = b.y - y;
        const min = candidateR + b.r + PROP_SPACING_SLACK;
        if (dx * dx + dy * dy < min * min) return false;
      }
      for (const d of decor) {
        const dx = d.x - x;
        const dy = d.y - y;
        // Cross-ground-cover collisions use a tiny slack so a dense grass
        // field doesn't completely shut out the mushroom/flower layers
        // placed after it. Footprint sums still keep the meshes from
        // physically overlapping; we just stop padding extra space
        // between unrelated small decor.
        const slack =
          isGroundCover && d.groundCover ? GROUND_COVER_CROSS_SLACK : PROP_SPACING_SLACK;
        const min = candidateR + d.r + slack;
        if (dx * dx + dy * dy < min * min) return false;
      }
      return true;
    };

    // Group silhouettes get first choice. Additional candidates let detail
    // find valid pockets around blockers, but cannot escape the shared masses.
    const initialPoints = sampleStratifiedFeatures(
      seedBase * 17 + 5,
      bounds,
      Math.max(6, Math.ceil(Math.sqrt(spec.count) * 2)),
    );

    const points = poissonDiskSample({
      bounds,
      radiusAt,
      isValid,
      maxCount: spec.count,
      seed: seedBase * 31 + 23,
      initialPoints: [...compositionSeeds(masses, mask), ...initialPoints],
    });

    const detailRng = mulberry32(seedBase * 53 + 91);
    for (const p of points) {
      // One species per mass keeps neighbouring detail in the same family.
      const mass = nearestMass(masses, mask, p.x, p.y).mass;
      const variant = meadow
        ? Math.floor(detailRng() * spec.urls.length)
        : (mass?.species ?? 0) % spec.urls.length;
      const scaleT = scaleTFromDensity(candidateAt(p.x, p.y)!.density, detailRng());
      const scale = spec.minScale + scaleT * (spec.maxScale - spec.minScale);
      const r = footprint * scale;
      const placement: Placement = { x: p.x, y: p.y, scale, rot: detailRng() * Math.PI * 2, r };
      buckets[variant].push(placement);
      decor.push({ ...placement, layerIndex, groundCover: isGroundCover });
    }
    return buckets;
  };
};

// Recreate on static-world/editor invalidation; retain across tree/rock removals.
export const prepareGroundPlacement = (biome: Biome, key: number, paths: Vec2[][]) => {
  const flow = hasFlowFeatures(biome) ? buildFlowFeatures(paths, key, biome) : null;
  const field = levelLandscape(key, biome, flow);
  const masses = composeEnvironment(paths, biome, field);
  const specs = BIOME_LAYERS[biome].filter((spec) => !spec.blocks);
  const builders = specs.map((spec, i) => prepareLayer(paths, spec, flow, key, i, field, masses));
  return (blockers: { x: number; y: number; r: number }[]) => {
    const decor: DecorEntry[] = [];
    return specs.map((spec, i) => ({ spec, buckets: builders[i](decor, blockers) }));
  };
};
