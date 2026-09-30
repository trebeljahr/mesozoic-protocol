import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useGame } from "../store";

const MAX_WAVES = 16;
const vertexShader = /* glsl */ `
  attribute vec3 waveState;
  varying vec2 ground;
  varying vec3 wave;
  varying vec2 crystalOrigin;
  void main() {
    // Explicit data stays valid even before the first wave is emitted.
    wave = waveState;
    ground = position.xy * wave.y;
    crystalOrigin = instanceMatrix[3].xz;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const fragmentShader = /* glsl */ `
  varying vec2 ground;
  varying vec3 wave;
  varying vec2 crystalOrigin;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float segment(vec2 p, vec2 a, vec2 b) {
    vec2 v = b - a;
    return length(p - a - v * clamp(dot(p - a, v) / dot(v, v), 0.0, 1.0));
  }
  void main() {
    float radius = length(ground);
    float behind = wave.x * wave.y - radius;
    // Fixed ground coordinates: crystals grow in place as the attack passes,
    // then thaw behind it. Nothing slides or scales across the floor.
    float band = smoothstep(0.0, 0.13, behind) * (1.0 - smoothstep(0.25, 1.05, behind));
    if (band <= 0.001 || radius > wave.y) discard;
    vec2 cell = floor(ground / 0.58);
    vec2 p = fract(ground / 0.58) - 0.5;
    vec2 key = cell + crystalOrigin * 3.17;
    float seed = hash(key);
    p -= vec2(hash(key + 3.0) - 0.5, hash(key + 7.0) - 0.5) * 0.30;
    float angle = atan(p.y, p.x) + seed * 6.283185;
    // Fold six arms into one dendrite, with paired fern-like side branches.
    float sector = mod(angle + 0.523599, 1.047198) - 0.523599;
    float armIndex = floor(mod(angle + 0.523599, 6.283185) / 1.047198);
    float armSeed = hash(key + armIndex * 13.7);
    vec2 q = length(p) * vec2(cos(sector), sin(sector));
    float growth = smoothstep(0.0, 0.20 + seed * 0.22, behind);
    // Keep each jittered footprint inside its cell, with small shards among
    // larger dendrites. Stable hashes avoid flickering as the wave advances.
    float arm = mix(0.10, 0.34, pow(hash(key + 19.0), 0.7))
      * mix(0.68, 1.0, armSeed) * growth;
    float d = segment(q, vec2(0.0), vec2(max(arm, 0.001), 0.0));
    for (int j = 1; j <= 3; j++) {
      if (float(j) > 1.0 + floor(hash(key + 29.0) * 3.0)) continue;
      float twigSeed = hash(key + float(j) * 23.0 + armIndex * 7.0);
      float t = float(j) * 0.21 + (twigSeed - 0.5) * 0.10;
      vec2 root = vec2(arm * t, 0.0);
      float twig = arm * (0.22 + twigSeed * 0.20 - t * 0.20);
      d = min(d, segment(vec2(q.x, abs(q.y)), root, root + vec2(twig * 0.65, twig)));
    }
    float aa = max(fwidth(d), 0.002);
    float thickness = mix(0.0025, 0.006, hash(key + 41.0));
    float crystal = 1.0 - smoothstep(thickness, thickness + aa, d);
    float frost = (1.0 - smoothstep(0.01, 0.065, d)) * 0.10;
    float alpha = (crystal * 0.42 + frost) * band * wave.z
      * mix(0.55, 1.0, hash(key + 53.0));
    // Sparse specular catches travel through the growing branches, leaving
    // the quiet ground-frost footprint intact rather than a glowing ring.
    float glint = pow(max(0.0, sin(behind * 9.0 + seed * 31.0)), 18.0)
      * step(0.72, seed) * crystal;
    gl_FragColor = vec4(mix(vec3(0.48, 0.72, 0.80), vec3(0.83, 0.94, 0.97), crystal)
      + glint * vec3(0.15, 0.20, 0.22), alpha + glint * band * wave.z * 0.2);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const CryoWaves = () => {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const data = useMemo(
    () => new THREE.InstancedBufferAttribute(new Float32Array(MAX_WAVES * 3), 3),
    [],
  );
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const { world } = useGame.getState();
    let count = 0;
    for (const wave of world.cryoWaves) {
      if (count === MAX_WAVES) break;
      const progress = THREE.MathUtils.clamp(
        1 - (wave.expiresAt - world.time) / wave.maxLife,
        0,
        1,
      );
      dummy.position.set(wave.pos.x, 0.045, -wave.pos.y);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(wave.maxRadius, wave.maxRadius, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(count, dummy.matrix);
      data.setXYZ(
        count,
        progress,
        wave.maxRadius,
        (1 - THREE.MathUtils.smoothstep(progress, 0.65, 1)) *
          THREE.MathUtils.smoothstep(progress, 0, 0.12),
      );
      count++;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    data.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, MAX_WAVES]}
      frustumCulled={false}
      renderOrder={2}
    >
      <planeGeometry args={[2, 2]}>
        <primitive object={data} attach="attributes-waveState" />
      </planeGeometry>
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
};
