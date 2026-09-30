import { describe, expect, it } from "vitest";
import { buildFlowFeatures, hasFlowFeatures, isOnFlowSurface } from "../flowGeometry";
import { MAP_HEIGHT, MAP_WIDTH, PATH_WIDTH } from "../level";
import { getLevel } from "../levels";
import { distPointToSegSq } from "../sim/vec2";
import { createWorld } from "../sim/world";
import { buildCliffs } from "./cliffPlacement";

describe("biome escarpments", () => {
  it.each([
    11, 13, 15, 16, 18, 20, 26, 28, 30,
  ])("keeps level %i cliffs outside play, roads and water", (id) => {
    const world = createWorld(getLevel(id));
    const { biome, paths } = world;
    const rocks = buildCliffs(biome, id, paths);
    expect(rocks.length).toBeGreaterThan(0);
    expect(buildCliffs(biome, id, paths)).toEqual(rocks);
    const flow = hasFlowFeatures(biome) ? buildFlowFeatures(paths, id, biome) : null;
    for (const rock of rocks) {
      expect(
        Math.abs(rock.pos.x) - rock.radius >= MAP_WIDTH / 2 ||
          Math.abs(rock.pos.y) - rock.radius >= MAP_HEIGHT / 2,
      ).toBe(true);
      expect(isOnFlowSurface(flow, rock.pos.x, rock.pos.y, rock.radius)).toBe(false);
      for (const path of paths)
        for (let i = 1; i < path.length; i++) {
          expect(
            distPointToSegSq(
              rock.pos.x,
              rock.pos.y,
              path[i - 1].x,
              path[i - 1].y,
              path[i].x,
              path[i].y,
            ),
          ).toBeGreaterThan((rock.radius + PATH_WIDTH / 2) ** 2);
        }
    }
  });
  it("keeps rock silhouettes clear of outer bases", () => {
    const rocks = buildCliffs("desert", 13, []);
    const base = { pos: rocks[0].pos, radius: 3 };
    const remaining = buildCliffs("desert", 13, [], [base]);
    expect(remaining.length).toBeLessThan(rocks.length);
    for (const rock of remaining) {
      expect(Math.hypot(rock.pos.x - base.pos.x, rock.pos.y - base.pos.y)).toBeGreaterThanOrEqual(
        base.radius + rock.radius + 0.5,
      );
    }
  });
  it("does not add cliffs to other biomes", () => {
    expect(buildCliffs("forest", 1, [])).toEqual([]);
    expect(buildCliffs("snow", 6, [])).toEqual([]);
    expect(buildCliffs("lava", 21, [])).toEqual([]);
  });
});
