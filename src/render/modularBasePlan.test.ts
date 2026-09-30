import { describe, expect, it } from "vitest";
import type { Biome } from "../biomes";
import { modularBasePlan } from "./modularBasePlan";

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
  it("produces stable layouts and distinct climate treatments", () => {
    const plans = biomes.map((biome) => modularBasePlan(biome, 2, 5));
    expect(new Set(plans.map((plan) => JSON.stringify(plan))).size).toBe(6);
    expect(modularBasePlan("forest", 2, 5)).toEqual(plans[0]);
    expect(modularBasePlan("forest", 0, 5)).not.toEqual(plans[0]);
  });
});
