// Shared by rendering, banks, placement, and fluid sampling. The smooth
// harmonics form coves and uneven lobes within the original lake footprint.
export const lakeRadius = (angle: number): number =>
  0.78 +
  0.12 * Math.sin(3 * angle + 0.6) +
  0.065 * Math.cos(5 * angle - 0.8) +
  0.025 * Math.sin(7 * angle + 1.3);

export const lakeLocalNorm = (x: number, y: number, rx: number, ry: number): number => {
  const nx = x / Math.max(1e-6, rx);
  const ny = y / Math.max(1e-6, ry);
  return Math.hypot(nx, ny) / lakeRadius(Math.atan2(ny, nx));
};

export const lakeDistance = (
  lake: { x: number; y: number; rx: number; ry: number; rot: number },
  x: number,
  y: number,
): number => {
  const c = Math.cos(lake.rot),
    s = Math.sin(lake.rot);
  const dx = x - lake.x,
    dy = y - lake.y;
  return (
    (lakeLocalNorm(c * dx + s * dy, -s * dx + c * dy, lake.rx, lake.ry) - 1) *
    Math.min(lake.rx, lake.ry)
  );
};
