import type { EmissiveSpec } from "./materialTunables";

// Per-asset emissive overrides for mesh wrappers that intentionally glow.
// Registry maps `(modelKind, subMeshName | materialName)` substring so
// artists don't have to re-author the unmodified third-party GLBs.
// Enemy dinosaurs intentionally do not use this registry: they render with
// their model-provided materials and no extra eye/body glow overlays.

export type EmissivePattern = {
  // Substring (case-insensitive) compared against BOTH the sub-mesh name
  // and its material(s) name. Either match counts. Use generous patterns
  // to cover variance across GLB packs ("eye", "Eyes", "EyeR" all match
  // "eye"). Use multiple entries for disjoint patterns, not regex.
  match: string;
  spec: EmissiveSpec;
};

// Robot variant emissive defaults. Each pilot model is from a different
// asset pack so the safest pattern is a generic "visor / canopy / eye /
// head" net — followed by a "jet / thrust / vent / engine" net for the
// jetpack hot-glow. Color comes from the variant's existing tint hex in
// ROBOT_SPECS, supplied at apply time.
export const ROBOT_EMISSIVE_PATTERNS: { match: string; intensityMul: number }[] = [
  { match: "visor", intensityMul: 1.6 },
  { match: "eye", intensityMul: 1.4 },
  { match: "canopy", intensityMul: 1.5 },
  { match: "lens", intensityMul: 1.3 },
  { match: "head", intensityMul: 0.0 },
];

export const ROBOT_VENT_PATTERNS: { match: string; intensityMul: number }[] = [
  { match: "vent", intensityMul: 1.0 },
  { match: "jet", intensityMul: 1.1 },
  { match: "thrust", intensityMul: 1.1 },
  { match: "engine", intensityMul: 0.9 },
  { match: "exhaust", intensityMul: 0.9 },
];

export type { EmissiveSpec };
