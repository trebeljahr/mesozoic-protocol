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
const ARC_SEGMENTS = 5;
const UP = new THREE.Vector3(0, 1, 0);

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
  const arcs = useRef<THREE.InstancedMesh>(null);
  const sparks = useRef<THREE.InstancedMesh>(null);
  const arcDummy = useMemo(() => new THREE.Object3D(), []);
  const points = useMemo(
    () => Array.from({ length: ARC_SEGMENTS + 1 }, () => new THREE.Vector3()),
    [],
  );
  const direction = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!source) return;
    const { world } = useGame.getState();
    const { time } = world;

    let count = 0;
    let arcCount = 0;
    let sparkCount = 0;
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

        const targetId = t.droneAssignments[d];
        const target = targetId == null ? undefined : world.towerById.get(targetId);
        if (!target || target.kind === "hive" || !arcs.current || !sparks.current) continue;

        // Stagger short power pulses; sim time keeps them still when paused.
        const phase = time * 1.25 + t.id * 0.37 + d * 0.41;
        const pulse = phase - Math.floor(phase);
        if (pulse > 0.48) continue;
        const strength = Math.sin((pulse / 0.48) * Math.PI);
        const flicker = Math.floor(time * 18);
        for (let p = 0; p <= ARC_SEGMENTS; p++) {
          const along = p / ARC_SEGMENTS;
          const jitter = Math.sin(along * Math.PI) * 0.12;
          points[p].set(
            THREE.MathUtils.lerp(pos.x, target.pos.x, along) +
              Math.sin(flicker * 2.3 + p * 7.1 + d + t.id) * jitter,
            THREE.MathUtils.lerp(HIVE_ORBIT_HEIGHT + bob, 0.65, along) +
              Math.cos(flicker * 1.7 + p * 5.3 + d) * jitter,
            THREE.MathUtils.lerp(-pos.y, -target.pos.y, along) +
              Math.sin(flicker * 3.1 + p * 4.7 + t.id) * jitter,
          );
        }
        for (let p = 0; p < ARC_SEGMENTS; p++) {
          direction.subVectors(points[p + 1], points[p]);
          const length = direction.length();
          arcDummy.position
            .copy(points[p])
            .add(points[p + 1])
            .multiplyScalar(0.5);
          arcDummy.quaternion.setFromUnitVectors(UP, direction.normalize());
          arcDummy.scale.set(0.009 * strength, length, 0.009 * strength);
          arcDummy.updateMatrix();
          arcs.current.setMatrixAt(arcCount++, arcDummy.matrix);
        }
        // A bright bead travels inward along the bolt, showing energy direction.
        const travel = (pulse / 0.48) * ARC_SEGMENTS;
        const segment = Math.min(ARC_SEGMENTS - 1, Math.floor(travel));
        arcDummy.position.lerpVectors(points[segment], points[segment + 1], travel - segment);
        arcDummy.scale.setScalar(0.035 * strength);
        arcDummy.updateMatrix();
        sparks.current.setMatrixAt(sparkCount++, arcDummy.matrix);
      }
    }
    if (arcs.current) {
      arcs.current.count = arcCount;
      arcs.current.instanceMatrix.needsUpdate = true;
    }
    if (sparks.current) {
      sparks.current.count = sparkCount;
      sparks.current.instanceMatrix.needsUpdate = true;
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
      <instancedMesh
        ref={arcs}
        args={[undefined, undefined, MAX_DRONES * ARC_SEGMENTS]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[1, 1, 1, 4]} />
        <meshBasicMaterial
          color="#67e8f9"
          toneMapped={false}
          transparent
          opacity={0.75}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>
      <instancedMesh ref={sparks} args={[undefined, undefined, MAX_DRONES]} frustumCulled={false}>
        <sphereGeometry args={[1, 6, 4]} />
        <meshBasicMaterial color="#dcffff" toneMapped={false} />
      </instancedMesh>
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
