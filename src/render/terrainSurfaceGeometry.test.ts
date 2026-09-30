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
    let laneVertices = 0;
    let groundVertices = 0;
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeCloseTo(0.003, 5);
      expect(weights.getY(i)).toBe(0);
      expect(weights.getX(i)).toBeGreaterThanOrEqual(0);
      expect(weights.getX(i)).toBeLessThanOrEqual(1);
      const distance = pathDistance(pos.getX(i), -pos.getZ(i), paths);
      if (distance < PATH_WIDTH * 0.4) {
        expect(weights.getX(i)).toBe(1);
        laneVertices++;
      }
      if (distance > PATH_WIDTH * 2) {
        expect(weights.getX(i)).toBe(0);
        groundVertices++;
      }
    }
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
          expect(v).toBeCloseTo(previous[j], 4);
        });
      else seen.set(key, values);
    }
    expect(seen.size).toBeLessThan(pos.count / 2);
    geometry.dispose();
  });
  it("keeps every dry build surface and bridge approach flat with bounded geometry", () => {
    const geometry = buildTerrainSurface(paths, rivers, lakes, "#456252", true);
    const pos = geometry.getAttribute("position");
    expect(pos.count).toBeLessThan(180000);
    let raised = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = -pos.getZ(i),
        h = pos.getY(i);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeLessThanOrEqual(0.03);
      if (
        fluidDistance(x, y, rivers, lakes) >= 0 ||
        pathDistance(x, y, paths) <= PATH_WIDTH / 2 + 0.3
      ) {
        expect(h).toBeCloseTo(0.003, 5);
      }
      if (h > 0.004) raised++;
    }
    expect(raised).toBeGreaterThan(0);
    geometry.dispose();
  });
});
