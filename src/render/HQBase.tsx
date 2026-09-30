import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { HQ_PAD_BLOCKER_RADIUS, PATH_WIDTH } from "../level";
import { mulberry32 } from "../sim/random";
import type { Vec2 } from "../sim/types";
import { distToSegmentSq } from "../sim/vec2";
import { TOWER_FOOTPRINT } from "../sim/world";
import { useGame } from "../store";
import { CommandBase } from "./CommandBase";
import { commandComplexPlan, overlapsCommandLink } from "./commandBaseLayout";
import { commandBuildingPlan } from "./commandBuildingPlan";
import {
  DEAD_DINO_SPECS,
  DeadDinoInstancer,
  type DeadDinoItem,
  deadDinoCollisionRadius,
} from "./DeadDinos";

// The command building sits behind the functional defence turret. Perimeter
// fixtures and corpse rejection retain the existing HQ reservation.
const HQ_CLUSTER_RADIUS = 3.6;

type PrimitiveDef = {
  kind: "fence" | "light";
  right: number;
  fwd: number;
  clearRadius: number;
  length?: number;
  yawOffset?: number;
};

// Perimeter fence: 3 sides closed (back + left + right), front open where the
// approach path connects. Segment endpoints land under each corner torch so
// posts and lights align.
const BASE_PRIMITIVES: PrimitiveDef[] = [
  // Back row — full pad width at fwd = -2.5.
  { kind: "fence", right: -2.6, fwd: -2.5, length: 1.3, clearRadius: 0.6 },
  { kind: "fence", right: -1.3, fwd: -2.5, length: 1.3, clearRadius: 0.6 },
  { kind: "fence", right: 0, fwd: -2.5, length: 1.3, clearRadius: 0.6 },
  { kind: "fence", right: 1.3, fwd: -2.5, length: 1.3, clearRadius: 0.6 },
  { kind: "fence", right: 2.6, fwd: -2.5, length: 1.3, clearRadius: 0.6 },
  // Left side — runs from back torch to front torch along fwd-axis.
  {
    kind: "fence",
    right: -3.25,
    fwd: -1.75,
    length: 1.5,
    yawOffset: Math.PI / 2,
    clearRadius: 0.6,
  },
  {
    kind: "fence",
    right: -3.25,
    fwd: -0.25,
    length: 1.5,
    yawOffset: Math.PI / 2,
    clearRadius: 0.6,
  },
  {
    kind: "fence",
    right: -3.25,
    fwd: 1.25,
    length: 1.5,
    yawOffset: Math.PI / 2,
    clearRadius: 0.6,
  },
  // Right side — mirror of the left.
  {
    kind: "fence",
    right: 3.25,
    fwd: -1.75,
    length: 1.5,
    yawOffset: Math.PI / 2,
    clearRadius: 0.6,
  },
  {
    kind: "fence",
    right: 3.25,
    fwd: -0.25,
    length: 1.5,
    yawOffset: Math.PI / 2,
    clearRadius: 0.6,
  },
  {
    kind: "fence",
    right: 3.25,
    fwd: 1.25,
    length: 1.5,
    yawOffset: Math.PI / 2,
    clearRadius: 0.6,
  },
  // Torches at the four perimeter corners.
  { kind: "light", right: -3.25, fwd: -2.5, clearRadius: 0.4 },
  { kind: "light", right: 3.25, fwd: -2.5, clearRadius: 0.4 },
  { kind: "light", right: -3.25, fwd: 2.0, clearRadius: 0.4 },
  { kind: "light", right: 3.25, fwd: 2.0, clearRadius: 0.4 },
];

// Authored dead-dinosaur corpse slots ringing each HQ pad — pad-local
// (right, fwd) like BASE_PROPS. Picked to sit outside the fence perimeter
// (sides at ±4.8, back beyond fwd ≈ -4.1, front beyond fwd ≈ 4.1) so the
// corpse silhouettes never clip into fences, buildings, or the pad rim.
// Per-HQ RNG draws from this pool with a runtime collision check that
// rejects any slot overlapping a path, building prop, pad rect, or
// previously-placed corpse — so two neighbouring corpses can't stack
// poses and a curved approach can't shave a carcass with the walking lane.
const HQ_CORPSE_SLOTS: { right: number; fwd: number }[] = [
  { right: -4.8, fwd: -0.5 },
  { right: 4.8, fwd: -0.5 },
  { right: -4.8, fwd: 1.6 },
  { right: 4.8, fwd: 1.6 },
  { right: -4.8, fwd: -2.2 },
  { right: 4.8, fwd: -2.2 },
  { right: -3.6, fwd: 4.1 },
  { right: 3.6, fwd: 4.1 },
  { right: 0, fwd: -4.2 },
  { right: -2.6, fwd: -4.3 },
  { right: 2.6, fwd: -4.3 },
];

// Corpses normalize to their species footprint (3.6–4.6 world units) which
// is way too large for the ground around the fence box — scale down so a
// Trex carcass sits at ~1.7 units long. Tighter than the old 0.42–0.56
// range so the slots farther out from the fence still feel anchored to
// the HQ vignette rather than dropped in open field.
const HQ_CORPSE_SCALE_MIN = 0.32;
const HQ_CORPSE_SCALE_MAX = 0.4;

// HQ keep-out rectangle (6.7×5.0 centered at local (0, -0.1)). Corpse
// slot-vs-rect rejection uses pad-local distance from the slot to the rect
// edge, so a corpse footprint can never poke into the HQ core/turret area.
const HQ_PAD_HALF_RIGHT = 3.35;
const HQ_PAD_HALF_FWD = 2.5;
const HQ_PAD_FWD_CENTER = -0.1;

const noRaycast: THREE.Mesh["raycast"] = () => {};

type PrimitiveInstance = {
  kind: PrimitiveDef["kind"];
  pos: Vec2;
  rotY: number;
  clearRadius: number;
  length: number;
};

// Shared geometries/materials for the instanced fences + lights. Built
// once at module load — every HQ pad reuses the same buffers so the
// whole base-decoration layer collapses to five draw calls regardless
// of how many paths the level has.
const PRIMITIVE_GEOMS = {
  fenceBar: new THREE.BoxGeometry(1, 0.08, 0.08),
  fencePost: new THREE.BoxGeometry(0.08, 0.44, 0.08),
  lightPole: new THREE.CylinderGeometry(0.035, 0.045, 0.52, 8),
  lightBall: new THREE.SphereGeometry(0.09, 10, 8),
};
const PRIMITIVE_MATS = {
  fenceBar: new THREE.MeshStandardMaterial({ color: "#3f4752", roughness: 0.72, metalness: 0.18 }),
  fencePost: new THREE.MeshStandardMaterial({ color: "#2a313a", roughness: 0.75, metalness: 0.2 }),
  lightPole: new THREE.MeshStandardMaterial({ color: "#242b34", roughness: 0.78, metalness: 0.28 }),
  lightBall: new THREE.MeshStandardMaterial({
    color: "#bdf4ff",
    emissive: "#5eeaff",
    emissiveIntensity: 1.4,
    roughness: 0.25,
  }),
};

type InstancedPart = {
  geom: THREE.BufferGeometry;
  mat: THREE.Material;
  // Local offset (in the primitive's own frame) before applying the
  // primitive's world position + rotY.
  localPos: [number, number, number];
  // x scale comes from the fence length; everything else stays at 1.
  scaleFromLength?: boolean;
};

const buildMatrix = (
  it: PrimitiveInstance,
  part: InstancedPart,
  dummy: THREE.Object3D,
): THREE.Matrix4 => {
  const cos = Math.cos(it.rotY);
  const sin = Math.sin(it.rotY);
  const [lx, ly, lz] = part.localPos;
  // RotateY(rotY) applied to local offset:
  //   wx =  lx * cos + lz * sin
  //   wz = -lx * sin + lz * cos
  const wx = lx * cos + lz * sin;
  const wz = -lx * sin + lz * cos;
  dummy.position.set(it.pos.x + wx, ly, -it.pos.y + wz);
  dummy.rotation.set(0, it.rotY, 0);
  const sx = part.scaleFromLength ? it.length : 1;
  dummy.scale.set(sx, 1, 1);
  dummy.updateMatrix();
  return dummy.matrix;
};

const InstancedPrimitiveMesh = ({
  items,
  part,
}: {
  items: PrimitiveInstance[];
  part: InstancedPart;
}) => {
  const ref = useRef<THREE.InstancedMesh | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < items.length; i++) {
      ref.current.setMatrixAt(i, buildMatrix(items[i], part, dummy));
    }
    ref.current.count = items.length;
    ref.current.instanceMatrix.needsUpdate = true;
  }, [items, part]);

  if (items.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[part.geom, part.mat, items.length]}
      raycast={noRaycast}
      castShadow
      receiveShadow
      // Positions are baked into per-instance matrices, so the default
      // origin-centered bounding sphere fails the frustum test once the
      // player zooms in and pans away from origin — culling the whole
      // batch and making base fences/lights vanish. Disable culling.
      frustumCulled={false}
    />
  );
};

const BasePrimitives = ({ items }: { items: PrimitiveInstance[] }) => {
  const fences = useMemo(() => items.filter((it) => it.kind === "fence"), [items]);
  const lights = useMemo(() => items.filter((it) => it.kind === "light"), [items]);

  return (
    <>
      <InstancedPrimitiveMesh
        items={fences}
        part={{
          geom: PRIMITIVE_GEOMS.fenceBar,
          mat: PRIMITIVE_MATS.fenceBar,
          localPos: [0, 0.28, 0],
          scaleFromLength: true,
        }}
      />
      <FencePostsOffset items={fences} sign={-1} />
      <FencePostsOffset items={fences} sign={1} />
      <InstancedPrimitiveMesh
        items={lights}
        part={{
          geom: PRIMITIVE_GEOMS.lightPole,
          mat: PRIMITIVE_MATS.lightPole,
          localPos: [0, 0.26, 0],
        }}
      />
      <InstancedPrimitiveMesh
        items={lights}
        part={{
          geom: PRIMITIVE_GEOMS.lightBall,
          mat: PRIMITIVE_MATS.lightBall,
          localPos: [0, 0.57, 0],
        }}
      />
    </>
  );
};

// Fence posts need a per-instance offset along the bar (±length/2). The
// localPos in InstancedPart is fixed, so we add a thin wrapper that
// shifts the localPos per render — both posts share the same geometry
// and material, only the offset sign differs.
const FencePostsOffset = ({ items, sign }: { items: PrimitiveInstance[]; sign: 1 | -1 }) => {
  const ref = useRef<THREE.InstancedMesh | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const cos = Math.cos(it.rotY);
      const sin = Math.sin(it.rotY);
      const lx = (sign * it.length) / 2;
      const wx = lx * cos;
      const wz = -lx * sin;
      dummy.position.set(it.pos.x + wx, 0.22, -it.pos.y + wz);
      dummy.rotation.set(0, it.rotY, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    }
    ref.current.count = items.length;
    ref.current.instanceMatrix.needsUpdate = true;
  }, [items, sign]);

  if (items.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[PRIMITIVE_GEOMS.fencePost, PRIMITIVE_MATS.fencePost, items.length]}
      raycast={noRaycast}
      castShadow
      receiveShadow
      // Baked per-instance matrices — see InstancedPrimitiveMesh above.
      frustumCulled={false}
    />
  );
};

export const HQBase = () => {
  const paths = useGame((s) => s.world.paths);
  const levelId = useGame((s) => s.world.levelId);
  const biome = useGame((s) => s.world.biome);
  const complex = useMemo(() => commandComplexPlan(paths), [paths]);
  const towerVersion = useGame((s) => s.ui.towerVersion);
  const towers = useGame.getState().world.towers;

  const { primitives } = useMemo(() => {
    const primitiveList: PrimitiveInstance[] = [];

    for (const pose of complex.poses) {
      if (complex.poses.some((other) => other !== pose && other.group === pose.group)) continue;
      const path = paths[pose.index];
      const last = path[path.length - 1];
      const prev = path[path.length - 2];
      const dx = prev.x - last.x;
      const dy = prev.y - last.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const faceX = dx / len;
      const faceY = dy / len;
      const rightX = faceY;
      const rightY = -faceX;
      const yaw = Math.atan2(dx, -dy);
      const panels = commandBuildingPlan(biome, levelId + pose.index);

      for (const def of BASE_PRIMITIVES) {
        const wx = last.x + def.right * rightX + def.fwd * faceX;
        const wy = last.y + def.right * rightY + def.fwd * faceY;
        const pos = { x: wx, y: wy };
        const localX = (wx - last.x) * Math.cos(yaw) + (wy - last.y) * Math.sin(yaw);
        const localZ = (wx - last.x) * Math.sin(yaw) - (wy - last.y) * Math.cos(yaw);
        if (
          def.kind === "fence" &&
          panels.some((panel) => {
            if (panel.at[1] + panel.size[1] / 2 < 0.5) return false;
            const px = Math.max(0, Math.abs(localX - panel.at[0]) - panel.size[0] / 2);
            const pz = Math.max(0, Math.abs(localZ - panel.at[2]) - panel.size[2] / 2);
            return Math.hypot(px, pz) < (def.length ?? 1) / 2 + 0.1;
          })
        )
          continue;
        if (overlapsCommandLink(pos, (def.length ?? 0.6) / 2, complex.links)) continue;
        if (
          complex.poses.some(
            (other) =>
              other.index !== pose.index &&
              other.group === pose.group &&
              Math.hypot(wx - other.end.x, wy - other.end.y) < 3.35,
          )
        )
          continue;
        primitiveList.push({
          kind: def.kind,
          pos: { x: wx, y: wy },
          rotY: yaw + (def.yawOffset ?? 0),
          clearRadius: def.clearRadius,
          length: def.length ?? 1,
        });
      }
    }
    return { primitives: primitiveList };
  }, [paths, complex, biome, levelId]);

  // Only the perimeter fence/lights cull around towers + the path; the
  // command base itself is a fixed fixture on the pad.
  // biome-ignore lint/correctness/useExhaustiveDependencies: towerVersion is the intended invalidation key
  const visiblePrimitives = useMemo(() => {
    const towerR = TOWER_FOOTPRINT * 0.5;
    const pathHalf = PATH_WIDTH * 0.5;
    const clear = (item: PrimitiveInstance) => {
      for (const tower of towers) {
        const dx = tower.pos.x - item.pos.x;
        const dy = tower.pos.y - item.pos.y;
        const lim = towerR + item.clearRadius;
        if (dx * dx + dy * dy < lim * lim) return false;
      }
      const pathLim = pathHalf + item.clearRadius;
      const pathLimSq = pathLim * pathLim;
      for (const path of paths) {
        for (let i = 0; i < path.length - 1; i++) {
          if (distToSegmentSq(item.pos, path[i], path[i + 1]) < pathLimSq) return false;
        }
      }
      return true;
    };
    return primitives.filter(clear);
  }, [primitives, towers, paths, towerVersion]);

  // Per-HQ dead-dinosaur corpses. Deterministic per level so the same node
  // always shows the same aftermath, but per-path RNG so two HQs in the
  // same level get different species and slot subsets. Many levels get
  // zero corpses (clean base) — the player should still occasionally see
  // a base scrubbed and intact. Slots are filtered at runtime so a corpse
  // never overlaps a path, building, pad rim, or another corpse.
  const corpseGroups = useMemo(() => {
    const pathHalf = PATH_WIDTH * 0.5;
    const hqCenters = paths.filter((p) => p.length >= 2).map((p) => p[p.length - 1]);
    const byUrl = new Map<string, DeadDinoItem[]>();

    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
      const path = paths[pathIndex];
      if (path.length < 2) continue;
      const last = path[path.length - 1];
      const prev = path[path.length - 2];
      const dx = prev.x - last.x;
      const dy = prev.y - last.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const faceX = dx / len;
      const faceY = dy / len;
      const rightX = faceY;
      const rightY = -faceX;

      const rng = mulberry32(levelId * 17207 + pathIndex * 1297 + 53);
      // 45% no corpses, 35% two, 20% three. Skews toward the cleaner
      // visual most of the time; the mayhem reads strongest when not
      // every base looks the same.
      const roll = rng();
      const wanted = roll < 0.45 ? 0 : roll < 0.8 ? 2 : 3;
      if (wanted === 0) continue;

      // Fisher–Yates the slot pool so picks are distinct.
      const slotOrder = HQ_CORPSE_SLOTS.map((_, i) => i);
      for (let i = slotOrder.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [slotOrder[i], slotOrder[j]] = [slotOrder[j], slotOrder[i]];
      }
      const speciesOrder = DEAD_DINO_SPECS.map((_, i) => i);
      for (let i = speciesOrder.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [speciesOrder[i], speciesOrder[j]] = [speciesOrder[j], speciesOrder[i]];
      }

      const placedHere: { x: number; y: number; r: number }[] = [];
      let placedCount = 0;
      for (let si = 0; si < slotOrder.length && placedCount < wanted; si++) {
        const slot = HQ_CORPSE_SLOTS[slotOrder[si]];
        const spec = DEAD_DINO_SPECS[speciesOrder[placedCount % DEAD_DINO_SPECS.length]];
        const scale = HQ_CORPSE_SCALE_MIN + rng() * (HQ_CORPSE_SCALE_MAX - HQ_CORPSE_SCALE_MIN);
        const rotY = rng() * Math.PI * 2;
        const corpseR = deadDinoCollisionRadius(spec.url, scale);
        const wx = last.x + slot.right * rightX + slot.fwd * faceX;
        const wy = last.y + slot.right * rightY + slot.fwd * faceY;
        const here: Vec2 = { x: wx, y: wy };

        // Pad rect (pad-local). Slot is already in pad-local coords, so
        // reject if the corpse circle reaches inside the rect.
        const padDx = Math.max(0, Math.abs(slot.right) - HQ_PAD_HALF_RIGHT);
        const padDy = Math.max(0, Math.abs(slot.fwd - HQ_PAD_FWD_CENTER) - HQ_PAD_HALF_FWD);
        if (padDx * padDx + padDy * padDy < corpseR * corpseR) continue;

        // Walking corridor — any path on the map.
        let blocked = false;
        const pathLim = corpseR + pathHalf + 0.05;
        const pathLimSq = pathLim * pathLim;
        for (const p of paths) {
          for (let i = 0; i < p.length - 1; i++) {
            if (distToSegmentSq(here, p[i], p[i + 1]) < pathLimSq) {
              blocked = true;
              break;
            }
          }
          if (blocked) break;
        }
        if (blocked) continue;

        // HQ command base footprint — keep carcasses off the buildings.
        for (const c of hqCenters) {
          const ix = c.x - wx;
          const iy = c.y - wy;
          const connected = complex.poses.some(
            (p) =>
              p.end.x === c.x &&
              p.end.y === c.y &&
              complex.poses.some((other) => other !== p && other.group === p.group),
          );
          const lim = corpseR + (connected ? HQ_PAD_BLOCKER_RADIUS : HQ_CLUSTER_RADIUS);
          if (ix * ix + iy * iy < lim * lim) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        // Fence/light primitives. Fences use segment distance so long rails
        // and their posts are treated as blockers, not just their centres.
        for (const primitive of primitives) {
          if (primitive.kind === "fence") {
            const cos = Math.cos(primitive.rotY);
            const sin = Math.sin(primitive.rotY);
            const halfLen = primitive.length * 0.5;
            const a = {
              x: primitive.pos.x - cos * halfLen,
              y: primitive.pos.y - sin * halfLen,
            };
            const b = {
              x: primitive.pos.x + cos * halfLen,
              y: primitive.pos.y + sin * halfLen,
            };
            const lim = corpseR + 0.08;
            if (distToSegmentSq(here, a, b) < lim * lim) {
              blocked = true;
              break;
            }
            continue;
          }

          const ix = primitive.pos.x - wx;
          const iy = primitive.pos.y - wy;
          const lim = corpseR + primitive.clearRadius * 0.45;
          if (ix * ix + iy * iy < lim * lim) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        // Other corpses on the same HQ — primary fix for the "stacked
        // poses" bug. 0.2u extra slack so silhouettes don't kiss.
        for (const c of placedHere) {
          const cx = c.x - wx;
          const cy = c.y - wy;
          const lim = corpseR + c.r + 0.2;
          if (cx * cx + cy * cy < lim * lim) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        if (overlapsCommandLink({ x: wx, y: wy }, corpseR, complex.links)) continue;
        placedHere.push({ x: wx, y: wy, r: corpseR });
        const item: DeadDinoItem = {
          id: `hq-${levelId}-${pathIndex}-${si}-${spec.url}`,
          pos: new THREE.Vector3(wx, 0, -wy),
          rotY,
          scale,
        };
        const list = byUrl.get(spec.url) ?? [];
        list.push(item);
        byUrl.set(spec.url, list);
        placedCount++;
      }
    }
    return Array.from(byUrl.entries());
  }, [paths, levelId, primitives, complex]);

  return (
    <>
      <BasePrimitives items={visiblePrimitives} />
      <CommandBase paths={paths} biome={biome} seed={levelId} />
      {corpseGroups.map(([url, items]) => (
        <DeadDinoInstancer key={url} url={url} items={items} />
      ))}
    </>
  );
};
