import { type Biome, biomeForPos } from "../biomes";
import { lakeDistance } from "../lakeShape";
import { LEVELS } from "../levels";
import { mulberry32 } from "../sim/random";
import type { AuthoredLake, Vec2 } from "../sim/types";
import { distPointToSegSq } from "../sim/vec2";

// One route definition for rendering, terrain shoulders and scenery exclusion.
export const MAP_ROUTES = LEVELS.slice(0, -1).map((level, index) => {
  const a = level.nodePos;
  const b = LEVELS[index + 1].nodePos;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const bend = Math.min(1.1, length * 0.1) * (index % 2 ? 1 : -1);
  const c = {
    x: (a.x + b.x) / 2 + (dy / length) * bend,
    y: (a.y + b.y) / 2 - (dx / length) * bend,
  };
  return Array.from({ length: 25 }, (_, i) => {
    const t = i / 24,
      s = 1 - t;
    return {
      x: s * s * a.x + 2 * s * t * c.x + t * t * b.x,
      y: s * s * a.y + 2 * s * t * c.y + t * t * b.y,
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
  Math.min(...LEVELS.map((l) => Math.hypot(l.nodePos.x - x, l.nodePos.y - y)));
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
// Boundaries meander in empty ground and settle near the canonical level biomes.
export function mapHabitatY(x: number, y: number) {
  return y + (mapNoise(x * 0.12, y * 0.1) - 0.5) * 5 * smoothMap(1.5, 6, mapNodeDistance(x, y));
}
export const mapBiome = (x: number, y: number) => biomeForPos({ x, y: mapHabitatY(x, y) });

export type MapFacility = {
  pos: Vec2;
  radius: number;
  biome: Biome;
  yaw: number;
  research: boolean;
};
// Six regional stations, facing inward toward their campaign band. No duplicate
// building ring around every node; these reservations also govern natural props.
export const MAP_FACILITIES: MapFacility[] = [
  { pos: { x: -33, y: -14 }, biome: "forest", yaw: -0.45, research: true },
  { pos: { x: 32, y: -5.5 }, biome: "snow", yaw: 0.35, research: false },
  { pos: { x: -33, y: 2 }, biome: "desert", yaw: -0.3, research: false },
  { pos: { x: 33, y: 9 }, biome: "wasteland", yaw: 0.25, research: false },
  { pos: { x: -33, y: 16 }, biome: "lava", yaw: -0.4, research: false },
  { pos: { x: 33, y: 26 }, biome: "alien", yaw: 0.3, research: true },
].map((f) => ({ ...f, biome: f.biome as Biome, radius: 3 }));

// Dirt access spurs tie the research stations into the campaign route.
export const MAP_SERVICE_ROUTES = MAP_FACILITIES.map((f) => {
  const node = LEVELS.filter((l) => biomeForPos(l.nodePos) === f.biome).sort(
    (a, b) =>
      Math.hypot(a.nodePos.x - f.pos.x, a.nodePos.y - f.pos.y) -
      Math.hypot(b.nodePos.x - f.pos.x, b.nodePos.y - f.pos.y),
  )[0];
  return [f.pos, { x: (f.pos.x + node.nodePos.x) / 2, y: f.pos.y }, node.nodePos];
});
export const MAP_LAKES: AuthoredLake[] = [
  {
    id: "atlas-forest-pool",
    pos: { x: -11, y: -22 },
    rx: 4.5,
    ry: 2.6,
    rot: -0.3,
    material: "water",
  },
  { id: "atlas-lava-pool", pos: { x: 33, y: 17 }, rx: 2.8, ry: 1.9, rot: 0.5, material: "lava" },
  { id: "atlas-alien-pool", pos: { x: 4, y: 32 }, rx: 3.8, ry: 2.1, rot: -0.2, material: "toxic" },
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
  for (let y = -23; y <= 33; y += 3)
    for (let x = -36; x <= 34; x += 3) {
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
