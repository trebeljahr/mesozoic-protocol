import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyProgress, recordLevelResult } from "./progress";
import { checkRunEnd } from "./sim/spawner";
import { applyDamage, spawnEnemy } from "./sim/world";
import { useGame } from "./store";

beforeEach(() => {
  vi.useFakeTimers();
  useGame.setState({ assetsPrewarmed: true, activeSlot: null, progress: emptyProgress() });
  useGame.getState().startLevel(1);
  useGame.getState().dismissLevelIntro();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("result reward accounting", () => {
  it("routes a real final normal win into the epilogue, while challenge wins stay ordinary results", () => {
    let progress = emptyProgress();
    for (let id = 1; id <= 30; id++) progress = recordLevelResult(progress, id, "normal", 3);
    useGame.setState({ progress });
    for (const mode of ["normal", "breach", "containment"] as const) {
      useGame.getState().startLevel(30, mode);
      useGame.getState().dismissLevelIntro();
      const world = useGame.getState().world;
      expect(world.mode).toBe(mode);
      world.wave = world.totalWaves;
      checkRunEnd(world, 3);
      useGame.getState().tick(0);
      expect(useGame.getState().lastResult?.campaignCompleted).toBe(mode === "normal");
    }
  });
  it("shows the same permanent rewards the store pays and handles a repeated result once", () => {
    const world = useGame.getState().world;
    const enemy = spawnEnemy(world, "titan");
    applyDamage(world, enemy, 100000, "electric", undefined, 0, false, { fromRobot: true });
    world.enemies = [];
    world.enemyById.clear();
    world.wave = world.totalWaves;
    checkRunEnd(world, 3);
    useGame.getState().tick(0);
    const result = useGame.getState().lastResult!;
    const progress = useGame.getState().progress;
    expect(result.report.boltsEarned).toBe(progress.bolts);
    expect(result.report.robotXpEarned.leela).toBe(progress.robotXp.leela);
    expect(result.report.starsEarned).toBe(3);
    expect(result.report.newStars).toBe(3);
    expect(result.report.waveReached).toBe(world.totalWaves);
    world.events.push({ type: "game-over", won: true });
    useGame.getState().tick(0);
    expect(useGame.getState().progress.stats.winsTotal).toBe(1);
    expect(useGame.getState().lastResult).toBe(result);
    useGame.getState().retryCurrentLevel();
    expect(useGame.getState().world.runHistory.boltsEarned).toBe(0);
    expect(useGame.getState().lastResult).toBeNull();
  });
  it("records the actual failed wave before the loss cinematic reveals the result", () => {
    const world = useGame.getState().world;
    world.wave = 6;
    world.lives = -2;
    checkRunEnd(world, 0);
    useGame.getState().tick(0);
    expect(useGame.getState().lastResult).toMatchObject({
      won: false,
      livesRemaining: 0,
      report: { waveReached: 6, starsEarned: 0, nextStar: { stars: 1, lives: 1 } },
    });
    vi.advanceTimersByTime(1300);
    expect(useGame.getState().screen).toBe("results");
  });
});
