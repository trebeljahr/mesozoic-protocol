import { describe, expect, it } from "vitest";
import type { AuthoredLake, RiverPoint } from "../sim/types";
import {
  anchorRiverEnd,
  findLakeMouth,
  findSelfIntersection,
  isOnLake,
  isSelfIntersecting,
  lakeNorm,
  segmentsCross,
  snapIntoLake,
  wouldSelfIntersect,
} from "./editorCore";

const p = (x: number, y: number): RiverPoint => ({ x, y });
const BOUNDS = { halfW: 20, halfH: 15 };

const lake = (over: Partial<AuthoredLake> = {}): AuthoredLake => ({
  id: "l1",
  pos: { x: 0, y: 0 },
  rx: 6,
  ry: 4,
  rot: 0,
  material: "water",
  ...over,
});

describe("segmentsCross", () => {
  it("detects a plain X crossing", () => {
    expect(segmentsCross(p(-1, 0), p(1, 0), p(0, -1), p(0, 1))).toBe(true);
  });

  it("ignores disjoint segments", () => {
    expect(segmentsCross(p(-1, 0), p(1, 0), p(-1, 3), p(1, 3))).toBe(false);
  });

  it("treats a collinear overlap as a crossing", () => {
    expect(segmentsCross(p(0, 0), p(4, 0), p(2, 0), p(6, 0))).toBe(true);
  });
});

describe("findSelfIntersection", () => {
  it("returns null for a clean meander", () => {
    expect(findSelfIntersection([p(-20, 0), p(-5, 4), p(5, -4), p(20, 2)])).toBeNull();
  });

  it("finds the crossing segment pair in a loop", () => {
    // Figure-eight: the last segment cuts back across the first.
    const pts = [p(0, 0), p(6, 0), p(6, 6), p(3, -3)];
    expect(findSelfIntersection(pts)).toEqual([0, 2]);
  });

  it("flags a hairpin that folds straight back over itself", () => {
    expect(isSelfIntersecting([p(0, 0), p(6, 0), p(1, 0.01)])).toBe(true);
  });

  it("allows a legitimate sharp bend", () => {
    expect(isSelfIntersecting([p(0, 0), p(6, 0), p(6, 6)])).toBe(false);
  });
});

describe("wouldSelfIntersect", () => {
  const drawn = [p(-20, 0), p(-4, 0), p(-4, 8)];

  it("accepts a point that keeps the polyline simple", () => {
    expect(wouldSelfIntersect(drawn, p(6, 8))).toBe(false);
  });

  it("rejects a point whose segment cuts an earlier one", () => {
    expect(wouldSelfIntersect(drawn, p(-10, -4))).toBe(true);
  });

  it("never rejects the very first real point", () => {
    expect(wouldSelfIntersect([p(-20, 0)], p(0, 0))).toBe(false);
  });
});

describe("lake geometry", () => {
  it("measures normalised distance in the rotated ellipse frame", () => {
    const l = lake();
    expect(lakeNorm(l, 0, 0)).toBeCloseTo(0);
    expect(lakeNorm(l, 6, 0)).toBeCloseTo(1);
    expect(lakeNorm(l, 0, 4)).toBeCloseTo(1);
    // Rotating by 90° swaps which axis the 6-unit half-axis points down.
    expect(lakeNorm(lake({ rot: Math.PI / 2 }), 0, 6)).toBeCloseTo(1);
  });

  it("blocks placement inside the rim, padded by the candidate radius", () => {
    const lakes = [lake()];
    expect(isOnLake(lakes, 0, 0, 0)).toBe(true);
    expect(isOnLake(lakes, 7, 0, 0)).toBe(false);
    expect(isOnLake(lakes, 7, 0, 1.5)).toBe(true);
  });

  it("captures a point at the shore and pulls it inside the rim", () => {
    const lakes = [lake()];
    const mouth = findLakeMouth(lakes, 7, 0);
    expect(mouth?.id).toBe("l1");
    // Far outside the mouth pad — no capture.
    expect(findLakeMouth(lakes, 14, 0)).toBeNull();
    const snapped = snapIntoLake(lakes[0], { x: 7, y: 0 });
    expect(lakeNorm(lakes[0], snapped.x, snapped.y)).toBeLessThan(1);
    // Direction of approach is preserved.
    expect(snapped.y).toBeCloseTo(0);
    expect(snapped.x).toBeGreaterThan(0);
  });

  it("leaves a point already well inside the lake alone", () => {
    const l = lake();
    expect(snapIntoLake(l, { x: 1, y: 0 })).toEqual({ x: 1, y: 0 });
  });
});

describe("anchorRiverEnd", () => {
  it("projects a free endpoint onto the nearest map edge", () => {
    expect(anchorRiverEnd({ x: 18, y: 3 }, [], BOUNDS)).toEqual({ x: 20, y: 3 });
    expect(anchorRiverEnd({ x: 2, y: -14 }, [], BOUNDS)).toEqual({ x: 2, y: -15 });
  });

  it("prefers a lake mouth over the map edge", () => {
    const l = lake({ pos: { x: 18, y: 0 }, rx: 3, ry: 3 });
    const anchored = anchorRiverEnd({ x: 19, y: 0 }, [l], BOUNDS);
    expect(lakeNorm(l, anchored.x, anchored.y)).toBeLessThan(1);
    expect(anchored.x).not.toBe(20);
  });

  it("passes the point through when the adapter has no bounds and no lake", () => {
    expect(anchorRiverEnd({ x: 4, y: 4 }, [], null)).toEqual({ x: 4, y: 4 });
  });
});
