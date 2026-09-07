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

// Emit raw candidate points uniform-in-disc (sqrt for radial
// distribution). Pure geometry — no collision gating; the caller (paintAt)
// is responsible for radius-aware rejection against paths, rivers, existing
// props, and same-stroke siblings using the full role / scale knowledge of
// each candidate, and for stopping once the pass budget is spent. Callers
// pass an explicit `attempts` budget because the useful number of tries is
// driven by how crowded the patch already is, not by how many instances the
// pass wants to add — a nearly-full patch needs many probes to land two more
// trees. Defaults to `density * 16` for callers that don't care.
export const samplePoints = (
  center: { x: number; y: number },
  radius: number,
  density: number,
  attempts?: number,
): { x: number; y: number }[] => {
  const budget = Math.max(1, Math.floor(attempts ?? density * 16));
  const out: { x: number; y: number }[] = new Array(budget);
  for (let i = 0; i < budget; i++) {
    const t = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    out[i] = { x: center.x + Math.cos(t) * r, y: center.y + Math.sin(t) * r };
  }
  return out;
};

// --- Accumulating density model -------------------------------------------
//
// A brush pass adds at most `density` instances, so painting the same spot
// repeatedly builds the patch up gradually instead of slamming it to its
// final state on the first tick. The ceiling that stops it growing forever
// is expressed as a COVERAGE fraction rather than an instance count: the
// summed footprint area of everything already inside the brush disc must
// stay under `fillPercent` of the disc's area. Coverage adapts across
// rosters for free — five trees fill a radius-4 disc about as much as fifty
// grass tufts do — where a flat "max N props" cap would be far too dense for
// trees and far too sparse for grass.
//
// Hexagonal circle packing tops out near 91% coverage, so fills above that
// are simply unreachable and the collision test becomes the binding limit.

// Footprint area of one instance with effective (collision) radius `r`.
export const footprintArea = (r: number): number => Math.PI * r * r;

// Total footprint area a patch of `radius` may hold at `fillPercent`.
export const patchAreaBudget = (radius: number, fillPercent: number): number => {
  const fill = Math.max(0, Math.min(100, fillPercent)) / 100;
  return Math.PI * radius * radius * fill;
};

// Order a patch's instances for thinning: nearest-to-centre first, with a
// random jitter so repeated thinning passes carve out of the middle rather
// than deterministically peeling the same ring every tick.
export const pickThinTargets = <T>(
  items: T[],
  posOf: (t: T) => { x: number; y: number },
  center: { x: number; y: number },
  radius: number,
  count: number,
): T[] => {
  if (count <= 0) return [];
  const norm = Math.max(radius, 1e-6);
  const scored = items.map((it) => {
    const p = posOf(it);
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    return { it, score: Math.sqrt(dx * dx + dy * dy) / norm + Math.random() * 0.6 };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, count).map((e) => e.it);
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
