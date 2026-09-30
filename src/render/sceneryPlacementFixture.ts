import { createHash } from "node:crypto";
import { HQ_PAD_BLOCKER_RADIUS } from "../level";
import { getLevel } from "../levels";
import { createWorld, ROCK_FOOTPRINT, TREE_FOOTPRINT } from "../sim/world";
import { containmentSceneryBlockers } from "./containmentLayout";
import { prepareGroundPlacement } from "./groundPlacement";
import { prepareOuterPlacement } from "./outerSceneryPlacement";
// Ignore sub-microunit platform differences in trig results, while retaining
// ordered objects, asset URLs, counts and meaningful transform differences.
export const placementHash = (value: unknown) =>
  createHash("sha256")
    .update(
      JSON.stringify(value, (_key, item) => {
        if (typeof item !== "number") return item;
        if (!Number.isFinite(item)) throw new Error("Non-finite scenery fixture value");
        return Number(item.toFixed(6));
      }),
    )
    .digest("hex");

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

export const placementHashes = (id: number, seed: number) => {
  const { world, versions } = scenarios(id, seed);
  const ground = prepareGroundPlacement(world.biome, id + seed, world.paths);
  const outer = prepareOuterPlacement(world.biome, id + seed, world.paths);
  return versions.map(({ inner, outer: blockers }) => [
    placementHash(ground(inner)),
    placementHash(outer(blockers)),
  ]);
};
