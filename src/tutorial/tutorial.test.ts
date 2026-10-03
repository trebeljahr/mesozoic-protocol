import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkAchievements } from "../achievements";
import { emptyProgress, saveSlot } from "../progress";
import { Engine } from "../sim/loop";
import type { TowerKind } from "../sim/types";
import { createWorld } from "../sim/world";
import { useGame } from "../store";
import {
  CHAPTERS,
  createTraining,
  isTutorialWorld,
  type LessonId,
  lessonFor,
  TRAINING_LEVEL,
} from "./lessons";

const initial = useGame.getState();
const storage = new Map<string, string>();
const setItem = vi.fn((key: string, value: string) => storage.set(key, value));
let time = 0;
const state = () => useGame.getState();
const lesson = () => lessonFor(state().tutorial!).id;
const tick = (count = 1) => {
  for (let i = 0; i < count; i++) {
    time += 0.1;
    state().tick(time);
  }
};
const until = (expected: LessonId, count = 300) => {
  for (let i = 0; i < count && lesson() !== expected; i++) tick();
  expect(lesson()).toBe(expected);
};
const build = (kind: TowerKind) => {
  state().setSelectedKind(kind);
  state().tryPlaceOrSelect(state().tutorial!.marker!);
  tick();
};

beforeEach(() => {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem,
      removeItem: (key: string) => storage.delete(key),
    },
  });
  storage.clear();
  setItem.mockClear();
  time = 0;
  const progress = { ...emptyProgress(), bolts: 47, robotXp: { leela: 325 } };
  useGame.setState({
    ...initial,
    world: createWorld(TRAINING_LEVEL),
    engine: new Engine(),
    progress,
    activeSlot: 1,
    screen: "worldMap",
  });
  saveSlot(1, progress);
  storage.set("suspended-mission", "leave this checkpoint untouched");
  setItem.mockClear();
});

describe("interactive training", () => {
  it("requires real selection, legal arrival, a committed aimed dash, and all four ability effects", () => {
    state().startTutorial();
    tick(20);
    expect(lesson()).toBe("selectRobot");
    state().callWaveEarly();
    expect(state().world.wave).toBe(0);
    state().triggerRobotAbility(1);
    expect(state().world.robot.abilityReadyAt[1]).toBe(0);
    state().selectRobotUnit(true);
    tick();
    expect(lesson()).toBe("moveRobot");
    expect(state().orderRobotMove({ x: -2, y: 8 })).toBe(false);
    tick(10);
    expect(lesson()).toBe("moveRobot");
    expect(state().orderRobotMove(state().tutorial!.marker!)).toBe(true);
    expect(lesson()).toBe("moveRobot");
    until("dash");
    state().triggerRobotAbility(0);
    tick(5);
    expect(lesson()).toBe("dash");
    expect(state().world.robot.dashAim).not.toBeNull();
    state().setRobotDashAimDir({ x: 1, y: 0 });
    state().triggerRobotAbility(0);
    until("burst");
    state().triggerRobotAbility(1);
    until("buff");
    tick(5);
    expect(lesson()).toBe("buff");
    state().triggerRobotAbility(2);
    until("storm");
    state().triggerRobotAbility(3);
    until("build");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("gates tower inspection, upgrade purchase and actual targeting changes", () => {
    state().startTutorial("towers");
    state().setSelectedKind("hive");
    expect(state().selectedKind).toBeNull();
    state().setSelectedKind("pulse");
    state().tryPlaceOrSelect({ x: -2, y: 0 });
    tick();
    expect(lesson()).toBe("build");
    build("pulse");
    expect(lesson()).toBe("inspectTower");
    const id = state().tutorial!.towerId!;
    state().upgradeSelected("a");
    tick();
    expect(lesson()).toBe("inspectTower");
    state().selectTower(id);
    tick();
    expect(lesson()).toBe("upgrade");
    state().upgradeSelected("a");
    tick();
    expect(lesson()).toBe("target");
    state().setTargetingMode("end");
    tick();
    expect(lesson()).toBe("target");
    state().setTargetingMode("strongest");
    tick();
    expect(lesson()).toBe("vulnerable");
    state().setTargetingMode("strongest");
    tick();
    expect(lesson()).toBe("vulnerable");
    state().setTargetingMode("vulnerable");
    tick();
    expect(lesson()).toBe("hive");
  });

  it("requires assignment and reassignment of the same occupied drone, not opening the picker", () => {
    state().startTutorial("drones");
    build("hive");
    expect(lesson()).toBe("assign");
    const hive = state().world.towers.find((t) => t.kind === "hive")!;
    const pulse = state().tutorial!.towerId!;
    state().beginDroneAssignment(hive.id, 2);
    tick();
    expect(lesson()).toBe("assign");
    state().assignDroneToTower(hive.id);
    tick();
    expect(lesson()).toBe("assign");
    state().assignDroneToTower(pulse);
    tick();
    expect(lesson()).toBe("reassign");
    const chain = state().tutorial!.towerId!;
    state().beginDroneAssignment(hive.id, 2);
    state().assignDroneToTower(pulse);
    tick();
    expect(lesson()).toBe("reassign");
    state().beginDroneAssignment(hive.id, 2);
    state().assignDroneToTower(chain);
    tick();
    expect(lesson()).toBe("mortar");
  });

  it("uses fixed ground aiming, prop removal, HQ upgrade and the real sell refund", () => {
    state().startTutorial("field");
    build("mortar");
    expect(lesson()).toBe("spot");
    state().setTargetingMode("spot");
    tick();
    expect(lesson()).toBe("spot");
    state().tryPlaceOrSelect({ x: 19, y: 10 });
    tick();
    expect(lesson()).toBe("spot");
    state().tryPlaceOrSelect(state().tutorial!.marker!);
    tick();
    expect(lesson()).toBe("prop");
    state().selectTree(state().world.trees[0].id);
    tick();
    expect(lesson()).toBe("prop");
    state().confirmRemoveTree();
    tick();
    expect(lesson()).toBe("base");
    state().selectBase(true);
    state().upgradeBase("a");
    tick();
    expect(lesson()).toBe("sell");
    const before = state().world.gold;
    state().sellSelected();
    expect(state().world.gold).toBeGreaterThan(before);
    tick();
    expect(lesson()).toBe("enemy");
  });

  it("checks a counter dealing damage, a real wave kill, and a paid early call", () => {
    state().startTutorial("waves");
    const enemy = state().world.enemyById.get(state().tutorial!.targetId!)!;
    state().inspectEnemy(enemy.id, enemy.kind, enemy.maxHp, null);
    tick();
    expect(lesson()).toBe("counter");
    expect(state().inspectedEnemy.id).toBe(enemy.id);
    build("pulse");
    until("wave");
    state().callWaveEarly();
    tick();
    expect(lesson()).toBe("defend");
    state().restartTutorialLesson();
    expect(lesson()).toBe("defend");
    until("early", 500);
    tick(250);
    expect(lesson()).toBe("early");
    expect(state().world.wave).toBe(1);
    const before = state().world.gold;
    state().callWaveEarly();
    expect(state().world.gold).toBeGreaterThan(before);
    tick();
    expect(lesson()).toBe("lab");
  });

  it("uses practice progression without save writes, achievement rewards or campaign changes", () => {
    const original = state();
    const originalProgress = JSON.stringify(original.progress);
    const saved = new Map(storage);
    state().startTutorial("progression");
    expect(state().activeSlot).toBeNull();
    expect(isTutorialWorld(state().world)).toBe(true);
    state().setSkillTreeOpen(true);
    tick();
    expect(lesson()).toBe("lab");
    state().setMetaSkillTier("pulse", "a", 1);
    expect(lesson()).toBe("robotSkill");
    expect(state().skillTreeOpen).toBe(false);
    state().setRobotShopOpen(true);
    state().setRobotSkillRank("leela", "vitality", 1);
    expect(lesson()).toBe("complete");
    expect(state().world.status).toBe("running");
    expect(state().progress.bolts).toBeLessThan(1000);
    state().world.events.push(
      { type: "death", target: "enemy", enemyKind: "raptor", bolts: 999, pos: { x: 0, y: 0 } },
      { type: "game-over", won: true },
    );
    tick();
    expect(state().lastResult).toBeNull();
    expect(state().achievementToasts).toEqual([]);
    expect(
      checkAchievements(state().progress, state().world, { type: "game-over", won: true }).unlocked,
    ).toEqual([]);
    expect(setItem).not.toHaveBeenCalled();
    expect(storage).toEqual(saved);
    state().exitTutorial();
    expect(state().progress).toBe(original.progress);
    expect(JSON.stringify(state().progress)).toBe(originalProgress);
    expect(state().world).toBe(original.world);
    expect(state().activeSlot).toBe(1);
    expect(state().screen).toBe("worldMap");
    expect(storage).toEqual(saved);
  });

  it("restarts lessons, replays every chapter, and restores the original session through every exit route", () => {
    const original = state();
    state().startTutorial();
    state().selectRobotUnit(true);
    tick();
    state().orderRobotMove(state().tutorial!.marker!);
    until("dash");
    state().triggerRobotAbility(0);
    state().restartTutorialLesson();
    expect(lesson()).toBe("dash");
    expect(state().world.robot.dashAim).toBeNull();
    expect(state().tutorial!.signals.size).toBe(0);
    for (const chapter of CHAPTERS) {
      state().startTutorial(chapter);
      expect(lessonFor(state().tutorial!).chapter).toBe(chapter);
      state().world.gold = 0;
      tick();
      expect(state().world.gold).toBeGreaterThan(0);
      state().retryCurrentLevel();
      expect(lessonFor(state().tutorial!).chapter).toBe(chapter);
    }
    state().goToWorldMap();
    expect(state().progress).toBe(original.progress);
    expect(state().tutorial).toBeNull();
    state().startTutorial();
    state().goToSlots();
    expect(state().tutorial).toBeNull();
    expect(state().screen).toBe("worldMap");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("replaces defeated practice targets and keeps a dedicated empty legal board", () => {
    const built = createTraining("waves");
    expect(built.world.levelId).toBe(-1);
    expect(built.world.flowFeatures).toBeNull();
    expect(built.world.outposts).toEqual([]);
    state().startTutorial("waves");
    const firstId = state().tutorial!.targetId!;
    state().world.enemies = [];
    state().world.enemyById.clear();
    tick();
    expect(state().tutorial!.targetId).not.toBe(firstId);
    expect(state().world.enemies[0].alive).toBe(true);
    expect(lesson()).toBe("enemy");
  });
});
