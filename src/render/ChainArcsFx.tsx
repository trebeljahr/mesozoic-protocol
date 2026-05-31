import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGame } from "../store";
import { CHAIN_BEAM_COLOR } from "./Effects";
import { GRAPHICS_QUALITY } from "./effectsTunables";

// Forked lightning render for the Chain Coil tower. Sim still emits
// the chain shot via createBeam(world, points, CHAIN_BEAM_COLOR, ...),
// which we identify by the unique color string (no sim-side flag was
// added). Effects.tsx skips beams of this color so the regular polyline
// path doesn't double-render under us.
//
// Output is built from a single LineSegments pool per pass — core +
// halo — plus an instanced impact-flash billboard at each chain
// hit point. Each frame we regenerate jagged offsets bucketed at ~16Hz
// so the arc shimmers across its short (~100ms) lifetime without
// allocating, and per-vertex colour carries the life-driven fade.

const MAX_BEAMS = 24;
const MAX_HOPS = 5;
const SUBDIVS = 8;
const MAIN_NOISE = 0.36;
const HALO_NOISE = 0.6;
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
const MAX_VERTS = MAX_PAIRS * 2;
const MAX_FLASHES = MAX_BEAMS * MAX_HOPS;

const makeLineGeom = () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 3), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 3), 3));
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
  const coreRef = useRef<THREE.LineSegments>(null);
  const haloRef = useRef<THREE.LineSegments>(null);
  const flashRef = useRef<THREE.InstancedMesh>(null);

  const coreGeom = useMemo(makeLineGeom, []);
  const haloGeom = useMemo(makeLineGeom, []);
  const flashGeom = useMemo(() => new THREE.PlaneGeometry(0.9, 0.9), []);
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

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const flashColor = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    const m = flashRef.current;
    if (!m) return;
    const big = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e4);
    m.boundingSphere = big.clone();
    m.geometry.boundingSphere = big.clone();
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
    ) => {
      const pi = idx * 6;
      pos[pi + 0] = ax;
      pos[pi + 1] = ay;
      pos[pi + 2] = az;
      pos[pi + 3] = bx;
      pos[pi + 4] = by;
      pos[pi + 5] = bz;
      col[pi + 0] = r;
      col[pi + 1] = g;
      col[pi + 2] = b;
      col[pi + 3] = r;
      col[pi + 4] = g;
      col[pi + 5] = b;
    };

    for (let bi = 0; bi < world.beams.length; bi++) {
      if (beamSlots >= MAX_BEAMS) break;
      const beam = world.beams[bi];
      if (beam.color !== CHAIN_BEAM_COLOR) continue;
      if (beam.points.length < 2) continue;

      const life = Math.max(0, beam.expiresAt - now);
      const lifeNorm = Math.min(1, life * 10);
      const fadeIn = Math.min(1, (1 - life * 10) * 4); // brief 25ms-ish strike-in flash
      const alpha = lifeNorm * (0.55 + 0.45 * fadeIn);
      const coreR = CORE_TINT.r * alpha;
      const coreG = CORE_TINT.g * alpha;
      const coreB = CORE_TINT.b * alpha;
      const haloR = HALO_TINT.r * alpha * 0.95;
      const haloG = HALO_TINT.g * alpha * 0.95;
      const haloB = HALO_TINT.b * alpha;

      const rng = seeded((beam.id * 1597 + tBucket * 9176) ^ 0x9e3779b9);

      const hops = Math.min(MAX_HOPS, beam.points.length - 1);
      for (let h = 0; h < hops; h++) {
        const a = beam.points[h];
        const c = beam.points[h + 1];
        const ah = a.h ?? (h === 0 ? 1.35 : 0.85);
        const ch = c.h ?? 0.85;
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const perpX = -dy / len;
        const perpZ = -dx / len;

        const mainXs: number[] = [a.x];
        const mainYs: number[] = [ah];
        const mainZs: number[] = [-a.y];
        for (let s = 1; s <= SUBDIVS; s++) {
          const t = s / SUBDIVS;
          const taper = Math.sin(t * Math.PI);
          const baseX = a.x + dx * t;
          const baseY = a.y + dy * t;
          const baseH = ah + (ch - ah) * t;
          const n = rng() * MAIN_NOISE * taper;
          const px = baseX + perpX * n;
          const py = baseH + rng() * 0.08 * taper;
          const pz = -baseY + perpZ * n;
          mainXs.push(px);
          mainYs.push(py);
          mainZs.push(pz);
        }

        // Halo points — wider perpendicular jitter, small h lift so the
        // glow strip sits visibly above the bright core line.
        const haloXs: number[] = [a.x];
        const haloYs: number[] = [ah + 0.05];
        const haloZs: number[] = [-a.y];
        for (let s = 1; s <= SUBDIVS; s++) {
          const t = s / SUBDIVS;
          const taper = Math.sin(t * Math.PI);
          const baseX = a.x + dx * t;
          const baseY = a.y + dy * t;
          const baseH = ah + (ch - ah) * t;
          const n = rng() * HALO_NOISE * taper;
          haloXs.push(baseX + perpX * n);
          haloYs.push(baseH + 0.05 + rng() * 0.14 * taper);
          haloZs.push(-baseY + perpZ * n);
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
            haloXs[s],
            haloYs[s],
            haloZs[s],
            haloXs[s + 1],
            haloYs[s + 1],
            haloZs[s + 1],
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
          const forkLen = len * lenRand;
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
            const ny = sy + rng() * 0.06 * taper - 0.02 * t;
            const nz = sz + fdz * t + perpZ * jitter * (side > 0 ? -1 : 1);
            // Core only — keep forks single-pass, halo would obscure the
            // crisp split shape and isn't worth the verts.
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
            );
            // Mirror the empty pair into halo so vertex counts stay aligned.
            writePair(
              haloPos,
              haloCol,
              pairIdx,
              prevX,
              prevY + 0.04,
              prevZ,
              nx,
              ny + 0.04,
              nz,
              haloR * taper * 0.6,
              haloG * taper * 0.6,
              haloB * taper * 0.6,
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
          const fl = lifeNorm * (0.6 + fadeIn * 0.4);
          flashColor.setRGB(FLASH_TINT.r * fl, FLASH_TINT.g * fl, FLASH_TINT.b * fl);
          flash.setColorAt(flashCount, flashColor);
          flashCount++;
        }
      }

      beamSlots++;
    }

    core.geometry.setDrawRange(0, pairIdx * 2);
    halo.geometry.setDrawRange(0, pairIdx * 2);
    core.geometry.attributes.position.needsUpdate = true;
    core.geometry.attributes.color.needsUpdate = true;
    halo.geometry.attributes.position.needsUpdate = true;
    halo.geometry.attributes.color.needsUpdate = true;
    core.visible = pairIdx > 0;
    halo.visible = pairIdx > 0;

    flash.count = flashCount;
    flash.instanceMatrix.needsUpdate = true;
    if (flash.instanceColor) flash.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <lineSegments ref={haloRef} args={[haloGeom]} renderOrder={2} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={1} depthWrite={false} />
      </lineSegments>
      <lineSegments ref={coreRef} args={[coreGeom]} renderOrder={3} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={1} depthWrite={false} />
      </lineSegments>
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
        />
      </instancedMesh>
    </group>
  );
};
