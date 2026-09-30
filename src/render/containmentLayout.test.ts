import { describe, expect, it } from "vitest";
import { isOnFlowSurface } from "../flowGeometry";
import { getLevel } from "../levels";
import { createWorld } from "../sim/world";
import {
  hasMarshContainment,
  hasMarshPerimeter,
  MARSH_WALLS,
  wallClearsRoutes,
} from "./containmentLayout";

describe("Marsh containment architecture", () => {
  it("keeps every solid wall outside pilot movement and clear of smoothed lanes in both modes", () => {
    for (const mode of ["normal", "breach"] as const) {
      const world = createWorld(getLevel(4), mode);
      expect(hasMarshContainment(world)).toBe(true);
      expect(hasMarshPerimeter(world.outposts)).toBe(true);
      for (const wall of MARSH_WALLS) {
        expect(wallClearsRoutes(wall, world.paths), wall.id).toBe(true);
        for (let t = 0; t <= 1; t += 0.02) {
          expect(
            isOnFlowSurface(
              world.flowFeatures,
              wall.from.x + (wall.to.x - wall.from.x) * t,
              wall.from.y + (wall.to.y - wall.from.y) * t,
              0.65,
            ),
            wall.id,
          ).toBe(false);
        }
      }
      // The larger visual replaces a colony whose reservation already exists.
      const lab = world.outposts.find((o) => o.interior);
      expect(lab).toBeDefined();
      expect(Math.hypot(2.9, 2.4)).toBeLessThan(lab!.radius);
    }
  });

  it("leaves the actual west entry open and rejects a wall if a later path crosses it", () => {
    const world = createWorld(getLevel(4));
    const closedGate = {
      id: "invalid",
      from: { x: -21.1, y: -11 },
      to: { x: -21.1, y: -5 },
      height: 4,
    };
    expect(wallClearsRoutes(closedGate, world.paths)).toBe(false);
    expect(
      wallClearsRoutes(MARSH_WALLS[1], [
        [
          { x: -25, y: 9 },
          { x: -18, y: 9 },
        ],
      ]),
    ).toBe(false);
    expect(wallClearsRoutes({ ...closedGate, from: { x: 0, y: -2 }, to: { x: 0, y: 2 } }, [])).toBe(
      false,
    );
  });

  it("honors editor replacement, reseeding, parent erasure and other levels", () => {
    const world = createWorld(getLevel(4));
    expect(hasMarshContainment({ ...world, overrideActive: true })).toBe(false);
    expect(hasMarshContainment({ ...world, proceduralSeed: 13 })).toBe(false);
    expect(hasMarshContainment({ ...world, levelId: 5 })).toBe(false);
    expect(hasMarshPerimeter(world.outposts.filter((o) => o.pos.x >= -20))).toBe(false);
  });
});
