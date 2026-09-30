import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGame } from "../store";
import { buildPlusGeometry, buildPlusMaterial } from "./RegenBadges.geometry";

const MAX_REGEN = 128;
// Mint-green 3D "+" floating above any enemy with the regen chip.
// Distinct from:
//   - shielded blue bubble (around the body)
//   - healAura green ring   (on the ground)
//
// Hides when regen is paused (just took damage) so the badge tracks the
// actual healing state — players see the icon go dark right after a
// hit and come back once regen resumes.

export const RegenBadges = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geom = useMemo(buildPlusGeometry, []);
  const mat = useMemo(buildPlusMaterial, []);
  useEffect(
    () => () => {
      geom.dispose();
      mat.dispose();
    },
    [geom, mat],
  );

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const { world } = useGame.getState();
    const time = world.time;

    let hi = 0;
    for (const e of world.enemies) {
      if (!e.alive || e.leak) continue;
      if (!e.regen) continue;
      if (hi >= MAX_REGEN) break;
      // Hide while regen is paused — the icon disappearing right after
      // a hit is itself the "you're getting damage through" feedback.
      if (time < e.regenPausedUntil) continue;
      // Hover height tracks silhouette via sqrt(maxHp). Lowered vs.
      // the old plane (1.7 + 0.045 * sqrt) so the badge sits just above
      // the head instead of drifting noticeably above the body.
      const height = 0.9 + Math.sqrt(e.maxHp) * 0.03;
      const bob = Math.sin(time * 2.6 + e.id) * 0.05;
      // Heartbeat scale pulse so the icon feels actively healing.
      const pulse = 0.7 + 0.1 * Math.sin(time * 4 + e.id);
      // Slow yaw spin so the 3D depth reads from any orbit angle —
      // a static plus from above showed only the thin extrude edge.
      const spin = time * 1.1 + e.id * 0.31;
      dummy.position.set(e.pos.x, height + bob, -e.pos.y);
      dummy.rotation.set(0, spin, 0);
      dummy.scale.set(pulse, pulse, pulse);
      dummy.updateMatrix();
      mesh.setMatrixAt(hi, dummy.matrix);
      hi++;
    }
    mesh.count = hi;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geom, mat, MAX_REGEN]}
      renderOrder={6}
      castShadow={false}
      receiveShadow={false}
    />
  );
};
