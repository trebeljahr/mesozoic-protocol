import { KernelSize } from "postprocessing";

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

// Quality tiers. Driven by GRAPHICS_QUALITY (auto-detected from input mode +
// hardware concurrency at import time). Steam Deck APU is the explicit
// minimum target — "low" gates the expensive passes off so the frame budget
// stays under ~13ms with many enemies on screen.
export type GraphicsQuality = "low" | "medium" | "high";

const detectGraphicsQuality = (): GraphicsQuality => {
  if (typeof navigator === "undefined") return "medium";
  const cores = navigator.hardwareConcurrency ?? 8;
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const mobileUA = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  if (touch || mobileUA || cores <= 4) return "low";
  if (cores >= 8) return "high";
  return "medium";
};

export const GRAPHICS_QUALITY: GraphicsQuality = detectGraphicsQuality();

// Selective bloom — only meshes on BLOOM_LAYER pass through. Threshold stays
// moderate because the selection pass already filters to opt-in geometry;
// it gates non-emissive body parts of opt-in models (dino bodies, tower
// chassis) so only canopies / muzzle flashes / matriarch tints actually glow.
export const BLOOM_THRESHOLD = 0.55;
export const BLOOM_SMOOTHING = 0.2;
export const BLOOM_INTENSITY = 1.25;
export const BLOOM_KERNEL: Record<GraphicsQuality, KernelSize> = {
  low: KernelSize.SMALL,
  medium: KernelSize.MEDIUM,
  high: KernelSize.LARGE,
};

// Color grade. Hue shifted slightly cool, saturation pumped a touch, then a
// small contrast bump to deepen shadows. Split-tone (cool shadows / warm
// highlights) comes from the per-biome BIOME_PAINTED.shadowTint /
// highlightTint multiplied in by the PaintedPostFx pipeline.
export const GRADE_HUE = 0.0;
export const GRADE_SATURATION = 0.12;
export const GRADE_BRIGHTNESS = -0.02;
export const GRADE_CONTRAST = 0.12;

// Dark vignette closes the frame. Capsule art has heavy edge falloff so the
// eye reads the center as "the action."
export const VIGNETTE_OFFSET = 0.3;
export const VIGNETTE_DARKNESS = 0.55;

// God-rays — high quality only. Anchored to a sun proxy in the scene.
// Kernel deliberately small; the radial blur dominates the cost.
export const GODRAYS_DENSITY = 0.97;
export const GODRAYS_DECAY = 0.94;
export const GODRAYS_WEIGHT = 0.35;
export const GODRAYS_EXPOSURE = 0.5;
export const GODRAYS_SAMPLES = 48;
export const GODRAYS_KERNEL = KernelSize.SMALL;
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
