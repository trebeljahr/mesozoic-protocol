// Per-enemy eye anchors and color tables for the instanced eye-glow pass.
//
// Enemy GLBs come from mixed third-party packs whose eye meshes are flat-
// shaded with no emissive. At gameplay zoom on an orthographic camera they
// vanish. EnemyEyes.tsx paints additive billboard quads over each enemy
// using anchor offsets from this table so every dinosaur reads "alive".
//
// Anchors are expressed as fractions of the mount's `targetSize`, so the
// same table covers regular species and their oversized matriarch mounts
// (Scene.tsx scales the matriarch mounts up via targetSize, not normalizedScale
// post-hoc).

import type { BossVariant, EnemyKind } from "../sim/types";
import { ENEMY_EMISSIVE } from "./emissiveRegistry";
import { MATRIARCH_CONDUIT_COLOR, MATRIARCH_VARIANT_BIOME } from "./materialTunables";

export type EyeAnchor = {
  // Vertical offset above the obj root (= ground for non-bobbing kinds),
  // forward offset (model-local +z, aligned with body yaw), and side spread
  // for the eye pair. All values are fractions of targetSize.
  y: number;
  z: number;
  dx: number;
  // Sprite half-extent. Final quad size = radius * BILLBOARD_SCALE world units.
  radius: number;
};

// Per-URL anchor data — keyed by GLB path so matriarchs (same GLB, bigger
// targetSize) inherit the same head placement. Hand-tuned starting values;
// adjust by visual inspection.
const EYE_ANCHORS_BY_URL: Record<string, EyeAnchor[]> = {
  "/models/Velociraptor.glb": [{ y: 0.62, z: 0.46, dx: 0.06, radius: 0.07 }],
  "/models/Trex.glb": [{ y: 0.68, z: 0.5, dx: 0.075, radius: 0.075 }],
  "/models/Stegosaurus.glb": [{ y: 0.22, z: 0.42, dx: 0.05, radius: 0.055 }],
  "/models/Triceratops.glb": [{ y: 0.26, z: 0.44, dx: 0.07, radius: 0.06 }],
  "/models/Parasaurolophus.glb": [{ y: 0.56, z: 0.48, dx: 0.055, radius: 0.06 }],
  "/models/Apatosaurus.glb": [{ y: 0.56, z: 0.48, dx: 0.028, radius: 0.045 }],
};

const hexRGB = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  return [
    Number.parseInt(h.slice(0, 2), 16) / 255,
    Number.parseInt(h.slice(2, 4), 16) / 255,
    Number.parseInt(h.slice(4, 6), 16) / 255,
  ];
};

// Species eye color is sourced from the emissive registry so the
// instanced billboard tint stays in sync with whatever the body-emissive
// pass applies to a "eye"-named sub-mesh when one exists. Default falls
// back to bio-green if the registry omits the kind.
const SPECIES_EYE_FALLBACK: [number, number, number] = hexRGB("#7eff8c");

const speciesEyeColor = (kind: EnemyKind): [number, number, number] => {
  const spec = ENEMY_EMISSIVE[kind]?.[0]?.spec;
  if (!spec) return SPECIES_EYE_FALLBACK;
  const rgb = hexRGB(typeof spec.color === "string" ? spec.color : "#7eff8c");
  // The registry's `intensity` boosts the emissive shader uniform on the
  // sub-mesh; mirror it as a brightness multiplier on the billboard so a
  // titan and a raptor read at roughly the same eye intensity even though
  // their billboard size differs.
  const mul = Math.max(0.6, Math.min(2.5, spec.intensity ?? 1));
  return [rgb[0] * mul, rgb[1] * mul, rgb[2] * mul];
};

// Matriarch eye color is the biome bio-conduit accent — same hue as the
// spine emissive strip the material pipeline already applies, so eyes and
// conduit read as the same "this queen's biotech glows X." Apex variant
// (alien biome) gives the apex matriarch magenta eyes; lava/wasteland
// give ember orange; snow gives cyan; etc.
export const eyeColorFor = (
  kind: EnemyKind,
  variant: BossVariant | undefined,
): [number, number, number] => {
  if (kind === "boss" && variant) {
    const biome = MATRIARCH_VARIANT_BIOME[variant];
    return hexRGB(MATRIARCH_CONDUIT_COLOR[biome]);
  }
  return speciesEyeColor(kind);
};

// Resolve anchor-fractions × targetSize into concrete per-instance offset
// data the renderer can consume directly. Each EyeAnchor with dx > 0 expands
// into a left + right eye pair so EnemyEyes doesn't have to special-case
// pairs in its inner loop.
export type EyePosition = { x: number; y: number; z: number; radius: number };

export const buildEyePositions = (url: string, targetSize: number): EyePosition[] => {
  const anchors = EYE_ANCHORS_BY_URL[url];
  if (!anchors) return [];
  const out: EyePosition[] = [];
  for (const a of anchors) {
    const sx = a.dx * targetSize;
    const sy = a.y * targetSize;
    const sz = a.z * targetSize;
    const sr = a.radius * targetSize;
    if (a.dx > 0) {
      out.push({ x: -sx, y: sy, z: sz, radius: sr });
      out.push({ x: sx, y: sy, z: sz, radius: sr });
    } else {
      out.push({ x: 0, y: sy, z: sz, radius: sr });
    }
  }
  return out;
};

// Per-enemy eye profile published once at mount/recycle and consumed by the
// global EnemyEyes renderer each frame. Avoids re-keying anchors per frame
// and decouples the profile lifetime from the registry-transform fast path.
export type EnemyEyeProfile = {
  positions: EyePosition[];
  baseColor: [number, number, number];
  // Per-enemy phase offset for the idle pulse — keeps a swarm of identical
  // kind out of sync so they don't blink in lockstep.
  pulseSeed: number;
};

const profiles = new Map<number, EnemyEyeProfile>();

export const setEnemyEyeProfile = (id: number, p: EnemyEyeProfile): void => {
  profiles.set(id, p);
};

export const getEnemyEyeProfile = (id: number): EnemyEyeProfile | undefined => profiles.get(id);

export const clearEnemyEyeProfile = (id: number): void => {
  profiles.delete(id);
};

export const clearAllEnemyEyeProfiles = (): void => {
  profiles.clear();
};
