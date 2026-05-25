import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { ROBOT_SPECS } from "../sim/robotVariants";
import { useGame } from "../store";

const RING_GOLD = new THREE.Color("#ffd66a");
const ORBIT_COUNT = 6;
const ORBIT_RADIUS = 1.15;

// Robot range ring + slot-2 (E) buff halo. The range ring mirrors the
// tower SelectionRing (same geometry/material) so a selected robot reads
// the same way a selected tower does. While the E self-buff is live the
// ring turns the variant tint, grows to the buffed reach, and a pulsing
// halo with orbiting glow points hugs the robot.
export const RobotSelectionVfx = () => {
  const ringRef = useRef<THREE.Mesh>(null);
  const ringMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const haloRef = useRef<THREE.Group>(null);
  const haloDiscMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const haloRingMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const orbitsRef = useRef<THREE.InstancedMesh>(null);
  const tint = useMemo(() => new THREE.Color(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const ring = ringRef.current;
    const halo = haloRef.current;
    const orbits = orbitsRef.current;
    if (!ring || !halo || !orbits) return;
    const { world } = useGame.getState();
    const robot = world.robot;
    const spec = ROBOT_SPECS[robot.variant];
    tint.set(spec.tint);

    const buff = robot.selfBuff;
    const eActive = robot.alive && buff !== null && world.time < buff.endAt;
    const rangeMul = eActive ? (spec.abilities[2].rangeMul ?? 1) : 1;

    // Range ring — on selection, and while E is active so the player can
    // see the Spotter Drone's boosted reach even without re-selecting.
    const showRing = robot.alive && (robot.selected || eActive);
    ring.visible = showRing;
    if (showRing) {
      ring.position.set(robot.pos.x, 0.04, -robot.pos.y);
      ring.scale.setScalar(robot.range * rangeMul * 2);
      const mat = ringMatRef.current;
      if (mat) {
        if (eActive) {
          mat.color.copy(tint);
          mat.opacity = 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 5));
        } else {
          mat.color.copy(RING_GOLD);
          mat.opacity = 0.7;
        }
      }
    }

    // E halo — pulsing disc + ring + orbiting glow points around the
    // robot, only while the slot-2 self-buff window is live.
    halo.visible = eActive;
    if (eActive) {
      const t = state.clock.elapsedTime;
      halo.position.set(robot.pos.x, 0, -robot.pos.y);
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      const discMat = haloDiscMatRef.current;
      if (discMat) {
        discMat.color.copy(tint);
        discMat.opacity = 0.1 + 0.1 * pulse;
      }
      const haloRingMat = haloRingMatRef.current;
      if (haloRingMat) {
        haloRingMat.color.copy(tint);
        haloRingMat.opacity = 0.35 + 0.35 * pulse;
      }
      for (let i = 0; i < ORBIT_COUNT; i++) {
        const a = t * 1.6 + (i / ORBIT_COUNT) * Math.PI * 2;
        const h = 0.7 + Math.sin(t * 3 + i) * 0.25;
        dummy.position.set(Math.cos(a) * ORBIT_RADIUS, h, Math.sin(a) * ORBIT_RADIUS);
        dummy.scale.setScalar(0.1 + 0.04 * Math.sin(t * 6 + i));
        dummy.updateMatrix();
        orbits.setMatrixAt(i, dummy.matrix);
      }
      orbits.count = ORBIT_COUNT;
      orbits.instanceMatrix.needsUpdate = true;
      (orbits.material as THREE.MeshBasicMaterial).color.copy(tint);
    }
  });

  return (
    <>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={10}>
        <ringGeometry args={[0.48, 0.5, 64]} />
        <meshBasicMaterial
          ref={ringMatRef}
          color="#ffd66a"
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <group ref={haloRef} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} renderOrder={9}>
          <circleGeometry args={[1.3, 48]} />
          <meshBasicMaterial
            ref={haloDiscMatRef}
            color="#9fd8ff"
            transparent
            opacity={0.12}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]} renderOrder={9}>
          <ringGeometry args={[1.2, 1.32, 64]} />
          <meshBasicMaterial
            ref={haloRingMatRef}
            color="#9fd8ff"
            transparent
            opacity={0.5}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <instancedMesh
          ref={orbitsRef}
          args={[undefined, undefined, ORBIT_COUNT]}
          frustumCulled={false}
          renderOrder={11}
        >
          <sphereGeometry args={[1, 8, 8]} />
          <meshBasicMaterial
            color="#9fd8ff"
            transparent
            opacity={0.9}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </instancedMesh>
      </group>
    </>
  );
};
