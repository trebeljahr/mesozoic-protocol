import { describe, expect, it } from "vitest";
import { PATH_WIDTH } from "../level";
import { buildTerrainSurface, fluidDistance, pathDistance } from "./terrainSurfaceGeometry";

const rivers = [
  {
    points: [
      { x: -12, y: 0 },
      { x: 12, y: 0 },
    ],
    width: 2,
  },
];
const lakes = [{ x: 0, y: 0, rx: 3, ry: 2, rot: 0 }];
const paths = [
  [
    { x: 6, y: -12 },
    { x: 6, y: 12 },
  ],
];

describe("campaign terrain safety", () => {
  it("covers dry biomes with finite material weights and a readable flat lane", () => {
    const geometry = buildTerrainSurface(paths, [], [], "#cbd6dd", true);
    const pos = geometry.getAttribute("position");
    const weights = geometry.getAttribute("terrainSurface");
    const invalidVertices: number[] = [];
    let laneVertices = 0;
    let groundVertices = 0;
    for (let i = 0; i < pos.count; i++) {
      const weight = weights.getX(i);
      // Check every vertex without allocating hundreds of thousands of matchers.
      if (
        !(Math.abs(pos.getY(i) - 0.003) < 0.000005) ||
        weights.getY(i) !== 0 ||
        !(weight >= 0 && weight <= 1)
      )
        invalidVertices.push(i);
      const distance = pathDistance(pos.getX(i), -pos.getZ(i), paths);
      if (distance < PATH_WIDTH * 0.4) {
        if (weight !== 1) invalidVertices.push(i);
        laneVertices++;
      }
      if (distance > PATH_WIDTH * 2) {
        if (weight !== 0) invalidVertices.push(i);
        groundVertices++;
      }
    }
    expect(invalidVertices).toEqual([]);
    expect(laneVertices).toBeGreaterThan(100);
    expect(groundVertices).toBeGreaterThan(1000);
    geometry.dispose();
  });
  it("treats connected river and pool as a union, without internal shores", () => {
    expect(fluidDistance(0, 0, rivers, lakes)).toBeLessThan(-1.5);
    expect(fluidDistance(2, 0, rivers, lakes)).toBeLessThanOrEqual(-1);
    expect(fluidDistance(0, 3, rivers, lakes)).toBeGreaterThan(0);
  });
  it("keeps shared colour and texture coordinates continuous across triangles", () => {
    const geometry = buildTerrainSurface(paths, rivers, lakes, "#456252", true);
    const pos = geometry.getAttribute("position");
    const color = geometry.getAttribute("color");
    const uv = geometry.getAttribute("uv");
    const weights = geometry.getAttribute("terrainSurface");
    const seen = new Map<string, number[]>();
    const discontinuities: { vertex: number; component: number }[] = [];
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(5)}:${pos.getZ(i).toFixed(5)}`;
      const values = [
        color.getX(i),
        color.getY(i),
        color.getZ(i),
        uv.getX(i),
        uv.getY(i),
        weights.getX(i),
        weights.getY(i),
      ];
      const previous = seen.get(key);
      if (previous)
        values.forEach((v, j) => {
          if (!(Math.abs(v - previous[j]) < 0.00005)) {
            discontinuities.push({ vertex: i, component: j });
          }
        });
      else seen.set(key, values);
    }
    expect(discontinuities).toEqual([]);
    expect(seen.size).toBeLessThan(pos.count / 2);
    geometry.dispose();
  });
  it("keeps every dry build surface and bridge approach flat with bounded geometry", () => {
    const geometry = buildTerrainSurface(paths, rivers, lakes, "#456252", true);
    const pos = geometry.getAttribute("position");
    expect(pos.count).toBeLessThan(180000);
    const invalidVertices: number[] = [];
    let raised = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = -pos.getZ(i),
        h = pos.getY(i);
      if (!Number.isFinite(h) || h > 0.03) invalidVertices.push(i);
      if (
        fluidDistance(x, y, rivers, lakes) >= 0 ||
        pathDistance(x, y, paths) <= PATH_WIDTH / 2 + 0.3
      ) {
        if (!(Math.abs(h - 0.003) < 0.000005)) invalidVertices.push(i);
      }
      if (h > 0.004) raised++;
    }
    expect(invalidVertices).toEqual([]);
    expect(raised).toBeGreaterThan(0);
    geometry.dispose();
  });
});
