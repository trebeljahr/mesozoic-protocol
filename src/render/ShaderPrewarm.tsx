// Mounts hidden clones of every tower/enemy/drone GLB at level start so
// the geometry/texture uploads land immediately, instead of stuttering
// on the first wave spawn or first tower placement.
//
// One GLB per frame: any single-tick gl.compile pass over a level-mount
// scene was running long enough to trip Chrome's WebGL context-loss
// watchdog (and a subtree-only compile would compile programs without
// the scene's lights and force a full recompile at first real render
// anyway). We now drop the explicit compile entirely — three.js
// compiles each program lazily the first time the corresponding mesh
// renders, and the PlayScene's own staggered mount (`<Defer>` groups
// in Scene.tsx) spreads that compile cost across multiple frames
// without piling it into a single watchdog-tripping tick.
import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import type * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { useGame } from "../store";

const PREWARM_URLS = [
  "/models/Velociraptor.glb",
  "/models/Trex.glb",
  "/models/Stegosaurus.glb",
  "/models/Triceratops.glb",
  "/models/Parasaurolophus.glb",
  "/models/Apatosaurus.glb",
  "/models/tower_pulse.glb",
  "/models/turrets/Lighting Turret.glb",
  "/models/turrets/Missile Turret.glb",
  "/models/turrets/Emp Turret.glb",
  "/models/turrets/Flamethrower Turret.glb",
  "/models/turrets/Hive Turret.glb",
  "/models/turrets/Plasma Turret.glb",
];

const PrewarmModel = ({ url }: { url: string }) => {
  const { scene } = useGLTF(url);
  // SkeletonUtils.clone handles both static and skinned meshes correctly —
  // skinned dinos need bone graph cloning or the clone renders as a T-pose
  // with no bones (which still compiles the shader, but a plain clone
  // would silently break the actual gameplay path that uses cloneSkinned).
  const cloned = useMemo(() => cloneSkinned(scene) as THREE.Object3D, [scene]);
  return <primitive object={cloned} />;
};

export const ShaderPrewarm = () => {
  const alreadyWarm = useGame((s) => s.assetsPrewarmed);
  const markWarm = useGame((s) => s.markAssetsPrewarmed);
  const [mountedCount, setMountedCount] = useState(alreadyWarm ? PREWARM_URLS.length : 0);
  const [done, setDone] = useState(alreadyWarm);

  // Step through the URL list one frame at a time. Each tick mounts the
  // next prewarm model; three.js then uploads geometry/textures + lazily
  // compiles materials when the cloned mesh renders for the first time.
  useEffect(() => {
    if (done) return;
    if (mountedCount === 0) {
      const id = requestAnimationFrame(() => setMountedCount(1));
      return () => cancelAnimationFrame(id);
    }
    if (mountedCount >= PREWARM_URLS.length) {
      const id = requestAnimationFrame(() => {
        markWarm();
        setDone(true);
      });
      return () => cancelAnimationFrame(id);
    }
    const id = requestAnimationFrame(() => setMountedCount((n) => n + 1));
    return () => cancelAnimationFrame(id);
  }, [mountedCount, done, markWarm]);

  if (done) return null;
  const visible = PREWARM_URLS.slice(0, mountedCount);
  return (
    <group position={[0, -1000, 0]}>
      {visible.map((url) => (
        <PrewarmModel key={url} url={url} />
      ))}
    </group>
  );
};
