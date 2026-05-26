import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { BIOME_PAINTED } from "../biomes";
import { MAP_HEIGHT, MAP_WIDTH } from "../level";
import { useGame } from "../store";
import {
  GRAPHICS_QUALITY,
  HAZE_DRIFT,
  HAZE_LIFE,
  HAZE_POOL,
  HAZE_RISE_SPEED,
} from "./effectsTunables";

// Scene-geometry ember + dust layer drifting across the entire map. Sits
// behind the post-FX pipeline (this is scene content, not a screen-space
// pass) so vignette / grade / bloom act on it like any other in-world
// particle. Reuses the soft-puff sprite the BiomeAmbientVfx layer already
// uses so the haze blends with combat smoke instead of reading as a new
// particle system.
//
// Density and tint are biome-driven (BIOME_PAINTED in biomes.ts); pool size
// is quality-gated (effectsTunables.ts) so Steam Deck / mobile budgets
// don't pay for a full-density haze on every biome.

type Particle = {
  x: number;
  y: number;
  z: number;
  vy: number;
  drift: number;
  life: number;
  maxLife: number;
  size: number;
};

const MAP_HALF_X = MAP_WIDTH / 2;
const MAP_HALF_Z = MAP_HEIGHT / 2;

const spawn = (p: Particle) => {
  p.x = (Math.random() * 2 - 1) * MAP_HALF_X;
  p.z = (Math.random() * 2 - 1) * MAP_HALF_Z;
  p.y = 0.1 + Math.random() * 2.2;
  p.vy = HAZE_RISE_SPEED * (0.7 + Math.random() * 0.6);
  p.drift = (Math.random() * 2 - 1) * HAZE_DRIFT;
  p.maxLife = HAZE_LIFE * (0.7 + Math.random() * 0.6);
  p.life = Math.random() * p.maxLife;
  p.size = 0.18 + Math.random() * 0.22;
};

export const AmbientHaze = () => {
  const biome = useGame((s) => s.world.biome);
  const palette = BIOME_PAINTED[biome];
  const status = useGame((s) => s.world.status);

  const tex = useTexture("/textures/fx/whitepuff15.png");
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorTmp = useMemo(() => new THREE.Color(), []);

  const poolSize = useMemo(() => {
    const max = HAZE_POOL[GRAPHICS_QUALITY];
    return Math.max(0, Math.round(max * palette.dustDensity));
  }, [palette.dustDensity]);

  const pool = useMemo<Particle[]>(() => {
    const arr: Particle[] = [];
    for (let i = 0; i < poolSize; i++) {
      const p: Particle = {
        x: 0,
        y: 0,
        z: 0,
        vy: 0,
        drift: 0,
        life: 0,
        maxLife: 1,
        size: 0.2,
      };
      spawn(p);
      arr.push(p);
    }
    return arr;
  }, [poolSize]);

  // Override the bounding sphere so the InstancedMesh isn't culled when its
  // origin pans off-screen — particle positions live in per-instance
  // matrices, not the parent's matrixWorld.
  useMemo(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const big = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e4);
    mesh.boundingSphere = big.clone();
    mesh.geometry.boundingSphere = big.clone();
  }, []);

  useFrame((state, dt) => {
    const mesh = meshRef.current;
    const mat = matRef.current;
    if (!mesh || !mat) return;

    // Hide entirely on biomes the palette flags as clear sky (0 density) and
    // when the map screen / results screen is up (status != "running"
    // covers waiting + paused + lost — we still want drift during waiting so
    // the level intro reads as atmospheric, only pause/results freeze it).
    const frozen = status === "lost" || status === "won";
    if (poolSize === 0) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

    mat.color.set(palette.dustColor);

    let i = 0;
    for (const p of pool) {
      if (!frozen) {
        p.life -= dt;
        if (p.life <= 0) spawn(p);
        p.y += p.vy * dt;
        p.x += p.drift * dt;
        p.z += Math.sin(p.life * 1.7) * dt * 0.08;
      }

      const t = Math.max(0, p.life / p.maxLife);
      const fade = Math.sin(Math.min(1, (1 - t) * 4) * Math.PI * 0.5) * Math.min(1, t * 2);
      const size = p.size * (0.6 + (1 - t) * 0.7);

      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(size);
      dummy.quaternion.copy(state.camera.quaternion);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      colorTmp.set(palette.dustColor);
      colorTmp.multiplyScalar(0.6 + fade * 0.7);
      mesh.setColorAt(i, colorTmp);
      i++;
    }
    mesh.count = poolSize;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  if (poolSize === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, poolSize]}
      frustumCulled={false}
      renderOrder={1}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        ref={matRef}
        map={tex}
        transparent
        opacity={0.55}
        depthWrite={false}
        toneMapped={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
};
