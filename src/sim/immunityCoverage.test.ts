import { describe, expect, it } from "vitest";
import { getLevel } from "../levels";
import { LEVEL_MODES } from "../progress";
import { availableDamageTypes, ensureImmunityCoverage } from "./immunityCoverage";
import type { WaveSpec } from "./types";
import { applyDamage, createWorld, spawnEnemy } from "./world";

const rosterSize = (waves: WaveSpec[]) =>
  waves.flatMap((w) => w.spawns).reduce((sum, s) => sum + s.count, 0);

describe("campaign resistance introduction", () => {
  it.each([1, 2])("level %i never injects an invulnerable opening enemy", (id) => {
    for (const mode of LEVEL_MODES) {
      const world = createWorld(getLevel(id), mode);
      for (const wave of world.plannedWaves) {
        for (const spec of wave.spawns) {
          expect(Object.values(spec.resists ?? {})).not.toContain(0);
          const enemy = spawnEnemy(world, spec.kind, { resists: spec.resists, hpMul: wave.hpMul });
          const hp = enemy.hp;
          applyDamage(world, enemy, 1, "electric", undefined, 0, false, { fromRobot: true });
          expect(enemy.hp).toBeLessThan(hp);
        }
      }
    }
  });
  it.each([
    3, 4, 5, 6,
  ])("level %i introduces coverage without changing roster size or source data", (id) => {
    const source: WaveSpec[] = [{ spawns: [{ kind: "raptor", count: 10 }] }];
    const types = availableDamageTypes(new Set(), null);
    const result = ensureImmunityCoverage(source, types, id);
    expect(rosterSize(result)).toBe(10);
    expect(source).toEqual([{ spawns: [{ kind: "raptor", count: 10 }] }]);
    for (const type of types) {
      expect(
        result.flatMap((w) => w.spawns).some((s) => s.resists?.[type] === (id < 6 ? 0.5 : 0)),
      ).toBe(true);
    }
  });
  it("preserves authored resistance, boss waves, and restricted loadouts", () => {
    const source: WaveSpec[] = [
      { spawns: [{ kind: "raptor", count: 2, resists: { electric: 0.25 } }] },
      { bossWave: true, spawns: [{ kind: "boss", count: 1 }] },
    ];
    const types = availableDamageTypes(new Set(["chain"]), ["chain", "flame"]);
    expect(types).toEqual(["flame"]);
    expect(ensureImmunityCoverage(source, types, 1)).toBe(source);
    const result = ensureImmunityCoverage(source, types, 3);
    expect(result[1]).toEqual(source[1]);
    expect(result[0].spawns.every((s) => s.resists?.electric === 0.25)).toBe(true);
    expect(result[0].spawns.some((s) => s.resists?.flame === 0.5)).toBe(true);
    expect(ensureImmunityCoverage(source, ["electric"], 3)).toBe(source);
  });
});
