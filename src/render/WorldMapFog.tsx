import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useWorldMapEditor } from "../editor/worldMapEditorStore";
import { LEVELS } from "../levels";
import type { SlotId } from "../progress";
import { useGame } from "../store";
import { useMediaQuery } from "../ui/useMediaQuery";
import { initialDiscovery, type MapDiscovery, mapDiscovery } from "./worldMapDiscovery";
import { mapLevelPosition } from "./worldMapLayout";

// Only animation history; actual discovery is always derived from this save's
// stars. Slot separation and downward clamps prevent resets leaking old land.
const lastViewed = new Map<SlotId | null, MapDiscovery>();
const noRaycast: THREE.Mesh["raycast"] = () => {};

export const WorldMapFog = () => {
  const progress = useGame((s) => s.progress);
  const slot = useGame((s) => s.activeSlot);
  const editing = useWorldMapEditor((s) => s.active);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const target = useMemo(() => mapDiscovery(progress), [progress]);
  // WorldMapScene keys this component by slot. Material/uniforms persist across
  // star updates so reveal radii can interpolate without reallocating GPU data.
  // biome-ignore lint/correctness/useExhaustiveDependencies: target initializes per-slot animation, not material lifetime
  const material = useMemo(() => {
    const initial = initialDiscovery(target, lastViewed.get(slot));
    return new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uInverseProjection: { value: new THREE.Matrix4() },
        uCameraWorld: { value: new THREE.Matrix4() },
        uReveal: {
          value: LEVELS.map(
            (level, i) =>
              new THREE.Vector3(
                mapLevelPosition(level.id).x,
                mapLevelPosition(level.id).y,
                initial.radii[i],
              ),
          ),
        },
        uTime: { value: 0 },
        uCleared: { value: initial.complete ? 1 : 0 },
        uDark: { value: new THREE.Color("#17232c") },
        uLight: { value: new THREE.Color("#40515a") },
      },
      vertexShader: `
        uniform mat4 uInverseProjection, uCameraWorld;
        varying vec2 vGround;
        void main() {
          // Project each screen corner onto ground. This also covers tall props:
          // no tree crowns or water glow can poke through undiscovered terrain.
          vec4 a=uInverseProjection*vec4(position.xy,-1.0,1.0);
          vec4 b=uInverseProjection*vec4(position.xy,1.0,1.0);
          vec3 nearPoint=(uCameraWorld*vec4(a.xyz/a.w,1.0)).xyz;
          vec3 farPoint=(uCameraWorld*vec4(b.xyz/b.w,1.0)).xyz;
          vec3 ray=farPoint-nearPoint;
          vec3 ground=nearPoint-ray*(nearPoint.y/ray.y);
          vGround=vec2(ground.x,-ground.z);
          gl_Position=vec4(position.xy,0.0,1.0);
        }`,
      fragmentShader: `
        uniform vec3 uReveal[${LEVELS.length}];
        uniform float uTime, uCleared;
        uniform vec3 uDark, uLight;
        varying vec2 vGround;
        float hash(vec2 p) {return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p) {
          vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);
        }
        void main() {
          float cloud=noise(vGround*0.12+vec2(uTime*0.012,uTime*0.008))*0.7
            +noise(vGround*0.32-vec2(uTime*0.018,0.0))*0.3;
          float distanceToClear=10000.0;
          for(int i=0;i<${LEVELS.length};i++) {
            if(uReveal[i].z>0.01) {
              float d=length(vGround-uReveal[i].xy)-uReveal[i].z;
              float h=max(3.0-abs(distanceToClear-d),0.0)/3.0;
              distanceToClear=min(distanceToClear,d)-h*h*0.75;
            }
          }
          // Wide atmospheric falloff; a smooth union avoids scalloped seams
          // where neighboring discoveries meet.
          float opacity=smoothstep(-3.0,7.0,distanceToClear+(cloud-0.5)*3.0)*(1.0-uCleared);
          gl_FragColor=vec4(mix(uDark,uLight,cloud*0.72),opacity);
          #include <colorspace_fragment>
        }`,
    });
  }, [slot]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    lastViewed.set(slot, target);
  }, [slot, target]);
  useFrame((state, delta) => {
    material.uniforms.uInverseProjection.value.copy(state.camera.projectionMatrixInverse);
    material.uniforms.uCameraWorld.value.copy(state.camera.matrixWorld);
    if (!reducedMotion) material.uniforms.uTime.value += Math.min(delta, 0.1);
    const reveals = material.uniforms.uReveal.value as THREE.Vector3[];
    for (let i = 0; i < reveals.length; i++) {
      const radius = target.radii[i];
      reveals[i].z =
        reducedMotion || radius < reveals[i].z
          ? radius
          : THREE.MathUtils.damp(reveals[i].z, radius, 2.5, Math.min(delta, 0.1));
    }
    material.uniforms.uCleared.value = !target.complete
      ? 0
      : reducedMotion
        ? 1
        : THREE.MathUtils.damp(material.uniforms.uCleared.value, 1, 2.5, Math.min(delta, 0.1));
  });
  // The editor needs the whole landscape for placement and erasure.
  if (editing) return null;
  return (
    <mesh frustumCulled={false} renderOrder={10000} raycast={noRaycast} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
};
