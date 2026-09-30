import { MAP_HEIGHT, MAP_WIDTH, PATH_ENTRY_MARGIN_X, PATH_ENTRY_MARGIN_Y } from "../level";

export const CAMERA_BASE_POSITION: [number, number, number] = [0, 24, 20];

// A modestly lower view exposes wall faces and turret silhouettes while
// preserving the full route at fit zoom. Touch remains pan/pinch only.
export const BATTLE_MIN_POLAR = 0.35;
export const BATTLE_MAX_POLAR = 0.75;

// Pan limits are computed dynamically from current zoom — see
// `panLimitFor` below. At fit zoom the range collapses to 0 so the whole
// map stays centred; the player can only pan once they've zoomed in.

// Ground-plane projection follows the actual base elevation. Deriving this
// avoids clipping path endpoints when changing the presentation angle.
export const TILT_HALF_FACTOR =
  Math.hypot(CAMERA_BASE_POSITION[1], CAMERA_BASE_POSITION[2]) / (2 * CAMERA_BASE_POSITION[1]);

// Decoration margin past the play area at the most-zoomed-out zoom. X
// matches the sim's side-entry bounds; Z keeps baseline decor visible,
// while the path extents below pull top/bottom entries into the fit.
const DECOR_MARGIN_X = PATH_ENTRY_MARGIN_X;
const DECOR_MARGIN_Z = 4.5;

// Mobile gets a larger Z margin so the HUD bands (top wave banner,
// bottom tower picker) don't crop the playable area. Without this the
// fit zoom on landscape phones cuts off path endpoints behind the HUD.
const MOBILE_VIEWPORT_PX = 720;
const MOBILE_DECOR_MARGIN_Z = PATH_ENTRY_MARGIN_Y + 1.5;

// Start a little zoomed in from the maximum zoom-out so the first run
// still has useful pan range while the player can pull back farther.
export const START_ZOOM_MULT = 1.08;

// How far the player can manually zoom in past the fit-to-edge zoom.
// 2.5× covers reading tower upgrade details up close. Zooming out
// past the fit zoom is disallowed — that would re-expose background.
export const MAX_ZOOM_MULT = 2.5;

// Hard ceiling on zoom-in regardless of fit zoom. Values past this
// turn each world unit into ~80+ CSS px, which makes tower models
// blocky and the placement reticle feel sluggish. Capping here keeps
// readability sensible on huge viewports where fit zoom alone would
// already be high.
export const ABS_MAX_ZOOM = 80;

export const computeMaxPathExtents = (
  paths: { x: number; y: number }[][],
): { x: number; z: number } => {
  let x = 0;
  let z = 0;
  for (const p of paths) {
    for (const point of p) {
      x = Math.max(x, Math.abs(point.x));
      z = Math.max(z, Math.abs(point.y));
    }
  }
  return { x, z };
};

// Most-zoomed-out zoom — guarantees the playable area + decor margin
// fits on screen on both axes. Uses min() so the binding constraint
// wins: on narrow viewports the X edges hit first, on ultrawide the
// Z edges hit first. The half-extent is max(playArea, pathExtent)
// because some levels have paths that meander outside the play
// rectangle's vertical band; pulling them in too is friendlier.
export const computeFitZoom = (
  width: number,
  height: number,
  pathHalfExtents: { x: number; z: number },
  compound = false,
): number => {
  const mobile = width <= MOBILE_VIEWPORT_PX || height <= 500;
  const marginZ = mobile ? MOBILE_DECOR_MARGIN_Z : compound ? 8 : DECOR_MARGIN_Z;
  const halfX = Math.max(MAP_WIDTH / 2 + (compound ? 9 : DECOR_MARGIN_X), pathHalfExtents.x);
  const halfZ = Math.max(MAP_HEIGHT / 2 + marginZ, pathHalfExtents.z);
  const fitZoomX = width / (2 * halfX);
  const fitZoomZ = (TILT_HALF_FACTOR * height) / halfZ;
  return Math.min(fitZoomX, fitZoomZ);
};
