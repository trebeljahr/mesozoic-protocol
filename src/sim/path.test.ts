import { describe, expect, it } from "vitest";
import { LEVELS } from "../levels";
import {
  advanceAlongPath,
  pathLength,
  pathProgress,
  pickNearestPathProjection,
  prependLeadIn,
  prependLeadInToBounds,
  projectOnPath,
  smoothPath,
} from "./path";
import type { Vec2 } from "./types";
import { dist } from "./vec2";

// Every authored lane in the campaign, flattened. Path geometry is shared
// by the sim, the render ribbon, tower placement and the lava bridges, so
// a regression here silently desyncs all four.
const ALL_PATHS: { label: string; path: Vec2[] }[] = LEVELS.flatMap((level) =>
  level.paths.map((path, i) => ({ label: `L${level.id} lane ${i}`, path })),
);

const nearestDistance = (p: Vec2, pts: Vec2[]): number =>
  pts.reduce((best, q) => Math.min(best, dist(p, q)), Number.POSITIVE_INFINITY);

const longestSegment = (path: Vec2[]): number => {
  let longest = 0;
  for (let i = 0; i < path.length - 1; i++) longest = Math.max(longest, dist(path[i], path[i + 1]));
  return longest;
};

describe("smoothPath", () => {
  it("keeps every authored waypoint on the smoothed curve", () => {
    for (const { label, path } of ALL_PATHS) {
      const smoothed = smoothPath(path);
      for (const waypoint of path) {
        // Catmull-Rom is interpolating: each control point must still be
        // sampled exactly, otherwise the painted lane and the walked lane
        // drift apart at corners.
        expect(nearestDistance(waypoint, smoothed), label).toBeLessThan(1e-6);
      }
    }
  });

  it("produces a contiguous, finite polyline with the original endpoints", () => {
    for (const { label, path } of ALL_PATHS) {
      const smoothed = smoothPath(path);
      expect(smoothed.length, label).toBeGreaterThan(path.length);
      expect(dist(smoothed[0], path[0]), label).toBeLessThan(1e-6);
      expect(dist(smoothed[smoothed.length - 1], path[path.length - 1]), label).toBeLessThan(1e-6);

      const maxJump = longestSegment(path);
      for (let i = 0; i < smoothed.length - 1; i++) {
        const step = dist(smoothed[i], smoothed[i + 1]);
        expect(Number.isFinite(step), `${label} @${i}`).toBe(true);
        // No teleports: a subdivided step can never exceed the authored
        // segment it came from.
        expect(step, `${label} @${i}`).toBeLessThanOrEqual(maxJump);
      }
    }
  });

  it("returns a copy for degenerate inputs instead of throwing", () => {
    expect(smoothPath([])).toEqual([]);
    expect(smoothPath([{ x: 1, y: 2 }])).toEqual([{ x: 1, y: 2 }]);
  });
});

describe("advanceAlongPath", () => {
  it("walks each campaign lane end to end and reports the goal exactly", () => {
    for (const { label, path } of ALL_PATHS) {
      const smoothed = smoothPath(path);
      const total = pathLength(smoothed);
      expect(total, label).toBeGreaterThan(0);

      const step = 0.25;
      let segment = 0;
      let segmentT = 0;
      let travelled = 0;
      let finished = false;
      // Bounded so an infinite loop fails the test instead of hanging CI.
      const maxSteps = Math.ceil(total / step) + 10;
      for (let i = 0; i < maxSteps && !finished; i++) {
        const next = advanceAlongPath(smoothed, segment, segmentT, step);
        expect(Number.isFinite(next.pos.x) && Number.isFinite(next.pos.y), label).toBe(true);
        expect(Number.isFinite(next.segmentT), label).toBe(true);
        segment = next.segment;
        segmentT = next.segmentT;
        finished = next.finished;
        travelled += step;
      }

      expect(finished, `${label} never reached the goal`).toBe(true);
      // Total distance walked matches the lane length to within one step.
      expect(Math.abs(travelled - total), label).toBeLessThanOrEqual(step);
      const goal = path[path.length - 1];
      const end = advanceAlongPath(smoothed, segment, segmentT, step);
      expect(dist(end.pos, goal), label).toBeLessThan(1e-6);
    }
  });

  it("steps over coincident waypoints without producing NaN", () => {
    // Duplicated waypoints used to divide by zero and poison segmentT.
    const path: Vec2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    const r = advanceAlongPath(path, 0, 0, 1.5);
    expect(Number.isFinite(r.segmentT)).toBe(true);
    expect(r.pos).toEqual({ x: 1.5, y: 0 });
    expect(r.finished).toBe(false);
  });

  it("agrees with pathProgress on distance travelled", () => {
    const path: Vec2[] = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ];
    expect(pathLength(path)).toBeCloseTo(7);
    const r = advanceAlongPath(path, 0, 0, 5);
    expect(pathProgress(path, r.segment, r.segmentT)).toBeCloseTo(5);
  });
});

describe("lead-in prepending", () => {
  it("extends backwards along the first segment without moving the lane", () => {
    const path: Vec2[] = [
      { x: -20, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 6 },
    ];
    const out = prependLeadIn(path, 5);
    expect(out).toHaveLength(path.length + 1);
    expect(out.slice(1)).toEqual(path);
    expect(out[0]).toEqual({ x: -25, y: 0 });
  });

  it("extends to the camera-entry bounds and stays behind the spawn", () => {
    const path: Vec2[] = [
      { x: -20, y: 3 },
      { x: 0, y: 3 },
    ];
    const out = prependLeadInToBounds(path, 26.5, 19);
    expect(out).toHaveLength(3);
    expect(out.slice(1)).toEqual(path);
    expect(out[0].x).toBeCloseTo(-26.5);
    expect(out[0].y).toBeCloseTo(3);
  });

  it("leaves degenerate paths untouched", () => {
    const single = [{ x: 1, y: 1 }];
    expect(prependLeadIn(single, 5)).toEqual(single);
    expect(prependLeadInToBounds(single, 26.5, 19)).toEqual(single);
  });
});

describe("projectOnPath", () => {
  it("returns the foot of the perpendicular and a signed lateral offset", () => {
    const path: Vec2[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const left = projectOnPath(path, { x: 4, y: 2 });
    expect(left.pos).toEqual({ x: 4, y: 0 });
    expect(left.segment).toBe(0);
    expect(left.segmentT).toBeCloseTo(0.4);
    const right = projectOnPath(path, { x: 4, y: -2 });
    expect(right.pos).toEqual({ x: 4, y: 0 });
    // Opposite sides of the lane must produce opposite signs — the robot's
    // lateral offset and the swarm lane spread share this axis.
    expect(Math.sign(left.lateralOffset)).toBe(-Math.sign(right.lateralOffset));
    expect(Math.abs(left.lateralOffset)).toBeCloseTo(2);
  });

  it("clamps to the ends rather than extrapolating", () => {
    const path: Vec2[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(projectOnPath(path, { x: -50, y: 0 }).pos).toEqual({ x: 0, y: 0 });
    expect(projectOnPath(path, { x: 50, y: 0 }).pos).toEqual({ x: 10, y: 0 });
  });

  it("picks the nearest lane on a multi-path level", () => {
    const lanes: Vec2[][] = [
      [
        { x: 0, y: 5 },
        { x: 10, y: 5 },
      ],
      [
        { x: 0, y: -5 },
        { x: 10, y: -5 },
      ],
    ];
    expect(pickNearestPathProjection(lanes, { x: 5, y: -4 }).pathIndex).toBe(1);
    expect(pickNearestPathProjection(lanes, { x: 5, y: 4 }).pathIndex).toBe(0);
  });
});
