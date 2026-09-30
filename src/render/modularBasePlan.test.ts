import { describe, expect, it } from "vitest";
import type { Biome } from "../biomes";
import { getLevel } from "../levels";
import { createWorld } from "../sim/world";
import {
  baseAppearance,
  baseSeed,
  courtyardBaseScale,
  courtyardTanks,
  modularBasePlan,
} from "./modularBasePlan";

const biomes: Biome[] = ["forest", "desert", "snow", "wasteland", "lava", "alien"];
describe("modular base reservations", () => {
  it("keeps every panel and accessory inside the placement clearance at every compound size", () => {
    for (const biome of biomes)
      for (let seed = 0; seed < 15; seed++)
        for (const radius of [1.5, 3, 4.5, 8]) {
          const blocks = modularBasePlan(biome, seed, radius);
          for (const { at, size } of blocks) {
            expect(
              Math.hypot(Math.abs(at[0]) + size[0] / 2, Math.abs(at[2]) + size[2] / 2),
            ).toBeLessThanOrEqual(radius);
            expect(at[1] - size[1] / 2).toBeGreaterThanOrEqual(0);
          }
        }
  });
  it("keeps all courtyard damage states bounded and architecture clear of tanks", () => {
    for (const biome of biomes)
      for (let seed = 0; seed < 18; seed++)
        for (const radius of [3.2, 4, 8]) {
          const scale = courtyardBaseScale(radius);
          const blocks = modularBasePlan(biome, seed, radius, true);
          const tanks = courtyardTanks(baseAppearance(seed).layout);
          for (const { at, size } of blocks) {
            expect(
              Math.hypot(Math.abs(at[0]) + size[0] / 2, Math.abs(at[2]) + size[2] / 2),
            ).toBeLessThanOrEqual(radius);
            for (const tank of tanks) {
              if (at[1] + size[1] / 2 <= 0.6 * scale) continue;
              const dx = Math.max(0, Math.abs(at[0] - tank.x * scale) - size[0] / 2);
              const dz = Math.max(0, Math.abs(at[2] - tank.z * scale) - size[2] / 2);
              expect(Math.hypot(dx, dz)).toBeGreaterThan(tank.scale * 0.42 * scale);
            }
          }
          // Includes fallen lid, shards, and corpse/spill cluster on the front apron.
          for (const tank of tanks)
            expect((Math.hypot(tank.x, tank.z) + tank.scale * 1.1) * scale).toBeLessThan(radius);
          expect(3.6 * scale).toBeLessThan(radius);
        }
  });
  it("gives every layout all three damage states without randomness on rerender", () => {
    expect(
      new Set(Array.from({ length: 9 }, (_, seed) => JSON.stringify(baseAppearance(seed)))).size,
    ).toBe(9);
    for (let seed = 0; seed < 9; seed++)
      expect(modularBasePlan("forest", seed, 5, true)).toEqual(
        modularBasePlan("forest", seed, 5, true),
      );
  });
  it("actually distributes all layout and condition families through the campaign", () => {
    const appearances = Array.from({ length: 30 }, (_, i) => {
      const outposts = createWorld(getLevel(i + 1))
        .outposts.filter((o) => !o.interior && o.radius >= 3.2)
        .sort((a, b) => b.radius - a.radius || a.id - b.id);
      return outposts[0] ? baseAppearance(baseSeed(outposts[0])) : null;
    }).filter((a) => a !== null);
    expect(new Set(appearances.map((a) => a.layout)).size).toBe(3);
    expect(new Set(appearances.map((a) => a.condition)).size).toBe(3);
  });
  it("produces stable layouts and distinct climate treatments", () => {
    const plans = biomes.map((biome) => modularBasePlan(biome, 2, 5));
    expect(new Set(plans.map((plan) => JSON.stringify(plan))).size).toBe(6);
    expect(modularBasePlan("forest", 2, 5)).toEqual(plans[0]);
    expect(modularBasePlan("forest", 0, 5)).not.toEqual(plans[0]);
  });
});
