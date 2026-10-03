import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { getGraphicsQuality } from "./effectsTunables";

const SMOKE_SLOTS = ["one", "two", "three", "four", "five", "six", "seven"];

const scorchVertex = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const scorchFragment = `varying vec2 vUv;
void main(){vec2 p=vUv*2.0-1.0;
float edge=length(p)+sin(p.x*17.0+sin(p.y*23.0))*0.065;
float ash=0.65+sin(p.x*41.0+p.y*27.0)*0.1;
gl_FragColor=vec4(vec3(0.055,0.049,0.039), (1.0-smoothstep(0.25,1.0,edge))*ash);}`;

export const ScorchMark = ({
  position,
  rotation = [-Math.PI / 2, 0, 0],
  size = [2.6, 2.1],
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  size?: [number, number];
}) => (
  <mesh position={position} rotation={rotation} raycast={() => {}}>
    <planeGeometry args={size} />
    <shaderMaterial
      vertexShader={scorchVertex}
      fragmentShader={scorchFragment}
      transparent
      depthWrite={false}
      polygonOffset
      polygonOffsetFactor={-1}
    />
  </mesh>
);

const flameVertex = `varying vec2 vUv; void main(){vUv=uv; vec4 p=modelViewMatrix*vec4(0,0,0,1); p.xy+=position.xy; gl_Position=projectionMatrix*p;}`;
const flameFragment = `uniform float time; varying vec2 vUv;
void main(){
 vec2 p=vec2(vUv.x*2.0-1.0,vUv.y);
 float flutter=sin(p.y*16.0-time*7.0)*0.1+sin(p.y*31.0+time*11.0)*0.055;
 float width=(1.0-p.y)*0.6;
 float body=1.0-smoothstep(width*0.15,width+0.06,abs(p.x+flutter*p.y));
 float tongues=0.75+sin(p.x*13.0+p.y*9.0-time*5.0)*0.25;
 float alpha=body*smoothstep(0.0,0.12,p.y)*(1.0-smoothstep(0.55,1.0,p.y))*tongues;
 vec3 color=mix(vec3(1.0,0.11,0.005),vec3(1.0,0.74,0.12),body*(1.0-p.y));
 gl_FragColor=vec4(color*1.65,alpha*0.9);
}`;

// Bounded ambience at damaged structures; no simulation particles or dynamic lights.
export const BattleDamage = ({
  position,
  seed = 1,
}: {
  position: [number, number, number];
  seed?: number;
}) => {
  const texture = useTexture("/textures/fx/whitepuff15.png");
  const count = getGraphicsQuality() === "low" ? 4 : 7;
  const smoke = useRef<(THREE.Sprite | null)[]>([]);
  const uniforms = useMemo(() => ({ time: { value: seed } }), [seed]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    uniforms.time.value = t + seed;
    for (let i = 0; i < count; i++) {
      const sprite = smoke.current[i];
      if (!sprite) continue;
      const age = (t * 0.16 + i / count + seed * 0.13) % 1;
      sprite.position.set(
        age * 0.7 + Math.sin(i * 2.1 + t * 0.6) * 0.09,
        0.55 + age * 3.4,
        age * 0.18,
      );
      const scale = 0.55 + age * 1.45;
      sprite.scale.set(scale, scale, 1);
      const mat = sprite.material as THREE.SpriteMaterial;
      mat.opacity = Math.sin(age * Math.PI) * 0.39;
      mat.rotation = i * 1.7 + t * 0.035;
    }
  });
  return (
    <group position={position}>
      <ScorchMark position={[0, 0.018, 0]} />
      {[-0.65, 0.28, 0.65].map((x, i) => (
        <mesh
          key={x}
          position={[x, 0.11, Math.sin(i * 3 + seed) * 0.38]}
          rotation={[0.12 + i * 0.15, i * 0.8, 0.18 - i * 0.19]}
          castShadow
          receiveShadow
          raycast={() => {}}
        >
          <boxGeometry args={[0.6, 0.12, 0.35 + i * 0.1]} />
          <meshStandardMaterial color={i === 1 ? "#655444" : "#3d4240"} roughness={0.98} />
        </mesh>
      ))}
      <mesh position={[0, 0.62, 0]} raycast={() => {}}>
        <planeGeometry args={[0.8, 1.4]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={flameVertex}
          fragmentShader={flameFragment}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      {SMOKE_SLOTS.slice(0, count).map((id, i) => (
        <sprite
          key={id}
          ref={(el) => {
            smoke.current[i] = el;
          }}
          raycast={() => {}}
        >
          <spriteMaterial
            map={texture}
            color="#4a4944"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
      ))}
    </group>
  );
};
