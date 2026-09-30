import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGame } from "../store";
import { BLOOM_LAYER, GRAPHICS_QUALITY } from "./effectsTunables";
import { softParticleShader, useSoftParticles } from "./SoftParticles";

// Short moving ribbons, inspired by the rifle's trailing bolts. Stan uses
// broad brass pellets with ivory tips, rather than cyan continuous trails.
export const BallisticTracers = () => {
  const capacity = GRAPHICS_QUALITY === "low" ? 96 : 192;
  const ref = useRef<THREE.InstancedMesh>(null);
  const soft = useSoftParticles();
  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      direction: new THREE.Vector3(),
      across: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      position: new THREE.Vector3(),
      view: new THREE.Vector3(),
      scale: new THREE.Vector3(),
    }),
    [],
  );
  useEffect(() => {
    ref.current?.layers.enable(BLOOM_LAYER);
    ref.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }, []);
  useFrame(({ camera }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const { world } = useGame.getState();
    const { matrix, direction, across, normal, position, view } = scratch;
    camera.getWorldDirection(view);
    let count = 0;
    for (let i = world.beams.length - 1; i >= 0 && count < capacity; i--) {
      const beam = world.beams[i];
      if (!beam.ballistic || beam.points.length !== 2) continue;
      const a = beam.points[0],
        b = beam.points[1];
      direction.set(b.x - a.x, (b.h ?? 0.85) - (a.h ?? 0.85), a.y - b.y);
      const distance = direction.length();
      if (distance < 0.001) continue;
      direction.divideScalar(distance);
      const age = world.time - beam.ballistic.spawnedAt - beam.ballistic.delay;
      const head = Math.min(distance, age * beam.ballistic.speed);
      const tail = Math.max(0, age * beam.ballistic.speed - 0.85);
      const length = head - tail;
      if (age < 0 || length <= 0) continue;
      across.crossVectors(direction, view).normalize();
      normal.crossVectors(direction, across).normalize();
      position.set(a.x, a.h ?? 0.85, -a.y).addScaledVector(direction, (head + tail) / 2);
      matrix.makeBasis(direction, across, normal);
      matrix.scale(scratch.scale.set(length, 0.095, 1));
      matrix.setPosition(position);
      mesh.setMatrixAt(count++, matrix);
    }
    mesh.count = count;
    if (count) mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, capacity]}
      frustumCulled={false}
      renderOrder={2}
      onBeforeRender={soft.beforeRender}
    >
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        uniforms={soft.uniforms}
        transparent
        depthTest
        depthWrite={false}
        toneMapped={false}
        blending={THREE.AdditiveBlending}
        vertexShader={`varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`}
        fragmentShader={`${softParticleShader}
        varying vec2 vUv;
        void main() {
          float width = mix(0.08, 0.48, pow(vUv.x, 0.7));
          float body = 1.0 - smoothstep(width * 0.4, width, abs(vUv.y - 0.5));
          float tip = 1.0 - smoothstep(0.88, 1.0, vUv.x);
          float alpha = body * tip * pow(vUv.x, 0.65) * softParticleFade(0.12);
          vec3 color = mix(vec3(0.85, 0.25, 0.035), vec3(1.7, 1.35, 0.8), smoothstep(0.5, 0.87, vUv.x));
          gl_FragColor = vec4(color, alpha);
          #include <colorspace_fragment>
        }`}
      />
    </instancedMesh>
  );
};
