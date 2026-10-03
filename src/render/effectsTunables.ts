import { KernelSize } from "postprocessing";
import type { GraphicsQuality } from "../preferences";

// Painted-look post-processing tunables. All magic numbers in one place so a
// single-file pass is enough to retune the whole pipeline. Per-biome bias
// (grade tints, dust, bloom strength) lives in BIOME_PAINTED in biomes.ts;
// these constants are the global baseline applied on top.

// Layer indices used by SelectiveBloomEffect and OutlineEffect to pick which
// objects pass through them. THREE layer 0 stays "default visible to camera"
// for every object; opting in is `mesh.layers.enable(LAYER)`. Stay within
// [10..15] so any future passes have headroom and we don't collide with
// three's own usage of low layers in some demos.
export const BLOOM_LAYER = 11;
export const OUTLINE_LAYER = 12;

// Preset reads happen when render resources mount. App remounts the renderer
// on a preset change without resetting the simulation or save.
export { type GraphicsQuality, getGraphicsQuality } from "../preferences";

// Selective bloom — only meshes on BLOOM_LAYER pass through. Threshold stays
// at HDR white: selection alone also includes non-emissive model bodies.
// Bright emissive canopies, muzzle flashes and authored VFX supply the glow.
export const BLOOM_THRESHOLD = 1.0;
export const BLOOM_SMOOTHING = 0.25;
export const BLOOM_INTENSITY = 0.85;
export const BLOOM_KERNEL: Record<GraphicsQuality, KernelSize> = {
  low: KernelSize.SMALL,
  medium: KernelSize.MEDIUM,
  high: KernelSize.LARGE,
};

// Color grade. Neutral midtones with a restrained saturation and contrast
// adjustment; directional lighting supplies most of the shape. Split-tone
// (cool shadows / warm highlights) comes from BIOME_PAINTED.shadowTint /
// highlightTint multiplied in by the PaintedPostFx pipeline.
export const GRADE_HUE = 0.0;
export const GRADE_SATURATION = -0.025;
export const GRADE_BRIGHTNESS = 0.0;
export const GRADE_CONTRAST = 0.045;

// Gentle edge falloff preserves build slots and enemies near the map boundary.
export const VIGNETTE_OFFSET = 0.3;
export const VIGNETTE_DARKNESS = 0.3;

// God-rays — high quality only. Anchored to a sun proxy in the scene.
// Kernel deliberately small; the radial blur dominates the cost.
export const GODRAYS_DENSITY = 0.97;
export const GODRAYS_DECAY = 0.94;
export const GODRAYS_WEIGHT = 0.35;
export const GODRAYS_EXPOSURE = 0.24;
export const GODRAYS_SAMPLES = 36;
export const GODRAYS_KERNEL = KernelSize.SMALL;
export const GODRAYS_RESOLUTION_SCALE = 0.35;
// GodRays allocates three extra render targets plus a depth texture. At
// retina-size drawing buffers that tipped Chrome's GPU process into a
// hard context loss, while the rest of the painted stack stayed stable.
export const GODRAYS_MAX_DRAWING_BUFFER_PIXELS = 2_750_000;
// Sun mesh world position. High up + slightly forward of camera origin so it
// projects near the top edge of the orthographic frame. The directional
// light's `position` in Scene.tsx is the conceptual match.
export const SUN_POSITION: [number, number, number] = [14, 36, 10];
export const SUN_RADIUS = 1.6;

// Outline — dark, low edge strength, narrow. Only enemies + robot opt in
// (via OUTLINE_LAYER) so props/terrain don't pick up visual noise.
export const OUTLINE_EDGE_STRENGTH = 2.4;
export const OUTLINE_VISIBLE_COLOR = 0x0a0a14;
export const OUTLINE_HIDDEN_COLOR = 0x000000;
export const OUTLINE_KERNEL: Record<GraphicsQuality, KernelSize> = {
  low: KernelSize.VERY_SMALL,
  medium: KernelSize.SMALL,
  high: KernelSize.SMALL,
};
export const OUTLINE_BLUR = true;
export const OUTLINE_RESOLUTION_SCALE = 0.4;
// Outline renders selected objects into extra mask/depth/edge targets.
// Once live enemies enter the selection layer, retina-size buffers can
// trip the same GPU-process crash as GodRays.
export const OUTLINE_MAX_DRAWING_BUFFER_PIXELS = 2_750_000;

// Ambient haze (ember + dust scene layer in AmbientHaze.tsx). Density scales
// with biome bias; quality knocks the pool size down on low-end hardware so
// the per-frame instance-matrix update stays cheap.
export const HAZE_POOL: Record<GraphicsQuality, number> = {
  low: 48,
  medium: 96,
  high: 160,
};
export const HAZE_RISE_SPEED = 0.45;
export const HAZE_DRIFT = 0.18;
export const HAZE_LIFE = 4.5;
