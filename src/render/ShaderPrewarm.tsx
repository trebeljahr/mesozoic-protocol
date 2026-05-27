// Mounts hidden clones of every tower/enemy/drone GLB at level start so
// three.js compiles their shader programs and uploads geometry/textures
// to the GPU immediately, instead of stuttering on the first wave spawn
// or first tower placement (~50–450ms RAF spikes in the wild).
//
// One GLB per frame: the compile pass for the whole scene + all warm-up
// meshes used to land in a single tick (~1–3s on busy levels) and tripped
// Chrome's WebGL context-loss watchdog. Now we mount one prewarm model
// per frame and compile the local subtree it represents, so the work
// spreads across N frames at the cost of a slightly longer warmup.
import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
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

const PrewarmModel = ({
  url,
  registerRoot,
}: {
  url: string;
  registerRoot: (root: THREE.Object3D) => void;
}) => {
  const { scene } = useGLTF(url);
  // SkeletonUtils.clone handles both static and skinned meshes correctly —
  // skinned dinos need bone graph cloning or the clone renders as a T-pose
  // with no bones (which still compiles the shader, but a plain clone
  // would silently break the actual gameplay path that uses cloneSkinned).
  const cloned = useMemo(() => cloneSkinned(scene) as THREE.Object3D, [scene]);
  useEffect(() => {
    registerRoot(cloned);
  }, [cloned, registerRoot]);
  return <primitive object={cloned} />;
};

export const ShaderPrewarm = () => {
  const gl = useThree((s) => s.gl);
  const sceneRoot = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const alreadyWarm = useGame((s) => s.assetsPrewarmed);
  const markWarm = useGame((s) => s.markAssetsPrewarmed);
  const [mountedCount, setMountedCount] = useState(alreadyWarm ? PREWARM_URLS.length : 0);
  const [done, setDone] = useState(alreadyWarm);
  const compiledRef = useRef<Set<string>>(new Set());

  // Step through the URL list one frame at a time. Each tick mounts the
  // next prewarm model (which re-runs this effect via mountedCount); the
  // effect that registers the freshly mounted root then runs gl.compile
  // for that frame's incremental work.
  useEffect(() => {
    if (done) return;
    if (mountedCount === 0) {
      const id = requestAnimationFrame(() => setMountedCount(1));
      return () => cancelAnimationFrame(id);
    }
    if (mountedCount >= PREWARM_URLS.length) {
      // Final tick — leave the meshes mounted for one more frame so the
      // last subtree's compile lands, then unmount + mark warm.
      const id = requestAnimationFrame(() => {
        markWarm();
        setDone(true);
      });
      return () => cancelAnimationFrame(id);
    }
    const id = requestAnimationFrame(() => setMountedCount((n) => n + 1));
    return () => cancelAnimationFrame(id);
  }, [mountedCount, done, markWarm]);

  // Compile the WHOLE scene each tick, but only at the point where a new
  // prewarm GLB has just been added. three.js's program cache makes the
  // call no-op for materials whose program is already built, so the per-
  // frame compile cost is bounded to the new GLB's materials. Passing
  // the full sceneRoot (not just the prewarm subtree) is critical: the
  // compile pass derives light-count uniforms from `scene`'s lights, and
  // if we compile against a light-less subtree, three.js compiles
  // programs without lights and then has to RECOMPILE them when the
  // real meshes render under the scene's directional/hemi/ambient lights
  // — which lands the full compile cost in one tick anyway and trips
  // Chrome's WebGL context-loss watchdog (the symptom this whole pass
  // was meant to prevent).
  const registerRoot = useMemo(
    () => (root: THREE.Object3D) => {
      const key = root.uuid;
      if (compiledRef.current.has(key)) return;
      compiledRef.current.add(key);
      const t0 = performance.now();
      gl.compile(sceneRoot, camera);
      const dt = performance.now() - t0;
      if (dt > 60) {
        // Surface any prewarm tick that lands a long compile burst — that
        // would be the watchdog-tripping budget if it slipped past the
        // chunking limit.
        console.warn(`[prewarm] tick gl.compile=${dt.toFixed(0)}ms`);
      }
    },
    [gl, sceneRoot, camera],
  );

  if (done) return null;
  const visible = PREWARM_URLS.slice(0, mountedCount);
  return (
    <group position={[0, -1000, 0]}>
      {visible.map((url) => (
        <PrewarmModel key={url} url={url} registerRoot={registerRoot} />
      ))}
    </group>
  );
};
