import { HQ_PAD_BLOCKER_RADIUS, PATH_WIDTH } from "../level";
import type { Vec2 } from "../sim/types";
import { distToSegmentSq } from "../sim/vec2";

// Shared render height: the gun, muzzle effects and fracture origin use this deck.
export const HQ_GUN_DECK_HEIGHT = 2.12;
export const HQ_CONNECTOR_WIDTH = 0.5;
export type CommandPose = { end: Vec2; yaw: number; index: number; group: number };
export type CommandLink = { a: Vec2; b: Vec2; from: number; to: number };
export type CommandComplex = { poses: CommandPose[]; links: CommandLink[] };

export const rearDock = (pose: CommandPose): Vec2 => ({
  x: pose.end.x - Math.sin(pose.yaw) * 1.7,
  y: pose.end.y + Math.cos(pose.yaw) * 1.7,
});

/** Validate the whole narrow corridor, including its edges, against routes and HQ reservations. */
export function commandLinkFits(a: Vec2, b: Vec2, poses: CommandPose[], paths: Vec2[][]): boolean {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 0.1 || length > 8.1) return false;
  const nx = -(b.y - a.y) / length;
  const ny = (b.x - a.x) / length;
  const steps = Math.ceil(length / 0.05);
  for (let i = 0; i <= steps; i++)
    for (const side of [-1, 0, 1]) {
      const point = {
        x: a.x + ((b.x - a.x) * i) / steps + (nx * side * HQ_CONNECTOR_WIDTH) / 2,
        y: a.y + ((b.y - a.y) * i) / steps + (ny * side * HQ_CONNECTOR_WIDTH) / 2,
      };
      if (
        !poses.some(
          (p) => Math.hypot(point.x - p.end.x, point.y - p.end.y) <= HQ_PAD_BLOCKER_RADIUS - 0.03,
        )
      )
        return false;
      for (const path of paths)
        for (let j = 1; j < path.length; j++) {
          if (distToSegmentSq(point, path[j - 1], path[j]) < (PATH_WIDTH / 2 + 0.025) ** 2)
            return false;
        }
    }
  return true;
}

/** Deterministic minimum connection tree; coincident endpoints share one building. */
export function commandComplexPlan(paths: Vec2[][]): CommandComplex {
  const poses: CommandPose[] = [];
  for (const [index, path] of paths.entries()) {
    if (path.length < 2) continue;
    const end = path[path.length - 1];
    if (poses.some((p) => Math.hypot(p.end.x - end.x, p.end.y - end.y) < 0.01)) continue;
    const prev = path[path.length - 2];
    poses.push({
      end,
      yaw: Math.atan2(prev.x - end.x, -(prev.y - end.y)),
      index,
      group: poses.length,
    });
  }
  const candidates: (CommandLink & { distance: number })[] = [];
  for (let i = 0; i < poses.length; i++)
    for (let j = i + 1; j < poses.length; j++) {
      if (Math.hypot(poses[i].end.x - poses[j].end.x, poses[i].end.y - poses[j].end.y) > 8.1)
        continue;
      const a = rearDock(poses[i]),
        b = rearDock(poses[j]);
      if (commandLinkFits(a, b, poses, paths))
        candidates.push({ a, b, from: i, to: j, distance: Math.hypot(a.x - b.x, a.y - b.y) });
    }
  candidates.sort((a, b) => a.distance - b.distance || a.from - b.from || a.to - b.to);
  const links: CommandLink[] = [];
  for (const { distance: _, ...link } of candidates) {
    const groupA = poses[link.from].group,
      groupB = poses[link.to].group;
    if (groupA === groupB) continue;
    links.push(link);
    for (const pose of poses) if (pose.group === groupB) pose.group = groupA;
  }
  return { poses, links };
}

export const overlapsCommandLink = (pos: Vec2, radius: number, links: CommandLink[]): boolean =>
  links.some(
    (link) => distToSegmentSq(pos, link.a, link.b) < (radius + HQ_CONNECTOR_WIDTH / 2 + 0.1) ** 2,
  );
