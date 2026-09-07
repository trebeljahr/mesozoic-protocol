import { LEVELS } from "../levels";
import { mulberry32 } from "../sim/random";
import type { Vec2 } from "../sim/types";
import { distToSegmentSq } from "../sim/vec2";
import {
  COMPACT_TEMPLATE_IDS,
  HERO_TEMPLATE_IDS,
  OUTPOST_BY_ID,
  outpostRadius,
  type PlacedOutpost,
} from "./outpostKit";

// Modular colonies scattered across the world-map biome bands as ambient
// set-dressing. Deterministic, and kept clear of every level node and the
// route line connecting them so the map stays readable.
//
// Split out of WorldMapOutposts.tsx (which renders the plan) so the
// dev-only world-map editor can read the layout without importing the
// render layer — WorldMapOutposts in turn reads the editor's erase mask,
// which would otherwise be an import cycle.

// Scatter region — the level-node cluster spans x:[-24,22] y:[-14,26];
// extend a little past it so colonies frame the campaign trail.
const MIN_X = -30;
const MAX_X = 28;
const MIN_Y = -18;
const MAX_Y = 30;

const NODE_CLEAR = 3.5;
const ROUTE_CLEAR = 2.5;
const TARGET = 14;

type Local = PlacedOutpost & { radius: number };

const buildMapOutposts = (): PlacedOutpost[] => {
  const rng = mulberry32(99173);
  const nodes = LEVELS.map((l) => l.nodePos);
  const segs: [Vec2, Vec2][] = [];
  for (let i = 0; i < LEVELS.length - 1; i++) segs.push([LEVELS[i].nodePos, LEVELS[i + 1].nodePos]);

  const candidates: Vec2[] = [];
  for (let x = MIN_X; x <= MAX_X; x += 4) {
    for (let y = MIN_Y; y <= MAX_Y; y += 4) candidates.push({ x, y });
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const placed: Local[] = [];
  const fits = (x: number, y: number, r: number): boolean => {
    for (const n of nodes) {
      const dx = n.x - x;
      const dy = n.y - y;
      const lim = r + NODE_CLEAR;
      if (dx * dx + dy * dy < lim * lim) return false;
    }
    for (const [a, b] of segs) {
      const lim = r + ROUTE_CLEAR;
      if (distToSegmentSq({ x, y }, a, b) < lim * lim) return false;
    }
    for (const o of placed) {
      const dx = o.pos.x - x;
      const dy = o.pos.y - y;
      const lim = r + o.radius + 1.5;
      if (dx * dx + dy * dy < lim * lim) return false;
    }
    return true;
  };

  for (const c of candidates) {
    if (placed.length >= TARGET) break;
    const ids = rng() < 0.5 ? HERO_TEMPLATE_IDS : COMPACT_TEMPLATE_IDS;
    const template = OUTPOST_BY_ID[ids[Math.floor(rng() * ids.length)]];
    const scale = 0.7 + rng() * 0.35;
    const r = outpostRadius(template, scale);
    if (!fits(c.x, c.y, r)) continue;
    placed.push({ template, pos: { x: c.x, y: c.y }, yaw: rng() * Math.PI * 2, scale, radius: r });
  }
  return placed.map(({ template, pos, yaw, scale }) => ({ template, pos, yaw, scale }));
};

// Built once — the layout is seeded off a fixed constant, so it never
// varies within a session.
let cache: PlacedOutpost[] | null = null;

export const worldMapOutposts = (): PlacedOutpost[] => {
  if (cache === null) cache = buildMapOutposts();
  return cache;
};

// Position-derived key for the editor's erased-procedural mask. Prefixed so
// it can never collide with the plain "x,z" keys the BiomeProps clusters
// use — both sets share one mask.
export const outpostKey = (pos: Vec2): string => `outpost:${pos.x},${pos.y}`;

// Footprint view of the colonies for the dev editor, in editor coordinates
// (which for outposts are already the authored pos).
export const worldMapOutpostItems = (): { x: number; y: number; r: number; key: string }[] =>
  worldMapOutposts().map((o) => ({
    x: o.pos.x,
    y: o.pos.y,
    r: outpostRadius(o.template, o.scale),
    key: outpostKey(o.pos),
  }));
