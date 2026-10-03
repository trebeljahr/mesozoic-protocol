import type { LevelConfig } from "../levels";
import { excludeWorldFromPersistence } from "../persistence/missionCheckpoint";
import { emptyProgress, type ProgressData } from "../progress";
import { startWave } from "../sim/spawner";
import type { GameEvent, TowerKind, Vec2, World } from "../sim/types";
import { createTower, createWorld, spawnEnemy } from "../sim/world";
import {
  ADVANCED_LESSONS,
  type AdvancedState,
  advancedSatisfied,
  maintainAdvanced,
  prepareAdvanced,
} from "./advanced";

// Public persistence boundary: checkpoint/reward code must exclude worlds with
// sessionKind === "tutorial". The store also clears activeSlot during training.
export const isTutorialWorld = (world: World): boolean => world.sessionKind === "tutorial";
export const CHAPTERS = [
  "robot",
  "towers",
  "drones",
  "field",
  "waves",
  "progression",
  "targeting",
  "combat",
] as const;
export type TutorialChapter = (typeof CHAPTERS)[number];
export const LESSONS = [
  { id: "selectRobot", chapter: "robot", highlight: ".robot-portrait" },
  { id: "moveRobot", chapter: "robot", highlight: ".robot-portrait" },
  { id: "dash", chapter: "robot", highlight: ".robot-ability:nth-child(1)" },
  { id: "burst", chapter: "robot", highlight: ".robot-ability:nth-child(2)" },
  { id: "buff", chapter: "robot", highlight: ".robot-ability:nth-child(3)" },
  { id: "storm", chapter: "robot", highlight: ".robot-ability:nth-child(4)" },
  { id: "build", chapter: "towers", highlight: ".tower-picker, .tower-picker-handle" },
  { id: "inspectTower", chapter: "towers", highlight: ".tower-panel" },
  { id: "upgrade", chapter: "towers", highlight: ".tower-panel .branches" },
  { id: "target", chapter: "towers", highlight: ".targeting-buttons" },
  { id: "vulnerable", chapter: "towers", highlight: ".targeting-buttons" },
  { id: "hive", chapter: "drones", highlight: ".tower-picker, .tower-picker-handle" },
  { id: "assign", chapter: "drones", highlight: ".tower-panel" },
  { id: "reassign", chapter: "drones", highlight: ".tower-panel" },
  { id: "mortar", chapter: "field", highlight: ".tower-picker, .tower-picker-handle" },
  { id: "spot", chapter: "field", highlight: ".targeting-buttons" },
  { id: "prop", chapter: "field", highlight: ".tree-panel" },
  { id: "base", chapter: "field", highlight: ".base-panel" },
  { id: "sell", chapter: "field", highlight: ".panel-footer" },
  { id: "enemy", chapter: "waves", highlight: ".enemy-panel" },
  { id: "counter", chapter: "waves", highlight: ".tower-picker, .tower-picker-handle" },
  { id: "wave", chapter: "waves", highlight: ".call-wave-btn" },
  { id: "defend", chapter: "waves", highlight: ".tower-panel" },
  { id: "early", chapter: "waves", highlight: ".call-wave-btn" },
  { id: "lab", chapter: "progression", highlight: ".skill-tree-panel" },
  { id: "robotSkill", chapter: "progression", highlight: ".robot-shop-panel" },
  { id: "complete", chapter: "progression", highlight: "" },
  ...ADVANCED_LESSONS,
] as const;
export type LessonId = (typeof LESSONS)[number]["id"];
export type TutorialSignal =
  | "mode"
  | "move"
  | "inspectTower"
  | "upgrade"
  | "target"
  | "vulnerable"
  | "assign"
  | "reassign"
  | "spot"
  | "prop"
  | "base"
  | "sell"
  | "enemy"
  | "wave"
  | "defend"
  | "early"
  | "lab"
  | "robotSkill";
export type TutorialSession = {
  step: number;
  signals: Set<TutorialSignal | "dash" | "burst" | "buff" | "storm">;
  marker: Vec2 | null;
  targetId: number | null;
  towerId: number | null;
  baselineDamage: number;
  advanced?: AdvancedState;
};
export const lessonFor = (session: TutorialSession) => LESSONS[session.step];
export const TRAINING_LEVEL: LevelConfig = {
  id: -1,
  name: "Training ground",
  nodePos: { x: -15, y: -12 },
  startGold: 3000,
  paths: [
    [
      { x: -18, y: 0 },
      { x: 15, y: 0 },
    ],
  ],
  waves: [
    { spawns: [{ kind: "raptor", count: 2 }], spacing: 0.6 },
    { spawns: [{ kind: "swarm", count: 4 }], spacing: 0.6 },
    { spawns: [{ kind: "raptor", count: 3 }], spacing: 0.6 },
  ],
};
export const trainingProgress = (): ProgressData => ({
  ...emptyProgress(),
  difficulty: "medium",
  bolts: 1000,
  starsByLevel: { 1: { normal: 3, breach: 0, containment: 0 } },
  robotXp: { leela: 1000 },
});
const clearEnemies = (w: World) => {
  w.enemies = [];
  w.enemyById.clear();
  w.projectiles = [];
  w.beams = [];
  w.cryoWaves = [];
  w.explosions = [];
  w.coalEmbers = [];
  w.robotCraters = [];
  w.spawnQueue = [];
  w.robot.pendingShots = [];
  w.robot.payload = null;
};
const clearTowers = (w: World) => {
  w.towers = [];
  w.towerById.clear();
  w.selectedTowerId = null;
};
const addTower = createTower;
const ensureTower = (w: World, kind: TowerKind, pos: Vec2) =>
  w.towers.find((t) => t.kind === kind) ?? addTower(w, kind, pos);
const dummy = (w: World, pos: Vec2, armored = false) => {
  const e = spawnEnemy(w, armored ? "armored" : "raptor", { hpMul: 100 });
  e.pos = { ...pos };
  e.speed = 0;
  e.bounty = 0;
  // Keep stationary targets on the same real lane, with correct path progress.
  const path = w.paths[0];
  e.segment = Math.max(
    0,
    path.findIndex((p, i) => i < path.length - 1 && p.x <= pos.x && path[i + 1].x >= pos.x),
  );
  e.segmentT = (pos.x - path[e.segment].x) / (path[e.segment + 1].x - path[e.segment].x);
  return e;
};

export const createTraining = (chapter: TutorialChapter = "robot") => {
  const world = createWorld(TRAINING_LEVEL);
  world.sessionKind = "tutorial";
  excludeWorldFromPersistence(world);
  world.invincible = true;
  world.trees = [];
  world.rocks = [];
  world.outposts = [];
  world.props = [];
  world.rivers = [];
  world.lakes = [];
  world.autoBridges = [];
  world.flowFeatures = null;
  world.easterEggs = [];
  world.easterEggSchedule = [];
  world.robot.pos = { x: -6, y: 0 };
  world.robot.moveTarget = null;
  const session: TutorialSession = {
    step: LESSONS.findIndex((s) => s.chapter === chapter),
    signals: new Set(),
    marker: null,
    targetId: null,
    towerId: null,
    baselineDamage: 0,
  };
  prepareLesson(world, session);
  return { world, session, progress: trainingProgress() };
};

export const prepareLesson = (w: World, s: TutorialSession) => {
  const id = lessonFor(s).id;
  s.signals = new Set();
  s.marker = null;
  s.targetId = null;
  if (w.gold < 1000) w.gold = 3000;
  w.selectedBase = false;
  w.robot.dashAim = null;
  w.robot.abilityReadyAt = [0, 0, 0, 0];
  w.robot.moveTarget = null;
  w.robot.selfBuff = null;
  w.robot.payload = null;
  s.advanced = undefined;
  if (lessonFor(s).chapter === "targeting" || lessonFor(s).chapter === "combat") {
    clearEnemies(w);
    clearTowers(w);
    prepareAdvanced(w, s, id);
    return;
  }
  if (id === "selectRobot") {
    w.robot.selected = false;
    s.marker = { ...w.robot.pos };
  }
  if (id === "moveRobot") {
    w.robot.selected = true;
    s.marker = { x: -2, y: 0 };
  }
  if (["dash", "burst", "buff", "storm"].includes(id)) {
    clearEnemies(w);
    w.robot.pos = { x: -2, y: 0 };
    w.robot.selected = true;
    s.marker = { x: id === "dash" ? 3 : 0.5, y: 0 };
    const e = dummy(w, s.marker);
    s.targetId = e.id;
    w.robot.attackCooldown = id === "buff" ? 0 : 100000;
  }
  if (id === "build" || id === "hive" || id === "mortar" || id === "enemy") {
    clearEnemies(w);
    clearTowers(w);
    w.robot.selected = false;
    w.robot.pos = { x: 12, y: 0 };
  }
  if (id === "build") s.marker = { x: -2, y: -3 };
  if (["inspectTower", "upgrade", "target", "vulnerable"].includes(id)) {
    const t = ensureTower(w, "pulse", { x: -2, y: -3 });
    s.towerId = t.id;
    s.marker = t.pos;
    if (id !== "inspectTower") w.selectedTowerId = t.id;
  }
  if (id === "hive") {
    addTower(w, "pulse", { x: -3, y: -3 });
    addTower(w, "chain", { x: 3, y: -3 });
    s.marker = { x: 0, y: -6 };
  }
  if (id === "assign" || id === "reassign") {
    const h = ensureTower(w, "hive", { x: 0, y: -6 });
    const a = ensureTower(w, "pulse", { x: -3, y: -3 });
    const b = ensureTower(w, "chain", { x: 3, y: -3 });
    const assignedIndex = Math.max(0, h.droneAssignments.indexOf(a.id));
    h.droneAssignments.fill(null);
    if (id === "reassign") h.droneAssignments[assignedIndex] = a.id;
    s.towerId = id === "assign" ? a.id : b.id;
    s.marker = w.towerById.get(s.towerId)!.pos;
    w.selectedTowerId = h.id;
  }
  if (id === "mortar") s.marker = { x: -2, y: -3 };
  if (id === "spot") {
    const t = ensureTower(w, "mortar", { x: -2, y: -3 });
    w.selectedTowerId = t.id;
    t.targetSpot = null;
    t.targetingMode = "tower";
    s.towerId = t.id;
    s.marker = { x: t.pos.x, y: 0 };
    clearEnemies(w);
    s.targetId = dummy(w, s.marker).id;
  }
  if (id === "prop") {
    clearEnemies(w);
    w.selectedTowerId = null;
    w.trees = [{ id: w.nextEntityId++, pos: { x: -6, y: -3 }, variant: 0, scale: 1, rot: 0 }];
    s.marker = w.trees[0].pos;
  }
  if (id === "base") {
    s.marker = w.paths[0][w.paths[0].length - 1];
    w.base.upgrades = { a: 0, b: 0 };
  }
  if (id === "sell") {
    const t = ensureTower(w, "pulse", { x: -6, y: -3 });
    s.towerId = t.id;
    s.marker = t.pos;
    w.selectedTowerId = t.id;
  }
  if (id === "enemy" || id === "counter") {
    if (id === "enemy") clearEnemies(w);
    if (id === "counter") clearTowers(w);
    const e =
      w.enemies.find((e) => e.kind === "armored" && e.alive) ?? dummy(w, { x: 0, y: 0 }, true);
    s.targetId = e.id;
    s.marker = id === "enemy" ? e.pos : { x: 0, y: -3 };
    w.robot.selected = false;
  }
  if (id === "wave") {
    clearEnemies(w);
    w.wave = 0;
    w.waveActive = false;
    w.nextWaveIn = 20;
    const t = ensureTower(w, "pulse", { x: -3, y: -3 });
    t.damage = 200;
  }
  if (id === "defend" && w.wave === 0) {
    clearEnemies(w);
    const t = ensureTower(w, "pulse", { x: -3, y: -3 });
    t.damage = 200;
    startWave(w);
  }
  if (id === "early") {
    // Stage the normal between-wave call window so no speed or resource race is required.
    clearEnemies(w);
    w.wave = 1;
    w.waveActive = false;
    w.nextWaveIn = 20;
  }
  if (["lab", "robotSkill", "complete"].includes(id)) {
    clearEnemies(w);
    w.wave = 0;
    w.waveActive = false;
  }
  s.baselineDamage = w.robot.damageDealt;
};

// Only accepted game actions enter this set; opening a lesson or waiting never does.
export const signalTutorial = (s: TutorialSession | null, signal: TutorialSignal) => {
  s?.signals.add(signal);
};
export const recordTutorialEvents = (s: TutorialSession, events: GameEvent[], world?: World) => {
  for (const e of events) {
    if (e.type === "death" && e.target === "enemy") s.signals.add("defend");
    if (e.type !== "robot-ability" || !["dash", "burst", "buff", "storm"].includes(e.kind))
      continue;
    if (e.kind === "buff" && !s.signals.has("buff") && world)
      s.baselineDamage = world.robot.damageDealt;
    s.signals.add(e.kind as "dash" | "burst" | "buff" | "storm");
  }
};
export const tutorialStepSatisfied = (w: World, s: TutorialSession): boolean => {
  const id = lessonFor(s).id;
  if (s.advanced) return advancedSatisfied(w, s);
  const near = (p: Vec2, q: Vec2, distance = 1) => Math.hypot(p.x - q.x, p.y - q.y) < distance;
  if (id === "selectRobot") return w.robot.selected;
  if (id === "moveRobot") return s.signals.has("move") && near(w.robot.pos, s.marker!);
  if (id === "dash")
    return (
      s.signals.has("dash") &&
      w.time >= w.robot.abilityActiveUntil[0] &&
      near(w.robot.pos, s.marker!, 1.6)
    );
  if (id === "storm") return s.signals.has(id) && w.robot.damageDealt - s.baselineDamage >= 70;
  if (id === "buff")
    return s.signals.has(id) && w.robot.selfBuff !== null && w.robot.damageDealt > s.baselineDamage;
  if (id === "burst") return s.signals.has(id) && w.robot.damageDealt > s.baselineDamage;
  if (id === "build") return w.towers.some((t) => t.kind === "pulse");
  if (id === "hive") return w.towers.some((t) => t.kind === "hive");
  if (id === "mortar") return w.towers.some((t) => t.kind === "mortar");
  if (id === "counter") return w.towers.some((t) => t.kind === "pulse" && t.damageDealt > 0);
  if (id === "complete") return false;
  return [...s.signals].some((signal) => signal === id);
};

export const maintainTraining = (w: World, s: TutorialSession) => {
  w.robot.iFrameUntil = w.time + 1;
  w.robot.hp = w.robot.maxHp;
  w.robot.alive = true;
  w.robot.respawnAt = null;
  // Practice resources replenish, while individual transactions still debit/refund normally.
  if (w.gold < 1000) w.gold = 3000;
  const id = lessonFor(s).id;
  if (id === "early" && w.wave === 1 && !w.waveActive) w.nextWaveIn = 20;
  if (s.advanced) {
    maintainAdvanced(w, s);
    if (w.status === "won" || w.status === "lost") w.status = "running";
    return;
  }
  // A target killed by experimentation is replaced; no lesson can lose its target.
  if (s.targetId !== null && !w.enemies.some((e) => e.id === s.targetId && e.alive)) {
    const e = dummy(
      w,
      id === "enemy" || id === "counter" ? { x: 0, y: 0 } : s.marker!,
      id === "enemy" || id === "counter",
    );
    s.targetId = e.id;
  }
  if (w.status === "won" || w.status === "lost") w.status = "running";
};
