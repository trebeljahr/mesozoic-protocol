import { describe, expect, it } from "vitest";
import { MAP_HEIGHT, MAP_WIDTH, PATH_ENTRY_MARGIN_X, PATH_ENTRY_MARGIN_Y } from "../level";
import { LEVEL_MODES } from "../progress";
import { ENEMY_DESCRIPTION, ENEMY_SUBTITLE } from "../sim/enemyText";
import type { DamageType, EnemyKind, WaveSpec } from "../sim/types";
import { dist } from "../sim/vec2";
import { ENEMY_RESIST, ENEMY_SLOW_RESIST, ENEMY_STATS } from "../sim/world";
import {
  getLevel,
  getLevelOrdinal,
  LEVELS,
  levelHasMode,
  resolveLevelMode,
  scaleWaveCounts,
} from "./index";

const ENEMY_KINDS = Object.keys(ENEMY_STATS) as EnemyKind[];
const DAMAGE_TYPES = Object.keys(ENEMY_RESIST.raptor) as DamageType[];
// Authored waypoints live inside the playfield plus the camera-entry margin
// the spawn lead-in is allowed to use.
const MAX_X = MAP_WIDTH / 2 + PATH_ENTRY_MARGIN_X;
const MAX_Y = MAP_HEIGHT / 2 + PATH_ENTRY_MARGIN_Y;
// Every fifth level is a matriarch level (see src/biomes.ts band comments).
const BOSS_LEVEL_INTERVAL = 5;

const modeWaves = (levelIndex: number) =>
  LEVEL_MODES.flatMap((mode) => {
    const level = LEVELS[levelIndex];
    return levelHasMode(level, mode)
      ? [{ mode, level, config: resolveLevelMode(level, mode) }]
      : [];
  });

describe("campaign level table", () => {
  it("has unique, gapless, ascending ids", () => {
    expect(LEVELS.length).toBeGreaterThan(0);
    const ids = LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id, i) => {
      expect(id).toBe(i + 1);
    });
  });

  it("resolves every id through getLevel / getLevelOrdinal", () => {
    for (const level of LEVELS) {
      expect(getLevel(level.id)).toBe(level);
      expect(getLevelOrdinal(level.id)).toEqual({
        current: level.id,
        total: LEVELS.length,
      });
    }
    expect(() => getLevel(LEVELS.length + 1)).toThrow();
  });

  it("gives every level at least one walkable lane inside the map bounds", () => {
    for (const level of LEVELS) {
      const label = `L${level.id}`;
      expect(level.paths.length, label).toBeGreaterThan(0);
      for (const [i, path] of level.paths.entries()) {
        expect(path.length, `${label} lane ${i}`).toBeGreaterThanOrEqual(2);
        for (const point of path) {
          expect(Number.isFinite(point.x) && Number.isFinite(point.y), `${label} lane ${i}`).toBe(
            true,
          );
          expect(Math.abs(point.x), `${label} lane ${i}`).toBeLessThanOrEqual(MAX_X);
          expect(Math.abs(point.y), `${label} lane ${i}`).toBeLessThanOrEqual(MAX_Y);
        }
        // Zero-length segments corrupt segmentT in advanceAlongPath and make
        // the painted ribbon fold on itself.
        for (let j = 0; j < path.length - 1; j++) {
          expect(dist(path[j], path[j + 1]), `${label} lane ${i} seg ${j}`).toBeGreaterThan(0);
        }
        // The spawn must not be the goal.
        expect(dist(path[0], path[path.length - 1]), `${label} lane ${i}`).toBeGreaterThan(0);
      }
    }
  });

  it("flags a matriarch on the final wave of every fifth level", () => {
    for (const level of LEVELS) {
      const final = level.waves[level.waves.length - 1];
      const expected = level.id % BOSS_LEVEL_INTERVAL === 0;
      expect(final.bossWave === true, `L${level.id} final wave`).toBe(expected);
    }
  });
});

describe("wave composition", () => {
  it("is non-empty and internally consistent for every level and mode", () => {
    for (const levelIndex of LEVELS.keys()) {
      for (const { mode, level, config } of modeWaves(levelIndex)) {
        const label = `L${level.id} ${mode}`;
        expect(config.waves.length, label).toBeGreaterThan(0);
        expect(config.startGold, label).toBeGreaterThan(0);

        config.waves.forEach((wave: WaveSpec, waveIndex) => {
          const wl = `${label} w${waveIndex + 1}`;
          expect(wave.spawns.length, wl).toBeGreaterThan(0);
          for (const spawn of wave.spawns) {
            // Referenced enemy kind must actually exist in the sim tables.
            expect(ENEMY_STATS[spawn.kind], `${wl} kind ${spawn.kind}`).toBeDefined();
            expect(Number.isInteger(spawn.count), `${wl} count`).toBe(true);
            expect(spawn.count, `${wl} count`).toBeGreaterThan(0);
            const pathIndex = spawn.pathIndex ?? 0;
            expect(pathIndex, `${wl} pathIndex`).toBeGreaterThanOrEqual(0);
            expect(pathIndex, `${wl} pathIndex`).toBeLessThan(level.paths.length);
            // bossVariant is only honored on the boss kind — a variant on
            // anything else silently does nothing.
            if (spawn.bossVariant) expect(spawn.kind, `${wl} bossVariant`).toBe("boss");
            for (const [type, mul] of Object.entries(spawn.resists ?? {})) {
              expect(DAMAGE_TYPES, `${wl} resist type`).toContain(type);
              expect(mul, `${wl} resist mul`).toBeGreaterThanOrEqual(0);
            }
          }
          // A boss banner with no boss in the wave leaves the banner and the
          // boss-kill bonus dangling.
          if (wave.bossWave) {
            expect(
              wave.spawns.some((s) => s.kind === "boss"),
              `${wl} bossWave without a boss spawn`,
            ).toBe(true);
          }
          for (const stream of wave.bossTrickle ?? []) {
            expect(stream.kinds.length, `${wl} trickle`).toBeGreaterThan(0);
            for (const kind of stream.kinds) {
              expect(ENEMY_STATS[kind], `${wl} trickle kind ${kind}`).toBeDefined();
            }
            expect(stream.pathIndex, `${wl} trickle pathIndex`).toBeLessThan(level.paths.length);
            expect(stream.minInterval, `${wl} trickle interval`).toBeGreaterThan(0);
            expect(stream.maxInterval, `${wl} trickle interval`).toBeGreaterThanOrEqual(
              stream.minInterval,
            );
          }
        });
      }
    }
  });

  it("scales non-boss spawn counts and leaves matriarchs singleton", () => {
    const waves: WaveSpec[] = [
      {
        spawns: [
          { kind: "raptor", count: 4 },
          { kind: "boss", count: 1 },
        ],
      },
      { spawns: [{ kind: "swarm", count: 1 }] },
    ];
    expect(scaleWaveCounts(waves, 1)).toBe(waves);
    const scaled = scaleWaveCounts(waves, 1.5);
    expect(scaled[0].spawns[0].count).toBe(6);
    expect(scaled[0].spawns[1].count).toBe(1);
    // Floors at one enemy so a chip can never scale itself out of the wave.
    expect(scaleWaveCounts(waves, 0.1)[1].spawns[0].count).toBe(1);
    // Non-destructive: the source table is shared module state.
    expect(waves[0].spawns[0].count).toBe(4);
  });

  it("keeps normal mode as the level's own top-level wave script", () => {
    for (const level of LEVELS) {
      expect(levelHasMode(level, "normal")).toBe(true);
      const normal = resolveLevelMode(level, "normal");
      expect(normal.waves).toBe(level.waves);
      expect(normal.startGold).toBe(level.startGold);
    }
  });
});

// Sanity half of scripts/check-enemy-text.ts (rule 6) — the prose-vs-resist
// heuristics stay in that script, but a missing entry breaks the Compendium
// and the new-sighting popup outright, so it gates here.
describe("enemy tables", () => {
  it("covers every enemy kind with stats, resists and Compendium text", () => {
    for (const kind of ENEMY_KINDS) {
      expect(ENEMY_STATS[kind].hp, kind).toBeGreaterThan(0);
      expect(ENEMY_STATS[kind].speed, kind).toBeGreaterThan(0);
      expect(ENEMY_RESIST[kind], kind).toBeDefined();
      for (const type of DAMAGE_TYPES) {
        expect(ENEMY_RESIST[kind][type], `${kind} ${type}`).toBeGreaterThanOrEqual(0);
      }
      expect(ENEMY_SLOW_RESIST[kind], kind).toBeGreaterThanOrEqual(0);
      expect(ENEMY_SLOW_RESIST[kind], kind).toBeLessThanOrEqual(1);
      expect(ENEMY_SUBTITLE[kind], `${kind} subtitle`).toBeTruthy();
      expect(ENEMY_DESCRIPTION[kind], `${kind} description`).toBeTruthy();
    }
  });
});
