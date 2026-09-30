import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { HIVE_ORBIT_HEIGHT, hiveDroneAngle, hiveDronePosition } from "../sim/towers";
import { useGame } from "../store";

// One instanced mesh renders every drone of every hive tower on the
// field. Each drone bobs a little and orbits either its hive (when
// idle) or the tower it's been assigned to service. Sim-side logic in
// towers.ts owns the assignment table — this is purely visuals.
//
// The drone mesh is KayKit Space Base Bits structure_tall (textured); we
// walk the GLB and stand up a separate InstancedMesh per primitive, same
// pattern as Rocks/Trees/BiomeCosmetics. This model is reserved for drones
// — the outpost templates intentionally don't reuse structure-tall.

const DRONE_URL = "/models/turrets/HiveDrone.glb";
const TARGET_SIZE = 0.23;
const BOB_AMP = 0.08;
const BOB_SPEED = 2.2;
const MAX_DRONES = 256;

type Part = { id: string; geom: THREE.BufferGeometry; material: THREE.Material };
type Source = { parts: Part[]; minY: number; baseScale: number };

const collectSource = (scene: THREE.Object3D): Source | null => {
  scene.updateMatrixWorld(true);
  const parts: Part[] = [];
  const union = new THREE.Box3();
  let set = false;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const geom = m.geometry.clone();
      geom.applyMatrix4(m.matrixWorld);
      geom.computeBoundingBox();
      if (geom.boundingBox) {
        if (!set) {
          union.copy(geom.boundingBox);
          set = true;
        } else union.union(geom.boundingBox);
      }
      parts.push({ id: nanoid(), geom, material: mat as THREE.Material });
    }
  });
  if (parts.length === 0 || !set) return null;
  const size = union.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  return { parts, minY: union.min.y, baseScale: TARGET_SIZE / maxDim };
};

export const HiveDrones = () => {
  const { scene } = useGLTF(DRONE_URL);
  const source = useMemo(() => collectSource(scene), [scene]);
  useEffect(
    () => () => {
      for (const part of source?.parts ?? []) part.geom.dispose();
    },
    [source],
  );
  const partRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    if (!source) return;
    const { world } = useGame.getState();
    const { time } = world;

    let count = 0;
    for (const t of world.towers) {
      if (t.kind !== "hive") continue;
      if (count + t.droneCount > MAX_DRONES) break;

      for (let d = 0; d < t.droneCount; d++) {
        const pos = hiveDronePosition(t, world, time, d);
        // Tangent yaw — drones face the direction they're flying around
        // their orbit center, so the visual reads as "circling."
        const yaw = hiveDroneAngle(t, time, d) + Math.PI / 2;

        const bob = Math.sin(time * BOB_SPEED + t.id + d * 1.3) * BOB_AMP;
        dummy.position.set(pos.x, HIVE_ORBIT_HEIGHT + bob, -pos.y);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.setScalar(source.baseScale);
        dummy.updateMatrix();

        for (const im of partRefs.current) {
          if (!im) continue;
          im.setMatrixAt(count, dummy.matrix);
        }
        count++;
      }
    }

    for (const im of partRefs.current) {
      if (!im) continue;
      im.count = count;
      im.instanceMatrix.needsUpdate = true;
    }
  });

  if (!source) return null;

  return (
    <group>
      {source.parts.map((part, pi) => (
        <instancedMesh
          key={part.id}
          ref={(el: THREE.InstancedMesh | null) => {
            partRefs.current[pi] = el;
          }}
          args={[part.geom, part.material, MAX_DRONES]}
          castShadow
        />
      ))}
    </group>
  );
};

useGLTF.preload(DRONE_URL);
