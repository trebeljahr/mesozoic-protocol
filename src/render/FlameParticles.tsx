import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Particle } from "../sim/types";
import { useGame } from "../store";
import { BLOOM_LAYER, GRAPHICS_QUALITY } from "./effectsTunables";

const CAPACITY = GRAPHICS_QUALITY === "low" ? 384 : 768;
const ATLAS_URL = "/textures/fx/flame-billow-atlas.png";
const vertexShader = `
attribute vec3 flameState;
varying vec2 vUv;
varying vec3 vFlame;
void main() {
  vUv = uv;
  vFlame = flameState;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const fragmentShader = `
uniform sampler2D atlas;
varying vec2 vUv;
varying vec3 vFlame;
vec4 frame(float index) {
  // Frames run left-to-right, top-to-bottom. Half-texel inset prevents
  // bilinear sampling across cell boundaries in the 1024px atlas.
  vec2 cell = vec2(mod(index, 4.0), 3.0 - floor(index / 4.0));
  vec2 uv = (cell + mix(vec2(0.5 / 256.0), vec2(1.0 - 0.5 / 256.0), vUv)) / 4.0;
  vec4 sampleColor = texture2D(atlas, uv);
  return vec4(sampleColor.rgb * sampleColor.a, sampleColor.a);
}
void main() {
  float age = vFlame.x;
  float index = floor(vFlame.y);
  // Blend premultiplied frames: transparent edges cannot make black halos.
  vec4 fire = mix(frame(index), frame(mod(index + 1.0, 16.0)), fract(vFlame.y));
  float fade = smoothstep(0.0, 0.09, age) * (1.0 - smoothstep(0.5, 1.0, age));
  vec3 cooling = mix(vec3(1.0), vec3(0.85, 0.36, 0.12), age * age * 0.7 + vFlame.z);
  // Hybrid premultiplied alpha/additive blend, as used for sprite fire:
  // retain amber folds while overlapping hot pockets still emit light.
  float margin = min(min(vUv.x, vUv.y), min(1.0 - vUv.x, 1.0 - vUv.y));
  fade *= smoothstep(0.01, 0.09, margin);
  gl_FragColor = vec4(fire.rgb / max(fire.a, 0.001) * cooling * 1.15, fire.a * fade * 0.82);
  #include <colorspace_fragment>
  gl_FragColor.rgb *= fire.a * fade;
}`;

// Baked animation replaces procedural noise per fragment. Two texture reads,
// one instanced draw per scene pass, no lights or render targets of its own.
export const FlameParticles = () => {
  const atlas = useTexture(ATLAS_URL);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const data = useMemo(() => new Float32Array(CAPACITY * 3), []);
  const uniforms = useMemo(() => ({ atlas: { value: atlas } }), [atlas]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const cameraInverse = useMemo(() => new THREE.Quaternion(), []);
  const slots = useMemo(
    () => Array.from({ length: CAPACITY }, () => ({ particle: null as Particle | null, depth: 0 })),
    [],
  );
  const visible = useMemo<(typeof slots)[number][]>(() => [], []);

  useEffect(() => {
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.minFilter = THREE.LinearMipmapLinearFilter;
    atlas.magFilter = THREE.LinearFilter;
    atlas.generateMipmaps = true;
    atlas.needsUpdate = true;
    meshRef.current?.layers.enable(BLOOM_LAYER);
    meshRef.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }, [atlas]);

  useFrame(({ camera }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const { world } = useGame.getState();
    let total = 0;
    for (const p of world.particles) {
      if (p.kind === "flame" && p.expiresAt > world.time) total++;
    }
    // Thin evenly over the entire pool under load so every tower retains a
    // stream, rather than allowing the first towers to consume all slots.
    const budget = Math.min(CAPACITY, GRAPHICS_QUALITY === "low" ? Math.ceil(total / 2) : total);
    const stride = total / Math.max(1, budget);
    let candidate = 0;
    let next = 0;
    visible.length = 0;
    const view = camera.matrixWorldInverse.elements;
    for (const p of world.particles) {
      if (p.kind !== "flame" || p.expiresAt <= world.time) continue;
      if (candidate++ < next || visible.length === budget) continue;
      next += stride;
      const age = THREE.MathUtils.clamp(1 - (p.expiresAt - world.time) / p.maxLife, 0, 1);
      const h = 0.55 + age * age * (0.3 + p.maxLife * 0.55);
      const slot = slots[visible.length];
      slot.particle = p;
      slot.depth = view[2] * p.pos.x + view[6] * h - view[10] * p.pos.y;
      visible.push(slot);
    }
    // Instanced transparent meshes are not automatically sorted per sprite.
    visible.sort((a, b) => a.depth - b.depth);
    cameraInverse.copy(camera.quaternion).invert();
    let count = 0;
    for (const slot of visible) {
      const p = slot.particle!;
      const seconds = Math.max(0, world.time - (p.expiresAt - p.maxLife));
      const age = THREE.MathUtils.clamp(seconds / p.maxLife, 0, 1);
      const seed = (p.id * 0.61803398875) % 1;
      const curl = Math.sin(age * 7 + seed * 6.28) * age * 0.08;
      const speed = Math.hypot(p.vel.x, p.vel.y) || 1;
      dummy.position.set(
        p.pos.x - (p.vel.y / speed) * curl,
        0.55 + age * age * (0.3 + p.maxLife * 0.55),
        -p.pos.y - (p.vel.x / speed) * curl,
      );
      direction.set(p.vel.x, age * 2.4, -p.vel.y).applyQuaternion(cameraInverse);
      dummy.quaternion.copy(camera.quaternion);
      dummy.rotateZ(Math.atan2(direction.y, direction.x) + seed * 2.4 + age * (seed - 0.5));
      // Small at the nozzle, broad rolling billows downstream. Modest
      // stretching avoids exposing a repeated pointed silhouette.
      const size = (0.13 + Math.min(1, age / 0.4) * 0.5) * (0.85 + seed * 0.3);
      dummy.scale.set(size * (1.2 - age * 0.2), size, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(count, dummy.matrix);
      data[count * 3] = age;
      data[count * 3 + 1] = (seed * 16 + seconds * 20) % 16;
      data[count * 3 + 2] = p.maxLife > 0.6 ? 0.1 : 0;
      count++;
    }
    mesh.count = count;
    if (count === 0) return;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, count * 16);
    mesh.instanceMatrix.needsUpdate = true;
    const state = mesh.geometry.attributes.flameState as THREE.InstancedBufferAttribute;
    state.clearUpdateRanges();
    state.addUpdateRange(0, count * 3);
    state.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, CAPACITY]}
      frustumCulled={false}
      renderOrder={2}
    >
      <planeGeometry args={[2, 2]}>
        <instancedBufferAttribute
          attach="attributes-flameState"
          args={[data, 3]}
          usage={THREE.DynamicDrawUsage}
        />
      </planeGeometry>
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        toneMapped={false}
        depthWrite={false}
        blending={THREE.CustomBlending}
        blendSrc={THREE.OneFactor}
        blendDst={THREE.OneMinusSrcAlphaFactor}
        blendEquation={THREE.AddEquation}
      />
    </instancedMesh>
  );
};
