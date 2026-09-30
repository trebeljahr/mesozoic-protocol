import { describe, expect, it } from "vitest";
import { HQ_PAD_BLOCKER_RADIUS, PATH_WIDTH } from "../level";
import { LEVELS } from "../levels";
import { distToSegmentSq } from "../sim/vec2";
import { createWorld } from "../sim/world";
import { commandComplexPlan, HQ_GUN_DECK_HEIGHT } from "./commandBaseLayout";
import { commandBuildingPlan } from "./commandBuildingPlan";
import { linkedCommandGroups, sharedCommandGeometry } from "./sharedCommandGeometry";

describe("unified research command complexes", () => {
  it("replaces individual foundations with one shared apron, research halls, broad wings and tanks", () => {
    for (const spacing of [5, 6, 8])
      for (const count of [2, 3]) {
        const paths = Array.from({ length: count }, (_, i) => [
          { x: i * spacing, y: -12 },
          { x: i * spacing, y: 0 },
        ]);
        const complex = commandComplexPlan(paths),
          geometry = sharedCommandGeometry(complex, paths, "forest");
        expect(linkedCommandGroups(complex)).toHaveLength(1);
        expect(geometry.panels.filter((p) => p.feature === "hall")).toHaveLength(count - 1);
        expect(
          geometry.panels.filter((p) => p.size[1] === 0.18).every((p) => p.size[0] >= 0.9),
        ).toBe(true);
        expect(geometry.tanks.length).toBeGreaterThanOrEqual(count - 1);
        expect(geometry.panels.some((p) => p.role === "perimeter")).toBe(true);
        const battery = commandBuildingPlan("forest", 0, true);
        expect(battery.some((p) => p.size[0] === 5.8)).toBe(false);
        const cap = battery.find((p) => p.size[0] === 2.5)!;
        expect(cap.at[1] + cap.size[1] / 2).toBeCloseTo(HQ_GUN_DECK_HEIGHT);
      }
  });
  it("keeps shared structures, specimen pads and outer walls inside reserved ground and off gameplay lanes", () => {
    let checked = 0;
    for (const level of LEVELS) {
      const world = createWorld(level),
        complex = commandComplexPlan(world.paths);
      if (!complex.links.length) continue;
      checked++;
      const geometry = sharedCommandGeometry(complex, world.paths, world.biome);
      expect(geometry.panels.filter((p) => p.feature === "hall")).toHaveLength(
        complex.links.length,
      );
      for (const panel of geometry.panels) {
        const stepsX = Math.max(2, Math.ceil(panel.size[0] / 0.18));
        const stepsZ = Math.max(2, Math.ceil(panel.size[2] / 0.18));
        for (let i = 0; i <= stepsX; i++)
          for (let j = 0; j <= stepsZ; j++) {
            const x = panel.size[0] * (i / stepsX - 0.5),
              z = panel.size[2] * (j / stepsZ - 0.5);
            const p = {
              x: panel.at[0] + x * Math.cos(panel.yaw) + z * Math.sin(panel.yaw),
              y: -panel.at[2] + x * Math.sin(panel.yaw) - z * Math.cos(panel.yaw),
            };
            expect(
              complex.poses.some(
                (h) => Math.hypot(p.x - h.end.x, p.y - h.end.y) < HQ_PAD_BLOCKER_RADIUS,
              ),
            ).toBe(true);
            if (panel.role === "floor") continue;
            expect(
              world.paths.every((path) =>
                path
                  .slice(1)
                  .every((end, k) => distToSegmentSq(p, path[k], end) >= (PATH_WIDTH / 2) ** 2),
              ),
            ).toBe(true);
          }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });
});
