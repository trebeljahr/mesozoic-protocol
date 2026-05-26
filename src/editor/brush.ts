import { ALL_BIOME_URLS, classifyPropUrl, type PropRole } from "../biomes";

// Brush presets + math for the dev-only scatter brush. Pure module: no
// stores, no React. Built-in presets are derived from ALL_BIOME_URLS at
// module load so the brush rosters automatically track the biome catalog
// — no hand-maintained list to drift.

export type BrushPreset = {
  id: string;
  label: string;
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

export const BUILTIN_BRUSH_PRESETS: BrushPreset[] = [
  {
    id: "trees-mixed",
    label: "Trees (mixed)",
    role: "tree",
    urls: urlsByRole("tree"),
    scaleJitter: [0.8, 1.4],
    rotateRange: [0, Math.PI * 2],
    defaultBlocks: true,
  },
  {
    id: "bushes",
    label: "Bushes",
    role: "bush",
    urls: urlsByRole("bush"),
    scaleJitter: [0.7, 1.2],
    rotateRange: [0, Math.PI * 2],
    defaultBlocks: true,
  },
  {
    id: "rocks",
    label: "Rocks",
    role: "rock",
    urls: urlsByRole("rock"),
    scaleJitter: [0.6, 1.5],
    rotateRange: [0, Math.PI * 2],
    defaultBlocks: true,
  },
  {
    id: "grass",
    label: "Grass",
    role: "grass",
    urls: urlsByRole("grass"),
    scaleJitter: [0.7, 1.3],
    rotateRange: [0, Math.PI * 2],
    defaultBlocks: false,
  },
  {
    id: "cosmetics",
    label: "Cosmetics",
    role: "cosmetic",
    urls: urlsByRole("cosmetic"),
    scaleJitter: [0.8, 1.2],
    rotateRange: [0, Math.PI * 2],
    defaultBlocks: false,
  },
];

export const getBrushPreset = (id: string | null): BrushPreset | null => {
  if (!id) return null;
  return BUILTIN_BRUSH_PRESETS.find((p) => p.id === id) ?? null;
};

// Poisson-disk-ish reject sampling within a disc. Candidates are uniform-in-
// disc (sqrt for radial distribution); rejected if within `minSpacing` of
// any other accepted point OR any point in `existing`. Caps at `density`
// accepted points or `density * 8` tries — whichever first. Pure (Math.random
// driven; no seed plumbing — determinism not required per task).
export const samplePoints = (
  center: { x: number; y: number },
  radius: number,
  density: number,
  minSpacing: number,
  existing: { x: number; y: number }[],
): { x: number; y: number }[] => {
  const accepted: { x: number; y: number }[] = [];
  const sqMin = minSpacing * minSpacing;
  const maxTries = Math.max(1, Math.floor(density * 8));
  for (let i = 0; i < maxTries && accepted.length < density; i++) {
    const t = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    const x = center.x + Math.cos(t) * r;
    const y = center.y + Math.sin(t) * r;
    let ok = true;
    for (const p of accepted) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < sqMin) {
        ok = false;
        break;
      }
    }
    if (ok) {
      for (const p of existing) {
        const dx = p.x - x;
        const dy = p.y - y;
        if (dx * dx + dy * dy < sqMin) {
          ok = false;
          break;
        }
      }
    }
    if (ok) accepted.push({ x, y });
  }
  return accepted;
};

// Weighted random url choice. Uniform when `weights` is undefined or
// length-mismatched. Throws on empty url list — callers should check before
// invoking.
export const pickWeighted = (preset: BrushPreset): string => {
  const urls = preset.urls;
  if (urls.length === 0) throw new Error(`Brush preset ${preset.id} has no urls`);
  const weights = preset.weights;
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

export const randRange = (a: number, b: number): number => a + Math.random() * (b - a);
