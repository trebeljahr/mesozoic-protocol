import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import type * as THREE from "three";
import { BIOME_COSMETICS, BIOME_LAYERS, classifyPropUrl, TARGET_SIZE_BY_ROLE } from "../biomes";
import { HQ_PAD_BLOCKER_RADIUS } from "../level";
import { useGame } from "../store";
import { CliffScenery } from "./CliffScenery";
import { containmentSceneryBlockers } from "./containmentLayout";
import { InstancedGroup } from "./InstancedGroup";
import type { MeshSource } from "./meshSource";
import { prepareOuterPlacement } from "./outerSceneryPlacement";

const COSMETIC_ONLY_URLS = (() => {
  const set = new Set<string>();
  for (const list of Object.values(BIOME_COSMETICS)) for (const u of list) set.add(u);
  return set;
})();

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

  const generatePlacement = useMemo(
    () => (overrideActive ? null : prepareOuterPlacement(biome, levelId + proceduralSeed, paths)),
    [biome, levelId, proceduralSeed, paths, overrideActive],
  );
  const blockers = useMemo(
    () => [
      ...containmentSceneryBlockers({ levelId, proceduralSeed, overrideActive, outposts, paths }),
      ...outposts.map((o) => ({ pos: o.pos, radius: o.radius })),
      ...trees.map((t) => ({ pos: t.pos, radius: 0.85 * t.scale })),
      ...rocks.map((r) => ({ pos: r.pos, radius: 0.7 * r.scale })),
      ...paths
        .filter((p) => p.length > 1)
        .map((p) => ({ pos: p[p.length - 1], radius: HQ_PAD_BLOCKER_RADIUS })),
    ],
    [levelId, proceduralSeed, overrideActive, outposts, paths, trees, rocks],
  );
  const groups = useMemo(() => {
    if (!generatePlacement) return [];
    const instances = generatePlacement(blockers);
    const byUrl = new Map<string, ReturnType<typeof generatePlacement>>();
    for (const inst of instances) {
      const list = byUrl.get(inst.url) ?? [];
      list.push(inst);
      byUrl.set(inst.url, list);
    }
    return Array.from(byUrl.entries());
  }, [generatePlacement, blockers]);

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
      {!overrideActive && (
        <CliffScenery
          biome={biome}
          levelId={levelId + proceduralSeed}
          paths={paths}
          blockers={blockers}
        />
      )}
      {groups.map(([url, items]) => (
        <InstancedGroup
          key={url}
          url={url}
          items={items}
          baseScaleFor={baseScaleFor}
          tint={
            BIOME_LAYERS[biome].find((layer) => !layer.blocks && layer.urls.includes(url))?.tint
          }
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
