import { useThree } from "@react-three/fiber";
import {
  BrightnessContrast,
  GodRays,
  HueSaturation,
  Outline,
  SelectiveBloom,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction, Effect } from "postprocessing";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";
import { BIOME_PAINTED, type Biome } from "../biomes";
import { useGame } from "../store";
import {
  BLOOM_INTENSITY,
  BLOOM_KERNEL,
  BLOOM_LAYER,
  BLOOM_SMOOTHING,
  BLOOM_THRESHOLD,
  GODRAYS_DECAY,
  GODRAYS_DENSITY,
  GODRAYS_EXPOSURE,
  GODRAYS_KERNEL,
  GODRAYS_MAX_DRAWING_BUFFER_PIXELS,
  GODRAYS_RESOLUTION_SCALE,
  GODRAYS_SAMPLES,
  GODRAYS_WEIGHT,
  GRADE_BRIGHTNESS,
  GRADE_CONTRAST,
  GRADE_HUE,
  GRADE_SATURATION,
  GRAPHICS_QUALITY,
  OUTLINE_BLUR,
  OUTLINE_EDGE_STRENGTH,
  OUTLINE_HIDDEN_COLOR,
  OUTLINE_KERNEL,
  OUTLINE_LAYER,
  OUTLINE_MAX_DRAWING_BUFFER_PIXELS,
  OUTLINE_RESOLUTION_SCALE,
  OUTLINE_VISIBLE_COLOR,
  SUN_POSITION,
  SUN_RADIUS,
  VIGNETTE_DARKNESS,
  VIGNETTE_OFFSET,
} from "./effectsTunables";

// Re-export layer constants so model components import from one place.
export { BLOOM_LAYER, OUTLINE_LAYER } from "./effectsTunables";

// Tiny external store sharing the GodRays sun mesh between SunProxy (mounts
// inside PlayScene) and PaintedPostFx (mounts inside EffectComposer). The
// two components live in separate React subtrees, so context can't bridge
// them; useSyncExternalStore keeps PaintedPostFx re-rendering when the sun
// becomes available without leaking a ref-mutation race onto first paint.
let sunMeshState: THREE.Mesh | null = null;
const sunListeners = new Set<() => void>();
const setSunMesh = (m: THREE.Mesh | null) => {
  sunMeshState = m;
  for (const cb of sunListeners) cb();
};
const subscribeSunMesh = (cb: () => void) => {
  sunListeners.add(cb);
  return () => {
    sunListeners.delete(cb);
  };
};
const getSunMesh = () => sunMeshState;
const useSunMesh = () => useSyncExternalStore(subscribeSunMesh, getSunMesh, () => null);

// Split-tone shader. Pushes shadows toward the cool biome tint and highlights
// toward the warm biome tint based on per-pixel luminance. Equivalent in
// spirit to the Lightroom split-toning slider — keeps midtones unchanged so
// the grade reads as mood, not a uniform color cast.
const SPLIT_TONE_FRAGMENT = /* glsl */ `
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float l = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float shadowK = smoothstep(0.5, 0.05, l);
  float highK = smoothstep(0.55, 1.0, l);
  vec3 shadowMul = mix(vec3(1.0), uShadowTint, shadowK);
  vec3 highMul = mix(vec3(1.0), uHighlightTint, highK);
  outputColor = vec4(inputColor.rgb * shadowMul * highMul, inputColor.a);
}
`;

class SplitToneEffect extends Effect {
  constructor(shadowTint: THREE.Vector3, highlightTint: THREE.Vector3) {
    super("SplitToneEffect", SPLIT_TONE_FRAGMENT, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ["uShadowTint", new THREE.Uniform(shadowTint)],
        ["uHighlightTint", new THREE.Uniform(highlightTint)],
      ]),
    });
  }

  setTints(shadow: [number, number, number], highlight: [number, number, number]) {
    const s = this.uniforms.get("uShadowTint");
    const h = this.uniforms.get("uHighlightTint");
    if (s) (s.value as THREE.Vector3).set(shadow[0], shadow[1], shadow[2]);
    if (h) (h.value as THREE.Vector3).set(highlight[0], highlight[1], highlight[2]);
  }
}

// Tiny opaque mesh that GodRaysEffect samples to derive the sun's screen
// position + occlusion mask. Mounted in PlayScene.tsx so it lives in the
// same scene graph the effect composer renders. The mesh is intentionally
// dim and small — its purpose is to anchor the rays, not to read as a
// visible disc against the sky.
export const SunProxy = ({ biome }: { biome: Biome }) => {
  const ref = useRef<THREE.Mesh>(null);
  const palette = BIOME_PAINTED[biome];
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: palette.godRaysColor,
        toneMapped: false,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    [palette.godRaysColor],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    setSunMesh(ref.current);
    return () => {
      setSunMesh(null);
    };
  }, []);
  return (
    <mesh ref={ref} position={SUN_POSITION} material={material} renderOrder={-2}>
      <sphereGeometry args={[SUN_RADIUS, 16, 12]} />
    </mesh>
  );
};

type Props = {
  enabled?: boolean;
};

// Ordered post-processing chain that pushes the renderer toward the capsule
// key-art look:
//   1. Split-tone color grade  (cool shadows / warm highlights, biome-biased)
//   2. HueSaturation           (subtle saturation lift)
//   3. BrightnessContrast      (deepen shadows)
//   4. Selective bloom         (only meshes on BLOOM_LAYER)
//   5. God-rays                (high quality only — anchored to SunProxy)
//   6. Outline                 (medium+ quality — enemies + robot only)
//   7. Vignette                (frame falloff)
// Quality tier (effectsTunables.ts) decides which optional passes are wired.
// Hot-path math is pushed into the GPU shaders; the only React work per
// frame is the biome-change effect that updates the SplitToneEffect uniforms.
export const PaintedPostFx = ({ enabled = true }: Props) => {
  const biome = useGame((s) => s.world.biome);
  const palette = BIOME_PAINTED[biome];
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const sunMesh = useSunMesh();

  // biome-ignore lint/correctness/useExhaustiveDependencies: built once, uniforms updated by the effect below
  const splitTone = useMemo(
    () =>
      new SplitToneEffect(
        new THREE.Vector3(...palette.shadowTint),
        new THREE.Vector3(...palette.highlightTint),
      ),
    [],
  );

  useEffect(() => {
    splitTone.setTints(palette.shadowTint, palette.highlightTint);
  }, [splitTone, palette.shadowTint, palette.highlightTint]);

  useEffect(() => () => splitTone.dispose(), [splitTone]);

  // SelectiveBloom warns when `lights` is empty. Pass the scene root as a
  // placeholder — the call is a no-op `.layers.enable()` on the scene
  // (which doesn't render any materials itself), but it silences the
  // console spam without forcing us to thread a directional-light ref.
  const lightPlaceholders = useMemo(() => [scene], [scene]);

  const bloomIntensity = BLOOM_INTENSITY * palette.bloomBias;
  const drawingBufferPixels = size.width * size.height * dpr * dpr;
  const includeOutline =
    GRAPHICS_QUALITY !== "low" &&
    drawingBufferPixels > 0 &&
    drawingBufferPixels <= OUTLINE_MAX_DRAWING_BUFFER_PIXELS;
  const includeGodRays =
    GRAPHICS_QUALITY === "high" &&
    sunMesh !== null &&
    drawingBufferPixels > 0 &&
    drawingBufferPixels <= GODRAYS_MAX_DRAWING_BUFFER_PIXELS;

  if (!enabled) return null;

  return (
    <>
      <primitive object={splitTone} />
      <HueSaturation hue={GRADE_HUE} saturation={GRADE_SATURATION} />
      <BrightnessContrast brightness={GRADE_BRIGHTNESS} contrast={GRADE_CONTRAST} />
      <SelectiveBloom
        lights={lightPlaceholders}
        selectionLayer={BLOOM_LAYER}
        luminanceThreshold={BLOOM_THRESHOLD}
        luminanceSmoothing={BLOOM_SMOOTHING}
        intensity={bloomIntensity}
        kernelSize={BLOOM_KERNEL[GRAPHICS_QUALITY]}
        mipmapBlur
      />
      {includeGodRays && sunMesh && (
        <GodRays
          sun={sunMesh}
          samples={GODRAYS_SAMPLES}
          density={GODRAYS_DENSITY}
          decay={GODRAYS_DECAY}
          weight={GODRAYS_WEIGHT}
          exposure={GODRAYS_EXPOSURE}
          kernelSize={GODRAYS_KERNEL}
          resolutionScale={GODRAYS_RESOLUTION_SCALE}
          blur
        />
      )}
      {includeOutline && (
        <Outline
          selectionLayer={OUTLINE_LAYER}
          edgeStrength={OUTLINE_EDGE_STRENGTH}
          visibleEdgeColor={OUTLINE_VISIBLE_COLOR}
          hiddenEdgeColor={OUTLINE_HIDDEN_COLOR}
          kernelSize={OUTLINE_KERNEL[GRAPHICS_QUALITY]}
          blur={OUTLINE_BLUR}
          resolutionScale={OUTLINE_RESOLUTION_SCALE}
          pulseSpeed={0}
          xRay={false}
        />
      )}
      <Vignette offset={VIGNETTE_OFFSET} darkness={VIGNETTE_DARKNESS} eskil={false} />
    </>
  );
};

// Helper exported for model components: enable bloom layer on every mesh
// under a root. Bloom selection respects per-Object3D layer membership;
// non-mesh nodes (bones, groups) toggle harmlessly.
export const enableBloomLayer = (root: THREE.Object3D) => {
  root.traverse((o) => {
    o.layers.enable(BLOOM_LAYER);
  });
};

// Enable outline layer on every mesh under a root. Outline silhouette
// works off the union of all enabled meshes, so traversing covers
// skinned-mesh children, attachments, and proxies.
export const enableOutlineLayer = (root: THREE.Object3D) => {
  root.traverse((o) => {
    o.layers.enable(OUTLINE_LAYER);
  });
};
