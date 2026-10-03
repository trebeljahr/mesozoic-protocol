import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canPersistWorld } from "../persistence/missionCheckpoint";
import { Engine } from "../sim/loop";
import type { TargetingMode, TowerKind } from "../sim/types";
import { TOWER_STATS } from "../sim/world";
import { useGame } from "../store";
import { ADVANCED_LESSONS } from "./advanced";
import { LESSONS, type LessonId, lessonFor, prepareLesson, tutorialStepSatisfied } from "./lessons";

const initial = useGame.getState();
const state = () => useGame.getState();
const lesson = () => lessonFor(state().tutorial!).id;
let time = 0;
const tick = (count = 1) => {
  for (let i = 0; i < count; i++) {
    time += 0.05;
    state().tick(time);
  }
};
const until = (id: LessonId, count = 800) => {
  for (let i = 0; i < count && lesson() !== id; i++) tick();
  expect(lesson()).toBe(id);
};
const stage = (id: LessonId) => {
  const metadata = LESSONS.find((item) => item.id === id)!;
  state().startTutorial(metadata.chapter);
  const session = state().tutorial!;
  session.step = LESSONS.findIndex((item) => item.id === id);
  prepareLesson(state().world, session);
};
const build = (kind: TowerKind) => {
  state().setSelectedKind(kind);
  state().tryPlaceOrSelect(state().tutorial!.marker!);
};

beforeEach(() => {
  time = 0;
  useGame.setState({ ...initial, engine: new Engine(), activeSlot: null, screen: "worldMap" });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("optional target priorities", () => {
  it("requires each mode to land damage on the contrasting target, then splash two targets with Spot", () => {
    state().startTutorial("targeting");
    const modes: [LessonId, TargetingMode, LessonId][] = [
      ["aimNear", "tower", "aimFirst"],
      ["aimFirst", "end", "aimLast"],
      ["aimLast", "start", "aimStrong"],
      ["aimStrong", "strongest", "aimWeak"],
      ["aimWeak", "weakest", "aimVulnerable"],
      ["aimVulnerable", "vulnerable", "aimSpot"],
    ];
    for (const [id, mode, next] of modes) {
      const session = state().tutorial!;
      const targets = session.advanced!.targets;
      const tower = state().world.towerById.get(session.towerId!)!;
      tick(30);
      expect(lesson()).toBe(id);
      expect(tower.damageDealt).toBe(0);
      state().setTargetingMode(mode);
      expect(state().advanceTutorial()).toBe(false);
      until(next);
      expect(targets.find(({ enemy }) => enemy.id === session.targetId)!.enemy.hp).toBeLessThan(
        targets.find(({ enemy }) => enemy.id === session.targetId)!.hp,
      );
      expect(targets.filter(({ enemy, hp }) => enemy.hp < hp)).toHaveLength(1);
    }
    const session = state().tutorial!;
    state().setTargetingMode("spot");
    tick(30);
    expect(lesson()).toBe("aimSpot");
    state().tryPlaceOrSelect({ x: 20, y: 20 });
    expect(state().spotSelecting).toBe(true);
    state().tryPlaceOrSelect(session.marker!);
    expect(state().advanceTutorial()).toBe(false);
    until("targetingComplete");
    expect(session.advanced!.targets.filter(({ enemy, hp }) => enemy.hp < hp)).toHaveLength(2);
    tick(60);
    expect(lesson()).toBe("targetingComplete");
  });

  it("does not append optional drills to the first-time path", () => {
    stage("complete");
    tick(80);
    expect(lesson()).toBe("complete");
    expect(LESSONS.findIndex((item) => item.id === "complete") + 1).toBe(27);
    expect(state().advanceTutorial()).toBe(false);
  });
});

describe("optional combat effects", () => {
  it("completes the combat chapter through real builds, upgrades, healing, damage and defensive effects", () => {
    state().startTutorial("combat");
    const chainTargets = state().tutorial!.advanced!.targets;
    tick(25);
    expect(lesson()).toBe("chainHits");
    build("pulse");
    expect(state().world.towers).toHaveLength(0);
    build("chain");
    expect(state().world.towers[0].damage).toBe(TOWER_STATS.chain.damage);
    until("burnRegen");
    expect(chainTargets.every(({ enemy, hp }) => enemy.hp < hp)).toBe(true);

    const burn = state().tutorial!;
    const pyre = state().world.towerById.get(burn.towerId!)!;
    tick(20);
    expect(lesson()).toBe("burnRegen");
    state().upgradeSelected("b");
    expect(pyre.upgrades.b).toBe(0);
    state().upgradeSelected("a");
    expect(pyre.regenSuppressOnHit).toBeGreaterThan(0);
    until("cryoFreeze");
    expect(burn.advanced!.burnHp).not.toBeNull();
    expect(burn.advanced!.targets[0].enemy.hp).toBeLessThan(burn.advanced!.burnHp!);
    expect(pyre.cooldown).toBeGreaterThan(100);

    const frost = state().tutorial!;
    const cryo = state().world.towerById.get(frost.towerId!)!;
    expect(cryo.freezeChance).toBe(0.12);
    const rolls = vi.spyOn(Math, "random").mockReturnValue(0.9);
    state().upgradeSelected("a");
    tick(80);
    expect(lesson()).toBe("cryoFreeze");
    expect(frost.advanced!.slowed).toBe(true);
    expect(frost.advanced!.frozen).toBe(false);
    rolls.mockReturnValue(0);
    until("shieldBreak");
    rolls.mockRestore();
    expect(frost.advanced!.frozen).toBe(true);

    const shield = state().tutorial!;
    const shieldEnemy = shield.advanced!.targets[0].enemy;
    expect(shieldEnemy.shield).toBeGreaterThan(0);
    tick(20);
    expect(lesson()).toBe("shieldBreak");
    state().upgradeSelected("b");
    until("healerPriority");
    expect(shieldEnemy.shield).toBe(0);
    expect(shieldEnemy.shieldBrokenAt).toBeGreaterThan(0);

    const healer = state().tutorial!;
    tick(20);
    expect(healer.advanced!.targets[0].enemy.hp).toBeGreaterThan(healer.advanced!.targets[0].hp);
    state().setTargetingMode("strongest");
    tick(20);
    expect(lesson()).toBe("healerPriority");
    state().setTargetingMode("weakest");
    until("resistStrip");
    expect(healer.advanced!.healed).toBe(true);
    expect(healer.advanced!.targets[1].enemy.alive).toBe(false);

    const strip = state().tutorial!;
    state().upgradeSelected("b");
    until("armorPierce");
    expect(strip.advanced!.targets[0].enemy.extraResists.electric).toBeGreaterThan(0.2);
    const pierce = state().tutorial!;
    state().upgradeSelected("a");
    until("adaptMix");
    expect(pierce.advanced!.targets[0].enemy.hp).toBeLessThan(pierce.advanced!.targets[0].hp);

    const adapted = state().tutorial!;
    expect(state().world.levelId).toBe(-1);
    expect(adapted.advanced!.targets[0].enemy.adaptiveResistType).toBe("kinetic");
    tick(30);
    expect(lesson()).toBe("adaptMix");
    expect(state().world.adaptation.perWave.get(2)!.kinetic).toBeGreaterThan(0);
    expect(state().world.adaptation.perWave.get(2)!.electric).toBe(0);
    build("chain");
    until("combatComplete");
    expect(state().world.adaptation.perWave.get(2)!.electric).toBeGreaterThan(0);
    expect(canPersistWorld(state().world)).toBe(false);
    tick(40);
    expect(lesson()).toBe("combatComplete");
  });

  it.each(
    ADVANCED_LESSONS.filter((item) => !item.id.endsWith("Complete")),
  )("restores $id prerequisites on reset and never auto-completes", ({ id }) => {
    stage(id);
    tick(20);
    expect(lesson()).toBe(id);
    expect(tutorialStepSatisfied(state().world, state().tutorial!)).toBe(false);
    state().restartTutorialLesson();
    expect(lesson()).toBe(id);
    expect(state().tutorial!.advanced!.armed).toBe(false);
    expect(state().tutorial!.signals.size).toBe(0);
    expect(canPersistWorld(state().world)).toBe(false);
  });

  it.each([
    "aimNear",
    "chainHits",
    "cryoFreeze",
    "adaptMix",
  ] as const)("recovers missing %s targets without losing modifiers or allowing a skipped action", (id) => {
    stage(id);
    state().world.enemies = [];
    state().world.enemyById.clear();
    tick();
    expect(lesson()).toBe(id);
    const session = state().tutorial!;
    expect(session.advanced!.targets.length).toBeGreaterThan(0);
    expect(session.advanced!.armed).toBe(false);
    expect(session.signals.size).toBe(0);
    if (id === "cryoFreeze")
      expect(session.advanced!.targets.every(({ enemy }) => enemy.regen)).toBe(true);
    if (id === "adaptMix")
      expect(session.advanced!.targets[0].enemy.adaptiveResistType).toBe("kinetic");
  });

  it("retries an empty adaptive sample using normal random rolls", () => {
    const rolls = vi.spyOn(Math, "random").mockReturnValue(0.99);
    stage("adaptMix");
    expect(state().tutorial!.advanced!.targets).toHaveLength(0);
    expect(state().world.levelId).toBe(-1);
    rolls.mockReturnValue(0);
    tick();
    expect(state().tutorial!.advanced!.targets[0].enemy.adaptiveResistType).toBe("kinetic");
    expect(state().world.levelId).toBe(-1);
    expect(state().advanceTutorial()).toBe(false);
  });
});
