import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGame } from "../store";
import { BLOOM_LAYER, getGraphicsQuality } from "./effectsTunables";
import { softParticleShader, useSoftParticles } from "./SoftParticles";

const vertexShader = `
attribute vec3 billowState;
attribute vec3 billowTint;
varying vec2 vUv;
varying vec3 vState;
varying vec3 vTint;
void main() {
  vUv = uv;
  vState = billowState;
  vTint = billowTint;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const fragmentShader = `
uniform sampler2D atlas;
uniform float emissive;
${softParticleShader}
varying vec2 vUv;
varying vec3 vState;
varying vec3 vTint;
vec4 frame(float index) {
  vec2 cell = vec2(mod(index, 4.0), 3.0 - floor(index / 4.0));
  vec2 uv = (cell + mix(vec2(0.5/256.0), vec2(1.0-0.5/256.0), vUv)) / 4.0;
  vec4 texel = texture2D(atlas, uv);
  return vec4(texel.rgb * texel.a, texel.a);
}
void main() {
  float fade = vState.y * softParticleFade(0.3);
  if (fade < 0.001) discard;
  float index = floor(vState.x);
  vec4 puff = mix(frame(index), frame(mod(index + 1.0, 16.0)), fract(vState.x));
  float margin = min(min(vUv.x, vUv.y), min(1.0-vUv.x, 1.0-vUv.y));
  fade *= smoothstep(0.015, 0.10, margin);
  vec3 rgb = puff.rgb / max(puff.a, 0.001) * vTint;
  // Negative flash marks cold mist: lift the soot-colored atlas into pale
  // blue-white vapor while retaining its texture and soft alpha edges.
  float cold = max(0.0, -vState.z);
  rgb = mix(rgb, vTint * (0.78 + 0.22 * dot(puff.rgb / max(puff.a, 0.001),
    vec3(0.2126, 0.7152, 0.0722))), cold);
  // A hot initial flash gives way to textured orange lobes, never a solid
  // glowing sphere. Vapor stays alpha-blended rather than emitting light.
  rgb = mix(rgb, vec3(2.3, 1.8, 1.0), max(0.0, vState.z) * emissive);
  gl_FragColor = vec4(rgb, puff.a * fade * mix(1.0, 0.85, emissive));
  #include <colorspace_fragment>
  gl_FragColor.rgb *= puff.a * fade;
}`;

type Billow = {
  x: number;
  y: number;
  z: number;
  size: number;
  stretch: number;
  angle: number;
  frame: number;
  alpha: number;
  flash: number;
  depth: number;
  tint: THREE.Color;
};
const seed = (id: number) => (id * 0.61803398875) % 1;

// Smoke and cold vapor share one sorted batch and one atlas. Explosions reuse
// the flame atlas in a second batch, replacing the old two sphere batches.
export const CombatBillows = ({ kind }: { kind: "blast" | "vapor" }) => {
  const low = getGraphicsQuality() === "low";
  const capacity = kind === "blast" ? (low ? 48 : 96) : low ? 160 : 320;
  const atlas = useTexture(`/textures/fx/${kind === "blast" ? "flame" : "smoke"}-billow-atlas.png`);
  const soft = useSoftParticles();
  const uniforms = useMemo(
    () => ({
      ...soft.uniforms,
      atlas: { value: atlas },
      emissive: { value: kind === "blast" ? 1 : 0 },
    }),
    [atlas, kind, soft.uniforms],
  );
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const state = useMemo(
    () => new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
    [capacity],
  );
  const tints = useMemo(
    () => new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
    [capacity],
  );
  const pool = useMemo<Billow[]>(
    () =>
      Array.from({ length: capacity }, () => ({
        x: 0,
        y: 0,
        z: 0,
        size: 1,
        stretch: 1,
        angle: 0,
        frame: 0,
        alpha: 0,
        flash: 0,
        depth: 0,
        tint: new THREE.Color(),
      })),
    [capacity],
  );
  const sorted = useMemo<Billow[]>(() => [], []);
  useEffect(() => {
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.minFilter = THREE.LinearMipmapLinearFilter;
    atlas.generateMipmaps = true;
    atlas.needsUpdate = true;
    state.setUsage(THREE.DynamicDrawUsage);
    tints.setUsage(THREE.DynamicDrawUsage);
    ref.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (kind === "blast") ref.current?.layers.enable(BLOOM_LAYER);
  }, [atlas, kind, state, tints]);

  useFrame(({ camera }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const { world } = useGame.getState();
    sorted.length = 0;
    const view = camera.matrixWorldInverse.elements;
    const take = () => {
      const item = pool[sorted.length];
      item.flash = 0;
      item.stretch = 1;
      sorted.push(item);
      return item;
    };
    if (kind === "blast") {
      // Draw the actual gameplay front, with bounded atlas lobes instead of
      // another full-radius explosion each time Mike emits a ring.
      const payload = world.robot.payload;
      if (payload?.kind === "flameRings") {
        const segments = low ? 12 : 20;
        for (const ring of payload.rings) {
          const age = ring.radius / payload.maxRadius;
          for (let j = 0; j < segments && sorted.length < capacity / 2; j++) {
            const b = take();
            const angle = (j / segments) * Math.PI * 2;
            b.x = world.robot.pos.x + Math.cos(angle) * ring.radius;
            b.z = -world.robot.pos.y + Math.sin(angle) * ring.radius;
            b.y = 0.45;
            b.size = 0.45 + ring.radius * 0.12;
            b.angle = Math.sin(j * 2.4) * 0.25;
            b.frame = (world.time * 18 + j * 3.7) % 16;
            b.alpha = Math.min(1, age * 12) * (1 - THREE.MathUtils.smoothstep(age, 0.65, 1)) * 0.8;
            b.tint.setRGB(1.2, 0.9, 0.65);
          }
        }
      }
      const lobes = low ? 2 : 3;
      // Prefer recent explosions under overload; there is no persistent
      // per-explosion renderer state to leak when a level resets.
      for (
        let i = Math.max(0, world.explosions.length - capacity / lobes);
        i < world.explosions.length;
        i++
      ) {
        const e = world.explosions[i];
        if (e.damageType && e.damageType !== "flame" && e.damageType !== "explosive") continue;
        const age = THREE.MathUtils.clamp(1 - (e.expiresAt - world.time) / e.maxLife, 0, 1);
        if (age >= 1) continue;
        for (let j = 0; j < lobes && sorted.length < capacity; j++) {
          const b = take();
          const s = seed(e.id + j * 31);
          const angle = s * Math.PI * 2;
          const spread = j === 0 ? 0 : e.radius * age * 0.32;
          b.x = e.pos.x + Math.cos(angle) * spread;
          b.z = -e.pos.y + Math.sin(angle) * spread;
          b.y = 0.3 + age * e.radius * 0.25;
          b.size = e.radius * (0.32 + Math.sqrt(age) * 0.68) * (j === 0 ? 1 : 0.68);
          b.angle = angle + age * 0.4;
          b.frame = (s * 16 + age * 12) % 16;
          b.alpha =
            Math.min(1, age / 0.055) * (1 - THREE.MathUtils.smoothstep(age, 0.22, 1)) * 0.85;
          b.flash = j === 0 ? (1 - THREE.MathUtils.smoothstep(age, 0.02, 0.22)) * 0.75 : 0;
          b.tint.setRGB(1.25, 1 - age * 0.45, 1 - age * 0.8);
        }
      }
    } else {
      // Reserve space for cold mist so explosions cannot erase the freeze cue.
      const smokeBudget = Math.min(
        world.puffs.length,
        world.cryoWaves.length || world.explosions.length ? Math.floor(capacity * 0.6) : capacity,
      );
      const step = world.puffs.length / Math.max(1, smokeBudget);
      for (let i = 0; i < smokeBudget; i++) {
        const p = world.puffs[Math.floor(i * step)];
        const age = THREE.MathUtils.clamp(1 - (p.expiresAt - world.time) / p.maxLife, 0, 1);
        if (age >= 1) continue;
        const b = take();
        b.x = p.pos.x;
        b.y = p.h;
        b.z = -p.pos.y;
        b.size = (p.size0 + (p.size1 - p.size0) * age) * 0.64;
        b.angle = p.rot;
        b.frame = (seed(p.id) * 16 + age * 11) % 16;
        b.alpha =
          p.alpha0 * Math.min(1, age / 0.16) * (1 - THREE.MathUtils.smoothstep(age, 0.35, 1));
        b.tint.set(p.tint);
      }
      // Nonthermal robot pulses use cool vapor / impact dust, without soot
      // or orange emission. Same shared depth fade and existing draw call.
      for (const e of world.explosions) {
        if (!e.damageType || e.damageType === "flame" || e.damageType === "explosive") continue;
        const age = THREE.MathUtils.clamp(1 - (e.expiresAt - world.time) / e.maxLife, 0, 1);
        if (age >= 1) continue;
        const wisps = low ? 8 : 12;
        for (let j = 0; j < wisps && sorted.length < capacity; j++) {
          const b = take();
          const angle = (j / wisps) * Math.PI * 2;
          b.x = e.pos.x + Math.cos(angle) * e.radius * age;
          b.z = -e.pos.y + Math.sin(angle) * e.radius * age;
          b.y = 0.25 + age * 0.3;
          b.size = 0.3 + e.radius * 0.16;
          b.angle = angle;
          b.frame = (j * 3.7 + age * 12) % 16;
          b.alpha = Math.sin(age * Math.PI) * 0.4;
          b.tint.set(e.damageType === "kinetic" ? "#b9aa91" : "#9beaff");
        }
      }
      const wisps = low ? 5 : 9;
      for (const w of world.cryoWaves) {
        const age = THREE.MathUtils.clamp(1 - (w.expiresAt - world.time) / w.maxLife, 0, 1);
        if (age >= 1) continue;
        for (let j = 0; j < wisps && sorted.length < capacity; j++) {
          const b = take();
          const s = seed(w.id + j * 17);
          const angle = (j / wisps) * Math.PI * 2 + s * 0.3;
          const radius = w.maxRadius * age * (0.8 + s * 0.16);
          b.x = w.pos.x + Math.cos(angle) * radius;
          b.z = -w.pos.y + Math.sin(angle) * radius;
          b.y = 0.18 + Math.sin(age * Math.PI) * 0.23;
          b.size = (0.24 + w.maxRadius * 0.1) * (0.65 + age * 0.55) * (0.75 + s * 0.5);
          b.stretch = 1.3 + s * 0.5;
          b.angle = (s - 0.5) * 0.45;
          b.frame = (s * 16 + age * 9) % 16;
          b.alpha = Math.sin(age * Math.PI) * 0.22;
          b.flash = -1;
          b.tint.setRGB(0.8, 0.91, 1.0);
        }
      }
    }
    for (const b of sorted) b.depth = view[2] * b.x + view[6] * b.y + view[10] * b.z;
    sorted.sort((a, b) => a.depth - b.depth);
    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i];
      dummy.position.set(b.x, b.y, b.z);
      dummy.quaternion.copy(camera.quaternion);
      dummy.rotateZ(b.angle);
      dummy.scale.set(b.size * b.stretch, b.size, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      tints.setXYZ(i, b.tint.r, b.tint.g, b.tint.b);
      state.array[i * 3] = b.frame;
      state.array[i * 3 + 1] = b.alpha;
      state.array[i * 3 + 2] = b.flash;
    }
    mesh.count = sorted.length;
    if (!mesh.count) return;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
    mesh.instanceMatrix.needsUpdate = true;
    tints.clearUpdateRanges();
    tints.addUpdateRange(0, mesh.count * 3);
    tints.needsUpdate = true;
    state.clearUpdateRanges();
    state.addUpdateRange(0, mesh.count * 3);
    state.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, capacity]}
      frustumCulled={false}
      renderOrder={kind === "blast" ? 2 : 3}
      onBeforeRender={soft.beforeRender}
    >
      <planeGeometry args={[2, 2]}>
        <primitive object={state} attach="attributes-billowState" />
        <primitive object={tints} attach="attributes-billowTint" />
      </planeGeometry>
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest
        toneMapped={false}
        blending={THREE.CustomBlending}
        blendSrc={THREE.OneFactor}
        blendDst={THREE.OneMinusSrcAlphaFactor}
        blendEquation={THREE.AddEquation}
      />
    </instancedMesh>
  );
};
