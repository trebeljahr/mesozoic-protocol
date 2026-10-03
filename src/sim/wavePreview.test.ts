import { describe, expect, it, vi } from "vitest";
import { getLevel } from "../levels";
import { ENDLESS_ARENAS } from "../levels/endless";
import { DIFFICULTY_MULTIPLIERS } from "../progress";
import { getWave, startWave } from "./spawner";
import { PREVIEW_DAMAGE_TYPES, previewNextWave } from "./wavePreview";
import { computeResistMul, createWorld, spawnEnemy } from "./world";

describe("incoming wave inspection", () => {
  it("groups resolved multi-lane counts and matches actual HP and resistance", () => {
    const base = getLevel(1);
    const world = createWorld(
      {
        ...base,
        paths: [base.paths[0], base.paths[0]],
        waves: [
          {
            hpMul: 1.7,
            spawns: [
              { kind: "raptor", count: 2, pathIndex: 0 },
              { kind: "raptor", count: 3, pathIndex: 0 },
              {
                kind: "armored",
                count: 4,
                pathIndex: 1,
                shielded: true,
                healAura: true,
                regen: true,
                resists: { electric: 0 },
              },
            ],
          },
        ],
      },
      "normal",
      DIFFICULTY_MULTIPLIERS.hard,
    );
    const spec = getWave(world, 1)!;
    const preview = previewNextWave(world)!;
    expect(preview.count).toBeGreaterThan(9); // level countScale is already applied
    expect(preview.count).toBe(spec.spawns.reduce((sum, spawn) => sum + spawn.count, 0));
    for (const lane of preview.lanes) {
      expect(lane.count).toBe(
        spec.spawns
          .filter((spawn) => (spawn.pathIndex ?? 0) === lane.index)
          .reduce((sum, spawn) => sum + spawn.count, 0),
      );
    }
    for (const source of spec.spawns) {
      const enemy = spawnEnemy(world, source.kind, { ...source, hpMul: spec.hpMul });
      const matching = preview.lanes
        .find((l) => l.index === (source.pathIndex ?? 0))!
        .groups.find(
          (g) =>
            g.kind === source.kind &&
            PREVIEW_DAMAGE_TYPES.every(
              (type) => g.resists[type] === computeResistMul(enemy, type, false),
            ),
        )!;
      expect(matching.hp).toBe(enemy.maxHp);
      expect(matching.shield).toBe(enemy.maxShield);
    }
    startWave(world);
    expect(world.spawnQueue.length).toBe(preview.count);
  });
  it("shows only counters in the allowed loadout and excludes ineffective damage", () => {
    const world = createWorld(getLevel(1));
    world.lockedLoadout = ["flame"];
    world.plannedWaves = [{ spawns: [{ kind: "raptor", count: 3, resists: { flame: 0 } }] }];
    expect(previewNextWave(world)!.lanes[0].groups[0].counters).toEqual([]);
  });
  it("handles empty, exhausted and generated Endless waves without mutations or RNG", () => {
    const world = createWorld(getLevel(1));
    world.plannedWaves = [{ spawns: [] }];
    expect(previewNextWave(world)?.count).toBe(0);
    world.wave = 1;
    expect(previewNextWave(world)).toBeNull();
    const arena = ENDLESS_ARENAS[0];
    const endless = createWorld(arena, "normal", undefined, undefined, undefined, {
      seed: 83,
      mapId: arena.id.toString(),
      mapName: arena.name,
      bestWave: 0,
    });
    endless.wave = 30;
    const before = JSON.stringify(endless);
    const random = vi.spyOn(Math, "random");
    try {
      const preview = previewNextWave(endless)!;
      expect(preview.number).toBe(31);
      expect(preview.count).toBe(getWave(endless, 31)!.spawns.reduce((sum, s) => sum + s.count, 0));
      expect(JSON.stringify(endless)).toBe(before);
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });
  it("labels ongoing boss escorts separately from scheduled counts", () => {
    const world = createWorld(getLevel(1));
    world.plannedWaves = [
      {
        bossWave: true,
        spawns: [{ kind: "boss", bossVariant: "raptor", count: 1 }],
        bossTrickle: [{ kinds: ["swarm"], pathIndex: 0, minInterval: 2, maxInterval: 4 }],
      },
    ];
    const preview = previewNextWave(world)!;
    expect(preview.count).toBe(1);
    expect(preview.boss).toBe(true);
    expect(preview.lanes[0].groups[0].reinforcements).toBe(true);
    expect(preview.lanes[0].streams[0].minInterval).toBe(2 * world.bossTrickleIntervalMul);
  });
});
