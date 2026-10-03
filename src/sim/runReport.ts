import type { Difficulty, LevelMode } from "../progress";
import type { EnemyKind, RobotVariant, Tower, TowerKind, World } from "./types";

export type LeakRecord = { kind: EnemyKind; count: number; livesLost: number };
export type TowerContribution = Pick<Tower, "id" | "kind" | "kills" | "damageDealt">;

// Plain data so between-wave checkpoints can preserve the complete run.
// Reset only by createWorld, never when a wave starts or a report is viewed.
export type RunHistory = {
  leaks: Partial<Record<EnemyKind, LeakRecord>>;
  soldTowers: Record<number, TowerContribution>;
  boltsEarned: number;
  robotXpEarned: Partial<Record<RobotVariant, number>>;
  enemiesKilled: number;
};

export const createRunHistory = (): RunHistory => ({
  leaks: {},
  soldTowers: {},
  boltsEarned: 0,
  robotXpEarned: {},
  enemiesKilled: 0,
});

export const recordLeak = (world: World, kind: EnemyKind, livesLost: number): void => {
  const entry = world.runHistory.leaks[kind] ?? { kind, count: 0, livesLost: 0 };
  entry.count += 1;
  entry.livesLost += livesLost;
  world.runHistory.leaks[kind] = entry;
};

export const archiveTowerContribution = (world: World, tower: Tower): void => {
  world.runHistory.soldTowers[tower.id] = {
    id: tower.id,
    kind: tower.kind,
    kills: tower.kills,
    damageDealt: tower.damageDealt,
  };
};

export const towerContributor = (world: World, id: number) =>
  world.towerById.get(id) ?? world.runHistory.soldTowers[id];

export type RunReport = {
  waveReached: number;
  totalWaves: number | null;
  elapsedSeconds: number;
  difficulty: Difficulty;
  mode: LevelMode | "endless";
  robot: RobotVariant;
  loadout: TowerKind[];
  leaks: LeakRecord[];
  towers: (TowerContribution & { sold: boolean })[];
  robotContribution: { kills: number; damageDealt: number };
  baseContribution: { kills: number; damageDealt: number };
  boltsEarned: number;
  robotXpEarned: Partial<Record<RobotVariant, number>>;
  enemiesKilled: number;
  starsEarned: number;
  newStars: number;
  nextStar: { stars: number; lives: number } | null;
};

// Thresholds match starsForRun: the goal is the next improvement to the
// saved best, not another award for repeating an already-earned star.
export const nextStarGoal = (mode: LevelMode, bestStars: number) => {
  if (mode !== "normal") return bestStars >= 1 ? null : { stars: 1, lives: 1 };
  if (bestStars >= 3) return null;
  return { stars: bestStars + 1, lives: [1, 10, 20][bestStars] };
};

export const buildRunReport = (
  world: World,
  difficulty: Difficulty,
  starsEarned: number,
  previousStars: number,
): RunReport => {
  const towers = [
    ...world.towers.map((tower) => ({
      id: tower.id,
      kind: tower.kind,
      kills: tower.kills,
      damageDealt: tower.damageDealt,
      sold: false,
    })),
    ...Object.values(world.runHistory.soldTowers).map((tower) => ({ ...tower, sold: true })),
  ].sort((a, b) => b.damageDealt - a.damageDealt || a.id - b.id);
  return {
    waveReached: world.wave,
    totalWaves: world.endless ? null : world.totalWaves,
    elapsedSeconds: Math.floor(world.time),
    difficulty,
    mode: world.endless ? "endless" : world.mode,
    robot: world.robot.variant,
    loadout: [...new Set(towers.map((tower) => tower.kind))].sort(),
    leaks: Object.values(world.runHistory.leaks)
      .map((leak) => ({ ...leak }))
      .sort((a, b) => b.livesLost - a.livesLost || b.count - a.count),
    towers,
    robotContribution: { kills: world.robot.kills, damageDealt: world.robot.damageDealt },
    baseContribution: { kills: world.base.kills, damageDealt: world.base.damageDealt },
    boltsEarned: world.runHistory.boltsEarned,
    robotXpEarned: { ...world.runHistory.robotXpEarned },
    enemiesKilled: world.runHistory.enemiesKilled,
    starsEarned,
    newStars: Math.max(0, starsEarned - previousStars),
    nextStar: world.endless ? null : nextStarGoal(world.mode, Math.max(starsEarned, previousStars)),
  };
};

// Only passed to the existing host-gated web analytics wrapper. Contains
// gameplay choices, no save-slot identifiers or player data.
export const resultAnalytics = (report: RunReport) => ({
  elapsed_seconds: report.elapsedSeconds,
  difficulty: report.difficulty,
  mode: report.mode,
  loadout: [report.robot, ...report.loadout].join(","),
  wave_reached: report.waveReached,
});
