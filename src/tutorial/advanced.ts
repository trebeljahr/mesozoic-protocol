import { applyMetaSkillsToTower } from "../sim/metaSkills";
import type { Enemy, TargetingMode, Tower, TowerKind, Vec2, World } from "../sim/types";
import { applyUpgrade, type BranchId } from "../sim/upgrades";
import {
  ADAPT_TRIGGER_LEVEL,
  computeAdaptiveDominant,
  createTower,
  spawnEnemy,
  tallyAdaptiveDamage,
} from "../sim/world";
import type { TutorialSession } from "./lessons";

// These chapters deliberately follow the core completion screen. They are
// opt-in practice scenarios, never extra steps on the first robot-first path.
export const ADVANCED_LESSONS = [
  { id: "aimNear", chapter: "targeting", highlight: ".targeting-buttons" },
  { id: "aimFirst", chapter: "targeting", highlight: ".targeting-buttons" },
  { id: "aimLast", chapter: "targeting", highlight: ".targeting-buttons" },
  { id: "aimStrong", chapter: "targeting", highlight: ".targeting-buttons" },
  { id: "aimWeak", chapter: "targeting", highlight: ".targeting-buttons" },
  { id: "aimVulnerable", chapter: "targeting", highlight: ".targeting-buttons" },
  { id: "aimSpot", chapter: "targeting", highlight: ".targeting-buttons" },
  { id: "targetingComplete", chapter: "targeting", highlight: "" },
  { id: "chainHits", chapter: "combat", highlight: ".tower-picker, .tower-picker-handle" },
  { id: "burnRegen", chapter: "combat", highlight: ".tower-panel .branches" },
  { id: "cryoFreeze", chapter: "combat", highlight: ".tower-panel .branches" },
  { id: "shieldBreak", chapter: "combat", highlight: ".tower-panel .branches" },
  { id: "healerPriority", chapter: "combat", highlight: ".targeting-buttons" },
  { id: "resistStrip", chapter: "combat", highlight: ".tower-panel .branches" },
  { id: "armorPierce", chapter: "combat", highlight: ".tower-panel .branches" },
  { id: "adaptMix", chapter: "combat", highlight: ".tower-picker, .tower-picker-handle" },
  { id: "combatComplete", chapter: "combat", highlight: "" },
] as const;
type AdvancedId = (typeof ADVANCED_LESSONS)[number]["id"];
export type AdvancedState = {
  id: AdvancedId;
  targets: { enemy: Enemy; hp: number; pos: Vec2 }[];
  armed: boolean;
  healed: boolean;
  slowed: boolean;
  frozen: boolean;
  burnHp: number | null;
  satisfiedAt: number | null;
};
export const TARGET_MODES: Partial<Record<AdvancedId, TargetingMode>> = {
  aimNear: "tower",
  aimFirst: "end",
  aimLast: "start",
  aimStrong: "strongest",
  aimWeak: "weakest",
  aimVulnerable: "vulnerable",
  aimSpot: "spot",
  healerPriority: "weakest",
};
const UPGRADE_BRANCHES: Partial<Record<AdvancedId, BranchId>> = {
  burnRegen: "a",
  cryoFreeze: "a",
  shieldBreak: "b",
  resistStrip: "b",
  armorPierce: "a",
};
export const trainingBuildKind = (id: string): TowerKind | undefined =>
  (
    ({
      build: "pulse",
      hive: "hive",
      mortar: "mortar",
      counter: "pulse",
      chainHits: "chain",
      adaptMix: "chain",
    }) as Record<string, TowerKind>
  )[id];
export const trainingUpgradeAllowed = (s: TutorialSession, tower: Tower, branch: BranchId) =>
  !s.advanced ||
  (s.towerId === tower.id &&
    UPGRADE_BRANCHES[s.advanced.id] === branch &&
    tower.upgrades[branch] < 3);

// Position the authored targets on the real path, so First/Last and moving
// Cryo targets use exactly the same path progress as a normal enemy.
const place = (w: World, e: Enemy, pos: Vec2) => {
  const path = w.paths[0];
  e.pos = { ...pos };
  e.lateralOffset = 0;
  e.segment = Math.max(
    0,
    path.findIndex((p, i) => i < path.length - 1 && p.x <= pos.x && path[i + 1].x >= pos.x),
  );
  e.segmentT = (pos.x - path[e.segment].x) / (path[e.segment + 1].x - path[e.segment].x);
};
const addTarget = (
  w: World,
  a: AdvancedState,
  x: number,
  options: Parameters<typeof spawnEnemy>[2] = {},
  kind: Enemy["kind"] = "raptor",
) => {
  const e = spawnEnemy(w, kind, { hpMul: 100, ...options });
  place(w, e, { x, y: 0 });
  e.speed = 0;
  e.bounty = 0;
  a.targets.push({ enemy: e, hp: e.hp, pos: { ...e.pos } });
  return e;
};
const stageTower = (w: World, s: TutorialSession, kind: TowerKind, branch?: BranchId) => {
  const t = createTower(w, kind, { x: 0, y: -3 });
  if (branch) {
    applyUpgrade(w, t, branch);
    applyUpgrade(w, t, branch);
  }
  t.cooldown = 1e6; // The lesson's real action releases firing, not elapsed time.
  s.towerId = t.id;
  w.selectedTowerId = t.id;
  return t;
};

export const prepareAdvanced = (w: World, s: TutorialSession, id: string) => {
  const a: AdvancedState = {
    id: id as AdvancedId,
    targets: [],
    armed: false,
    healed: false,
    slowed: false,
    frozen: false,
    burnHp: null,
    satisfiedAt: null,
  };
  s.advanced = a;
  s.towerId = null;
  w.wave = 0;
  w.waveActive = false;
  w.nextWaveIn = 20;
  w.robot.selected = false;
  w.robot.pos = { x: 13, y: 0 };
  w.robot.attackCooldown = 1e6;
  if (id.endsWith("Complete")) return;
  if (id.startsWith("aim")) {
    const t = stageTower(w, s, id === "aimSpot" ? "mortar" : "pulse");
    t.targetingMode = TARGET_MODES[a.id] === "end" ? "start" : "end";
    const left = addTarget(w, a, -3, { hpMul: 200 });
    const middle = addTarget(w, a, 0);
    const right = addTarget(
      w,
      a,
      id === "aimSpot" ? 1 : 3,
      { hpMul: 150 },
      id === "aimVulnerable" ? "armored" : "raptor",
    );
    right.hp = 300;
    // Strongest uses maximum HP; Weak uses current HP. The strongest target
    // is neither nearest nor farthest along the lane.
    const target =
      id === "aimNear" || id === "aimSpot"
        ? middle
        : ["aimLast", "aimStrong"].includes(id)
          ? left
          : right;
    s.targetId = target.id;
    s.marker = { ...target.pos };
  } else if (id === "chainHits") {
    for (const x of [-1, 0, 1]) addTarget(w, a, x);
    s.marker = { x: 0, y: -3 };
  } else if (id === "burnRegen") {
    const t = stageTower(w, s, "flame", "a");
    applyMetaSkillsToTower(t, { flame: { a: 3, b: 0, c: 0 } });
    const e = addTarget(w, a, 0, { regen: true });
    e.hp /= 2;
    s.targetId = e.id;
  } else if (id === "cryoFreeze") {
    const t = stageTower(w, s, "cryo", "a");
    // Flash Freeze is the real Lab unlock (12%), never a guaranteed test roll.
    applyMetaSkillsToTower(t, { cryo: { a: 3, b: 0, c: 0 } });
    for (const x of [-2.8, -2, -1.2, -0.4, 0.4, 1.2, 2, 2.8]) {
      const e = addTarget(w, a, x, { regen: true });
      e.speed = 0.6;
      e.hp /= 2;
    }
    s.targetId = a.targets[3].enemy.id;
  } else if (id === "shieldBreak") {
    stageTower(w, s, "mortar", "b");
    s.targetId = addTarget(w, a, 0, { shielded: true }, "titan").id;
  } else if (id === "healerPriority") {
    stageTower(w, s, "pulse").targetingMode = "tower";
    const wounded = addTarget(w, a, 0);
    wounded.hp /= 2;
    s.targetId = addTarget(w, a, 2, { hpMul: 1, healAura: true }).id;
  } else if (id === "resistStrip") {
    stageTower(w, s, "chain", "b");
    s.targetId = addTarget(w, a, 0, { resists: { electric: 0.2 } }).id;
  } else if (id === "armorPierce") {
    stageTower(w, s, "pulse", "a");
    s.targetId = addTarget(w, a, 0, { resists: { kinetic: 0.2 } }).id;
  } else if (id === "adaptMix") {
    // An authored prior wave dominated by kinetic damage. The production
    // dominant-type picker and spawn sampler construct the adapted enemy.
    w.wave = 1;
    w.adaptation.perWave.clear();
    tallyAdaptiveDamage(w, "kinetic", 1000);
    const dominant = computeAdaptiveDominant(w);
    w.adaptation.dominantNext = dominant.type;
    w.adaptation.dominantShare = dominant.share;
    w.adaptation.dominantStreak = 1;
    const level = w.levelId;
    w.levelId = ADAPT_TRIGGER_LEVEL;
    // Select a real adapted spawn. A failed batch retries during maintenance;
    // no synthetic resistance/tint or random-number override is used.
    for (let i = 0; i < 64; i++) {
      const e = addTarget(w, a, 0);
      if (e.adaptiveResistType) {
        s.targetId = e.id;
        break;
      }
      w.enemies.pop();
      w.enemyById.delete(e.id);
      a.targets.pop();
    }
    w.levelId = level;
    w.wave = 2;
    const t = stageTower(w, s, "pulse");
    t.pos = { x: -3, y: -3 };
    t.cooldown = 0;
    w.selectedTowerId = null;
    s.marker = { x: 3, y: -3 };
  }
  for (const target of a.targets) target.hp = target.enemy.hp;
  if (!s.marker && s.targetId !== null) s.marker = { ...w.enemyById.get(s.targetId)!.pos };
  // Preparation upgrades are not player actions and should not play their SFX.
  w.events = [];
};

export const advancedAction = (w: World, s: TutorialSession | null) => {
  if (!s?.advanced) return;
  const a = s.advanced;
  const t = w.towerById.get(s.towerId!);
  if (!t) return;
  const mode = TARGET_MODES[a.id];
  const branch = UPGRADE_BRANCHES[a.id];
  const ready = mode
    ? t.targetingMode === mode && (mode === "spot" ? s.signals.has("spot") : s.signals.has("mode"))
    : branch
      ? t.upgrades[branch] === 3 && s.signals.has("upgrade")
      : false;
  if (ready && !a.armed) {
    a.armed = true;
    t.cooldown = 0;
  }
};

const effectSatisfied = (w: World, s: TutorialSession): boolean => {
  const a = s.advanced!;
  const t = w.towerById.get(s.towerId!);
  const e = a.targets.find(({ enemy }) => enemy.id === s.targetId)?.enemy;
  const hit = (enemy: Enemy) => enemy.hp < a.targets.find((target) => target.enemy === enemy)!.hp;
  if (a.id.startsWith("aim")) {
    const mode = TARGET_MODES[a.id];
    return !!(
      a.armed &&
      t &&
      t.targetingMode === mode &&
      e &&
      hit(e) &&
      (mode === "spot"
        ? a.targets.filter(({ enemy }) => hit(enemy)).length >= 2
        : t.targetId === e.id)
    );
  }
  if (a.id === "chainHits") return a.targets.filter(({ enemy }) => hit(enemy)).length >= 3;
  if (a.id === "burnRegen") {
    if (!a.armed || !e || !t) return false;
    if (a.burnHp === null && e.igniteUntil > w.time && e.regenPausedUntil > w.time) {
      // Pause direct fire after ignition to make the real lingering DOT visible.
      a.burnHp = e.hp;
      t.cooldown = 1e6;
    }
    return a.burnHp !== null && e.hp < a.burnHp && e.regenPausedUntil > w.time;
  }
  if (a.id === "cryoFreeze") {
    a.slowed ||= a.targets.some(
      ({ enemy }) =>
        enemy.slowUntil > w.time && enemy.slowFactor < 1 && enemy.regenPausedUntil > w.time,
    );
    a.frozen ||= a.targets.some(({ enemy }) => enemy.freezeUntil > w.time);
    return a.armed && a.slowed && a.frozen;
  }
  if (a.id === "shieldBreak")
    return !!(a.armed && e && e.shieldBrokenAt > 0 && e.shield === 0 && t && t.damageDealt > 0);
  if (a.id === "healerPriority") {
    a.healed ||= a.targets[0].enemy.hp > a.targets[0].hp;
    return a.armed && a.healed && !!e && !e.alive;
  }
  if (a.id === "resistStrip")
    return !!(a.armed && e && (e.extraResists.electric ?? 0) > 0.2 && hit(e));
  if (a.id === "armorPierce")
    return !!(a.armed && e && t?.armorPierce && a.targets[0].hp - e.hp >= t.damage - 0.001);
  if (a.id === "adaptMix") {
    const damage = w.adaptation.perWave.get(2);
    return !!(
      e?.adaptiveResistType === "kinetic" &&
      damage &&
      damage.kinetic > 0 &&
      damage.electric > 0 &&
      w.towers.some((tower) => tower.kind === "chain" && tower.damageDealt > 0)
    );
  }
  return false;
};

// Keep the result on screen long enough to see the beam, burn, ice or break.
export const advancedSatisfied = (w: World, s: TutorialSession): boolean => {
  const a = s.advanced!;
  if (a.satisfiedAt === null && effectSatisfied(w, s)) a.satisfiedAt = w.time;
  return a.satisfiedAt !== null && w.time - a.satisfiedAt >= 1.2;
};

export const maintainAdvanced = (w: World, s: TutorialSession) => {
  const a = s.advanced!;
  w.nextWaveIn = 20;
  if (a.id.endsWith("Complete") || a.satisfiedAt !== null) return;
  // A destroyed/removed target or an unlikely empty adaptive batch restarts
  // the drill, keeping genuine target stats, modifiers, and action gates.
  if (
    (a.id === "adaptMix" && !a.targets.length) ||
    a.targets.some(
      ({ enemy }) =>
        (!w.enemyById.has(enemy.id) || !enemy.alive) &&
        !(a.id === "healerPriority" && a.armed && enemy.id === s.targetId && !enemy.alive),
    )
  ) {
    w.enemies = [];
    w.enemyById.clear();
    w.towers = [];
    w.towerById.clear();
    w.projectiles = [];
    w.beams = [];
    w.cryoWaves = [];
    s.signals.clear();
    s.targetId = null;
    s.marker = null;
    prepareAdvanced(w, s, a.id);
    return;
  }
  if (a.id === "cryoFreeze")
    for (const { enemy, pos } of a.targets) {
      if (enemy.pos.x > 3) place(w, enemy, { x: -3, y: pos.y });
    }
  if (a.id === "burnRegen" && a.burnHp !== null) {
    const e = a.targets[0].enemy;
    // Interruption or a coarse simulation frame must not strand an expired burn.
    if (e.igniteUntil <= w.time && e.hp >= a.burnHp) {
      a.burnHp = null;
      const t = w.towerById.get(s.towerId!);
      if (t) t.cooldown = 0;
    }
  }
};
