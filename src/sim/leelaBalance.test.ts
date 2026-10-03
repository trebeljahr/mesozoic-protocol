import { afterEach, describe, expect, it, vi } from "vitest";
import { getLevel } from "../levels";
import { Engine } from "./loop";
import { mulberry32 } from "./random";
import { triggerRobotAbility } from "./robot";
import { startWave } from "./spawner";
import type { TowerKind, Vec2 } from "./types";
import { createTower, createWorld, TOWER_COST } from "./world";

// Combat fixture: fresh-save Medium, HQ guard using W/E/R on cooldown.
// Scenery is removed to isolate damage throughput from navigation.
const runOpeningLevel = (id: number, withTowers: boolean, seed: number) => {
  vi.spyOn(Math, "random").mockImplementation(mulberry32(seed));
  const world = createWorld(getLevel(id), "normal", undefined, new Set(), {
    variant: "leela",
    xp: 0,
    skills: {},
  });
  world.status = "running";
  world.trees = [];
  world.rocks = [];
  if (withTowers) {
    const defenses: [TowerKind, Vec2][] =
      id === 1
        ? [
            ["chain", { x: 12, y: 2 }],
            ["pulse", { x: 16, y: -2 }],
          ]
        : [
            ["chain", { x: -10, y: -4 }],
            ["pulse", { x: -4, y: -4 }],
            ["chain", { x: 6, y: 0 }],
            ["pulse", { x: 14, y: 8 }],
          ];
    for (const [kind, pos] of defenses) {
      expect(world.gold).toBeGreaterThanOrEqual(TOWER_COST[kind]);
      createTower(world, kind, pos);
      world.gold -= TOWER_COST[kind];
    }
  }
  startWave(world);
  const engine = new Engine();
  engine.step(world, 0);
  for (let frame = 1; frame < 30000 && world.status === "running"; frame++) {
    // Spend earned gold on one mid-run reinforcement rather than assuming
    // the opening purchases must carry the entire campaign level.
    if (
      withTowers &&
      id === 2 &&
      world.wave >= 4 &&
      world.towers.length === 4 &&
      world.gold >= TOWER_COST.chain
    ) {
      createTower(world, "chain", { x: 10, y: 4 });
      world.gold -= TOWER_COST.chain;
    }
    triggerRobotAbility(world, 1);
    triggerRobotAbility(world, 2);
    triggerRobotAbility(world, 3);
    engine.step(world, frame / 30);
    world.events = [];
  }
  return world;
};

afterEach(() => vi.restoreAllMocks());

describe("opening Medium combat balance", () => {
  it.each([
    [1, 7],
    [1, 42],
    [1, 123],
    [2, 7],
    [2, 42],
    [2, 123],
  ])("Leela guarding HQ alone cannot clear level %i (seed %i)", (id, seed) => {
    const world = runOpeningLevel(id, false, seed);
    expect(world.towers).toHaveLength(0);
    expect(world.status).toBe("lost");
  });
  it.each([
    [1, 7],
    [1, 42],
    [1, 123],
    [2, 7],
    [2, 42],
    [2, 123],
  ])("budgeted towers and Leela can clear level %i (seed %i)", (id, seed) => {
    const world = runOpeningLevel(id, true, seed);
    expect(world.status).toBe("won");
    expect(world.lives).toBeGreaterThan(0);
  });
});
