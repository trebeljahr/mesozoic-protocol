// Idle-time GPU asset prewarm performed while the player is on the world
// map. Mounts hidden clones of every tower/enemy GLB into the shared
// Canvas/WebGL context so the drei useGLTF cache + the geometry/texture
// uploads land before the level click.
//
// Why here: WorldMapScene and PlayScene share the same Canvas, so any
// geometry/texture uploaded now stays resident on the GPU for the
// level mount. The useGLTF cache is also warmed as a side-effect (the
// GLBs are fetched + parsed if not already).
//
// We used to also call `gl.compile()` here to precompile shaders. That
// turned out to be the wrong move on this map: the world map's own
// scene already carries 50+ LevelNodes, BiomeGround, BiomeProps, and
// the WorldMapOutposts, and any compile pass that walks the scene to
// pick up correct lights ends up touching all of them. On a busy
// worldmap the resulting RAF tick was running ~245ms and tripping
// Chrome's WebGL context-loss watchdog on the world map ITSELF —
// before the player ever clicked a level. The prewarm meshes still
// mount and three.js compiles their programs lazily the first time
// they would render; with the play-scene's own staggered mount the
// per-frame compile cost stays bounded without the explicit pass.
//
// Scheduled via requestIdleCallback so the worldmap mount animation
// doesn't get clobbered by the asset-upload pass on slow devices.
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

// Eagerly queue downloads even before the React tree is ready — the
// drei cache de-dupes, so calling preload from multiple places (here +
// the module-top calls in ModelEnemyMesh / HQTurret / etc.) is safe.
for (const url of PREWARM_URLS) useGLTF.preload(url);

const PrewarmModel = ({ url }: { url: string }) => {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => cloneSkinned(scene) as THREE.Object3D, [scene]);
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
  const alreadyDone = useGame((s) => s.assetsPrewarmed);
  const markDone = useGame((s) => s.markAssetsPrewarmed);
  const [phase, setPhase] = useState<"wait" | "mount" | "done">(alreadyDone ? "done" : "wait");
  const [mountedCount, setMountedCount] = useState(0);

  useEffect(() => {
    if (alreadyDone || phase !== "wait") return;
    const id = scheduleIdle(() => setPhase("mount"));
    return () => cancelIdle(id);
  }, [alreadyDone, phase]);

  // Step the mount one GLB per frame so the geometry/texture uploads land
  // spread across N frames instead of in one RAF tick. Final tick marks
  // the player as warmed and unmounts the helper subtree.
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

  if (phase !== "mount") return null;
  const visible = PREWARM_URLS.slice(0, mountedCount);
  return (
    <group position={[0, -1000, 0]}>
      {visible.map((url) => (
        <PrewarmModel key={url} url={url} />
      ))}
    </group>
  );
};
