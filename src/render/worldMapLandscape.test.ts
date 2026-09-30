import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { biomeForPos, classifyPropUrl } from "../biomes";
import { LEVELS } from "../levels";
import { emptyProgress } from "../progress";
import {
  MAP_FACILITIES,
  MAP_HABITATS,
  MAP_LAKES,
  MAP_ROUTES,
  mapBiome,
  mapBiomeWeights,
  mapNodeDistance,
  mapRouteDistance,
  mapShoreDistance,
} from "./worldMapLandscape";
import { mapLevelPosition } from "./worldMapLayout";

vi.mock("@react-three/drei", () => ({ useGLTF: { preload: () => {} } }));

import { isDeadDinoUrl } from "./DeadDinos";
import {
  mapPropRadius,
  mapPropTargetSize,
  propPlan,
  worldMapProceduralItems,
} from "./worldMapPropPlan";

const fresh = emptyProgress();
const props = Object.values(propPlan(fresh)).flat();

describe("world map landscape", () => {
  it("normalizes snow pines as trees rather than cosmetic props", () => {
    expect(mapPropTargetSize("/models/natural/SnowPine1.glb")).toBe(
      mapPropTargetSize("/models/natural/Tree1.glb"),
    );
    expect(mapPropTargetSize("/models/natural/SnowPine1.glb")).toBeGreaterThan(2);
  });
  it("keeps every route attached to its level and preserves level habitat identity", () => {
    for (let i = 0; i < MAP_ROUTES.length; i++) {
      expect(MAP_ROUTES[i][0]).toEqual(mapLevelPosition(LEVELS[i].id));
      expect(MAP_ROUTES[i].at(-1)).toEqual(mapLevelPosition(LEVELS[i + 1].id));
    }
    for (const level of LEVELS)
      expect(mapBiome(mapLevelPosition(level.id).x, mapLevelPosition(level.id).y)).toBe(
        biomeForPos(level.nodePos),
      );
  });
  it("forms distinct regions across longitude and keeps blending normalized", () => {
    expect(new Set([-30, -15, 0, 15, 30].map((x) => mapBiome(x, 10))).size).toBeGreaterThanOrEqual(
      3,
    );
    for (let y = -32; y <= 36; y += 4)
      for (let x = -40; x <= 40; x += 4) {
        const weights = mapBiomeWeights(x, y);
        expect(weights.every((w) => Number.isFinite(w) && w >= 0 && w <= 1)).toBe(true);
        expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
      }
    for (const a of LEVELS)
      for (const b of LEVELS) {
        if (a.id === b.id) continue;
        const p = mapLevelPosition(a.id),
          q = mapLevelPosition(b.id);
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(6);
      }
  });
  it("gives every region natural formations and one clear facility reservation", () => {
    expect(MAP_FACILITIES).toHaveLength(6);
    for (const f of MAP_FACILITIES) {
      expect(mapBiome(f.pos.x, f.pos.y)).toBe(f.biome);
      expect(mapNodeDistance(f.pos.x, f.pos.y)).toBeGreaterThan(f.radius + 3.1);
      expect(mapRouteDistance(f.pos.x, f.pos.y, false)).toBeGreaterThan(f.radius + 0.8);
      expect(MAP_HABITATS.some((h) => h.biome === f.biome)).toBe(true);
    }
    expect(props.length).toBeGreaterThan(200);
    expect(props.length).toBeLessThan(1800);
    expect(props.some((p) => classifyPropUrl(p.url) === "building")).toBe(false);
    for (const url of Object.keys(propPlan(fresh)))
      expect(existsSync(`public${url}`), url).toBe(true);
  });
  it("keeps full scenery silhouettes off route shoulders, labels and facilities", () => {
    for (const p of props) {
      const r = mapPropRadius(p.url, p.scale),
        x = p.pos.x,
        y = -p.pos.z;
      expect(mapShoreDistance(x, y)).toBeGreaterThanOrEqual(r + 0.4);
      expect(mapNodeDistance(x, y)).toBeGreaterThanOrEqual(r + 3.15);
      expect(mapRouteDistance(x, y)).toBeGreaterThanOrEqual(r + 0.8);
      for (const f of MAP_FACILITIES)
        expect(Math.hypot(f.pos.x - x, f.pos.y - y)).toBeGreaterThanOrEqual(f.radius + r + 0.3);
    }
    expect(new Set(worldMapProceduralItems(fresh).map((p) => p.key)).size).toBe(props.length);
  });
  it("keeps the full water footprints clear of campaign routes and markers", () => {
    for (const lake of MAP_LAKES) {
      const r = Math.max(lake.rx, lake.ry);
      expect(mapNodeDistance(lake.pos.x, lake.pos.y)).toBeGreaterThan(r + 3.1);
      expect(mapRouteDistance(lake.pos.x, lake.pos.y)).toBeGreaterThan(r + 0.8);
    }
  });
  it("keeps terrain props and editor keys fixed across campaign progress", () => {
    const cleared = emptyProgress();
    for (const level of LEVELS)
      cleared.starsByLevel[level.id] = { normal: 3, breach: 0, containment: 0 };
    const after = Object.values(propPlan(cleared))
      .flat()
      .filter((p) => !isDeadDinoUrl(p.url));
    expect(after).toEqual(props);
    expect(Object.values(propPlan(cleared)).flat().length).toBeGreaterThan(props.length);
  });
});
