import type { Biome } from "../biomes";
import { mulberry32 } from "../sim/random";
import type { Vec2 } from "../sim/types";

// KayKit "Space Base Bits" (CC0, Kay Lousberg). A matched low-poly kit of
// white-dome habitat modules that stack (basemodule -> roofmodule), plus
// drills, landing pads, landers, solar panels, cargo and little rover
// trucks. We assemble them into authored "outpost" clusters
// that read as small modular colonies — used as set-dressing in the outer
// scenery band, as in-map blockers, on the HQ pad, and on the world map.
//
// The kit is authored on a ~2-unit grid (a dome is ~2.2 wide / 1.0 tall,
// a roofmodule 1.4 / 0.57 and seats on a dome top at native y=1.0). Every
// piece renders at one shared KIT_SCALE so the kit keeps its proportions;
// per-cluster `scale` then sizes the whole colony.

export const OUTPOST_MODEL_DIR = "/models/outpost";
// Quaternius "Ultimate Space Kit" base structures (geodesic dome and other
// habitat shells). A second CC0 kit with its OWN texture atlas, so pieces
// from it carry an explicit `dir` and the renderer keeps each kit's atlas
// separate (see OutpostClusters).
export const SPACEKIT_MODEL_DIR = "/models/spacekit";

// World units per native kit unit. A basemodule dome (native 2.2 wide,
// 1.0 tall) lands at ~2.5 wide / 1.15 tall — a touch larger than a tower
// footprint so a colony reads as a "hero" landmark without dwarfing the
// playfield.
export const KIT_SCALE = 1.15;

export const outpostUrl = (model: string, dir: string = OUTPOST_MODEL_DIR): string =>
  `${dir}/${model}.glb`;

// A single placed piece within a template, authored in native kit units
// in the template's local frame (+dx = east, +dz = north). `lift` is extra
// native-unit elevation for stacking (a roofmodule on a 1.0-tall dome uses
// lift: 1.0). `scale` is a per-piece multiplier on top of the cluster
// scale. `yaw` is a local rotation (radians) for directional pieces.
export type OutpostPart = {
  model: string;
  dx: number;
  dz: number;
  lift?: number;
  scale?: number;
  yaw?: number;
  // Asset directory the model lives in. Defaults to the KayKit outpost dir;
  // set to SPACEKIT_MODEL_DIR for Quaternius Ultimate Space Kit structures.
  dir?: string;
};

export type OutpostTemplate = {
  id: string;
  // Clearance radius in native kit units (half the colony's diagonal plus
  // a little slack). Multiplied by the cluster scale at placement time so
  // colonies never overlap each other, paths, or the playfield.
  footprint: number;
  parts: OutpostPart[];
};

// Convenience: a dome with something stacked on its 1.0-tall top.
const stack = (base: string, roof: string, dx: number, dz: number, yaw = 0): OutpostPart[] => [
  { model: base, dx, dz, yaw },
  { model: roof, dx, dz, yaw, lift: 1.0 },
];

// --- Templates --------------------------------------------------------------
// Hand-authored colony layouts. Coordinates are native kit units; the
// renderer applies KIT_SCALE + the per-cluster scale/rotation. Pieces are
// arranged to read as a working base: habitat domes clustered with a
// landing pad, a drill for vertical interest, solar banks, and scattered
// cargo / a parked rover.

// Big mining colony — two habitat towers, a drill, a landing pad with a
// lander, solar banks, cargo yard and a rover.
const MINING_COLONY: OutpostTemplate = {
  id: "mining-colony",
  footprint: 5.4,
  parts: [
    ...stack("basemodule-a", "roofmodule-solarpanels", 0, 0),
    ...stack("basemodule-c", "roofmodule-base", 2.5, 0.4, Math.PI / 2),
    { model: "drill-structure", dx: -2.4, dz: 1.6 },
    // Quaternius hab building where the KayKit landing pad + lander used to sit.
    { model: "building-l", dir: SPACEKIT_MODEL_DIR, dx: 2.8, dz: -2.8, scale: 0.33, yaw: 0.6 },
    { model: "solarpanel", dx: -3.1, dz: -1.2, yaw: -Math.PI / 2 },
    { model: "solarpanel", dx: -3.1, dz: -1.9, yaw: -Math.PI / 2 },
    { model: "solarpanel", dx: -3.1, dz: -2.6, yaw: -Math.PI / 2 },
    { model: "solarpanel", dx: -3.1, dz: -3.3, yaw: -Math.PI / 2 },
    { model: "solarpanel", dx: -3.3, dz: 2.6, yaw: -Math.PI / 2 },
    { model: "solarpanel", dx: -3.3, dz: 3.3, yaw: -Math.PI / 2 },
    { model: "crate", dir: SPACEKIT_MODEL_DIR, dx: 0.7, dz: -2.3, scale: 1.13, yaw: 0.3 },
    { model: "crate", dir: SPACEKIT_MODEL_DIR, dx: 1.5, dz: -2.6, scale: 0.58, yaw: 0.8 },
    { model: "crate", dir: SPACEKIT_MODEL_DIR, dx: -0.9, dz: -2.2, scale: 0.56 },
    { model: "spacetruck", dx: 1.2, dz: 2.1, yaw: 2.2 },
    { model: "rock-large", dir: SPACEKIT_MODEL_DIR, dx: 3.6, dz: 1.7, scale: 0.21, yaw: 1.0 },
    { model: "rock", dir: SPACEKIT_MODEL_DIR, dx: -1.6, dz: -3.0, scale: 0.18 },
    { model: "lights", dx: 1.4, dz: -0.9, scale: 0.9 },
  ],
};

// Landing outpost — pad-and-lander centred, one habitat, power + cargo.
const LANDING_OUTPOST: OutpostTemplate = {
  id: "landing-outpost",
  footprint: 4.4,
  parts: [
    // Quaternius hab building as the centerpiece (was the KayKit landing
    // pad + lander).
    { model: "building-l", dir: SPACEKIT_MODEL_DIR, dx: 0, dz: 0, scale: 0.34, yaw: 0.4 },
    ...stack("basemodule-b", "roofmodule-cargo-a", -2.7, 0.3, -Math.PI / 2),
    { model: "solarpanel", dx: 2.7, dz: 1.6, yaw: -Math.PI / 2 },
    { model: "solarpanel", dx: 2.7, dz: 2.3, yaw: -Math.PI / 2 },
    { model: "solarpanel", dx: -2.6, dz: -2.0, yaw: 0 },
    { model: "solarpanel", dx: -1.9, dz: -2.0, yaw: 0 },
    { model: "solarpanel", dx: -1.2, dz: -2.0, yaw: 0 },
    { model: "spacetruck-large", dx: 1.8, dz: -2.2, yaw: 1.6 },
    { model: "spacetruck-trailer", dx: 2.5, dz: -2.4, yaw: 1.6 },
    { model: "crate", dir: SPACEKIT_MODEL_DIR, dx: -2.3, dz: 2.2, scale: 0.56 },
    { model: "rock", dir: SPACEKIT_MODEL_DIR, dx: 2.9, dz: -0.4, scale: 0.21 },
    { model: "lights", dx: 1.5, dz: 1.4, scale: 0.9 },
  ],
};

// Comms / relay station — garage hab, low structure, solar banks east
// and west.
const RELAY_STATION: OutpostTemplate = {
  id: "relay-station",
  footprint: 3.9,
  parts: [
    ...stack("basemodule-garage", "roofmodule-base", 0, 0),
    { model: "structure-low", dx: 2.2, dz: 1.3 },
    { model: "solarpanel", dx: -2.3, dz: -1.0, yaw: -Math.PI / 2 },
    { model: "solarpanel", dx: -2.3, dz: -1.7, yaw: -Math.PI / 2 },
    { model: "solarpanel", dx: 2.2, dz: -1.6, yaw: -Math.PI / 2 },
    { model: "solarpanel", dx: 2.9, dz: -1.6, yaw: -Math.PI / 2 },
    { model: "crate", dir: SPACEKIT_MODEL_DIR, dx: -1.8, dz: 1.8, scale: 0.58, yaw: 0.5 },
    { model: "lights", dx: 1.4, dz: -1.2, scale: 0.85 },
    { model: "rock", dir: SPACEKIT_MODEL_DIR, dx: -2.6, dz: 1.9, scale: 0.18 },
  ],
};

// Supply depot — cargo yard, stacked containers, rover + trailer, one hab.
const SUPPLY_DEPOT: OutpostTemplate = {
  id: "supply-depot",
  footprint: 4.1,
  parts: [
    // Quaternius storage structures replace the KayKit cargo depots.
    { model: "base-large", dir: SPACEKIT_MODEL_DIR, dx: 0, dz: 0, scale: 0.21 },
    { model: "building-l", dir: SPACEKIT_MODEL_DIR, dx: 1.9, dz: 0.2, scale: 0.24, yaw: 0.2 },
    ...stack("basemodule-c", "roofmodule-base", -2.6, 0.4, Math.PI / 2),
    { model: "crate", dir: SPACEKIT_MODEL_DIR, dx: -0.4, dz: 2.0, scale: 0.56 },
    { model: "crate", dir: SPACEKIT_MODEL_DIR, dx: 0.6, dz: 2.1, scale: 0.56, yaw: 0.5 },
    { model: "crate", dir: SPACEKIT_MODEL_DIR, dx: -1.6, dz: -1.9, scale: 0.59, yaw: 0.6 },
    { model: "spacetruck", dx: 2.0, dz: -2.1, yaw: 2.0 },
    { model: "solarpanel", dx: 2.6, dz: 1.8, yaw: -Math.PI / 2 },
    { model: "lights", dx: 1.2, dz: -1.0, scale: 0.85 },
  ],
};

// Compact solar/research post — small, for tighter pockets.
const SOLAR_POST: OutpostTemplate = {
  id: "solar-post",
  footprint: 3.2,
  parts: [
    ...stack("basemodule-a", "roofmodule-solarpanels", 0, 0),
    { model: "solarpanel", dx: -2.0, dz: 0.0, yaw: -Math.PI / 2 },
    { model: "solarpanel", dx: -2.0, dz: -0.7, yaw: -Math.PI / 2 },
    { model: "solarpanel", dx: -2.0, dz: 0.7, yaw: -Math.PI / 2 },
    { model: "solarpanel", dx: 1.9, dz: 0.6, yaw: -Math.PI / 2 },
    { model: "solarpanel", dx: 1.9, dz: 1.3, yaw: -Math.PI / 2 },
    { model: "solarpanel", dx: 1.9, dz: 2.0, yaw: -Math.PI / 2 },
    { model: "crate", dir: SPACEKIT_MODEL_DIR, dx: 1.6, dz: -1.4, scale: 0.58, yaw: 0.5 },
    { model: "rock", dir: SPACEKIT_MODEL_DIR, dx: -1.0, dz: 1.8, scale: 0.18 },
  ],
};

// The player's HQ command base, placed on each HQ pad behind the turret.
// Local frame matches HQBase: +dz points toward the approach (where the
// turret faces), so all structures sit at dz ≤ 0 (behind/around the gun)
// leaving the front of the pad open for the turret + landing markings.
export const HQ_COMMAND_TEMPLATE: OutpostTemplate = {
  id: "hq-command",
  footprint: 3.6,
  parts: [
    // Command dome dead-centre at the back — a Quaternius Ultimate Space
    // Kit geodesic dome as the HQ's signature structure. `scale` brings the
    // kit's large native mesh (~8.5 native wide) down to ~2.5 world wide so
    // it reads at the same footprint as the KayKit habs flanking it.
    { model: "geodesicdome", dir: SPACEKIT_MODEL_DIR, dx: 0, dz: -1.9, scale: 0.3 },
    // Flanking habs. structure-tall is the hive-drone mesh, so the right
    // flank is a second habitat stack rather than reusing that model.
    ...stack("basemodule-c", "roofmodule-solarpanels", -2.5, -0.6, Math.PI / 2),
    ...stack("basemodule-b", "roofmodule-cargo-a", 2.5, -1.4, -Math.PI / 2),
    // Right-side Quaternius hab pod (was the KayKit landing pad + lander).
    { model: "house-cylinder", dir: SPACEKIT_MODEL_DIR, dx: 2.6, dz: 0.7, scale: 0.28, yaw: 0.5 },
    // Back-row solar + supplies.
    { model: "solarpanel", dx: -1.0, dz: -2.5, yaw: 0 },
    { model: "solarpanel", dx: -0.3, dz: -2.5, yaw: 0 },
    { model: "crate", dir: SPACEKIT_MODEL_DIR, dx: 1.3, dz: -2.4, scale: 1.13, yaw: 0.3 },
    { model: "crate", dir: SPACEKIT_MODEL_DIR, dx: -2.6, dz: 0.9, scale: 0.56 },
    { model: "lights", dx: 1.5, dz: -0.4, scale: 0.85 },
  ],
};

export const OUTPOST_TEMPLATES: OutpostTemplate[] = [
  MINING_COLONY,
  LANDING_OUTPOST,
  RELAY_STATION,
  SUPPLY_DEPOT,
  SOLAR_POST,
];

export const OUTPOST_BY_ID: Record<string, OutpostTemplate> = Object.fromEntries(
  OUTPOST_TEMPLATES.map((t) => [t.id, t]),
);

// Template ids by tier — placement (in sim/world.ts) draws hero templates
// for roomy spots (outer band) and compact ones for tight interior pockets.
export const HERO_TEMPLATE_IDS = ["mining-colony", "landing-outpost", "supply-depot"] as const;
export const COMPACT_TEMPLATE_IDS = ["relay-station", "solar-post"] as const;

// World-unit clearance radius for a placed cluster.
export const outpostRadius = (template: OutpostTemplate, scale: number): number =>
  template.footprint * KIT_SCALE * scale;

const HERO_TEMPLATES = [MINING_COLONY, LANDING_OUTPOST, SUPPLY_DEPOT, RELAY_STATION];
const COMPACT_TEMPLATES = [SOLAR_POST, RELAY_STATION];

export type PlacedOutpost = {
  template: OutpostTemplate;
  pos: Vec2;
  yaw: number;
  scale: number;
};

// Every model URL referenced by any template (scatter colonies + the HQ
// command base) — for useGLTF.preload. HQ_COMMAND_TEMPLATE is included so
// its Quaternius geodesic dome warms with the rest of the kit.
export const ALL_OUTPOST_URLS: string[] = (() => {
  const set = new Set<string>();
  for (const t of [...OUTPOST_TEMPLATES, HQ_COMMAND_TEMPLATE])
    for (const p of t.parts) set.add(outpostUrl(p.model, p.dir));
  return [...set];
})();

export const pickHeroTemplate = (rng: () => number): OutpostTemplate =>
  HERO_TEMPLATES[Math.floor(rng() * HERO_TEMPLATES.length)];

export const pickCompactTemplate = (rng: () => number): OutpostTemplate =>
  COMPACT_TEMPLATES[Math.floor(rng() * COMPACT_TEMPLATES.length)];

// Biome flavour: every world gets colonies (framed as research outposts in
// the lush biomes, mining/landing colonies in the barren ones), but the
// barren worlds — where the orange-rock Mars look fits best — get one more.
export const outpostBiomeConfig = (biome: Biome): { band: number; interior: number } => {
  switch (biome) {
    case "desert":
    case "wasteland":
    case "lava":
    case "alien":
      return { band: 3, interior: 1 };
    default: // forest, snow
      return { band: 2, interior: 1 };
  }
};

// Hero-sized clusters with a little per-cluster variety.
export const outpostScaleBand = (_biome: Biome): { min: number; max: number } => ({
  min: 1.0,
  max: 1.25,
});

export const outpostRng = mulberry32;
