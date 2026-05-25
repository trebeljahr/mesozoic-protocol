import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  BIOME_COSMETICS,
  BIOME_STORY_PROPS,
  type Biome,
  classifyPropUrl,
  TARGET_SIZE_BY_ROLE,
} from "../biomes";
import {
  buildFlowFeatures,
  type FlowFeatures,
  hasFlowFeatures,
  isOnFlowSurface,
} from "../flowGeometry";
import { HQ_PAD_BLOCKER_RADIUS, MAP_HEIGHT, MAP_WIDTH, PATH_WIDTH } from "../level";
import { poissonDiskSample } from "../sim/poisson";
import { mulberry32 } from "../sim/random";
import type { Vec2 } from "../sim/types";
import { distPointToSegSq } from "../sim/vec2";
import { TOWER_FOOTPRINT } from "../sim/world";
import { sampleStratifiedFeatures } from "../sim/worley";
import { useGame } from "../store";
import { BIOME_STORY_TRACE_STYLE } from "./biomeColors";
import { InstancedGroup } from "./InstancedGroup";
import type { MeshSource } from "./meshSource";

// Render-only decorative cosmetics scattered across the playable level.
// Deterministic per-level via PRNG seeded on levelId. These don't live in
// world state — they're pure flavor and never block placement or get
// clicked.

// A handful of decorative cosmetics spread evenly across the playfield —
// enough to read as authored detail without competing with the clearable
// trees/rocks.
const COUNT_PER_LEVEL = 8;
// PATH_WIDTH widened to 2.8, so anything at half-width + 0.5 was clipping
// the visible edge. 1.2 beyond the edge gives cosmetics room to breathe.
const PATH_CLEARANCE = PATH_WIDTH / 2 + 1.2;
// Flat Poisson spacing — uniform density, no Worley clustering. Kept under
// the stratified-seed grid pitch so the even anchor points don't reject
// each other.
const PROP_SPACING = 2.4;
const STORY_SIDE = PATH_WIDTH / 2 + 0.25;

const STORY_TARGET_HEIGHT = new Map<string, number>([
  ["/models/landmarks/desert/Tent.glb", 0.62],
  ["/models/landmarks/forest/Barrel.glb", 0.38],
  ["/models/landmarks/desert/Chest.glb", 0.34],
  ["/models/landmarks/desert/Skull.glb", 0.32],
  ["/models/landmarks/wasteland/Skull.glb", 0.32],
  ["/models/landmarks/snow/Tent.glb", 0.62],
  ["/models/landmarks/snow/Torch.glb", 0.66],
  ["/models/scifi/barrels.glb", 0.44],
  ["/models/scifi/machine_barrel.glb", 0.52],
  ["/models/scifi/machine_barrelLarge.glb", 0.62],
  ["/models/scifi/machine_generator.glb", 0.62],
  ["/models/scifi/machine_generatorLarge.glb", 0.72],
  ["/models/scifi/machine_wirelessCable.glb", 0.62],
  ["/models/scifi/meteor_detailed.glb", 0.5],
  ["/models/scifi/rock_crystalsLargeA.glb", 0.56],
  ["/models/scifi/rover.glb", 0.54],
  ["/models/scifi/satelliteDish.glb", 0.62],
  ["/models/biomes/alien/Crystal_Small_1.glb", 0.42],
  ["/models/biomes/alien/Crystal_Small_2.glb", 0.42],
]);

const STORY_CLEAR_RADIUS = new Map<string, number>([
  ["/models/landmarks/desert/Tent.glb", 0.72],
  ["/models/landmarks/snow/Tent.glb", 0.72],
  ["/models/scifi/rover.glb", 0.7],
  ["/models/scifi/machine_generatorLarge.glb", 0.65],
  ["/models/scifi/machine_barrelLarge.glb", 0.6],
  ["/models/scifi/meteor_detailed.glb", 0.58],
  ["/models/scifi/rock_crystalsLargeA.glb", 0.58],
]);

const noRaycast: THREE.Mesh["raycast"] = () => {};

type Instance = { url: string; pos: Vec2; scale: number; rotY: number; clearRadius?: number };
type TraceMark = {
  pos: Vec2;
  rotY: number;
  sx: number;
  sy: number;
  color: string;
  opacity: number;
};
type WarningMarker = {
  pos: Vec2;
  rotY: number;
  clearRadius: number;
  color: string;
  accent: string;
};

const buildInstances = (
  biome: Biome,
  paths: Vec2[][],
  levelId: number,
  blockers: { pos: Vec2; radius: number }[],
  flow: FlowFeatures | null,
): Instance[] => {
  const urls = BIOME_COSMETICS[biome];
  if (urls.length === 0) return [];
  // Soft bounds so cluster halos don't poke past the visible playfield.
  const halfW = MAP_WIDTH * 0.47;
  const halfH = MAP_HEIGHT * 0.47;
  const bounds = { minX: -halfW, maxX: halfW, minY: -halfH, maxY: halfH };
  const pathR2 = PATH_CLEARANCE * PATH_CLEARANCE;

  // HQ-pad blocker per path endpoint — keep procedural cosmetics out of
  // the home-base compound where HQBase.tsx renders authored set-dressing.
  const hqCenters = paths.filter((p) => p.length >= 2).map((p) => p[p.length - 1]);
  const hqR2 = HQ_PAD_BLOCKER_RADIUS * HQ_PAD_BLOCKER_RADIUS;

  const isValid = (x: number, y: number): boolean => {
    if (isOnFlowSurface(flow, x, y, 0.5)) return false;
    for (const path of paths) {
      for (let i = 0; i < path.length - 1; i++) {
        if (distPointToSegSq(x, y, path[i].x, path[i].y, path[i + 1].x, path[i + 1].y) < pathR2) {
          return false;
        }
      }
    }
    for (const c of hqCenters) {
      const dx = c.x - x;
      const dy = c.y - y;
      if (dx * dx + dy * dy < hqR2) return false;
    }
    for (const b of blockers) {
      const dx = b.pos.x - x;
      const dy = b.pos.y - y;
      const minDist = b.radius + 0.75;
      if (dx * dx + dy * dy < minDist * minDist) return false;
    }
    return true;
  };

  const points = poissonDiskSample({
    bounds,
    radiusAt: () => PROP_SPACING,
    isValid,
    maxCount: COUNT_PER_LEVEL,
    seed: levelId * 8147 + 211,
    // Stratified jittered-grid anchors so the scatter covers the whole
    // playfield evenly instead of clumping into a few groves — the same
    // even-spread approach OuterScenery uses for the outer band.
    initialPoints: sampleStratifiedFeatures(levelId * 6271 + 13, bounds, COUNT_PER_LEVEL),
  });

  // Uniform random URL per instance — with the even spread there are no
  // discrete groves left to bias toward a single species.
  const detailRng = mulberry32(levelId * 3119 + 29);
  const out: Instance[] = [];
  for (const p of points) {
    out.push({
      url: urls[Math.floor(detailRng() * urls.length)],
      pos: { x: p.x, y: p.y },
      scale: 0.7 + ((detailRng() + detailRng()) / 2) * 0.7,
      rotY: detailRng() * Math.PI * 2,
    });
  }
  return out;
};

const storyRadiusFor = (url: string): number => STORY_CLEAR_RADIUS.get(url) ?? 0.45;

const buildStoryDetails = (
  biome: Biome,
  paths: Vec2[][],
  levelId: number,
  blockers: { pos: Vec2; radius: number }[],
  flow: FlowFeatures | null,
): { instances: Instance[]; traces: TraceMark[]; markers: WarningMarker[] } => {
  const urls = BIOME_STORY_PROPS[biome];
  const style = BIOME_STORY_TRACE_STYLE[biome];
  const instances: Instance[] = [];
  const traces: TraceMark[] = [];
  const markers: WarningMarker[] = [];
  if (urls.length === 0) return { instances, traces, markers };

  const halfW = MAP_WIDTH * 0.49;
  const halfH = MAP_HEIGHT * 0.49;
  const inBounds = (x: number, y: number) => x >= -halfW && x <= halfW && y >= -halfH && y <= halfH;

  // HQ-pad blocker — story props (3D buildings + warning markers) must
  // not crowd the home-base compound. Traces (flat drag-mark footprints)
  // intentionally extend into the HQ so the trail reads as leading INTO
  // the base; they bypass this check.
  const hqCenters = paths.filter((p) => p.length >= 2).map((p) => p[p.length - 1]);

  const blockedByWorld = (x: number, y: number, radius: number): boolean => {
    if (!inBounds(x, y)) return true;
    if (isOnFlowSurface(flow, x, y, radius)) return true;
    for (const c of hqCenters) {
      const dx = c.x - x;
      const dy = c.y - y;
      const minDist = HQ_PAD_BLOCKER_RADIUS + radius;
      if (dx * dx + dy * dy < minDist * minDist) return true;
    }
    for (const b of blockers) {
      const dx = b.pos.x - x;
      const dy = b.pos.y - y;
      const minDist = b.radius + radius + 0.2;
      if (dx * dx + dy * dy < minDist * minDist) return true;
    }
    return false;
  };

  for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
    const path = paths[pathIndex];
    if (path.length < 2) continue;
    const last = path[path.length - 1];
    const prev = path[path.length - 2];
    const dx = prev.x - last.x;
    const dy = prev.y - last.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1.8) continue;

    const faceX = dx / len;
    const faceY = dy / len;
    const rightX = faceY;
    const rightY = -faceX;
    const yaw = Math.atan2(dx, -dy);
    const rng = mulberry32(levelId * 9209 + pathIndex * 577 + 101);
    const sideSign = rng() < 0.5 ? -1 : 1;
    const maxFwd = Math.max(1.6, Math.min(6.1, len - 0.35));
    const clampFwd = (v: number) => Math.min(v, maxFwd);
    const at = (fwd: number, side: number): Vec2 => ({
      x: last.x + faceX * fwd + rightX * side,
      y: last.y + faceY * fwd + rightY * side,
    });

    for (let i = 0; i < 3; i++) {
      const p = at(clampFwd(1.6 + i * 1.25 + rng() * 0.35), sideSign * (rng() - 0.5) * 0.7);
      if (!inBounds(p.x, p.y) || isOnFlowSurface(flow, p.x, p.y, 0.15)) continue;
      traces.push({
        pos: p,
        rotY: yaw + (rng() - 0.5) * 0.22,
        sx: 0.16 + rng() * 0.1,
        sy: 0.42 + rng() * 0.2,
        color: style.trace,
        opacity: style.traceOpacity,
      });
    }

    const primaryIndex = levelId % 2 === 0 ? 0 : (levelId + pathIndex) % urls.length;
    const secondaryIndex = (levelId * 3 + pathIndex + 1) % urls.length;
    const picks = [urls[primaryIndex], urls[secondaryIndex]].filter(
      (url, i, arr) => arr.indexOf(url) === i,
    );

    for (let i = 0; i < Math.min(2, picks.length); i++) {
      const url = picks[i];
      const radius = storyRadiusFor(url);
      // Start ≥4.6 along the approach so 3D props sit beyond the HQ
      // compound (fence corner ≈ 4.1 from the tower) instead of crowding
      // right in front of the turret.
      const p = at(clampFwd(4.6 + i * 1.25 + rng() * 0.4), sideSign * (STORY_SIDE - i * 0.1));
      if (blockedByWorld(p.x, p.y, radius)) continue;
      instances.push({
        url,
        pos: p,
        scale: 0.9 + rng() * 0.25,
        rotY: yaw + Math.PI + (rng() - 0.5) * 0.65,
        clearRadius: radius,
      });
    }

    const markerPos = at(clampFwd(4.9 + rng() * 0.55), sideSign * (STORY_SIDE + 0.02));
    if (!blockedByWorld(markerPos.x, markerPos.y, 0.28)) {
      markers.push({
        pos: markerPos,
        rotY: yaw + Math.PI,
        clearRadius: 0.28,
        color: style.marker,
        accent: style.markerAccent,
      });
    }
  }

  return { instances, traces, markers };
};

// Cosmetic URLs come from packs with wildly varying authored max-dims;
// normalize to TARGET_SIZE_BY_ROLE so a BushFlowers patch reads the
// same size whether the source GLB is 1.97 or 0.5 units tall.
const cosmeticBaseScale = (source: MeshSource, url: string): number => {
  const storyTarget = STORY_TARGET_HEIGHT.get(url);
  if (storyTarget !== undefined) return storyTarget / Math.max(source.height, 0.001);
  return TARGET_SIZE_BY_ROLE[classifyPropUrl(url)] / source.maxDim;
};

// Shared instanced geometry/material caches. Every level's traces +
// markers collapse to four draw calls (one per part) regardless of how
// many individual marks the layer produced.
const STORY_GEOMS = {
  trace: new THREE.CircleGeometry(1, 18),
  markerPole: new THREE.CylinderGeometry(0.025, 0.035, 0.36, 7),
  markerTri: new THREE.CircleGeometry(0.18, 3),
};

const traceMaterial = (color: string, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
const markerPoleMaterial = (accent: string) =>
  new THREE.MeshStandardMaterial({ color: accent, roughness: 0.7, metalness: 0.15 });
const markerTriMaterial = (color: string) =>
  new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });

const STORY_MATERIALS: Partial<
  Record<
    Biome,
    {
      trace: THREE.Material;
      pole: THREE.Material;
      tri: THREE.Material;
      accent: THREE.Material;
    }
  >
> = {};

const storyMaterialsFor = (biome: Biome) => {
  const cached = STORY_MATERIALS[biome];
  if (cached) return cached;
  const style = BIOME_STORY_TRACE_STYLE[biome];
  const built = {
    trace: traceMaterial(style.trace, style.traceOpacity),
    pole: markerPoleMaterial(style.markerAccent),
    tri: markerTriMaterial(style.marker),
    accent: markerTriMaterial(style.markerAccent),
  };
  STORY_MATERIALS[biome] = built;
  return built;
};

const InstancedTraces = ({ items, biome }: { items: TraceMark[]; biome: Biome }) => {
  const ref = useRef<THREE.InstancedMesh | null>(null);
  const material = storyMaterialsFor(biome).trace;

  useEffect(() => {
    if (!ref.current) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < items.length; i++) {
      const m = items[i];
      dummy.position.set(m.pos.x, 0.046, -m.pos.y);
      // YXZ Euler so the composition is RotY(rotY) * RotX(-π/2) — same
      // as the original group(rotY) + mesh(-π/2,0,0) nesting.
      dummy.rotation.set(-Math.PI / 2, m.rotY, 0, "YXZ");
      dummy.scale.set(m.sx, m.sy, 1);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    }
    ref.current.count = items.length;
    ref.current.instanceMatrix.needsUpdate = true;
  }, [items]);

  if (items.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[STORY_GEOMS.trace, material, items.length]}
      raycast={noRaycast}
      // Positions are baked into per-instance matrices, so the default
      // origin-centered bounding sphere fails the frustum test once the
      // player zooms in and pans away from origin — culling the whole
      // batch and making the cosmetics vanish. Disable per-batch culling.
      frustumCulled={false}
    />
  );
};

// Per-instance matrix for a marker sub-part. The local offset is the
// part's position inside the marker group; rotZ is its Z rotation.
// Composition: position(marker) * RotY(rotY) * Translate(localOffset) * RotZ(rotZ) * Scale(scale).
const setMarkerPartMatrix = (
  dummy: THREE.Object3D,
  m: WarningMarker,
  localOffset: [number, number, number],
  rotZ: number,
  scale: number,
) => {
  const cos = Math.cos(m.rotY);
  const sin = Math.sin(m.rotY);
  const [lx, ly, lz] = localOffset;
  // RotateY(rotY) applied to local offset:
  //   wx =  lx * cos + lz * sin
  //   wz = -lx * sin + lz * cos
  const wx = lx * cos + lz * sin;
  const wz = -lx * sin + lz * cos;
  dummy.position.set(m.pos.x + wx, ly, -m.pos.y + wz);
  // YXZ Euler so we end up with RotY(rotY) * RotZ(rotZ) — group rotation
  // applied first, then the per-part Z rotation in the local frame.
  dummy.rotation.set(0, m.rotY, rotZ, "YXZ");
  dummy.scale.setScalar(scale);
  dummy.updateMatrix();
};

const InstancedMarkers = ({ items, biome }: { items: WarningMarker[]; biome: Biome }) => {
  const poleRef = useRef<THREE.InstancedMesh | null>(null);
  const triRef = useRef<THREE.InstancedMesh | null>(null);
  const accentRef = useRef<THREE.InstancedMesh | null>(null);
  const mats = storyMaterialsFor(biome);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < items.length; i++) {
      const m = items[i];
      if (poleRef.current) {
        setMarkerPartMatrix(dummy, m, [0, 0.18, 0], 0, 1);
        poleRef.current.setMatrixAt(i, dummy.matrix);
      }
      if (triRef.current) {
        setMarkerPartMatrix(dummy, m, [0, 0.42, 0.018], Math.PI / 2, 1);
        triRef.current.setMatrixAt(i, dummy.matrix);
      }
      if (accentRef.current) {
        setMarkerPartMatrix(dummy, m, [0, 0.42, 0.021], Math.PI / 2, 0.56);
        accentRef.current.setMatrixAt(i, dummy.matrix);
      }
    }
    if (poleRef.current) {
      poleRef.current.count = items.length;
      poleRef.current.instanceMatrix.needsUpdate = true;
    }
    if (triRef.current) {
      triRef.current.count = items.length;
      triRef.current.instanceMatrix.needsUpdate = true;
    }
    if (accentRef.current) {
      accentRef.current.count = items.length;
      accentRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [items]);

  if (items.length === 0) return null;
  return (
    <>
      {/* frustumCulled={false}: positions baked into per-instance matrices
          would otherwise be culled as a batch when zoomed in and panned. */}
      <instancedMesh
        ref={poleRef}
        args={[STORY_GEOMS.markerPole, mats.pole, items.length]}
        raycast={noRaycast}
        frustumCulled={false}
      />
      <instancedMesh
        ref={triRef}
        args={[STORY_GEOMS.markerTri, mats.tri, items.length]}
        raycast={noRaycast}
        frustumCulled={false}
      />
      <instancedMesh
        ref={accentRef}
        args={[STORY_GEOMS.markerTri, mats.accent, items.length]}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </>
  );
};

export const BiomeCosmetics = () => {
  // Dev level-editor "override procedural" blanks the auto cosmetics/story
  // props so hand-placed props are the only set-dressing. Always false in prod.
  const overrideActive = useGame((s) => s.world.overrideActive);
  const biome = useGame((s) => s.world.biome);
  const paths = useGame((s) => s.world.paths);
  const levelId = useGame((s) => s.world.levelId);
  const trees = useGame((s) => s.world.trees);
  const rocks = useGame((s) => s.world.rocks);
  // world.towers is mutated in place on placement (push), so subscribing to
  // the array reference wouldn't notify React. towerVersion bumps on every
  // place/sell — that's the trigger; the array is read via getState.
  const towerVersion = useGame((s) => s.ui.towerVersion);
  const towers = useGame.getState().world.towers;

  const details = useMemo(() => {
    // Block cosmetics from spawning on top of trees/rocks that already exist.
    const blockers: { pos: Vec2; radius: number }[] = [
      ...trees.map((t) => ({ pos: t.pos, radius: 0.9 * t.scale })),
      ...rocks.map((r) => ({ pos: r.pos, radius: 0.7 * r.scale })),
    ];
    const flow = hasFlowFeatures(biome) ? buildFlowFeatures(paths, levelId, biome) : null;
    const story = buildStoryDetails(biome, paths, levelId, blockers, flow);
    const instances = [
      ...buildInstances(biome, paths, levelId, blockers, flow),
      ...story.instances,
    ];
    const byUrl = new Map<string, Instance[]>();
    for (const inst of instances) {
      const list = byUrl.get(inst.url) ?? [];
      list.push(inst);
      byUrl.set(inst.url, list);
    }
    return { groups: Array.from(byUrl.entries()), traces: story.traces, markers: story.markers };
  }, [biome, paths, levelId, trees, rocks]);

  // Cull cosmetics that overlap a tower so the base sits on clean ground.
  // Filtered at render-time to keep placement stable as towers come/go.
  // biome-ignore lint/correctness/useExhaustiveDependencies: towerVersion is the intended invalidation key
  const culledDetails = useMemo(() => {
    if (towers.length === 0) return details;
    const towerR = TOWER_FOOTPRINT * 0.5;
    const nearTower = (pos: Vec2, radius: number): boolean => {
      for (const t of towers) {
        const dx = t.pos.x - pos.x;
        const dy = t.pos.y - pos.y;
        const lim = towerR + radius;
        if (dx * dx + dy * dy < lim * lim) return true;
      }
      return false;
    };
    return {
      groups: details.groups.map(([url, items]): [string, Instance[]] => {
        const filtered = items.filter((it) => !nearTower(it.pos, it.clearRadius ?? 0.3));
        return [url, filtered];
      }),
      traces: details.traces,
      markers: details.markers.filter((m) => !nearTower(m.pos, m.clearRadius)),
    };
  }, [details, towers, towerVersion]);

  // Hooks above must run unconditionally; bail after them when the editor
  // has suppressed procedural set-dressing for this level.
  if (overrideActive) return null;

  return (
    <group>
      <InstancedTraces items={culledDetails.traces} biome={biome} />
      <InstancedMarkers items={culledDetails.markers} biome={biome} />
      {culledDetails.groups.map(([url, items]) => (
        <InstancedGroup
          key={url}
          url={url}
          items={items}
          baseScaleFor={cosmeticBaseScale}
          raycast={noRaycast}
        />
      ))}
    </group>
  );
};

// Preload every cosmetic URL so switching biomes mid-session doesn't stall.
for (const urls of Object.values(BIOME_COSMETICS)) {
  for (const url of urls) useGLTF.preload(url);
}
for (const urls of Object.values(BIOME_STORY_PROPS)) {
  for (const url of urls) useGLTF.preload(url);
}
