import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { DRACO_DECODER_PATH } from "../dracoSetup";

// Shared "render a 3D model to a PNG once, then serve as <img>" plumbing
// used by every UI surface that wants a model thumbnail (EnemyIcon,
// TowerIcon, …). The trick is that one r3f Canvas per icon blows past
// the browser's WebGL-context cap as soon as a tab strip / picker shows
// many of them at once (8 enemies in the Compendium, 6 towers in the
// HUD picker, etc.). Instead we keep a single offscreen WebGLRenderer
// and a sequential bake queue: each unique cacheKey is rendered exactly
// once and the resulting data URL is shared by every consumer of the
// `useBakedIcon` hook.

const ICON_RES = 256;

// === GLTF cache (with DRACO) ================================================

const sceneCache = new Map<string, THREE.Object3D>();
let loader: GLTFLoader | null = null;

const getLoader = (): GLTFLoader => {
  if (loader) return loader;
  loader = new GLTFLoader();
  // Most of the shipped game assets use Draco mesh compression; without
  // a DRACOLoader the parse fails. Drei's useGLTF wires this up by
  // default — we mirror it, pointing at the same vendored decoder (see
  // src/dracoSetup.ts) rather than Google's CDN so icon bakes work offline.
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_DECODER_PATH);
  loader.setDRACOLoader(draco);
  return loader;
};

const loadGLTFScene = async (url: string): Promise<THREE.Object3D> => {
  const cached = sceneCache.get(url);
  if (cached) return cached;
  const gltf = await getLoader().loadAsync(url.includes(" ") ? encodeURI(url) : url);
  sceneCache.set(url, gltf.scene);
  return gltf.scene;
};

// === Shared offscreen renderer ===============================================

let sharedRenderer: THREE.WebGLRenderer | null = null;
const getRenderer = (): THREE.WebGLRenderer => {
  if (sharedRenderer) return sharedRenderer;
  const canvas = document.createElement("canvas");
  canvas.width = ICON_RES;
  canvas.height = ICON_RES;
  sharedRenderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  sharedRenderer.setPixelRatio(1);
  sharedRenderer.setSize(ICON_RES, ICON_RES, false);
  sharedRenderer.outputColorSpace = THREE.SRGBColorSpace;
  return sharedRenderer;
};

// === Bake spec & default scene composition ==================================

export type BakeSpec = {
  /** Stable cache key — usually the kind name. */
  cacheKey: string;
  /** Path to the GLB. */
  modelUrl: string;
  /** True for rigged characters (uses SkeletonUtils.clone). False for static props. */
  skinned?: boolean;
  /** Camera position relative to a 1×1×1 normalized model. */
  camera: {
    position: [number, number, number];
    target?: [number, number, number];
    fov?: number;
  };
  /** Optional Y rotation to flip native-facing models so they all face the same way. */
  rotY?: number;
  /**
   * Optional list of duplicate placements. When omitted, one centred copy
   * is drawn (matches the single-model behaviour). Each entry's `scale`
   * is multiplied into the 1×1×1 normalization, so 0.5 = half a unit cube.
   * Offsets are applied after normalization; +X is toward the camera,
   * Y=0 is the ground plane the model rests on.
   */
  instances?: Array<{
    offset?: [number, number, number];
    rotY?: number;
    scale?: number;
  }>;
  /**
   * Optional permanent body tint applied before rendering. Materials are
   * cloned so this doesn't leak into other bakes. `amount` is a 0..1 lerp
   * from the base colour toward `color`, mirroring the in-game matriarch
   * tint pass. Emissive sets a rim glow in the same colour.
   */
  tint?: {
    color: string;
    amount: number;
    emissive: number;
  };
};

const defaultLights = (scene: THREE.Scene) => {
  scene.add(new THREE.AmbientLight(0xeaf2ff, 0.9));
  const key = new THREE.DirectionalLight(0xfff4dc, 2.2);
  key.position.set(6, 8, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbcd8ff, 0.85);
  fill.position.set(-4, 4, -2);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight(0xbcd8ff, 0x5a4a2a, 0.95));
};

const renderSpec = async (spec: BakeSpec): Promise<string> => {
  const sceneSrc = await loadGLTFScene(spec.modelUrl);

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.rotation.y = spec.rotY ?? 0;
  scene.add(root);

  const instances = spec.instances ?? [{}];
  const disposables: THREE.Object3D[] = [];
  for (const inst of instances) {
    const cloned = spec.skinned ? cloneSkinned(sceneSrc) : sceneSrc.clone(true);
    cloned.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const s = (1 / maxDim) * (inst.scale ?? 1);
    cloned.scale.setScalar(s);
    cloned.position.set(-center.x * s, -box.min.y * s, -center.z * s);
    // Drop shadows for the static bake; the depth pre-pass costs more
    // than it pays back at icon resolution.
    const tintColor = spec.tint ? new THREE.Color(spec.tint.color) : null;
    cloned.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = false;
        m.receiveShadow = false;
        // Matriarch icons get a permanent body tint so the compendium
        // tab thumbnail distinguishes the queen from her base species.
        // Materials are cloned so the tint doesn't leak across bakes
        // that share the same source GLB.
        if (tintColor && spec.tint && m.material) {
          const tintMat = (mm: THREE.Material) => {
            const c = mm.clone();
            const std = c as THREE.MeshStandardMaterial;
            if (std.color) std.color.lerp(tintColor, spec.tint!.amount);
            if (std.emissive) std.emissive.copy(tintColor).multiplyScalar(spec.tint!.emissive);
            return c;
          };
          if (Array.isArray(m.material)) {
            m.material = m.material.map(tintMat);
          } else {
            m.material = tintMat(m.material as THREE.Material);
          }
        }
      }
    });

    const wrap = new THREE.Group();
    wrap.add(cloned);
    const [ox, oy, oz] = inst.offset ?? [0, 0, 0];
    wrap.position.set(ox, oy, oz);
    wrap.rotation.y = inst.rotY ?? 0;
    root.add(wrap);
    disposables.push(cloned);
  }

  defaultLights(scene);

  const camera = new THREE.PerspectiveCamera(spec.camera.fov ?? 30, 1, 0.1, 50);
  camera.position.set(...spec.camera.position);
  const target = spec.camera.target ?? [0, 0, 0];
  camera.lookAt(target[0], target[1], target[2]);

  const renderer = getRenderer();
  // Two passes: PBR materials sometimes defer shader compile to the
  // first draw, so the first frame can come back with a flat fallback.
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");

  // Drop the throw-away clones' GPU resources. The original gltf scene
  // stays in sceneCache so future re-bakes (e.g. dev HMR) skip the
  // network fetch.
  for (const obj of disposables) {
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
    });
  }
  return url;
};

// === Cache + queue ==========================================================

const cache = new Map<string, string>();
const subscribers = new Set<() => void>();
const notify = () => {
  for (const cb of subscribers) cb();
};

let bakeQueue: Promise<unknown> = Promise.resolve();
const inflight = new Set<string>();

const requestBake = (spec: BakeSpec) => {
  const k = spec.cacheKey;
  if (cache.has(k) || inflight.has(k)) return;
  inflight.add(k);
  const p = bakeQueue
    .catch(() => {})
    .then(() => renderSpec(spec))
    .then((url) => {
      cache.set(k, url);
      inflight.delete(k);
      notify();
    })
    .catch((err) => {
      console.error(`[bakedIcon] Failed to bake ${k}`, err);
      inflight.delete(k);
    });
  bakeQueue = p;
};

// === Public hook ============================================================

/**
 * Kick off (or no-op) the bake for `spec` without mounting a consumer.
 * Used to prewarm icons that will appear in a lazy panel (e.g. the
 * mobile build menu) so the first open doesn't flash empty placeholders
 * while the offscreen renderer chews through six unique tower models.
 */
export const prewarmIcon = (spec: BakeSpec): void => {
  requestBake(spec);
};

/**
 * Returns the cached PNG data URL for `spec`, kicking off a one-shot
 * offscreen render on first call. Returns null while the bake is in
 * flight; the component re-renders once the URL is ready.
 */
export const useBakedIcon = (spec: BakeSpec): string | null => {
  const key = spec.cacheKey;
  // Hold the latest spec in a ref so the effect can fire requestBake
  // with up-to-date framing on first mount, while still keying the
  // effect itself off the cacheKey only — re-rendering a parent
  // shouldn't re-trigger a bake that's already cached.
  const specRef = useRef(spec);
  specRef.current = spec;
  const [url, setUrl] = useState<string | null>(() => cache.get(key) ?? null);
  useEffect(() => {
    const cached = cache.get(key);
    if (cached) {
      setUrl(cached);
      return;
    }
    const update = () => {
      const u = cache.get(key);
      if (u) setUrl(u);
    };
    subscribers.add(update);
    requestBake(specRef.current);
    return () => {
      subscribers.delete(update);
    };
  }, [key]);
  return url;
};
