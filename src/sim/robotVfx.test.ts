import { expect, it } from "vitest";
import { getLevel } from "../levels";
import { triggerRobotAbility } from "./robot";
import type { RobotVariant } from "./types";
import { createWorld } from "./world";

it.each<[RobotVariant, string, boolean]>([
  ["mike", "flame", true],
  ["stan", "kinetic", false],
  ["leela", "electric", false],
  ["george", "cold", false],
])("preserves %s's burst identity and emits soot only for combustion", (variant, type, soot) => {
  const world = createWorld(getLevel(1));
  world.robot.variant = variant;
  expect(triggerRobotAbility(world, 1)).toBe(true);
  if (variant === "stan" || variant === "george") {
    expect(world.explosions).toHaveLength(0);
    if (variant === "stan") {
      expect(world.beams).toHaveLength(0);
      expect(world.projectiles).toHaveLength(0); // No targets, no false-hit tracers.
    } else expect(world.particles.length).toBeGreaterThan(0);
  } else expect(world.explosions.at(-1)?.damageType).toBe(type);
  expect(world.puffs.length > 0).toBe(soot);
  expect(world.particles.some((p) => p.kind === "flame")).toBe(type === "flame");
  expect(world.enemies).toHaveLength(0);
});
