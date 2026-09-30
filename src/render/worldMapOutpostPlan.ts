import type { Vec2 } from "../sim/types";
import { MAP_FACILITIES } from "./worldMapLandscape";

// Renderer and editor share the exact facility reservations.
export const worldMapOutposts = () => MAP_FACILITIES;
export const outpostKey = (pos: Vec2) => `outpost:${pos.x},${pos.y}`;
export const worldMapOutpostItems = () =>
  MAP_FACILITIES.map((f) => ({
    x: f.pos.x,
    y: f.pos.y,
    r: f.radius,
    key: outpostKey(f.pos),
  }));
