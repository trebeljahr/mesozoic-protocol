import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { World } from "../sim/types";
import { clamp01 } from "../sim/vec2";
import { useGame } from "../store";
import { clearEnemyEyeProfile, getEnemyEyeProfile } from "./enemyEyeProfiles";
import { getEnemyRender } from "./enemyRenderRegistry";
import { BLOOM_LAYER } from "./PaintedPostFx";

// One instanced quad per visible eye across every enemy on the map.
// Two eyes per dinosaur × ~256 simultaneous enemies headroom = 512 slots;
// the death-fade tail recycles slots within the same budget. If a wave
// ever exceeds this we cap silently — the oldest fades expire first.
const MAX_EYES = 512;

// Frost tint target — pale ice blue. Eyes lerp toward this as e.frost climbs,
// so a fully frozen enemy still has visible (but cold) eye glow instead of
// a clashing warm color against the frost body tint.
const FROST_TINT = new THREE.Color("#cfe6ff");

// Death fade duration (seconds). Matches the body's death-clip feel: short
// enough that the corpse stops attracting attention, long enough to read
// as "the light goes out" instead of a snap.
const DEATH_FADE = 0.7;

// Quad scale multiplier on top of the per-anchor radius. The radial
// gradient texture's bright core fills ~30% of the quad, so we oversize the
// quad to allow a visible soft halo around the eye.
const BILLBOARD_SCALE = 1.25;

// Build the shared radial-gradient texture once on mount. Tight bright
// core + long soft falloff so additive blending reads as a glow, not a hard
// disc. Per-instance color multiplies into this — final RGB = profile color
// × intensity × texture.
const buildEyeTexture = (): THREE.CanvasTexture | null => {
  if (typeof document === "undefined") return null;
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const cx = size / 2;
  const cy = size / 2;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
  grad.addColorStop(0.0, "rgba(255,255,255,1.0)");
  grad.addColorStop(0.18, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.4)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.12)");
  grad.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
};

type FadeState = {
  fadeStart: number | null;
  lastTransform: { x: number; y: number; z: number; yaw: number } | null;
};

export const EnemyEyes = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);
  const baseColor = useMemo(() => new THREE.Color(), []);
  const eyeWorld = useMemo(() => new THREE.Vector3(), []);
  const texture = useMemo(() => buildEyeTexture(), []);
  // Per-enemy fade-out state. Live enemies reset fadeStart each frame; once
  // an enemy disappears from world.enemies (sim-side swap-and-pop on death),
  // fadeStart anchors the linear ramp to 0 over DEATH_FADE seconds and we
  // keep emitting eyes at the last-known transform until alpha hits 0.
  const fadeRef = useRef<Map<number, FadeState>>(new Map());
  const worldRef = useRef<World | null>(null);

  useEffect(
    () => () => {
      texture?.dispose();
    },
    [texture],
  );

  // Default InstancedMesh bounding sphere is unit-radius at origin — once
  // every eye is positioned away from origin and origin pans off-screen the
  // whole mesh culls. Same trick Effects.tsx uses for its particle pool.
  useEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    const big = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e4);
    m.boundingSphere = big.clone();
    m.geometry.boundingSphere = big.clone();
  }, []);

  useFrame((state) => {
    const m = meshRef.current;
    if (!m) return;
    const { world } = useGame.getState();
    const now = world.time;
    const camQuat = state.camera.quaternion;
    const fades = fadeRef.current;
    if (worldRef.current !== null && worldRef.current !== world) {
      fades.clear();
      m.count = 0;
    }
    worldRef.current = world;

    let i = 0;
    const seen = new Set<number>();
    for (const e of world.enemies) {
      if (!e.alive) continue;
      const profile = getEnemyEyeProfile(e.id);
      if (!profile || profile.positions.length === 0) continue;
      const transform = getEnemyRender(e.id);
      if (!transform) continue;

      seen.add(e.id);
      let fade = fades.get(e.id);
      if (!fade) {
        fade = { fadeStart: null, lastTransform: null };
        fades.set(e.id, fade);
      }
      fade.fadeStart = null;
      if (!fade.lastTransform) {
        fade.lastTransform = {
          x: transform.x,
          y: transform.y,
          z: transform.z,
          yaw: transform.yaw,
        };
      } else {
        fade.lastTransform.x = transform.x;
        fade.lastTransform.y = transform.y;
        fade.lastTransform.z = transform.z;
        fade.lastTransform.yaw = transform.yaw;
      }

      const cosY = Math.cos(transform.yaw);
      const sinY = Math.sin(transform.yaw);

      // Intensity envelope. Pulse is gentle and per-enemy offset; aggression
      // (engaged with robot or mid-leak) bumps the base and adds high-
      // frequency flicker; hit-flash spikes briefly; frost dims. Damage flash
      // reuses the existing e.flashUntil window so eye + body flash sync.
      const aggression =
        (e.engagedWithRobot ?? false) || e.engagedRobotId !== null || e.leak !== undefined;
      const base = aggression ? 1.5 : 1.0;
      const pulse = Math.sin(now * 2 + profile.pulseSeed) * 0.2;
      const flicker = aggression ? Math.sin(now * 18 + profile.pulseSeed * 3.1) * 0.18 : 0;
      const flashing = now < e.flashUntil;
      const flashBoost = flashing ? 2.0 : 0;
      const frost = e.frost;
      const frostMul = 1 - frost * 0.5;
      const intensity = Math.max(0, (base + pulse + flicker + flashBoost) * frostMul);

      baseColor.setRGB(profile.baseColor[0], profile.baseColor[1], profile.baseColor[2]);
      if (frost > 0.05) baseColor.lerp(FROST_TINT, Math.min(0.85, frost * 0.7));
      tmpColor.copy(baseColor).multiplyScalar(intensity);

      for (const pos of profile.positions) {
        if (i >= MAX_EYES) break;
        let wx: number;
        let wy: number;
        let wz: number;
        if (pos.bone && pos.localPosition) {
          eyeWorld.copy(pos.localPosition);
          pos.bone.localToWorld(eyeWorld);
          wx = eyeWorld.x;
          wy = eyeWorld.y;
          wz = eyeWorld.z;
        } else {
          wx = transform.x + cosY * pos.x + sinY * pos.z;
          wz = transform.z - sinY * pos.x + cosY * pos.z;
          wy = transform.y + pos.y;
        }
        dummy.position.set(wx, wy, wz);
        dummy.quaternion.copy(camQuat);
        dummy.scale.setScalar(pos.radius * BILLBOARD_SCALE);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        m.setColorAt(i, tmpColor);
        i++;
      }
    }

    // Death-fade tail — enemies that vanished from world.enemies this frame
    // get DEATH_FADE seconds of ramp-down at their last-known transform so
    // the eyes go out instead of snapping off the moment the body starts
    // falling. Loss/retry freezes world.time, so clear tails whenever the
    // sim is not running; otherwise stale eyes can stay bright forever.
    if (world.status !== "running") {
      for (const [id] of fades) clearEnemyEyeProfile(id);
      fades.clear();
    } else {
      for (const [id, fade] of fades) {
        if (seen.has(id)) continue;
        if (!fade.lastTransform) {
          fades.delete(id);
          continue;
        }
        if (fade.fadeStart === null) fade.fadeStart = now;
        const t = clamp01((now - fade.fadeStart) / DEATH_FADE);
        const alpha = 1 - t;
        if (alpha <= 0) {
          fades.delete(id);
          clearEnemyEyeProfile(id);
          continue;
        }
        const profile = getEnemyEyeProfile(id);
        if (!profile) {
          fades.delete(id);
          continue;
        }
        const cosY = Math.cos(fade.lastTransform.yaw);
        const sinY = Math.sin(fade.lastTransform.yaw);
        tmpColor.setRGB(
          profile.baseColor[0] * alpha,
          profile.baseColor[1] * alpha,
          profile.baseColor[2] * alpha,
        );
        for (const pos of profile.positions) {
          if (i >= MAX_EYES) break;
          const wx = fade.lastTransform.x + cosY * pos.x + sinY * pos.z;
          const wz = fade.lastTransform.z - sinY * pos.x + cosY * pos.z;
          const wy = fade.lastTransform.y + pos.y;
          dummy.position.set(wx, wy, wz);
          dummy.quaternion.copy(camQuat);
          dummy.scale.setScalar(pos.radius * BILLBOARD_SCALE);
          dummy.updateMatrix();
          m.setMatrixAt(i, dummy.matrix);
          m.setColorAt(i, tmpColor);
          i++;
        }
      }
    }

    m.count = i;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, MAX_EYES]}
      // Eyes draw after the enemy body so they pop over the head silhouette
      // even when the skull mesh's depth would otherwise occlude them.
      // Additive blend + depthWrite=false keeps the layering soft.
      renderOrder={6}
      frustumCulled={false}
      onUpdate={(self) => {
        // Selective-bloom opt-in. PaintedPostFx's bloom pass selects by
        // three.js layer membership, so the eye instances need to live on
        // BLOOM_LAYER. `userData.bloom = true` mirrors the convention the
        // material pipeline uses for emissive sub-meshes so any future
        // walker (e.g. an alternate post-FX pass) can find them too.
        self.layers.enable(BLOOM_LAYER);
        self.userData.bloom = true;
        if (Array.isArray(self.material)) {
          for (const mm of self.material) mm.userData.bloom = true;
        } else {
          self.material.userData.bloom = true;
        }
      }}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        map={texture ?? undefined}
        toneMapped={false}
        transparent
        opacity={1}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
};
