import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Projectile } from "../sim/types";
import { useGame } from "../store";
import { GRAPHICS_QUALITY } from "./effectsTunables";
import { BLOOM_LAYER } from "./PaintedPostFx";
import { pulseMuzzles } from "./pulseMuzzles";

// Pulse Rifle tracer rendering. ProjectileMesh now skips direct projectiles
// whose owning tower is the Pulse Rifle, leaving us in charge of the bolt
// visual. For each tracked projectile we keep a short position history
// (last ~80ms) and stream it into a shared LineSegments pool as a tapering
// cyan-white ribbon, plus a one-shot muzzle flash on first sight and an
// expanding impact ring once the projectile disappears from world.projectiles.
//
// Every emissive surface opts into the selective-bloom pass via
// `obj.layers.enable(BLOOM_LAYER)` so the post-FX pipeline pulls the
// tracers through its bloom layer.

const MAX_BOLTS = 96;
const TRAIL_POINTS = 8;
const TRAIL_LIFE = 0.08;
const MAX_PAIRS = MAX_BOLTS * (TRAIL_POINTS - 1);
const MAX_VERTS = MAX_PAIRS * 2;

const MAX_FLASHES = 96;
const MUZZLE_LIFE = 0.08;
const IMPACT_LIFE = 0.12;
const IMPACT_MAX_RADIUS = 0.32;

const CORE_TINT = new THREE.Color("#eaf8ff");
const HALO_TINT = new THREE.Color("#9bdcff");
const MUZZLE_TINT = new THREE.Color("#d6f4ff");

type TrailSample = { x: number; y: number; z: number; t: number };
type TrailState = {
  power: number;
  samples: TrailSample[];
  lastSeenAt: number;
  lastPos: THREE.Vector3;
};

type FlashEntry = {
  kind: "muzzle" | "impact";
  pos: THREE.Vector3;
  spawnAt: number;
  power: number;
};

const makeLineGeom = () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 3), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 3), 3));
  g.setDrawRange(0, 0);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e4);
  return g;
};

export const PulseTracerFx = () => {
  const coreRef = useRef<THREE.LineSegments>(null);
  const haloRef = useRef<THREE.LineSegments>(null);
  const muzzleRef = useRef<THREE.InstancedMesh>(null);
  const boltRef = useRef<THREE.InstancedMesh>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);

  const coreGeom = useMemo(makeLineGeom, []);
  const haloGeom = useMemo(makeLineGeom, []);
  const billboardGeom = useMemo(() => new THREE.PlaneGeometry(0.55, 0.55), []);
  const flashTexture = useMemo(() => {
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const r = Math.hypot((x + 0.5 - size / 2) / (size / 2), (y + 0.5 - size / 2) / (size / 2));
        const i = (y * size + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 255;
        data[i + 3] = Math.round(255 * Math.max(0, 1 - r) ** 3);
      }
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }, []);
  useEffect(() => () => flashTexture.dispose(), [flashTexture]);
  const ringGeom = useMemo(() => new THREE.RingGeometry(0.65, 1.0, 24), []);

  useEffect(
    () => () => {
      coreGeom.dispose();
      haloGeom.dispose();
      billboardGeom.dispose();
      ringGeom.dispose();
    },
    [coreGeom, haloGeom, billboardGeom, ringGeom],
  );

  const trails = useMemo(() => new Map<number, TrailState>(), []);
  const flashes = useMemo<FlashEntry[]>(() => [], []);
  const seen = useMemo(() => new Set<number>(), []);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    const big = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e4);
    for (const ref of [muzzleRef, boltRef, ringRef]) {
      const m = ref.current;
      if (!m) continue;
      m.boundingSphere = big.clone();
      m.geometry.boundingSphere = big.clone();
    }
  }, []);

  useEffect(() => {
    for (const ref of [coreRef, haloRef, muzzleRef, boltRef, ringRef]) {
      const obj = ref.current;
      if (obj) obj.layers.enable(BLOOM_LAYER);
    }
  }, []);

  useFrame((state) => {
    const { world } = useGame.getState();
    const core = coreRef.current;
    const halo = haloRef.current;
    const muzzle = muzzleRef.current;
    const ring = ringRef.current;
    const bolt = boltRef.current;
    if (!core || !halo || !muzzle || !ring || !bolt) return;
    const now = world.time;
    const drawImpactRing = GRAPHICS_QUALITY !== "low";

    // 1) Walk projectiles, classify pulse-owned, update trails.
    seen.clear();
    for (const p of world.projectiles as Projectile[]) {
      if (p.kind !== "direct") continue;
      if (p.ownerTowerId === null) continue;
      const owner = world.towerById.get(p.ownerTowerId);
      if (!owner || owner.kind !== "pulse") continue;
      seen.add(p.id);

      const px = p.pos.x;
      const py = trails.get(p.id)?.lastPos.y ?? pulseMuzzles.get(owner)?.y ?? 0.85;
      const pz = -p.pos.y;
      let trail = trails.get(p.id);
      if (!trail) {
        trail = {
          power: Math.min(3, owner.upgrades.a) + Math.min(3, owner.upgrades.b),
          samples: [],
          lastSeenAt: now,
          lastPos: new THREE.Vector3(px, py, pz),
        };
        trails.set(p.id, trail);
        // Use the rendered model's transformed barrel tip, including its aim.
        const muzzlePos = pulseMuzzles.get(owner);
        if (muzzlePos && flashes.length < MAX_FLASHES) {
          flashes.push({
            kind: "muzzle",
            pos: muzzlePos.clone(),
            power: trail.power,
            spawnAt: now,
          });
        }
      }
      trail.samples.push({ x: px, y: py, z: pz, t: now });
      trail.lastSeenAt = now;
      trail.lastPos.set(px, py, pz);
      // Drop samples older than TRAIL_LIFE.
      while (trail.samples.length > 0 && now - trail.samples[0].t > TRAIL_LIFE) {
        trail.samples.shift();
      }
      // Cap sample count so a stationary impact doesn't grow forever.
      if (trail.samples.length > TRAIL_POINTS) {
        trail.samples.splice(0, trail.samples.length - TRAIL_POINTS);
      }
    }

    // 2) Detect impacts (projectile id no longer present) and queue flashes.
    for (const [id, trail] of trails) {
      if (!seen.has(id)) {
        if (flashes.length < MAX_FLASHES) {
          flashes.push({
            kind: "impact",
            pos: trail.lastPos.clone(),
            power: trail.power,
            spawnAt: now,
          });
        }
        trails.delete(id);
      }
    }

    // 3) Emit trail line segments — taper alpha from head (newest sample)
    //    back to tail so the bolt reads as forward-moving.
    const corePos = core.geometry.attributes.position.array as Float32Array;
    const coreCol = core.geometry.attributes.color.array as Float32Array;
    const haloPos = halo.geometry.attributes.position.array as Float32Array;
    const haloCol = halo.geometry.attributes.color.array as Float32Array;
    let pairIdx = 0;
    for (const trail of trails.values()) {
      const ss = trail.samples;
      if (ss.length < 2) continue;
      const head = ss.length - 1;
      for (let i = 0; i < ss.length - 1; i++) {
        if (pairIdx >= MAX_PAIRS) break;
        const a = ss[i];
        const b = ss[i + 1];
        // alpha: 1 at the head, fades back toward the tail.
        const tt = (i + 1) / head;
        const energy = 1 + trail.power * 0.45;
        const alphaB = tt * energy;
        const alphaA = (i / head) * energy;
        const cR = CORE_TINT.r * alphaB;
        const cG = CORE_TINT.g * alphaB;
        const cB = CORE_TINT.b * alphaB;
        const cRA = CORE_TINT.r * alphaA;
        const cGA = CORE_TINT.g * alphaA;
        const cBA = CORE_TINT.b * alphaA;
        const pi = pairIdx * 6;
        corePos[pi + 0] = a.x;
        corePos[pi + 1] = a.y;
        corePos[pi + 2] = a.z;
        corePos[pi + 3] = b.x;
        corePos[pi + 4] = b.y;
        corePos[pi + 5] = b.z;
        coreCol[pi + 0] = cRA;
        coreCol[pi + 1] = cGA;
        coreCol[pi + 2] = cBA;
        coreCol[pi + 3] = cR;
        coreCol[pi + 4] = cG;
        coreCol[pi + 5] = cB;
        // Halo — same path, slightly lifted, dim.
        haloPos[pi + 0] = a.x;
        haloPos[pi + 1] = a.y + 0.04;
        haloPos[pi + 2] = a.z;
        haloPos[pi + 3] = b.x;
        haloPos[pi + 4] = b.y + 0.04;
        haloPos[pi + 5] = b.z;
        haloCol[pi + 0] = HALO_TINT.r * alphaA * 0.7;
        haloCol[pi + 1] = HALO_TINT.g * alphaA * 0.7;
        haloCol[pi + 2] = HALO_TINT.b * alphaA * 0.7;
        haloCol[pi + 3] = HALO_TINT.r * alphaB * 0.7;
        haloCol[pi + 4] = HALO_TINT.g * alphaB * 0.7;
        haloCol[pi + 5] = HALO_TINT.b * alphaB * 0.7;
        pairIdx++;
      }
    }
    core.geometry.setDrawRange(0, pairIdx * 2);
    halo.geometry.setDrawRange(0, pairIdx * 2);
    core.geometry.attributes.position.needsUpdate = true;
    core.geometry.attributes.color.needsUpdate = true;
    halo.geometry.attributes.position.needsUpdate = true;
    halo.geometry.attributes.color.needsUpdate = true;
    core.visible = pairIdx > 0;
    halo.visible = pairIdx > 0;

    // Soft bolt heads grow with either upgrade path, even with bloom disabled.
    let boltCount = 0;
    for (const trail of trails.values()) {
      if (boltCount >= MAX_BOLTS) break;
      dummy.position.copy(trail.lastPos);
      dummy.quaternion.copy(state.camera.quaternion);
      dummy.scale.setScalar(0.24 + trail.power * 0.055);
      dummy.updateMatrix();
      bolt.setMatrixAt(boltCount, dummy.matrix);
      tmpColor.copy(HALO_TINT).multiplyScalar(1.4 + trail.power * 0.6);
      bolt.setColorAt(boltCount++, tmpColor);
    }
    bolt.count = boltCount;
    bolt.instanceMatrix.needsUpdate = true;
    if (bolt.instanceColor) bolt.instanceColor.needsUpdate = true;

    // 4) Flash entries: muzzle = quick additive billboard, impact = expanding ring.
    let muzzleCount = 0;
    let ringCount = 0;
    let writeIdx = 0;
    for (let i = 0; i < flashes.length; i++) {
      const f = flashes[i];
      const age = now - f.spawnAt;
      const life = f.kind === "muzzle" ? MUZZLE_LIFE : IMPACT_LIFE;
      if (age >= life) continue;
      flashes[writeIdx++] = f;
      const norm = age / life;
      const lifeRem = 1 - norm;

      if (f.kind === "muzzle") {
        if (muzzleCount >= MAX_FLASHES) continue;
        dummy.position.copy(f.pos);
        dummy.quaternion.copy(state.camera.quaternion);
        dummy.scale.setScalar((0.35 + lifeRem * 0.4) * (1 + f.power * 0.08));
        dummy.updateMatrix();
        muzzle.setMatrixAt(muzzleCount, dummy.matrix);
        const bri = lifeRem * (2 + f.power * 0.45);
        tmpColor.setRGB(MUZZLE_TINT.r * bri, MUZZLE_TINT.g * bri, MUZZLE_TINT.b * bri);
        muzzle.setColorAt(muzzleCount, tmpColor);
        muzzleCount++;
      } else {
        if (!drawImpactRing) continue;
        if (ringCount >= MAX_FLASHES) continue;
        dummy.position.set(f.pos.x, 0.06, f.pos.z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        const r = norm * IMPACT_MAX_RADIUS + 0.05;
        dummy.scale.set(r, r, 1);
        dummy.updateMatrix();
        ring.setMatrixAt(ringCount, dummy.matrix);
        const bri = lifeRem * 1.1;
        tmpColor.setRGB(HALO_TINT.r * bri, HALO_TINT.g * bri, HALO_TINT.b * bri);
        ring.setColorAt(ringCount, tmpColor);
        ringCount++;
      }
    }
    flashes.length = writeIdx;
    muzzle.count = muzzleCount;
    ring.count = ringCount;
    muzzle.instanceMatrix.needsUpdate = true;
    ring.instanceMatrix.needsUpdate = true;
    if (muzzle.instanceColor) muzzle.instanceColor.needsUpdate = true;
    if (ring.instanceColor) ring.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <lineSegments ref={haloRef} args={[haloGeom]} renderOrder={2} frustumCulled={false}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
      <lineSegments ref={coreRef} args={[coreGeom]} renderOrder={3} frustumCulled={false}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
      <instancedMesh
        ref={boltRef}
        args={[billboardGeom, undefined, MAX_BOLTS]}
        renderOrder={3}
        frustumCulled={false}
      >
        <meshBasicMaterial
          map={flashTexture}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh
        ref={muzzleRef}
        args={[billboardGeom, undefined, MAX_FLASHES]}
        renderOrder={3}
        frustumCulled={false}
      >
        <meshBasicMaterial
          color="#ffffff"
          map={flashTexture}
          transparent
          opacity={1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh
        ref={ringRef}
        args={[ringGeom, undefined, MAX_FLASHES]}
        renderOrder={2}
        frustumCulled={false}
      >
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={1}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
};
