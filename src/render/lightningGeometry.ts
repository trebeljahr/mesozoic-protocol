// Beam colors are existing simulation identifiers. Do not classify warm robot
// ballistic/critical tracers as lightning merely because they are also beams.
export const CHAIN_BEAM_COLOR = "#9fd8ff";
export const isLightningBeam = (color: string) =>
  color === CHAIN_BEAM_COLOR || color === "#7ee0ff" || color === "#cfe8ff" || color === "#9beaff";

// Remaining-time envelope supports the sim's 100–180ms lifetimes without
// changing expiry or retaining stale hits. Last 100ms contain strike/restrike.
export const lightningEnvelope = (remaining: number) => {
  if (remaining <= 0) return 0;
  const fade = Math.min(1, remaining / 0.025);
  const pulse = remaining > 0.075 ? 1 : remaining > 0.048 ? 0.28 : 0.85;
  return fade * pulse;
};

// Three-sided tapered tube, 18 non-indexed vertices. A stable orthonormal
// frame gives actual volume from every camera angle, including vertical rays.
// Writes into fixed pools; scratch calculations allocate no objects.
export function writeLightningSegment(
  positions: Float32Array,
  colors: Float32Array,
  segment: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  radius0: number,
  radius1: number,
  r: number,
  g: number,
  b: number,
) {
  const dx = bx - ax,
    dy = by - ay,
    dz = bz - az;
  const length = Math.hypot(dx, dy, dz);
  const tx = length > 1e-8 ? dx / length : 0;
  const ty = length > 1e-8 ? dy / length : 1;
  const tz = length > 1e-8 ? dz / length : 0;
  const horizontal = Math.hypot(tx, tz);
  const ux = horizontal > 1e-8 ? -tz / horizontal : 1;
  const uz = horizontal > 1e-8 ? tx / horizontal : 0;
  const vx = ty * uz,
    vy = tz * ux - tx * uz,
    vz = -ty * ux;
  let offset = segment * 54;
  for (let face = 0; face < 3; face++) {
    for (let vertex = 0; vertex < 6; vertex++) {
      const end = vertex === 2 || vertex === 4 || vertex === 5;
      const next = vertex === 1 || vertex === 3 || vertex === 4;
      const corner = (face + (next ? 1 : 0)) % 3;
      const cs = corner === 0 ? 1 : -0.5;
      const sn = corner === 0 ? 0 : corner === 1 ? 0.8660254037844386 : -0.8660254037844386;
      const radius = length > 1e-8 ? (end ? radius1 : radius0) : 0;
      positions[offset] = (end ? bx : ax) + (ux * cs + vx * sn) * radius;
      positions[offset + 1] = (end ? by : ay) + vy * sn * radius;
      positions[offset + 2] = (end ? bz : az) + (uz * cs + vz * sn) * radius;
      colors[offset] = r;
      colors[offset + 1] = g;
      colors[offset + 2] = b;
      offset += 3;
    }
  }
}
