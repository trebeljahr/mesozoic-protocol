import { useGLTF } from "@react-three/drei";
import { nanoid } from "nanoid";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { ALL_BIOME_URLS, BIOME_STYLE, propGroundRadius } from "../biomes";
import { HQ_PAD_BLOCKER_RADIUS, MAP_HEIGHT, MAP_WIDTH } from "../level";
import type { Rock, Tree } from "../sim/types";
import { ROCK_FOOTPRINT, TOWER_CLEAR_RADIUS, TREE_FOOTPRINT } from "../sim/world";
import { useGame } from "../store";
import { setGroundedTransform } from "./groundedTransform";
import { type Placement, prepareGroundPlacement } from "./groundPlacement";
import { SceneryBatches } from "./SceneryBatches";
import { TerrainSurface } from "./TerrainSurface";
import { TERRAIN_EDGE } from "./terrainPalette";

const NatureInstances = ({
  url,
  placements,
  castShadow,
  tint,
  normalizeTo,
}: {
  url: string;
  placements: Placement[];
  castShadow: boolean;
  tint?: [number, number, number];
  normalizeTo?: number;
}) => {
  const { scene } = useGLTF(url);

  // Quaternius/KayKit models are authored as several primitives — one mesh per
  // colour region (trunk / foliage / snow cap). The loader exposes each as its
  // own mesh, so we instance every one of them with the shared placement
  // transforms; taking only the first primitive would drop all but one colour
  // of the model. minY is taken across the whole model so the parts stay
  // aligned and the model's lowest point rests on the ground.
  const source = useMemo(() => {
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    if (meshes.length === 0) return null;
    // useGLTF caches the scene, so its materials are shared across every biome
    // that references this GLB. When a layer asks for a tint we must clone
    // before recolouring, otherwise (e.g.) the forest grass would inherit the
    // snowfield's blue wash.
    const wash = tint ? new THREE.Color(tint[0], tint[1], tint[2]) : null;
    const tintMat = (mat: THREE.Material): THREE.Material => {
      if (!wash) return mat;
      const c = mat.clone();
      const std = c as THREE.MeshStandardMaterial;
      if (std.color) std.color.multiply(wash);
      c.needsUpdate = true;
      return c;
    };
    const union = new THREE.Box3();
    let unionSet = false;
    const parts = meshes.map((m) => {
      m.updateMatrixWorld(true);
      const geom = m.geometry.clone();
      geom.applyMatrix4(m.matrixWorld);
      geom.computeBoundingBox();
      if (geom.boundingBox) {
        if (!unionSet) {
          union.copy(geom.boundingBox);
          unionSet = true;
        } else union.union(geom.boundingBox);
      }
      const material = Array.isArray(m.material)
        ? m.material.map(tintMat)
        : tintMat(m.material as THREE.Material);
      return { geom, material };
    });
    const size = unionSet ? union.getSize(new THREE.Vector3()) : new THREE.Vector3();
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const minY = unionSet ? union.min.y : 0;
    return {
      parts,
      minY: Number.isFinite(minY) ? minY : 0,
      maxDim,
      centerX: unionSet ? (union.min.x + union.max.x) / 2 : 0,
      centerZ: unionSet ? (union.min.z + union.max.z) / 2 : 0,
    };
  }, [scene, tint]);

  useEffect(
    () => () => {
      if (!source) return;
      for (const part of source.parts) {
        part.geom.dispose();
        if (tint) for (const material of [part.material].flat()) material.dispose();
      }
    },
    [source, tint],
  );

  // When the layer opts into size normalization, divide the target world size
  // by the model's measured maxDim so every variant renders at ~normalizeTo
  // before the per-instance scale band is applied. Otherwise raw GLTF scale.
  const baseScale = source && normalizeTo ? normalizeTo / source.maxDim : 1;

  if (!source || placements.length === 0) return null;
  return (
    <SceneryBatches
      parts={source.parts}
      items={placements}
      position={placementPosition}
      transform={(dummy, p) => setGroundedTransform(dummy, source, p, p.rot, baseScale * p.scale)}
      castShadow={castShadow}
    />
  );
};
const placementPosition = (placement: Placement) => placement;

const buildBlockers = (trees: Tree[], rocks: Rock[]): { x: number; y: number; r: number }[] => {
  const out: { x: number; y: number; r: number }[] = [];
  for (const t of trees) out.push({ x: t.pos.x, y: t.pos.y, r: TREE_FOOTPRINT * t.scale });
  for (const r of rocks) out.push({ x: r.pos.x, y: r.pos.y, r: ROCK_FOOTPRINT * r.scale });
  return out;
};

export const Ground = () => {
  const paths = useGame((s) => s.world.paths);
  const biome = useGame((s) => s.world.biome);
  const levelId = useGame((s) => s.world.levelId);
  const proceduralSeed = useGame((s) => s.world.proceduralSeed);
  const overrideActive = useGame((s) => s.world.overrideActive);
  const trees = useGame((s) => s.world.trees);
  const rocks = useGame((s) => s.world.rocks);
  const outposts = useGame((s) => s.world.outposts);
  // world.towers is mutated in place on placement (push), so subscribing to
  // the array reference wouldn't notify React. towerVersion bumps on every
  // place/sell — that's the trigger; the array is read via getState.
  const towerVersion = useGame((s) => s.ui.towerVersion);
  const towers = useGame.getState().world.towers;
  // Hand-placed editor props cull the ground carpet under their footprint the
  // same way towers do. treeVersion is the static-geometry invalidation key
  // the editor bumps on every commit.
  const propVersion = useGame((s) => s.ui.treeVersion);
  const props = useGame((s) => s.world.props);
  const style = BIOME_STYLE[biome];
  const generatePlacement = useMemo(
    () => (overrideActive ? null : prepareGroundPlacement(biome, levelId + proceduralSeed, paths)),
    [biome, levelId, proceduralSeed, paths, overrideActive],
  );

  // Decor placements are layered: each layer sees blockers (trees+rocks)
  // *and* the running list of previously-placed decor so cross-layer
  // overlap is impossible. Lava/forest/alien surfaces are also avoided
  // so we don't sprinkle grass into the river.
  const layers = useMemo(() => {
    if (!generatePlacement) return [];
    const blockers = [
      ...buildBlockers(trees, rocks),
      ...outposts.map((o) => ({ x: o.pos.x, y: o.pos.y, r: o.radius })),
      ...paths
        .filter((p) => p.length > 1)
        .map((p) => ({ x: p[p.length - 1].x, y: p[p.length - 1].y, r: HQ_PAD_BLOCKER_RADIUS })),
    ];
    return generatePlacement(blockers).map(({ spec, buckets }) => ({
      spec,
      buckets: buckets.map((placements) => ({ id: nanoid(), placements })),
    }));
  }, [generatePlacement, paths, trees, rocks, outposts]);

  // Cull any decor instance the player has built a tower on top of, or that
  // an authored prop stands on, so the base sits on clean ground instead of
  // poking through a mushroom or grass tuft. Props use their ground-contact
  // radius, not their silhouette — a tree only clears grass around its trunk,
  // the canopy keeps whatever grows in its shade. Done at render-time so
  // placement stays deterministic.
  // biome-ignore lint/correctness/useExhaustiveDependencies: towerVersion/propVersion are the intended invalidation keys
  const culledLayers = useMemo(() => {
    if (towers.length === 0 && props.length === 0) return layers;
    const towerR = TOWER_CLEAR_RADIUS;
    const propDiscs = props.map((p) => ({
      x: p.pos.x,
      y: p.pos.y,
      r: propGroundRadius(p.url, p.scale),
    }));
    return layers.map(({ spec, buckets }) => ({
      spec,
      buckets: buckets.map(({ id, placements }) => ({
        id,
        placements: placements.filter((p) => {
          for (const t of towers) {
            const dx = t.pos.x - p.x;
            const dy = t.pos.y - p.y;
            const lim = towerR + p.r;
            if (dx * dx + dy * dy < lim * lim) return false;
          }
          for (const d of propDiscs) {
            const dx = d.x - p.x;
            const dy = d.y - p.y;
            const lim = d.r + p.r;
            if (dx * dx + dy * dy < lim * lim) return false;
          }
          return true;
        }),
      })),
    }));
  }, [layers, towers, towerVersion, props, propVersion]);

  return (
    <group>
      {/* Oversized so the plane edge is always off-screen at any
          aspect/zoom — otherwise the scene background bleeds through
          past the playable 40×24 footprint. Decor (trees/rocks/grass)
          still places inside MAP_WIDTH × MAP_HEIGHT, so the skirt reads
          as flat outer ground; fog blends its far edges into the sky. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[MAP_WIDTH * 6, MAP_HEIGHT * 8]} />
        <meshStandardMaterial
          color={!overrideActive ? TERRAIN_EDGE[biome] : style.groundColor}
          roughness={0.98}
          metalness={0}
        />
      </mesh>

      <TerrainSurface />

      {culledLayers.flatMap(({ spec, buckets }) =>
        buckets.map(({ id, placements }, vi) => (
          <NatureInstances
            key={id}
            url={spec.urls[vi]}
            placements={placements}
            castShadow={spec.castShadow}
            tint={spec.tint}
            normalizeTo={spec.normalizeTo}
          />
        )),
      )}
    </group>
  );
};

for (const url of ALL_BIOME_URLS) useGLTF.preload(url);
