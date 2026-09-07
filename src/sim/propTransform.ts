import type { PlacedProp } from "./types";

// Shared transform bounds + sanitizer for hand-placed props. Lives in
// src/sim (not src/editor) because the load path in world.ts needs it and
// the editor tree is dev-only — importing the other way round would drag
// the whole editor into production builds.

// `scale` multiplies a prop's role-normalized target size. The bounds are
// deliberately wide: authoring a boulder-sized bush or a knee-high tree is
// a legitimate set-dressing move.
export const MIN_PROP_SCALE = 0.15;
export const MAX_PROP_SCALE = 6;

export const clampPropScale = (s: number): number =>
  Math.min(MAX_PROP_SCALE, Math.max(MIN_PROP_SCALE, s));

const TAU = Math.PI * 2;

// Props rotate on the vertical axis only (yaw) — there is no pitch/roll, so
// a prop can never end up leaning off the ground plane. Wrapped into
// [0, 2π) so repeated rotation never accumulates into a huge float.
export const normalizeYaw = (rad: number): number => {
  if (!Number.isFinite(rad)) return 0;
  const r = rad % TAU;
  return r < 0 ? r + TAU : r;
};

// Coerce one persisted prop into a renderable one. Blobs authored before
// scale/rot existed (or hand-edited JSON) can omit either field entirely,
// and an undefined would reach the instancer as NaN — which collapses the
// whole InstancedGroup batch, not just that prop. Missing / non-finite
// values fall back to the identity transform (scale 1, yaw 0).
export const sanitizePlacedProp = (p: PlacedProp): PlacedProp => ({
  ...p,
  scale: Number.isFinite(p.scale) ? clampPropScale(p.scale) : 1,
  rot: normalizeYaw(p.rot),
});

export const sanitizePlacedProps = (props: PlacedProp[]): PlacedProp[] =>
  props.map(sanitizePlacedProp);
