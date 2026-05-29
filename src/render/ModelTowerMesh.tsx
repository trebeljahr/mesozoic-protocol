import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { TowerKind, TowerUpgrades } from "../sim/types";
import { useGame } from "../store";
import { type AtlasSwatch, computeTowerTints, tierKey } from "./towerTints";

type SolidAtlasState = {
  materialsBySwatch: Map<number, THREE.MeshStandardMaterial>;
};

type AtlasMaterial = THREE.MeshStandardMaterial & {
  __solidAtlasState?: SolidAtlasState;
};

const clearEmissive = (mat: THREE.MeshStandardMaterial) => {
  if (!mat.emissive) return;
  mat.emissive.setRGB(0, 0, 0);
  mat.emissiveIntensity = 0;
};

const swatchXForVertex = (uv: THREE.BufferAttribute, vertexIndex: number): number => {
  const u = Math.min(0.999999, Math.max(0, uv.getX(vertexIndex)));
  return Math.min(28, Math.max(0, Math.floor((u * 32) / 4) * 4));
};

const nearestSwatchX = (x: number, swatchXs: readonly number[]): number => {
  let best = swatchXs[0] ?? 0;
  let bestDist = Math.abs(x - best);
  for (const sx of swatchXs) {
    const d = Math.abs(x - sx);
    if (d < bestDist) {
      best = sx;
      bestDist = d;
    }
  }
  return best;
};

const triangleSwatchX = (
  uv: THREE.BufferAttribute,
  a: number,
  b: number,
  c: number,
  swatchXs: readonly number[],
): number => {
  const ax = swatchXForVertex(uv, a);
  const bx = swatchXForVertex(uv, b);
  const cx = swatchXForVertex(uv, c);
  if (ax === bx || ax === cx) return nearestSwatchX(ax, swatchXs);
  if (bx === cx) return nearestSwatchX(bx, swatchXs);
  return nearestSwatchX(Math.round((ax + bx + cx) / 12) * 4, swatchXs);
};

const solidifyAtlasGeometry = (geometry: THREE.BufferGeometry, swatchXs: readonly number[]) => {
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!uv || !pos || swatchXs.length === 0) return null;

  const buckets = new Map<number, number[]>();
  for (const x of swatchXs) buckets.set(x, []);

  const sourceIndex = geometry.getIndex();
  const readIndex = (i: number) => sourceIndex?.getX(i) ?? i;
  const indexCount = sourceIndex?.count ?? pos.count;
  for (let i = 0; i + 2 < indexCount; i += 3) {
    const a = readIndex(i);
    const b = readIndex(i + 1);
    const c = readIndex(i + 2);
    const x = triangleSwatchX(uv, a, b, c, swatchXs);
    buckets.get(x)?.push(a, b, c);
  }

  const nextIndex: number[] = [];
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  for (let materialIndex = 0; materialIndex < swatchXs.length; materialIndex++) {
    const bucket = buckets.get(swatchXs[materialIndex]) ?? [];
    if (bucket.length === 0) continue;
    groups.push({ start: nextIndex.length, count: bucket.length, materialIndex });
    nextIndex.push(...bucket);
  }

  const next = geometry.clone();
  next.clearGroups();
  let maxIndex = 0;
  for (const i of nextIndex) if (i > maxIndex) maxIndex = i;
  const IndexArray = maxIndex > 65535 ? Uint32Array : Uint16Array;
  next.setIndex(new THREE.BufferAttribute(new IndexArray(nextIndex), 1));
  for (const group of groups) next.addGroup(group.start, group.count, group.materialIndex);
  return next;
};

const setupSolidAtlasState = (
  mesh: THREE.Mesh,
  sourceMat: AtlasMaterial,
  swatches: AtlasSwatch[],
): SolidAtlasState | null => {
  if (sourceMat.__solidAtlasState) return sourceMat.__solidAtlasState;
  const swatchXs = swatches.map((sw) => sw.x);
  const geometry = solidifyAtlasGeometry(mesh.geometry, swatchXs);
  if (!geometry) return null;

  const materialsBySwatch = new Map<number, THREE.MeshStandardMaterial>();
  const materials = swatches.map((sw) => {
    const mat = sourceMat.clone();
    mat.map = null;
    mat.emissiveMap = null;
    mat.color.setRGB(sw.rgb[0], sw.rgb[1], sw.rgb[2]);
    clearEmissive(mat);
    mat.name = `${sourceMat.name}:solid:${sw.x}`;
    mat.needsUpdate = true;
    materialsBySwatch.set(sw.x, mat);
    return mat;
  });

  mesh.geometry = geometry;
  mesh.material = materials;
  const state = { materialsBySwatch };
  for (const mat of materials) (mat as AtlasMaterial).__solidAtlasState = state;
  return state;
};

const updateSolidAtlas = (state: SolidAtlasState, swatches: AtlasSwatch[]) => {
  for (const sw of swatches) {
    const mat = state.materialsBySwatch.get(sw.x);
    if (!mat) continue;
    mat.color.setRGB(sw.rgb[0], sw.rgb[1], sw.rgb[2]);
    clearEmissive(mat);
  }
};

const applyTints = (item: THREE.Object3D, kind: TowerKind, upgrades: TowerUpgrades) => {
  const tints = computeTowerTints(kind, upgrades);
  item.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const atlasTint = tints.find(
      (tn) => tn.kind === "atlas" && mats.some((mat) => mat?.name.includes(tn.match)),
    );
    if (atlasTint?.kind === "atlas") {
      const sourceMat = mats.find((mat) => mat?.name.includes(atlasTint.match)) as
        | AtlasMaterial
        | undefined;
      if (sourceMat) {
        const state = setupSolidAtlasState(mesh, sourceMat, atlasTint.swatches);
        if (state) updateSolidAtlas(state, atlasTint.swatches);
      }
      return;
    }

    for (const raw of mats) {
      const mat = raw as AtlasMaterial;
      if (!mat) continue;
      clearEmissive(mat);
      const tint = tints.find((tn) => mat.name.includes(tn.match));
      if (!tint) continue;
      if (tint.kind === "material") {
        // Untextured baseColorFactor part — set its colour directly.
        mat.color.setRGB(tint.rgb[0], tint.rgb[1], tint.rgb[2]);
        mat.needsUpdate = true;
      }
    }
  });
};

type Props = {
  kind: TowerKind;
  url: string;
  targetSize: number;
  yOffset?: number;
  baseRotY?: number;
  idleSpin?: boolean;
};

export const ModelTowerMesh = ({
  kind,
  url,
  targetSize,
  yOffset = 0,
  baseRotY = 0,
  idleSpin = false,
}: Props) => {
  const { scene } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);
  const itemsRef = useRef<Map<number, THREE.Object3D>>(new Map());
  // Last upgrade-tier pair we tinted each tower at. Lets the frame loop
  // skip re-applying tints when nothing changed.
  const tierRef = useRef<Map<number, number>>(new Map());

  const { normalizedScale, centerXZ, scaledMinY } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const s = targetSize / maxDim;
    return {
      normalizedScale: s,
      centerXZ: { x: center.x * s, z: center.z * s },
      scaledMinY: box.min.y * s,
    };
  }, [scene, targetSize]);

  useEffect(() => {
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;
        // Flamethrower's particle stream extends far beyond the turret's
        // bounding box. When the player zooms in and pans so the nozzle
        // sits off-screen, the model's per-mesh frustum test kills the
        // draw and the flame stream vanishes with it. Disabling per-mesh
        // culling on tower models is cheap
        // (6 kinds, low instance counts) and prevents the pop.
        m.frustumCulled = false;
      }
    });
  }, [scene]);

  useEffect(
    () => () => {
      const parent = groupRef.current;
      if (!parent) return;
      for (const [, item] of itemsRef.current) parent.remove(item);
      itemsRef.current.clear();
    },
    [],
  );

  useFrame(() => {
    const parent = groupRef.current;
    if (!parent) return;
    const { world } = useGame.getState();

    const live = new Set<number>();
    for (const t of world.towers) {
      if (t.kind !== kind) continue;
      live.add(t.id);
      let item = itemsRef.current.get(t.id);
      if (!item) {
        item = scene.clone(true);
        item.scale.setScalar(normalizedScale);
        // Per-instance material clones — the GLTF cache hands every
        // tower the same material reference by default, so tinting one
        // would tint them all. Clone here so each tower's upgrade
        // colours are independent.
        item.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.frustumCulled = false;
          const m = mesh.material;
          if (Array.isArray(m)) mesh.material = m.map((sub) => sub.clone());
          else if (m) mesh.material = m.clone();
          // Tower materials should read as solid albedo, not emissive overlays.
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mm of mats) {
            if (!mm) continue;
            clearEmissive(mm as THREE.MeshStandardMaterial);
          }
        });
        parent.add(item);
        itemsRef.current.set(t.id, item);
        tierRef.current.set(t.id, -1);
      }

      const key = tierKey(t.upgrades);
      if (tierRef.current.get(t.id) !== key) {
        applyTints(item, kind, t.upgrades);
        tierRef.current.set(t.id, key);
      }

      item.position.set(t.pos.x - centerXZ.x, yOffset - scaledMinY, -t.pos.y - centerXZ.z);

      let yaw = 0;
      if (idleSpin) {
        yaw = world.time * 1.2;
      } else if (t.targetingMode === "spot" && t.targetSpot) {
        const dx = t.targetSpot.x - t.pos.x;
        const dy = t.targetSpot.y - t.pos.y;
        yaw = Math.atan2(dx, -dy);
      } else if (t.targetId !== null) {
        const target = world.enemyById.get(t.targetId);
        if (target?.alive && !target.leak) {
          const dx = target.pos.x - t.pos.x;
          const dy = target.pos.y - t.pos.y;
          yaw = Math.atan2(dx, -dy);
        }
      }
      item.rotation.set(0, baseRotY + yaw, 0);
    }

    for (const [id, item] of itemsRef.current) {
      if (!live.has(id)) {
        parent.remove(item);
        itemsRef.current.delete(id);
        tierRef.current.delete(id);
      }
    }
  });

  return <group ref={groupRef} />;
};

useGLTF.preload("/models/tower_pulse.glb");
useGLTF.preload("/models/turrets/Lighting Turret.glb");
useGLTF.preload("/models/turrets/Missile Turret.glb");
useGLTF.preload("/models/turrets/Emp Turret.glb");
useGLTF.preload("/models/turrets/Flamethrower Turret.glb");
useGLTF.preload("/models/turrets/Hive Turret.glb");
