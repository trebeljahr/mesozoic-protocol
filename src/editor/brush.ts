import {
  ALL_BIOME_URLS,
  BIOME_LAYERS,
  BIOME_TREE_URLS,
  type Biome,
  classifyPropUrl,
  type PropRole,
} from "../biomes";

// Brush presets + math for the dev-only scatter brush. Pure module: no
// stores, no React. Built-in presets are derived from the biome catalog at
// module load so the brush rosters automatically track src/biomes.ts — no
// hand-maintained list to drift.
//
// Two preset tiers:
//   - "Any biome" cross-biome presets (every tree, every bush, …).
//   - Per-biome presets (Forest Trees, Desert Rocks, …) sourced from
//     BIOME_LAYERS[biome] + BIOME_TREE_URLS[biome] filtered by classifyPropUrl.
// Each preset's url list is the maximum set; the editor stores a
// `customUrls` filter that narrows the active brush to a chosen subset.

export type BrushPreset = {
  id: string;
  label: string;
  // Biome scope. undefined = cross-biome ("any") group in the panel.
  biome?: Biome;
  role?: PropRole;
  urls: string[];
  weights?: number[];
  scaleJitter: [number, number];
  rotateRange: [number, number];
  defaultBlocks: boolean;
};

const uniq = (xs: string[]): string[] => Array.from(new Set(xs));

const urlsByRole = (role: PropRole): string[] =>
  uniq(ALL_BIOME_URLS).filter((u) => classifyPropUrl(u) === role);

const biomeUrls = (biome: Biome): string[] => {
  const layerUrls = BIOME_LAYERS[biome].flatMap((l) => l.urls);
  const treeUrls = BIOME_TREE_URLS[biome];
  return uniq([...layerUrls, ...treeUrls]);
};

const biomeUrlsByRole = (biome: Biome, role: PropRole): string[] =>
  biomeUrls(biome).filter((u) => classifyPropUrl(u) === role);

export const BIOME_ORDER: Biome[] = ["forest", "desert", "snow", "wasteland", "lava", "alien"];

export const BIOME_LABEL: Record<Biome, string> = {
  forest: "Forest",
  desert: "Desert",
  snow: "Snow",
  wasteland: "Wasteland",
  lava: "Lava",
  alien: "Alien",
};

// Generic role defaults. Per-biome presets inherit these — keeping the
// shape uniform means the same UI sliders apply regardless of preset.
type RoleDefaults = {
  scaleJitter: [number, number];
  defaultBlocks: boolean;
};

const ROLE_DEFAULTS: Record<PropRole, RoleDefaults> = {
  building: { scaleJitter: [0.9, 1.15], defaultBlocks: true },
  tree: { scaleJitter: [0.8, 1.4], defaultBlocks: true },
  bush: { scaleJitter: [0.7, 1.2], defaultBlocks: true },
  rock: { scaleJitter: [0.6, 1.5], defaultBlocks: true },
  grass: { scaleJitter: [0.7, 1.3], defaultBlocks: false },
  cosmetic: { scaleJitter: [0.8, 1.2], defaultBlocks: false },
};

const ROLE_LABEL: Record<PropRole, string> = {
  building: "Buildings",
  tree: "Trees",
  bush: "Bushes",
  rock: "Rocks",
  grass: "Grass",
  cosmetic: "Cosmetics",
};

const makePreset = (
  id: string,
  label: string,
  urls: string[],
  role: PropRole,
  biome?: Biome,
): BrushPreset => {
  const d = ROLE_DEFAULTS[role];
  return {
    id,
    label,
    biome,
    role,
    urls,
    scaleJitter: d.scaleJitter,
    rotateRange: [0, Math.PI * 2],
    defaultBlocks: d.defaultBlocks,
  };
};

// Cross-biome aggregate presets. Useful when the author wants any tree at
// all, regardless of biome (e.g. mixing wasteland skeletons with forest
// pines for a transitional zone).
const CROSS_BIOME_ROLES: PropRole[] = ["tree", "bush", "rock", "grass", "cosmetic"];

const crossBiomePresets: BrushPreset[] = CROSS_BIOME_ROLES.map((role) =>
  makePreset(`all-${role}`, `${ROLE_LABEL[role]} (any biome)`, urlsByRole(role), role),
);

// Per-biome presets — restricted to the obstacle roles (trees/bushes/rocks)
// since those are what differ meaningfully between biomes. Grass and cosmetic
// rosters are mostly biome-agnostic, so the cross-biome variants cover them.
const PER_BIOME_ROLES: PropRole[] = ["tree", "bush", "rock"];

const perBiomePresets: BrushPreset[] = BIOME_ORDER.flatMap((biome) =>
  PER_BIOME_ROLES.flatMap((role) => {
    const urls = biomeUrlsByRole(biome, role);
    if (urls.length === 0) return [];
    return [
      makePreset(
        `${biome}-${role}`,
        `${BIOME_LABEL[biome]} ${ROLE_LABEL[role]}`,
        urls,
        role,
        biome,
      ),
    ];
  }),
);

export const BUILTIN_BRUSH_PRESETS: BrushPreset[] = [...crossBiomePresets, ...perBiomePresets];

export const getBrushPreset = (id: string | null): BrushPreset | null => {
  if (!id) return null;
  return BUILTIN_BRUSH_PRESETS.find((p) => p.id === id) ?? null;
};

// Resolve the active url roster: customUrls narrows the preset down to a
// subset. Intersects defensively (preset.urls is the source of truth — a
// stale customUrls entry from a switched preset is silently dropped).
export const resolveBrushUrls = (preset: BrushPreset, customUrls: string[] | null): string[] => {
  if (!customUrls) return preset.urls;
  const allowed = new Set(preset.urls);
  return customUrls.filter((u) => allowed.has(u));
};

// Emit up to `density * 16` raw candidate points uniform-in-disc (sqrt for
// radial distribution). Pure geometry — no collision gating; the caller
// (paintAt) is responsible for radius-aware rejection against paths,
// rivers, existing props, and same-stroke siblings using the full role /
// scale knowledge of each candidate, and for stopping once `density`
// candidates have been accepted. Budget is `density * 16` (up from the old
// `density * 8` reject-sampling limit) since real collisions in dense
// forests / near paths reduce the acceptance rate sharply — without the
// extra attempts the brush feels weak when scattering through obstacles.
export const samplePoints = (
  center: { x: number; y: number },
  radius: number,
  density: number,
): { x: number; y: number }[] => {
  const budget = Math.max(1, Math.floor(density * 16));
  const out: { x: number; y: number }[] = new Array(budget);
  for (let i = 0; i < budget; i++) {
    const t = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    out[i] = { x: center.x + Math.cos(t) * r, y: center.y + Math.sin(t) * r };
  }
  return out;
};

// Weighted random url choice over an explicit url list. Uniform when
// `weights` is undefined or length-mismatched. Throws on empty list —
// callers should check resolved urls before invoking.
export const pickFromUrls = (urls: string[], weights?: number[]): string => {
  if (urls.length === 0) throw new Error("pickFromUrls: empty url list");
  if (!weights || weights.length !== urls.length) {
    return urls[Math.floor(Math.random() * urls.length)];
  }
  let total = 0;
  for (const w of weights) total += w;
  let pick = Math.random() * total;
  for (let i = 0; i < urls.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return urls[i];
  }
  return urls[urls.length - 1];
};

// Back-compat wrapper for callers that already had the full preset in hand.
export const pickWeighted = (preset: BrushPreset): string =>
  pickFromUrls(preset.urls, preset.weights);

export const randRange = (a: number, b: number): number => a + Math.random() * (b - a);
