import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useGame } from "../store";

const MAX_WAVES = 16;
const vertexShader = /* glsl */ `
  varying vec2 ground;
  varying vec3 wave;
  void main() {
    // Instance color carries progress, range and opacity, not RGB.
    wave = instanceColor;
    ground = position.xy * wave.y;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const fragmentShader = /* glsl */ `
  varying vec2 ground;
  varying vec3 wave;
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
    float seed = hash(cell);
    p -= vec2(seed - 0.5, hash(cell + 7.0) - 0.5) * 0.16;
    float angle = atan(p.y, p.x) + seed * 6.283185;
    // Fold six arms into one dendrite, with paired fern-like side branches.
    float sector = mod(angle + 0.523599, 1.047198) - 0.523599;
    vec2 q = length(p) * vec2(cos(sector), sin(sector));
    float growth = smoothstep(0.0, 0.32, behind);
    float arm = (0.28 + seed * 0.13) * growth;
    float d = segment(q, vec2(0.0), vec2(max(arm, 0.001), 0.0));
    for (int j = 1; j <= 3; j++) {
      float t = float(j) * 0.22;
      vec2 root = vec2(arm * t, 0.0);
      float twig = arm * (0.30 - t * 0.20);
      d = min(d, segment(vec2(q.x, abs(q.y)), root, root + vec2(twig * 0.65, twig)));
    }
    float aa = max(fwidth(d), 0.002);
    float crystal = 1.0 - smoothstep(0.004, 0.004 + aa, d);
    float frost = (1.0 - smoothstep(0.01, 0.065, d)) * 0.10;
    float alpha = (crystal * 0.42 + frost) * band * wave.z;
    gl_FragColor = vec4(mix(vec3(0.48, 0.72, 0.80), vec3(0.83, 0.94, 0.97), crystal), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const CryoWaves = () => {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const data = useMemo(() => new THREE.Color(), []);
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
      data.setRGB(
        progress,
        wave.maxRadius,
        (1 - THREE.MathUtils.smoothstep(progress, 0.65, 1)) *
          THREE.MathUtils.smoothstep(progress, 0, 0.12),
      );
      mesh.setColorAt(count++, data);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, MAX_WAVES]}
      frustumCulled={false}
      renderOrder={2}
    >
      <planeGeometry args={[2, 2]} />
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
