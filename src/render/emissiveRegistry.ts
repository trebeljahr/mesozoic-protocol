import type { EnemyKind, TowerKind } from "../sim/types";
import type { EmissiveSpec } from "./materialTunables";

// Per-asset emissive overrides for the three mesh wrappers (Enemy /
// Tower / Robot). Approach (b) from the task brief: a registry mapped by
// `(modelKind, subMeshName | materialName)` substring so artists don't
// have to re-author the unmodified third-party GLBs. Add new entries
// here rather than editing the wrappers — patterns are soft-matched
// (substring, case-insensitive) so a single rule covers naming variance
// across packs.

export type EmissivePattern = {
  // Substring (case-insensitive) compared against BOTH the sub-mesh name
  // and its material(s) name. Either match counts. Use generous patterns
  // to cover variance across GLB packs ("eye", "Eyes", "EyeR" all match
  // "eye"). Use multiple entries for disjoint patterns, not regex.
  match: string;
  spec: EmissiveSpec;
};

// Enemy emissive defaults. Generic patterns first — every dino with an
// "eye"-named mesh gets bio-green eye glow. Boss variant rows override
// for the spine bio-conduit (biome accent).
export const ENEMY_EMISSIVE: Record<EnemyKind, EmissivePattern[]> = {
  raptor: [{ match: "eye", spec: { color: "#7eff8c", intensity: 1.6, bloom: true } }],
  allosaur: [{ match: "eye", spec: { color: "#9aff7a", intensity: 1.8, bloom: true } }],
  stego: [{ match: "eye", spec: { color: "#9aff7a", intensity: 1.4, bloom: true } }],
  swarm: [{ match: "eye", spec: { color: "#a8ff70", intensity: 1.4, bloom: true } }],
  armored: [{ match: "eye", spec: { color: "#7eff8c", intensity: 1.6, bloom: true } }],
  para: [{ match: "eye", spec: { color: "#7eff8c", intensity: 1.5, bloom: true } }],
  titan: [{ match: "eye", spec: { color: "#7eff8c", intensity: 1.4, bloom: true } }],
  boss: [{ match: "eye", spec: { color: "#aaff80", intensity: 1.8, bloom: true } }],
};

// Boss spine / rib bio-conduit emissive strip. Matches a generous net of
// patterns ("spine", "back", "ridge", "plate", "rib") so each species'
// matriarch finds at least one sub-mesh to light up.
export const MATRIARCH_CONDUIT_PATTERNS: string[] = ["spine", "ridge", "back", "plate", "rib"];

// Tower emissive defaults — per kind. Patterns target barrel tips,
// indicator lamps, and vents. Cyan ally team for the kinetics/electric
// kinds; warm orange for the flamethrower; cool blue-white for cryo.
// Each tower kind owns its own ModelTowerMesh wrapper, so the registry
// indexes by kind, not by GLB path.
export const TOWER_EMISSIVE: Record<TowerKind, EmissivePattern[]> = {
  pulse: [
    {
      match: "PaletteMaterial",
      spec: { color: "#000000", intensity: 0, bloom: false },
    },
  ],
  chain: [
    {
      match: "PaletteMaterial",
      spec: { color: "#000000", intensity: 0, bloom: false },
    },
  ],
  // EMP / Cryo turret — Subzero & resonator parts get a cool glow so the
  // tower reads as "cold-charged" even before any wave starts.
  cryo: [
    {
      match: "BlueMiddleEMPTurret",
      spec: { color: "#9fe4ff", intensity: 1.4, bloom: true },
    },
  ],
  // Mortar — atlas, no per-part materials. Existing tower tints already
  // bake a warm glow through emissive; leave the registry empty so the
  // tint code path stays authoritative.
  mortar: [],
  // Flamethrower — warm pilot light at the nozzle.
  flame: [
    {
      match: "GrayMiddleFlamethrowerTurret",
      spec: { color: "#ff7a30", intensity: 1.5, bloom: true },
    },
  ],
  // Hive — drone-bay storage block glows amber.
  hive: [
    {
      match: "OrangeStorageHiveTurret",
      spec: { color: "#ffb04a", intensity: 1.1, bloom: true },
    },
  ],
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

// Eye-mesh fallback name patterns used inside the enemy traversal. A
// material whose name OR mesh name contains any of these counts as an
// "eye" hit. Kept here so future emissive sub-mesh kinds can plug in.
export const EYE_FALLBACK_NAMES: string[] = ["eye", "pupil", "iris"];

export type { EmissiveSpec };
