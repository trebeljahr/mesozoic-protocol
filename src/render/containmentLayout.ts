import { MAP_HEIGHT, MAP_WIDTH, PATH_WIDTH } from "../level";
import type { Outpost, Vec2 } from "../sim/types";
import { distPointToSegSq } from "../sim/vec2";

export type ContainmentWall = {
  id: string;
  from: Vec2;
  to: Vec2;
  height: number;
  brokenStart?: boolean;
  brokenEnd?: boolean;
};

// Walls stay beyond the pilot's movement rectangle. The entry breach is
// centred on the existing west lane; the second opening admits the river.
// Author other scenes with the same wall component, not seed-wide scatter.
export const MARSH_WALLS: ContainmentWall[] = [
  {
    id: "entry-north",
    from: { x: -21.1, y: -4.7 },
    to: { x: -21.1, y: -1.6 },
    height: 4.2,
    brokenStart: true,
  },
  { id: "research-west", from: { x: -21.1, y: 4.8 }, to: { x: -21.1, y: 14.4 }, height: 4.2 },
  { id: "research-north", from: { x: -21.1, y: 14.4 }, to: { x: -7, y: 14.4 }, height: 4.2 },
  {
    id: "north-remnant",
    from: { x: -7, y: 14.4 },
    to: { x: 6.5, y: 14.4 },
    height: 3.5,
    brokenEnd: true,
  },
  {
    id: "entry-south",
    from: { x: -21.1, y: -15 },
    to: { x: -21.1, y: -11.4 },
    height: 3.4,
    brokenEnd: true,
  },
];

export const WALL_HALF_DEPTH = 0.65;

/** Reject whole wall runs if a future route edit would cross their solid silhouette. */
export const wallClearsRoutes = (wall: ContainmentWall, paths: Vec2[][]): boolean => {
  const length = Math.hypot(wall.to.x - wall.from.x, wall.to.y - wall.from.y);
  const steps = Math.ceil(length / 0.2);
  for (let n = 0; n <= steps; n++) {
    const t = n / steps;
    const x = wall.from.x + (wall.to.x - wall.from.x) * t;
    const y = wall.from.y + (wall.to.y - wall.from.y) * t;
    // Extra allowance covers buttresses and the sample interval.
    if (
      Math.abs(x) < MAP_WIDTH / 2 + WALL_HALF_DEPTH &&
      Math.abs(y) < MAP_HEIGHT / 2 + WALL_HALF_DEPTH
    )
      return false;
    for (const path of paths)
      for (let i = 1; i < path.length; i++) {
        if (
          distPointToSegSq(x, y, path[i - 1].x, path[i - 1].y, path[i].x, path[i].y) <
          (PATH_WIDTH / 2 + WALL_HALF_DEPTH + 0.4) ** 2
        )
          return false;
      }
  }
  return true;
};

export const hasMarshContainment = (world: {
  levelId: number;
  proceduralSeed: number;
  overrideActive: boolean;
}): boolean => world.levelId === 4 && world.proceduralSeed === 0 && !world.overrideActive;

// The perimeter belongs to the west outpost. Erasing that procedural parent
// also erases its architecture; editor replacement/reseeding uses normal kits.
export const hasMarshPerimeter = (outposts: Outpost[]): boolean =>
  outposts.some((o) => !o.interior && o.pos.x < -20 && o.pos.y > 4);

/** Cosmetic-only reservations: keep outer groves off the concrete itself. */
export const containmentSceneryBlockers = (world: {
  levelId: number;
  proceduralSeed: number;
  overrideActive: boolean;
  outposts: Outpost[];
  paths: Vec2[][];
}): { pos: Vec2; radius: number }[] => {
  if (!hasMarshContainment(world) || !hasMarshPerimeter(world.outposts)) return [];
  return MARSH_WALLS.filter((wall) => wallClearsRoutes(wall, world.paths)).flatMap((wall) => {
    const count = Math.ceil(Math.hypot(wall.to.x - wall.from.x, wall.to.y - wall.from.y));
    return Array.from({ length: count + 1 }, (_, i) => ({
      pos: {
        x: wall.from.x + ((wall.to.x - wall.from.x) * i) / count,
        y: wall.from.y + ((wall.to.y - wall.from.y) * i) / count,
      },
      radius: 1.2,
    }));
  });
};
