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
    for (let i = world.projectiles.length - 1; i >= 0 && count < capacity; i--) {
      const p = world.projectiles[i];
      if (!p.ballistic) continue;
      const a = p.ballistic.tail,
        b = p.pos;
      direction.set(b.x - a.x, p.ballistic.height - p.ballistic.tailHeight, a.y - b.y);
      const length = Math.min(0.85, direction.length());
      if (length < 0.001) continue;
      direction.normalize();
      across.crossVectors(direction, view).normalize();
      normal.crossVectors(direction, across).normalize();
      position.set(b.x, p.ballistic.height, -b.y).addScaledVector(direction, -length / 2);
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
          // MSAA edge fragments can extrapolate UVs outside the quad. A
          // fractional power of negative X produces NaN, which bloom spreads
          // across the frame. Keep both power inputs in their valid domain.
          float along = clamp(vUv.x, 0.0, 1.0);
          float width = mix(0.08, 0.48, pow(along, 0.7));
          float body = 1.0 - smoothstep(width * 0.4, width, abs(vUv.y - 0.5));
          float tip = 1.0 - smoothstep(0.88, 1.0, vUv.x);
          float alpha = body * tip * pow(along, 0.65) * softParticleFade(0.12);
          vec3 color = mix(vec3(0.85, 0.25, 0.035), vec3(1.7, 1.35, 0.8), smoothstep(0.5, 0.87, vUv.x));
          gl_FragColor = vec4(color, alpha);
          #include <colorspace_fragment>
        }`}
      />
    </instancedMesh>
  );
};
