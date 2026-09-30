import { describe, expect, it } from "vitest";
import { getLevel } from "../levels";
import {
  damageRobot,
  insideRobotCone,
  orderRobotMove,
  triggerRobotAbility,
  updateRobot,
} from "./robot";
import type { RobotVariant } from "./types";
import { createWorld, spawnEnemy } from "./world";

const setup = (variant: RobotVariant) => {
  const world = createWorld(getLevel(1), "normal", undefined, new Set(), {
    variant,
    xp: 0,
    skills: {},
  });
  world.status = "running";
  world.time = 1;
  world.robot.pos = { x: 0, y: 0 };
  world.robot.facing = 0;
  world.trees = [];
  world.rocks = [];
  world.towers = [];
  return world;
};
const enemyAt = (world: ReturnType<typeof setup>, x: number, y: number) => {
  const enemy = spawnEnemy(world, "raptor");
  enemy.pos = { x, y };
  enemy.hp = 10000;
  enemy.maxHp = 10000;
  return enemy;
};

describe("robot combat identities", () => {
  it("Leela's basic shot deals cold damage and slows its target", () => {
    const w = setup("leela"),
      e = enemyAt(w, 0, -4);
    updateRobot(w, 1 / 60);
    expect(w.robot.damageType).toBe("cold");
    expect(e.hp).toBeLessThan(10000);
    expect(e.slowUntil).toBeGreaterThan(w.time);
    expect(e.slowFactor).toBeLessThan(1);
  });
  it("Frost Nova freezes only enemies within its radius", () => {
    const w = setup("leela"),
      near = enemyAt(w, 0, -3),
      far = enemyAt(w, 0, -5);
    triggerRobotAbility(w, 1);
    expect(near.freezeUntil).toBeCloseTo(2.2);
    expect(far.freezeUntil).toBe(0);
  });
  it("Blizzard affects all enemies in range without chaining beyond its radius", () => {
    const w = setup("leela");
    const pack = Array.from({ length: 6 }, (_, i) => enemyAt(w, i * 0.4, -5));
    const far = enemyAt(w, 0, -8);
    triggerRobotAbility(w, 3);
    updateRobot(w, 1 / 60);
    expect(pack.every((e) => e.freezeUntil > w.time)).toBe(true);
    expect(far.hp).toBe(10000);
  });
  it("Stan's basic fire hits a pack but excludes enemies behind him", () => {
    const w = setup("stan"),
      a = enemyAt(w, 0, -4),
      b = enemyAt(w, 0.3, -5),
      behind = enemyAt(w, 0, 6);
    updateRobot(w, 1 / 60);
    expect(w.robot.damageType).toBe("kinetic");
    expect(a.hp).toBeLessThan(10000);
    expect(b.hp).toBeLessThan(10000);
    expect(behind.hp).toBe(10000);
  });
  it("Bullet Hell holds direction, repeats area damage, then expires", () => {
    const w = setup("stan"),
      front = enemyAt(w, 0, -4),
      side = enemyAt(w, 5, 0),
      far = enemyAt(w, 0, -12);
    triggerRobotAbility(w, 3);
    updateRobot(w, 1 / 60);
    const hp = front.hp;
    w.time += 0.15;
    updateRobot(w, 0.15);
    expect(front.hp).toBeLessThan(hp);
    expect(side.hp).toBe(10000);
    expect(far.hp).toBe(10000);
    expect(w.robot.facing).toBe(0);
    w.time = 5;
    updateRobot(w, 1 / 60);
    expect(w.robot.payload).toBeNull();
  });
  it("movement and death cancel Bullet Hell", () => {
    const w = setup("stan");
    triggerRobotAbility(w, 3);
    expect(orderRobotMove(w, w.paths[0][0])).toBe(true);
    expect(w.robot.payload).toBeNull();
    w.robot.abilityReadyAt[3] = 0;
    triggerRobotAbility(w, 3);
    damageRobot(w, 10000);
    expect(w.robot.payload).toBeNull();
  });
  it("Ice Slide freezes at landing rather than at cast time", () => {
    const w = setup("leela"),
      enemy = enemyAt(w, 0, -3.5);
    w.robot.attackCooldown = 10;
    triggerRobotAbility(w, 0);
    triggerRobotAbility(w, 0);
    expect(enemy.freezeUntil).toBe(0);
    for (let i = 0; i < 30; i++) {
      w.time += 1 / 60;
      updateRobot(w, 1 / 60);
    }
    expect(enemy.freezeUntil).toBeGreaterThan(w.time);
  });
  it("a committed dash cancels Bullet Hell", () => {
    const w = setup("stan");
    triggerRobotAbility(w, 3);
    triggerRobotAbility(w, 0);
    triggerRobotAbility(w, 0);
    expect(w.robot.payload).toBeNull();
    expect(w.robot.abilityActiveUntil[0]).toBeGreaterThan(w.time);
  });
  it("cone geometry includes its origin and excludes its rear and range overflow", () => {
    const origin = { x: 0, y: 0 };
    expect(insideRobotCone(origin, origin, 0, 5, 0.6)).toBe(true);
    expect(insideRobotCone(origin, { x: 0, y: 1 }, 0, 5, 0.6)).toBe(false);
    expect(insideRobotCone(origin, { x: 0, y: -6 }, 0, 5, 0.6)).toBe(false);
  });
});
