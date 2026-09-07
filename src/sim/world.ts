import {
  BIOME_LAYERS,
  BIOME_TREE_SCALE_MUL,
  BIOME_TREE_SCALE_RANGE,
  type Biome,
  type BiomeLayer,
  biomeForPos,
} from "../biomes";
import { EASTER_EGG_BY_ID, EASTER_EGG_DEFS, type EasterEggDef } from "../easterEggs";
import {
  buildFlowFeatures,
  type FlowFeatures,
  hasFlowFeatures,
  isOnFlowSurface,
} from "../flowGeometry";
import {
  HQ_PAD_BLOCKER_RADIUS,
  MAP_HEIGHT,
  MAP_WIDTH,
  PATH_ENTRY_MARGIN_X,
  PATH_ENTRY_MARGIN_Y,
  PATH_WIDTH,
} from "../level";
import { type LevelConfig, resolveLevelMode, scaleWaveCounts } from "../levels";
import { DIFFICULTY_MULTIPLIERS, type DifficultyMultipliers, type LevelMode } from "../progress";
import {
  COMPACT_TEMPLATE_IDS,
  HERO_TEMPLATE_IDS,
  OUTPOST_BY_ID,
  outpostBiomeConfig,
  outpostRadius,
  outpostScaleBand,
} from "../render/outpostKit";
import { availableDamageTypes, ensureImmunityCoverage } from "./immunityCoverage";
import { prependLeadInToBounds, samplePath, smoothPath } from "./path";
import { poissonDiskSample } from "./poisson";
import { mulberry32 } from "./random";
import { rollDinoBoltDrop } from "./robotBolts";
import {
  type AllRobotSkills,
  applyRobotSkillsToRobot,
  levelForXp,
  xpForEnemyKill,
} from "./robotSkills";
import { ROBOT_SPECS } from "./robotVariants";
import type {
  AuthoredLake,
  AutoBridge,
  Beam,
  BeamPoint,
  BossVariant,
  CoalEmber,
  CryoWave,
  DamageType,
  EasterEgg,
  EasterEggScheduleEntry,
  EndlessState,
  Enemy,
  EnemyKind,
  EntityId,
  Explosion,
  GameEvent,
  Outpost,
  PlacedEasterEgg,
  PlacedProp,
  Projectile,
  ProjectileKind,
  River,
  Robot,
  RobotVariant,
  Rock,
  Tower,
  TowerKind,
  Tree,
  Vec2,
  World,
} from "./types";
import { distPointToSegSq } from "./vec2";
import { createWorleyField } from "./worley";

export const STARTING_LIVES = 20;

// HQ base weapon — a short-range kinetic laser bolted onto the HQ
// turret. Last-ditch defense: tight range so it only engages enemies
// already close to the gate, modest damage that scales through two
// upgrade branches. One set of stats applies to every HQ on the map
// (multi-path levels each fire their own beam from these shared stats).
export const BASE_RANGE = 4.8;
export const BASE_DAMAGE = 8;
export const BASE_FIRE_RATE = 1.0;

// Per-wave HP multiplier within a level, ramped by the wave's POSITION in
// the level (not its absolute index): the first wave is unchanged and the
// final wave is scaled by (1 + rampMax). Folded into hpMul at world creation
// alongside difficulty.hp so the back half of a level stays threatening once
// the player's board is fully upgraded. Position-relative on purpose — a
// 20-wave level's wave 8 is still early and must not inherit a 10-wave
// level's wave-8 (near-end) escalation, which would over-tank long late
// campaign levels. `rampMax` comes from DifficultyMultipliers.lateWaveHpRamp
// (0 on easy/medium). Exported so the feasibility analyzer applies the same
// curve.
export const lateWaveHpFactor = (waveIndex: number, waveCount: number, rampMax: number): number => {
  if (rampMax === 0 || waveCount <= 1) return 1;
  return 1 + rampMax * (waveIndex / (waveCount - 1));
};

// Robot unit — single controllable mecha that walks the field, auto-shoots
// dinos in range, and fires three activated abilities. Stats now ship
// from robotVariants.ROBOT_SPECS so per-mech balance lives there; this
// module keeps only platform constants (collision radius, respawn delay).
export const ROBOT_RADIUS = 0.45;
export const ROBOT_RESPAWN_DELAY = 6.0;
// Permanent max-HP bonus the robot earns at every level beyond 1. Level
// 5 = +60 HP, level 10 = +135 HP. Stacks on top of the Vitality skill
// node so leveling matters in its own right (the skill node is a
// player-chosen upside, this is the inherent reward for surviving).
export const ROBOT_HP_PER_LEVEL = 15;

// Bonus max-HP the robot would have at this level (level 1 → 0).
export const robotLevelHpBonus = (level: number): number =>
  Math.max(0, (level - 1) * ROBOT_HP_PER_LEVEL);

const robotDefaults = (variant: RobotVariant, pos: Vec2, id: EntityId, xp: number): Robot => {
  const spec = ROBOT_SPECS[variant];
  const level = levelForXp(xp);
  const bonusHp = robotLevelHpBonus(level);
  return {
    id,
    variant,
    pos: { x: pos.x, y: pos.y },
    vel: { x: 0, y: 0 },
    facing: 0,
    hp: spec.maxHp + bonusHp,
    maxHp: spec.maxHp + bonusHp,
    damage: spec.damage,
    range: spec.range,
    fireRate: spec.fireRate,
    speed: spec.speed,
    attackSplashRadius: spec.attackSplashRadius,
    damageType: spec.damageType,
    attackCooldown: 0,
    abilityReadyAt: [0, 0, 0, 0],
    abilityActiveUntil: [0, 0, 0, 0],
    abilityCooldownMul: 1,
    damageMul: 1,
    fireRateMul: 1,
    speedMul: 1,
    damageResist: 0,
    kills: 0,
    damageDealt: 0,
    payload: null,
    selfBuff: null,
    pendingShots: [],
    targetId: null,
    moveTarget: null,
    lateralOffset: 0,
    pathIndex: 0,
    alive: true,
    flashUntil: 0,
    shootFlashUntil: 0,
    respawnAt: null,
    iFrameUntil: 0,
    lastDamagedAt: -1000,
    selected: false,
    xp,
    level,
    stuckTimer: 0,
    hovering: false,
    hoverHeight: 0,
    motionState: "idle",
    footstepAccum: 0,
    lastDeathAt: -1000,
    dashAim: null,
    mikeCoalDropAt: 0,
    pendingCrit: null,
    muzzlePos: null,
  };
};

export const TREE_COUNT = 22;
// Trees clump into a handful of groves rather than evenly speckling the
// map. The Worley field plants this many "grove centres"; Poisson then
// fills around them at variable spacing.
const TREE_GROVE_COUNT = 5;
const TREE_GROVE_RADIUS = 3.8;
// Looser-than-min spacing in low-density (between-grove) regions.
const TREE_MAX_SPACING = 7.0;
export const TREE_VARIANTS = 4;
export const TREE_CLEARANCE_MARGIN = 2.3;
// Wider range with a slight central bias gives a more natural mix —
// most trees mid-sized, with the occasional sapling and elder.
export const TREE_MIN_SCALE = 0.5;
export const TREE_MAX_SCALE = 1.1;
export const TREE_MIN_SPACING = 2.9;
export const TREE_FOOTPRINT = 0.85;
export const TREE_REMOVE_COST = 10;

// ── On-field size anchor (world units ≈ metres) ─────────────────────────────
// Asset packs export at wildly different native scales (a desert tree GLB is
// ~1 unit tall, a snow pine ~4), so the old raw per-instance multipliers made
// trees "all over the place" next to dinos and towers. To keep the field
// readable every on-field thing is sized off one real-ish anchor of roughly
// 1 world unit ≈ 3 metres:
//   • large dinos (allosaur…)   → ~2–3.3 max-dim, i.e. a ~9 m body (Scene.tsx)
//   • turrets / HQ              → 1.55–1.9 max-dim ≈ a ~5 m emplacement
//   • clearable obstacle trees  → TREE_TARGET_HEIGHT height (this constant)
//   • biome-layer scenery       → BiomeLayer.normalizeTo / TARGET_SIZE_BY_ROLE
// A typical grown tree (TREE_TARGET_HEIGHT × the ~0.8 mean of the per-instance
// variety) lands a bit above a turret and level with a big dino's head-reach,
// and a touch taller than the background conifer layers, so dino ≈ tree ≈ tower
// reads consistently instead of one family dwarfing the rest.
// Trees.tsx divides this by each variant's measured native height to get the
// per-variant scale, then applies the per-instance sapling↔elder variety on top.
export const TREE_TARGET_HEIGHT = 3.0;

// Rock footprint radius (before per-instance scale multiplier).
export const ROCK_FOOTPRINT = 0.65;
export const ROCK_MIN_SPACING = 1.85;
export const ROCK_REMOVE_COST = 15;

const blockingFootprint = (spec: BiomeLayer): number => spec.footprint ?? ROCK_FOOTPRINT;

// Per-URL XZ radius cache — populated by render components (Trees.tsx,
// Rocks.tsx) when GLBs load, read by canPlaceAt for placement blocking.
export const meshXZRadii = new Map<string, number>();

// Stable key for a procedurally generated item — encodes its position
// verbatim. Procedural generation is fully deterministic for a given seed,
// so the same item always lands at the same float coordinates across world
// rebuilds, and Number→String is bit-identical for identical floats. The
// editor's erased-procedural mask keys items by this so erasures persist
// across reloads and reseeds (until the seed itself changes).
export const proceduralPosKey = (p: { x: number; y: number }): string => `${p.x},${p.y}`;

const buildTrees = (
  paths: Vec2[][],
  seed: number,
  firstId: number,
  flow: FlowFeatures | null,
  biome: Biome,
  outposts: Outpost[],
): { trees: Tree[]; nextId: number } => {
  const biomeScale = BIOME_TREE_SCALE_MUL[biome] ?? 1;
  const treeRange = BIOME_TREE_SCALE_RANGE[biome];
  const treeMinScale = treeRange?.min ?? TREE_MIN_SCALE;
  const treeMaxScale = treeRange?.max ?? TREE_MAX_SCALE;
  const clearance = PATH_WIDTH / 2 + TREE_CLEARANCE_MARGIN;
  const pathR2 = clearance * clearance;
  const halfW = MAP_WIDTH / 2 + 11;
  const halfH = MAP_HEIGHT / 2 + 9;
  const bounds = { minX: -halfW, maxX: halfW, minY: -halfH, maxY: halfH };

  // Worley field: scatter TREE_GROVE_COUNT "grove centres" — density is
  // 1 at a centre, smoothly decaying to 0 at TREE_GROVE_RADIUS. Poisson
  // packs tight inside groves (TREE_MIN_SPACING), loose between them
  // (TREE_MAX_SPACING) — natural-looking woodland rather than even mat.
  const worley = createWorleyField(seed, bounds, TREE_GROVE_COUNT, TREE_GROVE_RADIUS);
  const radiusAt = (x: number, y: number): number => {
    const d = worley.density(x, y);
    return TREE_MIN_SPACING + (1 - d) * (TREE_MAX_SPACING - TREE_MIN_SPACING);
  };

  // Pre-compute HQ blocker centres so trees never spawn inside (or just
  // outside) the home-base fence — HQBase.tsx renders its own authored
  // set-dressing there and scattered trees would clip into buildings.
  const hqCenters = paths.filter((p) => p.length >= 2).map((p) => p[p.length - 1]);
  const hqR2 = (HQ_PAD_BLOCKER_RADIUS + TREE_FOOTPRINT) ** 2;

  const isValid = (x: number, y: number): boolean => {
    if (isOnFlowSurface(flow, x, y, TREE_FOOTPRINT)) return false;
    for (const path of paths) {
      for (let i = 0; i < path.length - 1; i++) {
        if (distPointToSegSq(x, y, path[i].x, path[i].y, path[i + 1].x, path[i + 1].y) < pathR2) {
          return false;
        }
      }
    }
    for (const c of hqCenters) {
      const dx = c.x - x;
      const dy = c.y - y;
      if (dx * dx + dy * dy < hqR2) return false;
    }
    for (const o of outposts) {
      const dx = o.pos.x - x;
      const dy = o.pos.y - y;
      const lim = o.radius + TREE_FOOTPRINT;
      if (dx * dx + dy * dy < lim * lim) return false;
    }
    return true;
  };

  const points = poissonDiskSample({
    bounds,
    radiusAt,
    isValid,
    maxCount: TREE_COUNT,
    seed: seed * 31 + 17,
    // Seed Bridson with each grove centre so the placement spreads
    // across all groves rather than packing TREE_COUNT trees around
    // the first one the algorithm walks into.
    initialPoints: worley.features,
  });

  // Variant/scale/rot stream is independent so changes to count/spacing
  // don't shift these per-tree details when only one factor moves.
  const rng = mulberry32(seed * 53 + 91);
  const trees: Tree[] = [];
  let nextId = firstId;
  for (const p of points) {
    trees.push({
      id: nextId++,
      pos: { x: p.x, y: p.y },
      variant: Math.floor(rng() * TREE_VARIANTS),
      // Triangular distribution (avg of two uniforms) biases toward mid-size,
      // so saplings and elders are uncommon but visible. Biomes with a tight
      // BIOME_TREE_SCALE_RANGE (alien) collapse this to a uniform big size.
      scale: (treeMinScale + ((rng() + rng()) / 2) * (treeMaxScale - treeMinScale)) * biomeScale,
      rot: rng() * Math.PI * 2,
    });
  }
  return { trees, nextId };
};

// Per-layer rock-to-rock spacing multiplier — sparse-region Poisson
// radius is ROCK_MIN_SPACING × this. Tuned so the variation between
// "rock pile centre" and "loose stones" reads naturally.
const ROCK_MAX_SPACING_MUL = 3.0;

const buildRocks = (
  biome: Biome,
  paths: Vec2[][],
  trees: Tree[],
  firstId: number,
  flow: FlowFeatures | null,
  levelId: number,
  outposts: Outpost[],
): { rocks: Rock[]; nextId: number } => {
  const rocks: Rock[] = [];
  const halfW = MAP_WIDTH / 2 + 11;
  const halfH = MAP_HEIGHT / 2 + 9;
  const bounds = { minX: -halfW, maxX: halfW, minY: -halfH, maxY: halfH };
  let nextId = firstId;

  const hqCenters = paths.filter((p) => p.length >= 2).map((p) => p[p.length - 1]);

  const layers = BIOME_LAYERS[biome];
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const spec = layers[layerIndex];
    if (!spec.blocks) continue;
    const seedBase = spec.seed + levelId * 1013 + layerIndex * 97;

    // Each blocking layer gets its own Worley field — different layers
    // in the same biome have independent feature positions so a rock-
    // pile centre and a crystal-cluster centre don't always line up.
    const sigma = spec.cluster?.sigma ?? 2.5;
    const featureRadius = sigma * 2.0;
    const featureCount = spec.cluster?.seeds ?? 5;
    const worley = createWorleyField(seedBase, bounds, featureCount, featureRadius);
    const baseFootprint = blockingFootprint(spec);
    const avgScale = (spec.minScale + spec.maxScale) / 2;
    const candidateR = baseFootprint * spec.maxScale;
    const treeSpacing = candidateR + TREE_FOOTPRINT * 0.8;
    const treeSpacingSq = treeSpacing * treeSpacing;
    const rMin = Math.max(ROCK_MIN_SPACING, 2 * baseFootprint * avgScale + 0.4);
    const rMax = rMin * ROCK_MAX_SPACING_MUL;
    const radiusAt = (x: number, y: number): number => {
      const d = worley.density(x, y);
      return rMin + (1 - d) * (rMax - rMin);
    };

    const pathR2 = spec.clearance * spec.clearance;
    // Snapshot rocks from earlier layers so this layer's Poisson treats
    // them as fixed blockers (no overlap regardless of within-layer
    // density variation).
    const earlierRocks = rocks.slice();
    // Conservative flow-surface check — use max scale footprint so a max-scale
    // rock at this position couldn't touch the rivers/lakes either.
    const flowFootprint = candidateR + 0.1;

    const hqRockR2 = (HQ_PAD_BLOCKER_RADIUS + candidateR) ** 2;

    const isValid = (x: number, y: number): boolean => {
      if (isOnFlowSurface(flow, x, y, flowFootprint)) return false;
      for (const path of paths) {
        for (let i = 0; i < path.length - 1; i++) {
          if (distPointToSegSq(x, y, path[i].x, path[i].y, path[i + 1].x, path[i + 1].y) < pathR2) {
            return false;
          }
        }
      }
      for (const c of hqCenters) {
        const dx = c.x - x;
        const dy = c.y - y;
        if (dx * dx + dy * dy < hqRockR2) return false;
      }
      for (const o of outposts) {
        const dx = o.pos.x - x;
        const dy = o.pos.y - y;
        const lim = o.radius + candidateR;
        if (dx * dx + dy * dy < lim * lim) return false;
      }
      for (const tr of trees) {
        const dx = tr.pos.x - x;
        const dy = tr.pos.y - y;
        if (dx * dx + dy * dy < treeSpacingSq) return false;
      }
      for (const r of earlierRocks) {
        const dx = r.pos.x - x;
        const dy = r.pos.y - y;
        const priorSpec = layers[r.layerIndex];
        const priorR = (priorSpec ? blockingFootprint(priorSpec) : ROCK_FOOTPRINT) * r.scale;
        const minDist = candidateR + priorR + 0.45;
        if (dx * dx + dy * dy < minDist * minDist) return false;
      }
      return true;
    };

    const points = poissonDiskSample({
      bounds,
      radiusAt,
      isValid,
      maxCount: spec.count,
      seed: seedBase * 31 + 17,
      // Seed Bridson with each Worley feature so every rock pile gets
      // its own frontier instead of all `spec.count` rocks stacking
      // around the first feature the algorithm reaches.
      initialPoints: worley.features,
    });

    const detailRng = mulberry32(seedBase * 53 + 91);
    for (const p of points) {
      const variant = Math.floor(detailRng() * spec.urls.length);
      const scale =
        spec.minScale + ((detailRng() + detailRng()) / 2) * (spec.maxScale - spec.minScale);
      const rot = detailRng() * Math.PI * 2;
      rocks.push({
        id: nextId++,
        pos: { x: p.x, y: p.y },
        layerIndex,
        variant,
        scale,
        rot,
      });
    }
  }
  return { rocks, nextId };
};

const pickWeightedEgg = (defs: EasterEggDef[], rng: () => number): EasterEggDef => {
  let total = 0;
  for (const d of defs) total += d.spawnWeight ?? 1;
  let pick = rng() * total;
  for (const d of defs) {
    pick -= d.spawnWeight ?? 1;
    if (pick <= 0) return d;
  }
  return defs[defs.length - 1];
};

const buildEasterEggs = (
  biome: Biome,
  paths: Vec2[][],
  trees: Tree[],
  rocks: Rock[],
  outposts: Outpost[],
  seed: number,
  firstId: number,
  flow: FlowFeatures | null,
  triggeredEggsOnLevel: ReadonlySet<string>,
): { eggs: EasterEgg[]; nextId: number } => {
  // Only consider statically-placed eggs here — moving ones spawn on a
  // schedule via updateEasterEggs. Eggs already triggered on this level
  // never spawn again so each surprise lands once per map.
  const matching = EASTER_EGG_DEFS.filter(
    (d) => d.biomes.includes(biome) && !d.motion && !triggeredEggsOnLevel.has(d.id),
  );
  if (matching.length === 0) return { eggs: [], nextId: firstId };
  const rng = mulberry32(seed);
  if (rng() > 0.42) return { eggs: [], nextId: firstId };
  const def = pickWeightedEgg(matching, rng);
  const clearance = PATH_WIDTH / 2 + 1.5;
  const pathR2 = clearance * clearance;
  const minPropGap = 1.4;
  const minGapSq = minPropGap * minPropGap;
  let attempts = 0;
  while (attempts < 80) {
    attempts++;
    const x = (rng() - 0.5) * MAP_WIDTH * 0.88;
    const y = (rng() - 0.5) * MAP_HEIGHT * 0.88;
    if (isOnFlowSurface(flow, x, y, 0.6)) continue;
    let blocked = false;
    for (const path of paths) {
      for (let i = 0; i < path.length - 1; i++) {
        if (distPointToSegSq(x, y, path[i].x, path[i].y, path[i + 1].x, path[i + 1].y) < pathR2) {
          blocked = true;
          break;
        }
      }
      if (blocked) break;
    }
    if (blocked) continue;
    for (const t of trees) {
      const dx = t.pos.x - x;
      const dy = t.pos.y - y;
      if (dx * dx + dy * dy < minGapSq) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    for (const r of rocks) {
      const dx = r.pos.x - x;
      const dy = r.pos.y - y;
      if (dx * dx + dy * dy < minGapSq) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    for (const o of outposts) {
      const dx = o.pos.x - x;
      const dy = o.pos.y - y;
      const lim = o.radius + minPropGap;
      if (dx * dx + dy * dy < lim * lim) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    const egg: EasterEgg = {
      id: firstId,
      defId: def.id,
      pos: { x, y },
      rotY: rng() * Math.PI * 2,
      clickCount: 0,
      triggered: false,
      vel: null,
      despawnAt: null,
      spin: 0,
      rollPitch: 0,
    };
    return { eggs: [egg], nextId: firstId + 1 };
  }
  return { eggs: [], nextId: firstId };
};

// Translate the editor's authored placements into runtime egg state. Static
// defs become live entries on `eggs`; motion defs become schedule entries
// that fire at a deterministic offset (10s + index*8s so multiple authored
// tumbleweeds don't all enter on the same frame). Triggered-on-level eggs
// are dropped so finished surprises don't loop on reload. Authored defs
// that resolve to no EASTER_EGG_BY_ID entry (stale defId in a saved blob)
// are silently skipped — surfacing the warning anywhere would noise up the
// console during ordinary edits.
const buildAuthoredEasterEggs = (
  authored: PlacedEasterEgg[],
  firstId: number,
  triggeredEggsOnLevel: ReadonlySet<string>,
): { eggs: EasterEgg[]; nextId: number; schedule: EasterEggScheduleEntry[] } => {
  const eggs: EasterEgg[] = [];
  const schedule: EasterEggScheduleEntry[] = [];
  let nextId = firstId;
  let motionIndex = 0;
  for (const a of authored) {
    if (triggeredEggsOnLevel.has(a.defId)) continue;
    const def = EASTER_EGG_BY_ID[a.defId];
    if (!def) continue;
    if (def.motion) {
      const earliest = def.scheduled?.earliestSec ?? 10;
      schedule.push({
        defId: a.defId,
        triggerTime: earliest + motionIndex * 8,
        authoredStart: { pos: { x: a.pos.x, y: a.pos.y }, rotY: a.rotY },
      });
      motionIndex++;
      continue;
    }
    eggs.push({
      id: nextId++,
      defId: a.defId,
      pos: { x: a.pos.x, y: a.pos.y },
      rotY: a.rotY,
      clickCount: 0,
      triggered: false,
      vel: null,
      despawnAt: null,
      spin: 0,
      rollPitch: 0,
    });
  }
  return { eggs, nextId, schedule };
};

const buildEasterEggSchedule = (
  biome: Biome,
  seed: number,
  triggeredEggsOnLevel: ReadonlySet<string>,
): EasterEggScheduleEntry[] => {
  const matching = EASTER_EGG_DEFS.filter(
    (d) => d.biomes.includes(biome) && d.scheduled !== undefined && !triggeredEggsOnLevel.has(d.id),
  );
  if (matching.length === 0) return [];
  const rng = mulberry32(seed);
  if (rng() > 0.5) return [];
  const def = pickWeightedEgg(matching, rng);
  const s = def.scheduled!;
  const t = s.earliestSec + rng() * Math.max(0, s.latestSec - s.earliestSec);
  return [{ defId: def.id, triggerTime: t }];
};

export type RobotContext = {
  variant: RobotVariant;
  xp: number;
  skills: AllRobotSkills;
};

const DEFAULT_ROBOT_CONTEXT: RobotContext = {
  variant: "george",
  xp: 0,
  skills: {},
};

// Playfield rectangle — band colonies hug just outside this perimeter,
// interior colonies fit inside it.
const OUTPOST_INNER_HALF_W = MAP_WIDTH / 2;
const OUTPOST_INNER_HALF_H = MAP_HEIGHT / 2;

// Authored modular colonies. Hero colonies ring the playfield in the outer
// band (decorative); a compact colony may also drop into a roomy interior
// dead-zone where it becomes a tower-placement blocker. Deterministic per
// level so a map always looks the same, but independent of the tree/rock
// streams. Returned in placement order; trees, rocks and tower placement
// all treat these as fixed blockers.
const buildOutposts = (
  paths: Vec2[][],
  biome: Biome,
  levelId: number,
  flow: FlowFeatures | null,
  firstId: number,
): { outposts: Outpost[]; nextId: number } => {
  const rng = mulberry32(levelId * 6451 + 17);
  const hqCenters = paths.filter((p) => p.length >= 2).map((p) => p[p.length - 1]);
  const placed: Outpost[] = [];
  let nextId = firstId;

  const fits = (x: number, y: number, r: number): boolean => {
    // Full-radius flow check (same as trees/rocks): a colony must clear
    // every river/lake — water in forest, lava in lava, goo in alien.
    if (isOnFlowSurface(flow, x, y, r)) return false;
    const pathLim = r + PATH_WIDTH / 2 + 0.8;
    const pathLimSq = pathLim * pathLim;
    for (const path of paths) {
      for (let i = 0; i < path.length - 1; i++) {
        if (
          distPointToSegSq(x, y, path[i].x, path[i].y, path[i + 1].x, path[i + 1].y) < pathLimSq
        ) {
          return false;
        }
      }
    }
    for (const c of hqCenters) {
      const dx = c.x - x;
      const dy = c.y - y;
      const lim = r + HQ_PAD_BLOCKER_RADIUS + 1.0;
      if (dx * dx + dy * dy < lim * lim) return false;
    }
    for (const o of placed) {
      const dx = o.pos.x - x;
      const dy = o.pos.y - y;
      const lim = r + o.radius + 1.5;
      if (dx * dx + dy * dy < lim * lim) return false;
    }
    return true;
  };

  const band = outpostScaleBand(biome);
  const shuffle = <T>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  // Drop up to `count` colonies, scanning a shuffled candidate list and
  // placing at the first anchor each fits. Scanning fixed candidates
  // (rather than pure random sampling) reliably finds the open spots even
  // on lava-choked or tightly-wound maps. A band anchor's outward normal
  // nudges its colony off the playfield edge so it hugs the rim.
  type Anchor = { x: number; y: number; nx: number; ny: number };
  const place = (ids: readonly string[], anchors: Anchor[], count: number) => {
    let done = 0;
    for (const a of anchors) {
      if (done >= count) break;
      const template = OUTPOST_BY_ID[ids[Math.floor(rng() * ids.length)]];
      const scale = band.min + rng() * (band.max - band.min);
      const r = outpostRadius(template, scale);
      const x = a.x + a.nx * r * 0.55;
      const y = a.y + a.ny * r * 0.55;
      if (!fits(x, y, r)) continue;
      placed.push({
        id: nextId++,
        templateId: template.id,
        pos: { x, y },
        yaw: rng() * Math.PI * 2,
        scale,
        radius: r,
        interior: Math.abs(x) < OUTPOST_INNER_HALF_W && Math.abs(y) < OUTPOST_INNER_HALF_H,
      });
      done++;
    }
  };

  // Band anchors walk the playfield perimeter; the outward normal pushes
  // each colony just off the edge so it frames the map while staying mostly
  // out of the play area.
  const bandAnchors: Anchor[] = [];
  const edgeStep = 5;
  for (let x = -OUTPOST_INNER_HALF_W; x <= OUTPOST_INNER_HALF_W; x += edgeStep) {
    bandAnchors.push({ x, y: OUTPOST_INNER_HALF_H, nx: 0, ny: 1 });
    bandAnchors.push({ x, y: -OUTPOST_INNER_HALF_H, nx: 0, ny: -1 });
  }
  for (let y = -OUTPOST_INNER_HALF_H + edgeStep; y < OUTPOST_INNER_HALF_H; y += edgeStep) {
    bandAnchors.push({ x: OUTPOST_INNER_HALF_W, y, nx: 1, ny: 0 });
    bandAnchors.push({ x: -OUTPOST_INNER_HALF_W, y, nx: -1, ny: 0 });
  }

  // Interior anchors: a grid over the playfield for the optional blocker
  // colony that lands in a roomy dead-zone.
  const interiorAnchors: Anchor[] = [];
  for (let x = -14; x <= 14; x += 4) {
    for (let y = -8; y <= 8; y += 4) interiorAnchors.push({ x, y, nx: 0, ny: 0 });
  }

  const cfg = outpostBiomeConfig(biome);
  place(HERO_TEMPLATE_IDS, shuffle(bandAnchors), cfg.band);
  place(COMPACT_TEMPLATE_IDS, shuffle(interiorAnchors), cfg.interior);
  // Guarantee a minimum visible presence: even flow-choked lava/alien maps
  // get a couple of colonies by falling back to the smaller templates on
  // any remaining open anchor.
  if (placed.length < 2) {
    place(COMPACT_TEMPLATE_IDS, shuffle([...bandAnchors, ...interiorAnchors]), 2 - placed.length);
  }

  return { outposts: placed, nextId };
};

export const createWorld = (
  level: LevelConfig,
  mode: LevelMode = "normal",
  difficulty: DifficultyMultipliers = DIFFICULTY_MULTIPLIERS.medium,
  triggeredEggsOnLevel: ReadonlySet<string> = new Set(),
  robotCtx: RobotContext = DEFAULT_ROBOT_CONTEXT,
  // Endless-mode input. Null for every campaign run. When provided, the
  // returned world carries an EndlessState and the spawner generates
  // waves on demand (see src/sim/endless.ts).
  endless: { seed: number; mapId: string; mapName: string; bestWave: number } | null = null,
): World => {
  const biome = biomeForPos(level.nodePos);
  const modeConfig = resolveLevelMode(level, mode);
  // Smooth the authored corner waypoints into the dense polyline that
  // everything downstream walks: enemy advancement, render strip, tower
  // placement clearance, river-bridge cuts, decoration spacing. Doing this
  // once here is what keeps the painted lane and the enemy lane aligned —
  // if any consumer fell back to the raw waypoints they'd cut corners
  // that the others curved around.
  // Off-map lead-in: each authored path gets one extra waypoint prepended
  // in the reverse of its first segment direction so the path attaches to
  // the camera's fully zoomed-out entry bounds.
  const entryHalfX = MAP_WIDTH / 2 + PATH_ENTRY_MARGIN_X;
  const entryHalfY = MAP_HEIGHT / 2 + PATH_ENTRY_MARGIN_Y;
  const extendedAuthored = level.paths.map((p) => prependLeadInToBounds(p, entryHalfX, entryHalfY));
  const paths = extendedAuthored.map((p) => smoothPath(p));
  // Ribbon + spawn ring both anchor at path[0], the lead-in point at the
  // fully zoomed-out entry bounds. Kept per-path for future offsets.
  const pathRibbonStart = level.paths.map(() => 0);
  // Dev-only level-editor overrides. Read before procedural generation so
  // clear/reload can suppress or reseed all derived set-dressing.
  let editorProps: PlacedProp[] = [];
  let editorRivers: River[] = [];
  let editorLakes: AuthoredLake[] = [];
  let editorBridges: AutoBridge[] = [];
  let editorAuthoredEggs: PlacedEasterEgg[] = [];
  let overrideActive = false;
  let proceduralSeed = 0;
  let erasedProcedural: Set<string> = new Set();
  if (import.meta.env.DEV) {
    try {
      const raw =
        typeof window !== "undefined" ? window.localStorage.getItem("mz:leveledits:v1") : null;
      const edit = raw ? JSON.parse(raw)?.[String(level.id)] : null;
      if (edit) {
        editorProps = (Array.isArray(edit.props) ? edit.props : []) as PlacedProp[];
        editorRivers = (Array.isArray(edit.rivers) ? edit.rivers : []).map((river: River) => ({
          ...river,
          material: river.material ?? "water",
        }));
        editorLakes = (Array.isArray(edit.lakes) ? edit.lakes : []).map((lake: AuthoredLake) => ({
          ...lake,
          material: lake.material ?? "water",
        }));
        editorBridges = Array.isArray(edit.bridges) ? (edit.bridges as AutoBridge[]) : [];
        editorAuthoredEggs = Array.isArray(edit.easterEggs)
          ? (edit.easterEggs as PlacedEasterEgg[])
          : [];
        overrideActive = edit.override === true;
        proceduralSeed =
          typeof edit.proceduralSeed === "number" && Number.isFinite(edit.proceduralSeed)
            ? edit.proceduralSeed
            : 0;
        erasedProcedural = new Set(
          Array.isArray(edit.erasedProcedural) ? (edit.erasedProcedural as string[]) : [],
        );
      }
    } catch {
      editorProps = [];
      editorRivers = [];
      editorLakes = [];
      editorBridges = [];
      editorAuthoredEggs = [];
      overrideActive = false;
      proceduralSeed = 0;
      erasedProcedural = new Set();
    }
  }
  const proceduralKey = level.id + proceduralSeed;
  // Rivers and lakes block organic decoration placement so trees, rocks,
  // and easter eggs don't spawn on the flow surface. Pass null for non-flow
  // biomes so isOnFlowSurface short-circuits. The lava, forest, and alien
  // biomes share the same flow geometry — see hasFlowFeatures.
  const flow =
    !overrideActive && hasFlowFeatures(biome)
      ? buildFlowFeatures(paths, proceduralKey, biome)
      : null;
  // Outposts are placed first so trees and rocks treat them as fixed
  // blockers and never spawn inside an authored colony. Each layer is then
  // filtered through the editor's erased-procedural mask so author-erased
  // items stay gone after a world rebuild. Downstream layers see the
  // filtered set, so e.g. eggs can occupy the spot of an erased outpost.
  const filterErased = <T extends { pos: { x: number; y: number } }>(items: T[]): T[] =>
    erasedProcedural.size === 0
      ? items
      : items.filter((item) => !erasedProcedural.has(proceduralPosKey(item.pos)));
  const { outposts: rawOutposts, nextId: afterOutposts } = overrideActive
    ? { outposts: [], nextId: 1 }
    : buildOutposts(paths, biome, proceduralKey, flow, 1);
  const outposts = filterErased(rawOutposts);
  const { trees: rawTrees, nextId: afterTrees } = overrideActive
    ? { trees: [], nextId: afterOutposts }
    : buildTrees(paths, proceduralKey * 7919 + 101, afterOutposts, flow, biome, outposts);
  const trees = filterErased(rawTrees);
  const { rocks: rawRocks, nextId: afterRocks } = overrideActive
    ? { rocks: [], nextId: afterTrees }
    : buildRocks(biome, paths, trees, afterTrees, flow, proceduralKey, outposts);
  const rocks = filterErased(rawRocks);
  // Author-placed eggs short-circuit the random per-level pick. Static eggs
  // (no motion def) seed `easterEggs` directly at their authored pos/rotY;
  // motion eggs (tumbleweed/rover/ghost trike) push schedule entries with
  // an authored start so spawnMovingEasterEgg uses the chosen heading
  // instead of a random map edge. Eggs already triggered on this level
  // (per the persisted achievement tally) are skipped so a finished one
  // doesn't respawn on every reload.
  const hasAuthoredEggs = editorAuthoredEggs.length > 0;
  let eggs: EasterEgg[];
  let nextId: number;
  let easterEggSchedule: EasterEggScheduleEntry[];
  if (overrideActive && !hasAuthoredEggs) {
    eggs = [];
    nextId = afterRocks;
    easterEggSchedule = [];
  } else if (hasAuthoredEggs) {
    const built = buildAuthoredEasterEggs(editorAuthoredEggs, afterRocks, triggeredEggsOnLevel);
    eggs = built.eggs;
    nextId = built.nextId;
    easterEggSchedule = built.schedule;
  } else {
    const built = buildEasterEggs(
      biome,
      paths,
      trees,
      rocks,
      outposts,
      proceduralKey * 2311 + 47,
      afterRocks,
      flow,
      triggeredEggsOnLevel,
    );
    eggs = built.eggs;
    nextId = built.nextId;
    easterEggSchedule = buildEasterEggSchedule(
      biome,
      proceduralKey * 5471 + 3,
      triggeredEggsOnLevel,
    );
  }
  // Compose per-level hpScale × difficulty.hp into each wave's hpMul. The
  // spawner already respects spec.hpMul, so baking it once at creation
  // means the rest of the sim doesn't need to know about difficulty.
  const baseHpScale = (level.hpScale ?? 1) * difficulty.hp;
  // Roster-density scaling runs first so the immunity-coverage injection
  // below sees the widened stream, then HP scaling bakes into hpMul.
  const modeWaves = scaleWaveCounts(modeConfig.waves, level.countScale ?? 1);
  // Per-wave HP = baseHpScale × lateWaveHpFactor(waveIndex). The ramp keeps
  // the back half of the level tense once the board is maxed; on
  // easy/medium ramp=0 so this collapses to the flat baseHpScale curve.
  const ramp = difficulty.lateWaveHpRamp;
  const waveCount = modeWaves.length;
  const scaledWaves =
    baseHpScale === 1 && ramp === 0
      ? modeWaves
      : modeWaves.map((w, i) => ({
          ...w,
          hpMul: (w.hpMul ?? 1) * baseHpScale * lateWaveHpFactor(i, waveCount, ramp),
        }));
  const modeForbidden = new Set<TowerKind>(modeConfig.forbiddenTowers ?? []);
  const modeLocked = modeConfig.lockedLoadout ?? null;
  const plannedWaves = ensureImmunityCoverage(
    scaledWaves,
    availableDamageTypes(modeForbidden, modeLocked),
  );
  // Containment mode caps lives at 1; every other mode starts at the full HQ
  // life pool. The runtime never tops these up, so this is the only
  // place the value is set per run.
  const startingLives = modeConfig.singleLife ? 1 : STARTING_LIVES;
  // Robot spawns ON the path, one short step in front of the HQ — she
  // guards the base directly. Multi-entry maps pick the path whose HQ
  // endpoint sits closest to the centroid of all HQs so the robot lands
  // on the most central front line.
  const hqEnds: Vec2[] = paths.map((p) => p[p.length - 1] ?? { x: 0, y: 0 });
  let cx = 0;
  let cy = 0;
  for (const h of hqEnds) {
    cx += h.x;
    cy += h.y;
  }
  const denom = Math.max(1, hqEnds.length);
  cx /= denom;
  cy /= denom;
  let pickIdx = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < hqEnds.length; i++) {
    const dx = hqEnds[i].x - cx;
    const dy = hqEnds[i].y - cy;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      pickIdx = i;
    }
  }
  const guardPath = paths[pickIdx] ?? [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  const endPt = guardPath[guardPath.length - 1] ?? { x: 0, y: 0 };
  // Walk backwards along the path until we've stepped this many world
  // units away from the HQ. Keeps the robot on the authored lane regardless
  // of how dense the smoothing subdivisions are.
  const ROBOT_FRONT_OFFSET = 2.6;
  let spawnX = endPt.x;
  let spawnY = endPt.y;
  let remaining = ROBOT_FRONT_OFFSET;
  for (let i = guardPath.length - 1; i > 0 && remaining > 0; i--) {
    const a = guardPath[i];
    const b = guardPath[i - 1];
    const segDx = b.x - a.x;
    const segDy = b.y - a.y;
    const segLen = Math.hypot(segDx, segDy);
    if (segLen <= 0) continue;
    if (segLen >= remaining) {
      const t = remaining / segLen;
      spawnX = a.x + segDx * t;
      spawnY = a.y + segDy * t;
      remaining = 0;
      break;
    }
    spawnX = b.x;
    spawnY = b.y;
    remaining -= segLen;
  }
  const robotSpawn: Vec2 = { x: spawnX, y: spawnY };
  const tx = endPt.x - spawnX;
  const ty = endPt.y - spawnY;
  const tl = Math.hypot(tx, ty) || 1;
  const tdx = tx / tl;
  const tdy = ty / tl;
  const robot = robotDefaults(robotCtx.variant, robotSpawn, nextId, robotCtx.xp);
  robot.facing = Math.atan2(-tdx, tdy);
  applyRobotSkillsToRobot(robot, robotCtx.skills);
  // Snap HP to maxHp post-skills so vitality ranks don't leave the robot
  // partly damaged. Done after applyRobotSkillsToRobot (which bumps both).
  robot.hp = robot.maxHp;
  // Endless: fold the difficulty HP scale into hpMul (the generator
  // multiplies the per-wave escalation on top) and snapshot the
  // difficulty speed as the base for the per-wave speed factor.
  const endlessState: EndlessState | null = endless
    ? {
        seed: endless.seed,
        mapId: endless.mapId,
        mapName: endless.mapName,
        hpMul: baseHpScale,
        baseSpeedMul: difficulty.speed,
        bestWave: endless.bestWave,
      }
    : null;
  return {
    time: 0,
    tickCount: 0,
    levelId: level.id,
    biome,
    paths,
    pathRibbonStart,
    plannedWaves,
    enemies: [],
    enemyById: new Map(),
    towers: [],
    towerById: new Map(),
    trees,
    rocks,
    outposts,
    props: editorProps,
    overrideActive,
    proceduralSeed,
    erasedProcedural,
    rivers: editorRivers,
    lakes: editorLakes,
    autoBridges: editorBridges,
    projectiles: [],
    beams: [],
    explosions: [],
    cryoWaves: [],
    coalEmbers: [],
    robotCraters: [],
    particles: [],
    puffs: [],
    spawnQueue: [],
    bossTrickleStreams: [],
    bossTrickleIntervalMul: difficulty.bossTrickleIntervalMul,
    wave: 0,
    totalWaves: modeWaves.length,
    waveActive: false,
    nextWaveIn: 2,
    waveTotalEnemies: 0,
    midwaveTimer: 0,
    midwaveTimerMax: 0,
    gold: Math.floor(modeConfig.startGold * difficulty.startGold),
    lives: startingLives,
    startLives: startingLives,
    status: "running",
    winHoldTimer: 0,
    killingPathIndex: null,
    nextEntityId: nextId + 1,
    robot,
    events: [],
    shake: { magnitude: 0, decay: 0 },
    selectedTowerId: null,
    selectedBase: false,
    base: {
      damage: BASE_DAMAGE,
      fireRate: BASE_FIRE_RATE,
      range: BASE_RANGE,
      cooldowns: paths.map(() => 0),
      targetIds: paths.map(() => null),
      upgrades: { a: 0, b: 0 },
      totalSpent: 0,
      kills: 0,
      damageDealt: 0,
    },
    runEnemyKinds: {},
    runTowerKinds: {},
    easterEggs: eggs,
    easterEggSchedule,
    authoredEasterEggs: editorAuthoredEggs,
    speedMul: difficulty.speed,
    goldKillMul: difficulty.goldKill,
    invincible: false,
    flowFeatures: flow,
    mode,
    forbiddenTowers: new Set(modeConfig.forbiddenTowers ?? []),
    lockedLoadout: modeConfig.lockedLoadout ?? null,
    sellingDisabled: modeConfig.noSelling ?? false,
    endless: endlessState,
    // Adaptive-resistance state — empty until applyDamage starts
    // tallying. dominantNext stays null until startWave picks it
    // from the trailing buckets.
    adaptation: {
      perWave: new Map(),
      dominantNext: null,
      dominantStreak: 0,
      dominantShare: 0,
    },
  };
};

// Centralized check matching mode rules. The HUD greys out forbidden /
// non-loadout kinds, and tryPlaceOrSelect double-checks at runtime so a
// stale UI can't sneak a placement past the rules.
export const isTowerKindAllowed = (world: World, kind: TowerKind): boolean => {
  if (world.forbiddenTowers.has(kind)) return false;
  if (world.lockedLoadout && !world.lockedLoadout.includes(kind)) return false;
  return true;
};

// Spawn a moving egg (tumbleweed/rover) at a random map edge heading toward
// the opposite edge. Straight-line traversal with a short life. When the
// caller supplies `override`, the authored start/heading is used verbatim
// instead — lets the level editor place a tumbleweed at a specific clearing
// heading in a chosen direction.
export const spawnMovingEasterEgg = (
  world: World,
  defId: string,
  override?: { pos: Vec2; rotY: number },
) => {
  const def = EASTER_EGG_DEFS.find((d) => d.id === defId);
  if (!def?.motion) return;
  if (world.easterEggs.some((e) => e.defId === defId)) return; // already present
  const rng = Math.random;
  let start: Vec2;
  let dir: Vec2;
  if (override) {
    start = { x: override.pos.x, y: override.pos.y };
    // rotY = atan2(dx, -dy) per the convention used for the random pick
    // below — invert it here to recover the heading vector.
    dir = { x: Math.sin(override.rotY), y: -Math.cos(override.rotY) };
  } else {
    // Pick a side (0: left, 1: right, 2: top, 3: bottom) and a perpendicular offset.
    const side = Math.floor(rng() * 4);
    // Spawn well outside the most-zoomed-out camera frustum so the model
    // slides into view rather than popping in. CameraRig fits to roughly
    // ±(MAP_WIDTH/2 + 4) on x and ±(MAP_HEIGHT/2 + 6) on z (mobile),
    // plus a model half-extent. 12 covers the largest moving-egg model
    // (rover, targetSize=1.8) with headroom for camera shake.
    const margin = 12;
    // Keep the perpendicular offset inside the visible playfield. 0.7
    // widens the spread vs the prior 0.6 without clipping screen edges.
    if (side === 0) {
      start = { x: -MAP_WIDTH / 2 - margin, y: (rng() - 0.5) * MAP_HEIGHT * 0.7 };
      dir = { x: 1, y: 0 };
    } else if (side === 1) {
      start = { x: MAP_WIDTH / 2 + margin, y: (rng() - 0.5) * MAP_HEIGHT * 0.7 };
      dir = { x: -1, y: 0 };
    } else if (side === 2) {
      start = { x: (rng() - 0.5) * MAP_WIDTH * 0.7, y: MAP_HEIGHT / 2 + margin };
      dir = { x: 0, y: -1 };
    } else {
      start = { x: (rng() - 0.5) * MAP_WIDTH * 0.7, y: -MAP_HEIGHT / 2 - margin };
      dir = { x: 0, y: 1 };
    }
  }
  const speed = def.motion.speed;
  const egg: EasterEgg = {
    id: world.nextEntityId++,
    defId: def.id,
    pos: { x: start.x, y: start.y },
    // Model-forward at rotY=0 is -z_world; game-y maps to -z_world, so
    // heading angle = atan2(dx, -dy). Matches ModelEnemyMesh.
    // Prior atan2(dir.x, dir.y) faced models 180° backwards — most
    // visible on ghost_trike walking across the wasteland.
    rotY: Math.atan2(dir.x, -dir.y),
    clickCount: 0,
    triggered: false,
    vel: { x: dir.x * speed, y: dir.y * speed },
    despawnAt: world.time + def.motion.lifetime,
    spin: def.motion.spinRate ?? 0,
    rollPitch: 0,
  };
  // Use immutable append so React selectors see a new ref and rerender.
  world.easterEggs = [...world.easterEggs, egg];
};

export const updateEasterEggs = (world: World, dt: number) => {
  // Fire scheduled spawns whose time has come.
  if (world.easterEggSchedule.length > 0) {
    const remaining: EasterEggScheduleEntry[] = [];
    for (const entry of world.easterEggSchedule) {
      if (world.time >= entry.triggerTime) {
        spawnMovingEasterEgg(world, entry.defId, entry.authoredStart);
      } else {
        remaining.push(entry);
      }
    }
    world.easterEggSchedule = remaining;
  }
  // Integrate motion + despawn expired eggs. Static gold-reward eggs (skull)
  // get a short post-click grace via despawnAt so the renderer can fade them
  // out rather than vanishing on the same frame the click registers.
  if (world.easterEggs.length > 0) {
    world.easterEggs = world.easterEggs.filter((egg) => {
      if (egg.vel) {
        egg.pos.x += egg.vel.x * dt;
        egg.pos.y += egg.vel.y * dt;
        const def = EASTER_EGG_BY_ID[egg.defId];
        // Tumble-mode eggs (barrel) keep their launch heading and accumulate
        // spin into rollPitch so they roll about their long axis instead of
        // pivoting around their vertical axis like a tumbleweed.
        if (def?.clickRoll?.tumble) {
          egg.rollPitch += egg.spin * dt;
        } else {
          egg.rotY += egg.spin * dt;
        }
      }
      if (egg.despawnAt !== null && world.time >= egg.despawnAt) return false;
      return true;
    });
  }
};

type EnemyBaseStats = Pick<Enemy, "kind" | "hp" | "maxHp" | "speed" | "bounty" | "damage">;

export const ENEMY_STATS: Record<EnemyKind, EnemyBaseStats> = {
  raptor: { kind: "raptor", hp: 20, maxHp: 20, speed: 2.2, bounty: 3, damage: 1 },
  allosaur: { kind: "allosaur", hp: 60, maxHp: 60, speed: 1.4, bounty: 7, damage: 2 },
  stego: { kind: "stego", hp: 180, maxHp: 180, speed: 0.9, bounty: 16, damage: 3 },
  swarm: { kind: "swarm", hp: 10, maxHp: 10, speed: 3.0, bounty: 1, damage: 1 },
  armored: { kind: "armored", hp: 300, maxHp: 300, speed: 1.1, bounty: 22, damage: 1 },
  para: { kind: "para", hp: 45, maxHp: 45, speed: 1.8, bounty: 5, damage: 2 },
  titan: { kind: "titan", hp: 1200, maxHp: 1200, speed: 0.65, bounty: 48, damage: 8 },
  // Boss — appears on flagged boss waves only. ~3.5× titan HP, lumbers
  // along, hits hard. Per-kill bonus on top of bounty is paid out by
  // spawnerTick when a boss-flagged enemy dies.
  boss: { kind: "boss", hp: 4200, maxHp: 4200, speed: 0.5, bounty: 200, damage: 10 },
};

// Per-second melee damage a dino deals while engaged with the robot. NOT
// the same as `damage` — that drives life-loss on HQ leak (kept tuned
// to the leak economy). Robot combat needs its own dimension so a
// titan/t-rex feels devastating in skirmish while swarm chip is a
// tickle. Values are HP/sec; the caller multiplies by dt.
export const ENEMY_ROBOT_DAMAGE: Record<EnemyKind, number> = {
  swarm: 2,
  raptor: 6,
  para: 10,
  allosaur: 32,
  stego: 20,
  armored: 16,
  titan: 48,
  boss: 70,
};

// Per-kind shield pool used when a spec marks an enemy as shielded.
// Swarm units are too small to support a visible bubble — they always
// run unshielded regardless of spec flags.
export const SHIELD_BY_KIND: Record<EnemyKind, number> = {
  // Bumped from 10 — the early-wave bubble was popping too fast for the
  // "shield first, body second" lesson to register before the body was
  // also gone in the same volley. 20 takes a second pulse-shot to crack.
  raptor: 20,
  allosaur: 35,
  stego: 80,
  swarm: 0,
  armored: 120,
  para: 25,
  titan: 400,
  boss: 800,
};

export const SHIELD_REGEN_DELAY = 4;
// Fraction of maxShield restored per second once regen kicks in.
export const SHIELD_REGEN_RATE = 0.25;

// Healer chip tuning — read by updateDefensive.
export const HEAL_AURA_RANGE = 3.5;
export const HEAL_AURA_RATE = 3;

// Regen chip tuning — slow passive self-heal. Pauses briefly on damage
// so the player's sustained DPS isn't "wasted" — it just isn't as
// efficient as a single burst. Tuned slower than the heal aura because
// regen comes for free; healers have to dedicate a slot.
export const REGEN_RATE = 1.5;
export const REGEN_DAMAGE_PAUSE = 1.5;

export const TOWER_DAMAGE_TYPE: Record<TowerKind, DamageType> = {
  pulse: "kinetic",
  chain: "electric",
  cryo: "cold",
  mortar: "explosive",
  flame: "flame",
  hive: "kinetic",
};

export const DAMAGE_TYPE_LABEL: Record<DamageType, string> = {
  kinetic: "Kinetic",
  electric: "Electric",
  cold: "Cold",
  explosive: "Explosive",
  flame: "Flame",
};

export const DAMAGE_TYPE_COLOR: Record<DamageType, string> = {
  kinetic: "#c9cbd1",
  electric: "#c48cff",
  cold: "#aaf0ff",
  explosive: "#ffb266",
  flame: "#ff5a3a",
};

// Hive is pure support — it doesn't deal direct damage, so its pill
// uses a dedicated "support" category rather than reusing a damage
// type. Light pleasant green hints "help" without clashing with the
// kinetic/electric/cold/explosive/flame palette.
export type TowerPillType = DamageType | "support";
export const SUPPORT_PILL_COLOR = "#bbffc8";
export const SUPPORT_PILL_LABEL = "Support";

export const towerPillInfo = (
  kind: TowerKind,
): { type: TowerPillType; color: string; label: string } => {
  if (kind === "hive") {
    return { type: "support", color: SUPPORT_PILL_COLOR, label: SUPPORT_PILL_LABEL };
  }
  const dt = TOWER_DAMAGE_TYPE[kind];
  return { type: dt, color: DAMAGE_TYPE_COLOR[dt], label: DAMAGE_TYPE_LABEL[dt] };
};

// Flame is its own damage type so per-spawn `resists` chips can target
// it without also blocking mortar's explosive output. Default flame
// resist per kind mirrors the original explosive value so the split is
// balance-neutral until a wave's resist chip overrides it.
export const ENEMY_RESIST: Record<EnemyKind, Record<DamageType, number>> = {
  raptor: { kinetic: 1.0, electric: 1.5, cold: 0.6, explosive: 0.8, flame: 0.8 },
  allosaur: { kinetic: 1.0, electric: 1.0, cold: 1.0, explosive: 1.0, flame: 1.0 },
  stego: { kinetic: 0.4, electric: 1.7, cold: 1.0, explosive: 0.6, flame: 0.6 },
  swarm: { kinetic: 0.6, electric: 2.0, cold: 1.3, explosive: 1.7, flame: 1.7 },
  armored: { kinetic: 1.3, electric: 0.5, cold: 1.0, explosive: 0.4, flame: 0.4 },
  // Hollow head crest acts as a resonator: chain damage rings through it
  // (1.7×), while the same crest vents heat — flame slides off (0.5×).
  para: { kinetic: 1.1, electric: 1.7, cold: 1.0, explosive: 0.8, flame: 0.5 },
  titan: { kinetic: 0.5, electric: 0.9, cold: 1.3, explosive: 0.35, flame: 0.35 },
  // Boss — even tougher than titan. Cold is the only real lever
  // (1.5×); kinetic bullets scrape, explosives barely tickle. Forces
  // the player to lean on cryo and chip-cracking T3 upgrades.
  boss: { kinetic: 0.45, electric: 0.85, cold: 1.5, explosive: 0.3, flame: 0.3 },
};

export const ENEMY_SLOW_RESIST: Record<EnemyKind, number> = {
  raptor: 0,
  allosaur: 0,
  stego: 0.35,
  swarm: 0,
  armored: 0.75,
  para: 0,
  titan: 0.5,
  boss: 0.6,
};

// Bounty multipliers per active chip. Stack multiplicatively at spawn
// time, so layered defensive threats pay proportionally to their extra
// durability without any single chip dominating.
export const SHIELDED_BOUNTY_MUL = 1.3;
export const HEAL_AURA_BOUNTY_MUL = 1.4;
export const REGEN_BOUNTY_MUL = 1.3;

export const MIN_SLOW_FACTOR = 0.25;

// === Adaptive Resistance =================================================
//
// Playtest note 10 / item 14. Starting one level after the "training the
// herd" command update at LEVEL_INTERSTITIAL[11], the herd actively adapts to
// the damage type the player has been leaning on — a fraction of each
// wave spawns with bumped resistance (up to full immunity in late
// game) against the type the player dealt the most damage with over
// the trailing ADAPT_WINDOW waves. Adapted spawns carry a slight
// off-color material tint so the player can read the threat without
// having to inspect the resist panel.
//
// The whole system is gated by ADAPTIVE_RESISTANCE_ENABLED below. Flip
// the flag to `false` and the tally short-circuits, dominantNext stays
// null, spawnEnemy skips the snapshot, and ModelEnemyMesh's adaptive
// branch never fires — a clean one-line back-out if playtests reject
// the mechanic.
//
// See docs/adaptive-resistance.md for the full spec.
export const ADAPTIVE_RESISTANCE_ENABLED = true;

// First level at which the herd adapts. L11 carries the command update that
// names the loop ("we have been training the herd"); the mechanic
// kicks in on the next level so the narrative beat is paid off
// immediately by the very next wave.
export const ADAPT_TRIGGER_LEVEL = 12;

// Trailing wave window summed when picking the dominant damage type.
// Three waves smooths single-wave spikes (boss splash, ignite tails)
// without making the herd take forever to retune when the player
// swaps a tower.
export const ADAPT_WINDOW = 3;

// Bosses get adaptation at half rate (and never hard-immune) — their
// resists are already scripted per BOSS_VARIANT_RESIST and turning a
// matriarch fully immune to the player's primary type would gut the
// fight.
export const ADAPT_BOSS_BOOST_SCALE = 0.5;

// If the effective multiplier (baseMul × (1 − boost)) drops to or
// below this floor, snap it to 0 so the enemy reads as truly immune
// instead of pinging for 6% damage. Non-bosses only.
export const ADAPT_IMMUNITY_FLOOR = 0.1;

// Concentration share at which adaptation starts amplifying. Below
// this the player is judged "diversified enough" — adaptation still
// applies but the share-multiplier contributes 0. At share=1 (single
// tower) the player gets the full punishment.
export const ADAPT_CONCENTRATION_FLOOR = 0.5;

// Multiplicative reduction applied to extraResists[type] for the
// dominant type, per adapted spawn. Three terms compose:
//   - levelTerm: slow calendar-based ramp from trigger level.
//   - streakTerm: per-consecutive-wave punishment for staying on the
//     same damage type.
//   - concTerm: punishment for *concentration* — share of damage from
//     the dominant type above ADAPT_CONCENTRATION_FLOOR.
// Capped at 0.95 so a single-tower player at L20+ with a long streak
// hits effectively-immune for any kind with non-trivial base resist
// (and snaps to true 0 via ADAPT_IMMUNITY_FLOOR for the soft kinds).
// A diversified player at the same level sees only the level term and
// a small streak bump, keeping adaptation a tilt rather than a wall.
export const adaptiveBoost = (level: number, streak: number, share: number): number => {
  if (level < ADAPT_TRIGGER_LEVEL) return 0;
  const t = level - ADAPT_TRIGGER_LEVEL;
  const levelTerm = 0.05 + t * 0.015;
  const streakTerm = Math.min(0.2, Math.max(0, streak - 1) * 0.04);
  const concTerm = Math.max(0, share - ADAPT_CONCENTRATION_FLOOR) * 0.3;
  return Math.min(0.7, levelTerm + streakTerm + concTerm);
};

// Per-spawn probability the spawn is one of the adapted variants.
// Same three-term shape as the boost so a player parked on one type
// sees both *more* adapted spawns and *harder* resistance per spawn
// over time, while a diversified player gets a slow level-only ramp.
export const adaptiveCoverage = (level: number, streak: number, share: number): number => {
  if (level < ADAPT_TRIGGER_LEVEL) return 0;
  const t = level - ADAPT_TRIGGER_LEVEL;
  const base = 0.1 + t * 0.03;
  const streakBonus = Math.min(0.25, Math.max(0, streak - 1) * 0.04);
  const concBonus = Math.max(0, share - ADAPT_CONCENTRATION_FLOOR) * 0.3;
  return Math.min(0.7, base + streakBonus + concBonus);
};

// Material tint lerp amount for the adapted body color. A long streak
// adds a small bump on top so a player who refuses to swap towers
// visually watches the herd's hide deepen wave over wave.
// Stepped level base instead of continuous so the band changes read
// on screen.
export const adaptiveTintAmount = (level: number, streak: number): number => {
  if (level < ADAPT_TRIGGER_LEVEL) return 0;
  let base = 0.15;
  if (level >= 15) base = 0.22;
  if (level >= 18) base = 0.3;
  if (level >= 21) base = 0.4;
  if (level >= 26) base = 0.5;
  const streakBonus = Math.min(0.15, Math.max(0, streak - 1) * 0.03);
  return Math.min(0.65, base + streakBonus);
};

// Adaptive tint hex per resisted damage type. Decoupled from the UI
// DAMAGE_TYPE_COLOR palette: those pastels are tuned to read as text
// on a dark HUD background, but they wash out completely when lerped
// onto a textured dino body at 30% blend. The values below are the
// same hues bumped to higher saturation / lower luminance so the
// off-color body tint stays legible across all five types — kinetic
// reads as gunmetal not bone-white, cold as deep ice not pastel mist.
// Each picked to stay visually distinct from the others and readable on
// the different dinosaur materials at a glance.
export const ADAPTIVE_TINT_BY_TYPE: Record<DamageType, string> = {
  kinetic: "#5a6478", // gunmetal slate — bullet-glanced steel
  electric: "#a040ff", // saturated violet — arc-charged hide
  cold: "#3ec0ff", // deep ice blue — frost-laminated
  explosive: "#ff8a1f", // burnt orange — blast-hardened plate
  flame: "#ff2a14", // hot crimson — char-resistant
};

// Optional emissive tint per type. Multiplied by a level/streak scalar
// in ModelEnemyMesh so heavy late-game adaptation reads with a subtle
// inner glow without competing with frost or matriarch tint.
export const ADAPTIVE_EMISSIVE_BY_TYPE: Record<DamageType, string> = {
  kinetic: "#2a2f3a",
  electric: "#6a18cf",
  cold: "#1880c0",
  explosive: "#a04408",
  flame: "#b01408",
};

export const emptyAdaptBucket = (): Record<DamageType, number> => ({
  kinetic: 0,
  electric: 0,
  cold: 0,
  explosive: 0,
  flame: 0,
});

// Picks the damage type the herd will resist on the next wave from
// the trailing ADAPT_WINDOW buckets. Lexical tie-break on the
// DamageType keys keeps replays deterministic when totals tie. Null
// when the flag is off or no damage has been recorded yet.
// Per-type damage accumulator called by applyDamage. Cheap (one Map
// lookup + one number add) and gated by ADAPTIVE_RESISTANCE_ENABLED so
// the whole feature can be backed out by flipping the flag.
export const tallyAdaptiveDamage = (world: World, type: DamageType, dealt: number): void => {
  if (!ADAPTIVE_RESISTANCE_ENABLED) return;
  if (dealt <= 0) return;
  // Wave 0 = pre-first-wave (waveActive false). Don't tally — those
  // hits would land in a bucket that never gets read.
  if (world.wave <= 0) return;
  let bucket = world.adaptation.perWave.get(world.wave);
  if (!bucket) {
    bucket = emptyAdaptBucket();
    world.adaptation.perWave.set(world.wave, bucket);
  }
  bucket[type] += dealt;
};

export const computeAdaptiveDominant = (
  world: World,
): { type: DamageType | null; share: number } => {
  if (!ADAPTIVE_RESISTANCE_ENABLED) return { type: null, share: 0 };
  const totals = emptyAdaptBucket();
  const fromWave = Math.max(1, world.wave - ADAPT_WINDOW);
  for (let w = fromWave; w <= world.wave; w++) {
    const bucket = world.adaptation.perWave.get(w);
    if (!bucket) continue;
    for (const k of Object.keys(totals) as DamageType[]) totals[k] += bucket[k];
  }
  // Iterate in a fixed order so ties resolve deterministically.
  const order: DamageType[] = ["kinetic", "electric", "cold", "explosive", "flame"];
  let best: DamageType | null = null;
  let bestVal = 0;
  let sum = 0;
  for (const k of order) {
    sum += totals[k];
    if (totals[k] > bestVal) {
      best = k;
      bestVal = totals[k];
    }
  }
  const share = sum > 0 ? bestVal / sum : 0;
  return { type: best, share };
};

export const ENEMY_MODEL: Record<EnemyKind, { url: string; targetSize: number; clip?: string }> = {
  raptor: { url: "/models/Velociraptor.glb", targetSize: 1.6 },
  swarm: { url: "/models/Velociraptor.glb", targetSize: 0.8 },
  para: { url: "/models/Parasaurolophus.glb", targetSize: 1.7 },
  allosaur: { url: "/models/Trex.glb", targetSize: 2.2 },
  stego: { url: "/models/Stegosaurus.glb", targetSize: 1.9 },
  armored: { url: "/models/Triceratops.glb", targetSize: 2.0 },
  titan: { url: "/models/Apatosaurus.glb", targetSize: 11.0, clip: "Walk" },
  // Boss — the largest available model scaled up further so the
  // silhouette dwarfs everything else on screen.
  boss: { url: "/models/Apatosaurus.glb", targetSize: 18.0, clip: "Walk" },
};

export const ENEMY_LABEL: Record<EnemyKind, string> = {
  raptor: "Raptor",
  allosaur: "T-Rex",
  stego: "Stegosaur",
  swarm: "Swarm",
  armored: "Triceratops",
  para: "Parasaur",
  titan: "Apatosaur",
  boss: "Matriarch",
};

// Biome-themed matriarch variants. Each entry below overrides the base
// `boss` stats / model / resists so the species you're fighting on a
// boss wave reads as "the queen of this biome's pack" instead of a
// generic apatosaurus every time. Picked by the level's wave spec.

// Matriarchs all deal MATRIARCH_DAMAGE on leak (= STARTING_LIVES, so a
// single matriarch leak is an instant game-over). Tied to the lives
// constant so a future startLives bump propagates without per-variant
// edits.
const MATRIARCH_DAMAGE = STARTING_LIVES;

export const BOSS_VARIANT_STATS: Record<BossVariant, EnemyBaseStats> = {
  // Forest debut (L5). Fast and lighter than the apex — but the constant
  // raptor stream behind her shreds gold-strapped early defenses if the
  // player doesn't bring AoE.
  raptor: {
    kind: "boss",
    hp: 2400,
    maxHp: 2400,
    speed: 1.2,
    bounty: 160,
    damage: MATRIARCH_DAMAGE,
  },
  // Snow (L10). Slow tank queen. Spawned stego dribble behind her takes
  // forever to clear so the player has to actually break her armor.
  stego: {
    kind: "boss",
    hp: 3800,
    maxHp: 3800,
    speed: 0.55,
    bounty: 220,
    damage: MATRIARCH_DAMAGE,
  },
  // Desert (L15). Crested runner — fast and tall, vents heat. Para
  // children pile up if the player wasn't ready for chain shielding.
  para: { kind: "boss", hp: 3400, maxHp: 3400, speed: 1.0, bounty: 200, damage: MATRIARCH_DAMAGE },
  // Wasteland (L20). Apex predator. Damage spike makes leaks hurt.
  allosaur: {
    kind: "boss",
    hp: 4400,
    maxHp: 4400,
    speed: 0.7,
    bounty: 240,
    damage: MATRIARCH_DAMAGE,
  },
  // Lava (L25). Heaviest plates. Armored children stack up if cold/elec
  // coverage is thin — and her chain-resist makes a single coil insufficient.
  armored: {
    kind: "boss",
    hp: 5200,
    maxHp: 5200,
    speed: 0.55,
    bounty: 280,
    damage: MATRIARCH_DAMAGE,
  },
  // Alien (L30). The original matriarch — no child stream because the
  // L30 wave already runs heavy entourage+trickle. Mass and resists are
  // the threat, not pack pressure.
  apex: { kind: "boss", hp: 4200, maxHp: 4200, speed: 0.5, bounty: 200, damage: MATRIARCH_DAMAGE },
};

export const BOSS_VARIANT_RESIST: Record<BossVariant, Record<DamageType, number>> = {
  // Pack-leader hide — vulnerable to electric like her swarm, modest
  // kinetic/cold resistance from sheer mass.
  raptor: { kinetic: 0.85, electric: 1.4, cold: 0.75, explosive: 0.55, flame: 0.55 },
  // Same plate logic as base stego, dialed up: kinetic and blast slide off,
  // electric rings through the dorsal fin.
  stego: { kinetic: 0.3, electric: 1.6, cold: 1.0, explosive: 0.45, flame: 0.45 },
  // Hollow resonator crest: chain damage rings through (1.7×), flame vents
  // off (0.4). Otherwise reasonably soft for a matriarch.
  para: { kinetic: 0.9, electric: 1.7, cold: 0.95, explosive: 0.8, flame: 0.4 },
  // Allosaur's flat resists, scaled down — there's no free win, but no
  // hard counter either.
  allosaur: { kinetic: 0.75, electric: 0.8, cold: 0.85, explosive: 0.7, flame: 0.7 },
  // Triceratops queen — chrome-plated. Electric is the only real lever.
  armored: { kinetic: 1.1, electric: 0.4, cold: 0.9, explosive: 0.3, flame: 0.3 },
  // Original matriarch resists — cold is the only real lever.
  apex: { kinetic: 0.45, electric: 0.85, cold: 1.5, explosive: 0.3, flame: 0.3 },
};

// Combined resist multiplier for a damage hit. Walks the same inputs
// (base species/variant resist, per-spawn resist chip with armor-pierce
// override) that applyDamage and the damage estimator both need. Keep
// the math here so tuning a boss-variant resist or armor-pierce
// semantics doesn't require updating multiple call sites.
export const computeResistMul = (enemy: Enemy, type: DamageType, armorPierce: boolean): number => {
  const baseMul =
    enemy.kind === "boss" && enemy.bossVariant !== undefined
      ? BOSS_VARIANT_RESIST[enemy.bossVariant][type]
      : ENEMY_RESIST[enemy.kind][type];
  const rawExtra = enemy.extraResists[type] ?? 1;
  const extraMul = armorPierce && rawExtra < 1 ? 1 : rawExtra;
  return baseMul * extraMul;
};

export const BOSS_VARIANT_SLOW_RESIST: Record<BossVariant, number> = {
  raptor: 0.4,
  stego: 0.55,
  para: 0.3,
  allosaur: 0.4,
  armored: 0.8,
  apex: 0.6,
};

// `timeScale` slows the walk clip so each queen reads as a towering giant
// instead of scurrying — the slow movers (stego/armored/apex) animated at
// 1.0 looked frantic. Single source for the gameplay mesh (Scene.tsx) AND
// the compendium preview (EnemyPreview), so animation speed can't drift
// between the two. Footsteps phase-lock to whatever this resolves to.
export const BOSS_VARIANT_MODEL: Record<
  BossVariant,
  { url: string; targetSize: number; clip?: string; timeScale?: number }
> = {
  raptor: { url: "/models/Velociraptor.glb", targetSize: 9.0, timeScale: 0.62 },
  stego: { url: "/models/Stegosaurus.glb", targetSize: 7.2, timeScale: 0.5 },
  para: { url: "/models/Parasaurolophus.glb", targetSize: 10.0, timeScale: 0.7 },
  allosaur: { url: "/models/Trex.glb", targetSize: 6.4, timeScale: 0.55 },
  armored: { url: "/models/Triceratops.glb", targetSize: 6.3, timeScale: 0.5 },
  apex: { url: "/models/Apatosaurus.glb", targetSize: 20.0, clip: "Walk", timeScale: 0.45 },
};

// Per-variant footstep cadence, phase-locked to the walk clip. `phases` are
// normalized positions in the walk loop [0,1) where a foot plants; the
// render layer reads the live mixer time and thuds as playback crosses each
// one, so steps stay synced to THAT matriarch's animation and slow/speed in
// lockstep with timeScale + cryo (no fixed wall-clock interval). Biped queens
// plant twice per cycle, quadrupeds four times. `weight` scales the synth's
// depth/loudness — heavier giant = deeper, louder thud.
export const BOSS_VARIANT_FOOTSTEP: Record<BossVariant, { phases: number[]; weight: number }> = {
  raptor: { phases: [0.0, 0.5], weight: 0.8 },
  stego: { phases: [0.0, 0.25, 0.5, 0.75], weight: 0.95 },
  para: { phases: [0.0, 0.5], weight: 0.85 },
  allosaur: { phases: [0.0, 0.5], weight: 0.95 },
  armored: { phases: [0.0, 0.25, 0.5, 0.75], weight: 1.0 },
  apex: { phases: [0.0, 0.25, 0.5, 0.75], weight: 1.0 },
};

// Per-variant body tint. Applied permanently to matriarch meshes so
// each queen reads as her own creature at first glance. Hues are chosen
// to fit the biome AND stay visually distinct from each other — pairs
// within ~30° on the wheel read as muddy under the biome's ambient
// lighting.
export const BOSS_VARIANT_TINT: Record<BossVariant, string> = {
  raptor: "#a85a38", // forest — warm hide shift without the neon-red wash
  stego: "#8fd8c3", // snow — soft glacial jade
  para: "#a25aff", // desert — twilight violet on the crest
  allosaur: "#ffb030", // wasteland — apex-predator gold
  armored: "#5ad6ff", // lava — chrome-cyan chitin (cool contrast)
  apex: "#d440ff", // alien — bioluminescent magenta
};

// Per-variant material strength for matriarchs. Lower tintAmount than
// before so the original textured material stays visible — single-hue
// washes read as "plastic toy". Added metalness + roughness so each
// queen reads as armored/chitin/tech instead of painted plastic; rising
// metalness picks up environment reflections so movement reveals subtle
// highlights players couldn't see on a matte tint.
export const BOSS_VARIANT_MATERIAL: Record<
  BossVariant,
  { tintAmount: number; emissiveAmount: number; metalness: number; roughness: number }
> = {
  raptor: { tintAmount: 0.22, emissiveAmount: 0.05, metalness: 0.35, roughness: 0.5 },
  stego: { tintAmount: 0.2, emissiveAmount: 0.07, metalness: 0.55, roughness: 0.42 },
  para: { tintAmount: 0.12, emissiveAmount: 0.04, metalness: 0.45, roughness: 0.4 },
  allosaur: { tintAmount: 0.3, emissiveAmount: 0.11, metalness: 0.5, roughness: 0.4 },
  armored: { tintAmount: 0.36, emissiveAmount: 0.16, metalness: 0.75, roughness: 0.28 },
  apex: { tintAmount: 0.38, emissiveAmount: 0.2, metalness: 0.55, roughness: 0.35 },
};

// Child-spawn config — every variant except apex drops a steady drip of
// brood while she walks. Most queens spawn their namesake species; the
// raptor matriarch now sheds paired swarm hatchlings so the pack reads
// like a whole entourage boiling out around her instead of one big
// raptor blinking in behind her. Apex has no child stream because the
// L30 wave already runs its own heavy entourage.
export type BossChildSpawn = { kind: EnemyKind; interval: number; count?: number };
export const BOSS_VARIANT_CHILD: Partial<Record<BossVariant, BossChildSpawn>> = {
  raptor: { kind: "swarm", interval: 1.25, count: 3 },
  stego: { kind: "stego", interval: 6.0 },
  para: { kind: "para", interval: 2.2 },
  allosaur: { kind: "allosaur", interval: 3.8 },
  armored: { kind: "armored", interval: 7.5 },
};

// End-of-run barrage — once the matriarch crosses `threshold` (0..1
// path progress), a second spawn channel opens that drops a wave of
// her species at the PATH START every `interval` seconds. Builds a
// trailing column that converges on her position so the final third
// of her walk feels oppressive rather than just-one-big-dino. Only
// the species variants that the player should feel chased by use
// this — apex/allosaur/armored already pressure via stats.
export type BossBarrage = {
  kind: EnemyKind;
  threshold: number;
  interval: number;
  count: number;
};
export const BOSS_VARIANT_BARRAGE: Partial<Record<BossVariant, BossBarrage>> = {
  raptor: { kind: "raptor", threshold: 0.45, interval: 2.4, count: 2 },
  stego: { kind: "stego", threshold: 0.45, interval: 4.5, count: 1 },
  para: { kind: "para", threshold: 0.45, interval: 2.6, count: 2 },
};

export const BOSS_VARIANT_LABEL: Record<BossVariant, string> = {
  raptor: "Raptor Matriarch",
  stego: "Stegosaur Matriarch",
  para: "Parasaur Matriarch",
  allosaur: "T-Rex Matriarch",
  armored: "Triceratops Matriarch",
  apex: "Apex Matriarch",
};

// Tower-source info carried by tower fire paths into applyDamage. The
// T3 anti-modifier flags below are inert by default — only towers that
// have purchased the matching upgrade populate them. attackerTowerId is
// always populated by the tower fire paths and is what kill-credit
// attribution reads when an enemy dies.
export type HitOptions = {
  shieldDamageMul?: number; // Mortar T3: extra damage to shields specifically
  armorPierce?: boolean; // Pulse T3: clamp resist-chip multipliers to ≥1
  resistStrip?: number; // Chain T3: permanently strip own-type resist toward 1
  regenSuppressOnHit?: number; // Pyre T3: extends regen pause after each hit
  attackerTowerId?: EntityId | null;
  // Set true on every robot-sourced damage path (auto-shots, burst,
  // incinerate ticks, dash coal embers). applyDamage uses it to credit
  // robot kills + damageDealt the same way attackerTowerId credits towers,
  // and to gate the robot.xp award so tower-only kills no longer drip XP
  // into the robot.
  fromRobot?: boolean;
  // Suppress per-impact screenshake on splash projectiles. Set by robot
  // normal-attack splash (Mike, Stan) so every shot doesn't kick the
  // camera. Forwarded to Projectile and consumed in projectiles.ts.
  suppressShake?: boolean;
  // Mortar Targeting meta — projectile splash applies +bonus damage when
  // ≥CLUSTER_THRESHOLD enemies are in the splash radius. Forwarded to
  // the Projectile and consumed in projectiles.ts:applyHit.
  clusterDamageBonus?: number;
};

export const applyDamage = (
  world: World,
  enemy: Enemy,
  amount: number,
  type: DamageType,
  deathColor = "#c44848",
  deathParticles = 8,
  pierceShield = false,
  hitOpts?: HitOptions,
) => {
  if (!enemy.alive || enemy.leak) return;
  let dmg = amount;
  // Running tally of damage actually applied to this enemy on this
  // call. Shield absorption + HP reduction (clamped to remaining HP so
  // overkill doesn't inflate the per-tower stat).
  let dealt = 0;

  // Shields absorb damage flat (ignoring damage type) before HP, unless
  // the source flagged itself as shield-piercing. The resist multiplier
  // only applies to the leftover dealt to HP, so a shielded raptor still
  // takes proper electric scaling once cracked.
  if (!pierceShield && enemy.shield > 0) {
    // Mortar T3 (Singularity) amplifies shield damage 2×.
    const shieldMul = hitOpts?.shieldDamageMul ?? 1;
    const shieldDmg = dmg * shieldMul;
    const absorbed = Math.min(enemy.shield, shieldDmg);
    enemy.shield -= absorbed;
    dealt += absorbed;
    // Convert shield-attributed damage back to "raw" units so HP bleed
    // isn't double-counted by the multiplier.
    dmg -= absorbed / shieldMul;
    enemy.flashUntil = world.time + 0.08;
    if (enemy.shield <= 0) {
      enemy.shield = 0;
      enemy.shieldBrokenAt = world.time;
      // Visible "break" pop — light blue energy burst around the enemy.
      spawnParticles(world, enemy.pos, 12, "#7fc8ff", [3, 6], 0.45);
    }
    if (dmg <= 0) {
      if (hitOpts?.attackerTowerId !== undefined && hitOpts.attackerTowerId !== null) {
        const attacker = world.towerById.get(hitOpts.attackerTowerId);
        if (attacker) attacker.damageDealt += dealt;
      }
      if (hitOpts?.fromRobot) world.robot.damageDealt += dealt;
      tallyAdaptiveDamage(world, type, dealt);
      return;
    }
  }

  // Combined boss-variant / resist-chip / armor-pierce
  // multiplier — shared with the tower-side damage estimator so tuning
  // one branch can't desync the other. See computeResistMul.
  const mul = computeResistMul(enemy, type, hitOpts?.armorPierce ?? false);
  const rawExtra = enemy.extraResists[type] ?? 1;
  const hpDmg = dmg * mul;
  // Clamp the attributed portion to remaining HP so a 1k-damage shot
  // into a 50-HP enemy reads as 50 dealt, not 1k — overkill shouldn't
  // pad the stat.
  dealt += Math.max(0, Math.min(enemy.hp, hpDmg));
  enemy.hp -= hpDmg;
  enemy.flashUntil = world.time + 0.08;
  // Regen chip self-heal pauses on every damage tick. Pyre T3 extends
  // the pause window further per hit; without T3 the default
  // REGEN_DAMAGE_PAUSE applies.
  if (enemy.regen) {
    const pause = Math.max(REGEN_DAMAGE_PAUSE, hitOpts?.regenSuppressOnHit ?? 0);
    enemy.regenPausedUntil = Math.max(enemy.regenPausedUntil, world.time + pause);
  }
  // Chain T3 (Arc Furnace) gradually undoes the resist-chip adaptation:
  // each hit pulls extraResists[type] toward 1. Stops being chill when
  // the modifier no longer pulls effective resist below 1.
  if (hitOpts?.resistStrip && hitOpts.resistStrip > 0 && rawExtra < 1) {
    enemy.extraResists[type] = Math.min(1, rawExtra + hitOpts.resistStrip);
  }
  // Damage attribution mirrors kill attribution — chain ricochets,
  // cryo/flame ticks, and projectile splash all funnel through here
  // with attackerTowerId set by the firing tower. The tower may have
  // been sold between fire and impact, so a missing lookup is silently
  // ignored.
  if (hitOpts?.attackerTowerId !== undefined && hitOpts.attackerTowerId !== null) {
    const attacker = world.towerById.get(hitOpts.attackerTowerId);
    if (attacker) attacker.damageDealt += dealt;
  }
  if (hitOpts?.fromRobot) world.robot.damageDealt += dealt;
  tallyAdaptiveDamage(world, type, dealt);
  if (enemy.hp <= 0) {
    enemy.alive = false;
    world.gold += enemy.bounty;
    if (hitOpts?.attackerTowerId !== undefined && hitOpts.attackerTowerId !== null) {
      const attacker = world.towerById.get(hitOpts.attackerTowerId);
      if (attacker) attacker.kills += 1;
    }
    // Robot XP + kill credit — both gated on the killing blow coming from
    // the robot (any robot-sourced damage path tags hitOpts.fromRobot). XP
    // persists across runs via the store's tick → progress.robotXp merge.
    // Tower kills no longer feed robot XP; the robot must do the work
    // itself. Killing-blow attribution (vs damage-share weighting) keeps
    // the accounting trivial and matches tower kill-credit semantics.
    if (hitOpts?.fromRobot) {
      world.robot.kills += 1;
      world.robot.xp += xpForEnemyKill(enemy.maxHp);
    }
    const bolts = rollDinoBoltDrop(enemy.kind);
    spawnParticles(world, enemy.pos, deathParticles, deathColor);
    if (bolts > 0) {
      const metalFlecks = Math.min(18, 3 + Math.ceil(bolts / 12));
      spawnParticles(world, enemy.pos, metalFlecks, "#c8b078", [2.5, 5.5], 0.45);
      spawnParticles(world, enemy.pos, Math.min(10, metalFlecks), "#8f9aa3", [1.8, 4.2], 0.38);
    }
    emit(world, { type: "death", pos: enemy.pos, target: "enemy", enemyKind: enemy.kind, bolts });
    // Boss kill — extra payout on top of the normal bounty so the
    // moment reads as a windfall, plus an event for the UI flash.
    // Scales with wave so late-game boss kills stay meaningful when
    // upgrades cost five-figure gold.
    if (enemy.kind === "boss") {
      const bonus = 100 + world.wave * 15;
      world.gold += bonus;
      // Bigger crimson burst on top of the standard death particles —
      // sells the takedown without needing a new VFX subsystem.
      spawnParticles(world, enemy.pos, 32, "#ff2a55", [4, 9], 0.7);
      emit(world, {
        type: "boss-defeated",
        wave: world.wave,
        bonus,
        variant: enemy.bossVariant ?? "apex",
      });
    }
  }
};

// Titans are too wide to bounce around the lane — pinning them near the
// centerline keeps the stomp feeling authoritative. Everyone else gets
// the full lateral range.
const LATERAL_OFFSET_BY_KIND: Record<EnemyKind, number> = {
  raptor: PATH_WIDTH * 0.35,
  swarm: PATH_WIDTH * 0.4,
  para: PATH_WIDTH * 0.3,
  allosaur: PATH_WIDTH * 0.25,
  stego: PATH_WIDTH * 0.2,
  armored: PATH_WIDTH * 0.2,
  titan: PATH_WIDTH * 0.08,
  // Boss is wider than the lane allows — pin to centerline so the
  // silhouette doesn't clip past the path edges.
  boss: 0,
};

export type SpawnOptions = {
  hpMul?: number;
  pathIndex?: number;
  shielded?: boolean;
  healAura?: boolean;
  regen?: boolean;
  // Per-damage-type adaptation — values < 1 reduce damage taken,
  // values > 1 increase. Stacks on top of base resists.
  resists?: Partial<Record<DamageType, number>>;
  // Boss-only — picks the biome-themed matriarch variant. Ignored for
  // non-boss kinds. When kind === "boss" and bossVariant is unset, the
  // apex matriarch is used.
  bossVariant?: BossVariant;
};

export const spawnEnemy = (world: World, kind: EnemyKind, opts: SpawnOptions = {}): Enemy => {
  const {
    hpMul = 1,
    pathIndex = 0,
    shielded = false,
    healAura = false,
    regen = false,
    resists,
    bossVariant,
  } = opts;
  // Bosses route through the variant table for HP/speed/damage/bounty so
  // each biome's matriarch reads as a distinct adversary. Non-boss kinds
  // ignore the variant. Unset variant defaults to apex (the original).
  const effectiveVariant: BossVariant | undefined =
    kind === "boss" ? (bossVariant ?? "apex") : undefined;
  const base =
    effectiveVariant !== undefined ? BOSS_VARIANT_STATS[effectiveVariant] : ENEMY_STATS[kind];
  const path = world.paths[pathIndex] ?? world.paths[0];
  const start = path[0];
  const maxHp = Math.ceil(base.hp * hpMul);
  // Bounty stacks multiplicatively per active chip so combos pay out
  // proportionally to the threat — never extra-flat from one big chip.
  let bountyMul = 1;
  if (shielded) bountyMul *= SHIELDED_BOUNTY_MUL;
  if (healAura) bountyMul *= HEAL_AURA_BOUNTY_MUL;
  if (regen) bountyMul *= REGEN_BOUNTY_MUL;
  // Difficulty's gold-per-kill multiplier folds in here so the existing
  // `world.gold += enemy.bounty` in applyDamage stays a single read.
  const bounty = Math.max(1, Math.ceil(base.bounty * bountyMul * world.goldKillMul));
  // Shield pool is fixed by kind (not scaled by hpMul) — that way the
  // tutorial-feel of cracking a raptor's 10-pt bubble doesn't erode at
  // late levels where hpMul is high.
  const baseShield = SHIELD_BY_KIND[kind] ?? 0;
  const maxShield = shielded && baseShield > 0 ? baseShield : 0;
  // Bias away from zero so enemies actually spread — pure uniform often
  // clusters near 0 visually when there are only a handful on screen.
  const range = LATERAL_OFFSET_BY_KIND[kind];
  const lateralOffset = (Math.random() * 2 - 1) * range;
  // Matriarch variants drip a steady stream of their namesake species
  // behind them — seed the timer so the first child appears one interval
  // after she enters the field rather than immediately at spawn.
  const childCfg =
    effectiveVariant !== undefined ? BOSS_VARIANT_CHILD[effectiveVariant] : undefined;
  const barrageCfg =
    effectiveVariant !== undefined ? BOSS_VARIANT_BARRAGE[effectiveVariant] : undefined;
  const enemy: Enemy = {
    id: world.nextEntityId++,
    kind: base.kind,
    pos: { x: start.x, y: start.y },
    pathIndex,
    segment: 0,
    segmentT: 0,
    lateralOffset,
    hp: maxHp,
    maxHp,
    speed: base.speed * world.speedMul,
    bounty,
    damage: base.damage,
    alive: true,
    slowUntil: 0,
    slowFactor: 1,
    flashUntil: 0,
    frost: 0,
    shield: maxShield,
    maxShield,
    shieldBrokenAt: 0,
    healAura,
    regen,
    regenPausedUntil: 0,
    engagedRobotId: null,
    extraResists: resists ? { ...resists } : {},
    igniteUntil: 0,
    igniteDps: 0,
    igniteTickAt: 0,
    igniteAttackerTowerId: null,
    freezeUntil: 0,
    bossVariant: effectiveVariant,
    childSpawnAt: childCfg ? world.time + childCfg.interval : undefined,
    barrageSpawnAt: barrageCfg ? world.time + barrageCfg.interval : undefined,
    footstepAccum: 0,
  };
  // Adaptive resistance snapshot — a fraction of spawns at L12+ mutate
  // their extraResists toward immunity for the dominant damage type
  // picked by startWave. The renderer reads `adaptiveResistType` to
  // pick the off-color body tint. Whole block is gated by the feature
  // flag so it can be backed out in one flip.
  if (
    ADAPTIVE_RESISTANCE_ENABLED &&
    !world.endless &&
    world.adaptation.dominantNext !== null &&
    world.levelId >= ADAPT_TRIGGER_LEVEL
  ) {
    const lvl = world.levelId;
    const streak = world.adaptation.dominantStreak;
    const share = world.adaptation.dominantShare;
    if (Math.random() < adaptiveCoverage(lvl, streak, share)) {
      const type = world.adaptation.dominantNext;
      const boostScale = enemy.kind === "boss" ? ADAPT_BOSS_BOOST_SCALE : 1;
      const boost = adaptiveBoost(lvl, streak, share) * boostScale;
      // baseMul matches what applyDamage will look up for the dominant
      // type — keeps the "snap to immune" floor in sync with the real
      // damage path.
      const baseMul =
        enemy.kind === "boss" && enemy.bossVariant !== undefined
          ? BOSS_VARIANT_RESIST[enemy.bossVariant][type]
          : ENEMY_RESIST[enemy.kind][type];
      const existing = enemy.extraResists[type] ?? 1;
      let next = existing * (1 - boost);
      if (enemy.kind !== "boss" && baseMul * next <= ADAPT_IMMUNITY_FLOOR) next = 0;
      enemy.extraResists[type] = next;
      enemy.adaptiveResistType = type;
      enemy.adaptiveResistAmount = adaptiveTintAmount(lvl, streak);
    }
  }
  world.enemies.push(enemy);
  world.enemyById.set(enemy.id, enemy);
  world.runEnemyKinds[kind] = true;
  return enemy;
};

export type TowerBaseStats = {
  range: number;
  damage: number;
  fireRate: number;
  splashRadius: number;
  chainCount: number;
  chainFalloff: number;
  slowFactor: number;
  slowDuration: number;
};

export const TOWER_STATS: Record<TowerKind, TowerBaseStats> = {
  pulse: {
    range: 6.5,
    damage: 10,
    fireRate: 2.0,
    splashRadius: 0,
    chainCount: 0,
    chainFalloff: 1,
    slowFactor: 1,
    slowDuration: 0,
  },
  chain: {
    range: 5.5,
    damage: 9,
    fireRate: 1.2,
    splashRadius: 0,
    chainCount: 4,
    chainFalloff: 0.6,
    slowFactor: 1,
    slowDuration: 0,
  },
  cryo: {
    range: 4.5,
    damage: 0,
    fireRate: 1.5,
    splashRadius: 0,
    chainCount: 0,
    chainFalloff: 1,
    slowFactor: 0.4,
    slowDuration: 1.5,
  },
  mortar: {
    range: 9.0,
    damage: 26,
    fireRate: 0.5,
    splashRadius: 1.8,
    chainCount: 0,
    chainFalloff: 1,
    slowFactor: 1,
    slowDuration: 0,
  },
  // Flame — mid-range forward cone, base damage at high tick rate so it
  // reads as a continuous burn on anything stuck in the stream.
  flame: {
    range: 6.0,
    damage: 5,
    fireRate: 5.0,
    splashRadius: 0,
    chainCount: 0,
    chainFalloff: 1,
    slowFactor: 1,
    slowDuration: 0,
  },
  // Hive — pure support tower. `damage` and `fireRate` are unused (UI
  // hides them); the relevant numbers are HIVE_BASE_DRONES + the
  // serviceBuff fraction set in createTower / upgrades. Range is what
  // shows as the tower's selection ring but doesn't gate anything sim-
  // side: drones can fly to any tower on the map.
  hive: {
    range: 0,
    damage: 0,
    fireRate: 0,
    splashRadius: 0,
    chainCount: 0,
    chainFalloff: 1,
    slowFactor: 1,
    slowDuration: 0,
  },
};

// Hive support tuning. Drone count grows with Path A upgrades up to a
// hard cap so the assignment array can be statically sized.
export const HIVE_BASE_DRONES = 3;
export const HIVE_MAX_DRONES = 6;
// Max drones (summed across every hive) that can be assigned to a
// single target tower. Distinct from HIVE_MAX_DRONES — that caps one
// hive's roster; this caps stacking on one buffed tower so full drone
// bays push the player toward multiple supported tower roles instead
// of one overclocked pulse/flame anchor.
export const HIVE_MAX_DRONES_PER_TOWER = 3;
// Default fire-rate buff each assigned drone confers to its target.
// Path B upgrades scale this — see upgrades.ts. Kept below the summed
// Path B total (+0.26) so a maxed Service Link out-contributes the base
// floor — investment beats the freebie. At 3 drones/tower this is +60%
// fire rate on one anchor (was +90% at 0.30, which doubled an anchor's
// DPS on its own).
export const HIVE_BASE_SERVICE_BUFF = 0.2;

export const TOWER_COST: Record<TowerKind, number> = {
  pulse: 50,
  chain: 50,
  cryo: 75,
  mortar: 120,
  flame: 80,
  hive: 150,
};

// Hard per-kind build cap for the current run. Replaces the old
// duplicate-cost surcharge: rather than taxing the Nth identical tower,
// a kind simply can't be stacked past this many copies. This curbs
// mono-spam without touching the price of the first copies, so the
// early-wave gold economy (tuned in waves L1-14) is left intact, and it
// pushes the loadout toward breadth — each kind keeps its niche because
// you can't tunnel a single one. Generous enough that normal play rarely
// hits it; low enough to kill degenerate one-tower builds. Applies to
// every run mode (debug free-towers included) since it is a placement
// rule, not an economy gate.
export const TOWER_BUILD_LIMIT = 8;

export const towerCountForKind = (world: World, kind: TowerKind): number => {
  let n = 0;
  for (const t of world.towers) if (t.kind === kind) n++;
  return n;
};

export const towerKindAtBuildLimit = (world: World, kind: TowerKind): boolean =>
  towerCountForKind(world, kind) >= TOWER_BUILD_LIMIT;

export const TOWER_LABEL: Record<TowerKind, string> = {
  pulse: "Pulse Rifle",
  chain: "Chain Coil",
  cryo: "Cryo Emitter",
  mortar: "Mortar",
  flame: "Pyre",
  hive: "Hive Swarm",
};

export const TOWER_FOOTPRINT = 1.0;

// Radius of the placement highlight disc drawn under a tower/spawn. Decor
// (ground cover) overlapping this disc is culled on placement so the base
// sits on clean ground with nothing poking through the visible ring. Must
// equal the placement ring's outer radius in Placement.tsx so the cleared
// area matches exactly what the player sees highlighted.
export const TOWER_CLEAR_RADIUS = 0.7;

export const createTower = (world: World, kind: TowerKind, pos: Vec2): Tower => {
  const stats = TOWER_STATS[kind];
  const tower: Tower = {
    id: world.nextEntityId++,
    kind,
    pos: { x: pos.x, y: pos.y },
    range: stats.range,
    damage: stats.damage,
    fireRate: stats.fireRate,
    cooldown: 0,
    targetId: null,
    targetingMode: "end",
    targetSpot: null,
    upgrades: { a: 0, b: 0 },
    totalSpent: TOWER_COST[kind],
    splashRadius: stats.splashRadius,
    chainCount: stats.chainCount,
    chainFalloff: stats.chainFalloff,
    slowFactor: stats.slowFactor,
    slowDuration: stats.slowDuration,
    // Hive support — drone count caps at HIVE_MAX_DRONES so assignment
    // arrays stay fixed-size; only the first `droneCount` entries are
    // active. Non-hive towers get zero/empty defaults.
    droneCount: kind === "hive" ? HIVE_BASE_DRONES : 0,
    droneAssignments: kind === "hive" ? new Array<number | null>(HIVE_MAX_DRONES).fill(null) : [],
    serviceBuff: kind === "hive" ? HIVE_BASE_SERVICE_BUFF : 0,
    serviceFireRateBonus: 0,
    // T3 anti-modifier flags — defaults are inert; specific tier-3
    // upgrades flip these in `upgrades.ts` so the projectile/hit path
    // can crack through `resists` chip adaptation.
    shieldDamageMul: 1,
    armorPierce: false,
    resistStrip: 0,
    regenSuppressOnHit: 0,
    freezeBlocksRegen: false,
    critChance: 0,
    critMul: 1,
    freezeChance: 0,
    freezeDuration: 0,
    chainSlowFactor: 1,
    chainSlowDuration: 0,
    clusterDamageBonus: 0,
    flameIgniteDuration: 0,
    flameIgniteDps: 0,
    serviceDamageBonus: 0,
    serviceDamageBonusFrom: 0,
    kills: 0,
    damageDealt: 0,
    flameActive: false,
  };
  world.towers.push(tower);
  world.towerById.set(tower.id, tower);
  world.runTowerKinds[kind] = true;
  return tower;
};

export const createProjectile = (
  world: World,
  kind: ProjectileKind,
  damageType: DamageType,
  pos: Vec2,
  target: { id: number; pos: Vec2 } | Vec2,
  damage: number,
  splashRadius = 0,
  speed = 22,
  pierceShield = false,
  hitOpts?: HitOptions,
): Projectile => {
  const targetId = "id" in target ? target.id : null;
  const targetPos = "pos" in target ? { ...target.pos } : { x: target.x, y: target.y };
  const p: Projectile = {
    id: world.nextEntityId++,
    kind,
    damageType,
    pos: { x: pos.x, y: pos.y },
    targetId,
    targetPos,
    damage,
    speed,
    splashRadius,
    alive: true,
    pierceShield,
    shieldDamageMul: hitOpts?.shieldDamageMul ?? 1,
    armorPierce: hitOpts?.armorPierce ?? false,
    resistStrip: hitOpts?.resistStrip ?? 0,
    regenSuppressOnHit: hitOpts?.regenSuppressOnHit ?? 0,
    ownerTowerId: hitOpts?.attackerTowerId ?? null,
    fromRobot: hitOpts?.fromRobot ?? false,
    suppressShake: hitOpts?.suppressShake ?? false,
    clusterDamageBonus: hitOpts?.clusterDamageBonus ?? 0,
  };
  world.projectiles.push(p);
  return p;
};

export const createBeam = (
  world: World,
  points: readonly BeamPoint[],
  color: string,
  lifeSec = 0.12,
): Beam => {
  const b: Beam = {
    id: world.nextEntityId++,
    points: points.map((p) => ({
      x: p.x,
      y: p.y,
      ...(p.h === undefined ? {} : { h: p.h }),
    })),
    color,
    expiresAt: world.time + lifeSec,
  };
  world.beams.push(b);
  return b;
};

// Drop one burning-coal tile at `pos`. Owned by Mike's dash; the
// updateCoalEmbers tick applies flame AoE damage per tickInterval until
// the tile expires. Ember lifetime is per-tile so spaced drops along the
// dash track each fade on their own clock.
export const createCoalEmber = (
  world: World,
  pos: Vec2,
  tickDamage: number,
  radius: number,
  lifeSec: number,
): CoalEmber => {
  const e: CoalEmber = {
    id: world.nextEntityId++,
    pos: { x: pos.x, y: pos.y },
    expiresAt: world.time + lifeSec,
    maxLife: lifeSec,
    nextTickAt: world.time + 0.18,
    tickDamage,
    radius,
  };
  world.coalEmbers.push(e);
  return e;
};

// Tick every ember: apply AoE flame damage on each interval, drop the
// tile when it expires. O(embers × enemies in radius) — kept cheap by
// the short lifetime + small radius.
export const COAL_TICK_INTERVAL = 0.2;
export const updateCoalEmbers = (world: World, _dt: number) => {
  if (world.coalEmbers.length === 0) return;
  const remaining: CoalEmber[] = [];
  for (const e of world.coalEmbers) {
    if (world.time >= e.expiresAt) continue;
    if (world.time >= e.nextTickAt) {
      const r2 = e.radius * e.radius;
      for (const enemy of world.enemies) {
        if (!enemy.alive || enemy.leak) continue;
        const dx = enemy.pos.x - e.pos.x;
        const dy = enemy.pos.y - e.pos.y;
        if (dx * dx + dy * dy > r2) continue;
        applyDamage(world, enemy, e.tickDamage, "flame", "#ff8a3a", 3, false, {
          fromRobot: true,
        });
      }
      e.nextTickAt = world.time + COAL_TICK_INTERVAL;
    }
    remaining.push(e);
  }
  world.coalEmbers = remaining;
};

// Robot-owned burn DoT. Piggybacks on the existing ignite system so
// enemies render their burn state the same way as flame-tower ignite.
// Burn duration + total damage are translated to a DPS-style stamp so
// the existing tick loop in updateEnemies applies the damage.
export const applyRobotBurn = (
  world: World,
  enemy: Enemy,
  duration: number,
  totalDamage: number,
) => {
  if (!enemy.alive || enemy.leak) return;
  const dps = totalDamage / Math.max(0.01, duration);
  enemy.igniteUntil = Math.max(enemy.igniteUntil, world.time + duration);
  enemy.igniteDps = Math.max(enemy.igniteDps, dps);
  enemy.igniteAttackerTowerId = null;
  if (enemy.igniteTickAt <= world.time) {
    enemy.igniteTickAt = world.time + 0.5;
  }
};

// Path-relative knockback. Drops the enemy's segmentT back by `pushUnits`
// world-units along the path, clamped to segment 0. Re-syncs the enemy's
// world position so the render reads the new path coordinate instantly.
export const applyPathKnockback = (world: World, enemy: Enemy, pushUnits: number) => {
  if (!enemy.alive || enemy.leak) return;
  const path = world.paths[enemy.pathIndex] ?? world.paths[0];
  if (!path) return;
  let seg = enemy.segment;
  let t = enemy.segmentT;
  let remaining = pushUnits;
  while (remaining > 0 && seg >= 0) {
    const a = path[seg];
    const b = path[seg + 1];
    if (!a || !b) break;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const traveled = segLen * t;
    if (remaining <= traveled) {
      const newTraveled = traveled - remaining;
      t = segLen > 1e-6 ? newTraveled / segLen : 0;
      remaining = 0;
    } else {
      remaining -= traveled;
      seg -= 1;
      t = 1;
    }
  }
  if (seg < 0) {
    seg = 0;
    t = 0;
  }
  enemy.segment = seg;
  enemy.segmentT = t;
  const a = path[seg];
  const b = path[seg + 1] ?? a;
  if (a && b) {
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const len = Math.hypot(tx, ty);
    const ux = len > 1e-6 ? tx / len : 1;
    const uy = len > 1e-6 ? ty / len : 0;
    // Right-hand normal so lateralOffset sign matches projectOnPath.
    const nx = -uy;
    const ny = ux;
    enemy.pos = {
      x: a.x + ux * (len * t) + nx * enemy.lateralOffset,
      y: a.y + uy * (len * t) + ny * enemy.lateralOffset,
    };
  }
};

// Stan-owned explosive crater. Each instance ticks AoE explosive damage
// every tickInterval until expiresAt. Distinct from coalEmber so the
// damage type, color, and tick cadence stay robot-flavoured.
export const createRobotCrater = (
  world: World,
  pos: Vec2,
  radius: number,
  tickDamage: number,
  tickInterval: number,
  duration: number,
) => {
  world.robotCraters.push({
    id: world.nextEntityId++,
    pos: { x: pos.x, y: pos.y },
    expiresAt: world.time + duration,
    maxLife: duration,
    nextTickAt: world.time + 0.1,
    tickInterval,
    tickDamage,
    radius,
  });
};

// Tick every crater: explosive AoE every tickInterval, drop when expired.
export const updateRobotCraters = (world: World, _dt: number) => {
  if (world.robotCraters.length === 0) return;
  const remaining: typeof world.robotCraters = [];
  for (const c of world.robotCraters) {
    if (world.time >= c.expiresAt) continue;
    if (world.time >= c.nextTickAt) {
      const r2 = c.radius * c.radius;
      for (const enemy of world.enemies) {
        if (!enemy.alive || enemy.leak) continue;
        const dx = enemy.pos.x - c.pos.x;
        const dy = enemy.pos.y - c.pos.y;
        if (dx * dx + dy * dy > r2) continue;
        applyDamage(world, enemy, c.tickDamage, "explosive", "#ff8a3a", 3);
      }
      c.nextTickAt = world.time + c.tickInterval;
    }
    remaining.push(c);
  }
  world.robotCraters = remaining;
};

export const createCryoWave = (
  world: World,
  pos: Vec2,
  maxRadius: number,
  lifeSec: number,
  towerId: EntityId,
): CryoWave => {
  const w: CryoWave = {
    id: world.nextEntityId++,
    pos: { x: pos.x, y: pos.y },
    maxRadius,
    expiresAt: world.time + lifeSec,
    maxLife: lifeSec,
    towerId,
    hitIds: new Set(),
  };
  world.cryoWaves.push(w);
  return w;
};

export const createExplosion = (
  world: World,
  pos: Vec2,
  radius: number,
  lifeSec = 0.35,
): Explosion => {
  const e: Explosion = {
    id: world.nextEntityId++,
    pos: { x: pos.x, y: pos.y },
    radius,
    expiresAt: world.time + lifeSec,
    maxLife: lifeSec,
  };
  world.explosions.push(e);
  // Soot puffs scale with blast radius so a tiny sidearm pop spawns
  // ~3 wisps while a mortar gets a fat plume. Capped to keep the puff
  // pool from blowing out on overlapping splashes.
  const puffCount = Math.min(10, Math.max(3, Math.round(radius * 2.2)));
  spawnExplosionSmoke(world, pos, radius, puffCount);
  return e;
};

export const spawnParticles = (
  world: World,
  pos: Vec2,
  count: number,
  color: string,
  speedRange: [number, number] = [2, 5],
  lifeSec = 0.35,
  baseDir?: Vec2,
  halfConeRadians?: number,
) => {
  const hasDir = baseDir && (baseDir.x !== 0 || baseDir.y !== 0);
  const baseAngle = hasDir ? Math.atan2(baseDir!.y, baseDir!.x) : 0;
  const halfCone = hasDir ? (halfConeRadians ?? Math.PI / 6) : Math.PI;
  for (let i = 0; i < count; i++) {
    const angle = hasDir
      ? baseAngle + (Math.random() * 2 - 1) * halfCone
      : Math.random() * Math.PI * 2;
    const spd = speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]);
    world.particles.push({
      id: world.nextEntityId++,
      pos: { x: pos.x, y: pos.y },
      vel: { x: Math.cos(angle) * spd, y: Math.sin(angle) * spd },
      expiresAt: world.time + lifeSec,
      maxLife: lifeSec,
      color,
    });
  }
};

// Soft smoke puffs spawned at an explosion impact — Kenney whitepuff
// sprite billboards rendered separately from the existing additive
// spark particles. Tinted darker for diesel/industrial reads, with
// outward drift, slow upward rise, and rotation jitter.
export const spawnExplosionSmoke = (world: World, pos: Vec2, radius: number, count = 6) => {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const drift = 0.6 + Math.random() * 1.4;
    const life = 0.9 + Math.random() * 0.6;
    const size0 = radius * (0.45 + Math.random() * 0.25);
    const size1 = radius * (1.1 + Math.random() * 0.4);
    // Mix of warm (smoke lit by fire) and cool grey, biased darker for
    // the "explosion soot" read.
    const warm = Math.random() < 0.35;
    const tint = warm
      ? `rgb(${140 + ((Math.random() * 30) | 0)},${80 + ((Math.random() * 20) | 0)},${55 + ((Math.random() * 15) | 0)})`
      : `rgb(${90 + ((Math.random() * 50) | 0)},${85 + ((Math.random() * 45) | 0)},${82 + ((Math.random() * 40) | 0)})`;
    world.puffs.push({
      id: world.nextEntityId++,
      pos: { x: pos.x, y: pos.y },
      vel: { x: Math.cos(angle) * drift, y: Math.sin(angle) * drift },
      h: 0.4 + Math.random() * 0.3,
      vh: 0.6 + Math.random() * 0.8,
      expiresAt: world.time + life,
      maxLife: life,
      size0,
      size1,
      rot: Math.random() * Math.PI * 2,
      rotVel: (Math.random() * 2 - 1) * 0.6,
      tint,
      alpha0: 0.55 + Math.random() * 0.2,
    });
  }
};

export const emit = (world: World, event: GameEvent) => {
  world.events.push(event);
};

export const addShake = (world: World, magnitude: number, decay = 6) => {
  world.shake.magnitude = Math.max(world.shake.magnitude, magnitude);
  world.shake.decay = decay;
};

export const enemyPosOnPath = (world: World, enemy: Enemy): Vec2 =>
  samplePath(world.paths[enemy.pathIndex], enemy.segment, enemy.segmentT);

export const applySlow = (enemy: Enemy, world: World, factor: number, duration: number) => {
  const resist =
    enemy.kind === "boss" && enemy.bossVariant !== undefined
      ? BOSS_VARIANT_SLOW_RESIST[enemy.bossVariant]
      : ENEMY_SLOW_RESIST[enemy.kind];
  const resisted = factor + (1 - factor) * resist;
  const eff = Math.max(MIN_SLOW_FACTOR, resisted);
  if (eff >= 1) return;
  const until = world.time + duration;
  if (until > enemy.slowUntil) {
    enemy.slowUntil = until;
    enemy.slowFactor = Math.min(enemy.slowFactor, eff);
  } else if (eff < enemy.slowFactor) {
    enemy.slowFactor = eff;
  }
};
