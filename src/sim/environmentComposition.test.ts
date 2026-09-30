import { describe, expect, it } from "vitest";
import { BIOME_LAYERS } from "../biomes";
import { buildFlowFeatures, hasFlowFeatures, isOnFlowSurface } from "../flowGeometry";
import { HQ_PAD_BLOCKER_RADIUS, PATH_WIDTH } from "../level";
import { getLevel } from "../levels";
import { composeEnvironment, compositionDensity, compositionSeeds } from "./environmentComposition";
import { levelLandscape } from "./levelLandscape";
import { distPointToSegSq } from "./vec2";
import { createWorld, TREE_CLEARANCE_MARGIN, TREE_FOOTPRINT, TREE_MIN_SPACING } from "./world";

const levels = [1, 4, 5, 8, 10, 11, 13, 15, 18, 20, 23, 25, 28, 30];

describe("composed playable scenery", () => {
  it("does not leave an obstacle from a disabled forest stone layer", () => {
    const w = createWorld(getLevel(4));
    expect(w.rocks.length).toBeGreaterThan(0); // Clearable shrubs remain.
    expect(w.rocks.every((r) => BIOME_LAYERS[w.biome][r.layerIndex].count > 0)).toBe(true);
    expect(
      w.rocks.some((r) => BIOME_LAYERS[w.biome][r.layerIndex].urls.some((url) => /Rock/.test(url))),
    ).toBe(false);
  });
  it.each(levels)("preserves lane, water, HQ and compound clearances in level %i", (id) => {
    const w = createWorld(getLevel(id));
    const flow = hasFlowFeatures(w.biome) ? buildFlowFeatures(w.paths, id, w.biome) : null;
    const items = [
      ...w.trees.map((t) => ({
        pos: t.pos,
        radius: TREE_FOOTPRINT,
        clearance: PATH_WIDTH / 2 + TREE_CLEARANCE_MARGIN,
      })),
      ...w.rocks.map((r) => {
        const spec = BIOME_LAYERS[w.biome][r.layerIndex];
        return {
          pos: r.pos,
          radius: (spec.footprint ?? 0.65) * spec.maxScale,
          clearance: spec.clearance,
        };
      }),
    ];
    expect(items.length).toBeGreaterThan(5);
    for (const item of items) {
      expect(isOnFlowSurface(flow, item.pos.x, item.pos.y, item.radius)).toBe(false);
      for (const path of w.paths) {
        for (let i = 1; i < path.length; i++) {
          expect(
            distPointToSegSq(
              item.pos.x,
              item.pos.y,
              path[i - 1].x,
              path[i - 1].y,
              path[i].x,
              path[i].y,
            ),
          ).toBeGreaterThanOrEqual(item.clearance ** 2 - 1e-8);
        }
        const hq = path[path.length - 1];
        expect(Math.hypot(item.pos.x - hq.x, item.pos.y - hq.y)).toBeGreaterThanOrEqual(
          HQ_PAD_BLOCKER_RADIUS + item.radius - 1e-8,
        );
      }
      for (const o of w.outposts)
        expect(Math.hypot(item.pos.x - o.pos.x, item.pos.y - o.pos.y)).toBeGreaterThanOrEqual(
          o.radius + item.radius - 1e-8,
        );
    }
    for (let i = 0; i < w.trees.length; i++)
      for (let j = 0; j < i; j++) {
        expect(
          Math.hypot(w.trees[i].pos.x - w.trees[j].pos.x, w.trees[i].pos.y - w.trees[j].pos.y),
        ).toBeGreaterThanOrEqual(TREE_MIN_SPACING - 1e-8);
      }
  });

  it.each([
    4, 8, 13, 18, 23, 28,
  ])("reproduces scenery and leaves negative space in level %i", (id) => {
    const a = createWorld(getLevel(id)),
      b = createWorld(getLevel(id));
    expect(a.trees).toEqual(b.trees);
    expect(a.rocks).toEqual(b.rocks);
    const flow = hasFlowFeatures(a.biome) ? buildFlowFeatures(a.paths, id, a.biome) : null;
    const field = levelLandscape(id, a.biome, flow);
    const masses = composeEnvironment(a.paths, a.biome, field);
    expect(masses.some((m) => m.kind === "grove")).toBe(true);
    expect(masses.some((m) => m.kind === "formation")).toBe(true);
    for (const tree of a.trees)
      expect(compositionDensity(masses, "canopy", tree.pos.x, tree.pos.y)).toBeGreaterThan(0);
    let empty = 0;
    for (let y = -12; y <= 12; y += 2)
      for (let x = -20; x <= 20; x += 2) {
        if (
          compositionDensity(masses, "groundCover", x, y) === 0 &&
          compositionDensity(masses, "rock", x, y) === 0
        )
          empty++;
      }
    expect(empty).toBeGreaterThan(65);
    const reseeded = composeEnvironment(a.paths, a.biome, levelLandscape(id + 137, a.biome, flow));
    expect(reseeded).not.toEqual(masses);
    expect(compositionSeeds(masses, "canopy")).toEqual(compositionSeeds(masses, "canopy"));
  });
});
