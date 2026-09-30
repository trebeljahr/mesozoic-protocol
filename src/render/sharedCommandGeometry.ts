import type { Biome } from "../biomes";
import { HQ_PAD_BLOCKER_RADIUS, PATH_WIDTH } from "../level";
import type { Vec2 } from "../sim/types";
import { distToSegmentSq } from "../sim/vec2";
import type { CommandComplex, CommandPose } from "./commandBaseLayout";
import { COMMAND_PALETTES } from "./commandBuildingPlan";
import type { BaseBlock } from "./modularBasePlan";

export type CommandPanel = BaseBlock & {
  yaw: number;
  role?: "floor" | "structure" | "perimeter";
  feature?: "hall";
};
export type CommandTank = { pos: Vec2; scale: number; seed: number };
export const linkedCommandGroups = (complex: CommandComplex): CommandPose[][] => {
  const groups = new Map<number, CommandPose[]>();
  for (const pose of complex.poses)
    groups.set(pose.group, [...(groups.get(pose.group) ?? []), pose]);
  return [...groups.values()].filter((group) => group.length > 1);
};

/** New shared structures stay in reserved ground and off every approach lane. */
export function commandPointClear(
  point: Vec2,
  poses: CommandPose[],
  paths: Vec2[][],
  lanes = true,
): boolean {
  if (
    !poses.some(
      (p) => Math.hypot(point.x - p.end.x, point.y - p.end.y) < HQ_PAD_BLOCKER_RADIUS - 0.08,
    )
  )
    return false;
  return (
    !lanes ||
    paths.every((path) =>
      path
        .slice(1)
        .every((b, i) => distToSegmentSq(point, path[i], b) >= (PATH_WIDTH / 2 + 0.08) ** 2),
    )
  );
}
function rectClear(
  pos: Vec2,
  yaw: number,
  width: number,
  depth: number,
  poses: CommandPose[],
  paths: Vec2[][],
): boolean {
  const nx = 2 * Math.ceil(width / 0.2),
    nz = 2 * Math.ceil(depth / 0.2);
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= nz; j++) {
      const x = -width / 2 + (width * i) / nx,
        z = -depth / 2 + (depth * j) / nz;
      if (
        !commandPointClear(
          {
            x: pos.x + x * Math.cos(yaw) + z * Math.sin(yaw),
            y: pos.y + x * Math.sin(yaw) - z * Math.cos(yaw),
          },
          poses,
          paths,
        )
      )
        return false;
    }
  return true;
}

/** Shared apron, central research halls, broad wings, and an exterior-only perimeter. */
export function sharedCommandGeometry(
  complex: CommandComplex,
  paths: Vec2[][],
  biome: Biome,
  seed = 0,
): { panels: CommandPanel[]; tanks: CommandTank[] } {
  const [wall, trim, steel, lamp] = COMMAND_PALETTES[biome];
  const panels: CommandPanel[] = [],
    tanks: CommandTank[] = [];
  const add = (
    pos: Vec2,
    y: number,
    size: BaseBlock["size"],
    color: string,
    yaw: number,
    role: CommandPanel["role"] = "structure",
  ) => panels.push({ at: [pos.x, y, -pos.y], size, color, yaw, role });
  for (const group of linkedCommandGroups(complex)) {
    const origin = group[0].end,
      yaw = group[0].yaw,
      c = Math.cos(yaw),
      s = Math.sin(yaw);
    const world = (x: number, z: number): Vec2 => ({
      x: origin.x + x * c + z * s,
      y: origin.y + x * s - z * c,
    });
    const locals = group.map((p) => ({
      x: (p.end.x - origin.x) * c + (p.end.y - origin.y) * s,
      z: (p.end.x - origin.x) * s - (p.end.y - origin.y) * c,
    }));
    const step = 0.4;
    const minX = Math.floor((Math.min(...locals.map((p) => p.x)) - 3.1) / step),
      maxX = Math.ceil((Math.max(...locals.map((p) => p.x)) + 3.1) / step);
    const minZ = Math.floor((Math.min(...locals.map((p) => p.z)) - 3.2) / step),
      maxZ = Math.ceil((Math.max(...locals.map((p) => p.z)) + 1.9) / step);
    const cells = new Set<string>();
    for (let x = minX; x < maxX; x++)
      for (let z = minZ; z < maxZ; z++) {
        if (
          [
            [-1, -1],
            [-1, 1],
            [1, -1],
            [1, 1],
          ].every(([dx, dz]) => {
            const p = world((x + 0.5) * step + (dx * step) / 2, (z + 0.5) * step + (dz * step) / 2);
            return group.some(
              (h) => Math.hypot(p.x - h.end.x, p.y - h.end.y) < HQ_PAD_BLOCKER_RADIUS - 0.2,
            );
          })
        )
          cells.add(`${x},${z}`);
      }
    // One shared communications cabinet and service store, on opposite rear flanks.
    const ends = [...locals].sort((a, b) => a.x - b.x);
    for (const [i, loc] of [ends[0], ends[ends.length - 1]].entries()) {
      const position = world(loc.x + (i === 0 ? -2.4 : 2.4), loc.z - 1.95);
      if (!rectClear(position, yaw, 0.8, 0.8, group, paths)) continue;
      add(position, 0.82, [0.7, 1.15, 0.75], steel, yaw);
      add(position, 1.44, [0.78, 0.12, 0.8], trim, yaw);
      if (i === 0) {
        add(position, 2.05, [0.09, 1.12, 0.09], steel, yaw);
        add(position, 2.48, [0.65, 0.08, 0.1], trim, yaw);
      } else add(position, 1.66, [0.5, 0.3, 0.55], wall, yaw);
    }
    // Merge adjacent apron cells into row runs: no overlapping independent pads.
    for (let z = minZ; z < maxZ; z++)
      for (let x = minX; x < maxX; x++)
        if (cells.has(`${x},${z}`)) {
          const start = x;
          while (x + 1 < maxX && cells.has(`${x + 1},${z}`)) x++;
          add(
            world(((start + x + 1) * step) / 2, (z + 0.5) * step),
            0.12,
            [(x - start + 1) * step, 0.24, step],
            steel,
            yaw,
            "floor",
          );
        }
    for (const key of cells) {
      const [x, z] = key.split(",").map(Number);
      for (const [dx, dz] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        if (cells.has(`${x + dx},${z + dz}`)) continue;
        const pos = world((x + 0.5 + dx / 2) * step, (z + 0.5 + dz / 2) * step);
        // Gate openings align with actual approach lanes, including curved ones.
        if (!rectClear(pos, yaw, dx ? 0.16 : step, dz ? 0.16 : step, group, paths)) continue;
        add(pos, 0.52, [dx ? 0.14 : step, 0.56, dz ? 0.14 : step], wall, yaw, "perimeter");
        add(pos, 0.83, [dx ? 0.16 : step, 0.06, dz ? 0.16 : step], trim, yaw, "perimeter");
        if ((x + z) % 5 === 0) add(pos, 0.92, [0.16, 0.12, 0.16], lamp, yaw, "perimeter");
      }
    }
  }
  for (const [index, link] of complex.links.entries()) {
    const left = complex.poses[link.from],
      right = complex.poses[link.to];
    const dx = right.end.x - left.end.x,
      dy = right.end.y - left.end.y,
      length = Math.hypot(dx, dy);
    const ux = dx / length,
      uy = dy / length;
    let bx = -uy,
      by = ux;
    if (
      bx * (-Math.sin(left.yaw) - Math.sin(right.yaw)) +
        by * (Math.cos(left.yaw) + Math.cos(right.yaw)) <
      0
    ) {
      bx = -bx;
      by = -by;
    }
    const center = { x: (left.end.x + right.end.x) / 2, y: (left.end.y + right.end.y) / 2 };
    const world = (t: number, q: number): Vec2 => ({
      x: center.x + t * ux + q * bx,
      y: center.y + t * uy + q * by,
    });
    const yaw = Math.atan2(uy, ux),
      width = Math.max(0.8, Math.min(4.8, length - 3.5));
    const depth = [3, 2.6, 2.2, 1.8, 1.4].find((d) =>
      rectClear(world(0, 0.9), yaw, width + 0.14, d + 0.14, complex.poses, paths),
    );
    if (depth === undefined) continue;
    const hall = world(0, 0.9);
    add(hall, 0.13, [width + 0.14, 0.26, depth + 0.14], steel, yaw, "floor");
    const style = Math.abs(Math.floor(seed + index)) % 6;
    const height = [2.4, 1.75, 2.8, 2.05, 2.55, 1.9][style];
    const roof = 0.24 + height;
    add(hall, 0.24 + height / 2, [width, height, depth], wall, yaw);
    panels[panels.length - 1].feature = "hall";
    add(hall, roof + 0.08, [width + 0.14, 0.16, depth + 0.14], trim, yaw);
    add(hall, roof + 0.22, [width * 0.74, 0.12, depth * 0.72], steel, yaw);
    for (const t of style % 2 ? [0] : [-width * 0.24, width * 0.24])
      add(world(t, 0.9), roof + 0.32, [width * 0.32, 0.09, depth * 0.54], lamp, yaw);
    if (style >= 2) {
      // Raised ventilation spine or communications array changes the roof silhouette.
      add(hall, roof + 0.5, [width * 0.35, 0.4, depth * 0.45], steel, yaw);
      if (style >= 4) {
        add(hall, roof + 1.1, [0.08, 1, 0.08], trim, yaw);
        add(hall, roof + 1.5, [width * 0.55, 0.1, 0.15], lamp, yaw);
      }
    }
    // Observation band faces a specimen court, not a domestic entrance.
    add(
      world(0, 0.9 - depth / 2 - 0.025),
      0.24 + height * 0.65,
      [width * 0.8, 0.42, 0.04],
      steel,
      yaw,
    );
    add(
      world(0, 0.9 - depth / 2 - 0.05),
      0.24 + height * 0.65,
      [width * 0.72, 0.2, 0.02],
      lamp,
      yaw,
    );
    for (const [pose, sign] of [
      [left, -1],
      [right, 1],
    ] as const) {
      const a = {
        x: pose.end.x - Math.sin(pose.yaw) * 2.3,
        y: pose.end.y + Math.cos(pose.yaw) * 2.3,
      };
      const b = world(sign * (width / 2 - 0.2), 1.7);
      const dist = Math.hypot(b.x - a.x, b.y - a.y),
        wingYaw = Math.atan2(b.x - a.x, -(b.y - a.y));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const breadth = [1.5, 1.2, 0.9, 0.6].find((w) =>
        rectClear(mid, wingYaw, w, dist, complex.poses, paths),
      );
      if (!breadth) continue;
      add(mid, 1.04, [breadth * 0.9, 1.6, dist], wall, wingYaw);
      add(mid, 1.94, [breadth, 0.18, dist], trim, wingYaw);
      add(mid, 2.06, [breadth * 0.6, 0.06, dist], steel, wingYaw);
    }
    const tankQ = 0.9 - depth / 2 - 0.8;
    for (const t of width > 2.5 ? [-0.65, 0.65] : [0]) {
      const pos = world(t, tankQ),
        scale = 1.35;
      if (!rectClear(pos, 0, 1.3, 1.3, complex.poses, paths)) continue;
      tanks.push({ pos, scale, seed: index * 17 + t });
      add(pos, 0.32, [1.22, 0.16, 1.22], steel, yaw);
    }
  }
  // Standalone batteries also have specimen service bays, beside the gun apron.
  for (const pose of complex.poses) {
    if (complex.poses.some((p) => p !== pose && p.group === pose.group)) continue;
    const sides = (seed + pose.index) % 3 === 0 ? [-1, 1] : [(seed + pose.index) % 2 ? -1 : 1];
    for (const side of sides) {
      const x = side * 2.12,
        z = 0.2;
      const pos = {
        x: pose.end.x + x * Math.cos(pose.yaw) + z * Math.sin(pose.yaw),
        y: pose.end.y + x * Math.sin(pose.yaw) - z * Math.cos(pose.yaw),
      };
      if (!rectClear(pos, pose.yaw, 0.95, 0.95, complex.poses, paths)) continue;
      tanks.push({ pos, scale: 1, seed: seed + pose.index * 7 + side });
      add(pos, 0.3, [0.95, 0.2, 0.95], steel, pose.yaw, "floor");
    }
  }
  const structures = panels.filter((panel) => panel.role === "structure" && panel.size[1] > 0.4);
  const exterior = panels.filter(
    (panel) =>
      panel.role !== "perimeter" ||
      !structures.some((building) => {
        const dx = panel.at[0] - building.at[0],
          dz = panel.at[2] - building.at[2];
        const x = dx * Math.cos(building.yaw) - dz * Math.sin(building.yaw);
        const z = dx * Math.sin(building.yaw) + dz * Math.cos(building.yaw);
        return (
          Math.hypot(
            Math.max(0, Math.abs(x) - building.size[0] / 2),
            Math.max(0, Math.abs(z) - building.size[2] / 2),
          ) < 0.32
        );
      }),
  );
  return { panels: exterior, tanks };
}
