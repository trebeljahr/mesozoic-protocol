import { ContactShadows, Environment, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { type ReactNode, Suspense, useMemo } from "react";
import * as THREE from "three";
import { ExpectedCanvasTeardown } from "../render/ExpectedCanvasTeardown";
import { measureVisibleBox } from "../render/measureModel";

type DecorSpec = {
  url: string;
  // Position offset relative to span: actual world pos = [rx*span, 0, rz*span]
  rx: number;
  rz: number;
  rotY: number;
  // Target on-screen size in world units. Scale gets computed against the
  // model's bounding box so e.g. Grass and Tree end up comparable even
  // though their authored sizes differ wildly.
  targetSize: number;
};

const DECOR: DecorSpec[] = [
  // Back row — taller trees behind the focal subject.
  { url: "/models/nature/Tree2.glb", rx: -1.5, rz: -1.6, rotY: 0.3, targetSize: 2.4 },
  { url: "/models/nature/Tree1.glb", rx: 1.6, rz: -1.7, rotY: -0.4, targetSize: 2.1 },
  { url: "/models/nature/Tree4.glb", rx: 0.0, rz: -2.0, rotY: 1.2, targetSize: 1.9 },
  // Side rocks.
  { url: "/models/nature/Rock1.glb", rx: -1.8, rz: 0.4, rotY: 0.6, targetSize: 0.85 },
  { url: "/models/nature/Rock2.glb", rx: 1.7, rz: 0.6, rotY: -0.9, targetSize: 0.7 },
  { url: "/models/nature/Rock3.glb", rx: 1.0, rz: 1.5, rotY: 1.4, targetSize: 0.6 },
  // Front grass tufts — low decor so they don't compete with silhouette.
  { url: "/models/nature/Grass1.glb", rx: -0.6, rz: 1.4, rotY: 0.0, targetSize: 0.45 },
  { url: "/models/nature/Grass2.glb", rx: 0.5, rz: 1.6, rotY: 0.8, targetSize: 0.4 },
  { url: "/models/nature/Grass3.glb", rx: -1.2, rz: 1.0, rotY: -0.5, targetSize: 0.42 },
  { url: "/models/nature/Grass1.glb", rx: 1.3, rz: -0.4, rotY: 1.7, targetSize: 0.4 },
];

// Preload so opening the compendium doesn't pop in trees frame-by-frame.
useGLTF.preload("/models/nature/Tree1.glb");
useGLTF.preload("/models/nature/Tree2.glb");
useGLTF.preload("/models/nature/Tree4.glb");
useGLTF.preload("/models/nature/Rock1.glb");
useGLTF.preload("/models/nature/Rock2.glb");
useGLTF.preload("/models/nature/Rock3.glb");
useGLTF.preload("/models/nature/Grass1.glb");
useGLTF.preload("/models/nature/Grass2.glb");
useGLTF.preload("/models/nature/Grass3.glb");

// Static (non-skinned) GLB renderer. Measures bbox + applies uniform
// scale to hit `targetSize`, then ground-aligns so box.min.y lands at 0.
// Use this for towers, props, anything that doesn't need bone animation.
export const StaticModel = ({
  url,
  targetSize,
  rotY = 0,
  position = [0, 0, 0],
  finish,
}: {
  url: string;
  targetSize: number;
  rotY?: number;
  position?: [number, number, number];
  // Optional PBR override (see TOWER_FINISH in render/towerTints). Supplied
  // so a subject whose in-game materials are re-finished doesn't read
  // glossier in the compendium than it does on the board. Materials are
  // cloned first — the GLTF cache hands every consumer the same references.
  finish?: { metalness: number; roughness: number };
}) => {
  const gltf = useGLTF(url);
  const obj = useMemo(() => {
    const cloned = gltf.scene.clone(true);
    const box = measureVisibleBox(cloned);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const s = targetSize / maxDim;
    cloned.scale.setScalar(s);
    const center = box.getCenter(new THREE.Vector3());
    cloned.position.set(-center.x * s, -box.min.y * s, -center.z * s);
    cloned.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      if (!finish) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      m.material = mats.map((raw) => {
        const mat = (raw as THREE.MeshStandardMaterial).clone();
        mat.metalness = finish.metalness;
        mat.roughness = finish.roughness;
        mat.needsUpdate = true;
        return mat;
      });
      if (!Array.isArray(m.material)) return;
      if (m.material.length === 1) m.material = m.material[0];
    });
    return cloned;
  }, [gltf.scene, targetSize, finish]);
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <primitive object={obj} />
    </group>
  );
};

const Prop = ({ spec, span }: { spec: DecorSpec; span: number }) => (
  <StaticModel
    url={spec.url}
    targetSize={spec.targetSize}
    rotY={spec.rotY}
    position={[spec.rx * span, 0, spec.rz * span]}
  />
);

type DioramaProps = {
  // World-units focal radius — camera position, ground disc, and decor
  // placement all scale off this. For most subjects:
  //   span = targetSize + 0.4
  span: number;
  size?: number;
  // Focal model(s) — Creature, StaticModel, swarm pack, etc.
  children: ReactNode;
  className?: string;
  // Camera look-at height. Defaults to `span * 0.35`, which works for
  // roughly cube-shaped subjects (towers, raptor). Long-bodied dinos
  // (apato, apex) sit much lower than the long axis suggests — pass an
  // explicit height to keep the orbit centered on the body instead of
  // the empty space above it.
  targetY?: number;
  // Render a soft contact shadow underneath the focal subject. Use for
  // multi-instance previews (the swarm pack) where the directional-light
  // shadow on each tiny raptor body is too small to read at preview
  // resolution — the directional shadow still renders, this just adds a
  // visible grounding patch under each foot.
  contactShadows?: boolean;
};

// Shared compendium diorama: orbit camera with tilt-clamp, HDRI + 3-light
// rig matching PlayScene, ground disc sized to catch shadows, plus a
// nature-prop frame around the subject. Use via EnemyPreview /
// TowerDiorama / etc — anything that wants a "creature on a patch of
// forest floor" feel.
export const Diorama = ({
  span,
  size = 360,
  children,
  className = "diorama",
  targetY,
  contactShadows = false,
}: DioramaProps) => {
  const target: [number, number, number] = [0, targetY ?? span * 0.35, 0];
  return (
    <div className={className} style={{ width: size, height: size }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        frameloop="always"
        camera={{
          position: [span * 1.4, span * 0.8, span * 2.0],
          fov: 32,
          near: 0.1,
          far: 50,
        }}
      >
        <ExpectedCanvasTeardown />
        <color attach="background" args={["#3a4858"]} />

        {/* Matches PlayScene lighting so subjects don't look flat or dark. */}
        <Environment
          files="/hdri/rooitou_park_1k.hdr"
          background={false}
          environmentIntensity={0.6}
        />
        <ambientLight intensity={0.55} color="#eaf2ff" />
        <directionalLight
          position={[span * 1.6, span * 2.6, span * 1.2]}
          intensity={2.2}
          color="#fff4dc"
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-left={-span * 2.5}
          shadow-camera-right={span * 2.5}
          shadow-camera-top={span * 2.5}
          shadow-camera-bottom={-span * 2.5}
          shadow-bias={-0.0005}
        />
        <hemisphereLight args={["#bcd8ff", "#5a4a2a", 0.85]} />

        {/*
          Ground disc sized to catch shadows for any focal subject — span*2.5
          so a sweeping limb (or a wide turret base) doesn't push its shadow
          off the edge. Sat at y=-0.02 so it's always just *below* the
          bbox-computed foot level: some animations dip the mesh a hair
          below the bind pose and without this the subject looked like it
          was floating above the plane.
        */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
          <circleGeometry args={[span * 2.5, 56]} />
          <meshStandardMaterial color="#4a4438" roughness={0.98} metalness={0} />
        </mesh>
        {contactShadows && (
          <ContactShadows
            position={[0, -0.015, 0]}
            opacity={0.7}
            scale={span * 4}
            blur={2.2}
            far={span * 1.5}
            resolution={1024}
            color="#1a1410"
            frames={Infinity}
          />
        )}

        <Suspense fallback={null}>
          {children}
          {DECOR.map((spec, i) => (
            <Prop key={i} spec={spec} span={span} />
          ))}
        </Suspense>

        <OrbitControls
          makeDefault
          target={target}
          enablePan={false}
          enableZoom
          minDistance={span * 1.2}
          maxDistance={span * 4.5}
          minPolarAngle={Math.PI * 0.15}
          // Clamp at the horizontal plane so the orbit can't dip the
          // camera below ground and look up through the floor at the
          // subject. Tilt UP (smaller polar) stays free.
          maxPolarAngle={Math.PI * 0.5}
          autoRotate
          autoRotateSpeed={0.9}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>
    </div>
  );
};
