import { type Biome, biomeForPos } from "../biomes";
import { lakeDistance } from "../lakeShape";
import { LEVELS } from "../levels";
import { mulberry32 } from "../sim/random";
import type { AuthoredLake, Vec2 } from "../sim/types";
import { distPointToSegSq } from "../sim/vec2";
import { mapLevelPosition } from "./worldMapLayout";

// One route definition for rendering, terrain shoulders and scenery exclusion.
export const MAP_ROUTES = LEVELS.slice(0, -1).map((level, index) => {
  const a = mapLevelPosition(level.id);
  const b = mapLevelPosition(LEVELS[index + 1].id);
  const previous = mapLevelPosition(LEVELS[Math.max(0, index - 1)].id);
  const next = mapLevelPosition(LEVELS[Math.min(LEVELS.length - 1, index + 2)].id);
  // Matching tangents through outposts round the switchbacks without moving
  // route endpoints or creating sharp corners at region connections.
  const c = { x: a.x + (b.x - previous.x) * 0.17, y: a.y + (b.y - previous.y) * 0.17 };
  const d = { x: b.x - (next.x - a.x) * 0.17, y: b.y - (next.y - a.y) * 0.17 };
  return Array.from({ length: 25 }, (_, i) => {
    const t = i / 24,
      s = 1 - t;
    return {
      x: s ** 3 * a.x + 3 * s * s * t * c.x + 3 * s * t * t * d.x + t ** 3 * b.x,
      y: s ** 3 * a.y + 3 * s * s * t * c.y + 3 * s * t * t * d.y + t ** 3 * b.y,
    };
  });
});
const routeBounds = MAP_ROUTES.map((path) => ({
  minX: Math.min(...path.map((p) => p.x)),
  maxX: Math.max(...path.map((p) => p.x)),
  minY: Math.min(...path.map((p) => p.y)),
  maxY: Math.max(...path.map((p) => p.y)),
}));
export function mapRouteDistance(x: number, y: number, includeService = true) {
  let best = Infinity;
  MAP_ROUTES.forEach((path, index) => {
    const b = routeBounds[index];
    const dx = Math.max(b.minX - x, 0, x - b.maxX);
    const dy = Math.max(b.minY - y, 0, y - b.maxY);
    if (dx * dx + dy * dy >= best) return;
    for (let i = 1; i < path.length; i++) {
      best = Math.min(
        best,
        distPointToSegSq(x, y, path[i - 1].x, path[i - 1].y, path[i].x, path[i].y),
      );
    }
  });
  for (const path of includeService ? MAP_SERVICE_ROUTES : []) {
    for (let i = 1; i < path.length; i++) {
      best = Math.min(
        best,
        distPointToSegSq(x, y, path[i - 1].x, path[i - 1].y, path[i].x, path[i].y),
      );
    }
  }
  return Math.sqrt(best);
}
export const mapNodeDistance = (x: number, y: number) =>
  Math.min(
    ...LEVELS.map((l) => Math.hypot(mapLevelPosition(l.id).x - x, mapLevelPosition(l.id).y - y)),
  );
export const smoothMap = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const mapHash = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
export const mapNoise = (x: number, y: number): number => {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const sx = smoothMap(0, 1, x - ix),
    sy = smoothMap(0, 1, y - iy);
  const a = mapHash(ix, iy) * (1 - sx) + mapHash(ix + 1, iy) * sx;
  const b = mapHash(ix, iy + 1) * (1 - sx) + mapHash(ix + 1, iy + 1) * sx;
  return a * (1 - sy) + b * sy;
};
// Each outpost owns a patch of its canonical habitat. Warped distance fields
// join those patches into ridges, bays and peninsulas rather than latitude bands.
export const MAP_BIOMES: Biome[] = ["forest", "snow", "desert", "wasteland", "lava", "alien"];
const REGION_ANCHORS = MAP_BIOMES.map((biome) =>
  LEVELS.filter((level) => biomeForPos(level.nodePos) === biome).map((level) =>
    mapLevelPosition(level.id),
  ),
);
export function mapBiomeWeights(x: number, y: number): number[] {
  const warp = smoothMap(1.5, 5, mapNodeDistance(x, y));
  const wx = x + (mapNoise(x * 0.075 + 17, y * 0.075) - 0.5) * 7 * warp;
  const wy = y + (mapNoise(x * 0.085, y * 0.085 + 31) - 0.5) * 6 * warp;
  const distances = REGION_ANCHORS.map((anchors) =>
    Math.min(...anchors.map((p) => Math.hypot((wx - p.x) * 0.85, wy - p.y))),
  );
  const nearest = Math.min(...distances);
  const weights = distances.map((d) => Math.exp(-(d - nearest) * 1.15));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / sum);
}
export const mapBiome = (x: number, y: number): Biome => {
  const weights = mapBiomeWeights(x, y);
  return MAP_BIOMES[weights.indexOf(Math.max(...weights))];
};

export type MapFacility = {
  pos: Vec2;
  radius: number;
  biome: Biome;
  yaw: number;
  research: boolean;
};
// Six regional stations, facing inward toward their campaign region. No duplicate
// building ring around every node; these reservations also govern natural props.
export const MAP_FACILITIES: MapFacility[] = [
  { pos: { x: -37, y: -15 }, biome: "forest", yaw: -0.45, research: true },
  { pos: { x: -36, y: 12 }, biome: "snow", yaw: 0.35, research: false },
  { pos: { x: 1, y: 33 }, biome: "desert", yaw: -0.3, research: false },
  { pos: { x: 7, y: -30 }, biome: "wasteland", yaw: 0.25, research: false },
  { pos: { x: 36, y: -23 }, biome: "lava", yaw: -0.4, research: false },
  { pos: { x: 36, y: 31 }, biome: "alien", yaw: 0.3, research: true },
].map((f) => ({ ...f, biome: f.biome as Biome, radius: 3 }));

// Dirt access spurs tie the research stations into the campaign route.
export const MAP_SERVICE_ROUTES = MAP_FACILITIES.map((f) => {
  const node = LEVELS.filter((l) => biomeForPos(l.nodePos) === f.biome).sort(
    (a, b) =>
      Math.hypot(mapLevelPosition(a.id).x - f.pos.x, mapLevelPosition(a.id).y - f.pos.y) -
      Math.hypot(mapLevelPosition(b.id).x - f.pos.x, mapLevelPosition(b.id).y - f.pos.y),
  )[0];
  const pos = mapLevelPosition(node.id);
  return [f.pos, { x: (f.pos.x + pos.x) / 2, y: f.pos.y }, pos];
});
export const MAP_LAKES: AuthoredLake[] = [
  {
    id: "atlas-forest-pool",
    pos: { x: -24, y: -31 },
    rx: 3.2,
    ry: 2.6,
    rot: -0.3,
    material: "water",
  },
  { id: "atlas-lava-pool", pos: { x: 36, y: -7 }, rx: 2.3, ry: 1.9, rot: 0.5, material: "lava" },
  { id: "atlas-alien-pool", pos: { x: 23, y: 34 }, rx: 2.4, ry: 2.1, rot: -0.2, material: "toxic" },
];
export const mapShoreDistance = (x: number, y: number) =>
  Math.min(
    ...MAP_LAKES.map((lake) =>
      lakeDistance({ x: lake.pos.x, y: lake.pos.y, rx: lake.rx, ry: lake.ry, rot: lake.rot }, x, y),
    ),
  );

export type MapHabitat = {
  pos: Vec2;
  radius: number;
  yaw: number;
  biome: Biome;
  kind: "grove" | "formation";
  seed: number;
};
function composeMapHabitats(): MapHabitat[] {
  const rand = mulberry32(60173);
  const candidates: { pos: Vec2; score: number }[] = [];
  for (let y = -34; y <= 37; y += 3)
    for (let x = -40; x <= 40; x += 3) {
      const pos = { x: x + (rand() - 0.5) * 2, y: y + (rand() - 0.5) * 2 };
      const clear = Math.min(
        mapNodeDistance(pos.x, pos.y) - 3.2,
        mapRouteDistance(pos.x, pos.y) - 1.1,
      );
      if (
        clear < 1.2 ||
        mapShoreDistance(pos.x, pos.y) < 2 ||
        MAP_FACILITIES.some((f) => Math.hypot(f.pos.x - pos.x, f.pos.y - pos.y) < f.radius + 3)
      )
        continue;
      candidates.push({ pos, score: Math.min(clear, 4) + rand() * 2 });
    }
  candidates.sort((a, b) => b.score - a.score);
  const masses: MapHabitat[] = [];
  for (const { pos } of candidates) {
    if (masses.some((m) => Math.hypot(m.pos.x - pos.x, m.pos.y - pos.y) < 5.8)) continue;
    const biome = mapBiome(pos.x, pos.y);
    const wooded = biome === "forest" || biome === "snow";
    masses.push({
      pos,
      biome,
      radius: 3.1 + rand() * 1.3,
      yaw: rand() * Math.PI,
      kind: rand() < (wooded ? 0.8 : biome === "alien" ? 0.5 : 0.15) ? "grove" : "formation",
      seed: masses.length * 7919 + 17,
    });
  }
  return masses;
}
export const MAP_HABITATS = composeMapHabitats();
export function mapHabitatDensity(x: number, y: number) {
  let grove = 0,
    rock = 0;
  for (const mass of MAP_HABITATS) {
    const dx = x - mass.pos.x,
      dy = y - mass.pos.y;
    if (Math.abs(dx) > mass.radius * 1.5 || Math.abs(dy) > mass.radius * 1.5) continue;
    const c = Math.cos(mass.yaw),
      s = Math.sin(mass.yaw);
    const d = Math.hypot((dx * c + dy * s) / mass.radius, (-dx * s + dy * c) / (mass.radius * 0.7));
    const weight = 1 - smoothMap(0.3, 1.5, d);
    if (mass.kind === "grove") grove = Math.max(grove, weight);
    else rock = Math.max(rock, weight);
  }
  return { grove, rock };
}
