// World-map content + pan bounds. Lives in its own module so the dev-only
// editor can import the editable area without pulling in WorldMap.tsx (which
// loads the entire biome model set). Production tree-shaking sees only
// numeric constants from here.
//
// CONTENT_* is the level-node cluster span; PAN_LIMIT_* is how far the
// orbital camera target can drift from origin before clamping (a function
// of the content span minus an off-screen margin). The world-map editor's
// click plane is sized to ±PAN_LIMIT plus a small pad — props placed
// further out could never be revealed by any valid pan/zoom combination.

export const CONTENT_W = 80;
export const CONTENT_H = 64;

export const PAN_LIMIT_X = CONTENT_W / 2 - 14;
export const PAN_LIMIT_Z = CONTENT_H / 2 - 8;

// Rendered ground extent (oversized so the plane edge is always off-screen).
export const GROUND_W = 1200;
export const GROUND_H = 1000;
