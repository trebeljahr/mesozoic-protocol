import type { PlacedProp, Vec2 } from "../sim/types";

// Pure helpers for multi-select / group / stamp math. No React, no stores,
// no localStorage — every function takes its inputs explicitly and returns
// a new value. Mirrors the style of history.ts / brush.ts so editorCore.ts
// can stay readable instead of inlining centroid / rotation / point-in-rect
// math in three or four places.

// Axis-aligned bounding rectangle in world coordinates. Used by the marquee
// drag-rect and (later) by the AABB fallback for big selection-ring batches.
export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

// Normalised AABB from two arbitrary corner points. Marquee gestures can
// drag in any direction, so we don't assume `a` is top-left.
export const rectFromCorners = (ax: number, ay: number, bx: number, by: number): Rect => ({
  minX: Math.min(ax, bx),
  minY: Math.min(ay, by),
  maxX: Math.max(ax, bx),
  maxY: Math.max(ay, by),
});

// Inclusive containment — props sitting exactly on the rectangle edge are
// considered inside (matches the typical UX expectation for marquee select).
export const pointInRect = (p: Vec2, r: Rect): boolean =>
  p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

// Arithmetic mean of the selected props' positions. Returns the origin for
// an empty selection — callers should branch on `ids.size === 0` first if
// the origin would be wrong; in practice every caller already gates on the
// selection being non-empty.
export const computeCentroid = (props: PlacedProp[], ids: Set<string>): Vec2 => {
  if (ids.size === 0) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const p of props) {
    if (!ids.has(p.id)) continue;
    sumX += p.pos.x;
    sumY += p.pos.y;
    count++;
  }
  if (count === 0) return { x: 0, y: 0 };
  return { x: sumX / count, y: sumY / count };
};

// Rotate `p` around `pivot` by `rad` (right-handed, +y is up in the XZ
// plane). Used by rotateSelectionAroundCentroid to relocate every member's
// position while leaving its individual `rot` untouched at the call site
// (the caller folds the delta into prop.rot separately).
export const rotatePointAround = (p: Vec2, pivot: Vec2, rad: number): Vec2 => {
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x: pivot.x + dx * c - dy * s,
    y: pivot.y + dx * s + dy * c,
  };
};

// Scale `p`'s offset from `pivot` by `mul`. Used by scaleSelectionAround-
// Centroid to relocate every member; the caller multiplies prop.scale
// separately.
export const scalePointAround = (p: Vec2, pivot: Vec2, mul: number): Vec2 => ({
  x: pivot.x + (p.x - pivot.x) * mul,
  y: pivot.y + (p.y - pivot.y) * mul,
});

// Expand a seed selection to include every prop sharing a groupId with any
// seed member. Props with undefined groupId never trigger expansion (only
// the explicitly clicked prop ends up in the result for ungrouped seeds).
// Single pass over props + O(|seed|) groupId set build — linear in total
// prop count.
export const expandSelectionByGroup = (props: PlacedProp[], seedIds: Set<string>): Set<string> => {
  if (seedIds.size === 0) return new Set();
  // Collect the groupIds carried by seed members. Skip ungrouped seeds —
  // they don't pull in siblings.
  const seedGroups = new Set<string>();
  for (const p of props) {
    if (!seedIds.has(p.id)) continue;
    if (p.groupId !== undefined) seedGroups.add(p.groupId);
  }
  const out = new Set(seedIds);
  if (seedGroups.size === 0) return out;
  for (const p of props) {
    if (p.groupId !== undefined && seedGroups.has(p.groupId)) out.add(p.id);
  }
  return out;
};
