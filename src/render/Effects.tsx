// Selective-bloom opt-in convention: emissive sub-meshes added by the
// unit material pipeline (ModelEnemyMesh / ModelRobotMesh via
// src/render/materialTunables.ts) set
// `mesh.userData.bloom = true` (and `material.userData.bloom = true`
// on the cloned material). When the post-FX selective-bloom pass is
// wired into this file, it should walk the scene and add objects with
// that flag to its bloom layer. Until then, the flag is harmless
// metadata — readers without bloom support ignore it.

import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGame } from "../store";
import { CombatBillows } from "./CombatBillows";
import { CryoWaves } from "./CryoWaves";
import { FlameParticles } from "./FlameParticles";
import { isLightningBeam } from "./lightningGeometry";
import { BLOOM_LAYER } from "./PaintedPostFx";
import { SoftParticles } from "./SoftParticles";

export { CHAIN_BEAM_COLOR } from "./lightningGeometry";

const MAX_PARTICLES = 1024;
const MAX_BEAMS = 64;
const MAX_BEAM_POINTS = 16;
const BEAM_SUBDIVISIONS = 6; // interpolation points per source segment
const MAX_BEAM_VERTS = (MAX_BEAM_POINTS - 1) * BEAM_SUBDIVISIONS + 1;

type BeamPass = { line: THREE.Line; mat: THREE.LineBasicMaterial };

const makeBeamPair = (): { core: BeamPass; halo: BeamPass } => {
  const mkLine = (baseColor: string, opacity: number) => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(MAX_BEAM_VERTS * 3), 3),
    );
    geom.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({
      color: baseColor,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const line = new THREE.Line(geom, mat);
    line.visible = false;
    return { line, mat };
  };
  return {
    core: mkLine("#ffffff", 1),
    halo: mkLine("#9fd8ff", 0.45),
  };
};

export const Effects = () => {
  // Kenney soft-puff sprite — same asset the smoke billboards use, here on
  // the additive spark particles so impact bursts read as soft glows
  // instead of hard-edged polygon discs.
  const particleTex = useTexture("/textures/fx/whitepuff15.png");
  const particleRef = useRef<THREE.InstancedMesh>(null);
  const particleMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const beamsGroupRef = useRef<THREE.Group>(null);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  const beamPairs = useMemo(() => {
    const arr: ReturnType<typeof makeBeamPair>[] = [];
    for (let i = 0; i < MAX_BEAMS; i++) arr.push(makeBeamPair());
    return arr;
  }, []);

  useEffect(() => {
    const group = beamsGroupRef.current;
    if (!group) return;
    for (const b of beamPairs) {
      group.add(b.halo.line);
      group.add(b.core.line);
    }
    return () => {
      for (const b of beamPairs) {
        group.remove(b.halo.line);
        group.remove(b.core.line);
        b.core.line.geometry.dispose();
        b.halo.line.geometry.dispose();
        b.core.mat.dispose();
        b.halo.mat.dispose();
      }
    };
  }, [beamPairs]);

  // Override the InstancedMesh bounding spheres so the renderer never
  // culls them when their nominal origin pans off-screen — particle
  // positions are baked into per-instance matrices, not the mesh's
  // matrixWorld, so the default origin-radius-1 sphere fails the
  // frustum test as soon as the player zooms in and pans away from
  // origin. `frustumCulled={false}` covers the common path; this
  // belts-and-suspenders the cases where Three.js recomputes the
  // sphere on geometry change.
  useEffect(() => {
    const big = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e4);
    const meshes = [particleRef.current];
    for (const m of meshes) {
      if (!m) continue;
      m.boundingSphere = big.clone();
      m.geometry.boundingSphere = big.clone();
      // Combat VFX are HDR (toneMapped=false additive); opt into the
      // selective bloom pass so explosions / muzzle flashes
      // carry a soft halo instead of reading as flat sprites.
      m.layers.enable(BLOOM_LAYER);
    }
  }, []);

  useFrame((state) => {
    const { world } = useGame.getState();
    const now = world.time;

    // --- Particles ---
    const pMesh = particleRef.current;
    if (pMesh) {
      let i = 0;
      for (const p of world.particles) {
        if (p.kind === "flame") continue;
        if (i >= MAX_PARTICLES) break;
        const life = Math.max(0, (p.expiresAt - now) / p.maxLife);
        dummy.position.set(p.pos.x, 0.55, -p.pos.y);
        // Camera-facing billboard. Flat planes have no thickness in the camera
        // direction, so they get silhouette-clipped by geometry instead of
        // producing hard polygon-intersection edges like 3D spheres did.
        dummy.quaternion.copy(state.camera.quaternion);
        const fadeOut = life < 0.15 ? life / 0.15 : 1;
        // Fade size IN over the first ~30% of life so a particle spawned at
        // a tower muzzle (which sits just inside the body's bounding sphere)
        // doesn't paint an additive disc over the tower silhouette before it
        // travels clear of the body. By the time the particle hits full size
        // it has moved far enough forward that depth-test clipping handles the
        // rest. Without this, every billboard's center-depth is in front of
        // the tower body at the muzzle, so depth-test passes for the whole
        // disc and the bright additive ring bleeds over the chassis.
        const age = 1 - life;
        const grow = Math.min(1, age * 3.3);
        const fadeIn = grow;
        dummy.scale.setScalar((0.06 + grow * 0.24 + life * 0.06 * fadeIn) * fadeOut);
        dummy.updateMatrix();
        pMesh.setMatrixAt(i, dummy.matrix);
        color.set(p.color);
        const boost = (0.4 + life * 1.0) * fadeOut;
        color.multiplyScalar(boost);
        pMesh.setColorAt(i, color);
        i++;
      }
      pMesh.count = i;
      pMesh.instanceMatrix.needsUpdate = true;
      if (pMesh.instanceColor) pMesh.instanceColor.needsUpdate = true;
    }

    // --- Straight tracers, core + halo (lightning has its own renderer) ---
    for (let k = 0; k < beamPairs.length; k++) {
      beamPairs[k].core.line.visible = false;
      beamPairs[k].halo.line.visible = false;
    }

    let idx = 0;
    // Keep newest beams so short-lived robot ult arcs don't starve behind
    // older tower/auto-attack tracers during dense volleys.
    const firstVisibleBeam = Math.max(0, world.beams.length - MAX_BEAMS);
    for (let beamIdx = firstVisibleBeam; beamIdx < world.beams.length; beamIdx++) {
      const b = world.beams[beamIdx];
      if (b.points.length < 2 || b.points.length > MAX_BEAM_POINTS) {
        continue;
      }
      // Tower and cyan robot lightning share ChainArcsFx; keep one owner.
      if (isLightningBeam(b.color)) continue;

      const pair = beamPairs[idx];
      const coreArr = pair.core.line.geometry.attributes.position.array as Float32Array;
      const haloArr = pair.halo.line.geometry.attributes.position.array as Float32Array;

      // For each source segment, emit a jittered polyline with BEAM_SUBDIVISIONS points.
      // Core uses tight noise; halo uses larger noise and a slight height offset for glow.
      let coreVi = 0;
      let haloVi = 0;
      const writePoint = (arr: Float32Array, vi: number, x: number, y: number, z: number) => {
        arr[vi * 3 + 0] = x;
        arr[vi * 3 + 1] = y;
        arr[vi * 3 + 2] = z;
      };

      const firstP = b.points[0];
      const firstH = firstP.h ?? 0.85;
      writePoint(coreArr, coreVi++, firstP.x, firstH, -firstP.y);
      writePoint(haloArr, haloVi++, firstP.x, firstH + 0.08, -firstP.y);

      for (let s = 0; s < b.points.length - 1; s++) {
        const a = b.points[s];
        const bpt = b.points[s + 1];
        const dx = bpt.x - a.x;
        const dy = bpt.y - a.y;
        const ah = a.h ?? 0.85;
        const bh = bpt.h ?? 0.85;
        for (let sub = 1; sub <= BEAM_SUBDIVISIONS; sub++) {
          const t = sub / BEAM_SUBDIVISIONS;
          const baseX = a.x + dx * t;
          const baseY = a.y + dy * t;
          const baseH = ah + (bh - ah) * t;

          writePoint(coreArr, coreVi++, baseX, baseH, -baseY);
          writePoint(haloArr, haloVi++, baseX, baseH + 0.08, -baseY);
        }
      }

      pair.core.line.geometry.setDrawRange(0, coreVi);
      pair.core.line.geometry.attributes.position.needsUpdate = true;
      pair.halo.line.geometry.setDrawRange(0, haloVi);
      pair.halo.line.geometry.attributes.position.needsUpdate = true;

      const life = Math.max(0, b.expiresAt - now);
      const lifeNorm = Math.min(1, life * 10);
      pair.core.mat.color.set("#ffffff");
      pair.core.mat.opacity = lifeNorm;
      pair.halo.mat.color.set(b.color);
      pair.halo.mat.opacity = 0.55 * lifeNorm;
      pair.core.line.visible = true;
      pair.halo.line.visible = true;
      idx++;
    }
  });

  return (
    <SoftParticles>
      <group>
        <FlameParticles />
        <instancedMesh
          ref={particleRef}
          args={[undefined, undefined, MAX_PARTICLES]}
          renderOrder={2}
          frustumCulled={false}
        >
          <planeGeometry args={[2, 2]} />
          <meshBasicMaterial
            ref={particleMatRef}
            map={particleTex}
            toneMapped={false}
            transparent
            opacity={0.55}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </instancedMesh>

        <CombatBillows kind="blast" />
        <CombatBillows kind="vapor" />

        <CryoWaves />

        <group ref={beamsGroupRef} renderOrder={2} />
      </group>
    </SoftParticles>
  );
};
