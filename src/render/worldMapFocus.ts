import { DEMO_MAX_LEVEL, IS_DEMO } from "../demo";
import { LEVELS } from "../levels";
import { getStars, isLevelUnlocked, type ProgressData } from "../progress";
import { CONTENT_H, CONTENT_W, PAN_LIMIT_X, PAN_LIMIT_Z } from "./worldMapBounds";
import { mapLevelPosition } from "./worldMapLayout";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// A shallower atlas view shows tree crowns and facility faces. Keep the
// ground projection factor paired with the 30-high / 18-back camera offset.
const TILT_GROUND_FACTOR = Math.hypot(30, 18) / 30;

// Hard ceiling on zoom-in. Past this, single nodes overflow the viewport
// and the labels become unreadable from oversampling.
export const ABS_MAX_ZOOM = 42;
// How far past the fit zoom the player can manually zoom in.
export const MAX_ZOOM_MULT = 2.5;

// Smallest zoom we'll ever pick. Keeps short/wide viewports from showing
// a tiny postage-stamp map while still letting normal phones land on a
// looser fit when the height-fit math comes out below this.
const MIN_FIT_ZOOM = 8;

// Padding factor around the focused level's neighbor span when fitting the
// outpost entry zoom — keeps the sibling nodes off the screen edge.
const NEIGHBOR_FIT_PAD = 1.5;
// Floors (world units) on the per-axis half-span used for the fit, so a
// level whose neighbors sit unusually close still doesn't zoom in past
// readability.
const MIN_FOCUS_HALF_X = 9;
const MIN_FOCUS_HALF_Z = 6;
// Keep the current outpost slightly above center, leaving its label clear of
// the bottom navigation. Positive values move the node below the midline.
const MOBILE_Y_OFFSET_FRAC = -0.04;
// Camera-to-target Z offset baked into the OrthographicCamera position
// (0, 30, 18). Preserved when shifting target so the look angle stays
// fixed.
export const CAMERA_Z_OFFSET = 18;
export const CAMERA_Y = 30;
// Centre the complete campaign span, including the northern alien region.
export const ATLAS_TARGET_Z = -5;

export const computeFitZoom = (width: number, height: number): number => {
  const halfX = CONTENT_W / 2;
  const halfZ = CONTENT_H / 2;
  const fitX = width / (2 * halfX);
  const fitZ = (height * TILT_GROUND_FACTOR) / (2 * halfZ);
  return Math.max(MIN_FIT_ZOOM, Math.min(fitX, fitZ));
};

// Index (not id) of the first unlocked, not-yet-cleared level — the
// player's current frontier. Falls back to the last level once every level
// has 1+ stars so re-entries still center on a real node instead of (0,0).
// Returns the array index so the caller can read the immediate path
// neighbors for the focus-zoom fit.
export const findCurrentLevelIndex = (progress: ProgressData): number => {
  for (let i = 0; i < LEVELS.length; i++) {
    const l = LEVELS[i];
    if (isLevelUnlocked(l.id, progress) && getStars(progress, l.id) === 0) return i;
  }
  // Once every level is cleared, re-center on the last real node. In the demo
  // that's the last playable outpost (L5), not the locked L30 far up the map.
  return IS_DEMO ? DEMO_MAX_LEVEL - 1 : LEVELS.length - 1;
};

export type CameraFocus = { zoom: number; targetX: number; targetZ: number };

export const computeOutpostFocus = (
  idx: number,
  fitZoom: number,
  maxZoom: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
): CameraFocus | null => {
  const level = LEVELS[idx];
  if (!level) return null;
  // Per-axis half-span (world units) from the focused node to its immediate
  // path neighbors, one each side. Drives a zoom that frames ~1 level per
  // side with the next-out level peeking in. Decoupled from fitZoom: that
  // zoom is viewport-floored and doesn't map to a consistent world span, so
  // a flat multiplier over it over-zoomed siblings on phones.
  let halfX = MIN_FOCUS_HALF_X;
  let halfZ = MIN_FOCUS_HALF_Z;
  for (const j of [idx - 1, idx + 1]) {
    const n = LEVELS[j];
    if (!n) continue;
    halfX = Math.max(halfX, Math.abs(mapLevelPosition(level.id).x - mapLevelPosition(n.id).x));
    halfZ = Math.max(halfZ, Math.abs(mapLevelPosition(level.id).y - mapLevelPosition(n.id).y));
  }
  const zoomX = viewportWidthPx / (2 * halfX * NEIGHBOR_FIT_PAD);
  const zoomZ = (viewportHeightPx * TILT_GROUND_FACTOR) / (2 * halfZ * NEIGHBOR_FIT_PAD);
  const zoom = clamp(Math.min(zoomX, zoomZ), fitZoom, maxZoom);
  const visibleHeightWorld = (viewportHeightPx / zoom) * TILT_GROUND_FACTOR;
  const nodeWorldZ = -mapLevelPosition(level.id).y;
  const rawTargetZ = nodeWorldZ - visibleHeightWorld * MOBILE_Y_OFFSET_FRAC;
  return {
    zoom,
    targetX: clamp(mapLevelPosition(level.id).x, -PAN_LIMIT_X, PAN_LIMIT_X),
    targetZ: clamp(rawTargetZ, -PAN_LIMIT_Z, PAN_LIMIT_Z),
  };
};

export type SavedMapView = CameraFocus & { frontier: number };
export function restoreMapView(
  saved: SavedMapView | undefined,
  frontier: number,
  fitZoom: number,
  maxZoom: number,
): CameraFocus | null {
  if (!saved || saved.frontier !== frontier) return null;
  return {
    targetX: saved.targetX,
    targetZ: saved.targetZ,
    zoom: clamp(saved.zoom, fitZoom, maxZoom),
  };
}
