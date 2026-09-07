// Noise-driven landscape fields. Prop scatter used to be either uniform
// (Ground.tsx) or clustered around a handful of Worley blobs (world.ts) —
// both read as "random sprinkle" because nothing about a prop's position
// correlated with anything else on the map. This module supplies the
// missing correlation: continuous, seeded, fractal fields for elevation /
// slope / moisture, and the vegetation-vs-rock masks derived from them.
//
// Placement then follows the terrain the way it does in a real landscape:
// forest clumps in moist low-slope ground, rock scatters on steep dry
// ridges, ground cover thins out in the open meadows between, and the
// rim of the map thickens so the playable middle stays readable.
//
// Everything is a pure function of `seed`, so a level regenerates
// identically for a given procedural seed.

import { mulberry32 } from "./random";

export type LandscapeBounds = { minX: number; maxX: number; minY: number; maxY: number };

// ── Perlin gradient noise ───────────────────────────────────────────────────
// Gradient noise rather than value noise: value noise leaves axis-aligned
// blockiness that reads as "generated", which is exactly the artefact we're
// trying to remove.

const GRAD_X = [1, -1, 1, -1, 1, -1, 0, 0];
const GRAD_Y = [1, 1, -1, -1, 0, 0, 1, -1];

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// 512-entry doubled permutation table so the two index lookups per corner
// never need a modulo.
const buildPerm = (seed: number): Uint8Array => {
  const rng = mulberry32(seed >>> 0);
  const p = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  p.copyWithin(256, 0, 256);
  return p;
};

export type Noise2D = (x: number, y: number) => number;

/** Classic 2D Perlin noise in roughly [-1, 1]. */
export const createPerlin2D = (seed: number): Noise2D => {
  const p = buildPerm(seed);
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const u = fade(xf);
    const v = fade(yf);

    const aa = p[p[X] + Y] & 7;
    const ba = p[p[X + 1] + Y] & 7;
    const ab = p[p[X] + Y + 1] & 7;
    const bb = p[p[X + 1] + Y + 1] & 7;

    const n00 = GRAD_X[aa] * xf + GRAD_Y[aa] * yf;
    const n10 = GRAD_X[ba] * (xf - 1) + GRAD_Y[ba] * yf;
    const n01 = GRAD_X[ab] * xf + GRAD_Y[ab] * (yf - 1);
    const n11 = GRAD_X[bb] * (xf - 1) + GRAD_Y[bb] * (yf - 1);

    // ×1.4 brings the practical range of the 8-direction gradient set
    // close to [-1, 1]; raw Perlin peaks well under 1.
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.4;
  };
};

export type FbmOptions = {
  octaves?: number;
  // World units per noise period of the first octave. Bigger = broader,
  // calmer shapes; smaller = busier detail.
  wavelength?: number;
  lacunarity?: number;
  gain?: number;
};

/** Fractal Brownian motion over Perlin octaves, normalized to ~[-1, 1]. */
export const createFbm2D = (seed: number, opts: FbmOptions = {}): Noise2D => {
  const octaves = opts.octaves ?? 4;
  const wavelength = opts.wavelength ?? 10;
  const lacunarity = opts.lacunarity ?? 2.03;
  const gain = opts.gain ?? 0.5;
  // One permutation per octave, otherwise every octave is the same field
  // at a different zoom and the sum shows self-similar streaks.
  const layers: Noise2D[] = [];
  for (let i = 0; i < octaves; i++) layers.push(createPerlin2D(seed + i * 7919 + 13));
  let norm = 0;
  let amp = 1;
  for (let i = 0; i < octaves; i++) {
    norm += amp;
    amp *= gain;
  }
  const invNorm = 1 / norm;
  const baseFreq = 1 / Math.max(0.0001, wavelength);
  return (x, y) => {
    let sum = 0;
    let a = 1;
    let f = baseFreq;
    for (let i = 0; i < octaves; i++) {
      sum += layers[i](x * f, y * f) * a;
      f *= lacunarity;
      a *= gain;
    }
    return sum * invNorm;
  };
};

// ── Small helpers ───────────────────────────────────────────────────────────

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const unit = (n: number): number => clamp01(n * 0.5 + 0.5);
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

// ── Sampled grid ────────────────────────────────────────────────────────────
// Every mask query happens inside a Bridson candidate loop (30 candidates
// per active point), so a level's placement pass would evaluate the field
// hundreds of thousands of times. Baking each field onto a coarse grid once
// and bilinearly interpolating keeps that to a few thousand noise calls,
// and the interpolation is smoother than the raw field anyway.

// 0.7 world units. The narrowest field feature is the ~7-unit patch
// wavelength, so this still gives ~10 samples across it, and halving the
// resolution again would be visible as stair-stepping in the mask edges.
const GRID_CELL = 0.7;

type GridShape = {
  cols: number;
  rows: number;
  minX: number;
  minY: number;
  invCell: number;
};

type Grid = GridShape & { data: Float32Array };

const gridShape = (bounds: LandscapeBounds): GridShape => ({
  cols: Math.max(2, Math.ceil((bounds.maxX - bounds.minX) / GRID_CELL) + 1),
  rows: Math.max(2, Math.ceil((bounds.maxY - bounds.minY) / GRID_CELL) + 1),
  minX: bounds.minX,
  minY: bounds.minY,
  invCell: 1 / GRID_CELL,
});

const emptyGrid = (shape: GridShape): Grid => ({
  ...shape,
  data: new Float32Array(shape.cols * shape.rows),
});

const sampleGrid = (g: Grid, x: number, y: number): number => {
  const fx = (x - g.minX) * g.invCell;
  const fy = (y - g.minY) * g.invCell;
  let c0 = Math.floor(fx);
  let r0 = Math.floor(fy);
  const tx = fx - c0;
  const ty = fy - r0;
  if (c0 < 0) c0 = 0;
  if (r0 < 0) r0 = 0;
  if (c0 > g.cols - 2) c0 = g.cols - 2;
  if (r0 > g.rows - 2) r0 = g.rows - 2;
  const i = r0 * g.cols + c0;
  const v00 = g.data[i];
  const v10 = g.data[i + 1];
  const v01 = g.data[i + g.cols];
  const v11 = g.data[i + g.cols + 1];
  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
};

// ── Landscape ───────────────────────────────────────────────────────────────

/**
 * Which terrain story a prop layer belongs to. Picking the right mask is
 * what makes a scatter read as designed: conifers march up the moist
 * lowland, boulders collect on the dry ridge, grass thins where the two
 * meet.
 */
export type LandscapeMask =
  | "canopy" // full-size trees — the strongest clustering
  | "understory" // bushes, ferns, saplings: near canopy but softer
  | "groundCover" // grass/pebble carpet: broad, mild variation
  | "damp" // mushrooms, flowers: follows moisture, avoids ridges
  | "rock" // boulders, crystals, debris: slope + dryness
  | "open"; // props that want the clearings between stands

export type LandscapeField = {
  seed: number;
  bounds: LandscapeBounds;
  elevation: (x: number, y: number) => number;
  slope: (x: number, y: number) => number;
  moisture: (x: number, y: number) => number;
  fertility: (x: number, y: number) => number;
  rockiness: (x: number, y: number) => number;
  /** 0 in the playable middle, rising to 1 at the map rim. */
  edgeBoost: (x: number, y: number) => number;
  /** Layer density multiplier in [0, 1] for the given mask. */
  density: (mask: LandscapeMask, x: number, y: number) => number;
  /** Stable index in [0, count) that varies slowly across the map, so
   *  neighbouring props pick the same model and form single-species stands. */
  standAt: (x: number, y: number, count: number) => number;
  /** Deterministic per-position value in [0, 1) — for accept/reject rolls
   *  that must not depend on the order candidates were generated in. */
  hash: (x: number, y: number) => number;
};

export type LandscapeConfig = {
  seed: number;
  bounds: LandscapeBounds;
  /**
   * Optional extra wetness in [0, 1] contributed by authored water (rivers,
   * lakes). Callers pass a probe over their flow features so vegetation
   * banks up along the shore instead of ignoring it.
   */
  wetnessAt?: (x: number, y: number) => number;
  /**
   * Fraction of the half-extent, measured inward from the rim, over which
   * edgeBoost ramps from 0 to 1. Larger = the thickening starts further in.
   */
  edgeBandFrac?: number;
  /**
   * Rect the edge thickening is measured against — normally the playable
   * map, while `bounds` covers the wider area props may occupy. Defaults
   * to `bounds`.
   */
  edgeBounds?: LandscapeBounds;
};

// Wavelengths in world units. Elevation is the broadest shape (a couple of
// ridges across a 40×24 map), moisture a little broader still so a wet belt
// spans several groves, and the detail octave is grove-sized.
const ELEVATION_WAVELENGTH = 15;
const MOISTURE_WAVELENGTH = 19;
const PATCH_WAVELENGTH = 7.5;
const STAND_WAVELENGTH = 9;
const WARP_WAVELENGTH = 21;
// How far (world units) the domain warp can drag a sample. Without it the
// fields look like smooth blobs; with it the boundaries meander the way
// real treelines and scree edges do.
const WARP_STRENGTH = 5.5;
// Finite-difference step for the elevation gradient, in world units.
const SLOPE_EPS = 0.7;
// Elevation change per SLOPE_EPS that reads as "fully steep".
const SLOPE_FULL = 0.16;

export const createLandscapeField = (cfg: LandscapeConfig): LandscapeField => {
  const { seed, bounds } = cfg;
  const s = seed >>> 0;

  const warpX = createFbm2D(s + 101, { octaves: 2, wavelength: WARP_WAVELENGTH });
  const warpY = createFbm2D(s + 211, { octaves: 2, wavelength: WARP_WAVELENGTH });
  const elevNoise = createFbm2D(s + 307, { octaves: 4, wavelength: ELEVATION_WAVELENGTH });
  const moistNoise = createFbm2D(s + 409, { octaves: 3, wavelength: MOISTURE_WAVELENGTH });
  const patchNoise = createFbm2D(s + 521, { octaves: 3, wavelength: PATCH_WAVELENGTH });
  const rockPatch = createFbm2D(s + 631, { octaves: 3, wavelength: PATCH_WAVELENGTH * 1.3 });
  const standNoise = createFbm2D(s + 743, { octaves: 2, wavelength: STAND_WAVELENGTH });

  // Every field is baked in one sweep of the grid: the domain warp is the
  // most expensive part and both the elevation and moisture lookups want the
  // same offsets, so computing it once per cell roughly halves the noise
  // work. The whole bake runs once per level, behind getLandscapeField's
  // cache, and the placement passes then only do bilinear lookups.
  const shape = gridShape(bounds);
  const elevationGrid = emptyGrid(shape);
  const slopeGrid = emptyGrid(shape);
  const moistureGrid = emptyGrid(shape);
  const fertilityGrid = emptyGrid(shape);
  const rockinessGrid = emptyGrid(shape);
  const { cols, rows } = shape;

  const rawMoist = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const y = bounds.minY + r * GRID_CELL;
    for (let c = 0; c < cols; c++) {
      const x = bounds.minX + c * GRID_CELL;
      const ox = warpX(x, y) * WARP_STRENGTH;
      const oy = warpY(x + 57.3, y - 31.7) * WARP_STRENGTH;
      const i = r * cols + c;
      elevationGrid.data[i] = unit(elevNoise(x + ox, y + oy));
      rawMoist[i] = unit(moistNoise(x + ox, y + oy));
    }
  }

  // Slope is a finite difference on the *baked* elevation rather than the
  // raw field, so it agrees with what every other mask reads. SLOPE_EPS is
  // expressed in world units and rounded to whole cells.
  const slopeStep = Math.max(1, Math.round(SLOPE_EPS / GRID_CELL));
  const slopeSpan = slopeStep * GRID_CELL;
  const clampIdx = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const xl = elevationGrid.data[r * cols + clampIdx(c - slopeStep, cols - 1)];
      const xr = elevationGrid.data[r * cols + clampIdx(c + slopeStep, cols - 1)];
      const yd = elevationGrid.data[clampIdx(r - slopeStep, rows - 1) * cols + c];
      const yu = elevationGrid.data[clampIdx(r + slopeStep, rows - 1) * cols + c];
      const dx = (xr - xl) / 2;
      const dy = (yu - yd) / 2;
      const mag = Math.sqrt(dx * dx + dy * dy) * (SLOPE_EPS / slopeSpan);
      slopeGrid.data[r * cols + c] = clamp01(mag / SLOPE_FULL);
    }
  }

  const wetnessAt = cfg.wetnessAt;
  for (let r = 0; r < rows; r++) {
    const y = bounds.minY + r * GRID_CELL;
    for (let c = 0; c < cols; c++) {
      const x = bounds.minX + c * GRID_CELL;
      const i = r * cols + c;
      const elev = elevationGrid.data[i];
      // Water collects low: the bottom of the elevation range is damp even
      // where the moisture field alone says otherwise.
      const valley = smoothstep(0.62, 0.2, elev);
      let m = rawMoist[i] * 0.62 + valley * 0.38;
      if (wetnessAt) m = Math.max(m, clamp01(wetnessAt(x, y)));
      m = clamp01(m);
      moistureGrid.data[i] = m;

      const st = slopeGrid.data[i];
      // Vegetation likes moisture and flat ground, and clumps at grove scale.
      const patch = unit(patchNoise(x, y));
      const v = m ** 0.85 * (1 - st) ** 1.35 * (0.45 + 0.55 * patch);
      // Sharpen so there are real stands and real clearings instead of an
      // everywhere-medium haze.
      fertilityGrid.data[i] = smoothstep(0.12, 0.55, v);

      // Rock wants the opposite: steep, dry, high ground, in its own patches
      // so a scree field doesn't simply mirror the treeline.
      const rp = unit(rockPatch(x, y));
      const rv =
        (st * 0.45 + (1 - m) * 0.3 + smoothstep(0.35, 0.85, elev) * 0.25) * (0.4 + 0.6 * rp);
      rockinessGrid.data[i] = smoothstep(0.14, 0.58, rv);
    }
  }

  const elevation = (x: number, y: number) => sampleGrid(elevationGrid, x, y);
  const slope = (x: number, y: number) => sampleGrid(slopeGrid, x, y);
  const moisture = (x: number, y: number) => sampleGrid(moistureGrid, x, y);
  const fertility = (x: number, y: number) => sampleGrid(fertilityGrid, x, y);
  const rockiness = (x: number, y: number) => sampleGrid(rockinessGrid, x, y);

  // Edge thickening. Denser scenery around the rim frames the playable
  // middle and hides the ground plane's horizon without crowding the lanes.
  const eb = cfg.edgeBounds ?? bounds;
  const cx = (eb.minX + eb.maxX) / 2;
  const cy = (eb.minY + eb.maxY) / 2;
  const halfW = Math.max(0.001, (eb.maxX - eb.minX) / 2);
  const halfH = Math.max(0.001, (eb.maxY - eb.minY) / 2);
  const bandFrac = cfg.edgeBandFrac ?? 0.42;
  const edgeBoost = (x: number, y: number): number => {
    // Chebyshev-style: distance to the *nearest* rim, not the corner, so
    // the thickening follows the frame rather than pooling in corners.
    const t = Math.max(Math.abs(x - cx) / halfW, Math.abs(y - cy) / halfH);
    return smoothstep(1 - bandFrac, 1, t);
  };

  const standNorm = (x: number, y: number) => unit(standNoise(x, y));

  const density = (mask: LandscapeMask, x: number, y: number): number => {
    const edge = edgeBoost(x, y);
    switch (mask) {
      case "canopy": {
        const f = fertility(x, y);
        return clamp01(f * 0.85 + edge * 0.3);
      }
      case "understory": {
        const f = fertility(x, y);
        // Bushes ring the stands rather than sitting dead centre under the
        // canopy — peak at mid fertility, taper at both ends.
        const ring = 1 - Math.abs(f - 0.62) * 1.5;
        return clamp01(Math.max(f * 0.55, ring * 0.9) + edge * 0.22);
      }
      case "groundCover": {
        const f = fertility(x, y);
        const m = moisture(x, y);
        // Carpet layers should still cover most of the map — a floor of
        // 0.42 keeps clearings grassy, the field just makes them breathe.
        return clamp01(0.42 + (f * 0.4 + m * 0.25) + edge * 0.12);
      }
      case "damp": {
        const m = moisture(x, y);
        const f = fertility(x, y);
        return clamp01(m ** 1.6 * 0.75 + f * 0.35);
      }
      case "rock":
        return clamp01(rockiness(x, y) * 0.9 + edge * 0.25);
      case "open": {
        const f = fertility(x, y);
        const r = rockiness(x, y);
        return clamp01((1 - Math.max(f, r)) * 0.85 + 0.15);
      }
      default:
        return 1;
    }
  };

  const standAt = (x: number, y: number, count: number): number => {
    if (count <= 1) return 0;
    const t = standNorm(x, y);
    const idx = Math.floor(t * count);
    return idx >= count ? count - 1 : idx < 0 ? 0 : idx;
  };

  // Position hash — quantized so two candidates a hair apart don't get
  // wildly different rolls, and seeded so re-rolling the level re-rolls
  // the accept pattern too.
  const hash = (x: number, y: number): number => {
    const xi = Math.round(x * 64) | 0;
    const yi = Math.round(y * 64) | 0;
    let h = (xi * 374761393 + yi * 668265263 + s * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  return {
    seed: s,
    bounds,
    elevation,
    slope,
    moisture,
    fertility,
    rockiness,
    edgeBoost,
    density,
    standAt,
    hash,
  };
};

// ── Placement helpers ───────────────────────────────────────────────────────

/**
 * Poisson spacing for a density value: `dense` where the mask is 1, up to
 * `sparse` where it is 0. Squaring the interpolation keeps near-peak areas
 * genuinely tight (a stand should look packed) while the tail opens out
 * quickly.
 */
export const spacingForDensity = (d: number, dense: number, sparse: number): number => {
  const t = clamp01(d);
  return sparse + (dense - sparse) * (t * t * (3 - 2 * t));
};

/**
 * Accept/reject test that turns a soft density into real clearings.
 * Spacing alone only ever thins a region out; without a cut, low-density
 * ground still fills in once Bridson runs out of room elsewhere.
 * `floor` keeps a trickle everywhere so nothing looks stencilled.
 */
export const passesDensityCut = (
  field: LandscapeField,
  d: number,
  x: number,
  y: number,
  floor = 0.12,
): boolean => field.hash(x, y) < floor + (1 - floor) * clamp01(d);

/**
 * Per-instance scale factor in [0, 1] biased by the local density: props in
 * the core of a stand grow to the top of their band, stragglers at the
 * fringe stay small. `jitter` is the caller's RNG draw, blended in so the
 * result still varies between neighbours.
 */
export const scaleTFromDensity = (d: number, jitter: number, weight = 0.55): number =>
  clamp01(clamp01(d) * weight + jitter * (1 - weight));

/**
 * Model choice for a prop at (x, y): mostly the local stand's species, with
 * a small chance of an outlier so stands don't read as flat-shaded blocks.
 */
export const variantForStand = (
  field: LandscapeField,
  x: number,
  y: number,
  count: number,
  jitter: number,
  strayChance = 0.18,
): number => {
  if (count <= 1) return 0;
  if (jitter < strayChance) return Math.floor((jitter / strayChance) * count) % count;
  return field.standAt(x, y, count);
};

/**
 * Which mask a prop layer should follow, inferred from its model URLs.
 * Ground cover keeps the carpet masks (which have a generous floor) so the
 * map still reads as full; everything else is classified by what the model
 * actually is.
 */
export const landscapeMaskForUrls = (
  urls: ReadonlyArray<string>,
  groundCover = false,
): LandscapeMask => {
  const f = (urls[0] ?? "").toLowerCase();
  if (/mushroom|flower|lilypad|cattail/.test(f)) return "damp";
  if (groundCover) return "groundCover";
  if (/tree|palm|cactus|pine|conifer|dead/.test(f)) return "canopy";
  if (/bush|shrub|grass|fern|plant/.test(f)) return "understory";
  if (/rock|stone|pebble|boulder|crystal|meteor|debris|bone|skull|log|stump|ruin/.test(f))
    return "rock";
  return "understory";
};

// ── Shared per-level field ──────────────────────────────────────────────────
// Trees/rocks (sim) and the decor layers (render) must read the *same*
// landscape or the bushes cluster somewhere the trees don't, which looks
// worse than plain uniform scatter. Both sides go through this cache with
// the same key, so one bake serves the whole level.

const FIELD_CACHE_LIMIT = 6;
const fieldCache = new Map<string, LandscapeField>();

export const getLandscapeField = (key: string, build: () => LandscapeField): LandscapeField => {
  const hit = fieldCache.get(key);
  if (hit) {
    // Refresh LRU position.
    fieldCache.delete(key);
    fieldCache.set(key, hit);
    return hit;
  }
  const field = build();
  fieldCache.set(key, field);
  if (fieldCache.size > FIELD_CACHE_LIMIT) {
    const oldest = fieldCache.keys().next().value;
    if (oldest !== undefined) fieldCache.delete(oldest);
  }
  return field;
};
