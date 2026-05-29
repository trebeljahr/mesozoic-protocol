import { useGLTF } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ExpectedCanvasTeardown } from "../render/ExpectedCanvasTeardown";
import { measureVisibleBox } from "../render/measureModel";
import type { RobotVariant } from "../sim/types";

const ROBOT_URL: Record<RobotVariant, string> = {
  george: "/models/robots/George.glb",
  leela: "/models/robots/Leela.glb",
  mike: "/models/robots/Mike.glb",
  stan: "/models/robots/Stan.glb",
};

const TARGET_SIZE = 1.35;

const RobotPilotMesh = ({ variant }: { variant: RobotVariant }) => {
  const url = ROBOT_URL[variant];
  const { scene, animations } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  const { norm, scaledMinY, centerXZ } = useMemo(() => {
    const box = measureVisibleBox(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const s = TARGET_SIZE / maxDim;
    return {
      norm: s,
      scaledMinY: box.min.y * s,
      centerXZ: { x: center.x * s, z: center.z * s },
    };
  }, [scene]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: norm is derived
  useEffect(() => {
    const parent = groupRef.current;
    if (!parent) return;
    const obj = cloneSkinned(scene);
    obj.scale.setScalar(norm);
    obj.position.set(-centerXZ.x, -scaledMinY, -centerXZ.z);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = false;
      }
    });
    const mixer = new THREE.AnimationMixer(obj);
    const idle =
      animations.find((c) => c.name.toLowerCase().includes("idle")) ?? animations[0] ?? null;
    if (idle) mixer.clipAction(idle).reset().play();
    mixerRef.current = mixer;
    parent.add(obj);
    return () => {
      mixer.stopAllAction();
      parent.remove(obj);
      mixerRef.current = null;
    };
  }, [scene, animations, norm, centerXZ.x, centerXZ.z, scaledMinY]);

  useFrame((_, dt) => {
    mixerRef.current?.update(dt);
    if (groupRef.current) {
      groupRef.current.rotation.y += dt * 0.35;
    }
  });

  return <group ref={groupRef} />;
};

// Circular platform under the robot — gives the diorama a "stage"
// floor so the robot isn't floating in negative space. Subtle gradient
// + radial fade matches the dark cockpit-room aesthetic of the modals.
const Platform = () => {
  return (
    <group position={[0, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[1.6, 64]} />
        <meshStandardMaterial color="#1a2638" roughness={0.85} metalness={0.15} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <ringGeometry args={[1.5, 1.6, 64]} />
        <meshBasicMaterial color="#5ad6ff" transparent opacity={0.45} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <ringGeometry args={[1.15, 1.18, 64]} />
        <meshBasicMaterial color="#5ad6ff" transparent opacity={0.22} />
      </mesh>
    </group>
  );
};

// Full-sized 3D viewer for the robot detail page. Square aspect with a
// circular platform, soft fog, and a fitted camera that frames the
// entire pilot. Auto-rotates so the player can see all sides.
export const RobotDiorama = ({ variant }: { variant: RobotVariant }) => {
  return (
    <Canvas
      className="robot-diorama-canvas"
      shadows
      camera={{ position: [3.2, 2.1, 3.2], fov: 40 }}
      onCreated={({ camera }) => {
        camera.lookAt(0, 0.65, 0);
        camera.updateProjectionMatrix();
      }}
      gl={{ antialias: true, alpha: true }}
      style={{ pointerEvents: "none" }}
    >
      <ExpectedCanvasTeardown />
      <fog attach="fog" args={["#0a1220", 6, 14]} />
      <ambientLight intensity={0.55} color="#eaf2ff" />
      <directionalLight
        position={[3.5, 5, 3]}
        intensity={1.4}
        color="#fff4dc"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-3, 2, -2]} intensity={0.55} color="#9fd8ff" />
      <pointLight position={[0, 0.6, 0]} intensity={0.4} color="#5ad6ff" distance={4} />
      <Suspense fallback={null}>
        <Platform />
        <group position={[0, 0.01, 0]}>
          <RobotPilotMesh variant={variant} />
        </group>
      </Suspense>
    </Canvas>
  );
};
