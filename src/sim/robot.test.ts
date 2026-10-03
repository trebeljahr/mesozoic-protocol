import { describe, expect, it } from "vitest";
import { getLevel } from "../levels";
import { updateProjectiles } from "./projectiles";
import {
  damageRobot,
  insideRobotCone,
  orderRobotMove,
  triggerRobotAbility,
  updateRobot,
} from "./robot";
import { ROBOT_SPECS, ROBOT_VARIANTS } from "./robotVariants";
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
  it("starts with electric Leela and offers frost George next for 250 bolts", () => {
    expect(ROBOT_VARIANTS).toEqual(["leela", "george", "mike", "stan"]);
    expect(ROBOT_SPECS.leela.unlockBolts).toBe(0);
    expect(ROBOT_SPECS.george.unlockBolts).toBe(250);
    expect(createWorld(getLevel(1)).robot.variant).toBe("leela");
  });
  it("Leela's restored electric shots chain to two nearby targets without freezing", () => {
    const w = setup("leela");
    const pack = [enemyAt(w, 0, -4), enemyAt(w, 0, -5), enemyAt(w, 0, -6)];
    updateRobot(w, 1 / 60);
    expect(w.robot.damageType).toBe("electric");
    expect(pack.every((e) => e.hp < 10000)).toBe(true);
    expect(pack.every((e) => e.freezeUntil === 0 && e.slowUntil === 0)).toBe(true);
    expect(w.beams.some((b) => b.points.length === 4)).toBe(true);
  });
  it("Leela retains her lightning dash, pulse, veil, and storm", () => {
    const w = setup("leela");
    const enemies = [enemyAt(w, 0, -4), enemyAt(w, 0, -5), enemyAt(w, 0, -6)];
    triggerRobotAbility(w, 0);
    triggerRobotAbility(w, 0);
    expect(enemies.every((e) => e.hp < 10000)).toBe(true);
    triggerRobotAbility(w, 1);
    triggerRobotAbility(w, 2);
    expect(w.robot.selfBuff).toMatchObject({ fireRateMul: 1.3, speedMul: 1.7, damageResist: 0.5 });
    const before = enemies.map((e) => e.hp);
    triggerRobotAbility(w, 3);
    updateRobot(w, 1 / 60);
    expect(w.robot.payload).toMatchObject({
      kind: "storm",
      damageType: "electric",
      tickInterval: 0.5,
      damagePerArc: 12,
    });
    expect(enemies.every((e, i) => e.hp < before[i] && e.freezeUntil === 0)).toBe(true);
  });
  it("George's basic shot deals cold damage and slows its target", () => {
    const w = setup("george"),
      e = enemyAt(w, 0, -4);
    updateRobot(w, 1 / 60);
    expect(w.robot.damageType).toBe("cold");
    expect(e.hp).toBeLessThan(10000);
    expect(e.slowUntil).toBeGreaterThan(w.time);
    expect(e.slowFactor).toBeLessThan(1);
  });
  it("Frost Nova freezes only enemies within its radius", () => {
    const w = setup("george"),
      near = enemyAt(w, 0, -3),
      far = enemyAt(w, 0, -5);
    triggerRobotAbility(w, 1);
    expect(near.freezeUntil).toBeCloseTo(2.2);
    expect(far.freezeUntil).toBe(0);
  });
  it("Blizzard affects all enemies in range without chaining beyond its radius", () => {
    const w = setup("george");
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
    expect(a.hp).toBe(10000);
    expect(b.hp).toBe(10000);
    expect(w.projectiles.map((p) => p.targetId).sort()).toEqual([a.id, b.id].sort());
    // The target moves while the bullet is in flight; its visual position
    // and collision use the same updated target coordinates.
    a.pos.x += 0.5;
    updateProjectiles(w, 0.01);
    expect(a.hp).toBe(10000);
    updateProjectiles(w, 0.2);
    expect(a.hp).toBeLessThan(10000);
    expect(b.hp).toBeLessThan(10000);
    expect(behind.hp).toBe(10000);
  });
  it("Stan's cone ability waits for impact and drops shots whose target dies", () => {
    const w = setup("stan");
    const target = enemyAt(w, 0, -4);
    triggerRobotAbility(w, 1);
    expect(target.hp).toBe(10000);
    expect(w.projectiles).toHaveLength(1);
    expect(w.projectiles[0].targetId).toBe(target.id);
    expect(w.projectiles[0].ballistic).toBeDefined();
    target.alive = false;
    updateProjectiles(w, 0.2);
    expect(w.projectiles).toHaveLength(0);
    expect(target.hp).toBe(10000);
  });
  it("Bullet Hell holds direction, repeats area damage, then expires", () => {
    const w = setup("stan"),
      front = enemyAt(w, 0, -4),
      side = enemyAt(w, 5, 0),
      far = enemyAt(w, 0, -12);
    triggerRobotAbility(w, 3);
    updateRobot(w, 1 / 60);
    updateProjectiles(w, 0.2);
    const hp = front.hp;
    w.time += 0.15;
    updateRobot(w, 0.15);
    updateProjectiles(w, 0.2);
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
    const w = setup("george"),
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
