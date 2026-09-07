import { useGLTF } from "@react-three/drei";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  ALL_BIOME_URLS,
  BIOME_LAYERS,
  BIOME_STYLE,
  type BiomeLayer,
  propGroundRadius,
} from "../biomes";
import {
  buildFlowFeatures,
  type FlowFeatures,
  hasFlowFeatures,
  isOnFlowSurface,
} from "../flowGeometry";
import { MAP_HEIGHT, MAP_WIDTH } from "../level";
import { evenSpreadSpacing, poissonDiskSample } from "../sim/poisson";
import { mulberry32 } from "../sim/random";
import type { Rock, Tree, Vec2 } from "../sim/types";
import { distPointToSegSq } from "../sim/vec2";
import { ROCK_FOOTPRINT, TOWER_CLEAR_RADIUS, TREE_FOOTPRINT } from "../sim/world";
import { sampleStratifiedFeatures } from "../sim/worley";
import { useGame } from "../store";

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

type Placement = { x: number; y: number; scale: number; rot: number; r: number };

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

// Build placements for one non-blocking layer using uniform Poisson disk
// sampling. Non-removable decor spreads evenly across the playable rect
// (no Worley clustering) so the map reads as "alive and full" without
// type-segregated clumps or bare patches. External constraints (paths,
// flow, blockers, earlier decor) plug into `isValid`.
const buildLayer = (
  paths: Vec2[][],
  spec: BiomeLayer,
  decor: DecorEntry[],
  blockers: { x: number; y: number; r: number }[],
  flow: FlowFeatures | null,
  levelId: number,
  layerIndex: number,
): Placement[][] => {
  const buckets: Placement[][] = spec.urls.map(() => []);
  const footprint = layerFootprint(spec);
  const halfW = MAP_WIDTH * 0.475;
  const halfH = MAP_HEIGHT * 0.475;
  const bounds = { minX: -halfW, maxX: halfW, minY: -halfH, maxY: halfH };
  const isGroundCover = spec.groundCover === true;

  const seedBase = spec.seed + levelId * 1103 + layerIndex * 149;

  // Layer min-spacing — derived from footprint × avg scale × 2 (two
  // halves touching) plus slack. This only guarantees meshes don't overlap;
  // for a count well below the rect's capacity it leaves the radius far
  // under the count-implied spacing, so Bridson clumps points near the seed
  // frontiers and stops at maxCount with bare gaps between (the patchy look).
  // Floor at the even-spread spacing so the same count covers the whole
  // field uniformly. Constant radius across the map yields a uniform scatter.
  const avgScale = (spec.minScale + spec.maxScale) / 2;
  const collisionRMin = 2 * footprint * avgScale + PROP_SPACING_SLACK;
  const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
  const rMin = Math.max(collisionRMin, evenSpreadSpacing(area, spec.count));
  const radiusAt = (): number => rMin;

  // Conservative footprints for external checks — use max scale so a
  // max-scale instance at the candidate position couldn't graze any
  // blocker either.
  const candidateR = footprint * spec.maxScale;
  const flowFootprint = footprint * spec.maxScale + 0.2;

  const isValid = (x: number, y: number): boolean => {
    if (nearAnyPath(paths, x, y, spec.clearance)) return false;
    if (isOnFlowSurface(flow, x, y, flowFootprint)) return false;
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
      const slack = isGroundCover && d.groundCover ? GROUND_COVER_CROSS_SLACK : PROP_SPACING_SLACK;
      const min = candidateR + d.r + slack;
      if (dx * dx + dy * dy < min * min) return false;
    }
    return true;
  };

  // Stratified initial frontiers — Bridson with a single seed fills a
  // disc outward from that seed and stops at maxCount, leaving the rest
  // of the rect bare. Seeding ~one start per √count points gives the
  // algorithm many parallel fronts so the Poisson scatter covers the
  // whole playable rect uniformly.
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
    initialPoints,
  });

  const detailRng = mulberry32(seedBase * 53 + 91);
  for (const p of points) {
    const variant = Math.floor(detailRng() * spec.urls.length);
    const scale = spec.minScale + detailRng() * (spec.maxScale - spec.minScale);
    const r = footprint * scale;
    const placement: Placement = { x: p.x, y: p.y, scale, rot: detailRng() * Math.PI * 2, r };
    buckets[variant].push(placement);
    decor.push({ ...placement, layerIndex, groundCover: isGroundCover });
  }
  return buckets;
};

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
  const instRefs = useRef<(THREE.InstancedMesh | null)[]>([]);

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
    return { parts, minY: Number.isFinite(minY) ? minY : 0, maxDim };
  }, [scene, tint]);

  // When the layer opts into size normalization, divide the target world size
  // by the model's measured maxDim so every variant renders at ~normalizeTo
  // before the per-instance scale band is applied. Otherwise raw GLTF scale.
  const baseScale = source && normalizeTo ? normalizeTo / source.maxDim : 1;

  useEffect(() => {
    if (!source) return;
    const dummy = new THREE.Object3D();
    source.parts.forEach((_, idx) => {
      const im = instRefs.current[idx];
      if (!im) return;
      for (let i = 0; i < placements.length; i++) {
        const p = placements[i];
        const s = baseScale * p.scale;
        dummy.position.set(p.x, -source.minY * s, -p.y);
        dummy.rotation.set(0, p.rot, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      im.count = placements.length;
      im.instanceMatrix.needsUpdate = true;
    });
  }, [placements, source, baseScale]);

  if (!source || placements.length === 0) return null;

  return (
    <>
      {source.parts.map((part, idx) => (
        <instancedMesh
          key={part.geom.uuid}
          ref={(el) => {
            instRefs.current[idx] = el;
          }}
          args={[part.geom, part.material, placements.length]}
          castShadow={castShadow}
          receiveShadow
          // Positions are baked into per-instance matrices, so the default
          // origin-centered bounding sphere fails the frustum test once the
          // player zooms in and pans away from origin — culling the whole
          // batch and making the ground decor vanish. Disable per-batch culling.
          frustumCulled={false}
        />
      ))}
    </>
  );
};

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
  const specs = useMemo(() => BIOME_LAYERS[biome].filter((s) => !s.blocks), [biome]);

  // Decor placements are layered: each layer sees blockers (trees+rocks)
  // *and* the running list of previously-placed decor so cross-layer
  // overlap is impossible. Lava/forest/alien surfaces are also avoided
  // so we don't sprinkle grass into the river.
  const layers = useMemo(() => {
    if (overrideActive) return [];
    const blockers = buildBlockers(trees, rocks);
    const decor: DecorEntry[] = [];
    const proceduralKey = levelId + proceduralSeed;
    const flow = hasFlowFeatures(biome) ? buildFlowFeatures(paths, proceduralKey, biome) : null;
    return specs.map((spec, layerIndex) => ({
      spec,
      buckets: buildLayer(paths, spec, decor, blockers, flow, proceduralKey, layerIndex).map(
        (placements) => ({
          id: nanoid(),
          placements,
        }),
      ),
    }));
  }, [paths, specs, biome, levelId, proceduralSeed, overrideActive, trees, rocks]);

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
        <meshStandardMaterial color={style.groundColor} roughness={0.98} metalness={0} />
      </mesh>

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
