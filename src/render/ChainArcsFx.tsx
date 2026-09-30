import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGame } from "../store";
import { GRAPHICS_QUALITY } from "./effectsTunables";
import {
  CHAIN_BEAM_COLOR,
  isLightningBeam,
  lightningEnvelope,
  writeLightningSegment,
} from "./lightningGeometry";
import { BLOOM_LAYER } from "./PaintedPostFx";

// Shared tower/robot lightning: fixed-capacity triangular tubes with an aligned
// cyan sheath. HDR vertex colors feed the existing selective bloom contract.
// Geometry and scratch paths are reused; no lights or per-hop allocations.

const MAX_BEAMS = 24;
const MAX_HOPS = 15;
const SUBDIVS = 8;
const MAIN_NOISE = 0.36;
const FORK_SUBDIVS = 4;
const FORK_LEN_MIN = 0.18;
const FORK_LEN_MAX = 0.34;
const SHIMMER_HZ = 16;

const FORKS_PER_HOP: Record<"low" | "medium" | "high", number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const CORE_TINT = new THREE.Color("#eaf8ff");
const HALO_TINT = new THREE.Color("#9fd8ff");
const FLASH_TINT = new THREE.Color("#d6f4ff");

const MAIN_PAIRS_PER_HOP = SUBDIVS;
const FORK_PAIRS = FORK_SUBDIVS;
const MAX_FORKS_PER_HOP = FORKS_PER_HOP.high;
const MAX_PAIRS_PER_BEAM = MAX_HOPS * (MAIN_PAIRS_PER_HOP + MAX_FORKS_PER_HOP * FORK_PAIRS);
const MAX_PAIRS = MAX_BEAMS * MAX_PAIRS_PER_BEAM;
const MAX_VERTS = MAX_PAIRS * 18;
const MAX_FLASHES = MAX_BEAMS * 5;

const makeArcGeometry = () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 3), 3).setUsage(THREE.DynamicDrawUsage),
  );
  g.setAttribute(
    "color",
    new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 3), 3).setUsage(THREE.DynamicDrawUsage),
  );
  g.setDrawRange(0, 0);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e4);
  return g;
};

const seeded = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
};

export const ChainArcsFx = () => {
  const coreRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const flashRef = useRef<THREE.InstancedMesh>(null);

  const coreGeom = useMemo(makeArcGeometry, []);
  const haloGeom = useMemo(makeArcGeometry, []);
  const flashGeom = useMemo(() => new THREE.PlaneGeometry(0.9, 0.9), []);
  useEffect(
    () => () => {
      coreGeom.dispose();
      haloGeom.dispose();
      flashGeom.dispose();
    },
    [coreGeom, haloGeom, flashGeom],
  );

  const flashTexture = useMemo(() => {
    // Radial gradient sprite so the impact flash reads as a soft glow,
    // not the opaque bluish square the untextured plane was rendering as.
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
    grad.addColorStop(0.7, "rgba(255,255,255,0.12)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }, []);

  const path = useMemo(() => Array.from({ length: 3 }, () => new Float32Array(SUBDIVS + 1)), []);
  useEffect(
    () => () => {
      flashTexture?.dispose();
    },
    [flashTexture],
  );

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const flashColor = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    const m = flashRef.current;
    if (!m) return;
    const big = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e4);
    m.boundingSphere = big.clone();
    m.geometry.boundingSphere = big.clone();
  }, []);

  useEffect(() => {
    // SelectiveBloom compares the scene depth with its selected-object depth.
    // Only the depth-writing core belongs in that mask. Transparent sheath and
    // hit sprites would mask it with a different depth and erase its bloom.
    coreRef.current?.layers.enable(BLOOM_LAYER);
  }, []);

  useFrame((state) => {
    const { world } = useGame.getState();
    const core = coreRef.current;
    const halo = haloRef.current;
    const flash = flashRef.current;
    if (!core || !halo || !flash) return;
    const now = world.time;
    const forksPerHop = FORKS_PER_HOP[GRAPHICS_QUALITY];
    const wantFlash = GRAPHICS_QUALITY !== "low";

    const corePos = core.geometry.attributes.position.array as Float32Array;
    const coreCol = core.geometry.attributes.color.array as Float32Array;
    const haloPos = halo.geometry.attributes.position.array as Float32Array;
    const haloCol = halo.geometry.attributes.color.array as Float32Array;

    const tBucket = Math.floor(now * SHIMMER_HZ);
    let pairIdx = 0;
    let flashCount = 0;
    let beamSlots = 0;

    const writePair = (
      pos: Float32Array,
      col: Float32Array,
      idx: number,
      ax: number,
      ay: number,
      az: number,
      bx: number,
      by: number,
      bz: number,
      r: number,
      g: number,
      b: number,
      width = 1,
    ) => {
      const sheath = pos === haloPos;
      writeLightningSegment(
        pos,
        col,
        idx,
        ax,
        ay,
        az,
        bx,
        by,
        bz,
        (sheath ? 0.04 : 0.023) * width,
        (sheath ? 0.03 : 0.017) * width,
        r,
        g,
        b,
      );
    };

    for (let bi = world.beams.length - 1; bi >= 0; bi--) {
      if (beamSlots >= MAX_BEAMS) break;
      const beam = world.beams[bi];
      if (!isLightningBeam(beam.color)) continue;
      if (beam.points.length < 2) continue;

      const life = Math.max(0, beam.expiresAt - now);
      if (life <= 0) continue;
      const lifeNorm = Math.min(1, life * 10);
      const fadeIn = lightningEnvelope(life);
      const alpha = fadeIn * 6;
      const coreR = CORE_TINT.r * alpha;
      const coreG = CORE_TINT.g * alpha;
      const coreB = CORE_TINT.b * alpha;
      const haloR = HALO_TINT.r * alpha * 0.1;
      const haloG = HALO_TINT.g * alpha * 0.1;
      const haloB = HALO_TINT.b * alpha * 0.14;

      const rng = seeded((beam.id * 1597 + tBucket * 9176) ^ 0x9e3779b9);

      const hops = Math.min(MAX_HOPS, beam.points.length - 1);
      for (let h = 0; h < hops; h++) {
        const a = beam.points[h];
        const c = beam.points[h + 1];
        const ah = a.h ?? (h === 0 && beam.color === CHAIN_BEAM_COLOR ? 1.35 : 0.85);
        const ch = c.h ?? 0.85;
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const perpX = -dy / len;
        const perpZ = -dx / len;

        const [mainXs, mainYs, mainZs] = path;
        mainXs[0] = a.x;
        mainYs[0] = ah;
        mainZs[0] = -a.y;
        for (let s = 1; s <= SUBDIVS; s++) {
          const t = s / SUBDIVS;
          const taper = Math.sin(t * Math.PI);
          const baseX = a.x + dx * t;
          const baseY = a.y + dy * t;
          const baseH = ah + (ch - ah) * t;
          const n = rng() * MAIN_NOISE * taper;
          const px = baseX + perpX * n;
          const py = baseH + rng() * 0.24 * taper;
          const pz = -baseY + perpZ * n;
          mainXs[s] = px;
          mainYs[s] = py;
          mainZs[s] = pz;
        }

        for (let s = 0; s < SUBDIVS; s++) {
          if (pairIdx >= MAX_PAIRS) break;
          writePair(
            corePos,
            coreCol,
            pairIdx,
            mainXs[s],
            mainYs[s],
            mainZs[s],
            mainXs[s + 1],
            mainYs[s + 1],
            mainZs[s + 1],
            coreR,
            coreG,
            coreB,
          );
          writePair(
            haloPos,
            haloCol,
            pairIdx,
            mainXs[s],
            mainYs[s],
            mainZs[s],
            mainXs[s + 1],
            mainYs[s + 1],
            mainZs[s + 1],
            haloR,
            haloG,
            haloB,
          );
          pairIdx++;
        }

        // Forks — short dead-end branches launched from a random main vertex.
        for (let f = 0; f < forksPerHop; f++) {
          if (pairIdx >= MAX_PAIRS) break;
          const startIdx = 2 + Math.floor((rng() * 0.5 + 0.5) * (SUBDIVS - 3)); // away from endpoints
          const sx = mainXs[startIdx];
          const sy = mainYs[startIdx];
          const sz = mainZs[startIdx];
          // Perpendicular direction in XZ plane plus a small forward bias so
          // forks splay out rather than running parallel to the strike.
          const side = rng() > 0 ? 1 : -1;
          const lenRand = FORK_LEN_MIN + (rng() * 0.5 + 0.5) * (FORK_LEN_MAX - FORK_LEN_MIN);
          const forkLen = Math.min(1.6, len * lenRand);
          const fdx = perpX * side * forkLen + (dx / len) * forkLen * 0.18 * rng();
          const fdz = perpZ * side * forkLen + (-dy / len) * forkLen * 0.18 * rng();
          let prevX = sx;
          let prevY = sy;
          let prevZ = sz;
          for (let fs = 1; fs <= FORK_SUBDIVS; fs++) {
            if (pairIdx >= MAX_PAIRS) break;
            const t = fs / FORK_SUBDIVS;
            const taper = (1 - t) * 0.9 + 0.1;
            const jitter = rng() * MAIN_NOISE * 0.7 * taper;
            const nx = sx + fdx * t + perpX * jitter * (side > 0 ? -1 : 1);
            const ny = sy + rng() * 0.22 * taper + 0.25 * t;
            const nz = sz + fdz * t + perpZ * jitter * (side > 0 ? -1 : 1);
            // Taper branch width and energy toward its dead end.
            writePair(
              corePos,
              coreCol,
              pairIdx,
              prevX,
              prevY,
              prevZ,
              nx,
              ny,
              nz,
              coreR * taper,
              coreG * taper,
              coreB * taper,
              taper * 0.65,
            );
            // Glow follows exactly the same branch, avoiding detached ghost arcs.
            writePair(
              haloPos,
              haloCol,
              pairIdx,
              prevX,
              prevY,
              prevZ,
              nx,
              ny,
              nz,
              haloR * taper * 0.6,
              haloG * taper * 0.6,
              haloB * taper * 0.6,
              taper * 0.65,
            );
            prevX = nx;
            prevY = ny;
            prevZ = nz;
            pairIdx++;
          }
        }

        // Impact flash at this hop's terminus (i.e. the dino).
        if (wantFlash && flashCount < MAX_FLASHES) {
          dummy.position.set(c.x, ch + 0.1, -c.y);
          dummy.quaternion.copy(state.camera.quaternion);
          const flashScale = 0.45 + (1 - lifeNorm) * 0.55;
          dummy.scale.setScalar(flashScale);
          dummy.updateMatrix();
          flash.setMatrixAt(flashCount, dummy.matrix);
          const fl = fadeIn * 2.5;
          flashColor.setRGB(FLASH_TINT.r * fl, FLASH_TINT.g * fl, FLASH_TINT.b * fl);
          flash.setColorAt(flashCount, flashColor);
          flashCount++;
        }
      }

      beamSlots++;
    }

    core.geometry.setDrawRange(0, pairIdx * 18);
    halo.geometry.setDrawRange(0, pairIdx * 18);
    // Upload only active vertices; dense pool capacity must not tax quiet frames.
    for (const geometry of [core.geometry, halo.geometry]) {
      for (const name of ["position", "color"]) {
        const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
        attribute.clearUpdateRanges();
        if (pairIdx > 0) {
          attribute.addUpdateRange(0, pairIdx * 54);
          attribute.needsUpdate = true;
        }
      }
    }
    core.visible = pairIdx > 0;
    halo.visible = pairIdx > 0;

    flash.count = flashCount;
    flash.instanceMatrix.needsUpdate = true;
    if (flash.instanceColor) flash.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <mesh ref={haloRef} args={[haloGeom]} renderOrder={2} frustumCulled={false}>
        <meshBasicMaterial
          vertexColors
          transparent
          opacity={1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={coreRef} args={[coreGeom]} renderOrder={3} frustumCulled={false}>
        {/* Opaque HDR core supplies identical depth to both selective-bloom
            inputs. Glow and fade energy live in vertex RGB, not opacity. */}
        <meshBasicMaterial vertexColors depthWrite toneMapped={false} />
      </mesh>
      <instancedMesh
        ref={flashRef}
        args={[flashGeom, undefined, MAX_FLASHES]}
        renderOrder={3}
        frustumCulled={false}
      >
        <meshBasicMaterial
          map={flashTexture ?? undefined}
          color="#ffffff"
          transparent
          opacity={1}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
};
