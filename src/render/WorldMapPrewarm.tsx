// Idle-time GPU shader prewarm performed while the player is on the
// world map. Mounts hidden clones of every tower/enemy GLB into the
// shared Canvas/WebGL context, calls gl.compile(), then unmounts.
//
// Why here: WorldMapScene and PlayScene share the same Canvas, so any
// shader program compiled now is cached on the renderer and reused
// when the level scene mounts — eliminating the GPU compile stall
// that otherwise causes a black gap between level click and first
// playable frame. The drei useGLTF cache is also warmed as a
// side-effect (the GLBs are fetched + parsed if not already).
//
// Scheduled via requestIdleCallback so the worldmap mount animation
// doesn't get clobbered by the compile pass on slow devices.
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

// Eagerly queue downloads even before the React tree is ready — the
// drei cache de-dupes, so calling preload from multiple places (here +
// the module-top calls in ModelEnemyMesh / HQTurret / etc.) is safe.
for (const url of PREWARM_URLS) useGLTF.preload(url);

const PrewarmModel = ({
  url,
  registerRoot,
}: {
  url: string;
  registerRoot: (root: THREE.Object3D) => void;
}) => {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => cloneSkinned(scene) as THREE.Object3D, [scene]);
  useEffect(() => {
    registerRoot(cloned);
  }, [cloned, registerRoot]);
  return <primitive object={cloned} />;
};

type IdleHandle = number;
const scheduleIdle = (cb: () => void): IdleHandle => {
  const w = window as Window & {
    requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
  };
  if (typeof w.requestIdleCallback === "function") {
    return w.requestIdleCallback(() => cb(), { timeout: 2000 });
  }
  return window.setTimeout(cb, 400) as unknown as number;
};
const cancelIdle = (id: IdleHandle): void => {
  const w = window as Window & { cancelIdleCallback?: (id: number) => void };
  if (typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(id);
  else window.clearTimeout(id);
};

export const WorldMapPrewarm = () => {
  const gl = useThree((s) => s.gl);
  const sceneRoot = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const alreadyDone = useGame((s) => s.assetsPrewarmed);
  const markDone = useGame((s) => s.markAssetsPrewarmed);
  const [phase, setPhase] = useState<"wait" | "mount" | "done">(alreadyDone ? "done" : "wait");
  const [mountedCount, setMountedCount] = useState(0);
  const compiledRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (alreadyDone || phase !== "wait") return;
    const id = scheduleIdle(() => setPhase("mount"));
    return () => cancelIdle(id);
  }, [alreadyDone, phase]);

  // Chunk mount + compile across frames so the world-map intro
  // animation can't get stalled long enough for the WebGL context-loss
  // watchdog to trip. One GLB per frame; final tick marks the player as
  // warmed and unmounts the helper subtree.
  useEffect(() => {
    if (phase !== "mount") return;
    if (mountedCount === 0) {
      const id = requestAnimationFrame(() => setMountedCount(1));
      return () => cancelAnimationFrame(id);
    }
    if (mountedCount >= PREWARM_URLS.length) {
      const id = requestAnimationFrame(() => {
        markDone();
        setPhase("done");
      });
      return () => cancelAnimationFrame(id);
    }
    const id = requestAnimationFrame(() => setMountedCount((n) => n + 1));
    return () => cancelAnimationFrame(id);
  }, [phase, mountedCount, markDone]);

  // Compile the WHOLE scene each tick so light-count uniforms are baked
  // correctly into the prewarm programs (a subtree-only compile compiles
  // against zero lights and forces a recompile during real rendering).
  // three.js's program cache makes the per-tick cost bounded to the
  // newly-mounted GLB's materials.
  const registerRoot = useMemo(
    () => (root: THREE.Object3D) => {
      const key = root.uuid;
      if (compiledRef.current.has(key)) return;
      compiledRef.current.add(key);
      gl.compile(sceneRoot, camera);
    },
    [gl, sceneRoot, camera],
  );

  if (phase !== "mount") return null;
  const visible = PREWARM_URLS.slice(0, mountedCount);
  return (
    <group position={[0, -1000, 0]}>
      {visible.map((url) => (
        <PrewarmModel key={url} url={url} registerRoot={registerRoot} />
      ))}
    </group>
  );
};
