import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLevel } from "../levels";
import { loadSlot } from "../progress";
import { buildRunReport } from "../sim/runReport";
import { sellTower } from "../sim/upgrades";
import { applyDamage, createTower, createWorld, spawnEnemy } from "../sim/world";
import { useGame } from "../store";
import { captureCheckpoint, restoreCheckpoint } from "./missionCheckpoint";
import { checkpointMission } from "./missionPersistence";

vi.mock("../analytics", () => ({ track: vi.fn() }));
const initial = useGame.getState();
const state = () => useGame.getState();
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    },
  });
  useGame.setState({ ...initial, activeSlot: null, screen: "slots", assetsPrewarmed: true });
  state().selectSlot(1);
  state().startLevel(1);
  state().dismissLevelIntro();
});
afterEach(() => vi.unstubAllGlobals());

describe("report checkpoint integration", () => {
  it("commits history with rewards and rolls both back to the same boundary on resume", () => {
    const world = state().world;
    const tower = createTower(world, "pulse", { x: 0, y: 0 });
    const enemy = spawnEnemy(world, "titan");
    world.waveActive = true;
    applyDamage(world, enemy, 2, "kinetic", undefined, 0, false, { attackerTowerId: tower.id });
    sellTower(world, tower);
    applyDamage(world, enemy, 100000, "electric", undefined, 0, false, { fromRobot: true });
    world.enemies = [];
    world.enemyById.clear();
    state().tick(0);
    expect(restoreCheckpoint(loadSlot(1).checkpoint!).runHistory.boltsEarned).toBe(0);
    world.waveActive = false;
    world.wave = 1;
    expect(checkpointMission(world, state().progress, "medium", true)).toBe(true);
    const saved = buildRunReport(world, "medium", 0, 0);
    const permanent = state().progress.bolts;
    expect(saved.boltsEarned).toBe(permanent);
    expect(saved.robotXpEarned.leela).toBe(state().progress.robotXp.leela);
    expect(saved.towers[0]).toMatchObject({ id: tower.id, sold: true });
    world.waveActive = true;
    applyDamage(world, spawnEnemy(world, "titan"), 100000, "electric", undefined, 0, false, {
      fromRobot: true,
    });
    state().tick(0);
    expect(state().progress.bolts).toBeGreaterThan(permanent);
    state().goToSlots();
    state().selectSlot(1);
    const resumed = state().world;
    expect(buildRunReport(resumed, "medium", 0, 0)).toEqual(saved);
    expect(state().progress.bolts).toBe(permanent);
    expect(resumed.robot.xp).toBe(saved.robotXpEarned.leela);
    expect(resumed.runHistory).not.toBe(world.runHistory);
  });

  it("restores older checkpoints without inventing missing report history", () => {
    const world = createWorld(getLevel(1));
    world.wave = 3;
    world.lives = 12;
    const checkpoint = captureCheckpoint(world, "medium", "medium")!;
    const old = JSON.parse(checkpoint.world);
    delete old.runHistory;
    checkpoint.world = JSON.stringify(old);
    const restored = restoreCheckpoint(checkpoint);
    expect(restored).toMatchObject({ wave: 3, lives: 12 });
    expect(buildRunReport(restored, "medium", 0, 0)).toMatchObject({
      historyComplete: false,
      leaks: [],
      boltsEarned: 0,
      robotXpEarned: {},
    });
  });

  it.each([
    null,
    { complete: true },
    {
      complete: true,
      leaks: {},
      soldTowers: {},
      boltsEarned: -1,
      robotXpEarned: {},
      enemiesKilled: 0,
    },
  ])("rejects a present but damaged history instead of resetting it", (history) => {
    const checkpoint = captureCheckpoint(createWorld(getLevel(1)), "medium", "medium")!;
    const raw = JSON.parse(checkpoint.world);
    raw.runHistory = history;
    checkpoint.world = JSON.stringify(raw);
    expect(() => restoreCheckpoint(checkpoint)).toThrow("Invalid mission checkpoint");
  });
});
