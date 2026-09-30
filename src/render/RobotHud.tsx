import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ROBOT_SPECS } from "../sim/robotVariants";
import { useGame } from "../store";

// In-world robot markers: pulsing range ring, move-target ping,
// translucent ground footprint, death explosion shockwave, and the
// pre-dash directional arrow (every robot variant has a dash). Cheap
// (a handful of meshes), updated by useFrame.
const ROBOT_DEATH_DURATION = 0.85;
const ROBOT_DEATH_EXPLOSION_DURATION = 0.7;
const ROBOT_DEATH_CORE_DURATION = 0.22;
const STORM_RING_Y = 0.18;
const PHASE_VEIL_SPARK_COUNT = 24;

// Arrow geometry lives in the local XZ plane with +Z as "forward"
// (the dash direction). The aim group's yaw rotation maps local +Z
// onto the world-space dash vector via yaw = atan2(dir.x, -dir.y).
const ARROW_BASE_W = 0.32;
const ARROW_TIP_W = 0.42;
// Three sliding chevrons ride the shaft to signal "armed and ready".
const CHEVRON_COUNT = 3;
const CHEVRON_IDS = Array.from({ length: CHEVRON_COUNT }, (_, i) => `chevron-${i}`);
const CHEVRON_GLYPH = (() => {
  const g = new THREE.BufferGeometry();
  // Forward-pointing chevron lying on the XZ plane. Tip at +Z, wings
  // open toward -Z, so the chevron points along the dash direction.
  const verts = new Float32Array([
    0, 0, 0.18, 0.28, 0, -0.06, 0.12, 0, -0.06, 0, 0, 0.18, -0.12, 0, -0.06, -0.28, 0, -0.06,
  ]);
  g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
})();

export const RobotHud = () => {
  const variant = useGame((s) => s.world.robot.variant);
  const tint = ROBOT_SPECS[variant].tint;
  const ringRef = useRef<THREE.Mesh>(null);
  const footRef = useRef<THREE.Mesh>(null);
  const moveRef = useRef<THREE.Mesh>(null);
  const phaseVeilSparksRef = useRef<THREE.InstancedMesh>(null);
  const sparkTransform = useMemo(() => new THREE.Object3D(), []);
  const stormFillRef = useRef<THREE.Mesh>(null);
  const stormRingRef = useRef<THREE.Mesh>(null);
  const stormPulseRef = useRef<THREE.Mesh>(null);

  const ringGeom = useMemo(() => new THREE.RingGeometry(0.95, 1.08, 48), []);
  const footGeom = useMemo(() => new THREE.CircleGeometry(0.85, 36), []);
  const moveGeom = useMemo(() => new THREE.RingGeometry(0.4, 0.55, 32), []);
  const selGeom = useMemo(() => new THREE.RingGeometry(1.1, 1.32, 48), []);
  const stormFillGeom = useMemo(() => new THREE.CircleGeometry(1, 64), []);
  const stormRingGeom = useMemo(() => new THREE.RingGeometry(0.96, 1, 96), []);
  const stormPulseGeom = useMemo(() => new THREE.RingGeometry(0.72, 0.78, 96), []);
  const selRef = useRef<THREE.Mesh>(null);
  // Dash-aim arrow assembled from a tapered shaft, a chunky arrowhead,
  // sliding chevrons, and a landing reticle at the endpoint. Everything
  // rides a parent group so we can rotate/position once per frame; the
  // shaft + arrowhead geometries are stretched to the variant's actual
  // dash distance (speed × duration) by mutating their position attrs.
  const aimGroupRef = useRef<THREE.Group>(null);
  const aimRingRef = useRef<THREE.Mesh>(null);
  const aimRingInnerRef = useRef<THREE.Mesh>(null);
  const chevronRefs = useRef<(THREE.Mesh | null)[]>([]);
  const aimShaftGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const verts = new Float32Array(4 * 3);
    g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    return g;
  }, []);
  const aimHeadGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const verts = new Float32Array(3 * 3);
    g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  const aimLandingRing = useMemo(() => new THREE.RingGeometry(0.62, 0.78, 36), []);
  const aimLandingDot = useMemo(() => new THREE.CircleGeometry(0.18, 24), []);
  useEffect(
    () => () => {
      ringGeom.dispose();
      footGeom.dispose();
      moveGeom.dispose();
      selGeom.dispose();
      stormFillGeom.dispose();
      stormRingGeom.dispose();
      stormPulseGeom.dispose();
      aimShaftGeom.dispose();
      aimHeadGeom.dispose();
      aimLandingRing.dispose();
      aimLandingDot.dispose();
    },
    [
      ringGeom,
      footGeom,
      moveGeom,
      selGeom,
      stormFillGeom,
      stormRingGeom,
      stormPulseGeom,
      aimShaftGeom,
      aimHeadGeom,
      aimLandingRing,
      aimLandingDot,
    ],
  );

  // Death shockwave + flash — mirrors the HQ explosion sequence so a
  // robot wipe feels equally violent.
  const deathFlashRef = useRef<THREE.Mesh>(null);
  const deathCoreRef = useRef<THREE.Mesh>(null);
  const deathShockRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const { world } = useGame.getState();
    const robot = world.robot;
    if (!ringRef.current || !footRef.current || !moveRef.current || !selRef.current) return;
    const visible = robot.alive;
    ringRef.current.visible = visible;
    footRef.current.visible = visible;
    if (visible) {
      const pulse = 1 + Math.sin(world.time * 3.6) * 0.04;
      ringRef.current.position.set(robot.pos.x, 0.05, -robot.pos.y);
      ringRef.current.scale.setScalar(pulse);
      footRef.current.position.set(robot.pos.x, 0.045, -robot.pos.y);
    }
    if (robot.moveTarget) {
      moveRef.current.visible = true;
      moveRef.current.position.set(robot.moveTarget.x, 0.06, -robot.moveTarget.y);
      const spin = world.time * 2.6;
      moveRef.current.rotation.set(-Math.PI / 2, 0, spin);
    } else {
      moveRef.current.visible = false;
    }
    if (robot.selected && robot.alive) {
      selRef.current.visible = true;
      selRef.current.position.set(robot.pos.x, 0.06, -robot.pos.y);
      const pulse = 1 + Math.sin(world.time * 5.2) * 0.07;
      selRef.current.scale.setScalar(pulse);
    } else {
      selRef.current.visible = false;
    }
    const storm = robot.payload?.kind === "storm" ? robot.payload : null;
    const stormActive = robot.alive && !!storm && world.time < storm.endAt;
    const stormFill = stormFillRef.current;
    const stormRing = stormRingRef.current;
    const stormPulse = stormPulseRef.current;
    if (stormFill && stormRing && stormPulse) {
      stormFill.visible = stormActive;
      stormRing.visible = stormActive;
      stormPulse.visible = stormActive;
      if (stormActive) {
        const radius = storm.radius;
        const fade = Math.min(1, Math.max(0, (storm.endAt - world.time) / 0.35));
        const pulse = 1 + Math.sin(world.time * 8) * 0.025;
        stormFill.position.set(robot.pos.x, STORM_RING_Y, -robot.pos.y);
        stormFill.rotation.set(-Math.PI / 2, 0, 0);
        stormFill.scale.setScalar(radius);
        (stormFill.material as THREE.MeshBasicMaterial).opacity = 0.1 * fade;
        stormRing.position.set(robot.pos.x, STORM_RING_Y + 0.01, -robot.pos.y);
        stormRing.rotation.set(-Math.PI / 2, 0, world.time * 0.55);
        stormRing.scale.setScalar(radius * pulse);
        (stormRing.material as THREE.MeshBasicMaterial).opacity = 0.8 * fade;
        stormPulse.position.set(robot.pos.x, STORM_RING_Y + 0.012, -robot.pos.y);
        stormPulse.rotation.set(-Math.PI / 2, 0, -world.time * 0.75);
        stormPulse.scale.setScalar(radius * (0.9 + Math.sin(world.time * 5.4) * 0.07));
        (stormPulse.material as THREE.MeshBasicMaterial).opacity = 0.48 * fade;
      }
    }
    // Phase Veil (E) sends charged streaks off Leela, even when deselected.
    // Simulation time keeps the emission frozen while the game is paused.
    const buff = robot.selfBuff;
    const phaseVeilActive =
      robot.alive && robot.variant === "leela" && !!buff && world.time < buff.endAt;
    const sparks = phaseVeilSparksRef.current;
    if (sparks) {
      sparks.visible = phaseVeilActive;
      if (phaseVeilActive) {
        sparks.position.set(robot.pos.x, 0, -robot.pos.y);
        const fade = Math.min(1, (buff.endAt - world.time) / 0.35);
        for (let i = 0; i < PHASE_VEIL_SPARK_COUNT; i++) {
          const phase = (world.time * (0.85 + (i % 4) * 0.12) + i / PHASE_VEIL_SPARK_COUNT) % 1;
          const angle = i * 2.39996;
          const radius = 0.35 + (i % 5) * 0.12 + phase * 0.15;
          const jitter = Math.sin(Math.floor(world.time * 18) + i * 7) * 0.09;
          sparkTransform.position.set(
            Math.cos(angle) * radius + jitter,
            0.8 + phase * 2.6,
            Math.sin(angle) * radius - jitter,
          );
          const envelope = Math.min(1, phase * 8, (1 - phase) * 4) * fade;
          sparkTransform.scale.set(
            0.035 * envelope,
            (0.12 + (i % 3) * 0.045) * envelope,
            0.035 * envelope,
          );
          sparkTransform.rotation.set(jitter * 3, angle, jitter * 4);
          sparkTransform.updateMatrix();
          sparks.setMatrixAt(i, sparkTransform.matrix);
        }
        sparks.instanceMatrix.needsUpdate = true;
      }
    }
    // Dash aim arrow (armed dash, any variant). Shaft + arrowhead +
    // landing reticle stretch to the variant's actual dash distance so
    // the player previews where the lunge will land. Three chevrons
    // slide forward along the shaft at world.time to sell "armed and
    // ready to fire" without animating the body of the arrow itself.
    const aim = aimGroupRef.current;
    if (aim) {
      if (robot.alive && robot.dashAim) {
        aim.visible = true;
        const dir = robot.dashAim.dir;
        const yaw = Math.atan2(dir.x, -dir.y);
        aim.position.set(robot.pos.x, 0.08, -robot.pos.y);
        aim.rotation.set(0, yaw, 0);
        const pulse = 0.97 + Math.sin(world.time * 7) * 0.03;
        aim.scale.setScalar(pulse);

        const dashSpec = ROBOT_SPECS[robot.variant].abilities[0];
        const dashLen = dashSpec.speed * dashSpec.duration;
        const headLen = Math.min(0.9, dashLen * 0.32);
        const shaftStart = 0.55;
        const shaftEnd = dashLen - headLen;
        const tipZ = dashLen;

        const shaftPos = aimShaftGeom.getAttribute("position") as THREE.BufferAttribute;
        const baseHalf = ARROW_BASE_W * 0.5;
        const tipHalf = ARROW_TIP_W * 0.5;
        shaftPos.setXYZ(0, -baseHalf, 0, shaftStart);
        shaftPos.setXYZ(1, baseHalf, 0, shaftStart);
        shaftPos.setXYZ(2, tipHalf, 0, shaftEnd);
        shaftPos.setXYZ(3, -tipHalf, 0, shaftEnd);
        shaftPos.needsUpdate = true;

        const headPos = aimHeadGeom.getAttribute("position") as THREE.BufferAttribute;
        const headHalf = 0.62;
        headPos.setXYZ(0, 0, 0, tipZ);
        headPos.setXYZ(1, headHalf, 0, shaftEnd - 0.05);
        headPos.setXYZ(2, -headHalf, 0, shaftEnd - 0.05);
        headPos.needsUpdate = true;

        const usableShaftLen = Math.max(0.01, shaftEnd - shaftStart);
        for (let i = 0; i < CHEVRON_COUNT; i++) {
          const cm = chevronRefs.current[i];
          if (!cm) continue;
          if (usableShaftLen < 0.6) {
            cm.visible = false;
            continue;
          }
          cm.visible = true;
          const phase = (world.time * 0.9 + i / CHEVRON_COUNT) % 1;
          const z = shaftStart + phase * usableShaftLen;
          cm.position.set(0, 0, z);
          const fade = Math.min(phase * 3, (1 - phase) * 3, 1);
          (cm.material as THREE.MeshBasicMaterial).opacity = 0.65 * Math.max(0, fade);
        }

        const ring = aimRingRef.current;
        if (ring) {
          ring.position.set(0, 0.01, tipZ);
          const ringPulse = 1 + Math.sin(world.time * 6) * 0.08;
          ring.scale.setScalar(ringPulse);
        }
        const ringDot = aimRingInnerRef.current;
        if (ringDot) ringDot.position.set(0, 0.01, tipZ);
      } else {
        aim.visible = false;
      }
    }
    // Death shockwave/core/flash — visible for ROBOT_DEATH_DURATION
    // after lastDeathAt, identical pattern to the HQ death cinematic.
    const flash = deathFlashRef.current;
    const core = deathCoreRef.current;
    const shock = deathShockRef.current;
    if (flash && core && shock) {
      const elapsed = world.time - robot.lastDeathAt;
      const explosionAlive = elapsed >= 0 && elapsed < ROBOT_DEATH_EXPLOSION_DURATION;
      const coreAlive = elapsed >= 0 && elapsed < ROBOT_DEATH_CORE_DURATION;
      const shockAlive = elapsed >= 0 && elapsed < ROBOT_DEATH_DURATION;
      flash.visible = explosionAlive;
      core.visible = coreAlive;
      shock.visible = shockAlive;
      if (explosionAlive) {
        const t = elapsed / ROBOT_DEATH_EXPLOSION_DURATION;
        flash.position.set(robot.pos.x, 0.6, -robot.pos.y);
        flash.scale.setScalar(0.5 + t * 3.5);
        (flash.material as THREE.MeshBasicMaterial).opacity = (1 - t) ** 1.4 * 0.85;
      }
      if (coreAlive) {
        const t = elapsed / ROBOT_DEATH_CORE_DURATION;
        core.position.set(robot.pos.x, 0.6, -robot.pos.y);
        core.scale.setScalar(0.35 + t * 2.0);
        (core.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.9;
      }
      if (shockAlive) {
        const t = elapsed / ROBOT_DEATH_DURATION;
        shock.position.set(robot.pos.x, 0.05, -robot.pos.y);
        shock.scale.setScalar(0.4 + t * 5.0);
        (shock.material as THREE.MeshBasicMaterial).opacity = (1 - t) ** 1.2 * 0.65;
      }
    }
  });

  return (
    <group>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} geometry={ringGeom} renderOrder={1}>
        <meshBasicMaterial
          color={tint}
          transparent
          opacity={0.55}
          side={THREE.DoubleSide}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
      <mesh ref={footRef} rotation={[-Math.PI / 2, 0, 0]} geometry={footGeom} renderOrder={1}>
        <meshBasicMaterial
          color={tint}
          transparent
          opacity={0.12}
          side={THREE.DoubleSide}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
      <mesh ref={moveRef} geometry={moveGeom} renderOrder={2}>
        <meshBasicMaterial
          color={tint}
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
      <mesh ref={selRef} rotation={[-Math.PI / 2, 0, 0]} geometry={selGeom} renderOrder={2}>
        <meshBasicMaterial
          color="#ffd66a"
          transparent
          opacity={0.9}
          side={THREE.DoubleSide}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
      <instancedMesh
        ref={phaseVeilSparksRef}
        args={[undefined, undefined, PHASE_VEIL_SPARK_COUNT]}
        visible={false}
        frustumCulled={false}
      >
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial
          color="#9beaff"
          transparent
          opacity={0.95}
          toneMapped={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>
      <mesh ref={stormFillRef} geometry={stormFillGeom} visible={false} renderOrder={3}>
        <meshBasicMaterial
          color="#5ad6ff"
          transparent
          opacity={0}
          toneMapped={false}
          depthWrite={false}
          depthTest={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={stormRingRef} geometry={stormRingGeom} visible={false} renderOrder={4}>
        <meshBasicMaterial
          color="#9beaff"
          transparent
          opacity={0}
          toneMapped={false}
          depthWrite={false}
          depthTest={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={stormPulseRef} geometry={stormPulseGeom} visible={false} renderOrder={4}>
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0}
          toneMapped={false}
          depthWrite={false}
          depthTest={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Dash aim arrow — tapered shaft + bold arrowhead + sliding
          chevrons + landing reticle, anchored at robot pos. Hidden
          unless robot.dashAim is set. Shaft/head vertices rewritten
          per-frame to match the variant's actual dash distance. */}
      <group ref={aimGroupRef} visible={false} renderOrder={4}>
        <mesh geometry={aimShaftGeom}>
          <meshBasicMaterial
            color={tint}
            transparent
            opacity={0.85}
            toneMapped={false}
            depthWrite={false}
            depthTest={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh geometry={aimHeadGeom}>
          <meshBasicMaterial
            color={tint}
            transparent
            opacity={1}
            toneMapped={false}
            depthWrite={false}
            depthTest={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        {CHEVRON_IDS.map((id, i) => (
          <mesh
            key={id}
            ref={(m) => {
              chevronRefs.current[i] = m;
            }}
            geometry={CHEVRON_GLYPH}
          >
            <meshBasicMaterial
              color="#ffffff"
              transparent
              opacity={0.65}
              toneMapped={false}
              depthWrite={false}
              depthTest={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
        <mesh ref={aimRingRef} rotation={[-Math.PI / 2, 0, 0]} geometry={aimLandingRing}>
          <meshBasicMaterial
            color={tint}
            transparent
            opacity={0.85}
            toneMapped={false}
            depthWrite={false}
            depthTest={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh ref={aimRingInnerRef} rotation={[-Math.PI / 2, 0, 0]} geometry={aimLandingDot}>
          <meshBasicMaterial
            color={tint}
            transparent
            opacity={0.55}
            toneMapped={false}
            depthWrite={false}
            depthTest={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
      {/* Robot death explosion: outer fireball + white-hot core + ground
          shockwave. Refs hidden by default; useFrame flips them on
          while world.time falls inside the death-cinematic window. */}
      <mesh ref={deathFlashRef} visible={false} renderOrder={3}>
        <sphereGeometry args={[1, 18, 14]} />
        <meshBasicMaterial
          color="#ff9b3a"
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={deathCoreRef} visible={false} renderOrder={3}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial
          color="#fff4d6"
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={deathShockRef} visible={false} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
        <ringGeometry args={[0.45, 0.6, 48]} />
        <meshBasicMaterial
          color="#ffd07a"
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
};
