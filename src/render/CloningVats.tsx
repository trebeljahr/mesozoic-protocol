import { useMemo } from "react";
import { PATH_WIDTH } from "../level";
import { mulberry32 } from "../sim/random";
import type { Vec2 } from "../sim/types";
import { distToSegmentSq } from "../sim/vec2";
import { useGame } from "../store";
import { CANISTER_PALETTE } from "./biomeColors";
import { CloningCanister } from "./CloningCanister";

// Per-HQ slot pool. Coordinates are HQ-pad-local (right = perpendicular to
// approach, fwd = along approach toward the spawn). All slots sit at fwd ≤
// 0 — *behind/beside* the HQ pad relative to where enemies spawn — so the
// canisters cluster around the rear/sides of the outpost without poking
// into the path or the tower-placement zone in front. Distances are kept
// small enough that the back slots stay inside the battle camera's frustum
// (≈ ±23.6 world units in x for the default zoom); fwd ≤ -3.0 was too far
// behind on the typical HQ-at-rect-edge level and clipped out of view.
const SLOTS: { right: number; fwd: number; yawOffset: number }[] = [
  { right: -4.5, fwd: -0.4, yawOffset: -Math.PI / 2 },
  { right: 4.5, fwd: -0.4, yawOffset: Math.PI / 2 },
  { right: -4.4, fwd: -1.6, yawOffset: -Math.PI / 3 },
  { right: 4.4, fwd: -1.6, yawOffset: Math.PI / 3 },
  { right: -2.6, fwd: -3.0, yawOffset: -Math.PI / 6 },
  { right: 2.6, fwd: -3.0, yawOffset: Math.PI / 6 },
  { right: 0.0, fwd: -3.4, yawOffset: 0 },
];

// Effective footprint of the tank, used for slot↔slot + slot↔path rejection.
const CANISTER_RADIUS = 0.46;

type Placed = {
  worldX: number;
  worldZ: number;
  yaw: number;
  seed: number;
  key: string;
};

export const CloningVats = () => {
  const paths = useGame((s) => s.world.paths);
  const levelId = useGame((s) => s.world.levelId);
  const biome = useGame((s) => s.world.biome);

  const placements = useMemo<Placed[]>(() => {
    const out: Placed[] = [];
    const pathHalf = PATH_WIDTH * 0.5;
    const placed: Vec2[] = [];

    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
      const path = paths[pathIndex];
      if (path.length < 2) continue;
      const last = path[path.length - 1];
      const prev = path[path.length - 2];
      const dx = prev.x - last.x;
      const dy = prev.y - last.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const faceX = dx / len;
      const faceY = dy / len;
      const rightX = faceY;
      const rightY = -faceX;
      const hqYaw = Math.atan2(dx, -dy);

      const rng = mulberry32(levelId * 9173 + pathIndex * 661 + 41);
      // Pick 2-4 canisters per HQ. Skew toward 3 so most bases get a small
      // cluster but the count varies across levels so they don't feel cloned.
      const roll = rng();
      const wanted = roll < 0.25 ? 2 : roll < 0.7 ? 3 : 4;

      const slotOrder = SLOTS.map((_, i) => i);
      for (let i = slotOrder.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [slotOrder[i], slotOrder[j]] = [slotOrder[j], slotOrder[i]];
      }

      let placedCount = 0;
      for (let si = 0; si < slotOrder.length && placedCount < wanted; si++) {
        const slot = SLOTS[slotOrder[si]];
        const wx = last.x + slot.right * rightX + slot.fwd * faceX;
        const wy = last.y + slot.right * rightY + slot.fwd * faceY;
        const here: Vec2 = { x: wx, y: wy };

        // Path-corridor rejection — any path on the map. Canisters must
        // never sit close enough to a walking lane that the camera reads
        // them as inside the route.
        let blocked = false;
        const pathLim = CANISTER_RADIUS + pathHalf + 0.15;
        const pathLimSq = pathLim * pathLim;
        for (const p of paths) {
          for (let i = 0; i < p.length - 1; i++) {
            if (distToSegmentSq(here, p[i], p[i + 1]) < pathLimSq) {
              blocked = true;
              break;
            }
          }
          if (blocked) break;
        }
        if (blocked) continue;

        // Spacing against canisters already placed on neighbouring HQs so
        // two close bases don't smash their tanks into each other.
        const minSep = CANISTER_RADIUS * 2 + 0.25;
        const minSepSq = minSep * minSep;
        let collided = false;
        for (const p of placed) {
          const ix = p.x - wx;
          const iy = p.y - wy;
          if (ix * ix + iy * iy < minSepSq) {
            collided = true;
            break;
          }
        }
        if (collided) continue;

        placed.push(here);
        out.push({
          worldX: wx,
          worldZ: -wy,
          yaw: hqYaw + slot.yawOffset,
          seed: rng() * Math.PI * 2,
          key: `${levelId}-${pathIndex}-${slotOrder[si]}`,
        });
        placedCount++;
      }
    }
    return out;
  }, [paths, levelId]);

  const palette = CANISTER_PALETTE[biome];

  return (
    <group>
      {placements.map((p) => (
        <CloningCanister
          key={p.key}
          worldX={p.worldX}
          worldZ={p.worldZ}
          yaw={p.yaw}
          palette={palette}
          seed={p.seed}
        />
      ))}
    </group>
  );
};
