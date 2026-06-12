/**
 * Mode feasibility validator — runs the wave-feasibility numbers against
 * a level's breach or containment mode override block.
 *
 *   npx tsx scripts/mode-feasibility.ts <level-id> breach
 *   npx tsx scripts/mode-feasibility.ts <level-id> containment
 *
 * Reads the mode block from the level config (must export the new
 * breach/containment fields), and reuses the same DPS-vs-HP math as
 * wave-feasibility.ts. Tower kinds in `forbiddenTowers` or outside
 * `lockedLoadout` are excluded from the candidate-config search so the
 * feasibility number reflects the actual restricted loadout.
 */
import { LEVELS, scaleWaveCounts } from "../src/levels";
import { pathLength } from "../src/sim/path";
import { type AllRobotSkills, applyRobotSkillsToRobot } from "../src/sim/robotSkills";
import { ROBOT_SPECS, type RobotVariantSpec } from "../src/sim/robotVariants";
import { flameThroughputCapacity } from "../src/sim/towers";
import type {
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
import { UPGRADES } from "../src/sim/upgrades";
import {
  BOSS_VARIANT_CHILD,
  BOSS_VARIANT_RESIST,
  BOSS_VARIANT_STATS,
  ENEMY_RESIST,
  ENEMY_STATS,
  ROBOT_RESPAWN_DELAY,
  TOWER_COST,
  TOWER_DAMAGE_TYPE,
  TOWER_STATS,
  type TowerBaseStats,
} from "../src/sim/world";
import { coverageFraction, pathCoverage } from "./lib/coverage";

type ModeConfig = {
  startGold: number;
  waves: WaveSpec[];
  forbiddenTowers?: TowerKind[];
  lockedLoadout?: TowerKind[];
  singleLife?: boolean;
  noSelling?: boolean;
  tagline?: string;
};

type LevelWithModes = (typeof LEVELS)[number] & {
  breach?: ModeConfig;
  containment?: ModeConfig;
};

const specStats = (s: EnemySpec) =>
  s.kind === "boss" && s.bossVariant ? BOSS_VARIANT_STATS[s.bossVariant] : ENEMY_STATS[s.kind];

const specResist = (s: EnemySpec, dmgType: import("../src/sim/types").DamageType): number =>
  s.kind === "boss" && s.bossVariant
    ? BOSS_VARIANT_RESIST[s.bossVariant][dmgType]
    : ENEMY_RESIST[s.kind][dmgType];

type TowerConfig = TowerBaseStats & {
  kind: TowerKind;
  tierA: 0 | 1 | 2 | 3;
  tierB: 0 | 1 | 2 | 3;
  cost: number;
};

const buildConfig = (kind: TowerKind, tierA: 0 | 1 | 2 | 3, tierB: 0 | 1 | 2 | 3): TowerConfig => {
  const base = TOWER_STATS[kind];
  const t = { ...base, upgrades: { a: 0, b: 0 } } as unknown as Tower;
  let cost = TOWER_COST[kind];
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
  };
};

const ALL_CONFIGS: TowerConfig[] = (() => {
  const out: TowerConfig[] = [];
  for (const kind of Object.keys(TOWER_STATS) as TowerKind[]) {
    for (let a = 0; a <= 3; a++) {
      for (let b = 0; b <= 3; b++) {
        out.push(buildConfig(kind, a as 0 | 1 | 2 | 3, b as 0 | 1 | 2 | 3));
      }
    }
  }
  return out;
})();

const aoeMultiplier = (kind: TowerKind, s: TowerConfig, enemiesOnScreen: number): number => {
  if (s.chainCount > 0) {
    let mult = 1;
    for (let i = 0; i < s.chainCount; i++) {
      mult += s.chainFalloff ** (i + 1);
    }
    return Math.min(mult, enemiesOnScreen);
  }
  if (s.splashRadius > 0) {
    return Math.min(1 + s.splashRadius * 0.8, enemiesOnScreen);
  }
  if (kind === "flame") return flameThroughputCapacity(enemiesOnScreen);
  if (kind === "hive") return 0;
  return 1;
};

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

const spawnSpacing = (spec: WaveSpec, waveNumber: number): number =>
  spec.spacing ?? Math.max(0.35, 0.75 - waveNumber * 0.03);

const combatWindow = (
  spec: WaveSpec,
  waveNumber: number,
  wave: WaveBreakdown,
  longestPath: number,
): number => {
  const spawnSpan = Math.max(0, (wave.totalEnemies - 1) * spawnSpacing(spec, waveNumber));
  const crossTime = longestPath / wave.slowestSpeed;
  return spawnSpan + crossTime;
};

const effectiveDpsVsWave = (
  cfg: TowerConfig,
  wave: WaveBreakdown,
  spec: WaveSpec,
  longestPath: number,
): number => {
  const dmgType = TOWER_DAMAGE_TYPE[cfg.kind];
  let weightedResist = 0;
  let totalHp = 0;
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

// ------- Robot modeling -------
//
// Mirrors scripts/wave-feasibility.ts so the breach/containment clear-check sees
// the same robot contribution as the per-level feasibility report. The robot
// is a fixed (free) DPS contribution once a variant is selected — no gold
// trade-off — so we maximise DPS unconditionally within the skill budget.

const ROBOT_BASE_UPTIME = 0.85;

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

const splashHits = (splashRadius: number, enemiesOnScreen: number): number =>
  Math.min(1 + 0.8 * splashRadius, enemiesOnScreen);

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
  if (ability.type === "barrage") {
    const hits = splashHits(ability.splashRadius, enemiesOnScreen);
    return {
      dps: (ability.count * ability.damage * hits) / (ability.cooldown * cooldownMul),
      damageType: ability.damageType,
    };
  }
  if (ability.type === "mark") {
    return {
      dps:
        variant.damage *
        variant.fireRate *
        (ability.dmgMul - 1) *
        (ability.duration / (ability.cooldown * cooldownMul)),
      damageType: variant.damageType,
    };
  }
  if (ability.type === "incinerate") {
    const hits = Math.min(3, enemiesOnScreen);
    return {
      dps: (ability.totalDamage * hits) / (ability.cooldown * cooldownMul),
      damageType: ability.damageType,
    };
  }
  return { dps: 0, damageType: "kinetic" };
};

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

const robotEffectiveDpsVsWave = (
  variant: RobotVariantSpec,
  robot: Robot,
  spec: WaveSpec,
  enemiesOnScreen: number,
  longestPath: number,
  combatDur: number,
): number => {
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

// Same heuristic as wave-feasibility: one perfect prior clear funds 3sp.
const defaultRobotSkillBudget = (levelId: number): number =>
  Math.min(12, Math.max(0, 3 * (levelId - 1)));

// ------- Tower picker -------

type TowerPick = {
  kind: TowerKind;
  tierA: number;
  tierB: number;
  unitCost: number;
  perTowerDps: number;
  count: number;
  totalDps: number;
  potentialDamage: number;
};

const bestSetup = (
  wave: WaveBreakdown,
  spec: WaveSpec,
  budget: number,
  dur: number,
  paths: Vec2[][],
  longestPath: number,
  allowed: Set<TowerKind>,
  robotDps: number,
): TowerPick[] => {
  const picks: TowerPick[] = [];
  for (const cfg of ALL_CONFIGS) {
    if (!allowed.has(cfg.kind)) continue;
    if (cfg.damage <= 0) continue;
    const count = Math.floor(budget / cfg.cost);
    if (count === 0) continue;
    const perTowerDps = effectiveDpsVsWave(cfg, wave, spec, longestPath);
    const covPer = pathCoverage(paths, cfg.range);
    const covFrac = coverageFraction(count, covPer, paths.length);
    const towerDps = perTowerDps * count * covFrac;
    const totalDps = towerDps + robotDps;
    picks.push({
      kind: cfg.kind,
      tierA: cfg.tierA,
      tierB: cfg.tierB,
      unitCost: cfg.cost,
      perTowerDps,
      count,
      totalDps,
      potentialDamage: totalDps * dur,
    });
  }
  picks.sort((a, b) => b.potentialDamage - a.potentialDamage);
  return picks.slice(0, 3);
};

const ALL_TOWERS: TowerKind[] = ["pulse", "chain", "cryo", "mortar", "flame", "hive"];

const C = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};
const feasColor = (f: number) =>
  f >= 2 ? C.green : f >= 1.2 ? C.cyan : f >= 0.8 ? C.yellow : C.red;
const fmt = (n: number, d = 0) => n.toFixed(d);
const pad = (s: string | number, n: number) => String(s).padStart(n);

declare const process: { argv: string[]; exit(code: number): never };

const args = process.argv.slice(2);
const levelArg = args.find((a) => /^\d+$/.test(a));
const modeArg = args.find((a) => a === "breach" || a === "containment") as
  | "breach"
  | "containment"
  | undefined;
const robotArg = args.find((a) => a.startsWith("--robot="));
const robotSkillsArg = args.find((a) => a.startsWith("--robot-skills="));
const noRobot = args.includes("--no-robot");

const parseRobotVariant = (value: string | undefined): RobotVariant => {
  const v = value ?? "george";
  if (v === "george" || v === "leela" || v === "mike" || v === "stan") return v;
  console.error(`Robot variant must be one of: george, leela, mike, stan (got "${v}")`);
  process.exit(1);
};

if (!levelArg || !modeArg) {
  console.error(
    "Usage: npx tsx scripts/mode-feasibility.ts <level-id> breach|containment " +
      "[--robot=george|leela|mike|stan] [--robot-skills=N] [--no-robot]",
  );
  process.exit(1);
}

const level = LEVELS.find((l) => l.id === Number(levelArg)) as LevelWithModes | undefined;
if (!level) {
  console.error(`Level ${levelArg} not found`);
  process.exit(1);
}

const mode = level[modeArg];
if (!mode) {
  console.error(`Level ${levelArg} has no '${modeArg}' mode block authored yet`);
  process.exit(1);
}

const robotVariant: RobotVariant | null = noRobot
  ? null
  : parseRobotVariant(robotArg?.split("=")[1]);
const robotSkillBudget = robotSkillsArg
  ? Number(robotSkillsArg.split("=")[1])
  : defaultRobotSkillBudget(level.id);

const hpScale = level.hpScale ?? 1;
// countScale is a top-level level field; createWorld scales every mode's
// roster by it, so mirror that here before analyzing the mode block.
const waves = scaleWaveCounts(mode.waves, level.countScale ?? 1);
const longestPath = Math.max(...level.paths.map(pathLength));
const allowed = new Set<TowerKind>(mode.lockedLoadout ?? ALL_TOWERS);
if (mode.forbiddenTowers) {
  for (const t of mode.forbiddenTowers) allowed.delete(t);
}

const robotLabel = robotVariant ? `${robotVariant}(${robotSkillBudget}sp)` : "off";

console.log(
  `\n${C.bold}═══ L${level.id} ${modeArg.toUpperCase()}: ${level.name}${C.reset} ` +
    `${C.dim}startGold=${mode.startGold}, paths=${level.paths.length}, hpScale=${hpScale}, longestPath=${fmt(longestPath, 1)}u${C.reset}\n` +
    `${C.dim}allowedTowers=[${[...allowed].join(",")}] robot=${robotLabel}` +
    (mode.singleLife ? " singleLife" : "") +
    (mode.noSelling ? " noSelling" : "") +
    `${C.reset}`,
);
console.log(
  `${C.dim}${pad("W", 3)} ${pad("arch", 7)} ${pad("enemies", 7)} ${pad("totalHp", 8)} ${pad("sec", 6)} ${pad("gold", 6)} ${pad("reqDPS", 7)} ${pad("bestT", 8)} ${pad("×N", 4)} ${pad("twrDPS", 7)} ${pad("robotDPS", 8)} ${pad("feas", 6)}${C.reset}`,
);

let cumBounty = 0;
let cumBonus = 0;
let cleared = 0;
let tightest = { f: Number.POSITIVE_INFINITY, wave: 0 };
for (let i = 0; i < waves.length; i++) {
  const spec = waves[i];
  const waveNumber = i + 1;
  const wave = analyzeWave(spec, hpScale, longestPath);
  const dur = combatWindow(spec, waveNumber, wave, longestPath);
  const budget = mode.startGold + cumBounty + cumBonus;
  const requiredDps = wave.totalHp / dur;
  const robotDps =
    robotVariant !== null
      ? bestRobotDps(
          robotVariant,
          robotSkillBudget,
          spec,
          Math.min(wave.totalEnemies, 10),
          longestPath,
          dur,
        )
      : 0;
  const picks = bestSetup(wave, spec, budget, dur, level.paths, longestPath, allowed, robotDps);
  const best = picks[0];
  const feas = best ? best.potentialDamage / wave.totalHp : 0;
  if (feas >= 1) cleared++;
  if (feas < tightest.f) tightest = { f: feas, wave: waveNumber };
  const towerOnlyDps = best ? best.totalDps - robotDps : 0;
  console.log(
    `${pad(waveNumber, 3)} ${pad(spec.archetype ?? "—", 7)} ${pad(wave.totalEnemies, 7)} ` +
      `${pad(fmt(wave.totalHp, 0), 8)} ${pad(fmt(dur, 1), 6)} ` +
      `${pad(budget, 6)} ${pad(fmt(requiredDps, 0), 7)} ` +
      `${pad(best?.kind ?? "—", 8)} ${pad(best?.count ?? 0, 4)} ` +
      `${pad(fmt(towerOnlyDps, 0), 7)} ${pad(fmt(robotDps, 0), 8)} ` +
      `${feasColor(feas)}${pad(fmt(feas, 2), 6)}${C.reset}`,
  );
  cumBounty += waveBounty(spec, longestPath);
  cumBonus += 5 + waveNumber;
}
const tailColor = cleared === waves.length ? C.green : cleared >= waves.length - 1 ? C.cyan : C.red;
console.log(
  `${tailColor}  → ${cleared}/${mode.waves.length} waves clearable; tightest = wave ${tightest.wave} @ ${fmt(tightest.f, 2)}×${C.reset}`,
);
