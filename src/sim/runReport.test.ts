import { describe, expect, it, vi } from "vitest";
import { track } from "../analytics";
import { getLevel } from "../levels";
import { starsForRun } from "../progress";
import { updateEnemies } from "./enemies";
import { xpForEnemyKill } from "./robotSkills";
import { buildRunReport, nextStarGoal, resultAnalytics } from "./runReport";
import type { EnemyKind, World } from "./types";
import { sellTower } from "./upgrades";
import { applyDamage, createTower, createWorld, spawnEnemy } from "./world";

const leakEnemy = (world: World, kind: EnemyKind) => {
  const enemy = spawnEnemy(world, kind);
  const path = world.paths[enemy.pathIndex];
  enemy.segment = path.length - 2;
  enemy.segmentT = 1;
  enemy.pos = { ...path[path.length - 1] };
  world.robot.alive = false;
  updateEnemies(world, 0);
  expect(enemy.leak).toBeDefined();
  world.time += 1;
  updateEnemies(world, 0);
  return enemy;
};

describe("after-action run history", () => {
  it("records actual leaking species once and caps a lethal hit at remaining lives", () => {
    const world = createWorld(getLevel(1));
    world.wave = 4;
    world.lives = 2;
    leakEnemy(world, "raptor");
    leakEnemy(world, "titan");
    updateEnemies(world, 1);
    const report = buildRunReport(world, "hard", 0, 0);
    expect(report.waveReached).toBe(4);
    expect(report.leaks).toEqual(
      expect.arrayContaining([
        { kind: "raptor", count: 1, livesLost: 1 },
        { kind: "titan", count: 1, livesLost: 1 },
      ]),
    );
    expect(report.enemiesKilled).toBe(0);
    expect(report.boltsEarned).toBe(0);
    expect(report.robotXpEarned).toEqual({});
  });

  it("counts an invincible leak without claiming a life was lost", () => {
    const world = createWorld(getLevel(1));
    world.invincible = true;
    leakEnemy(world, "raptor");
    expect(world.runHistory.leaks.raptor).toEqual({ kind: "raptor", count: 1, livesLost: 0 });
    expect(world.lives).toBe(world.startLives);
  });

  it("retains sold towers and credits their delayed damage, shields, and kills", () => {
    const world = createWorld(getLevel(1));
    const tower = createTower(world, "pulse", { x: 0, y: 0 });
    const enemy = spawnEnemy(world, "raptor", { shielded: true });
    applyDamage(world, enemy, 2, "kinetic", undefined, 0, false, { attackerTowerId: tower.id });
    sellTower(world, tower);
    const gold = world.gold;
    sellTower(world, tower);
    expect(world.gold).toBe(gold);
    applyDamage(world, enemy, 10000, "kinetic", undefined, 0, false, { attackerTowerId: tower.id });
    const report = buildRunReport(world, "medium", 0, 0);
    expect(report.towers).toEqual([
      {
        id: tower.id,
        kind: "pulse",
        sold: true,
        kills: 1,
        damageDealt: enemy.maxHp + enemy.maxShield,
      },
    ]);
    expect(report.enemiesKilled).toBe(1);
    expect(report.loadout).toEqual(["pulse"]);
  });

  it("records the actual bolt roll and robot-earned XP without rewarding repeated damage or report reads", () => {
    const world = createWorld(getLevel(1));
    const enemy = spawnEnemy(world, "titan");
    applyDamage(world, enemy, 100000, "electric", undefined, 0, false, { fromRobot: true });
    const reward = world.events.find((event) => event.type === "death" && event.target === "enemy");
    expect(reward?.type).toBe("death");
    if (!reward || reward.type !== "death" || reward.target !== "enemy")
      throw new Error("Missing death reward");
    expect(reward.bolts).toBeGreaterThan(0);
    const report = buildRunReport(world, "medium", 2, 1);
    expect(report.boltsEarned).toBe(reward.bolts);
    expect(report.robotXpEarned).toEqual({ leela: xpForEnemyKill(enemy.maxHp) });
    expect(report.robotContribution.kills).toBe(1);
    applyDamage(world, enemy, 100000, "electric", undefined, 0, false, { fromRobot: true });
    expect(buildRunReport(world, "medium", 2, 1)).toEqual(report);
    expect(report.newStars).toBe(1);
    const fresh = createWorld(getLevel(1));
    expect(buildRunReport(fresh, "medium", 0, 0)).toMatchObject({
      waveReached: 0,
      leaks: [],
      towers: [],
      boltsEarned: 0,
      robotXpEarned: {},
      enemiesKilled: 0,
    });
    expect(fresh.runHistory).not.toBe(world.runHistory);
  });

  it("returns detached snapshots and serializable history for checkpoint recovery", () => {
    const world = createWorld(getLevel(1));
    leakEnemy(world, "raptor");
    const report = buildRunReport(world, "medium", 0, 0);
    world.runHistory = JSON.parse(JSON.stringify(world.runHistory));
    leakEnemy(world, "raptor");
    expect(report.leaks[0].count).toBe(1);
    expect(buildRunReport(world, "medium", 0, 0).leaks[0].count).toBe(2);
  });

  it.each([
    "normal",
    "breach",
    "containment",
  ] as const)("matches real %s star thresholds", (mode) => {
    const max = mode === "normal" ? 3 : 1;
    for (let previous = 0; previous < max; previous++) {
      const goal = nextStarGoal(mode, previous)!;
      expect(starsForRun(mode, goal.lives, true)).toBe(goal.stars);
      expect(starsForRun(mode, goal.lives, false)).toBe(0);
      if (mode === "normal")
        expect(starsForRun(mode, goal.lives - 1, true)).toBeLessThan(goal.stars);
    }
    expect(nextStarGoal(mode, max)).toBeNull();
  });

  it("reports Endless without stars or a finite wave count and limits analytics to game facts", () => {
    const world = createWorld(getLevel(1), "normal", undefined, new Set(), undefined, {
      seed: 123,
      mapId: "verdant",
      mapName: "Verdant Spiral",
      bestWave: 0,
    });
    world.wave = 17;
    world.time = 312.8;
    const report = buildRunReport(world, "hard", 0, 0);
    expect(report).toMatchObject({
      totalWaves: null,
      nextStar: null,
      waveReached: 17,
      mode: "endless",
    });
    expect(resultAnalytics(report)).toEqual({
      elapsed_seconds: 312,
      difficulty: "hard",
      mode: "endless",
      loadout: "leela",
      wave_reached: 17,
    });
  });
});

describe("result analytics host boundary", () => {
  it("only sends game facts on the existing allowed web host", () => {
    const report = buildRunReport(createWorld(getLevel(1)), "medium", 0, 0);
    const plausible = vi.fn();
    const allowedHost = (import.meta.env.VITE_PLAUSIBLE_HOSTS ?? "play.mesozoicprotocol.com").split(
      ",",
    )[0];
    try {
      for (const hostname of ["localhost", "tauri.localhost", "127.0.0.1", ""]) {
        vi.stubGlobal("window", { location: { hostname }, plausible });
        track("level_failed", resultAnalytics(report));
      }
      expect(plausible).not.toHaveBeenCalled();
      vi.stubGlobal("window", { location: { hostname: allowedHost }, plausible });
      track("level_failed", resultAnalytics(report));
      expect(plausible).toHaveBeenCalledExactlyOnceWith("level_failed", {
        props: resultAnalytics(report),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
