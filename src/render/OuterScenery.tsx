import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import type * as THREE from "three";
import {
  BIOME_COSMETICS,
  BIOME_LAYERS,
  type Biome,
  type BiomeLayer,
  classifyPropUrl,
  TARGET_SIZE_BY_ROLE,
} from "../biomes";
import {
  buildFlowFeatures,
  type FlowFeatures,
  hasFlowFeatures,
  isOnFlowSurface,
} from "../flowGeometry";
import { HQ_PAD_BLOCKER_RADIUS, MAP_HEIGHT, MAP_WIDTH } from "../level";
import {
  composeEnvironment,
  compositionDensity,
  compositionMask,
  compositionSeeds,
  type EnvironmentMass,
  nearestMass,
} from "../sim/environmentComposition";
import { landscapeMaskForUrls } from "../sim/landscape";
import { levelLandscape } from "../sim/levelLandscape";
import { evenSpreadSpacing, poissonDiskSample } from "../sim/poisson";
import { mulberry32 } from "../sim/random";
import type { Vec2 } from "../sim/types";
import { distPointToSegSq } from "../sim/vec2";
import { sampleStratifiedFeatures } from "../sim/worley";
import { useGame } from "../store";
import { InstancedGroup } from "./InstancedGroup";
import type { MeshSource } from "./meshSource";

// Decorative scenery in the band *outside* the playable rectangle —
// non-blocking ground layers (grass etc.) and cosmetics (flowers etc.).
// Trees and blocking rocks are spawned by buildTrees/buildRocks in
// world.ts with expanded bounds so they're deconstructable.

// Outer rectangle bounds — past this the fog + screen edge swallow props anyway.
const OUTER_HALF_W = MAP_WIDTH / 2 + 11; // 31 from center
const OUTER_HALF_H = MAP_HEIGHT / 2 + 9; // 21 from center
// Inner exclusion — slight overlap with the play boundary is fine, but
// stay clear of clickable trees/rocks so the join doesn't double up.
const INNER_HALF_W = MAP_WIDTH / 2 - 0.5;
const INNER_HALF_H = MAP_HEIGHT / 2 - 0.5;

// Slack on top of summed prop radii — matches Ground.tsx's PROP_SPACING_SLACK
// so the rim and the inner area share the same "neighbours can almost
// touch, but not visually overlap" convention.
const PROP_SPACING_SLACK = 0.15;

const defaultFootprint = (url: string): number => {
  const f = url.toLowerCase();
  if (/grass/.test(f)) return 0.28;
  if (/bush/.test(f)) return 0.6;
  return 0.5;
};

const layerFootprint = (layer: BiomeLayer): number =>
  layer.footprint ?? defaultFootprint(layer.urls[0] ?? "");

const layerMinSpacing = (layer: BiomeLayer): number => {
  const footprint = layerFootprint(layer);
  return 2 * footprint * layer.maxScale + PROP_SPACING_SLACK;
};

// Pure cosmetic URLs (BIOME_COSMETICS, e.g. BushFlowers) have no per-layer
// scale band; the inner BiomeCosmetics renderer normalizes them to
// TARGET_SIZE_BY_ROLE, and we mirror that here.
const COSMETIC_ONLY_URLS = (() => {
  const set = new Set<string>();
  for (const list of Object.values(BIOME_COSMETICS)) for (const u of list) set.add(u);
  return set;
})();

const INNER_COSMETIC_COUNT = 14;

// Band-to-inner area ratio: rim count = inner count × this. With the current
// outer/inner bounds it's ~1707 / 960 = 1.78.
const BAND_AREA = OUTER_HALF_W * 2 * OUTER_HALF_H * 2 - INNER_HALF_W * 2 * INNER_HALF_H * 2;
const INNER_AREA = MAP_WIDTH * MAP_HEIGHT;
const BAND_RATIO = BAND_AREA / INNER_AREA;

type Instance = { url: string; pos: Vec2; scale: number; rotY: number; radius: number };

const cosmeticScale = (rng: () => number): number => 0.7 + ((rng() + rng()) / 2) * 0.7;

const layerScale = (rng: () => number, layer: BiomeLayer): number =>
  layer.minScale + ((rng() + rng()) / 2) * (layer.maxScale - layer.minScale);

const insideInner = (x: number, y: number): boolean =>
  Math.abs(x) < INNER_HALF_W && Math.abs(y) < INNER_HALF_H;

// Four band rects (top/bottom/left/right) stratified independently —
// stratifying over OUTER_BOUNDS as one rect wastes ~56% of seeds inside
// the inner exclusion. Per-side stratification keeps coverage even
// around the rim.
const BAND_SIDES = (() => {
  const top = { minX: -OUTER_HALF_W, maxX: OUTER_HALF_W, minY: INNER_HALF_H, maxY: OUTER_HALF_H };
  const bottom = {
    minX: -OUTER_HALF_W,
    maxX: OUTER_HALF_W,
    minY: -OUTER_HALF_H,
    maxY: -INNER_HALF_H,
  };
  const left = {
    minX: -OUTER_HALF_W,
    maxX: -INNER_HALF_W,
    minY: -INNER_HALF_H,
    maxY: INNER_HALF_H,
  };
  const right = { minX: INNER_HALF_W, maxX: OUTER_HALF_W, minY: -INNER_HALF_H, maxY: INNER_HALF_H };
  const area = (b: typeof top) => (b.maxX - b.minX) * (b.maxY - b.minY);
  return [top, bottom, left, right].map((bounds) => ({ bounds, area: area(bounds) }));
})();

const bandInitialPoints = (seed: number, count: number): Vec2[] => {
  if (count <= 0) return [];
  const totalArea = BAND_SIDES.reduce((s, side) => s + side.area, 0);
  const out: Vec2[] = [];
  let placed = 0;
  for (let i = 0; i < BAND_SIDES.length; i++) {
    const side = BAND_SIDES[i];
    const isLast = i === BAND_SIDES.length - 1;
    const share = isLast
      ? Math.max(0, count - placed)
      : Math.round((count * side.area) / totalArea);
    if (share <= 0) continue;
    out.push(...sampleStratifiedFeatures(seed + i * 7919, side.bounds, share));
    placed += share;
  }
  return out;
};

const OUTER_BOUNDS = {
  minX: -OUTER_HALF_W,
  maxX: OUTER_HALF_W,
  minY: -OUTER_HALF_H,
  maxY: OUTER_HALF_H,
};

// Continue the playable composition across the rim using the same anchors,
// families and clearance checks. Empty gaps extend through the boundary.
const placeLayerInBand = (
  out: Instance[],
  layer: BiomeLayer,
  levelId: number,
  layerIndex: number,
  flow: FlowFeatures | null,
  masses: EnvironmentMass[],
  paths: Vec2[][],
  blockers: { pos: Vec2; radius: number }[],
): void => {
  // Buildings are robot focal points; don't sprinkle them in the corners.
  if (layer.urls.every((u) => classifyPropUrl(u) === "building")) return;

  const targetCount = Math.round(layer.count * BAND_RATIO);
  if (targetCount === 0) return;

  const seedBase = layer.seed * 17 + levelId * 4451 + layerIndex * 991;
  // Concentrate the count within the shared masses instead of filling gaps.
  const rMin = Math.max(layerMinSpacing(layer), evenSpreadSpacing(BAND_AREA, targetCount) * 0.45);
  const mask = compositionMask(layer.urls, landscapeMaskForUrls(layer.urls, layer.groundCover));

  // Conservative footprint for the cross-layer check — use this layer's
  // max-scale instance so a worst-case sibling at the candidate position
  // can't graze a previously-placed (possibly different-family) prop.
  const candidateR = layerFootprint(layer) * layer.maxScale;

  const isValid = (x: number, y: number): boolean => {
    if (insideInner(x, y)) return false;
    if (compositionDensity(masses, mask, x, y) <= 0) return false;
    for (const path of paths) {
      for (let i = 1; i < path.length; i++) {
        if (
          distPointToSegSq(x, y, path[i - 1].x, path[i - 1].y, path[i].x, path[i].y) <
          layer.clearance ** 2
        )
          return false;
      }
    }
    if (blockers.some((b) => Math.hypot(b.pos.x - x, b.pos.y - y) < b.radius + candidateR + 0.2))
      return false;
    // Rivers/lakes run off the play rect into the band; keep band decor off
    // the water tails just like the inner placement does.
    if (isOnFlowSurface(flow, x, y, candidateR + 0.2)) return false;
    for (const o of out) {
      const dx = o.pos.x - x;
      const dy = o.pos.y - y;
      const min = candidateR + o.radius + PROP_SPACING_SLACK;
      if (dx * dx + dy * dy < min * min) return false;
    }
    return true;
  };

  const initialPoints = bandInitialPoints(
    seedBase + 4099,
    Math.max(4, Math.ceil(Math.sqrt(targetCount) * 2)),
  );

  const points = poissonDiskSample({
    bounds: OUTER_BOUNDS,
    radiusAt: () => rMin,
    isValid,
    maxCount: targetCount,
    seed: seedBase + 7,
    initialPoints: [...compositionSeeds(masses, mask), ...initialPoints],
  });

  const detailRng = mulberry32(seedBase + 13);
  for (const p of points) {
    const mass = nearestMass(masses, mask, p.x, p.y).mass;
    const url = layer.urls[(mass?.species ?? 0) % layer.urls.length];
    const scale = layerScale(detailRng, layer);
    out.push({
      url,
      pos: { x: p.x, y: p.y },
      scale,
      radius: layerFootprint(layer) * scale,
      rotY: detailRng() * Math.PI * 2,
    });
  }
};

// Uniform Poisson scatter for cosmetics that don't have a BIOME_LAYERS
// entry. No Worley modulation, just a flat density at the given spacing.
const placeUniformInBand = (
  out: Instance[],
  seed: number,
  pool: string[],
  count: number,
  scaleFn: (rng: () => number) => number,
  minSep: number,
  flow: FlowFeatures | null,
  flowFootprint: number,
): void => {
  if (count === 0 || pool.length === 0) return;

  // Floor the caller's separation at the count-implied even spread so the
  // band cosmetics cover the rim evenly instead of clumping near seeds.
  const sep = Math.max(minSep, evenSpreadSpacing(BAND_AREA, count));

  const isValid = (x: number, y: number): boolean => {
    if (insideInner(x, y)) return false;
    if (isOnFlowSurface(flow, x, y, flowFootprint)) return false;
    for (const o of out) {
      const dx = o.pos.x - x;
      const dy = o.pos.y - y;
      if (dx * dx + dy * dy < sep * sep) return false;
    }
    return true;
  };

  const initialPoints = bandInitialPoints(
    seed + 4099,
    Math.max(4, Math.ceil(Math.sqrt(count) * 2)),
  );

  const points = poissonDiskSample({
    bounds: OUTER_BOUNDS,
    radiusAt: () => sep,
    isValid,
    maxCount: count,
    seed,
    initialPoints,
  });

  const detailRng = mulberry32(seed + 31);
  for (const p of points) {
    const url = pool[Math.floor(detailRng() * pool.length)];
    out.push({
      url,
      pos: { x: p.x, y: p.y },
      scale: scaleFn(detailRng),
      radius: flowFootprint,
      rotY: detailRng() * Math.PI * 2,
    });
  }
};

const buildInstances = (
  biome: Biome,
  levelId: number,
  flow: FlowFeatures | null,
  paths: Vec2[][],
  blockers: { pos: Vec2; radius: number }[],
): Instance[] => {
  const out: Instance[] = [];
  const masses = composeEnvironment(paths, biome, levelLandscape(levelId, biome, flow));

  // Non-blocking ground layers (grass, etc.) in the outer band. Blocking
  // layers (rocks) and trees are now spawned by buildRocks/buildTrees in
  // world.ts with expanded bounds, so they live in world.rocks/world.trees
  // and are deconstructable like the inner ones.
  const layers = BIOME_LAYERS[biome];
  for (let li = 0; li < layers.length; li++) {
    if (layers[li].blocks) continue;
    placeLayerInBand(out, layers[li], levelId, li, flow, masses, paths, blockers);
  }

  // Cosmetics (forest BushFlowers etc.) rendered separately on the
  // inner via BiomeCosmetics.tsx; mirror at proportional count.
  const cosmetics = BIOME_COSMETICS[biome];
  if (cosmetics.length > 0) {
    placeUniformInBand(
      out,
      levelId * 5113 + 313,
      cosmetics,
      Math.round(INNER_COSMETIC_COUNT * BAND_RATIO),
      cosmeticScale,
      1.1,
      flow,
      0.5,
    );
  }

  return out;
};

// Three sizing conventions live in the outer band. (1) Layers that opt into
// `normalizeTo` divide the target world size by the model's maxDim, mirroring
// the inner Ground.tsx normalization so multi-model layers stay consistent.
// (2) BIOME_COSMETICS-only URLs (BushFlowers etc.) normalize to
// TARGET_SIZE_BY_ROLE so the outer-band size matches the inner cosmetic size.
// (3) Everything else doubles as an inner-area prop and renders at raw GLTF
// scale so the two regions match. The normalizeTo map is keyed per-biome
// because a URL (e.g. Crystal_Small_1) can sit in a normalized layer in one
// biome and a raw-scale layer in another.
const makeComputeBaseScale =
  (normalizeByUrl: Map<string, number>) =>
  (source: MeshSource, url: string): number => {
    const target = normalizeByUrl.get(url);
    if (target) return target / source.maxDim;
    if (COSMETIC_ONLY_URLS.has(url))
      return TARGET_SIZE_BY_ROLE[classifyPropUrl(url)] / source.maxDim;
    return 1;
  };

const neverRaycast: THREE.Mesh["raycast"] = () => {};

export const OuterScenery = () => {
  const biome = useGame((s) => s.world.biome);
  const levelId = useGame((s) => s.world.levelId);
  const paths = useGame((s) => s.world.paths);
  const proceduralSeed = useGame((s) => s.world.proceduralSeed);
  const overrideActive = useGame((s) => s.world.overrideActive);
  const outposts = useGame((s) => s.world.outposts);
  const trees = useGame((s) => s.world.trees);
  const rocks = useGame((s) => s.world.rocks);

  const groups = useMemo(() => {
    if (overrideActive) return [];
    const key = levelId + proceduralSeed;
    const flow = hasFlowFeatures(biome) ? buildFlowFeatures(paths, key, biome) : null;
    const blockers = [
      ...outposts.map((o) => ({ pos: o.pos, radius: o.radius })),
      ...trees.map((t) => ({ pos: t.pos, radius: 0.85 * t.scale })),
      ...rocks.map((r) => ({ pos: r.pos, radius: 0.7 * r.scale })),
      ...paths
        .filter((p) => p.length > 1)
        .map((p) => ({ pos: p[p.length - 1], radius: HQ_PAD_BLOCKER_RADIUS })),
    ];
    const instances = buildInstances(biome, key, flow, paths, blockers);
    const byUrl = new Map<string, Instance[]>();
    for (const inst of instances) {
      const list = byUrl.get(inst.url) ?? [];
      list.push(inst);
      byUrl.set(inst.url, list);
    }
    return Array.from(byUrl.entries());
  }, [biome, levelId, proceduralSeed, overrideActive, paths, outposts, trees, rocks]);

  // Per-biome URL→normalizeTo from the non-blocking layers (blocking layers
  // render via Rocks.tsx, not here). Only this biome's layers are consulted so
  // a shared URL can normalize in one biome and not in another.
  const baseScaleFor = useMemo(() => {
    const normalizeByUrl = new Map<string, number>();
    for (const layer of BIOME_LAYERS[biome]) {
      if (layer.blocks || layer.normalizeTo == null) continue;
      for (const u of layer.urls) normalizeByUrl.set(u, layer.normalizeTo);
    }
    return makeComputeBaseScale(normalizeByUrl);
  }, [biome]);

  return (
    <group>
      {groups.map(([url, items]) => (
        <InstancedGroup
          key={url}
          url={url}
          items={items}
          baseScaleFor={baseScaleFor}
          // The directional light's shadow camera spans the playable rect;
          // outer-band shadows would clip the shadow map edge anyway.
          castShadow={false}
          raycast={neverRaycast}
        />
      ))}
    </group>
  );
};

// Preload non-blocking layer + cosmetic URLs across biomes.
const allUrls = new Set<string>();
for (const layers of Object.values(BIOME_LAYERS)) {
  for (const l of layers) if (!l.blocks) for (const u of l.urls) allUrls.add(u);
}
for (const list of Object.values(BIOME_COSMETICS)) for (const u of list) allUrls.add(u);
for (const u of allUrls) useGLTF.preload(u);
