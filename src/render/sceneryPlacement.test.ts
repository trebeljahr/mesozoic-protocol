import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HQ_PAD_BLOCKER_RADIUS } from "../level";
import { getLevel } from "../levels";
import { createWorld, ROCK_FOOTPRINT, TREE_FOOTPRINT } from "../sim/world";
import { containmentSceneryBlockers } from "./containmentLayout";
import { prepareGroundPlacement } from "./groundPlacement";
import { prepareOuterPlacement } from "./outerSceneryPlacement";
import { memoizeCandidate } from "./sceneryCandidateCache";
// SHA-256 of JSON.stringify on the full ordered placement objects, generated
// from Ground/OuterScenery, refreshed for the dry/alien ground-cover layers. Includes
// URLs/specs, coordinates, scales, rotations and radii; excludes render IDs.
import expected from "./sceneryPlacement.fixture.json";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const scenarios = (id: number, seed: number) => {
  const world = createWorld(getLevel(id));
  world.proceduralSeed = seed;
  const fixed = [
    ...world.outposts.map((o) => ({ pos: o.pos, radius: o.radius })),
    ...world.paths
      .filter((p) => p.length > 1)
      .map((p) => ({ pos: p[p.length - 1], radius: HQ_PAD_BLOCKER_RADIUS })),
  ];
  const versions = [0, 1, 2, 5, 10, Infinity, 0].map((removed) => {
    const trees = world.trees.slice(removed);
    const rocks = world.rocks.slice(removed);
    return {
      inner: [
        ...trees.map((t) => ({ x: t.pos.x, y: t.pos.y, r: TREE_FOOTPRINT * t.scale })),
        ...rocks.map((r) => ({ x: r.pos.x, y: r.pos.y, r: ROCK_FOOTPRINT * r.scale })),
        ...fixed.map((b) => ({ x: b.pos.x, y: b.pos.y, r: b.radius })),
      ],
      outer: [
        ...containmentSceneryBlockers(world),
        ...world.outposts.map((o) => ({ pos: o.pos, radius: o.radius })),
        ...trees.map((t) => ({ pos: t.pos, radius: 0.85 * t.scale })),
        ...rocks.map((r) => ({ pos: r.pos, radius: 0.7 * r.scale })),
        ...world.paths
          .filter((p) => p.length > 1)
          .map((p) => ({ pos: p[p.length - 1], radius: HQ_PAD_BLOCKER_RADIUS })),
      ],
    };
  });
  return { world, versions };
};

describe("scenery candidate replay", () => {
  it.each(expected)("matches recorded placements for level $id seed $seed", ({
    id,
    seed,
    hashes,
  }) => {
    const { world, versions } = scenarios(id, seed);
    const ground = prepareGroundPlacement(world.biome, id + seed, world.paths);
    const outer = prepareOuterPlacement(world.biome, id + seed, world.paths);
    const results = versions.map(({ inner, outer: blockers }) => [
      hash(ground(inner)),
      hash(outer(blockers)),
    ]);
    expect(results).toEqual(hashes);
    expect(results.at(-1)).toEqual(results[0]); // Reset restores the original sequence.
  });

  it("rechecks live blockers rather than freezing old placements", () => {
    expect(expected.some(({ hashes }) => hashes[0][0] !== hashes[5][0])).toBe(true);
    expect(expected.some(({ hashes }) => hashes[0][1] !== hashes[5][1])).toBe(true);
  });

  it("distinguishes candidates sharing an x coordinate", () => {
    const evaluate = memoizeCandidate((x, y) => x + y);
    expect(evaluate(1, 2)).toBe(3);
    expect(evaluate(1, 3)).toBe(4);
    expect(evaluate(1, 2)).toBe(3);
  });

  it("uses exact coordinates, caches false values, and survives eviction", () => {
    let calls = 0;
    const evaluate = memoizeCandidate((x, y) => {
      calls++;
      return x > y;
    }, 2);
    expect(evaluate(1, 1)).toBe(false);
    expect(evaluate(1, 1)).toBe(false);
    expect(calls).toBe(1);
    expect(evaluate(1 + Number.EPSILON, 1)).toBe(true);
    expect(evaluate(2, 1)).toBe(true);
    expect(evaluate(1, 1)).toBe(false);
    expect(calls).toBe(4);
  });
});
