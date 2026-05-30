import * as THREE from "three";
import type { Biome } from "../biomes";
import type { BossVariant } from "../sim/types";

// Shared material pipeline for enemy/tower/mech meshes. Adds:
//   1. A fresnel rim light (per-instance color/intensity uniform).
//   2. A 3-step toon quantization on the *diffuse* lit portion of the
//      fragment (emissive stays unquantized so glows still pop).
// Patched into the existing MeshStandardMaterial via onBeforeCompile so
// PBR maps, hit-flash, frost tint, adaptive resist tint, and tower
// upgrade tints all keep working unchanged.
//
// Sub-meshes that should opt into the post-FX selective-bloom pass set
// `mesh.userData.bloom = true` (and/or material.userData.bloom = true on
// the cloned material). The sibling Effects.tsx chip is expected to walk
// the scene and add bloom-flagged meshes to its bloom layer — see the
// header comment in src/render/Effects.tsx for the convention.

// Three-band gradient values for the toon ramp. Lower = darker shadow.
// 0.42/0.72/1.0 keeps shadows visible without crushing midtones flat;
// three steps reads as painted without flipping into "cel" territory.
const TOON_BAND_LO = 0.42;
const TOON_BAND_MID = 0.72;
const TOON_BAND_HI = 1.0;
// Luminance thresholds between bands (in the normalized 0..1 range).
const TOON_THRESH_LO = 0.33;
const TOON_THRESH_HI = 0.66;

export const RIM_DEFAULT_POWER = 2.4;

// Team rim colors — cyan-white for player/turret/mech. Enemy body rim is
// disabled in ModelEnemyMesh; keep a dark fallback color so any accidental
// enemy rim use cannot reintroduce the old neon body glow.
export const RIM_COLOR_ALLY = "#7fe6ff";
export const RIM_COLOR_ENEMY = "#0b1210";
export const RIM_COLOR_FLAME = "#ffb95a";
export const RIM_COLOR_CRYO = "#bfe6ff";

// Per-biome rim tint bias. Same enemy in lava reads warmer than snow.
// Multiplied onto the team rim base so the green stays green but biases
// hue subtly toward biome lighting. Tuple is (mulR, mulG, mulB).
export const BIOME_RIM_BIAS: Record<Biome, [number, number, number]> = {
  forest: [1.0, 1.05, 0.95],
  desert: [1.08, 1.0, 0.85],
  snow: [0.92, 1.0, 1.12],
  wasteland: [1.05, 0.95, 0.85],
  lava: [1.2, 0.85, 0.7],
  alien: [1.0, 0.85, 1.18],
};

// Per-biome matriarch accent — overrides the green enemy rim on the
// queen so each variant carries its biome's lighting cue.
export const BIOME_MATRIARCH_RIM: Record<Biome, string> = {
  forest: "#9eff7a",
  desert: "#ffd060",
  snow: "#aef0ff",
  wasteland: "#ffaf60",
  lava: "#ff7030",
  alien: "#e87fff",
};

// Variant → biome mapping for matriarchs. Sim doesn't store biome on the
// boss entity directly (it's implied by which level she spawned on), so
// the render layer maps variant → biome to pick the rim accent.
export const MATRIARCH_VARIANT_BIOME: Record<BossVariant, Biome> = {
  raptor: "forest",
  stego: "snow",
  para: "desert",
  allosaur: "wasteland",
  armored: "lava",
  apex: "alien",
};

// Matriarch spine / bio-conduit emissive color, by biome accent.
export const MATRIARCH_CONDUIT_COLOR: Record<Biome, string> = {
  forest: "#7eff8c",
  desert: "#ffa030",
  snow: "#8cf0ff",
  wasteland: "#ff8a3a",
  lava: "#ff5018",
  alien: "#ff5cff",
};

// Default rim intensities by category. Tuned so the silhouette reads
// against busy biome props without the unit looking like it's lit from
// behind by a laser.
export const RIM_INTENSITY_ALLY = 0.55;
export const RIM_INTENSITY_ENEMY = 0;
export const RIM_INTENSITY_BOSS = 0;

// Toon amount: 0 keeps stock PBR shading, 1 fully quantizes diffuse into
// the 3 bands. 0.72 reads as painted without losing PBR cues entirely.
export const TOON_AMOUNT = 0.72;

export type RimSpec = {
  color: THREE.Color;
  intensity: number;
  power: number;
};

export type EmissiveSpec = {
  // Hex string or THREE.Color — replaces material.emissive each frame
  // through the hit-flash pipeline by way of `userData.baseEmissive`.
  color: THREE.ColorRepresentation;
  // Multiplier on emissive intensity. 1.0 is "visible glow"; values >1
  // push into bloom territory once the post-FX chip lands.
  intensity: number;
  // Sub-mesh opts into the selective-bloom pass. Effects.tsx (sibling
  // chip) is expected to read `userData.bloom === true` while walking
  // the scene.
  bloom?: boolean;
};

const FRAG_INJECT_HEAD = `
  uniform vec3 uRimColor;
  uniform float uRimIntensity;
  uniform float uRimPower;
  uniform float uToonAmount;
`;

// Inject the toon quantization + rim addition right before three.js
// folds outgoingLight into gl_FragColor. The diffuse lit portion is
// quantized (totalEmissiveRadiance subtracted out and re-added) so hot
// emissive surfaces aren't crushed into a flat band.
const FRAG_INJECT_BEFORE_OUTPUT = `
  // Toon quantize: keep emissive linear, quantize diffuse lighting only.
  {
    vec3 toonEmissive = totalEmissiveRadiance;
    vec3 toonDiffuse = outgoingLight - toonEmissive;
    float toonLum = dot(toonDiffuse, vec3(0.299, 0.587, 0.114));
    float toonClamped = clamp(toonLum, 0.0, 1.0);
    float toonBand =
      toonClamped < ${TOON_THRESH_LO.toFixed(4)} ? ${TOON_BAND_LO.toFixed(4)} :
      toonClamped < ${TOON_THRESH_HI.toFixed(4)} ? ${TOON_BAND_MID.toFixed(4)} :
      ${TOON_BAND_HI.toFixed(4)};
    vec3 toonLit = toonDiffuse * (toonBand / max(toonLum, 0.0001));
    outgoingLight = mix(outgoingLight, toonLit + toonEmissive, uToonAmount);
  }
  // Fresnel rim term (1 - N·V)^p. View-space normal + view-space pos are
  // already populated by the stock MeshStandardMaterial vertex shader,
  // so the same patch works under InstancedMesh without extra varyings.
  {
    vec3 rimViewDir = normalize(-vViewPosition);
    float rimNDotV = max(dot(normalize(vNormal), rimViewDir), 0.0);
    float rim = pow(1.0 - rimNDotV, uRimPower);
    outgoingLight += uRimColor * (rim * uRimIntensity);
  }
`;

export type ToonRimOpts = {
  rim?: { color: THREE.ColorRepresentation; intensity: number; power?: number };
  toon?: number;
};

// Patch an existing MeshStandardMaterial (or subclass) in place. Stores
// per-material uniforms on userData so per-frame code (biome tint, frost
// rim handoff) can mutate them without re-compiling the shader.
export const applyToonRimPatch = (mat: THREE.Material, opts: ToonRimOpts): void => {
  const std = mat as THREE.MeshStandardMaterial;
  // Skip non-standard materials (basic, line, sprite) — fresnel/toon
  // depend on normal + view-pos varyings the standard chain provides.
  if (!("emissive" in std) || !std.isMaterial) return;

  const rimColor = new THREE.Color(opts.rim?.color ?? RIM_COLOR_ALLY);
  const rimIntensity = opts.rim?.intensity ?? 0;
  const rimPower = opts.rim?.power ?? RIM_DEFAULT_POWER;
  const toonAmount = opts.toon ?? TOON_AMOUNT;

  // Expose for per-frame mutation. Frost lerp / biome handoff copy into
  // these THREE.Color/float values; the shader reads the same object so
  // edits land without re-compiling. `rimColorBase` is the immutable
  // origin captured at patch time so per-frame code can lerp from a
  // stable base instead of drifting (the uniform's `.value` is mutated).
  std.userData.rimColor = rimColor;
  std.userData.rimColorBase = rimColor.clone();
  std.userData.rimIntensity = rimIntensity;
  std.userData.rimIntensityBase = rimIntensity;
  std.userData.rimPower = rimPower;
  std.userData.toonAmount = toonAmount;
  std.userData.toonRimPatched = true;

  const intensityRef = { value: rimIntensity };
  const powerRef = { value: rimPower };
  const toonRef = { value: toonAmount };
  std.userData.rimIntensityRef = intensityRef;
  std.userData.rimPowerRef = powerRef;
  std.userData.toonAmountRef = toonRef;

  std.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: rimColor };
    shader.uniforms.uRimIntensity = intensityRef;
    shader.uniforms.uRimPower = powerRef;
    shader.uniforms.uToonAmount = toonRef;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_INJECT_HEAD}`)
      .replace(
        "#include <opaque_fragment>",
        `${FRAG_INJECT_BEFORE_OUTPUT}\n#include <opaque_fragment>`,
      );
  };
  // All variants compile to the same program — colors/intensities are
  // uniforms, not defines. Stable key keeps shader cache hits high.
  std.customProgramCacheKey = () => "toonrim:v1";
  std.needsUpdate = true;
};

// Mark a sub-mesh + its material(s) for the selective-bloom pass. Walk
// site reads userData.bloom from the mesh (Effects.tsx convention).
export const markBloom = (obj: THREE.Object3D): void => {
  obj.userData.bloom = true;
  const mesh = obj as THREE.Mesh;
  if (!mesh.isMesh) return;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (m) m.userData.bloom = true;
  }
};

// Apply an emissive spec to a material. Captures the picked emissive
// into userData.baseEmissive so the hit-flash code path can restore it
// after a temporary flash override. Sets `userData.emissiveOverride =
// true` so per-frame enemy-body washes (matriarch tint / adaptive
// resist) skip this material and the registry glow survives across
// frames.
export const applyEmissiveSpec = (mat: THREE.Material, spec: EmissiveSpec): void => {
  const std = mat as THREE.MeshStandardMaterial;
  if (!std.emissive) return;
  std.emissive.set(spec.color);
  std.emissiveIntensity = spec.intensity;
  std.userData.baseEmissive = std.emissive.clone();
  std.userData.baseEmissiveIntensity = spec.intensity;
  std.userData.emissiveOverride = true;
  if (spec.bloom) std.userData.bloom = true;
};

// Mutate the rim uniform color in-place. Frost handoff / biome bias /
// per-frame tints flow through this so existing tint pipelines stay
// authoritative on body color while only the rim shifts hue.
export const setRimColor = (mat: THREE.Material, color: THREE.Color): void => {
  const ref = (mat as THREE.MeshStandardMaterial).userData.rimColor as THREE.Color | undefined;
  if (ref) ref.copy(color);
};

export const setRimIntensity = (mat: THREE.Material, intensity: number): void => {
  const ref = (mat as THREE.MeshStandardMaterial).userData.rimIntensityRef as
    | { value: number }
    | undefined;
  if (ref) ref.value = intensity;
};

// Compose a per-biome rim color from a base hex + the biome bias.
export const biomeRimColor = (base: THREE.ColorRepresentation, biome: Biome): THREE.Color => {
  const bias = BIOME_RIM_BIAS[biome];
  const c = new THREE.Color(base);
  c.r = Math.min(1, c.r * bias[0]);
  c.g = Math.min(1, c.g * bias[1]);
  c.b = Math.min(1, c.b * bias[2]);
  return c;
};
