import type { Biome } from "../biomes";
import { MAP_HEIGHT, MAP_WIDTH } from "../level";
import type { LandscapeField, LandscapeMask } from "./landscape";
import type { Vec2 } from "./types";
import { distPointToSegSq } from "./vec2";

export type EnvironmentMass = {
  pos: Vec2;
  yaw: number;
  kind: "grove" | "formation";
  species: number;
  radius: number;
};

// A small number of landscape masses, separated by empty ground. Every prop
// family uses these SAME anchors: saplings and undergrowth belong to groves;
// pebbles belong to rock formations. Noise may soften a mass, never seed an
// unrelated one. Coordinates depend on the level seed and actual lane shape.
export const composeEnvironment = (
  paths: Vec2[][],
  biome: Biome,
  field: LandscapeField,
): EnvironmentMass[] => {
  const nearestLane = (x: number, y: number) => {
    let distance = Infinity;
    let yaw = 0;
    for (const path of paths) {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        const d = distPointToSegSq(x, y, a.x, a.y, b.x, b.y);
        if (d < distance) {
          distance = d;
          yaw = Math.atan2(b.y - a.y, b.x - a.x);
        }
      }
    }
    return { distance: Math.sqrt(distance), yaw };
  };
  const candidates: { pos: Vec2; yaw: number; score: number; inner: boolean }[] = [];
  for (let y = -MAP_HEIGHT / 2 - 5; y <= MAP_HEIGHT / 2 + 5; y += 3) {
    for (let x = -MAP_WIDTH / 2 - 6; x <= MAP_WIDTH / 2 + 6; x += 3) {
      const px = x + (field.hash(x, y) - 0.5) * 1.2;
      const py = y + (field.hash(y, x) - 0.5) * 1.2;
      const lane = nearestLane(px, py);
      if (lane.distance < 3.0) continue;
      if (
        paths.some(
          (p) => p.length && Math.hypot(px - p[p.length - 1].x, py - p[p.length - 1].y) < 7,
        )
      )
        continue;
      const inner = Math.abs(px) < MAP_WIDTH / 2 - 1 && Math.abs(py) < MAP_HEIGHT / 2 - 1;
      candidates.push({
        pos: { x: px, y: py },
        yaw: lane.yaw,
        inner,
        score: Math.min(lane.distance, 7) + field.hash(px + 41, py - 13) * 2,
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const masses: EnvironmentMass[] = [];
  // Select interior pockets first so the playable landscape gets landmarks
  // before the larger outer band can exhaust the budget.
  for (const inner of [true, false]) {
    let count = 0;
    for (const candidate of candidates) {
      if (candidate.inner !== inner) continue;
      if (masses.some((m) => Math.hypot(m.pos.x - candidate.pos.x, m.pos.y - candidate.pos.y) < 10))
        continue;
      const index = masses.length;
      const wooded = biome === "forest" || biome === "snow";
      const kind = (wooded ? index % 3 !== 2 : index % 2 === 0) ? "grove" : "formation";
      masses.push({
        pos: candidate.pos,
        yaw: candidate.yaw,
        kind,
        species: Math.floor(field.hash(candidate.pos.x + 9, candidate.pos.y) * 4),
        radius: kind === "grove" ? (wooded ? 5.8 : 4.5) : 4.8,
      });
      if (++count >= (inner ? 4 : 5)) break;
    }
  }
  return masses;
};

export const compositionKind = (mask: LandscapeMask): EnvironmentMass["kind"] =>
  mask === "rock" ? "formation" : "grove";

export const nearestMass = (
  masses: EnvironmentMass[],
  mask: LandscapeMask,
  x: number,
  y: number,
) => {
  let nearest: EnvironmentMass | undefined;
  let distance = Infinity;
  for (const mass of masses) {
    if (mass.kind !== compositionKind(mask)) continue;
    const dx = x - mass.pos.x;
    const dy = y - mass.pos.y;
    const c = Math.cos(mass.yaw);
    const s = Math.sin(mass.yaw);
    // Long axes follow the local lane; short axes make deliberate clearings.
    const d = Math.hypot(
      (dx * c + dy * s) / mass.radius,
      (-dx * s + dy * c) / (mass.radius * 0.72),
    );
    if (d < distance) {
      distance = d;
      nearest = mass;
    }
  }
  return { mass: nearest, distance };
};

export const compositionDensity = (
  masses: EnvironmentMass[],
  mask: LandscapeMask,
  x: number,
  y: number,
) => {
  const { distance } = nearestMass(masses, mask, x, y);
  const halo = mask === "groundCover" || mask === "damp" || mask === "understory" ? 1.22 : 1;
  return Math.max(0, 1 - (distance / halo) ** 2);
};

// Deliberate asymmetric groups: dominant centre, two supporting silhouettes,
// then smaller fringe pieces. Shared orientation gives rock strata a grain.
export const compositionSeeds = (masses: EnvironmentMass[], mask: LandscapeMask): Vec2[] => {
  const points: Vec2[] = [];
  for (const m of masses) {
    if (m.kind !== compositionKind(mask)) continue;
    const c = Math.cos(m.yaw),
      s = Math.sin(m.yaw);
    for (const [u, v] of [
      [0, 0],
      [-0.57, 0.22],
      [0.58, 0.25],
      [-0.28, -0.56],
      [0.32, 0.61],
    ]) {
      const x = u * m.radius,
        y = v * m.radius;
      points.push({ x: m.pos.x + x * c - y * s, y: m.pos.y + x * s + y * c });
    }
  }
  return points;
};

/** Surface fragments inherit their parent formation, even at carpet scale. */
export const compositionMask = (urls: readonly string[], fallback: LandscapeMask): LandscapeMask =>
  /rock|stone|pebble|crystal|shard|bone|debris|meteor/.test((urls[0] ?? "").toLowerCase())
    ? "rock"
    : fallback;
