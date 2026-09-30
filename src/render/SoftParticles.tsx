import { useFrame } from "@react-three/fiber";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from "react";
import * as THREE from "three";
import { FlameSceneDepth } from "./FlameSceneDepth";

const DepthContext = createContext<FlameSceneDepth | null>(null);

export const SoftParticles = ({ children }: { children: ReactNode }) => {
  const depth = useMemo(() => new FlameSceneDepth(), []);
  useFrame(() => {
    depth.ready = false;
  });
  useEffect(() => () => depth.dispose(), [depth]);
  return <DepthContext.Provider value={depth}>{children}</DepthContext.Provider>;
};

export const softParticleShader = `
uniform sampler2D sceneDepth;
uniform vec2 viewportSize;
uniform vec2 cameraRange;
uniform float orthographic;
uniform float depthReady;
#include <packing>
float viewDistance(float depth) {
  return orthographic > 0.5
    ? -orthographicDepthToViewZ(depth, cameraRange.x, cameraRange.y)
    : -perspectiveDepthToViewZ(depth, cameraRange.x, cameraRange.y);
}
float softParticleFade(float distance) {
  if (depthReady < 0.5) return 1.0;
  float surface = viewDistance(texture2D(sceneDepth, gl_FragCoord.xy / viewportSize).r);
  return smoothstep(0.0, distance, surface - viewDistance(gl_FragCoord.z));
}`;

export const useSoftParticles = () => {
  const depth = useContext(DepthContext);
  const uniforms = useMemo(
    () => ({
      sceneDepth: { value: null as THREE.Texture | null },
      viewportSize: { value: new THREE.Vector2(1, 1) },
      cameraRange: { value: new THREE.Vector2(0.1, 1000) },
      orthographic: { value: 1 },
      depthReady: { value: 0 },
    }),
    [],
  );
  const beforeRender = useCallback<THREE.Object3D["onBeforeRender"]>(
    function (this: THREE.InstancedMesh, renderer, scene, camera, _geometry, material) {
      if (this.count === 0 || scene.overrideMaterial || !(material instanceof THREE.ShaderMaterial))
        return;
      // The first active batch copies opaque depth; every other batch and the
      // selective bloom pass reuse it. Never capture the layer-filtered pass.
      if (depth && camera.layers.isEnabled(0) && !depth.ready) depth.capture(renderer);
      uniforms.sceneDepth.value = depth?.target?.depthTexture ?? null;
      uniforms.depthReady.value = depth?.ready ? 1 : 0;
      const target = renderer.getRenderTarget();
      if (target) uniforms.viewportSize.value.set(target.width, target.height);
      else renderer.getDrawingBufferSize(uniforms.viewportSize.value);
      const projectionCamera = camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
      uniforms.cameraRange.value.set(projectionCamera.near, projectionCamera.far);
      uniforms.orthographic.value = "isOrthographicCamera" in camera ? 1 : 0;
    },
    [depth, uniforms],
  );
  return { uniforms, beforeRender };
};
