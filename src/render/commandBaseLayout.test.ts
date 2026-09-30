import { describe, expect, it } from "vitest";
import { HQ_PAD_BLOCKER_RADIUS, PATH_WIDTH } from "../level";
import { LEVELS } from "../levels";
import { distToSegmentSq } from "../sim/vec2";
import { createWorld } from "../sim/world";
import { commandComplexPlan, HQ_CONNECTOR_WIDTH, HQ_GUN_DECK_HEIGHT } from "./commandBaseLayout";
import { commandBuildingPlan } from "./commandBuildingPlan";

const route = (y: number) => [
  { x: 0, y },
  { x: 20, y },
];
describe("connected command outposts", () => {
  it("connects nearby pairs and triples into a tree while retaining each endpoint", () => {
    for (const gap of [5, 6, 8]) {
      const paths = [route(-gap), route(0), route(gap)];
      const plan = commandComplexPlan(paths);
      expect(plan.links).toHaveLength(2);
      expect(new Set(plan.poses.map((p) => p.group)).size).toBe(1);
      expect(plan.poses.map((p) => p.end)).toEqual(paths.map((p) => p[1]));
    }
  });
  it("keeps distant bases independent and co-locates coincident path-end architecture", () => {
    expect(commandComplexPlan([route(-7), route(7)]).links).toHaveLength(0);
    expect(commandComplexPlan([route(0), route(0)]).poses).toHaveLength(1);
    expect(commandComplexPlan([[], [{ x: 1, y: 2 }]])).toEqual({ poses: [], links: [] });
  });
  it("rejects a connecting gallery when another route passes through its footprint", () => {
    const paths = [
      route(-3),
      route(3),
      [
        { x: 21.7, y: -10 },
        { x: 21.7, y: 10 },
      ],
    ];
    expect(commandComplexPlan(paths).links).toHaveLength(0);
  });
  it("connects campaign HQs without extending reservations or covering a lane", () => {
    let linkedLevels = 0;
    for (const level of LEVELS) {
      const paths = createWorld(level).paths;
      const plan = commandComplexPlan(paths);
      if (plan.links.length) linkedLevels++;
      for (const link of plan.links) {
        const dx = link.b.x - link.a.x,
          dy = link.b.y - link.a.y,
          length = Math.hypot(dx, dy);
        for (let i = 0; i <= 500; i++)
          for (const side of [-1, 1]) {
            const point = {
              x: link.a.x + (dx * i) / 500 - ((dy / length) * side * HQ_CONNECTOR_WIDTH) / 2,
              y: link.a.y + (dy * i) / 500 + ((dx / length) * side * HQ_CONNECTOR_WIDTH) / 2,
            };
            expect(
              plan.poses.some(
                (p) => Math.hypot(p.end.x - point.x, p.end.y - point.y) <= HQ_PAD_BLOCKER_RADIUS,
              ),
            ).toBe(true);
            for (const path of paths)
              for (let j = 1; j < path.length; j++)
                expect(distToSegmentSq(point, path[j - 1], path[j])).toBeGreaterThanOrEqual(
                  (PATH_WIDTH / 2) ** 2,
                );
          }
      }
    }
    expect(linkedLevels).toBeGreaterThanOrEqual(3);
  });
  it("keeps all four main-base designs inside the existing reservation and preserves the gun deck", () => {
    const shapes = new Set<string>();
    for (let variant = 0; variant < 4; variant++) {
      const blocks = commandBuildingPlan("forest", variant);
      shapes.add(JSON.stringify(blocks));
      for (const b of blocks)
        expect(
          Math.hypot(Math.abs(b.at[0]) + b.size[0] / 2, Math.abs(b.at[2]) + b.size[2] / 2),
        ).toBeLessThan(HQ_PAD_BLOCKER_RADIUS);
      const deck = blocks.find((b) => b.size[0] === 2.5 && b.size[1] === 0.12)!;
      expect(deck.at[0]).toBe(0);
      expect(deck.at[2]).toBe(0);
      expect(deck.at[1] + deck.size[1] / 2).toBeCloseTo(HQ_GUN_DECK_HEIGHT);
    }
    expect(shapes.size).toBe(4);
  });
});
