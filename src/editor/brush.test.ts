import { describe, expect, it } from "vitest";
import { footprintArea, patchAreaBudget, pickThinTargets, samplePoints } from "./brush";

describe("brush density model", () => {
  it("scales the fill budget with disc area", () => {
    // Doubling the radius quadruples what a patch may hold, so one "Max
    // fill" setting reads the same at any brush size.
    expect(patchAreaBudget(8, 50) / patchAreaBudget(4, 50)).toBeCloseTo(4);
  });

  it("clamps fill percent into [0, 100]", () => {
    expect(patchAreaBudget(4, -20)).toBe(0);
    expect(patchAreaBudget(4, 500)).toBeCloseTo(Math.PI * 16);
  });

  it("needs many passes to fill a patch at a small per-pass count", () => {
    // The accumulation guarantee: one tick of 3 trees can't reach the
    // ceiling of a radius-4 disc at 55% fill, so painting builds up.
    const budget = patchAreaBudget(4, 55);
    const treeArea = footprintArea(1.2);
    expect(3 * treeArea).toBeLessThan(budget);
    expect(Math.ceil(budget / treeArea)).toBeGreaterThan(3);
  });

  it("honours an explicit attempts budget independent of per-pass count", () => {
    expect(samplePoints({ x: 0, y: 0 }, 4, 2, 48)).toHaveLength(48);
    expect(samplePoints({ x: 0, y: 0 }, 4, 2)).toHaveLength(32);
  });

  it("keeps sampled points inside the disc", () => {
    for (const p of samplePoints({ x: 5, y: -3 }, 2, 4, 200)) {
      expect(Math.hypot(p.x - 5, p.y + 3)).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it("thins at most `count` instances, biased toward the patch centre", () => {
    const items = [
      { id: "near", x: 0.1, y: 0 },
      { id: "mid", x: 2, y: 0 },
      { id: "far", x: 3.9, y: 0 },
    ];
    const picked = pickThinTargets(items, (i) => i, { x: 0, y: 0 }, 4, 2);
    expect(picked).toHaveLength(2);
    // Jitter is 0.6 of a normalised radius; "near" (0.025) can never lose
    // to "far" (0.975), so the nearest instance is always a target.
    expect(picked.map((i) => i.id)).toContain("near");
    expect(pickThinTargets(items, (i) => i, { x: 0, y: 0 }, 4, 0)).toHaveLength(0);
    expect(pickThinTargets(items, (i) => i, { x: 0, y: 0 }, 4, 99)).toHaveLength(3);
  });
});
