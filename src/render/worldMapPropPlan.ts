import * as THREE from "three";
import {
  BIOME_LAYERS,
  BIOME_TREE_URLS,
  type Biome,
  classifyPropUrl,
  TARGET_SIZE_BY_ROLE,
} from "../biomes";
import { LEVELS } from "../levels";
import { getStars, type ProgressData } from "../progress";
import { mulberry32 } from "../sim/random";
import { DEAD_DINO_FOOTPRINT, DEAD_DINO_URLS, deadDinoCollisionRadius } from "./DeadDinos";
import {
  MAP_FACILITIES,
  MAP_HABITATS,
  mapBiome,
  mapNodeDistance,
  mapRouteDistance,
  mapShoreDistance,
} from "./worldMapLandscape";

export type PropInstance = {
  id: string;
  url: string;
  pos: THREE.Vector3;
  rotY: number;
  scale: number;
  tiltZ?: number;
  key: string;
};
const treeModels = new Set(Object.values(BIOME_TREE_URLS).flat());
// SnowPine assets do not contain "tree" in their filename. Use the biome
// catalog as authority so their crowns do not shrink to cosmetic scale.
export const mapPropTargetSize = (url: string) =>
  treeModels.has(url) ? TARGET_SIZE_BY_ROLE.tree : TARGET_SIZE_BY_ROLE[classifyPropUrl(url)];
export const mapPropRadius = (url: string, scale: number) =>
  DEAD_DINO_FOOTPRINT[url] !== undefined
    ? deadDinoCollisionRadius(url, scale)
    : mapPropTargetSize(url) * scale * 0.5;

const family = (biome: Biome, pattern: RegExp) => [
  ...new Set(BIOME_LAYERS[biome].flatMap((l) => l.urls).filter((u) => pattern.test(u))),
];
type Reservation = { x: number; y: number; radius: number };
const baseReservations: Reservation[] = [];
const basePlan: Record<string, PropInstance[]> = {};

// Clear rendered silhouettes, not just trunks. Small undergrowth can tuck into
// a canopy, while crowns retain separate silhouettes and routes remain open.
function place(
  plan: Record<string, PropInstance[]>,
  placed: Reservation[],
  url: string,
  x: number,
  y: number,
  scale: number,
  yaw: number,
  understory = false,
) {
  const radius = mapPropRadius(url, scale);
  if (mapShoreDistance(x, y) < radius + 0.4) return false;
  if (mapNodeDistance(x, y) < 3.15 + radius || mapRouteDistance(x, y) < 0.8 + radius) return false;
  if (MAP_FACILITIES.some((f) => Math.hypot(f.pos.x - x, f.pos.y - y) < f.radius + radius + 0.3))
    return false;
  const footprint = radius * (understory ? 0.42 : 0.8);
  if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.radius + footprint + 0.1)) return false;
  placed.push({ x, y, radius: footprint });
  const key = `${x},${-y}`;
  const item: PropInstance = {
    id: key,
    key,
    url,
    pos: new THREE.Vector3(x, 0, -y),
    scale,
    rotY: yaw,
  };
  const bucket = plan[url] ?? [];
  bucket.push(item);
  plan[url] = bucket;
  return true;
}

// Whole habitats share species, direction and scale hierarchy. The natural
// layer gets first claim on the land; facilities have explicit reservations.
for (const mass of MAP_HABITATS) {
  const rand = mulberry32(mass.seed);
  const trees = BIOME_TREE_URLS[mass.biome];
  const rocks = family(
    mass.biome,
    mass.biome === "alien" ? /rock|crystal_(?:large|medium)|meteor/i : /rock|meteor/i,
  );
  const bushes = family(mass.biome, /bush|plant|mushroom/i);
  const grass = family(mass.biome, /grass/i);
  const main = mass.kind === "grove" ? trees : rocks;
  const species = Math.floor(rand() * Math.max(1, main.length));
  const c = Math.cos(mass.yaw),
    s = Math.sin(mass.yaw);
  const scatter = (
    urls: string[],
    count: number,
    lo: number,
    hi: number,
    spread: number,
    under = false,
  ) => {
    if (!urls.length) return;
    let accepted = 0;
    for (let attempt = 0; attempt < count * 18 && accepted < count; attempt++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * mass.radius * spread;
      const u = Math.cos(a) * r,
        v = Math.sin(a) * r * 0.7;
      const x = mass.pos.x + u * c - v * s,
        y = mass.pos.y + u * s + v * c;
      if (mapBiome(x, y) !== mass.biome) continue;
      const scale = lo + rand() * (hi - lo);
      const url = urls[(species + (accepted % Math.min(2, urls.length))) % urls.length];
      if (
        place(
          basePlan,
          baseReservations,
          url,
          x,
          y,
          scale,
          mass.yaw + (rand() - 0.5) * (mass.kind === "formation" ? 0.45 : 4),
          under,
        )
      )
        accepted++;
    }
  };
  // Tall elder + smaller companions; boulders are formations, not tiny gravel.
  scatter(
    main,
    mass.kind === "grove" ? (mass.biome === "alien" ? 4 : 7) : 5,
    mass.kind === "grove" ? 0.85 : 1.7,
    mass.kind === "grove"
      ? mass.biome === "alien"
        ? 1.15
        : 1.65
      : mass.biome === "alien"
        ? 2.5
        : 3.8,
    1,
  );
  scatter(bushes, mass.kind === "grove" ? 8 : 2, 0.65, 1.4, 1.2, true);
  scatter(rocks, 5, 0.5, 1.1, 1.25, true);
  scatter(grass, mass.kind === "grove" ? 18 : 5, 0.8, 1.5, 1.25, true);
}

// Progress only appends remains after the immutable landscape is complete.
// Clearing an early level can never reshuffle scenery beside a later level.
const buildPropPlan = (progress: ProgressData) => {
  const plan = Object.fromEntries(
    Object.entries(basePlan).map(([url, items]) => [url, [...items]]),
  );
  const placed = [...baseReservations];
  for (const level of LEVELS) {
    if (!getStars(progress, level.id)) continue;
    const rand = mulberry32(level.id * 6151 + 53);
    for (let i = 0; i < 24; i++) {
      const a = rand() * Math.PI * 2,
        r = 4.8 + rand() * 2;
      if (
        place(
          plan,
          placed,
          DEAD_DINO_URLS[level.id % DEAD_DINO_URLS.length],
          level.nodePos.x + Math.cos(a) * r,
          level.nodePos.y + Math.sin(a) * r,
          0.65,
          rand() * Math.PI * 2,
        )
      )
        break;
    }
  }
  return plan;
};
let cacheKey: ProgressData | null = null;
let cache: Record<string, PropInstance[]> = {};
export const propPlan = (progress: ProgressData) => {
  if (cacheKey !== progress) {
    cache = buildPropPlan(progress);
    cacheKey = progress;
  }
  return cache;
};
export const worldMapProceduralItems = (progress: ProgressData) =>
  Object.values(propPlan(progress)).flatMap((items) =>
    items.map((it) => ({
      x: it.pos.x,
      y: -it.pos.z,
      r: mapPropRadius(it.url, it.scale),
      key: it.key,
    })),
  );
