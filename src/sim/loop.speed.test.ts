import { afterEach, describe, expect, it, vi } from "vitest";
import { getLevel } from "../levels";
import { Engine, TICK_DT } from "./loop";
import { startWave } from "./spawner";
import { createTower, createWorld } from "./world";

const seededRandom = () => {
  let seed = 1837;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
};
afterEach(() => vi.restoreAllMocks());
describe("fixed-step speed", () => {
  it("produces identical combat outcomes at 1× and 2× for equal simulation time", () => {
    const run = (speed: 1 | 2) => {
      vi.spyOn(Math, "random").mockImplementation(seededRandom());
      const world = createWorld({
        ...getLevel(1),
        waves: [{ archetype: "swarm", spawns: [{ kind: "raptor", count: 8 }], spacing: 0.4 }],
      });
      const start = world.paths[0][1];
      createTower(world, "pulse", { x: start.x + 2, y: start.y });
      startWave(world);
      const engine = new Engine();
      engine.step(world, 0, speed);
      for (let frame = 1; frame <= 600 / speed; frame++) engine.step(world, frame / 60, speed);
      const result = {
        ticks: world.tickCount,
        time: world.time,
        gold: world.gold,
        lives: world.lives,
        enemies: world.enemies.map((e) => ({ kind: e.kind, hp: e.hp, pos: e.pos })),
        damage: world.towers.map((t) => t.damageDealt),
        wave: world.wave,
        queued: world.spawnQueue,
      };
      vi.restoreAllMocks();
      return result;
    };
    const normal = run(1);
    expect(normal.ticks).toBe(600);
    expect(run(2)).toEqual(normal);
  });
  it("caps stalled-frame work equally and never ticks after a terminal state", () => {
    for (const speed of [1, 2] as const) {
      const world = createWorld(getLevel(1));
      const engine = new Engine();
      engine.step(world, 0, speed);
      engine.step(world, 100, speed);
      expect(world.tickCount).toBe(15);
      world.lives = 0;
      engine.step(world, 101, speed);
      expect(world.status).toBe("lost");
      expect(world.tickCount).toBe(16);
    }
  });
  it("ignores paused, invalid and backwards time and keeps training at 1×", () => {
    const world = createWorld(getLevel(1));
    const engine = new Engine();
    Object.assign(world, { sessionKind: "tutorial" });
    engine.step(world, 0, 2);
    engine.step(world, TICK_DT, 2);
    expect(world.tickCount).toBe(1);
    world.status = "paused";
    engine.step(world, 20, 2);
    expect(world.tickCount).toBe(1);
    engine.step(world, Number.NaN, 2);
    engine.step(world, 19, 2);
    expect(world.tickCount).toBe(1);
  });
});
