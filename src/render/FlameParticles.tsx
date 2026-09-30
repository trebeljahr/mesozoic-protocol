import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGame } from "../store";
import { BLOOM_LAYER } from "./PaintedPostFx";

const CAPACITY = 1024;
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
uniform float time;
varying vec2 vUv;
varying vec3 vFlame;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float age = vFlame.x;
  vec2 p = vec2(vUv.x * 2.0 - 1.0, vUv.y);
  vec2 flow = vec2(p.x * 3.0 + vFlame.y, p.y * 4.5 - time * 7.0);
  float billow = noise(flow) * 0.65 + noise(flow * 2.1) * 0.35;
  // A broad root breaks into uneven, moving tongues toward the tip.
  float curl = sin(p.y * 8.0 - time * 9.0 + vFlame.y) * p.y * 0.19;
  float width = mix(0.78, 0.04, p.y) + (billow - 0.5) * 0.38;
  float body = 1.0 - smoothstep(width * 0.35, width + 0.12, abs(p.x + curl));
  float edge = smoothstep(0.0, 0.12, p.y) * (1.0 - smoothstep(0.72, 1.0, p.y));
  float fade = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.62, 1.0, age));
  float heat = clamp(body * (1.0 - p.y * 0.7) * (1.0 - age * 0.65)
                     + (billow - 0.5) * 0.18 - vFlame.z, 0.0, 1.0);
  vec3 color = mix(vec3(0.8, 0.035, 0.003), vec3(1.6, 0.36, 0.012), smoothstep(0.05, 0.5, heat));
  color = mix(color, vec3(2.2, 1.35, 0.38), smoothstep(0.5, 0.9, heat));
  gl_FragColor = vec4(color, body * edge * fade * 0.72);
  #include <colorspace_fragment>
}`;

// One bounded draw call. Normal blending preserves orange edges over bright
// terrain; only the hotter HDR core contributes strongly to selective bloom.
export const FlameParticles = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const data = useMemo(() => new Float32Array(CAPACITY * 3), []);
  const uniforms = useMemo(() => ({ time: { value: 0 } }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const cameraInverse = useMemo(() => new THREE.Quaternion(), []);

  useEffect(() => {
    meshRef.current?.layers.enable(BLOOM_LAYER);
  }, []);

  useFrame(({ camera }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const { world } = useGame.getState();
    uniforms.time.value = world.time;
    cameraInverse.copy(camera.quaternion).invert();
    let count = 0;
    for (const p of world.particles) {
      if (p.kind !== "flame" || p.expiresAt <= world.time) continue;
      if (count === CAPACITY) break;
      const age = THREE.MathUtils.clamp(1 - (p.expiresAt - world.time) / p.maxLife, 0, 1);
      const seed = ((p.id * 0.61803398875) % 1) * Math.PI * 2;
      const curl = Math.sin(age * 9 + seed) * age * 0.1;
      const speed = Math.hypot(p.vel.x, p.vel.y) || 1;
      dummy.position.set(
        p.pos.x - (p.vel.y / speed) * curl,
        0.55 + age * age * (0.3 + p.maxLife * 0.55),
        -p.pos.y - (p.vel.x / speed) * curl,
      );
      // Align the long axis with travel as seen by the camera. Buoyancy turns
      // older tongues upward while their simulation reach stays unchanged.
      direction.set(p.vel.x, age * 2.4, -p.vel.y).applyQuaternion(cameraInverse);
      dummy.quaternion.copy(camera.quaternion);
      dummy.rotateZ(Math.atan2(direction.y, direction.x) - Math.PI / 2);
      const grow = Math.min(1, age / 0.22);
      const size = (0.11 + grow * 0.25) * (0.85 + Math.sin(seed) * 0.15);
      dummy.scale.set(size * (0.65 + age * 0.65), size * (1.65 - age * 0.35), 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(count, dummy.matrix);
      data[count * 3] = age;
      data[count * 3 + 1] = seed;
      data[count * 3 + 2] = p.maxLife > 0.6 ? 0.18 : 0;
      count++;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.attributes.flameState.needsUpdate = true;
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
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
};
