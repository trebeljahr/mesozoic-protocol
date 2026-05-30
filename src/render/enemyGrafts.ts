import * as THREE from "three";
import type { BossVariant, EnemyKind } from "../sim/types";
import { BOSS_VARIANT_TINT } from "../sim/world";

// Bone-grafted alloy treatment for enemy dinosaurs:
//   Layer 1 — opaque steel BoxGeometry "plates" bound to torso / head /
//             tail bones so armor rides the walk, bite, and death clips.
//   Layer 2 — optional shader stripe helpers kept here for future boss-only
//             conduit work. The gameplay mesh currently leaves body glow off;
//             eye glow is handled by EnemyEyes.
//
// Tier escalation: each plate is gated by `ENEMY_GRAFT_TIER[kind] >=
// plate.tier`, so a tier-1 raptor wears only the bare scaffolding while a
// tier-3 titan is fully clad. Matriarchs force max density + a biome-accent
// conduit color regardless of their base kind's tier.

type Vec3 = [number, number, number];

const PLATE_VERTICAL_INSET = 0.42;
const PLATE_WIDTH_SCALE = 0.56;
const PLATE_HEIGHT_SCALE = 0.22;
const PLATE_DEPTH_SCALE = 0.64;

export type PlateSpec = {
  // Anchor in target-size-unit world space — feet sit at world Y = 0,
  // body extends along +Y, forward = +Z, right = +X. Authored against
  // the rendered enemy (after model normalization), not the raw GLB.
  offset: Vec3;
  // World-unit half-extents of a unit cube — the geometry is a 1×1×1
  // box scaled to (size.x, size.y, size.z).
  size: Vec3;
  // Optional Euler rotation in radians.
  rotation?: Vec3;
  // Preferred bone bucket. If omitted, the installer infers one from z.
  bone?: "torso" | "shoulders" | "neck" | "head" | "back" | "tail";
  // Min enemy tier to show this plate (1 = always, 3 = apex only).
  tier: 1 | 2 | 3;
};

// Tier per base kind. Matches the existing stat tiers loosely — small
// fast units (swarm/raptor/para) get tier 1, mid-weight (allosaur/stego/
// armored) get tier 2, titan apex gets tier 3. Bosses force tier 3
// elsewhere — see resolveEnemyTier.
export const ENEMY_GRAFT_TIER: Record<EnemyKind, 1 | 2 | 3> = {
  swarm: 1,
  raptor: 1,
  para: 1,
  allosaur: 2,
  stego: 2,
  armored: 2,
  titan: 3,
  boss: 3,
};

// Plate roster per enemy kind. Offsets / sizes in target-size-unit world
// space (post-normalization) so a value of 1.5 reads as "1.5 world units"
// in the rendered scene regardless of the raw GLB's scale.
//
// Numbers are hand-tuned by eyeballing the rendered models — fine to
// iterate. Each kind authors the FULL tier-3 kit; tier filtering at install
// time drops the higher-tier plates for lower-tier enemies of that kind.
export const GRAFT_PLATES: Record<EnemyKind, PlateSpec[]> = {
  swarm: [{ offset: [0, 0.38, 0.0], size: [0.12, 0.035, 0.22], bone: "torso", tier: 1 }],
  raptor: [
    { offset: [0, 0.82, 0.05], size: [0.22, 0.045, 0.42], bone: "torso", tier: 1 },
    { offset: [0, 0.92, 0.44], size: [0.2, 0.055, 0.2], bone: "shoulders", tier: 2 },
    {
      offset: [0.12, 0.72, 0.04],
      size: [0.06, 0.18, 0.15],
      rotation: [0, 0, 0.28],
      bone: "torso",
      tier: 3,
    },
    {
      offset: [-0.12, 0.72, 0.04],
      size: [0.06, 0.18, 0.15],
      rotation: [0, 0, -0.28],
      bone: "torso",
      tier: 3,
    },
  ],
  para: [
    { offset: [0, 0.88, 0.15], size: [0.25, 0.055, 0.48], bone: "torso", tier: 1 },
    { offset: [0, 0.78, -0.35], size: [0.22, 0.05, 0.34], bone: "back", tier: 2 },
    { offset: [0, 1.02, 0.72], size: [0.2, 0.06, 0.18], bone: "head", tier: 2 },
    {
      offset: [0.18, 0.74, 0.08],
      size: [0.07, 0.22, 0.2],
      rotation: [0, 0, 0.32],
      bone: "torso",
      tier: 3,
    },
    {
      offset: [-0.18, 0.74, 0.08],
      size: [0.07, 0.22, 0.2],
      rotation: [0, 0, -0.32],
      bone: "torso",
      tier: 3,
    },
  ],
  allosaur: [
    { offset: [0, 1.38, 0.0], size: [0.38, 0.075, 0.66], bone: "torso", tier: 1 },
    { offset: [0, 1.78, 0.78], size: [0.36, 0.09, 0.28], bone: "head", tier: 2 },
    {
      offset: [0.28, 1.08, 0.14],
      size: [0.11, 0.3, 0.24],
      rotation: [0, 0, 0.28],
      bone: "torso",
      tier: 2,
    },
    {
      offset: [-0.28, 1.08, 0.14],
      size: [0.11, 0.3, 0.24],
      rotation: [0, 0, -0.28],
      bone: "torso",
      tier: 2,
    },
    { offset: [0, 1.05, -0.78], size: [0.32, 0.065, 0.42], bone: "back", tier: 3 },
  ],
  stego: [
    { offset: [0, 0.98, 0.05], size: [0.32, 0.065, 0.52], bone: "torso", tier: 1 },
    { offset: [0, 0.78, 0.78], size: [0.27, 0.07, 0.22], bone: "shoulders", tier: 2 },
    { offset: [0, 0.86, -0.52], size: [0.3, 0.06, 0.42], bone: "back", tier: 2 },
    {
      offset: [0.36, 0.78, 0.0],
      size: [0.11, 0.28, 0.34],
      rotation: [0, 0, 0.28],
      bone: "torso",
      tier: 3,
    },
    {
      offset: [-0.36, 0.78, 0.0],
      size: [0.11, 0.28, 0.34],
      rotation: [0, 0, -0.28],
      bone: "torso",
      tier: 3,
    },
  ],
  armored: [
    { offset: [0, 0.98, 0.06], size: [0.32, 0.065, 0.52], bone: "torso", tier: 1 },
    { offset: [0, 0.78, 0.92], size: [0.42, 0.08, 0.24], bone: "head", tier: 2 },
    { offset: [0, 0.86, -0.5], size: [0.3, 0.06, 0.4], bone: "back", tier: 2 },
    {
      offset: [0.38, 0.76, 0.02],
      size: [0.11, 0.28, 0.36],
      rotation: [0, 0, 0.28],
      bone: "torso",
      tier: 3,
    },
    {
      offset: [-0.38, 0.76, 0.02],
      size: [0.11, 0.28, 0.36],
      rotation: [0, 0, -0.28],
      bone: "torso",
      tier: 3,
    },
  ],
  titan: [
    { offset: [0, 4.35, 0.0], size: [0.72, 0.16, 1.65], bone: "torso", tier: 1 },
    { offset: [0, 5.45, 3.2], size: [0.46, 0.14, 0.82], bone: "neck", tier: 1 },
    { offset: [0, 6.2, 4.25], size: [0.34, 0.13, 0.62], bone: "head", tier: 2 },
    { offset: [0, 6.35, 4.95], size: [0.38, 0.13, 0.42], bone: "head", tier: 2 },
    {
      offset: [1.0, 3.75, 0.0],
      size: [0.22, 0.72, 0.9],
      rotation: [0, 0, 0.38],
      bone: "torso",
      tier: 2,
    },
    {
      offset: [-1.0, 3.75, 0.0],
      size: [0.22, 0.72, 0.9],
      rotation: [0, 0, -0.38],
      bone: "torso",
      tier: 2,
    },
    { offset: [0, 3.55, -1.85], size: [0.52, 0.13, 0.95], bone: "back", tier: 3 },
    { offset: [0, 2.8, -3.4], size: [0.38, 0.12, 1.0], bone: "tail", tier: 3 },
  ],
  // Matriarchs route through BOSS_BASE_KIND to pick the matching base
  // roster (scaled implicitly by the variant's target-size when installed),
  // so this list is intentionally empty.
  boss: [],
};

// Each matriarch variant inherits the plate roster from a base kind that
// shares its GLB. Plates author in target-size units so the scaled-up
// matriarch model uses the same authored numbers without retuning — at
// install time we apply a uniform scale so the plates grow with the body.
export const BOSS_BASE_KIND: Record<BossVariant, EnemyKind> = {
  raptor: "raptor",
  stego: "stego",
  para: "para",
  allosaur: "allosaur",
  armored: "armored",
  apex: "titan",
};

// Render-targetSize each base kind is mounted at in Scene.tsx. Plates are
// authored in these target-size units. For matriarchs (mounted at a much
// larger target size) we apply scale = renderTargetSize / baseTargetSize
// so the plate roster grows with the body instead of shrinking to flecks
// on a queen-scale model.
export const BASE_TARGET_SIZE: Record<EnemyKind, number> = {
  swarm: 0.8,
  raptor: 1.6,
  para: 1.7,
  allosaur: 3.3,
  stego: 2.85,
  armored: 3.0,
  titan: 11.0,
  // Unused — matriarchs always route through BOSS_BASE_KIND.
  boss: 11.0,
};

// Acid-green default — calibrated to clear the App.tsx bloom threshold of
// 0.82 in linear once the per-frame uIntensity multiplies through and
// toneMapped:false is honored on the patched material output.
const DEFAULT_CONDUIT_COLOR = "#7dff32";

// Brighten the matriarch tint relative to its body wash — BOSS_VARIANT_TINT
// values were chosen for a subtle body lerp, but the conduit is a thin
// glow strip that needs to read as emissive plasma. Push saturation +
// brightness without leaving the variant's hue.
const matriarchBoost = (hex: string): THREE.Color => {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  hsl.s = Math.min(1, hsl.s * 1.2 + 0.15);
  hsl.l = Math.max(0.55, Math.min(0.72, hsl.l * 1.25));
  c.setHSL(hsl.h, hsl.s, hsl.l);
  return c;
};

export const getConduitColor = (bossVariant?: BossVariant): THREE.Color =>
  bossVariant
    ? matriarchBoost(BOSS_VARIANT_TINT[bossVariant])
    : new THREE.Color(DEFAULT_CONDUIT_COLOR);

// Resolve effective graft tier for an enemy spawn. Matriarchs force max
// density irrespective of their base kind's tier.
export const resolveEnemyTier = (kind: EnemyKind, matriarch: boolean): 1 | 2 | 3 =>
  matriarch ? 3 : ENEMY_GRAFT_TIER[kind];

// Single shared steel material across every plate on every enemy. Three.js
// won't auto-batch geometries, but reusing the material lets the renderer
// skip shader/state changes between draw calls and keeps mobile happy.
let cachedPlateMaterial: THREE.MeshStandardMaterial | null = null;
export const getPlateMaterial = (): THREE.MeshStandardMaterial => {
  if (!cachedPlateMaterial) {
    cachedPlateMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#78838c"),
      metalness: 0.35,
      roughness: 0.72,
    });
  }
  return cachedPlateMaterial;
};

let cachedPlateGeometry: THREE.BoxGeometry | null = null;
export const getPlateGeometry = (): THREE.BoxGeometry => {
  if (!cachedPlateGeometry) cachedPlateGeometry = new THREE.BoxGeometry(1, 1, 1);
  return cachedPlateGeometry;
};

// Conduit pulse state — shared across every mesh in one enemy body so the
// stripes don't desync across submeshes. Mutated each frame from
// ModelEnemyMesh's frame loop.
export type ConduitUniforms = {
  uTime: { value: number };
  uColor: { value: THREE.Color };
  uIntensity: { value: number };
  uFrequency: { value: number };
  uSpeed: { value: number };
  uThreshold: { value: number };
  uPhaseOffset: { value: number };
  uAxis: { value: THREE.Vector3 };
};

export type GraftQuality = "low" | "medium" | "high";

// Coarse device hint. Mobile / low-core devices drop the shader stripe
// (plates still render); desktop runs at full density.
export const inferDefaultQuality = (): GraftQuality => {
  if (typeof navigator === "undefined") return "high";
  const cores = navigator.hardwareConcurrency ?? 8;
  if (cores <= 4) return "low";
  if (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches) return "medium";
  if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) return "medium";
  return "high";
};

let currentQuality: GraftQuality = inferDefaultQuality();
export const getGraftQuality = (): GraftQuality => currentQuality;
export const setGraftQuality = (q: GraftQuality): void => {
  currentQuality = q;
};

export const makeConduitUniforms = (
  color: THREE.Color,
  tier: 1 | 2 | 3,
  phaseOffset: number,
  matriarch: boolean,
): ConduitUniforms => {
  const q = currentQuality;
  // Tier density → stripe count along body axis.
  const baseFrequency = tier === 1 ? 2.2 : tier === 2 ? 4.0 : 6.2;
  const frequency = q === "medium" ? baseFrequency * 0.5 : baseFrequency;
  // Lower threshold = wider stripes. Apex/matriarch saturate the body.
  const threshold = tier === 1 ? 0.7 : tier === 2 ? 0.55 : 0.45;
  // Matriarch pulses slower + heavier for dramatic weight.
  const speed = matriarch ? 1.1 : 2.0;
  return {
    uTime: { value: 0 },
    uColor: { value: color },
    uIntensity: { value: 1.0 },
    uFrequency: { value: frequency },
    uSpeed: { value: speed },
    uThreshold: { value: threshold },
    uPhaseOffset: { value: phaseOffset },
    uAxis: { value: new THREE.Vector3(0, 1, 0.4).normalize() },
  };
};

// Patch a MeshStandardMaterial so its emissive output carries an additive
// bio-conduit stripe pattern. Caller is responsible for keeping uniforms
// alive — the same uniforms object is shared by every submesh inside one
// enemy body so the stripes stay in lockstep.
export const installConduitShader = (
  material: THREE.MeshStandardMaterial,
  uniforms: ConduitUniforms,
): void => {
  // Wrap any existing onBeforeCompile so we don't clobber another patch
  // (e.g. emissive-map tweaks layered above by a future renderer chip).
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);

    shader.uniforms.uConduitTime = uniforms.uTime;
    shader.uniforms.uConduitColor = uniforms.uColor;
    shader.uniforms.uConduitIntensity = uniforms.uIntensity;
    shader.uniforms.uConduitFrequency = uniforms.uFrequency;
    shader.uniforms.uConduitSpeed = uniforms.uSpeed;
    shader.uniforms.uConduitThreshold = uniforms.uThreshold;
    shader.uniforms.uConduitPhase = uniforms.uPhaseOffset;
    shader.uniforms.uConduitAxis = uniforms.uAxis;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying float vConduitCoord;
uniform vec3 uConduitAxis;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vConduitCoord = dot(position, uConduitAxis);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying float vConduitCoord;
uniform float uConduitTime;
uniform vec3 uConduitColor;
uniform float uConduitIntensity;
uniform float uConduitFrequency;
uniform float uConduitSpeed;
uniform float uConduitThreshold;
uniform float uConduitPhase;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
{
  float phase = vConduitCoord * uConduitFrequency - uConduitTime * uConduitSpeed + uConduitPhase;
  float wave = sin(phase);
  float stripe = smoothstep(uConduitThreshold, uConduitThreshold + 0.08, wave);
  // Head-to-tail brightness sweep — a long-wavelength sin biases the
  // stripe intensity along the body so the pulse reads as travelling.
  float sweep = 0.55 + 0.45 * sin(phase * 0.5);
  totalEmissiveRadiance += stripe * sweep * uConduitColor * uConduitIntensity;
}`,
      );
  };
  // Force shader rebuild if material had already compiled.
  material.needsUpdate = true;
};

// Walk an enemy body tree and patch every MeshStandardMaterial with the
// shared conduit uniforms. Quality "low" skips the patch entirely — the
// body still tints/flashes via the existing per-frame traversal, just
// without the stripe overlay.
export const installConduitOnBody = (root: THREE.Object3D, uniforms: ConduitUniforms): void => {
  if (currentQuality === "low") return;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.material) return;
    const apply = (mm: THREE.Material) => {
      const std = mm as THREE.MeshStandardMaterial;
      if (!std.emissive) return;
      installConduitShader(std, uniforms);
    };
    if (Array.isArray(m.material)) m.material.forEach(apply);
    else apply(m.material);
  });
};

type PlateBinding = {
  bone: THREE.Object3D;
  localPosition: THREE.Vector3;
  localQuaternion: THREE.Quaternion;
  size: THREE.Vector3;
};

const plateSyncQuaternion = new THREE.Quaternion();

const normalizeBoneName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const BONE_CANDIDATES: Record<NonNullable<PlateSpec["bone"]>, string[]> = {
  torso: ["torso", "body", "hips"],
  shoulders: ["shoulders", "torso", "body"],
  neck: ["neck", "head", "shoulders"],
  head: ["head", "neck", "shoulders"],
  back: ["back", "hips", "tail1"],
  tail: ["tail2", "tail1", "back"],
};

const inferPlateBone = (spec: PlateSpec): NonNullable<PlateSpec["bone"]> => {
  if (spec.bone) return spec.bone;
  if (spec.offset[2] > 0.8) return "head";
  if (spec.offset[2] > 0.25) return "shoulders";
  if (spec.offset[2] < -0.55) return "back";
  return "torso";
};

const findPlateBone = (
  root: THREE.Object3D,
  bucket: NonNullable<PlateSpec["bone"]>,
): THREE.Object3D => {
  const wanted = BONE_CANDIDATES[bucket];
  const found = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if (o.type !== "Bone") return;
    found.set(normalizeBoneName(o.name), o);
  });
  for (const name of wanted) {
    const bone = found.get(name);
    if (bone) return bone;
  }
  return root;
};

const bindPlateToBone = (
  mesh: THREE.Mesh,
  root: THREE.Object3D,
  spec: PlateSpec,
  scale: number,
  centerXZ: { x: number; z: number },
): void => {
  const bone = findPlateBone(root, inferPlateBone(spec));
  const desiredPosition = new THREE.Vector3(
    centerXZ.x + spec.offset[0] * scale,
    (spec.offset[1] - PLATE_VERTICAL_INSET) * scale,
    centerXZ.z + spec.offset[2] * scale,
  );
  const desiredQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(spec.rotation?.[0] ?? 0, spec.rotation?.[1] ?? 0, spec.rotation?.[2] ?? 0),
  );
  const boneWorldQuaternion = bone.getWorldQuaternion(new THREE.Quaternion());
  const localQuaternion = boneWorldQuaternion.clone().invert().multiply(desiredQuaternion);

  mesh.userData.plateBinding = {
    bone,
    localPosition: bone.worldToLocal(desiredPosition.clone()),
    localQuaternion,
    size: new THREE.Vector3(
      spec.size[0] * scale * PLATE_WIDTH_SCALE,
      spec.size[1] * scale * PLATE_HEIGHT_SCALE,
      spec.size[2] * scale * PLATE_DEPTH_SCALE,
    ),
  } satisfies PlateBinding;
};

export const syncPlateGroup = (group: THREE.Group): void => {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const binding = mesh.userData.plateBinding as PlateBinding | undefined;
    if (!mesh.isMesh || !binding) return;
    mesh.position.copy(binding.localPosition);
    binding.bone.localToWorld(mesh.position);
    binding.bone.getWorldQuaternion(plateSyncQuaternion);
    mesh.quaternion.copy(plateSyncQuaternion).multiply(binding.localQuaternion);
    mesh.scale.copy(binding.size);
  });
};

// Spawn the plate group for one enemy. The meshes live as scene siblings
// but each stores a local offset against a body/head/tail bone. Syncing the
// group every frame makes armor ride walk, attack, and death clips without
// skinning the boxes.
export const buildPlateGroup = (
  root: THREE.Object3D,
  kind: EnemyKind,
  bossVariant: BossVariant | undefined,
  effectiveTier: 1 | 2 | 3,
  renderTargetSize: number,
  centerXZ: { x: number; z: number },
): THREE.Group => {
  const baseKind = bossVariant !== undefined ? BOSS_BASE_KIND[bossVariant] : kind;
  const specs = GRAFT_PLATES[baseKind] ?? [];
  const matriarch = bossVariant !== undefined;
  const baseSize = BASE_TARGET_SIZE[baseKind];
  const scale = baseSize > 0 ? renderTargetSize / baseSize : 1;
  const group = new THREE.Group();
  const mat = getPlateMaterial();
  const geom = getPlateGeometry();
  root.updateMatrixWorld(true);
  for (const spec of specs) {
    // Matriarchs force max density: every authored plate shows.
    if (!matriarch && spec.tier > effectiveTier) continue;
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    bindPlateToBone(mesh, root, spec, scale, centerXZ);
    group.add(mesh);
  }
  syncPlateGroup(group);
  return group;
};
