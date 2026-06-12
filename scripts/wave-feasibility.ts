/**
 * Wave feasibility analyzer — static balance check.
 *
 *   npx tsx scripts/wave-feasibility.ts                  # all levels
 *   npx tsx scripts/wave-feasibility.ts 15               # single level
 *   npx tsx scripts/wave-feasibility.ts 15 --detail      # show top-3 tower picks
 *   npx tsx scripts/wave-feasibility.ts --no-robot        # ignore robot contribution
 *   npx tsx scripts/wave-feasibility.ts --robot=stan      # force a specific robot variant
 *   npx tsx scripts/wave-feasibility.ts --stars=0        # zero tower meta-skill investment
 *   npx tsx scripts/wave-feasibility.ts --robot-skills=0  # zero robot skill investment
 *   npx tsx scripts/wave-feasibility.ts --no-base-upgrades # skip HQ-laser upgrade search
 *   npx tsx scripts/wave-feasibility.ts --no-adapt        # disable adaptive-resistance penalty
 *   npx tsx scripts/wave-feasibility.ts --no-immunity-coverage # skip 0× injection pass
 *   npx tsx scripts/wave-feasibility.ts --soft           # flag easy waves only
 *   npx tsx scripts/wave-feasibility.ts --difficulty=extinction # model a difficulty's mults
 *
 * For each wave, the tool compares two numbers:
 *
 *   requiredDps  = totalWaveHp / combatWindow
 *   achievableDps = bestTowerKind × count-buildable-from-remainingBudget
 *                   × weighted-average resist-vs-this-mix × aoe-multiplier
 *                   × adaptive-resistance penalty (level >= ADAPT_TRIGGER_LEVEL)
 *                   + baseDps (HQ laser at the chosen upgrade state)
 *                   + robotDps (variant-specific auto + abilities, with skill tree)
 *
 *   feasibility = achievableDps × combatWindow / totalWaveHp
 *
 * Assumes perfect play: every tower fully upgraded (both branches, all tiers),
 * meta-skill ranks invested optimally for the chosen tower kind, robot
 * present and engaging when in range, HQ-laser upgrades bought when worth
 * the gold trade-off. A feasibility >= 1.0 means the wave is clearable in
 * theory; <1.0 means the budget genuinely can't produce enough DPS.
 *
 * Star budgets default to one-perfect-3-star-clear-of-prior-levels:
 *   tower meta:   min(9, 3 × (level.id - 1)) per kind (3 nodes × 3 ranks)
 *   robot skills:  min(12, 3 × (level.id - 1)) per active robot (4 nodes × 3 ranks)
 *
 * Budget per wave = startGold + sum(bounties, waves 1..N-1) + sum(5+wave, 1..N-1).
 * Tower + HQ-upgrade costs both pull from this pool — the optimizer picks
 * the split that maximises end-of-wave damage. Does NOT include early-call
 * bonuses (variable) or assume surviving towers from earlier waves. Same-kind
 * copies are flat-cost but capped at TOWER_BUILD_LIMIT; upgrades fixed-cost.
 *
 * Runtime spawn-time mutations modeled:
 *   - ensureImmunityCoverage (src/sim/immunityCoverage.ts) — replays the same
 *     0× resist injection the real game runs at run start, so the analyzer
 *     sees the immunity holdouts that punish single-tower spam. Disable with
 *     --no-immunity-coverage.
 *   - adaptiveBoost / adaptiveCoverage (src/sim/world.ts) — for levels >=
 *     ADAPT_TRIGGER_LEVEL the herd retunes against the dominant damage type
 *     the player relies on. Modeled here as a multiplicative DPS penalty
 *     against the picked tower's damage type:
 *       penalty = 1 − adaptiveCoverage(level, streak, share)
 *                   × adaptiveBoost(level, streak, share)
 *     Disable with --no-adapt to compare against the legacy "static
 *     resists only" baseline.
 *
 * Limitations (still optimistic):
 *   - Hive support tower returns 0 DPS — drone buffs not simulated, so
 *     hive-centric strategies are under-estimated.
 *   - Single-path coverage assumes every placed tower hits every enemy
 *     with no fire-rate saturation or overkill waste; spam strategies on
 *     a one-lane map look ideal even when in-game the extra towers idle.
 *   - Robot uptime fixed at ROBOT_BASE_UPTIME with a wave-length-scaled
 *     death penalty; real engagement depends on positioning + ability cycling.
 */

import { LEVELS, levelHasMode, resolveLevelMode, scaleWaveCounts } from "../src/levels";
import {
  DIFFICULTY_MULTIPLIERS,
  type Difficulty,
  type DifficultyMultipliers,
  LEVEL_MODES,
  type LevelMode,
} from "../src/progress";
import { availableDamageTypes, ensureImmunityCoverage } from "../src/sim/immunityCoverage";
import {
  type AllMetaSkills,
  applyMetaSkillsToTower,
  BRANCH_IDS,
  type BranchId,
  branchSpent,
  effectiveTowerCost,
  getTier,
  MAX_TIER,
} from "../src/sim/metaSkills";
import { pathLength } from "../src/sim/path";
import { type AllRobotSkills, applyRobotSkillsToRobot } from "../src/sim/robotSkills";
import { ROBOT_SPECS, type RobotVariantSpec } from "../src/sim/robotVariants";
import { flameThroughputCapacity } from "../src/sim/towers";
import type {
  Base,
  DamageType,
  EnemyKind,
  EnemySpec,
  Robot,
  RobotVariant,
  Tower,
  TowerKind,
  Vec2,
  WaveSpec,
} from "../src/sim/types";
import { BASE_UPGRADES, UPGRADES } from "../src/sim/upgrades";
import {
  ADAPT_TRIGGER_LEVEL,
  adaptiveBoost,
  adaptiveCoverage,
  BASE_DAMAGE,
  BASE_FIRE_RATE,
  BASE_RANGE,
  BOSS_VARIANT_CHILD,
  BOSS_VARIANT_RESIST,
  BOSS_VARIANT_STATS,
  ENEMY_RESIST,
  ENEMY_STATS,
  lateWaveHpFactor,
  ROBOT_RESPAWN_DELAY,
  TOWER_BUILD_LIMIT,
  TOWER_DAMAGE_TYPE,
  TOWER_STATS,
  type TowerBaseStats,
} from "../src/sim/world";
import { coverageFraction, pathCoverage } from "./lib/coverage";

// Resolve the effective base stats for a spawn entry. Bosses route
// through the variant table so each biome-themed matriarch contributes
// her actual HP/speed/bounty to the wave breakdown, not the default
// boss row of ENEMY_STATS.
const specStats = (s: EnemySpec) =>
  s.kind === "boss" && s.bossVariant ? BOSS_VARIANT_STATS[s.bossVariant] : ENEMY_STATS[s.kind];

const specResist = (s: EnemySpec, dmgType: import("../src/sim/types").DamageType): number =>
  s.kind === "boss" && s.bossVariant
    ? BOSS_VARIANT_RESIST[s.bossVariant][dmgType]
    : ENEMY_RESIST[s.kind][dmgType];

// ------- Tower modeling -------

type TowerConfig = TowerBaseStats & {
  kind: TowerKind;
  tierA: 0 | 1 | 2 | 3;
  tierB: 0 | 1 | 2 | 3;
  cost: number;
  meta: AllMetaSkills;
};

/**
 * Build a tower stat block at a given (tierA, tierB) upgrade state with an
 * optional meta-skill investment baked in. Meta nodes apply at "tower
 * creation" in the live game (see applyMetaSkillsToTower), so we mirror
 * that order: meta first, then in-game upgrade tiers scale on top.
 */
const buildConfig = (
  kind: TowerKind,
  tierA: 0 | 1 | 2 | 3,
  tierB: 0 | 1 | 2 | 3,
  meta: AllMetaSkills,
): TowerConfig => {
  const base = TOWER_STATS[kind];
  const t = { ...base, upgrades: { a: 0, b: 0 } } as unknown as Tower;
  t.kind = kind;
  applyMetaSkillsToTower(t, meta);
  let cost = effectiveTowerCost(kind, meta);
  const tree = UPGRADES[kind];
  for (let i = 0; i < tierA; i++) {
    tree.a.tiers[i].apply(t);
    cost += tree.a.tiers[i].cost;
  }
  for (let i = 0; i < tierB; i++) {
    tree.b.tiers[i].apply(t);
    cost += tree.b.tiers[i].cost;
  }
  return {
    kind,
    tierA,
    tierB,
    range: t.range,
    damage: t.damage,
    fireRate: t.fireRate,
    splashRadius: t.splashRadius,
    chainCount: t.chainCount,
    chainFalloff: t.chainFalloff,
    slowFactor: t.slowFactor,
    slowDuration: t.slowDuration,
    cost,
    meta,
  };
};

/**
 * Enumerate every meta-skill tier allocation for one tower kind that fits
 * within `starBudget`. Each kind has 3 branches × 5 tier states (0..4)
 * = 125 combos before budget filtering. With star budget < 21, fewer
 * survive the filter.
 */
const enumerateMetaAllocations = (kind: TowerKind, starBudget: number): AllMetaSkills[] => {
  const out: AllMetaSkills[] = [];
  for (let a = 0; a <= MAX_TIER; a++) {
    const aCost = branchSpent(a);
    if (aCost > starBudget) break;
    for (let b = 0; b <= MAX_TIER; b++) {
      const bCost = branchSpent(b);
      if (aCost + bCost > starBudget) break;
      for (let c = 0; c <= MAX_TIER; c++) {
        if (aCost + bCost + branchSpent(c) > starBudget) break;
        const tiers: Partial<Record<BranchId, number>> = {};
        if (a > 0) tiers.a = a;
        if (b > 0) tiers.b = b;
        if (c > 0) tiers.c = c;
        out.push({ [kind]: tiers });
      }
    }
  }
  return out;
};

/**
 * All (upgrade × meta) configs for every tower kind, given a per-kind
 * star budget. With budget=9 and 6 kinds: 6 × 16 × 64 = 6,144 configs.
 * With budget=0 it collapses back to 144 (original behaviour).
 */
const buildAllConfigs = (starBudget: number): TowerConfig[] => {
  const out: TowerConfig[] = [];
  for (const kind of Object.keys(TOWER_STATS) as TowerKind[]) {
    const metaOptions = enumerateMetaAllocations(kind, starBudget);
    for (const meta of metaOptions) {
      for (let a = 0; a <= 3; a++) {
        for (let b = 0; b <= 3; b++) {
          out.push(buildConfig(kind, a as 0 | 1 | 2 | 3, b as 0 | 1 | 2 | 3, meta));
        }
      }
    }
  }
  return out;
};

const affordableCopies = (
  cfg: TowerConfig,
  budget: number,
): { count: number; totalCost: number } => {
  // Every copy costs the same (cfg.cost already folds in meta discount +
  // upgrade tiers). No duplicate surcharge — same-kind stacking is bounded
  // by the flat TOWER_BUILD_LIMIT instead.
  const perCopy = cfg.cost;
  const maxByGold = perCopy > 0 ? Math.floor(budget / perCopy) : 0;
  const count = Math.min(maxByGold, TOWER_BUILD_LIMIT);
  return { count, totalCost: count * perCopy };
};

const summarizeMeta = (meta: AllMetaSkills, kind: TowerKind): string => {
  const tiers = meta[kind];
  if (!tiers) return "—";
  const parts = BRANCH_IDS.map((b) => {
    const t = getTier(meta, kind, b);
    return t > 0 ? `${b}T${t}` : "";
  }).filter(Boolean);
  return parts.length === 0 ? "—" : parts.join(",");
};

// Default star budget per kind for level N: assume the player has cleared
// every prior level with all 5 stars (3 normal + breach + containment). Capped
// at 21 — the cost to fully max one tower's three-branch tree. Surplus
// stars beyond 21 would be spent on OTHER kinds, not this one.
const defaultTowerStarBudget = (levelId: number): number =>
  Math.min(21, Math.max(0, 5 * (levelId - 1)));

// Robot skill tree has 4 nodes × 3 ranks = 12 max. Player needs to LEVEL
// the robot to spend these, which happens during run; between-run
// allocation comes from prior-run stars. Same budget heuristic as towers.
const defaultRobotSkillBudget = (levelId: number): number =>
  Math.min(12, Math.max(0, 3 * (levelId - 1)));

/**
 * Targets-hit-per-shot estimate for a given tower config.
 * Capped by enemies realistically on-screen to keep the bound honest.
 */
const aoeMultiplier = (kind: TowerKind, s: TowerConfig, enemiesOnScreen: number): number => {
  if (s.chainCount > 0) {
    // 1 primary + chain bounces with falloff ramp
    let mult = 1;
    for (let i = 0; i < s.chainCount; i++) {
      mult += s.chainFalloff ** (i + 1);
    }
    return Math.min(mult, enemiesOnScreen);
  }
  if (s.splashRadius > 0) {
    // rough density-based estimate — a 1.8-radius splash hits ~2.5 enemies
    return Math.min(1 + s.splashRadius * 0.8, enemiesOnScreen);
  }
  // Flame burns continuously while a target is in the cone.
  if (kind === "flame") return flameThroughputCapacity(enemiesOnScreen);
  // Hive contributes 0 direct DPS — it buffs neighbour towers via
  // drones, which this feasibility model doesn't simulate. Keep at 0
  // so hive is never picked as a wave's "best" tower; do not reintroduce
  // a 3× multiplier without modelling drone assignment.
  if (kind === "hive") return 0;
  return 1;
};

// ------- Robot modeling -------
//
// Each robot variant has its own (HP, damage, range, fire rate, damageType,
// attackSplashRadius) plus three abilities (dash/burst/payload). Skill
// tree adds +HP, +damage%, +speed, -cooldowns% via applyRobotSkillsToRobot.
//
// Uptime accounts for respawn delay (6s downtime per death) and time
// outside engagement range. Death rate scales with combat-window length —
// long waves give enemies more chip on the robot.

const ROBOT_BASE_UPTIME = 0.85;

/**
 * Build a robot with the given variant + skills allocation applied. Mirrors
 * robotDefaults in src/sim/world.ts so the numbers come straight from the
 * source instead of duplicating constants.
 */
const buildRobot = (variant: RobotVariant, skills: AllRobotSkills): Robot => {
  const spec = ROBOT_SPECS[variant];
  const robot = {
    id: 0,
    variant,
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    facing: 0,
    hp: spec.maxHp,
    maxHp: spec.maxHp,
    damage: spec.damage,
    range: spec.range,
    fireRate: spec.fireRate,
    speed: spec.speed,
    attackSplashRadius: spec.attackSplashRadius,
    damageType: spec.damageType,
    attackCooldown: 0,
    abilityReadyAt: [0, 0, 0] as [number, number, number],
    abilityActiveUntil: [0, 0, 0] as [number, number, number],
    abilityCooldownMul: 1,
    damageMul: 1,
    payload: null,
    pendingShots: [],
    targetId: null,
    moveTarget: null,
    alive: true,
    flashUntil: 0,
    shootFlashUntil: 0,
    respawnAt: null,
    lastDamagedAt: -1000,
    selected: false,
    xp: 0,
    level: 1,
    stuckTimer: 0,
    motionState: "idle" as const,
  } as unknown as Robot;
  applyRobotSkillsToRobot(robot, skills);
  return robot;
};

/** Splash-hits estimate: 1 primary + 0.8 × splashRadius secondaries. */
const splashHits = (splashRadius: number, enemiesOnScreen: number): number =>
  Math.min(1 + 0.8 * splashRadius, enemiesOnScreen);

/**
 * Average DPS contribution of one robot ability slot. Damage divided by
 * (cooldown × cooldownMul). Cooldown reduction from the Ultimate skill
 * speeds every ability up uniformly — that's its whole job.
 */
const robotAbilityRawDps = (
  variant: RobotVariantSpec,
  slot: 0 | 1 | 2,
  enemiesOnScreen: number,
  cooldownMul: number,
): { dps: number; damageType: DamageType } => {
  const ability = variant.abilities[slot];
  if (ability.type === "dash") return { dps: 0, damageType: "kinetic" };
  if (ability.type === "burst") {
    const hits = splashHits(ability.radius * 0.55, enemiesOnScreen);
    return {
      dps: (ability.damage * hits) / (ability.cooldown * cooldownMul),
      damageType: ability.damageType,
    };
  }
  if (ability.type === "buff") {
    // Self-buff amplifies the robot's own auto-attack output for
    // `duration`. Average the extra DPS over the cooldown window:
    // base auto-DPS × (damageMul·fireRateMul − 1) × duration / cd.
    return {
      dps:
        variant.damage *
        variant.fireRate *
        (ability.damageMul * ability.fireRateMul - 1) *
        (ability.duration / (ability.cooldown * cooldownMul)),
      damageType: variant.damageType,
    };
  }
  return { dps: 0, damageType: "kinetic" };
};

/**
 * Weighted-by-HP average resist of the wave mix vs a given damage type.
 * Reused for robot auto-attack and each ability slot.
 */
const waveResistVs = (spec: WaveSpec, dmgType: DamageType, longestPath: number): number => {
  let weighted = 0;
  let totalHp = 0;
  for (const s of spec.spawns) {
    const stats = specStats(s);
    const hp = stats.hp * s.count;
    const baseMul = specResist(s, dmgType);
    weighted += baseMul * (s.resists?.[dmgType] ?? 1) * hp;
    totalHp += hp;
    if (s.kind === "boss" && s.bossVariant) {
      const child = BOSS_VARIANT_CHILD[s.bossVariant];
      if (child) {
        const lifetime = longestPath / stats.speed;
        const childCount = Math.max(0, Math.floor(lifetime / child.interval)) * s.count;
        const childHp = ENEMY_STATS[child.kind].hp * childCount;
        weighted += ENEMY_RESIST[child.kind][dmgType] * childHp;
        totalHp += childHp;
      }
    }
  }
  return totalHp > 0 ? weighted / totalHp : 1;
};

/**
 * Robot effective DPS vs a wave's resist mix. Sums:
 *   auto-attack  (variant.damageType, splash if attackSplashRadius>0)
 *   slot 1 burst (per variant damage type)
 *   slot 2 payload (per variant damage type)
 *
 * Each component is multiplied by its weighted resist and a shared uptime
 * factor. Death penalty subtracts a fraction proportional to combat-window
 * length, capped at 50% — long waves give enemies more chip on the robot.
 */
const robotEffectiveDpsVsWave = (
  variant: RobotVariantSpec,
  robot: Robot,
  spec: WaveSpec,
  enemiesOnScreen: number,
  longestPath: number,
  combatDur: number,
): number => {
  // Auto-attack DPS uses the SKILL-ADJUSTED robot (damage/fireRate after
  // firepower rank) so we don't double-count the variant baseline.
  const autoSplash = splashHits(variant.attackSplashRadius, enemiesOnScreen);
  const autoResist = waveResistVs(spec, variant.damageType, longestPath);
  const autoDps = robot.damage * robot.fireRate * autoSplash * autoResist;

  const cdMul = robot.abilityCooldownMul;
  const burst = robotAbilityRawDps(variant, 1, enemiesOnScreen, cdMul);
  const payload = robotAbilityRawDps(variant, 2, enemiesOnScreen, cdMul);
  const burstDps = burst.dps * waveResistVs(spec, burst.damageType, longestPath);
  const payloadDps = payload.dps * waveResistVs(spec, payload.damageType, longestPath);

  const raw = autoDps + burstDps + payloadDps;
  const deathPenalty = Math.min(0.5, (combatDur / 25) * (ROBOT_RESPAWN_DELAY / combatDur));
  return raw * ROBOT_BASE_UPTIME * (1 - deathPenalty);
};

/**
 * Enumerate robot-skill rank allocations (4 nodes × 4 ranks = 256) that fit
 * the star budget. With budget 12 every combo is valid; with 0 only the
 * empty allocation. Returned as AllRobotSkills keyed on the active variant.
 */
const enumerateRobotSkillAllocations = (
  variant: RobotVariant,
  skillBudget: number,
): AllRobotSkills[] => {
  const ids = ["vitality", "firepower", "mobility", "ultimate"] as const;
  const out: AllRobotSkills[] = [];
  for (let v = 0; v <= 3; v++) {
    for (let f = 0; f <= 3; f++) {
      for (let m = 0; m <= 3; m++) {
        for (let u = 0; u <= 3; u++) {
          if (v + f + m + u > skillBudget) continue;
          const ranks: Record<string, number> = {};
          if (v > 0) ranks[ids[0]] = v;
          if (f > 0) ranks[ids[1]] = f;
          if (m > 0) ranks[ids[2]] = m;
          if (u > 0) ranks[ids[3]] = u;
          out.push({ [variant]: ranks });
        }
      }
    }
  }
  return out;
};

/**
 * Pick the best robot-skill allocation for a given variant + wave. The robot
 * is a fixed (free) contribution once selected — there's no gold trade-off
 * — so we maximise DPS unconditionally within the skill-point budget.
 */
const bestRobotDps = (
  variant: RobotVariant,
  skillBudget: number,
  spec: WaveSpec,
  enemiesOnScreen: number,
  longestPath: number,
  combatDur: number,
): number => {
  const variantSpec = ROBOT_SPECS[variant];
  let best = 0;
  for (const skills of enumerateRobotSkillAllocations(variant, skillBudget)) {
    const robot = buildRobot(variant, skills);
    const dps = robotEffectiveDpsVsWave(
      variantSpec,
      robot,
      spec,
      enemiesOnScreen,
      longestPath,
      combatDur,
    );
    if (dps > best) best = dps;
  }
  return best;
};

// ------- Base laser modeling -------
//
// The HQ base weapon fires from every path endpoint at the closest-to-
// gate enemy in its short range. Always-on kinetic damage; resist is
// HP-weighted across the wave's mix. Each HQ fires independently so the
// contribution scales with paths.length.
//
// The two upgrade branches (Focusing Lens, Capacitor Bank) cost gold from
// the same pool as towers, so the optimizer searches the 16 (a, b)
// upgrade states and picks the split that maximises post-purchase total
// damage. Use --no-base-upgrades to lock the laser at rank 0/0.

type BaseConfig = {
  tierA: 0 | 1 | 2 | 3;
  tierB: 0 | 1 | 2 | 3;
  damage: number;
  fireRate: number;
  range: number;
  cost: number;
};

const buildBaseConfig = (tierA: 0 | 1 | 2 | 3, tierB: 0 | 1 | 2 | 3): BaseConfig => {
  const b: Base = {
    damage: BASE_DAMAGE,
    fireRate: BASE_FIRE_RATE,
    range: BASE_RANGE,
    cooldowns: [],
    targetIds: [],
    upgrades: { a: 0, b: 0 },
    totalSpent: 0,
    kills: 0,
    damageDealt: 0,
  };
  let cost = 0;
  for (let i = 0; i < tierA; i++) {
    BASE_UPGRADES.a.tiers[i].apply(b);
    cost += BASE_UPGRADES.a.tiers[i].cost;
  }
  for (let i = 0; i < tierB; i++) {
    BASE_UPGRADES.b.tiers[i].apply(b);
    cost += BASE_UPGRADES.b.tiers[i].cost;
  }
  return { tierA, tierB, damage: b.damage, fireRate: b.fireRate, range: b.range, cost };
};

const ALL_BASE_CONFIGS: BaseConfig[] = (() => {
  const out: BaseConfig[] = [];
  for (let a = 0; a <= 3; a++) {
    for (let b = 0; b <= 3; b++) {
      out.push(buildBaseConfig(a as 0 | 1 | 2 | 3, b as 0 | 1 | 2 | 3));
    }
  }
  return out;
})();

const ZERO_BASE_CONFIG = ALL_BASE_CONFIGS[0];

const baseDpsContribution = (
  spec: WaveSpec,
  hqCount: number,
  longestPath: number,
  cfg: BaseConfig,
): number => {
  const avgResist = waveResistVs(spec, "kinetic", longestPath);
  return cfg.damage * cfg.fireRate * hqCount * avgResist;
};

// ------- Wave modeling -------

type WaveBreakdown = {
  totalHp: number;
  counts: Partial<Record<EnemyKind, number>>;
  totalEnemies: number;
  slowestSpeed: number;
};

const analyzeWave = (spec: WaveSpec, levelHpScale: number, longestPath: number): WaveBreakdown => {
  const hpMul = (spec.hpMul ?? 1) * levelHpScale;
  const counts: Partial<Record<EnemyKind, number>> = {};
  let totalHp = 0;
  let totalEnemies = 0;
  let slowestSpeed = Number.POSITIVE_INFINITY;
  for (const s of spec.spawns) {
    const stats = specStats(s);
    counts[s.kind] = (counts[s.kind] ?? 0) + s.count;
    totalHp += stats.hp * hpMul * s.count;
    totalEnemies += s.count;
    if (stats.speed < slowestSpeed) slowestSpeed = stats.speed;
    // Matriarch child-spawn: estimate how many children she drops while
    // crossing the longest path and fold them into the wave breakdown.
    // Children inherit hpMul through their stats * matriarch's effective
    // scale, so the late-game variants don't get under-counted.
    if (s.kind === "boss" && s.bossVariant) {
      const child = BOSS_VARIANT_CHILD[s.bossVariant];
      if (child) {
        const lifetime = longestPath / stats.speed;
        const childCount = Math.max(0, Math.floor(lifetime / child.interval)) * s.count;
        const childStats = ENEMY_STATS[child.kind];
        counts[child.kind] = (counts[child.kind] ?? 0) + childCount;
        totalHp += childStats.hp * hpMul * childCount;
        totalEnemies += childCount;
        if (childStats.speed < slowestSpeed) slowestSpeed = childStats.speed;
      }
    }
  }
  return {
    totalHp,
    counts,
    totalEnemies,
    slowestSpeed: Number.isFinite(slowestSpeed) ? slowestSpeed : 1,
  };
};

const waveBounty = (spec: WaveSpec, longestPath: number): number =>
  spec.spawns.reduce((n, s) => {
    let total = specStats(s).bounty * s.count;
    if (s.kind === "boss" && s.bossVariant) {
      const child = BOSS_VARIANT_CHILD[s.bossVariant];
      if (child) {
        const lifetime = longestPath / specStats(s).speed;
        const childCount = Math.max(0, Math.floor(lifetime / child.interval)) * s.count;
        total += ENEMY_STATS[child.kind].bounty * childCount;
      }
    }
    return n + total;
  }, 0);

// Spawn spacing matches spawner.ts:87
const spawnSpacing = (spec: WaveSpec, waveNumber: number): number =>
  spec.spacing ?? Math.max(0.35, 0.75 - waveNumber * 0.03);

// Combat window: first spawn to last enemy clearing the longest path.
// speedMul folds in the difficulty speed multiplier — faster enemies cross
// sooner, shrinking the window and raising requiredDps (a real Extinction
// pressure the medium-only model used to miss).
const combatWindow = (
  spec: WaveSpec,
  waveNumber: number,
  wave: WaveBreakdown,
  longestPath: number,
  speedMul: number,
): number => {
  const spawnSpan = Math.max(0, (wave.totalEnemies - 1) * spawnSpacing(spec, waveNumber));
  const crossTime = longestPath / (wave.slowestSpeed * speedMul);
  return spawnSpan + crossTime;
};

/**
 * Effective single-tower DPS vs a wave's enemy mix.
 * Weight resist by HP share so tanky enemies (stego/titan) dominate correctly.
 */
const effectiveDpsVsWave = (
  cfg: TowerConfig,
  wave: WaveBreakdown,
  spec: WaveSpec,
  longestPath: number,
): number => {
  const dmgType = TOWER_DAMAGE_TYPE[cfg.kind];
  let weightedResist = 0;
  let totalHp = 0;
  // Walk the raw spec so boss spawns use their variant resists, and so
  // matriarch children get folded in once (analyzeWave's wave.counts
  // already includes them, but we re-derive here to keep the per-variant
  // resists on the boss row separate from the per-kind resists on the
  // children).
  for (const s of spec.spawns) {
    const stats = specStats(s);
    const hp = stats.hp * s.count;
    const baseMul = specResist(s, dmgType);
    weightedResist += baseMul * (s.resists?.[dmgType] ?? 1) * hp;
    totalHp += hp;
    if (s.kind === "boss" && s.bossVariant) {
      const child = BOSS_VARIANT_CHILD[s.bossVariant];
      if (child) {
        const lifetime = longestPath / stats.speed;
        const childCount = Math.max(0, Math.floor(lifetime / child.interval)) * s.count;
        const childHp = ENEMY_STATS[child.kind].hp * childCount;
        weightedResist += ENEMY_RESIST[child.kind][dmgType] * childHp;
        totalHp += childHp;
      }
    }
  }
  const avgResist = totalHp > 0 ? weightedResist / totalHp : 1;
  const aoe = aoeMultiplier(cfg.kind, cfg, Math.min(wave.totalEnemies, 10));
  return cfg.damage * cfg.fireRate * avgResist * aoe;
};

// ------- Per-level analysis -------

type TowerPick = {
  kind: TowerKind;
  tierA: number;
  tierB: number;
  /** Compact label for the chosen meta-skill allocation, e.g. "a3,b3". */
  metaLabel: string;
  unitCost: number;
  perTowerDps: number;
  count: number;
  /** Tower-only DPS (excludes base + robot). */
  towerDps: number;
  /** Base-laser tier "a/b" string for this pick's chosen HQ allocation. */
  baseLabel: string;
  baseDps: number;
  baseCost: number;
  /** (towers + base + robot) DPS × dur — the metric the picker maximises. */
  potentialDamage: number;
};

type WaveRow = {
  wave: number;
  archetype: string;
  totalEnemies: number;
  totalHp: number;
  durationSec: number;
  goldBudget: number;
  requiredDps: number;
  robotDps: number;
  best: TowerPick | null;
  top3: TowerPick[];
};

type AnalysisOpts = {
  /** Per-tower-kind meta-skill star budget. */
  towerStarBudget?: number;
  /** Robot skill-point budget for the active robot variant. */
  robotSkillBudget?: number;
  /** Active robot variant, or null to disable robot contribution. */
  robotVariant: RobotVariant | null;
  /** False to lock HQ laser at 0/0; true searches all 16 upgrade states. */
  searchBaseUpgrades: boolean;
  /** False to skip the ensureImmunityCoverage 0× injection pass. */
  applyImmunityCoverage: boolean;
  /** False to skip the adaptive-resistance dominant-type penalty. */
  applyAdaptivePenalty: boolean;
  /**
   * Difficulty multipliers folded into the model exactly as createWorld
   * does: hp scales totalHp, speed shrinks the combat window, startGold and
   * goldKill scale the gold budget. Defaults to medium (all identity) so the
   * historical numbers are unchanged unless --difficulty is passed.
   */
  diff: DifficultyMultipliers;
};

/**
 * Multiplicative DPS penalty for the dominant damage type once the herd's
 * adaptation kicks in (level >= ADAPT_TRIGGER_LEVEL). Mirrors world.ts —
 * a fraction `adaptiveCoverage(level, streak, share)` of spawns gets resist
 * boosted by `adaptiveBoost(level, streak, share)` against whatever the
 * player has been leaning on.
 * Static feasibility doesn't track dominant-type per wave; we assume the
 * player's picked tower IS the dominant type (worst case for that pick).
 */
const FEASIBILITY_ADAPT_STREAK = 3;
const FEASIBILITY_ADAPT_SHARE = 0.8;

const adaptivePenalty = (levelId: number): number => {
  if (levelId < ADAPT_TRIGGER_LEVEL) return 1;
  return Math.max(
    0.1,
    1 -
      adaptiveCoverage(levelId, FEASIBILITY_ADAPT_STREAK, FEASIBILITY_ADAPT_SHARE) *
        adaptiveBoost(levelId, FEASIBILITY_ADAPT_STREAK, FEASIBILITY_ADAPT_SHARE),
  );
};

/**
 * Find the best (towers + HQ upgrades) split that maximises (tower DPS +
 * baseDps + robotDps) × combatDur. Robot DPS is constant across picks for a
 * given wave (no gold trade-off), so it's added uniformly inside the
 * picker so the soft-spot threshold reflects the player's full toolkit.
 */
const bestSetup = (
  configs: TowerConfig[],
  wave: WaveBreakdown,
  spec: WaveSpec,
  budget: number,
  dur: number,
  paths: Vec2[][],
  longestPath: number,
  robotDps: number,
  baseConfigs: BaseConfig[],
  coverageCache: Map<number, number>,
  adaptPenalty: number,
  modeCfg?: { forbiddenTowers?: TowerKind[]; lockedLoadout?: TowerKind[] },
): TowerPick[] => {
  const forbidden = new Set(modeCfg?.forbiddenTowers ?? []);
  const lockedLoadout = modeCfg?.lockedLoadout ?? null;
  const picks: TowerPick[] = [];
  for (const baseCfg of baseConfigs) {
    if (baseCfg.cost > budget) continue;
    const remaining = budget - baseCfg.cost;
    const baseDps = baseDpsContribution(spec, paths.length, longestPath, baseCfg);
    for (const cfg of configs) {
      if (cfg.damage <= 0) continue;
      // Honor mode rules so breach forbids / containment loadouts don't get
      // "cleared" by a tower the player literally can't place.
      if (forbidden.has(cfg.kind)) continue;
      if (lockedLoadout && !lockedLoadout.includes(cfg.kind)) continue;
      const { count, totalCost } = affordableCopies(cfg, remaining);
      if (count === 0) continue;
      const perTowerDps = effectiveDpsVsWave(cfg, wave, spec, longestPath);
      // Memoise pathCoverage by quantised range — paths are fixed per
      // level, so the 60×60 grid scan only needs to run once per range.
      const rangeKey = Math.round(cfg.range * 10);
      let covPer = coverageCache.get(rangeKey);
      if (covPer === undefined) {
        covPer = pathCoverage(paths, cfg.range);
        coverageCache.set(rangeKey, covPer);
      }
      const covFrac = coverageFraction(count, covPer, paths.length);
      const towerDps = perTowerDps * count * covFrac * adaptPenalty;
      const totalDps = towerDps + baseDps + robotDps;
      picks.push({
        kind: cfg.kind,
        tierA: cfg.tierA,
        tierB: cfg.tierB,
        metaLabel: summarizeMeta(cfg.meta, cfg.kind),
        unitCost: Math.round(totalCost / count),
        perTowerDps,
        count,
        towerDps,
        baseLabel: `${baseCfg.tierA}/${baseCfg.tierB}`,
        baseDps,
        baseCost: baseCfg.cost,
        potentialDamage: totalDps * dur,
      });
    }
  }
  picks.sort((a, b) => b.potentialDamage - a.potentialDamage);
  const topByKind: TowerPick[] = [];
  const seen = new Set<TowerKind>();
  for (const p of picks) {
    if (seen.has(p.kind)) continue;
    seen.add(p.kind);
    topByKind.push(p);
    if (topByKind.length === 3) break;
  }
  return [picks[0], ...topByKind.filter((p) => p !== picks[0])].slice(0, 3);
};

const analyzeLevel = (levelIdx: number, opts: AnalysisOpts, mode: LevelMode = "normal") => {
  const level = LEVELS[levelIdx];
  const cfg = resolveLevelMode(level, mode);
  // Fold difficulty HP into the per-level scale, mirroring createWorld's
  // baseHpScale = (level.hpScale ?? 1) × difficulty.hp.
  const hpScale = (level.hpScale ?? 1) * opts.diff.hp;
  // Mirror createWorld: widen the roster by countScale before any other
  // pass so totalHp, combat window, bounty, and coverage all see the same
  // stream the live game spawns.
  const baseWaves = scaleWaveCounts(cfg.waves, level.countScale ?? 1);
  const longestPath = Math.max(...level.paths.map(pathLength));
  const towerStarBudget = opts.towerStarBudget ?? defaultTowerStarBudget(level.id);
  const robotSkillBudget = opts.robotSkillBudget ?? defaultRobotSkillBudget(level.id);
  const configs = buildAllConfigs(towerStarBudget);
  const baseConfigs = opts.searchBaseUpgrades ? ALL_BASE_CONFIGS : [ZERO_BASE_CONFIG];

  // Replay the runtime spawn-mutation that injects a 0× resist holdout per
  // damage type the player can reach. Mode forbidden/locked sets gate
  // which types qualify, so breach/containment with reduced rosters get only the
  // immunities they can actually crack.
  const waves = opts.applyImmunityCoverage
    ? ensureImmunityCoverage(
        baseWaves,
        availableDamageTypes(new Set(cfg.forbiddenTowers ?? []), cfg.lockedLoadout ?? null),
      )
    : baseWaves;

  const adaptPenalty = opts.applyAdaptivePenalty ? adaptivePenalty(level.id) : 1;

  const rows: WaveRow[] = [];
  let cumulativeBounty = 0;
  let cumulativeBonus = 0;
  const coverageCache = new Map<number, number>();

  for (let i = 0; i < waves.length; i++) {
    const spec = waves[i];
    const waveNumber = i + 1;
    // Per-wave HP ramp mirrors createWorld's lateWaveHpFactor so the
    // analyzer sees the same back-loaded HP the live game spawns.
    const wave = analyzeWave(
      spec,
      hpScale * lateWaveHpFactor(i, waves.length, opts.diff.lateWaveHpRamp),
      longestPath,
    );
    const dur = combatWindow(spec, waveNumber, wave, longestPath, opts.diff.speed);
    const budget =
      Math.floor(cfg.startGold * opts.diff.startGold) + cumulativeBounty + cumulativeBonus;
    const requiredDps = wave.totalHp / dur;
    const robotDps =
      opts.robotVariant !== null
        ? bestRobotDps(
            opts.robotVariant,
            robotSkillBudget,
            spec,
            Math.min(wave.totalEnemies, 10),
            longestPath,
            dur,
          )
        : 0;
    const top = bestSetup(
      configs,
      wave,
      spec,
      budget,
      dur,
      level.paths,
      longestPath,
      robotDps,
      baseConfigs,
      coverageCache,
      adaptPenalty,
      cfg,
    );

    rows.push({
      wave: waveNumber,
      archetype: spec.archetype ?? "—",
      totalEnemies: wave.totalEnemies,
      totalHp: wave.totalHp,
      durationSec: dur,
      goldBudget: budget,
      requiredDps,
      robotDps,
      best: top[0] ?? null,
      top3: top,
    });

    // Kill bounties scale with difficulty.goldKill (world.ts:1761); the
    // flat per-wave income bonus does not.
    cumulativeBounty += waveBounty(spec, longestPath) * opts.diff.goldKill;
    cumulativeBonus += 5 + waveNumber;
  }

  return { level, mode, cfg, rows, longestPath, towerStarBudget, robotSkillBudget };
};

// ------- Output -------

const C = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

const feasColor = (f: number): string =>
  f >= 2 ? C.green : f >= 1.2 ? C.cyan : f >= 0.8 ? C.yellow : C.red;

const fmt = (n: number, d = 0) => n.toFixed(d);
const pad = (s: string | number, n: number) => String(s).padStart(n);
const padR = (s: string | number, n: number) => String(s).padEnd(n);

const printLevel = (
  levelIdx: number,
  detail: boolean,
  opts: AnalysisOpts,
  mode: LevelMode = "normal",
) => {
  const { level, cfg, rows, longestPath, towerStarBudget, robotSkillBudget } = analyzeLevel(
    levelIdx,
    opts,
    mode,
  );
  const clearedCount = rows.filter((r) => r.best && r.best.potentialDamage >= r.totalHp).length;
  const tightestWave = rows.reduce(
    (t, r) => {
      const f = r.best ? r.best.potentialDamage / r.totalHp : 0;
      return f < t.f ? { f, wave: r.wave } : t;
    },
    { f: Number.POSITIVE_INFINITY, wave: 0 },
  );

  const robotLabel = opts.robotVariant ? `${opts.robotVariant}(${robotSkillBudget}sp)` : "off";
  const baseLabel = opts.searchBaseUpgrades ? "searched" : "rank0/0";
  const adaptLabel =
    opts.applyAdaptivePenalty && level.id >= ADAPT_TRIGGER_LEVEL
      ? `adapt:${fmt(adaptivePenalty(level.id), 2)}×`
      : "adapt:off";
  const immunityLabel = opts.applyImmunityCoverage ? "immunity:on" : "immunity:off";
  const modeTag =
    mode === "normal"
      ? ""
      : mode === "breach"
        ? ` ${C.yellow}[BREACH]${C.reset}`
        : ` ${C.red}[CONTAINMENT]${C.reset}`;
  const rules: string[] = [];
  if (cfg.forbiddenTowers?.length) rules.push(`deny ${cfg.forbiddenTowers.join(",")}`);
  if (cfg.lockedLoadout?.length) rules.push(`loadout ${cfg.lockedLoadout.join(",")}`);
  if (cfg.singleLife) rules.push("1 life");
  if (cfg.noSelling) rules.push("no sell");
  const rulesTag = rules.length > 0 ? ` ${C.magenta}(${rules.join(" · ")})${C.reset}` : "";
  console.log(
    `\n${C.bold}═══ L${level.id}: ${level.name}${modeTag}${C.reset}${rulesTag}` +
      `${level.hpScale ? ` ${C.dim}(hpScale ${level.hpScale}×)${C.reset}` : ""}` +
      `${level.countScale ? ` ${C.dim}(countScale ${level.countScale}×)${C.reset}` : ""}` +
      ` ${C.dim}startGold=${cfg.startGold}, paths=${level.paths.length}, longestPath=${fmt(longestPath, 1)}u, ` +
      `diff=${difficulty}(hp${opts.diff.hp}×,spd${opts.diff.speed}×), ` +
      `robot=${robotLabel}, towerStars=${towerStarBudget}, base=${baseLabel}, ${adaptLabel}, ${immunityLabel}${C.reset}`,
  );
  console.log(
    `${C.dim}${pad("W", 3)} ${pad("arch", 7)} ${pad("enemies", 7)} ${pad("totalHp", 8)} ${pad("sec", 6)} ${pad("gold", 6)} ${pad("reqDPS", 7)} ${pad("robot", 6)} ${pad("base", 6)} ${pad("bestT", 8)} ${pad("×N", 4)} ${pad("twrDPS", 7)} ${pad("feas", 6)}${C.reset}`,
  );
  for (const r of rows) {
    const feas = r.best ? r.best.potentialDamage / r.totalHp : 0;
    const best = r.best;
    console.log(
      `${pad(r.wave, 3)} ${pad(r.archetype, 7)} ${pad(r.totalEnemies, 7)} ` +
        `${pad(fmt(r.totalHp, 0), 8)} ${pad(fmt(r.durationSec, 1), 6)} ` +
        `${pad(r.goldBudget, 6)} ${pad(fmt(r.requiredDps, 0), 7)} ` +
        `${pad(fmt(r.robotDps, 0), 6)} ` +
        `${pad(fmt(best?.baseDps ?? 0, 0), 6)} ` +
        `${pad(best?.kind ?? "—", 8)} ${pad(best?.count ?? 0, 4)} ` +
        `${pad(fmt(best?.towerDps ?? 0, 0), 7)} ` +
        `${feasColor(feas)}${pad(fmt(feas, 2), 6)}${C.reset}`,
    );
    if (detail && r.top3.length > 0) {
      for (const p of r.top3) {
        const f = p.potentialDamage / r.totalHp;
        const metaTag = p.metaLabel === "—" ? "" : ` meta:${p.metaLabel}`;
        const baseTag = p.baseLabel === "0/0" ? "" : ` base:${p.baseLabel}(${p.baseCost}g)`;
        console.log(
          `    ${C.dim}↳ ${pad(p.kind, 8)} a${p.tierA}/b${p.tierB}${metaTag} @${p.unitCost}g ×${p.count} = ${fmt(p.towerDps, 0)} twr +${fmt(p.baseDps, 0)} base +${fmt(r.robotDps, 0)} robot${baseTag} → feas ${fmt(f, 2)}${C.reset}`,
        );
      }
    }
  }
  const tailColor =
    clearedCount === rows.length
      ? C.green
      : clearedCount >= rows.length - 1
        ? C.cyan
        : clearedCount >= rows.length * 0.7
          ? C.yellow
          : C.red;
  console.log(
    `${tailColor}  → ${clearedCount}/${rows.length} waves clearable; tightest = wave ${tightestWave.wave} @ ${fmt(tightestWave.f, 2)}×${C.reset}`,
  );
};

// ------- Soft-spot analysis -------

/**
 * "Too easy" heuristic. Flags waves where:
 *   - absolute feasibility > absThreshold (trivially overbudgeted DPS), OR
 *   - feasibility > ratio × the level's tightest wave (pacing outlier — the
 *     wave is so much easier than the level's actual challenge that the
 *     player notices no resistance).
 *
 * Runs only for levels with id >= fromLevel (default 6), since early
 * levels are introductions and a bit of slack is on purpose.
 */
const printSoftSpots = (
  fromLevel: number,
  absThreshold: number,
  ratio: number,
  opts: AnalysisOpts,
) => {
  type Flagged = {
    level: (typeof LEVELS)[number];
    wave: number;
    archetype: string;
    feas: number;
    tightest: number;
    totalEnemies: number;
    totalHp: number;
    reasons: string[];
  };
  const flagged: Flagged[] = [];
  const archCounts: Record<string, { total: number; soft: number }> = {};
  let totalConsidered = 0;
  let totalSoft = 0;

  for (let i = 0; i < LEVELS.length; i++) {
    const level = LEVELS[i];
    if (level.id < fromLevel) continue;
    const { rows } = analyzeLevel(i, opts);
    const feasList = rows.map((r) => (r.best ? r.best.potentialDamage / r.totalHp : 0));
    const tightest = Math.min(...feasList.filter((f) => f > 0));
    for (let j = 0; j < rows.length; j++) {
      const r = rows[j];
      const f = feasList[j];
      totalConsidered++;
      const arch = r.archetype;
      archCounts[arch] = archCounts[arch] ?? { total: 0, soft: 0 };
      archCounts[arch].total++;
      const reasons: string[] = [];
      if (f > absThreshold) reasons.push(`abs>${absThreshold}`);
      if (tightest > 0 && f > ratio * tightest) reasons.push(`${fmt(f / tightest, 1)}× tightest`);
      if (reasons.length > 0) {
        totalSoft++;
        archCounts[arch].soft++;
        flagged.push({
          level,
          wave: r.wave,
          archetype: arch,
          feas: f,
          tightest,
          totalEnemies: r.totalEnemies,
          totalHp: r.totalHp,
          reasons,
        });
      }
    }
  }

  const robotLbl = opts.robotVariant ?? "off";
  console.log(
    `\n${C.bold}═══ Soft-spot scan — levels ${fromLevel}+, abs>${absThreshold}×, pacing>${ratio}× tightest${C.reset}` +
      ` ${C.dim}(robot=${robotLbl}, towerStars=${opts.towerStarBudget ?? "auto"}, ` +
      `robotSp=${opts.robotSkillBudget ?? "auto"}, base=${opts.searchBaseUpgrades ? "searched" : "rank0"}, ` +
      `adapt=${opts.applyAdaptivePenalty ? "on" : "off"}, immunity=${opts.applyImmunityCoverage ? "on" : "off"})${C.reset}`,
  );

  // Group by level
  let currentLevelId = -1;
  for (const f of flagged) {
    if (f.level.id !== currentLevelId) {
      currentLevelId = f.level.id;
      console.log(
        `\n${C.bold}L${f.level.id} ${f.level.name}${C.reset} ${C.dim}(tightest ${fmt(f.tightest, 2)}×)${C.reset}`,
      );
    }
    const severity =
      f.feas >= absThreshold * 2 ? C.red : f.feas >= absThreshold ? C.yellow : C.cyan;
    console.log(
      `  W${pad(f.wave, 2)} ${padR(f.archetype, 7)} ${severity}feas ${pad(fmt(f.feas, 2), 6)}×${C.reset}` +
        ` ${C.dim}${pad(f.totalEnemies, 4)} enemies, ${pad(fmt(f.totalHp, 0), 6)} HP${C.reset}` +
        ` ${C.dim}— ${f.reasons.join(", ")}${C.reset}`,
    );
  }

  // Global breakdown
  console.log(`\n${C.bold}═══ Patterns${C.reset}`);
  console.log(
    `${totalSoft}/${totalConsidered} waves flagged ${C.dim}(${((totalSoft / totalConsidered) * 100).toFixed(1)}%)${C.reset}`,
  );
  const archEntries = Object.entries(archCounts)
    .filter(([, c]) => c.total > 0)
    .sort((a, b) => b[1].soft / b[1].total - a[1].soft / a[1].total);
  console.log(`${C.dim}By archetype (flagged / total):${C.reset}`);
  for (const [arch, c] of archEntries) {
    const pct = ((c.soft / c.total) * 100).toFixed(0);
    const bar = "█".repeat(Math.round((c.soft / c.total) * 20));
    console.log(
      `  ${padR(arch, 7)} ${pad(c.soft, 3)}/${pad(c.total, 3)}  ${pad(pct + "%", 4)}  ${bar}`,
    );
  }
};

// ------- Entry -------

declare const process: { argv: string[]; exit(code: number): never };

const args = process.argv.slice(2);
const detail = args.includes("--detail");
const softMode = args.includes("--soft");
const noRobot = args.includes("--no-robot");
const noBaseUpgrades = args.includes("--no-base-upgrades");
const noAdapt = args.includes("--no-adapt");
const noImmunity = args.includes("--no-immunity-coverage");
const fromArg = args.find((a: string) => a.startsWith("--from="));
const absArg = args.find((a: string) => a.startsWith("--abs="));
const ratioArg = args.find((a: string) => a.startsWith("--ratio="));
const starsArg = args.find((a: string) => a.startsWith("--stars="));
const robotSkillsArg = args.find((a: string) => a.startsWith("--robot-skills="));
const robotArg = args.find((a: string) => a.startsWith("--robot="));
// --difficulty=easy|medium|hard|extinction — folds the real DIFFICULTY_MULTIPLIERS
// into the model. Default medium = identity, so omitting it reproduces the
// historical medium-only numbers exactly.
const difficultyArg = args.find((a: string) => a.startsWith("--difficulty="));
const parseDifficulty = (value: string | undefined): Difficulty => {
  const v = value ?? "medium";
  if (v === "easy" || v === "medium" || v === "hard" || v === "extinction") return v;
  console.error(`--difficulty must be one of: easy, medium, hard, extinction (got "${v}")`);
  process.exit(1);
};
const difficulty = parseDifficulty(difficultyArg?.split("=")[1]);
// --mode=normal|breach|containment|all — pick which modes the report iterates.
// Default is "all" so authors get feasibility for every defined variant
// in one pass, with normal always shown first per level.
const modeArg = args.find((a: string) => a.startsWith("--mode="));
const modeFilter: LevelMode[] = ((): LevelMode[] => {
  if (!modeArg) return LEVEL_MODES;
  const v = modeArg.split("=")[1];
  if (v === "all") return LEVEL_MODES;
  if (v === "normal" || v === "breach" || v === "containment") return [v];
  console.error(`--mode must be normal | breach | containment | all`);
  process.exit(1);
})();
const modesForLevel = (levelIdx: number): LevelMode[] => {
  const level = LEVELS[levelIdx];
  return modeFilter.filter((m) => m === "normal" || levelHasMode(level, m));
};
const levelArg = args.find((a: string) => /^\d+$/.test(a));

const parseRobotVariant = (value: string | undefined): RobotVariant => {
  const v = value ?? "george";
  if (v === "george" || v === "leela" || v === "mike" || v === "stan") return v;
  console.error(`Robot variant must be one of: george, leela, mike, stan (got "${v}")`);
  process.exit(1);
};

const baseOpts: AnalysisOpts = {
  robotVariant: noRobot ? null : parseRobotVariant(robotArg?.split("=")[1]),
  towerStarBudget: starsArg ? Number(starsArg.split("=")[1]) : undefined,
  robotSkillBudget: robotSkillsArg ? Number(robotSkillsArg.split("=")[1]) : undefined,
  searchBaseUpgrades: !noBaseUpgrades,
  applyImmunityCoverage: !noImmunity,
  applyAdaptivePenalty: !noAdapt,
  diff: DIFFICULTY_MULTIPLIERS[difficulty],
};

if (softMode) {
  const fromLevel = fromArg ? Number(fromArg.split("=")[1]) : 6;
  // Default raised from 20 → 35 because robot + meta + HQ upgrades all
  // lift achievable DPS for every wave. Use --abs=20 to restore old
  // sensitivity, or --no-robot --stars=0 --robot-skills=0 --no-base-upgrades
  // to reproduce the legacy towers-only model exactly.
  const abs = absArg ? Number(absArg.split("=")[1]) : 35;
  const ratio = ratioArg ? Number(ratioArg.split("=")[1]) : 5;
  printSoftSpots(fromLevel, abs, ratio, baseOpts);
} else if (levelArg) {
  const idx = Number(levelArg) - 1;
  if (idx < 0 || idx >= LEVELS.length) {
    console.error(`Level must be 1..${LEVELS.length}`);
    process.exit(1);
  }
  for (const m of modesForLevel(idx)) printLevel(idx, detail, baseOpts, m);
} else {
  for (let i = 0; i < LEVELS.length; i++) {
    for (const m of modesForLevel(i)) printLevel(i, detail, baseOpts, m);
  }
  // Global summary — one line per mode so authors can spot the gap
  // between the polished campaign and a still-rough challenge variant.
  console.log(`\n${C.bold}═══ Summary${C.reset}`);
  for (const m of modeFilter) {
    let totalWaves = 0;
    let clearable = 0;
    const problemWaves: string[] = [];
    let levelsWithMode = 0;
    for (let i = 0; i < LEVELS.length; i++) {
      if (m !== "normal" && !levelHasMode(LEVELS[i], m)) continue;
      levelsWithMode++;
      const { level, rows } = analyzeLevel(i, baseOpts, m);
      totalWaves += rows.length;
      for (const r of rows) {
        const feas = r.best ? r.best.potentialDamage / r.totalHp : 0;
        if (feas >= 1) clearable++;
        else problemWaves.push(`L${level.id}W${r.wave} (${fmt(feas, 2)}×)`);
      }
    }
    if (totalWaves === 0) {
      console.log(`${C.dim}${m}: no levels defined${C.reset}`);
      continue;
    }
    const tag =
      m === "normal" ? "" : ` ${C.dim}(${levelsWithMode}/${LEVELS.length} levels)${C.reset}`;
    console.log(
      `${C.bold}${m}${C.reset}${tag}: ${clearable}/${totalWaves} waves theoretically clearable ` +
        `${C.dim}(${((clearable / totalWaves) * 100).toFixed(1)}%)${C.reset}`,
    );
    if (problemWaves.length > 0) {
      console.log(`  ${C.red}Below 1.0×: ${problemWaves.join(", ")}${C.reset}`);
    }
  }
  const robotLbl = baseOpts.robotVariant ?? "off";
  console.log(
    `${C.dim}— robot=${robotLbl}, towerStars=${baseOpts.towerStarBudget ?? "auto"}, ` +
      `robotSp=${baseOpts.robotSkillBudget ?? "auto"}, base=${baseOpts.searchBaseUpgrades ? "searched" : "rank0"}, ` +
      `adapt=${baseOpts.applyAdaptivePenalty ? "on" : "off"}, immunity=${baseOpts.applyImmunityCoverage ? "on" : "off"}${C.reset}`,
  );
}
