import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, Physics, RigidBody } from "@react-three/rapier";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { dampFactor, shortAngleDelta } from "../sim/angle";
import { clamp01 } from "../sim/vec2";
import { useGame } from "../store";
import {
  bakeObjectToGeometry,
  type FractureChunk,
  fractureGeometry,
  fractureGeometryAsync,
} from "./fractureMesh";
import { measureVisibleBox } from "./measureModel";

// The Plasma Turret is the robot model from the title-screen diorama. It
// doesn't appear as a buildable in gameplay; instead one instance per path
// endpoint stands in for the player's HQ — that's where enemy leaks land,
// and that's what the player is defending. When `world.lives` decreases the
// HQ flashes red; when lives hit zero the model unmounts and a pre-fractured
// voronoi set of chunks is dropped into a Rapier physics world that fires
// them outward and lets them tumble to rest. The previous "tilt + sink"
// faceplant looked weak — this reads as a real demolition.
//
// The sim loop stops ticking on loss (see CameraRig.tsx and spawner.ts), so
// `world.time` and the existing explosion/particle systems freeze the instant
// the game ends. The death sequence is therefore driven entirely from
// performance.now() inside useFrame — same pattern as the loss-rumble in
// CameraRig.

const HQ_URL = "/models/turrets/Plasma Turret.glb";
const HQ_TARGET_SIZE = 1.9;

// Render-side timings. Death duration must stay just under the pre-results
// screen delay in store.ts so the explosion completes before the overlay
// covers the world.
const FLASH_DURATION = 0.45;
const EXPLOSION_DURATION = 0.7;
const SHOCKWAVE_DURATION = 0.85;
// How long the laser stays visible after each HQ shot. Short enough to
// read as a snap-fire pulse rather than a sustained beam, long enough
// to register at 60fps.
const LASER_VISIBLE_DURATION = 0.11;
// Half-life (seconds) for the smooth-rotation lerp that pivots the
// turret to face its current target. Below 0.05 the rotation snaps and
// reads as a teleport; above 0.15 the turret lags so far the beam
// fires perpendicular to the target.
const TURRET_YAW_HALFLIFE = 0.08;
// Where each cannon muzzle sits in the turret's local frame after
// scaling to HQ_TARGET_SIZE. Sampled directly from the Plasma Turret
// mesh: the two forward-most vertex clusters land at (±0.65, 0.89, +1.07)
// in node-local coords (post the GLB's -90°X bind rotation). The model's
// forward axis is +Z, so localZ is positive here — the yaw rotation
// turns +Z into the direction of the live target.
const BARREL_FORWARD = 1.07;
const BARREL_HEIGHT = 0.89;
const BARREL_SIDE = 0.65;
const LASER_RADIUS = 0.055;
// Number of voronoi cells the turret shatters into. Kept modest because
// fracture is N×N CSG (each cell intersects N-1 halfspaces and then the
// source mesh) and is deferred to an idle callback so it must finish
// within ~1s on mid-tier hardware. 10 cells reads as a real demolition
// without flooding Rapier with bodies or starving the WebGL watchdog.
const FRACTURE_CHUNKS = 10;

type Pose = {
  position: [number, number];
  yaw: number;
  pathIndex: number;
};

// Pre-rotate a vector by the HQ yaw so chunk launch directions defined in
// the model's local frame land in world space.
const rotateXZ = (x: number, y: number, z: number, yaw: number): [number, number, number] => {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x * c + z * s, y, -x * s + z * c];
};

// Inner ref-driven HQ. Wraps the cloned model in an outer group so we can
// mutate transform every frame without round-tripping through React state.
const HQOne = ({ pose }: { pose: Pose }) => {
  const { scene } = useGLTF(HQ_URL);
  const outerRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.Mesh>(null);
  const coreFlashRef = useRef<THREE.Mesh>(null);
  const shockwaveRef = useRef<THREE.Mesh>(null);
  const leftLaserRef = useRef<THREE.Mesh>(null);
  const rightLaserRef = useRef<THREE.Mesh>(null);
  const muzzleLeftRef = useRef<THREE.Mesh>(null);
  const muzzleRightRef = useRef<THREE.Mesh>(null);
  const status = useGame((s) => s.world.status);
  // Per-HQ death: only the endpoint that took the killing blow runs the
  // explosion + fracture. Other HQs see status === "lost" but should
  // stay intact so the player reads which lane actually fell.
  const killingPathIndex = useGame((s) => s.world.killingPathIndex);
  const isLost = status === "lost";
  const isKillingHQ = killingPathIndex === pose.pathIndex;
  const shouldExplode = isLost && isKillingHQ;
  // Set once the chunk rigid bodies are actually committed (i.e. the rapier
  // WASM Suspense below has resolved). The intact turret stays mounted until
  // then so there's never a frame where the turret is gone but the chunks
  // haven't appeared yet — that gap is what flashed the bare scene
  // background, since the <Physics> suspend has no boundary above PlayScene
  // and blanks the whole canvas while the WASM loads.
  const [chunksLive, setChunksLive] = useState(false);
  const handleChunksReady = useCallback(() => setChunksLive(true), []);
  // Smooth-rotated yaw of the turret. Drives outer.rotation so the
  // cannons pivot toward the live target before firing, then drift
  // back to the path-aligned rest pose when nothing is in range.
  const turretYawRef = useRef(pose.yaw);
  // Edge-detect last cooldown to spot the moment a shot fires (cooldown
  // resets from ~0 up to 1/fireRate). When detected, stash the world-
  // time and target id so the laser visual stays attached to the actual
  // enemy that was hit, not whichever target the base picks next.
  const lastCooldownRef = useRef(0);
  const firedAtRef = useRef(-1);
  const firedTargetIdRef = useRef<number | null>(null);

  // Bind-pose-accurate baseline: same `measureVisibleBox` we use for every
  // other model so the HQ's feet sit on y=0 instead of floating where the
  // raw geometry bbox extends.
  const { scaledClone, baseY, chunkMaterial } = useMemo(() => {
    const s =
      HQ_TARGET_SIZE /
      Math.max(...measureVisibleBox(scene).getSize(new THREE.Vector3()).toArray(), 0.001);
    const c = scene.clone(true);
    c.scale.setScalar(s);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      // Per-instance materials so the damage-flash emissive on one HQ
      // doesn't leak across the others. Side-effect on the cached scene
      // would otherwise tint every HQ that shares the model.
      if (Array.isArray(m.material)) {
        m.material = m.material.map((mm) => mm.clone());
      } else if (m.material) {
        m.material = (m.material as THREE.Material).clone();
      }
    });
    const groundedBox = measureVisibleBox(c);
    const baseYLocal = -groundedBox.min.y;

    // Pick a representative material from the source meshes; falls back to
    // a neutral metallic if the GLB has nothing readable.
    let mat: THREE.Material | null = null;
    c.traverse((o) => {
      if (mat) return;
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material && !Array.isArray(m.material)) {
        const cloned = (m.material as THREE.Material).clone();
        if (cloned instanceof THREE.MeshStandardMaterial) {
          cloned.transparent = true;
        }
        mat = cloned;
      }
    });
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: "#8a92a0",
        metalness: 0.6,
        roughness: 0.5,
        transparent: true,
      });
    }

    return {
      scaledClone: c,
      baseY: baseYLocal,
      chunkMaterial: mat as THREE.Material,
    };
  }, [scene]);

  // Voronoi fracture is N×N CSG and stalls the main thread long enough to
  // trip the WebGL watchdog if run during the same task as mount. Defer it
  // to an idle callback so the first paint of the scene happens uncontested,
  // then the fracture runs in the background and is ready by the time the
  // base ever dies.
  const [fracture, setFracture] = useState<{
    chunks: FractureChunk[];
    center: THREE.Vector3;
  } | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    // 1.2s delay so the first paint + GLTF load + biome init have all
    // settled. The fracture work itself is chunked by `fractureGeometryAsync`
    // (yields between every CSG op + serialised across HQs via a module
    // queue) so it can no longer monopolise the main thread long enough to
    // trip the WebGL context-loss watchdog.
    const handle = setTimeout(async () => {
      if (ctrl.signal.aborted) return;
      const baked = bakeObjectToGeometry(scaledClone);
      const bakedBox = new THREE.Box3().setFromBufferAttribute(
        baked.getAttribute("position") as THREE.BufferAttribute,
      );
      const center = bakedBox.getCenter(new THREE.Vector3());
      const chunkList = await fractureGeometryAsync(
        baked,
        FRACTURE_CHUNKS,
        pose.pathIndex + 7,
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      setFracture({ chunks: chunkList, center });
    }, 1200);
    return () => {
      ctrl.abort();
      clearTimeout(handle);
    };
  }, [scaledClone, pose.pathIndex]);

  // Safety net: if the base dies before the idle fracture finishes, run
  // it synchronously so the chunks still appear (at the cost of a brief
  // stall on that frame). Better than the HQ silently failing to break.
  // Gated to the killing HQ so non-killing HQs don't pay the stall.
  useEffect(() => {
    if (!shouldExplode || fracture) return;
    const baked = bakeObjectToGeometry(scaledClone);
    const chunkList = fractureGeometry(baked, FRACTURE_CHUNKS, pose.pathIndex + 7);
    const bakedBox = new THREE.Box3().setFromBufferAttribute(
      baked.getAttribute("position") as THREE.BufferAttribute,
    );
    const center = bakedBox.getCenter(new THREE.Vector3());
    setFracture({ chunks: chunkList, center });
  }, [shouldExplode, fracture, scaledClone, pose.pathIndex]);

  // HQOne persists across runs (retry / next level), so clear the
  // chunks-live latch when the explosion is no longer active — otherwise a
  // subsequent death would unmount the intact turret immediately on the
  // stale latch and reopen the background-flash gap.
  useEffect(() => {
    if (!shouldExplode) setChunksLive(false);
  }, [shouldExplode]);

  // Live event tracking — we read these inside useFrame rather than via
  // selectors so the component never re-mounts between waves.
  const flashUntilRef = useRef(0);
  const lostStartRef = useRef<number | null>(null);

  // Per-HQ flash: subscribe to life-lost events and trigger only when the
  // leak came down THIS HQ's path. Watching `world.lives` directly would
  // flash every HQ on the map since lives is a single global counter.
  useEffect(() => {
    const unsub = useGame.getState().onEvent((ev) => {
      if (ev.type !== "life-lost") return;
      if (ev.pathIndex !== pose.pathIndex) return;
      if (useGame.getState().world.status === "lost") return;
      flashUntilRef.current = performance.now() / 1000 + FLASH_DURATION;
    });
    return unsub;
  }, [pose.pathIndex]);

  useFrame((_, delta) => {
    const outer = outerRef.current;
    const flash = flashRef.current;
    if (!outer) return;

    const now = performance.now() / 1000;

    if (shouldExplode) {
      if (lostStartRef.current === null) lostStartRef.current = now;
    } else {
      lostStartRef.current = null;
    }

    const lostAt = lostStartRef.current;

    outer.position.set(pose.position[0], baseY, -pose.position[1]);

    // Turret yaw — chase the live target each frame so the cannons
    // visibly pivot toward incoming enemies before firing. Falls back
    // to the path-aligned pose when nothing is in range.
    const { world } = useGame.getState();
    const base = world.base;
    const targetId = base.targetIds[pose.pathIndex] ?? null;
    const targetEnemy = targetId !== null ? world.enemyById.get(targetId) : undefined;
    let desiredYaw = pose.yaw;
    if (targetEnemy && targetEnemy.alive) {
      const dx = targetEnemy.pos.x - pose.position[0];
      const dy = targetEnemy.pos.y - pose.position[1];
      if (dx * dx + dy * dy > 1e-6) desiredYaw = Math.atan2(dx, -dy);
    }
    if (isLost) {
      // Freeze rotation once the run is lost — the explosion takes over
      // and chunks shouldn't inherit a chasing pivot.
      outer.rotation.set(0, turretYawRef.current, 0);
    } else {
      const k = dampFactor(Math.max(delta, 0.0001), TURRET_YAW_HALFLIFE);
      turretYawRef.current += shortAngleDelta(turretYawRef.current, desiredYaw) * k;
      outer.rotation.set(0, turretYawRef.current, 0);
    }

    // Fire-edge detection: base.cooldowns[i] is decremented every sim
    // tick; the instant it resets from ~0 up to its full period, a
    // laser shot fired. Capture the moment + target so the visual
    // doesn't drift between repeat shots at different enemies.
    const cooldown = base.cooldowns[pose.pathIndex] ?? 0;
    if (!isLost && cooldown > lastCooldownRef.current + 0.01) {
      firedAtRef.current = now;
      firedTargetIdRef.current = targetId;
    }
    lastCooldownRef.current = cooldown;

    // Layered death explosion: an inner white-hot core, an outer fireball,
    // and a flat ground shockwave ring radiating from the HQ base. Each
    // peaks at a slightly different time so the eye registers a real bang
    // rather than a single dim glow.
    const explosionAlive = lostAt !== null && now - lostAt < EXPLOSION_DURATION;
    const shockwaveAlive = lostAt !== null && now - lostAt < SHOCKWAVE_DURATION;

    if (flash) {
      flash.visible = explosionAlive;
      if (explosionAlive) {
        const t = (now - (lostAt as number)) / EXPLOSION_DURATION;
        flash.scale.setScalar(0.6 + t * 4.6);
        const mat = flash.material as THREE.MeshBasicMaterial;
        mat.opacity = (1 - t) ** 1.4 * 0.9;
      }
    }
    if (coreFlashRef.current) {
      const core = coreFlashRef.current;
      const coreLife = 0.22;
      const coreAlive = lostAt !== null && now - lostAt < coreLife;
      core.visible = coreAlive;
      if (coreAlive) {
        const t = (now - (lostAt as number)) / coreLife;
        core.scale.setScalar(0.4 + t * 2.6);
        const mat = core.material as THREE.MeshBasicMaterial;
        mat.opacity = (1 - t) * 1.0;
      }
    }
    if (shockwaveRef.current) {
      const sw = shockwaveRef.current;
      sw.visible = shockwaveAlive;
      if (shockwaveAlive) {
        const t = (now - (lostAt as number)) / SHOCKWAVE_DURATION;
        sw.scale.setScalar(0.4 + t * 6.5);
        const mat = sw.material as THREE.MeshBasicMaterial;
        mat.opacity = (1 - t) ** 1.2 * 0.7;
      }
    }

    // Laser visuals — render two parallel red beams from the cannon
    // barrels to the enemy that was hit. Beam stays attached to the
    // captured target id so a follow-up shot at a different enemy
    // doesn't make the visible laser jitter to the new target mid-flash.
    const placeLaser = (mesh: THREE.Mesh | null, sideSign: 1 | -1) => {
      if (!mesh) return;
      const elapsed = now - firedAtRef.current;
      const laserTargetId = firedTargetIdRef.current;
      const laserTarget = laserTargetId !== null ? world.enemyById.get(laserTargetId) : undefined;
      if (
        isLost ||
        firedAtRef.current < 0 ||
        elapsed > LASER_VISIBLE_DURATION ||
        !laserTarget ||
        !laserTarget.alive
      ) {
        mesh.visible = false;
        return;
      }
      // Barrel origin = HQ position + (forward × sin yaw, side × cos yaw)
      // worked in world space.
      const c = Math.cos(turretYawRef.current);
      const s = Math.sin(turretYawRef.current);
      const localX = sideSign * BARREL_SIDE;
      const localZ = BARREL_FORWARD; // model's cannons extend along +Z
      const wx = pose.position[0] + localX * c + localZ * s;
      const wz = -pose.position[1] + -localX * s + localZ * c;
      const wy = baseY + BARREL_HEIGHT;
      const tx = laserTarget.pos.x;
      const ty = baseY + 0.55; // approximate enemy hit height
      const tz = -laserTarget.pos.y;
      const dx = tx - wx;
      const dy = ty - wy;
      const dz = tz - wz;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-3) {
        mesh.visible = false;
        return;
      }
      // Position cylinder midpoint and align it to the dx/dy/dz vector.
      // The default cylinder geometry points along +Y with height 1; we
      // scale Y to the beam length and rotate via lookAt.
      mesh.visible = true;
      mesh.position.set(wx + dx * 0.5, wy + dy * 0.5, wz + dz * 0.5);
      const up = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3(dx, dy, dz).normalize();
      mesh.quaternion.setFromUnitVectors(up, dir);
      mesh.scale.set(1, len, 1);
      const fade = 1 - elapsed / LASER_VISIBLE_DURATION;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, fade);
    };
    const placeMuzzle = (mesh: THREE.Mesh | null, sideSign: 1 | -1) => {
      if (!mesh) return;
      const elapsed = now - firedAtRef.current;
      const visible = !isLost && firedAtRef.current >= 0 && elapsed < LASER_VISIBLE_DURATION * 1.6;
      mesh.visible = visible;
      if (!visible) return;
      const c = Math.cos(turretYawRef.current);
      const s = Math.sin(turretYawRef.current);
      const localX = sideSign * BARREL_SIDE;
      const localZ = BARREL_FORWARD;
      const wx = pose.position[0] + localX * c + localZ * s;
      const wz = -pose.position[1] + -localX * s + localZ * c;
      const wy = baseY + BARREL_HEIGHT;
      mesh.position.set(wx, wy, wz);
      const fade = 1 - elapsed / (LASER_VISIBLE_DURATION * 1.6);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, fade) * 0.95;
      mesh.scale.setScalar(0.18 + (1 - fade) * 0.12);
    };
    placeLaser(leftLaserRef.current, -1);
    placeLaser(rightLaserRef.current, 1);
    placeMuzzle(muzzleLeftRef.current, -1);
    placeMuzzle(muzzleRightRef.current, 1);

    // Damage emissive flash on all materials. Skipped during death (on
    // the killing HQ only) so the chunks don't inherit a red emissive
    // that fights the explosion glow. Non-killing HQs keep flashing
    // normally even after status === "lost" — though no further leaks
    // will arrive once the run ends, so flashUntilRef stays cold.
    if (!shouldExplode) {
      const flashAge = flashUntilRef.current - now;
      const flashLevel = clamp01(flashAge / FLASH_DURATION);
      const emissiveR = flashLevel * 1.1;
      const emissiveG = flashLevel * 0.25;
      const emissiveB = flashLevel * 0.15;
      scaledClone.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
        const apply = (mm: THREE.MeshStandardMaterial) => {
          if (!mm.emissive) return;
          mm.emissive.setRGB(emissiveR, emissiveG, emissiveB);
        };
        if (Array.isArray(mat)) mat.forEach(apply);
        else if (mat) apply(mat);
      });
    }
  });

  return (
    <>
      <group ref={outerRef}>
        {(!shouldExplode || !fracture || !chunksLive) && <primitive object={scaledClone} />}
        {/* Death explosion: warm outer fireball + white-hot inner core.
            Hidden during regular play; ref-driven scaling/opacity during the
            loss cinematic. Both depth-write off so they layer cleanly over
            the chunks behind them. */}
        <mesh ref={flashRef} visible={false} position={[0, HQ_TARGET_SIZE * 0.45, 0]}>
          <sphereGeometry args={[1, 18, 14]} />
          <meshBasicMaterial
            color="#ff9b3a"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh ref={coreFlashRef} visible={false} position={[0, HQ_TARGET_SIZE * 0.45, 0]}>
          <sphereGeometry args={[1, 16, 12]} />
          <meshBasicMaterial
            color="#fff4d6"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        {/* Flat ground shockwave — a wide ring on the floor that races
            outward. Anchored to y=0.05 in world space so it stays on the
            ground while the chunks fly. */}
        <mesh
          ref={shockwaveRef}
          visible={false}
          position={[0, 0.05, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.45, 0.6, 48]} />
          <meshBasicMaterial
            color="#ffd07a"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
      {shouldExplode && fracture && fracture.chunks.length > 0 && (
        // Boundary so the rapier WASM suspend (thrown on the first <Physics>
        // mount, which happens here at death) only blanks this subtree —
        // never the whole canvas. Fallback is null; the intact turret is
        // held visible by `chunksLive` until these bodies commit.
        <Suspense fallback={null}>
          <ChunkPhysics
            chunks={fracture.chunks}
            chunkMaterial={chunkMaterial}
            sourceCenter={fracture.center}
            pose={pose}
            baseY={baseY}
            onReady={handleChunksReady}
          />
        </Suspense>
      )}
      {/* Laser beams + muzzle flares live in world space, not inside
          the rotating outer group, so the per-frame placeLaser() math
          can position them directly in world coordinates without
          fighting the turret yaw transform. */}
      <mesh ref={leftLaserRef} visible={false} renderOrder={3}>
        <cylinderGeometry args={[LASER_RADIUS, LASER_RADIUS, 1, 8, 1]} />
        <meshBasicMaterial
          color="#ff3a2a"
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={rightLaserRef} visible={false} renderOrder={3}>
        <cylinderGeometry args={[LASER_RADIUS, LASER_RADIUS, 1, 8, 1]} />
        <meshBasicMaterial
          color="#ff3a2a"
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={muzzleLeftRef} visible={false} renderOrder={3}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshBasicMaterial
          color="#ffd07a"
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={muzzleRightRef} visible={false} renderOrder={3}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshBasicMaterial
          color="#ffd07a"
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </>
  );
};

// Separated so the Physics provider mounts only after `world.status === "lost"`
// — every Rapier provider spawns its own world (and the WASM init on first
// mount). Keeping it inside the lost-branch guarantees zero physics cost
// during normal play.
const ChunkPhysics = ({
  chunks,
  chunkMaterial,
  sourceCenter,
  pose,
  baseY,
  onReady,
}: {
  chunks: FractureChunk[];
  chunkMaterial: THREE.Material;
  sourceCenter: THREE.Vector3;
  pose: Pose;
  baseY: number;
  onReady: () => void;
}) => {
  // Mounts only after the rapier WASM Suspense has resolved, so this effect
  // is the signal that the chunk bodies are live — HQOne uses it to drop the
  // intact turret without leaving a one-frame background-flash gap.
  useEffect(() => {
    onReady();
  }, [onReady]);
  // Compute per-chunk launch in world space once at mount. Direction is
  // (chunk origin − model centroid) projected through the HQ yaw so each
  // piece flies outward from where it lived in the intact model.
  const launches = useMemo(() => {
    return chunks.map((c, i) => {
      const offX = c.origin.x - sourceCenter.x;
      const offY = c.origin.y - sourceCenter.y;
      const offZ = c.origin.z - sourceCenter.z;
      const len = Math.hypot(offX, offY, offZ) || 1;
      const dirLocal: [number, number, number] = [offX / len, offY / len, offZ / len];
      const [dxw, dyw, dzw] = rotateXZ(dirLocal[0], dirLocal[1], dirLocal[2], pose.yaw);
      // Burst speed: deterministic-but-varied per chunk so the explosion
      // has spread without every piece launching at the same velocity.
      const speed = 5.5 + ((i * 17) % 11) * 0.5;
      const upBoost = 3.2 + ((i * 31) % 13) * 0.18;
      const [px, , pz] = rotateXZ(c.origin.x, 0, c.origin.z, pose.yaw);
      return {
        position: [pose.position[0] + px, baseY + c.origin.y, -pose.position[1] + pz] as [
          number,
          number,
          number,
        ],
        rotation: [0, pose.yaw, 0] as [number, number, number],
        linearVelocity: [dxw * speed, dyw * speed + upBoost, dzw * speed] as [
          number,
          number,
          number,
        ],
        angularVelocity: [
          (((i * 47) % 17) / 17 - 0.5) * 12,
          (((i * 31) % 19) / 19 - 0.5) * 12,
          (((i * 53) % 23) / 23 - 0.5) * 12,
        ] as [number, number, number],
        geometry: c.geometry,
        radius: c.radius,
      };
    });
  }, [chunks, sourceCenter, pose, baseY]);

  return (
    <Physics gravity={[0, -14, 0]} timeStep={1 / 60} colliders={false}>
      {/* Invisible ground so chunks rest instead of falling forever. The
          chunk rigid bodies fall asleep on contact thanks to canSleep. */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[80, 0.1, 80]} position={[0, -0.11, 0]} />
      </RigidBody>
      {launches.map((l, i) => (
        <RigidBody
          // biome-ignore lint/suspicious/noArrayIndexKey: stable per shatter
          key={i}
          colliders="hull"
          position={l.position}
          rotation={l.rotation}
          linearVelocity={l.linearVelocity}
          angularVelocity={l.angularVelocity}
          linearDamping={0.08}
          angularDamping={0.2}
          canSleep
          ccd={false}
        >
          <mesh geometry={l.geometry} material={chunkMaterial} />
        </RigidBody>
      ))}
    </Physics>
  );
};

// One HQ per path endpoint — multi-path levels get multiple HQs (mirrors
// the existing end-ring marker semantics). Faces back along the path so
// the cannons point at incoming enemies.
export const HQTurrets = () => {
  const paths = useGame((s) => s.world.paths);
  const poses = useMemo<Pose[]>(() => {
    const out: Pose[] = [];
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      if (path.length < 2) continue;
      const last = path[path.length - 1];
      const prev = path[path.length - 2];
      // Enemies travel toward `last`; the HQ should face the opposite way
      // so its cannons aim at the approaching column. Three.js convention:
      // yaw=0 faces -z, and sim y maps to -z (see ModelEnemyMesh.tsx:253).
      const incomingX = prev.x - last.x;
      const incomingY = prev.y - last.y;
      const yaw = Math.atan2(incomingX, -incomingY);
      out.push({ position: [last.x, last.y], yaw, pathIndex: i });
    }
    return out;
  }, [paths]);

  if (poses.length === 0) return null;
  return (
    <>
      {poses.map((pose) => (
        <HQOne key={pose.pathIndex} pose={pose} />
      ))}
    </>
  );
};

useGLTF.preload(HQ_URL);
