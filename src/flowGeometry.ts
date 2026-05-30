import type { Biome } from "./biomes";
import { MAP_HEIGHT, MAP_WIDTH, PATH_WIDTH } from "./level";
import { mulberry32 } from "./sim/random";
import type { Vec2 } from "./sim/types";
import { distPointToSegSq } from "./sim/vec2";

// Per-biome palettes for the rendered river/lake meshes. Kept here next
// to the geometry so the renderer can read both from one place.
export type FlowPalette = {
  fluidColor: string;
  fluidEmissive: string;
  fluidEmissiveIntensity: number;
  bridgeDeck: string;
  bridgeTrim: string;
};

// Per-biome flow shape: how many rivers, how many lakes, whether to bridge
// path crossings, and the visual palette. Biomes without flow features
// (desert, snow, wasteland) are represented as `null`.
//   - lava   : two molten rivers (h + v) + 5 lakes, bridges
//   - forest : one meandering water channel + 2 small ponds, bridges
//   - alien  : no rivers — only static goo puddles (8 of them), no bridges
export type FlowConfig = {
  riverCount: number;
  riverWidth: number;
  lakeCount: number;
  // Lake half-axes are sampled in [lakeMin, lakeMin+lakeRange] world units.
  lakeMin: number;
  lakeRange: number;
  bridges: boolean;
  palette: FlowPalette;
};

const LAVA_PALETTE: FlowPalette = {
  fluidColor: "#ff6a1c",
  fluidEmissive: "#ff5010",
  fluidEmissiveIntensity: 1.6,
  bridgeDeck: "#2e1a10",
  bridgeTrim: "#7a3a1e",
};

// Forest river palette — water-blue, very mild emissive so the water
// reads as wet under direct sun without glowing in fog. Bridges are a
// warmer pine/oak deck on darker stained trim.
const FOREST_PALETTE: FlowPalette = {
  fluidColor: "#3a82c6",
  fluidEmissive: "#1a4870",
  fluidEmissiveIntensity: 0.18,
  bridgeDeck: "#5a3c20",
  bridgeTrim: "#3a2614",
};

// Alien goo — cyan-on-violet. Static puddles read better with a deeper
// teal base and lower emissive than the old "river" mix; the previous
// near-white emissive at 1.2 intensity bloomed the puddles into white
// discs once the rivers stopped competing for visual weight.
// Bridges aren't used since alien only has lakes, but the trim colors
// are kept for completeness.
const ALIEN_PALETTE: FlowPalette = {
  fluidColor: "#3ad6b0",
  fluidEmissive: "#5affc8",
  fluidEmissiveIntensity: 0.55,
  bridgeDeck: "#1f1230",
  bridgeTrim: "#4a2a70",
};

const FLOW_CONFIG: Partial<Record<Biome, FlowConfig>> = {
  lava: {
    riverCount: 2,
    riverWidth: 2.2,
    lakeCount: 5,
    lakeMin: 1.2,
    lakeRange: 1.6,
    bridges: true,
    palette: LAVA_PALETTE,
  },
  forest: {
    // One meandering channel that snakes edge-to-edge across the map +
    // small ponds. Branching looked broken on the water shader (flow
    // direction mismatch at the join), so river systems are kept as a
    // single continuous polyline.
    riverCount: 1,
    riverWidth: 1.8,
    lakeCount: 2,
    lakeMin: 0.9,
    lakeRange: 1.0,
    bridges: true,
    palette: FOREST_PALETTE,
  },
  alien: {
    // Static puddles only — goo doesn't flow on the alien plane. Puddles
    // are larger and more numerous to compensate for the absent rivers.
    riverCount: 0,
    riverWidth: 0,
    lakeCount: 8,
    lakeMin: 1.4,
    lakeRange: 1.8,
    bridges: false,
    palette: ALIEN_PALETTE,
  },
};

export const getFlowConfig = (biome: Biome): FlowConfig | null => FLOW_CONFIG[biome] ?? null;

// Biomes that have any flow features at all (rivers, lakes, or both).
// Trees/rocks/cosmetics consult this to know whether to query
// `isOnFlowSurface` for placement filtering.
export const hasFlowFeatures = (biome: string): boolean => Boolean(FLOW_CONFIG[biome as Biome]);

export type River = { points: Vec2[]; width: number };
export type Lake = { x: number; y: number; rx: number; ry: number; rot: number };
// Two bridge shapes:
//   - rect: a deck spanning a single path×river crossing (the default).
//   - plaza: a disc that absorbs multiple overlapping crossings, e.g. when
//     two paths meet on a river (L24 Cascade) or four paths converge on
//     a center crossing (L22 Maelstrom). Without this, the rect bridges
//     visually pierce each other in an X with mismatched railings.
export type RectBridge = { kind: "rect"; pos: Vec2; rotY: number; length: number };
export type PlazaBridge = { kind: "plaza"; pos: Vec2; radius: number };
export type Bridge = RectBridge | PlazaBridge;

// Internal structure carrying provenance — only different-path bridges
// merge, so a single path's meander-crossings (same path, same river)
// never pull each other into a plaza. The pathIdx is dropped before the
// renderer sees the result.
type SourcedRect = RectBridge & { pathIdx: number };
export type FlowFeatures = { rivers: River[]; lakes: Lake[]; bridges: Bridge[] };

// Same shape as Bridge but carries the ids of every river that contributed
// to it. Used by the editor's bridge resolver to key bridges across commits
// so user overrides (dragged plaza centre, custom radius) stick to the
// same underlying crossing as the user paints around it.
export type BridgeWithProvenance =
  | (RectBridge & { riverIds: string[] })
  | (PlazaBridge & { riverIds: string[] });

// Meandering polyline crossing the map on the chosen axis. Endpoints push
// well past the max-panned viewport (visible half ≈ 24 + pan ≈ 16 = 40 on
// X) so the river clearly runs off the screen at any zoom/pan. Shape is
// two smooth sinusoidal octaves — the higher one used to be per-vertex
// random jitter, but that left a visibly faceted bank silhouette on a
// 10-segment polyline; a second sine gives the same organic variation
// without the spikes, and we resample finely enough that adjacent
// segments are shorter than the river is wide.
// Catmull-Rom 1D interpolation between four control values. Used to smooth
// the damped-random-walk control sequence into a continuous polyline.
const catmullRom1D = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
};

// Generate a river as a damped random walk in the cross-axis coord,
// smoothed with Catmull-Rom interpolation. Real rivers don't oscillate
// like a sine — they meander irregularly, sometimes tight, sometimes
// loose, with occasional sharp bends and long lazy stretches. The walk
// gives that: each control point's cross-coord is the previous one plus
// a velocity that itself wanders (so curvature is correlated across
// adjacent controls, like real meander wavelength), with a soft pull-back
// toward the baseline so the river doesn't drift off the playfield.
//
// The candidate-picker still rejects layouts that overlap paths, so we
// can afford generous excursions and let the picker filter.
const RIVER_CONTROLS = 11;
const RIVER_VEL_DECAY = 0.72;
const RIVER_STEP_AMP = 3.2;
const RIVER_PULL_BACK = 0.05;
const RIVER_MAX_EXCURSION = 9.5;
const buildRiver = (rng: () => number, axis: "h" | "v"): Vec2[] => {
  const N = 48;
  const margin = 16;
  const axisLen = axis === "h" ? MAP_WIDTH : MAP_HEIGHT;
  const crossSpan = axis === "h" ? MAP_HEIGHT : MAP_WIDTH;
  const baseCross = (rng() - 0.5) * crossSpan * 0.35;
  const axisStart = -axisLen / 2 - margin;
  const axisFullSpan = axisLen + 2 * margin;

  // Damped random walk in cross-axis coord. `vel` carries momentum so
  // the curvature has a natural wavelength rather than per-step jitter.
  const ctrl: number[] = [];
  let val = (rng() - 0.5) * 3.0;
  let vel = (rng() - 0.5) * 2.0;
  for (let k = 0; k < RIVER_CONTROLS; k++) {
    ctrl.push(val);
    vel = vel * RIVER_VEL_DECAY + (rng() - 0.5) * RIVER_STEP_AMP;
    val = val + vel - val * RIVER_PULL_BACK;
    if (val > RIVER_MAX_EXCURSION) {
      val = RIVER_MAX_EXCURSION;
      vel = -Math.abs(vel) * 0.5;
    } else if (val < -RIVER_MAX_EXCURSION) {
      val = -RIVER_MAX_EXCURSION;
      vel = Math.abs(vel) * 0.5;
    }
  }

  const out: Vec2[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const axisCoord = axisStart + t * axisFullSpan;
    // Map t to a position in the control-point list; Catmull-Rom needs
    // four samples (k-1, k, k+1, k+2) clamped at the ends.
    const u = t * (RIVER_CONTROLS - 1);
    const ki = Math.min(RIVER_CONTROLS - 2, Math.floor(u));
    const tu = u - ki;
    const p0 = ctrl[Math.max(0, ki - 1)];
    const p1 = ctrl[ki];
    const p2 = ctrl[Math.min(RIVER_CONTROLS - 1, ki + 1)];
    const p3 = ctrl[Math.min(RIVER_CONTROLS - 1, ki + 2)];
    const cross = baseCross + catmullRom1D(p0, p1, p2, p3, tu);
    if (axis === "h") out.push({ x: axisCoord, y: cross });
    else out.push({ x: cross, y: axisCoord });
  }
  return out;
};

// Penalty for how badly a river layout interferes with the regular paths.
// Two terms:
//   - Parallel proximity: river segment runs close to a path segment AT a
//     small angle. Reads as the river awkwardly tracing the path.
//   - Oblique crossing: river segment crosses a path segment at a shallow
//     angle. Bridges still get built but the deck is wide and ugly, and
//     the river spends a long stretch bracketing the path.
// Right-angle crossings cost ~0; far-from-path geometry costs 0. The
// candidate-picker minimises this.
const RIVER_PROXIMITY_MARGIN = 1.5;
const RIVER_PARALLEL_COS = Math.cos((40 * Math.PI) / 180);
const scoreRiverPathInteraction = (river: Vec2[], paths: Vec2[][], riverWidth: number): number => {
  if (paths.length === 0) return 0;
  const proximityThreshold = riverWidth / 2 + PATH_WIDTH / 2 + RIVER_PROXIMITY_MARGIN;
  const proxSq = proximityThreshold * proximityThreshold;
  let cost = 0;
  for (let ri = 0; ri < river.length - 1; ri++) {
    const r1 = river[ri];
    const r2 = river[ri + 1];
    const rdx = r2.x - r1.x;
    const rdy = r2.y - r1.y;
    const rLen = Math.hypot(rdx, rdy);
    if (rLen < 1e-6) continue;
    const rtx = rdx / rLen;
    const rty = rdy / rLen;
    const rmx = (r1.x + r2.x) * 0.5;
    const rmy = (r1.y + r2.y) * 0.5;
    for (const path of paths) {
      for (let pi = 0; pi < path.length - 1; pi++) {
        const p1 = path[pi];
        const p2 = path[pi + 1];
        const pdx = p2.x - p1.x;
        const pdy = p2.y - p1.y;
        const pLen = Math.hypot(pdx, pdy);
        if (pLen < 1e-6) continue;
        const ptx = pdx / pLen;
        const pty = pdy / pLen;
        // |cos(θ)|: 1 = parallel, 0 = perpendicular.
        const cosA = Math.abs(rtx * ptx + rty * pty);
        if (segIntersect(r1, r2, p1, p2)) {
          // Crossings: cost is 0 at perpendicular (cosA=0), 6.25 at 45°
          // (cosA²=0.5), 25 at near-parallel grazing crossings.
          cost += cosA * cosA * 25;
          continue;
        }
        // Non-crossing: only penalise when the river is BOTH close AND
        // running roughly parallel to the path. Anything < 40° from the
        // path direction counts as parallel.
        if (cosA <= RIVER_PARALLEL_COS) continue;
        const d2 = distPointToSegSq(rmx, rmy, p1.x, p1.y, p2.x, p2.y);
        if (d2 >= proxSq) continue;
        const closeness = 1 - Math.sqrt(d2) / proximityThreshold;
        cost += rLen * cosA * cosA * closeness * 12;
      }
    }
  }
  return cost;
};

// Candidate-picker: try N rng-seeded river layouts, score each against the
// paths, return the lowest-cost one. The first candidate uses the shared
// `baseRng` on the preferred axis so downstream consumers (lakes) see the
// SAME rng sequence as before — old levels are unchanged unless a better
// candidate is found. Subsequent candidates spin private mulberry32
// sub-rngs so they don't perturb the shared stream. Half of the extra
// candidates flip to the off-axis with a small surcharge — flips happen
// only when the off-axis layout beats the preferred-axis best by enough
// to overcome the surcharge (e.g. when every horizontal layout would run
// parallel to a stack of horizontal paths).
const RIVER_CANDIDATES = 16;
const OFF_AXIS_PENALTY = 30;
const buildBestRiver = (
  baseRng: () => number,
  candidateSeed: number,
  preferredAxis: "h" | "v",
  paths: Vec2[][],
  riverWidth: number,
): Vec2[] => {
  let best = buildRiver(baseRng, preferredAxis);
  let bestCost = scoreRiverPathInteraction(best, paths, riverWidth);
  const otherAxis: "h" | "v" = preferredAxis === "h" ? "v" : "h";
  for (let i = 1; i < RIVER_CANDIDATES; i++) {
    const candRng = mulberry32(candidateSeed + i * 12345);
    const axis = i % 2 === 0 ? preferredAxis : otherAxis;
    const candidate = buildRiver(candRng, axis);
    const surcharge = axis === preferredAxis ? 0 : OFF_AXIS_PENALTY;
    const cost = scoreRiverPathInteraction(candidate, paths, riverWidth) + surcharge;
    if (cost < bestCost) {
      bestCost = cost;
      best = candidate;
    }
  }
  return best;
};

const buildLakes = (
  rng: () => number,
  paths: Vec2[][],
  rivers: Vec2[][],
  config: FlowConfig,
): Lake[] => {
  const lakes: Lake[] = [];
  const target = config.lakeCount;
  // Tries scale with the target so dense puddle biomes get enough retries
  // to land all of them rather than capping at the old 240-attempt budget.
  const maxTries = Math.max(240, target * 60);
  let tries = 0;
  while (lakes.length < target && tries < maxTries) {
    tries++;
    const x = (rng() - 0.5) * MAP_WIDTH * 0.85;
    const y = (rng() - 0.5) * MAP_HEIGHT * 0.85;
    const rx = config.lakeMin + rng() * config.lakeRange;
    const ry = config.lakeMin + rng() * config.lakeRange;
    const r = Math.max(rx, ry);

    const pathClear = r + PATH_WIDTH / 2 + 0.4;
    let blocked = false;
    for (const path of paths) {
      for (let i = 0; i < path.length - 1; i++) {
        if (
          distPointToSegSq(x, y, path[i].x, path[i].y, path[i + 1].x, path[i + 1].y) <
          pathClear * pathClear
        ) {
          blocked = true;
          break;
        }
      }
      if (blocked) break;
    }
    if (blocked) continue;

    // Lakes can sit close to rivers (reads as a pool fed by a stream) but
    // not overlap them so much that the river endpoints get swallowed.
    const riverClear = r + config.riverWidth * 0.2;
    for (const river of rivers) {
      for (let i = 0; i < river.length - 1; i++) {
        if (
          distPointToSegSq(x, y, river[i].x, river[i].y, river[i + 1].x, river[i + 1].y) <
          riverClear * riverClear
        ) {
          blocked = true;
          break;
        }
      }
      if (blocked) break;
    }
    if (blocked) continue;

    let overlap = false;
    for (const l of lakes) {
      const dx = l.x - x;
      const dy = l.y - y;
      const minD = Math.max(l.rx, l.ry) + r + 0.5;
      if (dx * dx + dy * dy < minD * minD) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;

    lakes.push({ x, y, rx, ry, rot: rng() * Math.PI * 2 });
  }
  return lakes;
};

const segIntersect = (a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null => {
  const rx = a2.x - a1.x;
  const ry = a2.y - a1.y;
  const sx = b2.x - b1.x;
  const sy = b2.y - b1.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const dx = b1.x - a1.x;
  const dy = b1.y - a1.y;
  const t = (dx * sy - dy * sx) / denom;
  const u = (dx * ry - dy * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a1.x + t * rx, y: a1.y + t * ry };
};

// At each path × river crossing emit a bridge whose long axis follows the
// path. Length is widened when the crossing is oblique so the deck still
// covers the river's footprint along the path direction. Bridge length scales
// with river width so tributary crossings get smaller decks.
const BRIDGE_OVERHANG = 2.2;
export const computeBridges = (paths: Vec2[][], rivers: River[]): Bridge[] => {
  const rects: SourcedRect[] = [];
  for (let pIdx = 0; pIdx < paths.length; pIdx++) {
    const path = paths[pIdx];
    for (let pi = 0; pi < path.length - 1; pi++) {
      const a = path[pi];
      const b = path[pi + 1];
      const pdx = b.x - a.x;
      const pdy = b.y - a.y;
      const pLen = Math.hypot(pdx, pdy);
      if (pLen < 1e-6) continue;
      const ptx = pdx / pLen;
      const pty = pdy / pLen;
      const rotY = Math.atan2(-pdy, pdx);

      for (const river of rivers) {
        const pts = river.points;
        for (let ri = 0; ri < pts.length - 1; ri++) {
          const r1 = pts[ri];
          const r2 = pts[ri + 1];
          const hit = segIntersect(a, b, r1, r2);
          if (!hit) continue;

          const rdx = r2.x - r1.x;
          const rdy = r2.y - r1.y;
          const rLen = Math.hypot(rdx, rdy);
          if (rLen < 1e-6) continue;
          const sinTheta = Math.abs(ptx * (rdy / rLen) - pty * (rdx / rLen));
          const projected = river.width / Math.max(0.25, sinTheta);
          rects.push({
            kind: "rect",
            pos: hit,
            rotY,
            length: projected + BRIDGE_OVERHANG,
            pathIdx: pIdx,
          });
        }
      }
    }
  }
  return mergeOverlappingBridges(consolidateSamePathBridges(rects));
};

// Provenance-tracking sibling of computeBridges — same intersection /
// consolidate / X-merge algorithm, but every output rect/plaza carries
// the array of river ids that fed into it. The editor's bridge resolver
// keys off these ids so user overrides (custom plaza radius, dragged
// centre) stick to the same crossing as rivers are repainted.
type SourcedRectProv = SourcedRect & { riverIds: string[] };
type RiverWithId = { id: string; points: Vec2[]; width: number };
export const computeBridgesWithProvenance = (
  paths: Vec2[][],
  rivers: RiverWithId[],
): BridgeWithProvenance[] => {
  const rects: SourcedRectProv[] = [];
  for (let pIdx = 0; pIdx < paths.length; pIdx++) {
    const path = paths[pIdx];
    for (let pi = 0; pi < path.length - 1; pi++) {
      const a = path[pi];
      const b = path[pi + 1];
      const pdx = b.x - a.x;
      const pdy = b.y - a.y;
      const pLen = Math.hypot(pdx, pdy);
      if (pLen < 1e-6) continue;
      const ptx = pdx / pLen;
      const pty = pdy / pLen;
      const rotY = Math.atan2(-pdy, pdx);

      for (const river of rivers) {
        const pts = river.points;
        for (let ri = 0; ri < pts.length - 1; ri++) {
          const r1 = pts[ri];
          const r2 = pts[ri + 1];
          const hit = segIntersect(a, b, r1, r2);
          if (!hit) continue;
          const rdx = r2.x - r1.x;
          const rdy = r2.y - r1.y;
          const rLen = Math.hypot(rdx, rdy);
          if (rLen < 1e-6) continue;
          const sinTheta = Math.abs(ptx * (rdy / rLen) - pty * (rdx / rLen));
          const projected = river.width / Math.max(0.25, sinTheta);
          rects.push({
            kind: "rect",
            pos: hit,
            rotY,
            length: projected + BRIDGE_OVERHANG,
            pathIdx: pIdx,
            riverIds: [river.id],
          });
        }
      }
    }
  }
  return mergeOverlappingBridgesProv(consolidateSamePathBridgesProv(rects));
};

const consolidateSamePathBridgesProv = (rects: SourcedRectProv[]): SourcedRectProv[] => {
  const out: SourcedRectProv[] = [];
  for (const b of rects) {
    let merged = false;
    for (let k = 0; k < out.length; k++) {
      const c = out[k];
      if (c.pathIdx !== b.pathIdx) continue;
      const dx = c.pos.x - b.pos.x;
      const dy = c.pos.y - b.pos.y;
      if (dx * dx + dy * dy >= SAME_PATH_DIST_SQ) continue;
      // Keep the longer deck representative and union the river ids so a
      // single bridge attributes to every river segment that pierces this
      // crossing event.
      const unionIds = unionRiverIds(c.riverIds, b.riverIds);
      if (b.length > c.length) {
        out[k] = { ...b, riverIds: unionIds };
      } else {
        out[k] = { ...c, riverIds: unionIds };
      }
      merged = true;
      break;
    }
    if (!merged) out.push(b);
  }
  return out;
};

const mergeOverlappingBridgesProv = (rects: SourcedRectProv[]): BridgeWithProvenance[] => {
  const n = rects.length;
  if (n === 0) return [];
  if (n === 1) {
    const r = rects[0];
    return [{ kind: "rect", pos: r.pos, rotY: r.rotY, length: r.length, riverIds: r.riverIds }];
  }
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    while (parent[i] !== r) {
      const next = parent[i];
      parent[i] = r;
      i = next;
    }
    return r;
  };
  const distSq = BRIDGE_MERGE_DIST * BRIDGE_MERGE_DIST;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (rects[i].pathIdx === rects[j].pathIdx) continue;
      const dx = rects[i].pos.x - rects[j].pos.x;
      const dy = rects[i].pos.y - rects[j].pos.y;
      if (dx * dx + dy * dy >= distSq) continue;
      if (angleBetween(rects[i].rotY, rects[j].rotY) < BRIDGE_MERGE_ANGLE) continue;
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[ri] = rj;
    }
  }
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const arr = clusters.get(r);
    if (arr) arr.push(i);
    else clusters.set(r, [i]);
  }
  const out: BridgeWithProvenance[] = [];
  for (const idxs of clusters.values()) {
    if (idxs.length === 1) {
      const r = rects[idxs[0]];
      out.push({ kind: "rect", pos: r.pos, rotY: r.rotY, length: r.length, riverIds: r.riverIds });
      continue;
    }
    let cx = 0;
    let cy = 0;
    let maxLen = 0;
    let maxOffset = 0;
    let ids: string[] = [];
    for (const i of idxs) {
      cx += rects[i].pos.x;
      cy += rects[i].pos.y;
      maxLen = Math.max(maxLen, rects[i].length);
      ids = unionRiverIds(ids, rects[i].riverIds);
    }
    cx /= idxs.length;
    cy /= idxs.length;
    for (const i of idxs) {
      const dx = rects[i].pos.x - cx;
      const dy = rects[i].pos.y - cy;
      const offset = Math.hypot(dx, dy);
      maxOffset = Math.max(maxOffset, offset + rects[i].length / 2);
    }
    const radius = Math.max(maxLen / 2, maxOffset) + 0.2;
    out.push({ kind: "plaza", pos: { x: cx, y: cy }, radius, riverIds: ids });
  }
  return out;
};

const unionRiverIds = (a: string[], b: string[]): string[] => {
  if (a.length === 0) return b.slice();
  if (b.length === 0) return a.slice();
  const set = new Set<string>(a);
  for (const id of b) set.add(id);
  return Array.from(set);
};

// The smoothed path geometry (one polyline per path, ~50 vertices) means a
// single conceptual path×river crossing emits multiple adjacent bridges
// from successive segments of the same path. Collapse near-duplicate
// same-path bridges into the longest representative so they don't pile
// up in the X-merge phase below.
const SAME_PATH_DIST_SQ = PATH_WIDTH * PATH_WIDTH;
const consolidateSamePathBridges = (rects: SourcedRect[]): SourcedRect[] => {
  const out: SourcedRect[] = [];
  for (const b of rects) {
    let merged = false;
    for (let k = 0; k < out.length; k++) {
      const c = out[k];
      if (c.pathIdx !== b.pathIdx) continue;
      const dx = c.pos.x - b.pos.x;
      const dy = c.pos.y - b.pos.y;
      if (dx * dx + dy * dy >= SAME_PATH_DIST_SQ) continue;
      // Same crossing event for one path — keep the longer deck so the
      // river footprint stays covered when the path bends through the
      // crossing at varying angles.
      if (b.length > c.length) out[k] = b;
      merged = true;
      break;
    }
    if (!merged) out.push(b);
  }
  return out;
};

// Cluster bridges that come from DIFFERENT paths and overlap each other,
// then collapse each multi-bridge cluster into a single circular plaza.
// Restricting merges to cross-path bridges is what keeps a single path's
// own meander-crossings (which can be a few units apart and arrive at
// the river at opposite-going angles) rendering as separate decks.
//
// Distance: deck length scale, since a path-path X often emits its two
// bridges a few units apart (the paths cross slightly off the river
// segment) but their decks still physically overlap due to length.
//
// Angle: bridges from different paths can still happen to be parallel
// (e.g. two parallel paths each crossing the same V-river) — those don't
// X-overlap and shouldn't merge.
const BRIDGE_MERGE_DIST = PATH_WIDTH * 2;
const BRIDGE_MERGE_ANGLE = (30 * Math.PI) / 180;
const angleBetween = (a: number, b: number): number => {
  // Bridges are bidirectional — a deck rotated by π looks identical, so
  // collapse the diff into [0, π/2].
  let d = Math.abs(a - b) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
};
const mergeOverlappingBridges = (rects: SourcedRect[]): Bridge[] => {
  const n = rects.length;
  if (n <= 1) return rects.slice();

  // Union-find — bridges within MERGE_DIST get unioned. Transitive merging
  // means a chain of three near-collinear hits all collapses into one plaza.
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    while (parent[i] !== r) {
      const next = parent[i];
      parent[i] = r;
      i = next;
    }
    return r;
  };
  const distSq = BRIDGE_MERGE_DIST * BRIDGE_MERGE_DIST;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (rects[i].pathIdx === rects[j].pathIdx) continue;
      const dx = rects[i].pos.x - rects[j].pos.x;
      const dy = rects[i].pos.y - rects[j].pos.y;
      if (dx * dx + dy * dy >= distSq) continue;
      if (angleBetween(rects[i].rotY, rects[j].rotY) < BRIDGE_MERGE_ANGLE) continue;
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[ri] = rj;
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const arr = clusters.get(r);
    if (arr) arr.push(i);
    else clusters.set(r, [i]);
  }

  const out: Bridge[] = [];
  for (const idxs of clusters.values()) {
    if (idxs.length === 1) {
      const { pathIdx: _ignore, ...rect } = rects[idxs[0]];
      out.push(rect);
      continue;
    }
    let cx = 0;
    let cy = 0;
    let maxLen = 0;
    let maxOffset = 0;
    for (const i of idxs) {
      cx += rects[i].pos.x;
      cy += rects[i].pos.y;
      maxLen = Math.max(maxLen, rects[i].length);
    }
    cx /= idxs.length;
    cy /= idxs.length;
    // Plaza must reach every member's far end so the underlying river is
    // fully covered: max(per-bridge half-length + center→cluster-center
    // offset) is the conservative radius.
    for (const i of idxs) {
      const dx = rects[i].pos.x - cx;
      const dy = rects[i].pos.y - cy;
      const offset = Math.hypot(dx, dy);
      maxOffset = Math.max(maxOffset, offset + rects[i].length / 2);
    }
    const radius = Math.max(maxLen / 2, maxOffset) + 0.2;
    out.push({ kind: "plaza", pos: { x: cx, y: cy }, radius });
  }
  return out;
};

export const buildFlowFeatures = (paths: Vec2[][], levelId: number, biome: Biome): FlowFeatures => {
  const config = getFlowConfig(biome);
  if (!config) return { rivers: [], lakes: [], bridges: [] };

  const rng = mulberry32(levelId * 7919 + 31);

  // Pick alternating axes when there are multiple rivers so the channels
  // cross each other; for a single channel pick an axis from the seed.
  const mainPoints: Vec2[][] = [];
  for (let i = 0; i < config.riverCount; i++) {
    const axis: "h" | "v" =
      config.riverCount > 1 ? (i % 2 === 0 ? "h" : "v") : rng() < 0.5 ? "h" : "v";
    const candidateSeed = levelId * 7919 + 4001 + i * 911;
    mainPoints.push(buildBestRiver(rng, candidateSeed, axis, paths, config.riverWidth));
  }
  const rivers: River[] = mainPoints.map((points) => ({ points, width: config.riverWidth }));

  const allPoints = rivers.map((r) => r.points);
  return {
    rivers,
    lakes: buildLakes(rng, paths, allPoints, config),
    bridges: config.bridges ? computeBridges(paths, rivers) : [],
  };
};

// Weighted sampling table over the flow surface (rivers + lakes). Built
// once per level so per-frame ember spawns just pick a point in O(items).
type SurfaceItem =
  | {
      kind: "river";
      ax: number;
      ay: number;
      bx: number;
      by: number;
      width: number;
      weight: number;
    }
  | { kind: "lake"; x: number; y: number; rx: number; ry: number; rot: number; weight: number };

export type FlowSurface = { items: SurfaceItem[]; total: number };

export const buildFlowSurface = (features: FlowFeatures): FlowSurface => {
  const items: SurfaceItem[] = [];
  let total = 0;
  for (const river of features.rivers) {
    for (let i = 0; i < river.points.length - 1; i++) {
      const a = river.points[i];
      const b = river.points[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const weight = len * river.width;
      total += weight;
      items.push({
        kind: "river",
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        width: river.width,
        weight,
      });
    }
  }
  for (const lake of features.lakes) {
    const weight = Math.PI * lake.rx * lake.ry;
    total += weight;
    items.push({
      kind: "lake",
      x: lake.x,
      y: lake.y,
      rx: lake.rx,
      ry: lake.ry,
      rot: lake.rot,
      weight,
    });
  }
  return { items, total };
};

const sampleOnce = (surface: FlowSurface, rand: () => number): { x: number; y: number } | null => {
  if (surface.total <= 0) return null;
  let r = rand() * surface.total;
  for (const item of surface.items) {
    r -= item.weight;
    if (r > 0) continue;
    if (item.kind === "river") {
      const t = rand();
      const cx = item.ax + (item.bx - item.ax) * t;
      const cy = item.ay + (item.by - item.ay) * t;
      const dx = item.bx - item.ax;
      const dy = item.by - item.ay;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return { x: cx, y: cy };
      // Perpendicular offset within ±width/2, biased toward center
      // (square the random so embers cluster down the river spine).
      const u = rand() * 2 - 1;
      const off = Math.sign(u) * u * u * (item.width / 2);
      const nx = -dy / len;
      const ny = dx / len;
      return { x: cx + nx * off, y: cy + ny * off };
    }
    // Uniform sample inside an ellipse via sqrt-radius polar.
    const angle = rand() * Math.PI * 2;
    const radius = Math.sqrt(rand());
    const lx = Math.cos(angle) * radius * item.rx;
    const ly = Math.sin(angle) * radius * item.ry;
    const c = Math.cos(item.rot);
    const s = Math.sin(item.rot);
    return { x: item.x + lx * c - ly * s, y: item.y + lx * s + ly * c };
  }
  return null;
};

// Bridge approximated as a stadium: distance-to-segment between the two
// endpoints, with radius = bridge half-width. Slight padding so embers
// don't visibly poke out from beneath the deck. Plaza bridges check a
// straight disc.
const BRIDGE_OCCLUDE_PAD = 0.2;
export const isUnderBridge = (bridges: Bridge[], x: number, y: number): boolean => {
  if (bridges.length === 0) return false;
  const halfW = (PATH_WIDTH + 0.4) / 2 + BRIDGE_OCCLUDE_PAD;
  const r2 = halfW * halfW;
  for (const b of bridges) {
    if (b.kind === "plaza") {
      const dx = x - b.pos.x;
      const dy = y - b.pos.y;
      const r = b.radius + BRIDGE_OCCLUDE_PAD;
      if (dx * dx + dy * dy < r * r) return true;
      continue;
    }
    const tx = Math.cos(b.rotY);
    const ty = -Math.sin(b.rotY);
    const halfL = b.length / 2;
    const ax = b.pos.x - tx * halfL;
    const ay = b.pos.y - ty * halfL;
    const bx = b.pos.x + tx * halfL;
    const by = b.pos.y + ty * halfL;
    if (distPointToSegSq(x, y, ax, ay, bx, by) < r2) return true;
  }
  return false;
};

// Pick a random world-space (x, y) point on the flow surface, weighted by
// area so larger features spawn proportionally more embers. Rejects samples
// that fall under a bridge so embers don't poke through the deck. Returns
// level (x, y) coords; caller maps y → -z for three.js.
export const sampleFlowSurface = (
  surface: FlowSurface,
  bridges: Bridge[],
  rand: () => number,
): { x: number; y: number } | null => {
  for (let attempt = 0; attempt < 6; attempt++) {
    const sample = sampleOnce(surface, rand);
    if (!sample) return null;
    if (!isUnderBridge(bridges, sample.x, sample.y)) return sample;
  }
  // Give up rather than skip the spawn — keeps the pool full even if a
  // particularly bridge-heavy level rejects every try.
  return sampleOnce(surface, rand);
};

// True if (x, y) lands on any flow surface (lake interior OR river strip),
// padded outward by `padding` world units. Used to keep environmental
// decorations off the rivers/lakes. Pass null when the biome has no flow
// features at all.
export const isOnFlowSurface = (
  features: FlowFeatures | null,
  x: number,
  y: number,
  padding = 0,
): boolean => {
  if (!features) return false;
  for (const l of features.lakes) {
    const dx = x - l.x;
    const dy = y - l.y;
    const c = Math.cos(-l.rot);
    const s = Math.sin(-l.rot);
    const lx = dx * c - dy * s;
    const ly = dx * s + dy * c;
    const rx = l.rx + padding;
    const ry = l.ry + padding;
    if ((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1) return true;
  }
  for (const river of features.rivers) {
    const pts = river.points;
    const riverHalf = river.width / 2 + padding;
    const r2 = riverHalf * riverHalf;
    for (let i = 0; i < pts.length - 1; i++) {
      if (distPointToSegSq(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) < r2) return true;
    }
  }
  return false;
};
