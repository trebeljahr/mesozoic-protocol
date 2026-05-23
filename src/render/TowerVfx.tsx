import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Tower } from "../sim/types";
import { clamp01 } from "../sim/vec2";
import { useGame } from "../store";
import { chainOrbBase } from "./towerTints";

// Overlay VFX for towers. Drives "charge up" visuals off `cooldown` progress:
//   charge = 1 - cooldown / (1/fireRate)   -> 0 just fired, 1 ready to fire.
// Chain gets an electrified orb with crossed arcs. Pulse used to get coil
// rings along the barrel but they never lined up convincingly with the
// model's barrel direction across target angles, so the pulse shader was
// dropped in favor of just the model itself.

const MAX_PER_KIND = 64;

// Crossed arcs hold a fixed pale cool-blue tint — upgrades drift only the
// orb (Path A) and the body mesh (Path B), never the arcs. Live `intensity`
// still flickers these with charge.
const CHAIN_ARC_A_TINT: [number, number, number] = [0.7, 0.85, 1.0];
const CHAIN_ARC_B_TINT: [number, number, number] = [0.66, 0.92, 1.0];

const chargeProgress = (tower: Tower): number => {
  if (tower.fireRate <= 0) return 0;
  const interval = 1 / tower.fireRate;
  if (interval <= 0) return 1;
  return clamp01(1 - tower.cooldown / interval);
};

export const TowerVfx = () => {
  const chainOrbRef = useRef<THREE.InstancedMesh>(null);
  const chainArcARef = useRef<THREE.InstancedMesh>(null);
  const chainArcBRef = useRef<THREE.InstancedMesh>(null);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  // Small additive-blend overlays — segment counts above 8/12 just burn
  // verts the silhouette can't show.
  const orbGeom = useMemo(() => new THREE.SphereGeometry(0.22, 12, 8), []);
  const arcGeom = useMemo(() => new THREE.TorusGeometry(0.38, 0.028, 6, 16), []);

  useFrame(() => {
    const { world } = useGame.getState();
    const time = world.time;

    let chainCount = 0;

    for (const t of world.towers) {
      if (t.kind !== "chain") continue;
      const charge = chargeProgress(t);
      // Flicker: small jitter so it reads as "electrified", ramps with charge.
      const flicker = 0.55 + 0.45 * Math.sin(time * 22 + t.id * 3.1);
      const baseGlow = 0.25; // ambient, visible when idle
      const intensity = baseGlow + (1 - baseGlow) * charge * flicker;
      const orbY = 1.35;

      // Path A (Arc Reach) drifts the orb toward a cool steel blue; the
      // arcs hold a fixed tint. Path B is reflected on the body mesh in
      // ModelTowerMesh.
      const orbBase = chainOrbBase(t.upgrades.a);

      // Core orb
      dummy.position.set(t.pos.x, orbY, -t.pos.y);
      dummy.rotation.set(0, time * 1.2 + t.id, 0);
      dummy.scale.setScalar(0.75 + charge * 0.35);
      dummy.updateMatrix();
      chainOrbRef.current!.setMatrixAt(chainCount, dummy.matrix);
      color.setRGB(orbBase[0] * intensity, orbBase[1] * intensity, orbBase[2] * intensity);
      chainOrbRef.current!.setColorAt(chainCount, color);

      // Crossed electrified arcs
      const arcScale = 0.85 + charge * 0.55;
      dummy.position.set(t.pos.x, orbY, -t.pos.y);
      dummy.rotation.set(Math.PI / 2, time * 3.1 + t.id * 0.7, 0);
      dummy.scale.setScalar(arcScale);
      dummy.updateMatrix();
      chainArcARef.current!.setMatrixAt(chainCount, dummy.matrix);
      color.setRGB(
        CHAIN_ARC_A_TINT[0] * intensity,
        CHAIN_ARC_A_TINT[1] * intensity,
        CHAIN_ARC_A_TINT[2] * intensity,
      );
      chainArcARef.current!.setColorAt(chainCount, color);

      dummy.rotation.set(time * 2.4 + t.id * 1.3, 0, time * -1.8 + t.id * 0.4);
      dummy.scale.setScalar(arcScale);
      dummy.updateMatrix();
      chainArcBRef.current!.setMatrixAt(chainCount, dummy.matrix);
      color.setRGB(
        CHAIN_ARC_B_TINT[0] * intensity,
        CHAIN_ARC_B_TINT[1] * intensity,
        CHAIN_ARC_B_TINT[2] * intensity,
      );
      chainArcBRef.current!.setColorAt(chainCount, color);

      chainCount++;
    }

    for (const r of [chainOrbRef, chainArcARef, chainArcBRef]) {
      const m = r.current;
      if (!m) continue;
      m.count = chainCount;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group>
      <instancedMesh ref={chainOrbRef} args={[orbGeom, undefined, MAX_PER_KIND]} renderOrder={1}>
        <meshBasicMaterial
          color="#9fd8ff"
          transparent
          opacity={0.6}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh ref={chainArcARef} args={[arcGeom, undefined, MAX_PER_KIND]} renderOrder={1}>
        <meshBasicMaterial
          color="#9fd8ff"
          transparent
          opacity={0.55}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh ref={chainArcBRef} args={[arcGeom, undefined, MAX_PER_KIND]} renderOrder={1}>
        <meshBasicMaterial
          color="#bdf0ff"
          transparent
          opacity={0.55}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
};
