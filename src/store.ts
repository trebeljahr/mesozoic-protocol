import { create } from "zustand";
import type { AchievementId } from "./achievements";
import { ACHIEVEMENT_BY_ID, checkAchievements } from "./achievements";
import { track } from "./analytics";
import { BIOME_LAYERS, BIOME_TREE_URLS, classifyPropUrl, TARGET_SIZE_BY_ROLE } from "./biomes";
import { isDebug } from "./debug";
import { deriveSuggestedDebugLoadout, type PlannerTrace } from "./debugPlannerTrace";
import { EASTER_EGG_BY_ID, EASTER_EGG_DEFS } from "./easterEggs";
import { isOnFlowSurface } from "./flowGeometry";
import { MAP_HEIGHT, MAP_WIDTH, PATH_WIDTH } from "./level";
import type { LevelConfig } from "./levels";
import { getLevel, LEVELS, levelHasMode, resolveLevelMode } from "./levels";
import { hasLevelBriefing } from "./levels/briefings";
import { getEndlessArena } from "./levels/endless";
import { LORE_FRAGMENT_ORDER } from "./levels/lore";
import type { Difficulty, LevelMode, ProgressData, SlotId, Stars } from "./progress";
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY_MULTIPLIERS,
  deleteSlot as deleteSlotStorage,
  emptyProgress,
  getEndlessBest,
  getModeStars,
  hasUnlockedEndless,
  isLevelUnlocked,
  isModeUnlocked,
  loadSlot,
  markEasterEggTriggered,
  markEncountered,
  markEndlessUnlockExplainerSeen,
  markMatriarchsEncountered,
  markModesUnlockExplainerSeen,
  minDifficulty,
  recordEndlessResult,
  recordLevelResult,
  saveSlot,
  setDifficulty as setDifficultyOnProgress,
  starsForRun,
  totalStars,
  triggeredEasterEggIdsForLevel,
} from "./progress";
import { endlessSpeedFactor } from "./sim/endless";
import { Engine } from "./sim/loop";
import { MECHANIC_ORDER, type MechanicId } from "./sim/mechanicsText";
import {
  applyMetaSkillsToTower,
  effectiveTowerCost,
  type BranchId as MetaBranchId,
  resetAllRanks,
  resetKindRanks,
  setTier as setMetaSkillTier,
  spentMetaStars,
} from "./sim/metaSkills";
import { segmentLength } from "./sim/path";
import {
  cancelRobotDashAim as simCancelRobotDashAim,
  orderRobotMove as simOrderRobotMove,
  selectRobot as simSelectRobot,
  setRobotDashAimDir as simSetRobotDashAimDir,
  triggerRobotAbility as simTriggerRobotAbility,
} from "./sim/robot";
import { robotSkillBoltDelta } from "./sim/robotBolts";
import {
  applyRobotSkillsToRobot,
  getRobotRank,
  levelForXp,
  type RobotSkillId,
  resetAllRobotRanks,
  resetRobotVariantRanks,
  robotSkillPointsAvailable,
  setRobotRank,
  spentRobotSkillBolts,
  xpProgressInLevel,
} from "./sim/robotSkills";
import { ROBOT_SPECS, ROBOT_VARIANTS } from "./sim/robotVariants";
import {
  canCallEarly,
  earlyCallGoldReward,
  earlyCallTimerSec,
  callWaveEarly as simCallWaveEarly,
  startWave,
} from "./sim/spawner";
import { autoAssignDroneToNewTower, countDronesOnTower } from "./sim/towers";
import type {
  BossVariant,
  DamageType,
  EnemyKind,
  GameEvent,
  NewSightingId,
  RobotAbilitySlot,
  RobotVariant,
  Rock,
  RunStatus,
  TargetingMode,
  Tower,
  TowerKind,
  Tree,
  Vec2,
  World,
} from "./sim/types";
import { applyBaseUpgrade, applyUpgrade, sellTower } from "./sim/upgrades";
import { distSq, distToSegmentSq } from "./sim/vec2";
import {
  createTower,
  createWorld,
  emit,
  HIVE_MAX_DRONES_PER_TOWER,
  isTowerKindAllowed,
  meshXZRadii,
  ROCK_FOOTPRINT,
  ROCK_REMOVE_COST,
  robotLevelHpBonus,
  spawnEnemy,
  spawnMovingEasterEgg,
  spawnParticles,
  TOWER_FOOTPRINT,
  TREE_FOOTPRINT,
  TREE_REMOVE_COST,
  towerKindAtBuildLimit,
} from "./sim/world";

export type Screen = "splash" | "slots" | "worldMap" | "playing" | "results";

export type CompendiumSection = "enemy" | "tower" | "mechanic" | "robot" | "lore";

export type AchievementToast = { id: AchievementId; key: number };

export type LastResult = {
  levelId: number;
  levelName: string;
  won: boolean;
  livesRemaining: number;
  startingLives: number;
  mode: LevelMode;
  // Number of stars awarded *this run* for the mode. Normal is 0-3,
  // breach/containment are 0 or 1.
  stars: number;
  // Best run for the same mode (max of prior and current).
  bestStars: number;
  improved: boolean;
  unlockedAchievements: AchievementId[];
  // Set only for endless runs. Drives the endless results variant (wave
  // reached + new-best indicator instead of stars). Absent on campaign.
  endless?: {
    mapId: string;
    mapName: string;
    waveReached: number;
    bestWave: number;
    newBest: boolean;
    enemiesKilled: number;
  };
};

type UiSnapshot = {
  gold: number;
  lives: number;
  wave: number;
  totalWaves: number;
  // Endless-run readouts. `endless` is false on every campaign run, in
  // which case the HUD keeps the "wave / totalWaves" display. When true,
  // the HUD shows the climbing wave + best for this arena.
  endless: boolean;
  endlessBestWave: number;
  endlessMapName: string;
  endlessMapId: string;
  status: RunStatus;
  waveActive: boolean;
  nextWaveIn: number;
  canCallEarly: boolean;
  callEarlyBonus: number;
  callEarlyTimer: number;
  selectedTowerId: number | null;
  selectedBase: boolean;
  towerVersion: number;
  treeVersion: number;
  inspectedEnemyId: number | null;
  inspectedEnemyKind: EnemyKind | null;
  // Matriarch variant when the inspected enemy is a biome-themed queen.
  // Null for any non-boss kind. Drives the variant label / stats /
  // resists / 20-life damage warning in the EnemyPanel.
  inspectedBossVariant: BossVariant | null;
  inspectedEnemyHp: number | null;
  inspectedEnemyMaxHp: number | null;
  inspectedEnemyAlive: boolean;
  inspectedEnemyShield: number | null;
  inspectedEnemyMaxShield: number;
  inspectedEnemyHealAura: boolean;
  inspectedEnemyRegen: boolean;
  // Resists chip — per-damage-type adaptation multipliers. Empty when
  // the inspected enemy has no resist chip applied.
  inspectedEnemyExtraResists: Partial<Record<DamageType, number>>;
  // Adaptive-resistance snapshot type — set at spawn for enemies the
  // herd adapted this wave. Drives the badge color in EnemyPanel so
  // the badge matches the dino's body tint instead of a fixed amber.
  inspectedEnemyAdaptiveType: DamageType | null;
  robotVariant: RobotVariant;
  robotLabel: string;
  robotSelected: boolean;
  robotDashAiming: boolean;
  robotHp: number;
  robotMaxHp: number;
  robotAlive: boolean;
  robotRespawnRemaining: number;
  robotLevel: number;
  robotXp: number;
  robotXpInto: number;
  robotXpNeed: number;
  // Cooldowns per ability slot (Q/W/E/R = 0..3). Rounded to 0.1s so the
  // HUD doesn't thrash on every frame for the same on-screen text.
  robotAbilityCooldowns: [number, number, number, number];
  robotAbilityActiveRemaining: [number, number, number, number];
  robotAbilityMaxCooldowns: [number, number, number, number];
  robotAbilityLabels: [string, string, string, string];
  robotAbilityGlyphs: [string, string, string, string];
  // Run-scoped combat stats — mirror Tower kill/damage tracking. DPS is
  // theoretical (base damage × base fireRate) so the readout doesn't
  // thrash when slot-2 buffs flicker on/off.
  robotKills: number;
  robotDps: number;
  robotDamageDealt: number;
};

const snapshot = (
  w: World,
  towerVersion: number,
  treeVersion: number,
  inspect: {
    id: number | null;
    kind: EnemyKind | null;
    maxHp: number | null;
    bossVariant: BossVariant | null;
  },
): UiSnapshot => {
  let hp: number | null = null;
  let alive = false;
  let shield: number | null = null;
  let maxShield = 0;
  let healAura = false;
  let regen = false;
  let extraResists: Partial<Record<DamageType, number>> = {};
  let adaptiveType: DamageType | null = null;
  if (inspect.id !== null) {
    const e = w.enemyById.get(inspect.id);
    if (e?.alive) {
      hp = e.hp;
      alive = true;
      shield = e.shield;
      maxShield = e.maxShield;
      healAura = e.healAura;
      regen = e.regen;
      extraResists = e.extraResists;
      adaptiveType = e.adaptiveResistType ?? null;
    }
  }
  const abilityActiveRemaining: [number, number, number, number] = [
    Math.max(0, Math.round((w.robot.abilityActiveUntil[0] - w.time) * 10) / 10),
    Math.max(0, Math.round((w.robot.abilityActiveUntil[1] - w.time) * 10) / 10),
    Math.max(0, Math.round((w.robot.abilityActiveUntil[2] - w.time) * 10) / 10),
    Math.max(0, Math.round((w.robot.abilityActiveUntil[3] - w.time) * 10) / 10),
  ];
  if (w.robot.selfBuff && w.robot.selfBuff.endAt > w.time) {
    abilityActiveRemaining[2] = Math.max(
      0,
      Math.round((w.robot.selfBuff.endAt - w.time) * 10) / 10,
    );
  }
  if (w.robot.payload && w.robot.payload.endAt > w.time) {
    abilityActiveRemaining[3] = Math.max(0, Math.round((w.robot.payload.endAt - w.time) * 10) / 10);
  }
  return {
    gold: w.gold,
    lives: w.lives,
    wave: w.wave,
    totalWaves: w.totalWaves,
    endless: w.endless !== null,
    endlessBestWave: w.endless?.bestWave ?? 0,
    endlessMapName: w.endless?.mapName ?? "",
    endlessMapId: w.endless?.mapId ?? "",
    status: w.status,
    waveActive: w.waveActive,
    nextWaveIn: Math.ceil(w.nextWaveIn),
    canCallEarly: canCallEarly(w),
    callEarlyBonus: earlyCallGoldReward(w),
    callEarlyTimer: Math.ceil(earlyCallTimerSec(w)),
    selectedTowerId: w.selectedTowerId,
    selectedBase: w.selectedBase,
    towerVersion,
    treeVersion,
    inspectedEnemyId: inspect.id,
    inspectedEnemyKind: inspect.kind,
    inspectedBossVariant: inspect.bossVariant,
    inspectedEnemyHp: hp,
    inspectedEnemyMaxHp: inspect.maxHp,
    inspectedEnemyAlive: alive,
    inspectedEnemyShield: shield,
    inspectedEnemyMaxShield: maxShield,
    inspectedEnemyHealAura: healAura,
    inspectedEnemyRegen: regen,
    inspectedEnemyExtraResists: extraResists,
    inspectedEnemyAdaptiveType: adaptiveType,
    robotVariant: w.robot.variant,
    robotLabel: ROBOT_SPECS[w.robot.variant].label,
    robotSelected: w.robot.selected,
    robotDashAiming: w.robot.dashAim !== null,
    robotHp: Math.max(0, Math.round(w.robot.hp)),
    robotMaxHp: w.robot.maxHp,
    robotAlive: w.robot.alive,
    robotRespawnRemaining:
      w.robot.respawnAt !== null ? Math.max(0, Math.ceil(w.robot.respawnAt - w.time)) : 0,
    robotLevel: levelForXp(w.robot.xp),
    robotXp: w.robot.xp,
    robotXpInto: xpProgressInLevel(w.robot.xp).into,
    robotXpNeed: xpProgressInLevel(w.robot.xp).need,
    robotAbilityCooldowns: [
      Math.max(0, Math.round((w.robot.abilityReadyAt[0] - w.time) * 10) / 10),
      Math.max(0, Math.round((w.robot.abilityReadyAt[1] - w.time) * 10) / 10),
      Math.max(0, Math.round((w.robot.abilityReadyAt[2] - w.time) * 10) / 10),
      Math.max(0, Math.round((w.robot.abilityReadyAt[3] - w.time) * 10) / 10),
    ],
    robotAbilityActiveRemaining: abilityActiveRemaining,
    robotAbilityMaxCooldowns: [
      ROBOT_SPECS[w.robot.variant].abilities[0].cooldown * w.robot.abilityCooldownMul,
      ROBOT_SPECS[w.robot.variant].abilities[1].cooldown * w.robot.abilityCooldownMul,
      ROBOT_SPECS[w.robot.variant].abilities[2].cooldown * w.robot.abilityCooldownMul,
      ROBOT_SPECS[w.robot.variant].abilities[3].cooldown * w.robot.abilityCooldownMul,
    ],
    robotAbilityLabels: ROBOT_SPECS[w.robot.variant].abilityLabels,
    robotAbilityGlyphs: ROBOT_SPECS[w.robot.variant].abilityGlyphs,
    robotKills: w.robot.kills,
    robotDps: w.robot.damage * w.robot.fireRate,
    robotDamageDealt: w.robot.damageDealt,
  };
};

const uiEqual = (a: UiSnapshot, b: UiSnapshot) =>
  a.gold === b.gold &&
  a.lives === b.lives &&
  a.wave === b.wave &&
  a.totalWaves === b.totalWaves &&
  a.endless === b.endless &&
  a.endlessBestWave === b.endlessBestWave &&
  a.endlessMapName === b.endlessMapName &&
  a.endlessMapId === b.endlessMapId &&
  a.status === b.status &&
  a.waveActive === b.waveActive &&
  a.nextWaveIn === b.nextWaveIn &&
  a.canCallEarly === b.canCallEarly &&
  a.callEarlyBonus === b.callEarlyBonus &&
  a.callEarlyTimer === b.callEarlyTimer &&
  a.selectedTowerId === b.selectedTowerId &&
  a.selectedBase === b.selectedBase &&
  a.towerVersion === b.towerVersion &&
  a.treeVersion === b.treeVersion &&
  a.inspectedEnemyId === b.inspectedEnemyId &&
  a.inspectedEnemyKind === b.inspectedEnemyKind &&
  a.inspectedBossVariant === b.inspectedBossVariant &&
  a.inspectedEnemyHp === b.inspectedEnemyHp &&
  a.inspectedEnemyMaxHp === b.inspectedEnemyMaxHp &&
  a.inspectedEnemyAlive === b.inspectedEnemyAlive &&
  a.inspectedEnemyShield === b.inspectedEnemyShield &&
  a.inspectedEnemyMaxShield === b.inspectedEnemyMaxShield &&
  a.inspectedEnemyHealAura === b.inspectedEnemyHealAura &&
  a.inspectedEnemyRegen === b.inspectedEnemyRegen &&
  a.inspectedEnemyAdaptiveType === b.inspectedEnemyAdaptiveType &&
  a.robotVariant === b.robotVariant &&
  a.robotSelected === b.robotSelected &&
  a.robotDashAiming === b.robotDashAiming &&
  a.robotHp === b.robotHp &&
  a.robotMaxHp === b.robotMaxHp &&
  a.robotAlive === b.robotAlive &&
  a.robotRespawnRemaining === b.robotRespawnRemaining &&
  a.robotLevel === b.robotLevel &&
  a.robotXp === b.robotXp &&
  a.robotAbilityCooldowns[0] === b.robotAbilityCooldowns[0] &&
  a.robotAbilityCooldowns[1] === b.robotAbilityCooldowns[1] &&
  a.robotAbilityCooldowns[2] === b.robotAbilityCooldowns[2] &&
  a.robotAbilityCooldowns[3] === b.robotAbilityCooldowns[3] &&
  a.robotAbilityActiveRemaining[0] === b.robotAbilityActiveRemaining[0] &&
  a.robotAbilityActiveRemaining[1] === b.robotAbilityActiveRemaining[1] &&
  a.robotAbilityActiveRemaining[2] === b.robotAbilityActiveRemaining[2] &&
  a.robotAbilityActiveRemaining[3] === b.robotAbilityActiveRemaining[3] &&
  a.robotKills === b.robotKills &&
  a.robotDps === b.robotDps &&
  a.robotDamageDealt === b.robotDamageDealt;

const isOnPath = (world: World, pos: Vec2, clearance: number): boolean => {
  const r2 = clearance * clearance;
  for (const path of world.paths) {
    for (let i = 0; i < path.length - 1; i++) {
      if (segmentLength(path, i) === 0) continue;
      if (distToSegmentSq(pos, path[i], path[i + 1]) < r2) return true;
    }
  }
  return false;
};

const canPlaceAt = (world: World, pos: Vec2): boolean => {
  if (isOnPath(world, pos, PATH_WIDTH / 2 + 0.4)) return false;
  if (isOnFlowSurface(world.flowFeatures, pos.x, pos.y, TOWER_FOOTPRINT * 0.5)) return false;
  const footprintSq = (TOWER_FOOTPRINT + 0.1) * (TOWER_FOOTPRINT + 0.1);
  for (const t of world.towers) {
    if (distSq(t.pos, pos) < footprintSq) return false;
  }
  const treeUrls = BIOME_TREE_URLS[world.biome];
  for (const tr of world.trees) {
    const base = meshXZRadii.get(treeUrls[tr.variant]) ?? TREE_FOOTPRINT;
    const blockR = base * tr.scale + TOWER_FOOTPRINT * 0.5;
    if (distSq(tr.pos, pos) < blockR * blockR) return false;
  }
  const layers = BIOME_LAYERS[world.biome];
  for (const r of world.rocks) {
    const url = layers[r.layerIndex]?.urls[r.variant];
    const base = url ? (meshXZRadii.get(url) ?? ROCK_FOOTPRINT) : ROCK_FOOTPRINT;
    const blockR = base * r.scale + TOWER_FOOTPRINT * 0.5;
    if (distSq(r.pos, pos) < blockR * blockR) return false;
  }
  // Modular colonies are solid — no building on a base (band colonies can
  // poke a little into the playfield edge, so block on all of them).
  for (const o of world.outposts) {
    if (distSq(o.pos, pos) < o.radius * o.radius) return false;
  }
  // Hand-placed editor props flagged `blocks` occupy build slots too. The
  // footprint is approximated from the prop's role target size × its scale
  // (props render normalized to TARGET_SIZE_BY_ROLE). Empty in production.
  for (const p of world.props) {
    if (!p.blocks) continue;
    const propR = TARGET_SIZE_BY_ROLE[classifyPropUrl(p.url)] * p.scale * 0.5;
    const blockR = propR + TOWER_FOOTPRINT * 0.5;
    if (distSq(p.pos, pos) < blockR * blockR) return false;
  }
  return true;
};

const towerAt = (world: World, pos: Vec2, radius = 0.9): Tower | null => {
  const r2 = radius * radius;
  for (const t of world.towers) {
    if (distSq(t.pos, pos) <= r2) return t;
  }
  return null;
};

// Click radius for the HQ. Roughly matches the visible turret + pad
// footprint so a tap on or near the structure registers. Tighter than
// the pad's full extent so clicks at the far edge of the deco area
// still go to whatever empty ground is underneath (tower spot, etc).
const BASE_CLICK_RADIUS = 1.8;

const hqAt = (world: World, pos: Vec2): boolean => {
  const r2 = BASE_CLICK_RADIUS * BASE_CLICK_RADIUS;
  for (const path of world.paths) {
    if (path.length === 0) continue;
    const end = path[path.length - 1];
    if (distSq(end, pos) <= r2) return true;
  }
  return false;
};

const treeById = (world: World, id: number): Tree | null =>
  world.trees.find((t) => t.id === id) ?? null;

const rockById = (world: World, id: number): Rock | null =>
  world.rocks.find((r) => r.id === id) ?? null;

type InspectState = {
  id: number | null;
  kind: EnemyKind | null;
  maxHp: number | null;
  bossVariant: BossVariant | null;
};

type GameStore = {
  world: World;
  engine: Engine;
  ui: UiSnapshot;
  selectedKind: TowerKind | null;
  selectedTreeId: number | null;
  selectedRockId: number | null;
  // Mobile-only: when the player drags a finger to position the
  // ghost tower, lifting does NOT place — it parks the cursor here
  // and surfaces a Confirm button. A quick tap still places inline.
  // Cleared on confirm, on a tap-place, on tower-kind change, and
  // on every clearSelection.
  pendingTouchPlacement: Vec2 | null;
  // Hive drone-assignment cursor: when set, the next tower click goes
  // to the drone slot identified here instead of selecting that tower.
  // Cleared by completing the assignment, clicking the same hive,
  // canceling, or selling/deselecting the hive.
  assigningDroneSlot: { hiveId: number; droneIdx: number } | null;
  // True while the player is actively picking a ground spot for the
  // selected mortar — armed only by clicking the "Spot" targeting
  // button. The next in-range map click sets the aim point and disarms.
  // Selecting the mortar (e.g. clicking it to open its panel) must NOT
  // arm this, otherwise an innocent click re-aims the mortar.
  spotSelecting: boolean;
  towerVersion: number;
  treeVersion: number;
  inspectedEnemy: InspectState;
  eventListeners: ((e: GameEvent) => void)[];

  // Bumped whenever the WebGL context is lost or restored. The Canvas
  // keys SceneRoot on this counter so a context drop tears down every
  // R3F-owned object and rebuilds it from scratch on restore, instead
  // of leaving the page black with stale GL handles.
  glContextEpoch: number;

  screen: Screen;
  // null until the user picks a save slot from the SaveSlots screen.
  // All progress writes route through this — saveSlot is a no-op when
  // no slot is active (e.g. during splash / slot picker).
  activeSlot: SlotId | null;
  selectedLevelId: number | null;
  progress: ProgressData;
  hoveredLevelId: number | null;
  lastResult: LastResult | null;
  compendiumOpen: boolean;
  // When set, the Compendium opens directly to this section on mount.
  // Consumed (cleared) once the Compendium reads it. Defaulting routes
  // (Compendium button on the world map) leave this null and the panel
  // opens to "enemy" as it always has.
  compendiumInitialSection: CompendiumSection | null;
  achievementsOpen: boolean;
  creditsOpen: boolean;
  skillTreeOpen: boolean;
  achievementToasts: AchievementToast[];
  newEnemyQueue: NewSightingId[];
  deferredNewEnemyQueue: NewSightingId[];
  autoPausedForNewEnemy: boolean;
  levelIntroVisible: boolean;
  // Tracks whether the heavy level-scene shaders (towers + dinos) have
  // been compiled into the WebGL context. Set true by either the
  // worldmap idle prewarm or the PlayScene ShaderPrewarm. Drives the
  // LevelLoadOverlay — when true at level start the overlay is skipped.
  assetsPrewarmed: boolean;
  markAssetsPrewarmed: () => void;
  // True between a cold (not-yet-prewarmed) level click and the play scene
  // mounting. Lets the LevelLoadOverlay paint over the world map *before* the
  // heavy buildWorldForLevel + PlayScene mount runs, so the map doesn't sit
  // frozen on screen during the load. Cleared once the level scene is entered.
  levelLoadPending: boolean;
  // GLB / texture download progress reported by THREE.DefaultLoadingManager
  // while the LevelLoadOverlay is on screen. null when nothing is in-flight.
  levelLoadProgress: { loaded: number; total: number } | null;
  setLevelLoadProgress: (p: { loaded: number; total: number } | null) => void;
  treeClickCounts: Record<number, number>;
  rockClickCounts: Record<number, number>;

  // Entry-flow actions: splash → slot picker → world map.
  dismissSplash: () => void;
  goToSlots: () => void;
  selectSlot: (id: SlotId) => void;
  deleteSlot: (id: SlotId) => void;

  // Default mode is "normal" — breach/containment are passed in by the mode
  // picker. The store keeps no separate selectedMode; the active mode
  // lives on World.mode and on lastResult.mode so cross-screen reads
  // (HUD chip, results screen, etc.) stay in sync.
  startLevel: (id: number, mode?: LevelMode) => void;
  // Level pending the mode-picker overlay. null while the picker is
  // closed; set to a level id when the world map opens the picker so
  // the picker UI knows which level to show modes for.
  modePickerLevelId: number | null;
  openModePicker: (id: number) => void;
  closeModePicker: () => void;
  retryCurrentLevel: () => void;
  goToWorldMap: () => void;
  setHoveredLevel: (id: number | null) => void;
  setCompendiumOpen: (open: boolean, initialSection?: CompendiumSection) => void;
  clearCompendiumInitialSection: () => void;
  setAchievementsOpen: (open: boolean) => void;
  setCreditsOpen: (open: boolean) => void;
  // One-shot "you unlocked Breach + Containment modes" world-map dialog.
  // Visibility is derived in WorldMapUI (any normal-3-star clear AND
  // !progress.seenModesUnlockExplainer); this setter persists the
  // dismissed flag so the dialog never reappears on this slot.
  dismissModesUnlockedExplainer: () => void;
  // Endless mode. The picker overlay lists the dedicated arenas; starting
  // one builds an endless World (no campaign mode/star machinery). Gated
  // behind hasUnlockedEndless in the world-map UI.
  endlessPickerOpen: boolean;
  setEndlessPickerOpen: (open: boolean) => void;
  startEndless: (mapId: string) => void;
  // One-shot "Endless unlocked" world-map reveal dismissal — persists the
  // seen flag so the dialog never reappears on this slot.
  dismissEndlessUnlockExplainer: () => void;
  setSkillTreeOpen: (open: boolean) => void;
  setMetaSkillTier: (kind: TowerKind, branch: MetaBranchId, tier: number) => void;
  resetMetaSkillsForKind: (kind: TowerKind) => void;
  resetAllMetaSkills: () => void;
  setDifficulty: (difficulty: Difficulty) => void;
  difficultyPickerOpen: boolean;
  autoPausedForDifficultyPicker: boolean;
  setDifficultyPickerOpen: (open: boolean) => void;
  // Lowest difficulty seen during the current run. Set on level start to
  // the active progress.difficulty, then ratcheted down by setDifficulty
  // mid-level. Achievement credit for the run reflects this — not the
  // difficulty the player happens to be on at game-over.
  runMinDifficulty: Difficulty | null;
  dismissAchievementToast: (key: number) => void;

  reset: () => void;
  togglePause: () => void;
  tick: (realTimeSec: number) => void;

  setSelectedKind: (kind: TowerKind | null) => void;
  tryPlaceOrSelect: (pos: Vec2, options?: { clearSelectionAfterPlacement?: boolean }) => void;
  canPlace: (pos: Vec2) => boolean;
  towerAtPos: (pos: Vec2) => Tower | null;
  hqAtPos: (pos: Vec2) => boolean;
  clearSelection: () => void;

  orderRobotMove: (pos: Vec2) => boolean;
  triggerRobotAbility: (slot: RobotAbilitySlot) => void;
  selectRobotUnit: (on: boolean) => void;
  setRobotDashAimDir: (dir: Vec2) => void;
  cancelRobotDashAim: () => void;
  // Robot shop modal.
  robotShopOpen: boolean;
  setRobotShopOpen: (open: boolean) => void;
  // Robot overview overlay (stats / abilities / vitals). Decoupled from
  // `robot.selected` so the player can keep commanding the robot (move/
  // target) without the info panel covering the canvas.
  robotPanelOpen: boolean;
  setRobotPanelOpen: (open: boolean) => void;
  // Persistent robot progression actions. Reads/writes ProgressData
  // (robotUnlocks / activeRobot / robotSkills). XP is mutated via the sim
  // tick → progress sync inside `tick`.
  unlockRobot: (variant: RobotVariant) => void;
  setActiveRobot: (variant: RobotVariant) => void;
  setRobotSkillRank: (variant: RobotVariant, id: RobotSkillId, rank: number) => void;
  resetRobotSkills: (variant: RobotVariant) => void;
  resetAllRobotSkills: () => void;
  setPendingTouchPlacement: (pos: Vec2 | null) => void;
  confirmTouchPlacement: () => void;

  selectTower: (id: number | null) => void;
  upgradeSelected: (branch: "a" | "b") => void;
  sellSelected: () => void;
  setTargetingMode: (mode: TargetingMode) => void;
  selectBase: (on: boolean) => void;
  upgradeBase: (branch: "a" | "b") => void;
  callWaveEarly: () => void;

  // Hive drone assignment flow:
  //  - beginDroneAssignment: arms the cursor for the given drone slot
  //  - assignDroneToTower:   completes assignment to a specific tower
  //  - clearDroneAssignment: unassigns the slot back to idle
  //  - cancelDroneAssignment: drops the cursor without changes
  beginDroneAssignment: (hiveId: number, droneIdx: number) => void;
  assignDroneToTower: (towerId: number) => void;
  clearDroneAssignment: (hiveId: number, droneIdx: number) => void;
  cancelDroneAssignment: () => void;

  selectTree: (id: number) => void;
  clearSelectedTree: () => void;
  confirmRemoveTree: () => void;

  selectRock: (id: number) => void;
  clearSelectedRock: () => void;
  confirmRemoveRock: () => void;

  clickEasterEgg: (id: number, hitPos?: Vec2) => void;

  inspectEnemy: (
    id: number,
    kind: EnemyKind,
    maxHp: number,
    bossVariant: BossVariant | null,
  ) => void;
  clearInspectedEnemy: () => void;

  dismissNewEnemy: () => void;
  dismissLevelIntro: () => void;

  onEvent: (fn: (e: GameEvent) => void) => () => void;

  // ── Debug actions (only invoked from the debug menu, gated by
  //    isDebug from src/debug.ts). Live on the store rather than as
  //    free functions so they share the same set/snapshot machinery
  //    as the regular UI actions and trigger the same UI updates. ──
  freeTowers: boolean;
  invincible: boolean;
  pathDebug: boolean;
  // Compendium lock overrides. Undefined falls through to normal
  // progression; true forces locked and false forces unlocked. This lets
  // debug inspect every dossier/lore state without changing robot
  // purchases or level stars.
  compendiumLocks: {
    enemies: Partial<Record<EnemyKind, boolean>>;
    matriarchs: Partial<Record<BossVariant, boolean>>;
    towers: Partial<Record<TowerKind, boolean>>;
    mechanics: Partial<Record<MechanicId, boolean>>;
    robots: Partial<Record<RobotVariant, boolean>>;
    lore: Partial<Record<number, boolean>>;
  };
  debugAddGold: (n: number) => void;
  debugSkipWave: () => void;
  debugWinLevel: () => void;
  debugSetFreeTowers: (on: boolean) => void;
  debugSetInvincible: (on: boolean) => void;
  debugSetPathDebug: (on: boolean) => void;
  debugTriggerEasterEgg: (defId: string) => void;
  debugForceUnlockEasterEggAchievement: (defId: string) => void;
  debugSpawnEnemy: (kind: EnemyKind) => void;
  debugForceWave: (n: number) => void;
  debugSetEnemyEncountered: (kind: EnemyKind, encountered: boolean) => void;
  debugSetEnemyDossierLocked: (kind: EnemyKind, locked: boolean) => void;
  debugSetMatriarchDossierLocked: (variant: BossVariant, locked: boolean) => void;
  debugSetTowerLocked: (kind: TowerKind, locked: boolean) => void;
  debugSetMechanicLocked: (id: MechanicId, locked: boolean) => void;
  debugSetAllDossiersLocked: (locked: boolean) => void;
  debugSetAchievementUnlocked: (id: AchievementId, unlocked: boolean) => void;
  debugSetLevelStars: (levelId: number, stars: Stars) => void;
  debugLoadSuggestedBuild: (trace: PlannerTrace) => void;
  debugUnlockThroughLevel: (levelId: number) => void;
  debugLockFromLevel: (levelId: number) => void;
  debugResetProgress: () => void;
};

const emptyInspect: InspectState = { id: null, kind: null, maxHp: null, bossVariant: null };

let nextToastKey = 1;

const EASTER_EGG_CLICK_THRESHOLD = 10;

const DEBUG_ENEMY_DOSSIER_KINDS: EnemyKind[] = [
  "raptor",
  "swarm",
  "para",
  "allosaur",
  "stego",
  "armored",
  "titan",
];
const DEBUG_MATRIARCH_DOSSIER_VARIANTS: BossVariant[] = [
  "raptor",
  "stego",
  "para",
  "allosaur",
  "armored",
  "apex",
];
const DEBUG_TOWER_DOSSIER_KINDS: TowerKind[] = [
  "pulse",
  "chain",
  "cryo",
  "mortar",
  "flame",
  "hive",
];

// Seconds a static gold-reward egg lingers after being triggered so the
// renderer can shrink it out instead of popping off the same frame the
// click lands. The renderer reads `egg.triggered + despawnAt - world.time`
// to drive the fade and the world tick despawns once the timer elapses.
export const EASTER_EGG_DESPAWN_FADE = 0.6;

const tryUnlockEasterEgg = (
  progress: ProgressData,
  id: AchievementId,
): { id: AchievementId; progress: ProgressData } | null => {
  if (progress.unlocked[id] !== undefined) return null;
  return {
    id,
    progress: { ...progress, unlocked: { ...progress.unlocked, [id]: Date.now() } },
  };
};

// Re-run achievement checks after a between-run meta change (robot
// unlock, robot skill rank, lab tower tier). These milestones read only
// ProgressData, so the tick's per-event loop would otherwise not notice
// them until the next mission started — check here so the toast fires the
// instant the player crosses the threshold in the panel. Mirrors the
// assignDroneSlot path. World/event args are unused by these checks, so
// the current world + a null event are fine to pass.
const checkMetaAchievements = (
  progress: ProgressData,
  world: World,
  toasts: AchievementToast[],
): { progress: ProgressData; achievementToasts: AchievementToast[] } => {
  const res = checkAchievements(progress, world, null);
  if (res.unlocked.length === 0) return { progress, achievementToasts: toasts };
  for (const id of res.unlocked) track("achievement_unlocked", { achievement_id: id });
  const newToasts = res.unlocked.map((id) => ({ id, key: nextToastKey++ }));
  return { progress: res.progress, achievementToasts: [...toasts, ...newToasts] };
};

const buildWorldForLevel = (
  level: LevelConfig,
  mode: LevelMode,
  difficulty: Difficulty,
  progress: ProgressData,
) => {
  const triggeredEggs = triggeredEasterEggIdsForLevel(progress, level.id);
  const world = createWorld(level, mode, DIFFICULTY_MULTIPLIERS[difficulty], triggeredEggs, {
    variant: progress.activeRobot,
    xp: progress.robotXp[progress.activeRobot] ?? 0,
    skills: progress.robotSkills,
  });
  return {
    world,
    ui: snapshot(world, 0, 0, emptyInspect),
    towerVersion: 0,
    treeVersion: 0,
    inspectedEnemy: emptyInspect,
  };
};

const applyRobotVariantToWorld = (
  world: World,
  variant: RobotVariant,
  progress: ProgressData,
): void => {
  const spec = ROBOT_SPECS[variant];
  const xp = progress.robotXp[variant] ?? 0;
  const level = levelForXp(xp);
  const bonusHp = robotLevelHpBonus(level);
  world.robot.variant = variant;
  world.robot.maxHp = spec.maxHp + bonusHp;
  world.robot.hp = world.robot.maxHp;
  world.robot.damage = spec.damage;
  world.robot.range = spec.range;
  world.robot.fireRate = spec.fireRate;
  world.robot.speed = spec.speed;
  world.robot.attackSplashRadius = spec.attackSplashRadius;
  world.robot.damageType = spec.damageType;
  world.robot.abilityCooldownMul = 1;
  world.robot.payload = null;
  world.robot.selfBuff = null;
  world.robot.pendingShots.length = 0;
  world.robot.abilityReadyAt = [0, 0, 0, 0];
  world.robot.abilityActiveUntil = [0, 0, 0, 0];
  world.robot.attackCooldown = 0;
  world.robot.damageMul = 1;
  world.robot.fireRateMul = 1;
  world.robot.speedMul = 1;
  world.robot.damageResist = 0;
  world.robot.xp = xp;
  world.robot.level = level;
  applyRobotSkillsToRobot(world.robot, progress.robotSkills);
  world.robot.hp = world.robot.maxHp;
};

// All progress saves route through this — when no slot is active (splash
// + slot picker), progress writes are silently dropped so we never
// clobber another slot's data. Once a slot is active, every progress
// change also bumps that slot's lastPlayed timestamp.
const persistProgress = (slot: SlotId | null, progress: ProgressData): void => {
  if (slot === null) return;
  saveSlot(slot, progress);
};

const sightingKey = (sighting: NewSightingId): string =>
  sighting.tag === "species" ? `species:${sighting.species}` : `matriarch:${sighting.variant}`;

const appendUniqueSightings = (
  queue: NewSightingId[],
  sightings: NewSightingId[],
): { queue: NewSightingId[]; added: boolean } => {
  if (sightings.length === 0) return { queue, added: false };
  const seen = new Set(queue.map(sightingKey));
  const additions = sightings.filter((sighting) => {
    const key = sightingKey(sighting);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return additions.length > 0
    ? { queue: [...queue, ...additions], added: true }
    : { queue, added: false };
};

const bossOrTitanMomentActive = (world: World): boolean => {
  for (const e of world.enemies) {
    if (e.alive && (e.kind === "boss" || e.kind === "titan")) return true;
  }
  for (const q of world.spawnQueue) {
    if (q.kind === "boss" || q.kind === "titan") return true;
  }
  return world.waveActive && world.plannedWaves[world.wave - 1]?.bossWave === true;
};

export const isUnlocked = (levelId: number, progress: ProgressData) =>
  isLevelUnlocked(levelId, progress);

export const useGame = create<GameStore>((set, get) => ({
  ...buildWorldForLevel(getLevel(1), "normal", DEFAULT_DIFFICULTY, emptyProgress()),
  engine: new Engine(),
  selectedKind: null,
  selectedTreeId: null,
  selectedRockId: null,
  pendingTouchPlacement: null,
  assigningDroneSlot: null,
  spotSelecting: false,
  eventListeners: [],
  glContextEpoch: 0,

  screen: "splash",
  activeSlot: null,
  selectedLevelId: null,
  modePickerLevelId: null,
  endlessPickerOpen: false,
  progress: emptyProgress(),
  hoveredLevelId: null,
  lastResult: null,
  compendiumOpen: false,
  compendiumInitialSection: null,
  achievementsOpen: false,
  creditsOpen: false,
  skillTreeOpen: false,
  achievementToasts: [],
  newEnemyQueue: [],
  deferredNewEnemyQueue: [],
  autoPausedForNewEnemy: false,
  levelIntroVisible: false,
  assetsPrewarmed: false,
  levelLoadPending: false,
  levelLoadProgress: null,
  treeClickCounts: {},
  rockClickCounts: {},

  startLevel: (id, modeArg) => {
    const level = LEVELS.find((l) => l.id === id);
    if (!level) return;
    const s = get();
    if (!isLevelUnlocked(id, s.progress)) return;

    // Builds the world and swaps to the play scene. Reads state at call time
    // (not at click time) since the cold path runs this a couple frames later.
    const enter = () => {
      const cur = get();
      const { engine, progress } = cur;
      // Resolve the requested mode. Caller defaults to "normal"; breach /
      // containment must both be unlocked AND defined on the level (the picker
      // already enforces this, but reject defensively in case startLevel
      // is invoked from elsewhere — e.g. retry after the level was patched).
      let mode: LevelMode = modeArg ?? "normal";
      if (mode !== "normal") {
        if (!levelHasMode(level, mode) || !isModeUnlocked(progress, id, mode)) mode = "normal";
      }
      engine.reset();
      const built = buildWorldForLevel(level, mode, progress.difficulty, progress);
      // Carry the debug invincibility flag across level starts/retries so a
      // toggled-on tester doesn't have to flip it again every restart.
      built.world.invincible = cur.invincible;
      const showIntro = hasLevelBriefing(id) && !progress.seenIntros?.[id];
      if (showIntro) built.world.status = "paused";
      set({
        ...built,
        selectedKind: null,
        selectedTreeId: null,
        selectedRockId: null,
        selectedLevelId: id,
        modePickerLevelId: null,
        hoveredLevelId: null,
        lastResult: null,
        newEnemyQueue: [],
        deferredNewEnemyQueue: [],
        autoPausedForNewEnemy: false,
        levelIntroVisible: showIntro,
        levelLoadPending: false,
        screen: "playing",
        treeClickCounts: {},
        rockClickCounts: {},
        runMinDifficulty: progress.difficulty,
      });
      track("level_start", { level_id: id });
    };

    // Warm assets mount instantly — enter synchronously so the transition stays
    // snappy (and keeps the click within the user-gesture window for the
    // auto-fullscreen on mobile). Cold start instead paints the load overlay
    // first, then builds two frames later so the heavy mount happens *under* the
    // overlay rather than freezing the world map on screen for ~1s.
    if (s.assetsPrewarmed) {
      enter();
      return;
    }
    if (s.levelLoadPending) return;
    set({ levelLoadPending: true });
    requestAnimationFrame(() => requestAnimationFrame(enter));
  },

  openModePicker: (id) => {
    const s = get();
    if (!isLevelUnlocked(id, s.progress)) return;
    set({ modePickerLevelId: id });
  },
  closeModePicker: () => {
    if (get().modePickerLevelId === null) return;
    set({ modePickerLevelId: null });
  },

  setEndlessPickerOpen: (open) => {
    const s = get();
    if (open && !hasUnlockedEndless(s.progress)) return;
    set({ endlessPickerOpen: open });
  },

  dismissEndlessUnlockExplainer: () => {
    const s = get();
    const progress = markEndlessUnlockExplainerSeen(s.progress);
    if (progress === s.progress) return;
    persistProgress(s.activeSlot, progress);
    set({ progress });
  },

  startEndless: (mapId) => {
    const s = get();
    const { engine, progress } = s;
    if (!hasUnlockedEndless(progress)) return;
    const arena = getEndlessArena(mapId);
    if (!arena) return;
    engine.reset();
    const triggeredEggs = triggeredEasterEggIdsForLevel(progress, arena.id);
    const world = createWorld(
      arena,
      "normal",
      DIFFICULTY_MULTIPLIERS[progress.difficulty],
      triggeredEggs,
      {
        variant: progress.activeRobot,
        xp: progress.robotXp[progress.activeRobot] ?? 0,
        skills: progress.robotSkills,
      },
      {
        // Random seed per run so the wave sequence varies between attempts
        // while staying deterministic within a run (stored on world.endless).
        seed: (Math.random() * 0x1_0000_0000) >>> 0,
        mapId,
        mapName: arena.name,
        bestWave: getEndlessBest(progress, mapId, progress.difficulty),
      },
    );
    // Carry the debug invincibility flag across endless starts/retries,
    // matching startLevel.
    world.invincible = s.invincible;
    set({
      world,
      ui: snapshot(world, 0, 0, emptyInspect),
      towerVersion: 0,
      treeVersion: 0,
      inspectedEnemy: emptyInspect,
      selectedKind: null,
      selectedTreeId: null,
      selectedRockId: null,
      // Endless drives everything off world.endless; selectedLevelId stays
      // null so campaign UI (getLevel(selectedLevelId), ordinals) is skipped.
      selectedLevelId: null,
      modePickerLevelId: null,
      endlessPickerOpen: false,
      hoveredLevelId: null,
      lastResult: null,
      newEnemyQueue: [],
      deferredNewEnemyQueue: [],
      autoPausedForNewEnemy: false,
      levelIntroVisible: false,
      screen: "playing",
      treeClickCounts: {},
      rockClickCounts: {},
      runMinDifficulty: progress.difficulty,
    });
    track("endless_start", { map_id: mapId });
  },

  retryCurrentLevel: () => {
    const s = get();
    if (s.world.endless) {
      s.startEndless(s.world.endless.mapId);
      return;
    }
    const id = s.selectedLevelId ?? 1;
    // Retry preserves the mode the player was in — restarting a Containment
    // attempt should keep the one-life + locked loadout, not silently
    // drop back to normal.
    s.startLevel(id, s.world.mode);
  },

  goToWorldMap: () => {
    const s = get();
    s.engine.reset();
    set({
      screen: "worldMap",
      hoveredLevelId: null,
      lastResult: null,
      newEnemyQueue: [],
      deferredNewEnemyQueue: [],
      autoPausedForNewEnemy: false,
      levelIntroVisible: false,
      levelLoadPending: false,
      runMinDifficulty: null,
      // The next level start rebuilds the world (and resets inspect),
      // but clear here so the EnemyPanel doesn't leak across the world-
      // map screen into the next run if anything reads s.inspectedEnemy
      // before startLevel runs.
      inspectedEnemy: emptyInspect,
      ui: snapshot(s.world, s.towerVersion, s.treeVersion, emptyInspect),
    });
  },

  dismissSplash: () => {
    const s = get();
    if (s.screen !== "splash") return;
    set({ screen: "slots" });
  },

  goToSlots: () => {
    const { engine } = get();
    engine.reset();
    set({
      screen: "slots",
      activeSlot: null,
      progress: emptyProgress(),
      hoveredLevelId: null,
      lastResult: null,
      selectedLevelId: null,
      newEnemyQueue: [],
      deferredNewEnemyQueue: [],
      autoPausedForNewEnemy: false,
      levelIntroVisible: false,
    });
  },

  selectSlot: (id) => {
    const { progress } = loadSlot(id);
    // Materialize the slot on pick — even a fresh slot becomes "filled"
    // so the SaveSlots screen shows its name + zeroed stats next time
    // instead of looking empty when nothing's been played yet.
    saveSlot(id, progress);
    // Rebuild the world-map preview world with this slot's difficulty
    // so the preview matches what the player will actually face.
    set({
      activeSlot: id,
      progress,
      screen: "worldMap",
      hoveredLevelId: null,
      lastResult: null,
      newEnemyQueue: [],
      deferredNewEnemyQueue: [],
      autoPausedForNewEnemy: false,
      ...buildWorldForLevel(getLevel(1), "normal", progress.difficulty, progress),
    });
  },

  deleteSlot: (id) => {
    const s = get();
    deleteSlotStorage(id);
    // If the player just nuked their active slot, drop them back to
    // the picker — there's no save to write to anymore.
    if (s.activeSlot === id) {
      set({ activeSlot: null, progress: emptyProgress() });
    }
  },

  setHoveredLevel: (id) => set({ hoveredLevelId: id }),

  setCompendiumOpen: (open, initialSection) =>
    set({
      compendiumOpen: open,
      compendiumInitialSection: open ? (initialSection ?? null) : null,
    }),

  clearCompendiumInitialSection: () => set({ compendiumInitialSection: null }),

  setAchievementsOpen: (open) => set({ achievementsOpen: open }),

  setCreditsOpen: (open) => set({ creditsOpen: open }),

  dismissModesUnlockedExplainer: () => {
    const s = get();
    const progress = markModesUnlockExplainerSeen(s.progress);
    if (progress === s.progress) return;
    persistProgress(s.activeSlot, progress);
    set({ progress });
  },

  setSkillTreeOpen: (open) => set({ skillTreeOpen: open }),

  // Updates the chosen branch's unlocked-tier index for one tower, clamped
  // by the metaSkills helper. Refuses the update if the player doesn't
  // have enough free stars; treated as a silent no-op so the UI's
  // affordable check stays the single source of truth for disabled state.
  setMetaSkillTier: (kind, branch, tier) => {
    const s = get();
    const earned = totalStars(s.progress);
    const next = setMetaSkillTier(s.progress.metaSkills, kind, branch, tier);
    if (next === s.progress.metaSkills) return;
    if (spentMetaStars(next) > earned) return;
    const progress = { ...s.progress, metaSkills: next };
    const updated = checkMetaAchievements(progress, s.world, s.achievementToasts);
    persistProgress(s.activeSlot, updated.progress);
    set(updated);
  },

  resetMetaSkillsForKind: (kind) => {
    const s = get();
    const next = resetKindRanks(s.progress.metaSkills, kind);
    if (next === s.progress.metaSkills) return;
    const progress = { ...s.progress, metaSkills: next };
    persistProgress(s.activeSlot, progress);
    set({ progress });
  },

  resetAllMetaSkills: () => {
    const s = get();
    if (Object.keys(s.progress.metaSkills).length === 0) return;
    const progress = { ...s.progress, metaSkills: resetAllRanks() };
    persistProgress(s.activeSlot, progress);
    set({ progress });
  },

  difficultyPickerOpen: false,
  autoPausedForDifficultyPicker: false,
  setDifficultyPickerOpen: (open) => {
    const s = get();
    const { world } = s;
    let autoPaused = s.autoPausedForDifficultyPicker;
    if (open) {
      if (world.status === "running") {
        world.status = "paused";
        autoPaused = true;
      }
    } else {
      if (autoPaused && world.status === "paused") world.status = "running";
      autoPaused = false;
    }
    set({
      difficultyPickerOpen: open,
      autoPausedForDifficultyPicker: autoPaused,
      ui: snapshot(world, s.towerVersion, s.treeVersion, s.inspectedEnemy),
    });
  },
  runMinDifficulty: null,

  setDifficulty: (difficulty) => {
    const s = get();
    if (s.progress.difficulty === difficulty) return;
    const next = setDifficultyOnProgress(s.progress, difficulty);
    persistProgress(s.activeSlot, next);

    const updates: Partial<GameStore> = { progress: next };

    // Mid-level apply: when the player changes difficulty from inside a
    // running level, push the new multipliers onto the live world and
    // re-bake hpMul for waves that haven't started yet. The current wave
    // and any already-queued spawns keep their old hpMul — switching
    // applies to subsequent waves, not retroactively. Run-min ratchets
    // toward easier so achievement credit reflects the easiest setting
    // the player coasted on at any point.
    if (s.screen === "playing" && s.selectedLevelId !== null) {
      const w = s.world;
      const level = getLevel(s.selectedLevelId);
      const modeConfig = resolveLevelMode(level, w.mode);
      const mul = DIFFICULTY_MULTIPLIERS[difficulty];
      w.speedMul = mul.speed;
      w.goldKillMul = mul.goldKill;
      const baseHpScale = (level.hpScale ?? 1) * mul.hp;
      const startIdx = Math.max(0, w.wave); // index of next wave to start
      for (let i = startIdx; i < modeConfig.waves.length; i++) {
        const orig = modeConfig.waves[i];
        w.plannedWaves[i] = {
          ...orig,
          hpMul: (orig.hpMul ?? 1) * baseHpScale,
        };
      }
      const prevMin = s.runMinDifficulty ?? difficulty;
      updates.runMinDifficulty = minDifficulty(prevMin, difficulty);
      updates.ui = snapshot(w, s.towerVersion, s.treeVersion, s.inspectedEnemy);
    } else if (s.screen === "playing" && s.world.endless) {
      // Endless mid-run difficulty change: push the new multipliers onto
      // the live world. Future generated waves read endless.hpMul; the
      // current wave's remaining spawns pick up the new speed immediately.
      const w = s.world;
      const en = w.endless;
      if (en) {
        const mul = DIFFICULTY_MULTIPLIERS[difficulty];
        w.goldKillMul = mul.goldKill;
        en.hpMul = mul.hp;
        en.baseSpeedMul = mul.speed;
        w.speedMul = mul.speed * endlessSpeedFactor(w.wave);
        const prevMin = s.runMinDifficulty ?? difficulty;
        updates.runMinDifficulty = minDifficulty(prevMin, difficulty);
        updates.ui = snapshot(w, s.towerVersion, s.treeVersion, s.inspectedEnemy);
      }
    }

    set(updates);
  },

  dismissAchievementToast: (key) =>
    set((state) => ({ achievementToasts: state.achievementToasts.filter((t) => t.key !== key) })),

  reset: () => {
    get().retryCurrentLevel();
  },

  togglePause: () => {
    const s = get();
    const { world } = s;
    if (world.status === "running") world.status = "paused";
    else if (world.status === "paused") world.status = "running";
    set({ ui: snapshot(world, s.towerVersion, s.treeVersion, s.inspectedEnemy) });
  },

  tick: (realTimeSec: number) => {
    const s = get();
    s.engine.step(s.world, realTimeSec);

    // Close placement when the armed tower stops being affordable.
    // Otherwise the picker would track a ghost the player can't drop —
    // every click would just play the "no gold" reject sound.
    let autoClosedSelection = false;
    if (s.selectedKind !== null) {
      const atLimit = towerKindAtBuildLimit(s.world, s.selectedKind);
      const cantAfford =
        !s.freeTowers && s.world.gold < effectiveTowerCost(s.selectedKind, s.progress.metaSkills);
      if (atLimit || cantAfford) {
        autoClosedSelection = true;
        emit(s.world, { type: "place-failed", reason: atLimit ? "limit" : "gold" });
      }
    }

    let progress = s.progress;
    let newEnemyQueue = s.newEnemyQueue;
    let deferredNewEnemyQueue = s.deferredNewEnemyQueue;
    let autoPaused = s.autoPausedForNewEnemy;
    let lastResult = s.lastResult;
    let screen = s.screen;
    const newToasts: AchievementToast[] = [];
    const unlockedThisRun: AchievementId[] = [];

    const runChecks = (ev: GameEvent | null) => {
      const res = checkAchievements(progress, s.world, ev);
      if (res.unlocked.length === 0) return;
      progress = res.progress;
      for (const id of res.unlocked) {
        newToasts.push({ id, key: nextToastKey++ });
        unlockedThisRun.push(id);
        track("achievement_unlocked", { achievement_id: id });
      }
    };

    const queueSightings = (sightings: NewSightingId[], opts?: { immediate?: boolean }) => {
      if (sightings.length === 0) return;
      if (!opts?.immediate && bossOrTitanMomentActive(s.world)) {
        const seen = new Set([...newEnemyQueue, ...deferredNewEnemyQueue].map(sightingKey));
        const additions = sightings.filter((sighting) => {
          const key = sightingKey(sighting);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (additions.length > 0) {
          deferredNewEnemyQueue = [...deferredNewEnemyQueue, ...additions];
        }
        return;
      }
      const queued = appendUniqueSightings(newEnemyQueue, sightings);
      if (!queued.added) return;
      newEnemyQueue = queued.queue;
      // Auto-pause on first sighting so the popup isn't buried under action.
      // Track that WE caused the pause, so dismiss won't unpause a manual pause.
      if (s.world.status === "running") {
        s.world.status = "paused";
        autoPaused = true;
      }
    };

    // Track encountered enemy kinds — and announce any first sighting.
    if (s.world.enemies.length > 0) {
      const kinds = new Set<EnemyKind>();
      const variants = new Set<BossVariant>();
      for (const e of s.world.enemies) {
        kinds.add(e.kind);
        if (e.bossVariant !== undefined) variants.add(e.bossVariant);
      }
      const kindList = Array.from(kinds);
      // Don't queue a generic "Matriarch" popup when a variant is on
      // screen — the per-variant popup below replaces it. The boss kind
      // still gets marked encountered so legacy code paths keep working.
      const newlySeenSpecies = kindList.filter(
        (k) => !progress.encountered[k] && !(k === "boss" && variants.size > 0),
      );
      const nextProgress = markEncountered(progress, kindList);
      if (nextProgress) {
        progress = nextProgress;
        // Titan is its own "big moment" enemy: it trips the boss/titan
        // deferral gate just by being on screen, so deferring its own
        // dossier behind that gate pushed the card to *after it died*
        // (same failure the matriarch had). Surface it immediately on
        // entrance. Every other species keeps the deferral so a trickle
        // or escort sighting doesn't interrupt an active boss/titan fight.
        const toSighting = (k: EnemyKind): NewSightingId => ({ tag: "species", species: k });
        queueSightings(newlySeenSpecies.filter((k) => k === "titan").map(toSighting), {
          immediate: true,
        });
        queueSightings(newlySeenSpecies.filter((k) => k !== "titan").map(toSighting));
        runChecks(null);
      }
      // Per-variant matriarch encounter — fires a NewEnemyAlert dossier
      // popup the moment her variant is first on screen (i.e. when she
      // enters), pausing like any other first sighting. Flagged
      // `immediate` so it bypasses the boss-wave deferral gate; that gate
      // stays true for the whole boss wave (including her child trickle,
      // which only ends when she dies), so deferring her own dossier
      // behind it pushed the popup to *after she was dead*.
      if (variants.size > 0) {
        const newlySeenVariants = Array.from(variants).filter(
          (v) => !progress.matriarchsEncountered[v],
        );
        const variantProgress = markMatriarchsEncountered(progress, Array.from(variants));
        if (variantProgress) progress = variantProgress;
        if (newlySeenVariants.length > 0) {
          const toQueue: NewSightingId[] = newlySeenVariants.map((v) => ({
            tag: "matriarch" as const,
            variant: v,
          }));
          queueSightings(toQueue, { immediate: true });
        }
      }
    }

    if (
      deferredNewEnemyQueue.length > 0 &&
      newEnemyQueue.length === 0 &&
      s.world.status === "running" &&
      !bossOrTitanMomentActive(s.world)
    ) {
      newEnemyQueue = deferredNewEnemyQueue;
      deferredNewEnemyQueue = [];
      s.world.status = "paused";
      autoPaused = true;
    }

    if (s.world.events.length > 0) {
      for (const ev of s.world.events) {
        if (ev.type === "death" && ev.target === "enemy") {
          progress = {
            ...progress,
            stats: { ...progress.stats, killsTotal: progress.stats.killsTotal + 1 },
            bolts: progress.bolts + ev.bolts,
          };
        }
        if (ev.type === "game-over") {
          const w = s.world;
          if (w.endless) {
            // Endless never "wins" — game-over here always means lives ran
            // out. Score is the highest wave reached; persist it as the
            // per-arena best and surface a new-best flag.
            const en = w.endless;
            const waveReached = w.wave;
            let enemiesKilled = w.robot.kills + w.base.kills;
            for (const t of w.towers) enemiesKilled += t.kills;
            const prevBest = getEndlessBest(progress, en.mapId, progress.difficulty);
            const newBest = waveReached > prevBest;
            progress = recordEndlessResult(progress, en.mapId, progress.difficulty, waveReached);
            lastResult = {
              levelId: w.levelId,
              levelName: en.mapName,
              won: false,
              livesRemaining: w.lives,
              startingLives: w.startLives,
              mode: "normal",
              stars: 0,
              bestStars: 0,
              improved: newBest,
              unlockedAchievements: [],
              endless: {
                mapId: en.mapId,
                mapName: en.mapName,
                waveReached,
                bestWave: Math.max(prevBest, waveReached),
                newBest,
                enemiesKilled,
              },
            };
            // Hold results back for the HQ destruction cinematic, same as a
            // campaign loss.
            setTimeout(() => {
              const cur = useGame.getState();
              if (cur.world.status === "lost" && cur.screen !== "results") {
                set({ screen: "results" });
              }
            }, 1300);
            track("endless_failed", { map_id: en.mapId, wave_reached: waveReached });
          } else {
            const mode: LevelMode = w.mode;
            const stars = starsForRun(mode, w.lives, ev.won);
            const prevModeStars = getModeStars(progress, w.levelId);
            const prev =
              mode === "normal"
                ? prevModeStars.normal
                : mode === "breach"
                  ? prevModeStars.breach
                  : prevModeStars.containment;
            const improved = ev.won && stars > prev;
            if (improved) progress = recordLevelResult(progress, w.levelId, mode, stars);
            if (ev.won) {
              progress = {
                ...progress,
                stats: { ...progress.stats, winsTotal: progress.stats.winsTotal + 1 },
              };
            }
            const level = LEVELS.find((l) => l.id === w.levelId);
            const bestStars = Math.max(prev, ev.won ? stars : 0);
            lastResult = {
              levelId: w.levelId,
              levelName: level?.name ?? `Level ${w.levelId}`,
              won: ev.won,
              livesRemaining: w.lives,
              startingLives: w.startLives,
              mode,
              stars,
              bestStars,
              improved,
              unlockedAchievements: [],
            };
            if (ev.won) {
              screen = "results";
            } else {
              // Hold the results screen back so the HQ destruction
              // cinematic in HQTurret.tsx (tilt + sink + bright flash, ~1.1s)
              // can complete before the overlay covers the world. The
              // loss-rumble in CameraRig is timed to the same window.
              setTimeout(() => {
                const cur = useGame.getState();
                if (cur.world.status === "lost" && cur.screen !== "results") {
                  set({ screen: "results" });
                }
              }, 1300);
            }
            if (ev.won) {
              track("level_complete", {
                level_id: w.levelId,
                waves_survived: w.totalWaves,
                stars,
              });
            } else {
              track("level_failed", {
                level_id: w.levelId,
                wave_reached: w.wave,
              });
            }
          }
        }
        runChecks(ev);
        for (const fn of s.eventListeners) fn(ev);
      }
      s.world.events.length = 0;
    }

    if (lastResult && unlockedThisRun.length > 0) {
      lastResult = { ...lastResult, unlockedAchievements: unlockedThisRun };
    }

    // Sync robot XP back into the persistent slot so kills count even
    // mid-run. Mid-tick re-spec / variant swaps read off progress, so
    // the latest XP must land here before the next tick can use it.
    const variant = s.world.robot.variant;
    const liveXp = s.world.robot.xp;
    const storedXp = progress.robotXp[variant] ?? 0;
    if (liveXp !== storedXp) {
      progress = {
        ...progress,
        robotXp: { ...progress.robotXp, [variant]: liveXp },
      };
      const prevLevel = s.world.robot.level;
      const nextLevel = levelForXp(liveXp);
      if (nextLevel > prevLevel) {
        // Mid-run level-up: bump maxHp by the per-level inherent bonus
        // and top off current HP by the same delta so leveling reads as
        // a real reward, not just a number tick.
        const bonus = robotLevelHpBonus(nextLevel) - robotLevelHpBonus(prevLevel);
        s.world.robot.maxHp += bonus;
        s.world.robot.hp = Math.min(s.world.robot.maxHp, s.world.robot.hp + bonus);
      }
      s.world.robot.level = nextLevel;
    }

    if (progress !== s.progress) persistProgress(s.activeSlot, progress);

    const updates: Partial<GameStore> = {};
    if (progress !== s.progress) updates.progress = progress;
    if (newEnemyQueue !== s.newEnemyQueue) updates.newEnemyQueue = newEnemyQueue;
    if (deferredNewEnemyQueue !== s.deferredNewEnemyQueue)
      updates.deferredNewEnemyQueue = deferredNewEnemyQueue;
    if (autoPaused !== s.autoPausedForNewEnemy) updates.autoPausedForNewEnemy = autoPaused;
    if (lastResult !== s.lastResult) updates.lastResult = lastResult;
    if (screen !== s.screen) updates.screen = screen;
    if (autoClosedSelection) {
      updates.selectedKind = null;
      updates.pendingTouchPlacement = null;
    }
    if (newToasts.length > 0) updates.achievementToasts = [...s.achievementToasts, ...newToasts];
    const next = snapshot(s.world, s.towerVersion, s.treeVersion, s.inspectedEnemy);
    if (!uiEqual(s.ui, next)) updates.ui = next;
    if (Object.keys(updates).length > 0) set(updates);
  },

  setSelectedKind: (kind) => {
    const s = get();
    const { world, towerVersion, treeVersion } = s;
    // Reject arming a kind the active mode forbids. Keyboard hotkeys and
    // the picker both route through here, so this is the single chokepoint.
    if (kind !== null && !isTowerKindAllowed(world, kind)) return;
    if (kind !== null) {
      world.selectedTowerId = null;
      world.selectedBase = false;
      // Picking up a tower implicitly cancels any pending robot dash
      // aim so the next ground click places the tower instead of
      // firing the dash. Cooldown wasn't consumed by the aim stage.
      if (world.robot.dashAim) world.robot.dashAim = null;
      // Arming a tower also drops robot selection — placement and robot
      // control are mutually exclusive, so ground clicks read as
      // placement, not move orders. Mirrors selectRobotUnit nulling
      // selectedKind in the other direction.
      if (world.robot.selected) world.robot.selected = false;
    }
    const nextInspect = kind !== null ? emptyInspect : s.inspectedEnemy;
    const nextTree = kind !== null ? null : s.selectedTreeId;
    const nextRock = kind !== null ? null : s.selectedRockId;
    set({
      selectedKind: kind,
      selectedTreeId: nextTree,
      selectedRockId: nextRock,
      inspectedEnemy: nextInspect,
      // Picking up a tower-to-place implicitly cancels any in-flight
      // drone assignment — the user is doing something else now.
      assigningDroneSlot: kind !== null ? null : s.assigningDroneSlot,
      // Same for an armed mortar spot-pick — arming a build kind means
      // the next click drops a tower, not a mortar aim point.
      spotSelecting: kind !== null ? false : s.spotSelecting,
      ui: snapshot(world, towerVersion, treeVersion, nextInspect),
    });
  },

  canPlace: (pos) => canPlaceAt(get().world, pos),

  towerAtPos: (pos) => towerAt(get().world, pos),

  hqAtPos: (pos) => hqAt(get().world, pos),

  orderRobotMove: (pos) => {
    const s = get();
    if (s.world.status !== "running") return false;
    // simOrderRobotMove rejects off-road clicks and stores the accepted
    // order on the nearest path centerline. Movement itself remains
    // free-roam, so obstacle/terrain detours are allowed while travelling.
    return simOrderRobotMove(s.world, pos);
  },

  triggerRobotAbility: (slot) => {
    const s = get();
    if (s.world.status !== "running") return;
    const hadAim = s.world.robot.dashAim !== null;
    if (!simTriggerRobotAbility(s.world, slot)) return;
    // Entering a re-targeting stage (dash aim) cancels active tower
    // placement so the next ground click commits the dash instead of
    // dropping a tower. Symmetric with setSelectedKind clearing dashAim.
    const enteredAim = !hadAim && s.world.robot.dashAim !== null;
    // Snapshot so the HUD reflects the freshly-triggered cooldown
    // immediately, not on the next tick. Cheap because uiEqual culls
    // no-op renders.
    set({
      ...(enteredAim && s.selectedKind !== null ? { selectedKind: null } : {}),
      ui: snapshot(s.world, s.towerVersion, s.treeVersion, s.inspectedEnemy),
    });
  },

  setRobotDashAimDir: (dir) => {
    const s = get();
    simSetRobotDashAimDir(s.world, dir);
  },

  cancelRobotDashAim: () => {
    const s = get();
    if (!s.world.robot.dashAim) return;
    simCancelRobotDashAim(s.world);
    set({ ui: snapshot(s.world, s.towerVersion, s.treeVersion, s.inspectedEnemy) });
  },

  selectRobotUnit: (on) => {
    const s = get();
    simSelectRobot(s.world, on);
    if (on) {
      // Robot selection is mutually exclusive with the other detail panels —
      // mirror tryPlaceOrSelect's invariant so only one panel renders at a
      // time and clicking the robot implicitly dismisses the prior selection.
      s.world.selectedTowerId = null;
      s.world.selectedBase = false;
      const inspectedEnemy = emptyInspect;
      set({
        selectedKind: null,
        selectedTreeId: null,
        selectedRockId: null,
        inspectedEnemy,
        ui: snapshot(s.world, s.towerVersion, s.treeVersion, inspectedEnemy),
      });
      return;
    }
    set({ ui: snapshot(s.world, s.towerVersion, s.treeVersion, s.inspectedEnemy) });
  },

  robotShopOpen: false,
  setRobotShopOpen: (open) => {
    const s = get();
    const w = s.world;
    // Open behaves like the difficulty picker — auto-pause running
    // levels so the player can browse without a wave eating their HP.
    if (open && w.status === "running") w.status = "paused";
    set({
      robotShopOpen: open,
      ui: snapshot(w, s.towerVersion, s.treeVersion, s.inspectedEnemy),
    });
  },

  robotPanelOpen: false,
  setRobotPanelOpen: (open) => {
    set({ robotPanelOpen: open });
  },

  unlockRobot: (variant) => {
    const s = get();
    if (s.progress.robotUnlocks[variant]) return;
    const cost = ROBOT_SPECS[variant].unlockBolts;
    if (!isDebug && s.progress.bolts < cost) return;
    const progress: ProgressData = {
      ...s.progress,
      bolts: isDebug ? s.progress.bolts : s.progress.bolts - cost,
      robotUnlocks: { ...s.progress.robotUnlocks, [variant]: true },
    };
    const updated = checkMetaAchievements(progress, s.world, s.achievementToasts);
    persistProgress(s.activeSlot, updated.progress);
    set(updated);
  },

  setActiveRobot: (variant) => {
    const s = get();
    if (!s.progress.robotUnlocks[variant] && variant !== "george") return;
    if (s.progress.activeRobot === variant) return;
    const progress: ProgressData = { ...s.progress, activeRobot: variant };
    persistProgress(s.activeSlot, progress);
    // If the player is mid-run, swap the live robot too so the change
    // takes effect immediately (otherwise it'd wait until next level).
    // Preserves position so the swap feels in-place.
    const w = s.world;
    if (s.screen === "playing") applyRobotVariantToWorld(w, variant, progress);
    set({
      progress,
      ui: snapshot(w, s.towerVersion, s.treeVersion, s.inspectedEnemy),
    });
  },

  setRobotSkillRank: (variant, id, rank) => {
    const s = get();
    const xp = s.progress.robotXp[variant] ?? 0;
    const ranks = s.progress.robotSkills[variant];
    const currentRank = getRobotRank(s.progress.robotSkills, variant, id);
    const next = setRobotRank(s.progress.robotSkills, variant, id, rank);
    if (next === s.progress.robotSkills) return;
    // Reject if spending more points than the robot's level grants. Use
    // the next ranks' spent total against the available pool.
    const nextRanks = next[variant];
    let nextSpent = 0;
    if (nextRanks) for (const k in nextRanks) nextSpent += nextRanks[k as RobotSkillId] ?? 0;
    const { earned } = robotSkillPointsAvailable(xp, ranks);
    if (nextSpent > earned) return;
    const nextRank = getRobotRank(next, variant, id);
    const boltDelta = robotSkillBoltDelta(currentRank, nextRank);
    if (!isDebug && boltDelta > 0 && s.progress.bolts < boltDelta) return;
    const progress: ProgressData = {
      ...s.progress,
      bolts: isDebug ? s.progress.bolts : Math.max(0, s.progress.bolts - boltDelta),
      robotSkills: next,
    };
    const updated = checkMetaAchievements(progress, s.world, s.achievementToasts);
    persistProgress(s.activeSlot, updated.progress);
    set(updated);
  },

  resetRobotSkills: (variant) => {
    const s = get();
    const next = resetRobotVariantRanks(s.progress.robotSkills, variant);
    if (next === s.progress.robotSkills) return;
    const refund = spentRobotSkillBolts(s.progress.robotSkills, variant);
    const progress: ProgressData = {
      ...s.progress,
      bolts: isDebug ? s.progress.bolts : s.progress.bolts + refund,
      robotSkills: next,
    };
    persistProgress(s.activeSlot, progress);
    set({ progress });
  },

  resetAllRobotSkills: () => {
    const s = get();
    if (Object.keys(s.progress.robotSkills).length === 0) return;
    const refund = spentRobotSkillBolts(s.progress.robotSkills);
    const progress: ProgressData = {
      ...s.progress,
      bolts: isDebug ? s.progress.bolts : s.progress.bolts + refund,
      robotSkills: resetAllRobotRanks(),
    };
    persistProgress(s.activeSlot, progress);
    set({ progress });
  },

  clearSelection: () => {
    const { world, towerVersion, treeVersion } = get();
    world.selectedTowerId = null;
    world.selectedBase = false;
    if (world.robot.selected) world.robot.selected = false;
    set({
      selectedKind: null,
      selectedTreeId: null,
      selectedRockId: null,
      pendingTouchPlacement: null,
      inspectedEnemy: emptyInspect,
      robotPanelOpen: false,
      spotSelecting: false,
      ui: snapshot(world, towerVersion, treeVersion, emptyInspect),
    });
  },

  setPendingTouchPlacement: (pos) => {
    set({ pendingTouchPlacement: pos });
  },

  confirmTouchPlacement: () => {
    const pos = get().pendingTouchPlacement;
    if (!pos) return;
    set({ pendingTouchPlacement: null });
    get().tryPlaceOrSelect(pos, { clearSelectionAfterPlacement: true });
  },

  inspectEnemy: (id, kind, maxHp, bossVariant) => {
    const { world, towerVersion, treeVersion } = get();
    world.selectedTowerId = null;
    world.selectedBase = false;
    // Intentionally preserve robot.selected — robot control outranks
    // dino-info inspection so the player can keep issuing move orders
    // while reading a passing dino's stats.
    const inspect: InspectState = { id, kind, maxHp, bossVariant };
    set({
      selectedKind: null,
      selectedTreeId: null,
      selectedRockId: null,
      inspectedEnemy: inspect,
      spotSelecting: false,
      ui: snapshot(world, towerVersion, treeVersion, inspect),
    });
  },

  clearInspectedEnemy: () => {
    const { world, towerVersion, treeVersion } = get();
    set({
      inspectedEnemy: emptyInspect,
      ui: snapshot(world, towerVersion, treeVersion, emptyInspect),
    });
  },

  markAssetsPrewarmed: () => {
    if (get().assetsPrewarmed) return;
    set({ assetsPrewarmed: true });
  },

  setLevelLoadProgress: (p) => {
    set({ levelLoadProgress: p });
  },

  dismissLevelIntro: () => {
    const s = get();
    if (!s.levelIntroVisible) return;
    const levelId = s.selectedLevelId;
    s.world.status = "running";
    let progress = s.progress;
    if (levelId !== null) {
      progress = {
        ...progress,
        seenIntros: { ...progress.seenIntros, [levelId]: true as const },
      };
      persistProgress(s.activeSlot, progress);
    }
    // Force a clean inspect state on intro dismiss — the player hasn't
    // had a chance to inspect anything yet, so a non-empty inspect here
    // is stale carry-over (e.g. dismissed a prior panel under the modal).
    set({
      levelIntroVisible: false,
      progress,
      inspectedEnemy: emptyInspect,
      ui: snapshot(s.world, s.towerVersion, s.treeVersion, emptyInspect),
    });
  },

  dismissNewEnemy: () => {
    const s = get();
    const remaining = s.newEnemyQueue.slice(1);
    // Resume only when the queue empties AND we were the ones who paused.
    const shouldResume =
      remaining.length === 0 && s.autoPausedForNewEnemy && s.world.status === "paused";
    if (shouldResume) s.world.status = "running";
    set({
      newEnemyQueue: remaining,
      autoPausedForNewEnemy: remaining.length === 0 ? false : s.autoPausedForNewEnemy,
      ui: snapshot(s.world, s.towerVersion, s.treeVersion, s.inspectedEnemy),
    });
  },

  selectTree: (id) => {
    const s = get();
    const w = s.world;
    if (w.status !== "running") return;
    const tree = treeById(w, id);
    if (!tree) return;
    w.selectedTowerId = null;
    w.selectedBase = false;
    if (w.robot.selected) w.robot.selected = false;
    const nextCount = (s.treeClickCounts[id] ?? 0) + 1;
    const nextCounts = { ...s.treeClickCounts, [id]: nextCount };
    const unlock =
      nextCount === EASTER_EGG_CLICK_THRESHOLD
        ? tryUnlockEasterEgg(s.progress, "tree_hugger")
        : null;
    if (unlock) {
      spawnParticles(w, tree.pos, 18, "#8ecf6b", [2.5, 5.5], 0.55);
      spawnParticles(w, tree.pos, 10, "#c8f2a4", [1.5, 3.5], 0.75);
      persistProgress(s.activeSlot, unlock.progress);
      track("achievement_unlocked", { achievement_id: unlock.id });
    }
    set({
      selectedKind: null,
      selectedTreeId: id,
      selectedRockId: null,
      inspectedEnemy: emptyInspect,
      treeClickCounts: nextCounts,
      ...(unlock
        ? {
            progress: unlock.progress,
            achievementToasts: [...s.achievementToasts, { id: unlock.id, key: nextToastKey++ }],
          }
        : {}),
      ui: snapshot(w, s.towerVersion, s.treeVersion, emptyInspect),
    });
  },

  clearSelectedTree: () => set({ selectedTreeId: null }),

  confirmRemoveTree: () => {
    const s = get();
    const w = s.world;
    const id = s.selectedTreeId;
    if (id === null || w.status !== "running") return;
    const tree = treeById(w, id);
    if (!tree) {
      set({ selectedTreeId: null });
      return;
    }
    if (w.gold < TREE_REMOVE_COST) return;
    w.gold -= TREE_REMOVE_COST;
    w.trees = w.trees.filter((t) => t.id !== id);
    const newTreeVersion = s.treeVersion + 1;
    set({
      treeVersion: newTreeVersion,
      selectedTreeId: null,
      ui: snapshot(w, s.towerVersion, newTreeVersion, s.inspectedEnemy),
    });
  },

  selectRock: (id) => {
    const s = get();
    const w = s.world;
    if (w.status !== "running") return;
    const rock = rockById(w, id);
    if (!rock) return;
    w.selectedTowerId = null;
    w.selectedBase = false;
    if (w.robot.selected) w.robot.selected = false;
    const nextCount = (s.rockClickCounts[id] ?? 0) + 1;
    const nextCounts = { ...s.rockClickCounts, [id]: nextCount };
    const unlock =
      nextCount === EASTER_EGG_CLICK_THRESHOLD
        ? tryUnlockEasterEgg(s.progress, "diamond_in_the_rough")
        : null;
    if (unlock) {
      spawnParticles(w, rock.pos, 22, "#e8faff", [3, 6], 0.7);
      spawnParticles(w, rock.pos, 12, "#aaf0ff", [1.5, 3.5], 0.9);
      persistProgress(s.activeSlot, unlock.progress);
      track("achievement_unlocked", { achievement_id: unlock.id });
    }
    set({
      selectedKind: null,
      selectedTreeId: null,
      selectedRockId: id,
      inspectedEnemy: emptyInspect,
      rockClickCounts: nextCounts,
      ...(unlock
        ? {
            progress: unlock.progress,
            achievementToasts: [...s.achievementToasts, { id: unlock.id, key: nextToastKey++ }],
          }
        : {}),
      ui: snapshot(w, s.towerVersion, s.treeVersion, emptyInspect),
    });
  },

  clearSelectedRock: () => set({ selectedRockId: null }),

  clickEasterEgg: (id, hitPos) => {
    const s = get();
    const w = s.world;
    if (w.status !== "running" && w.status !== "paused") return;
    const egg = w.easterEggs.find((e) => e.id === id);
    if (!egg) return;
    const def = EASTER_EGG_BY_ID[egg.defId];
    if (!def) return;
    egg.clickCount++;
    // Particle origin: prefer the renderer-supplied hit point — the
    // visible egg position at the click frame. For moving eggs the sim
    // integrates between the click event firing and this handler
    // running, so reading egg.pos here can drop the burst a few units
    // ahead of where the user saw the model.
    const burstPos = hitPos ?? egg.pos;
    // Eggs with a chimney offset (the cabin) render their own per-egg
    // smoke column in the renderer, anchored to the chimney top. The
    // default ground-plane puff would just plume out around the cabin's
    // base and visually fight the column, so suppress it here. The
    // renderer reacts to `clickCount` for repeat-click feedback too.
    if (!def.chimneyOffset) {
      spawnParticles(
        w,
        burstPos,
        def.effect.particleCount,
        def.effect.particleColor,
        def.effect.particleSpeed,
        def.effect.particleLife,
      );
      if (def.effect.secondary) {
        spawnParticles(
          w,
          burstPos,
          def.effect.secondary.count,
          def.effect.secondary.color,
          def.effect.secondary.speed,
          def.effect.secondary.life,
        );
      }
    }
    const updates: Partial<GameStore> = {};
    if (egg.clickCount >= def.clickThreshold && !egg.triggered) {
      egg.triggered = true;
      emit(w, { type: "easter-egg-click", defId: def.id });
      // Chain progress updates so each helper reads the prior result —
      // markEasterEggTriggered AND tryUnlockEasterEgg can both fire on
      // the same click, and we mustn't lose either write.
      let nextProgress: ProgressData = s.progress;
      const marked = markEasterEggTriggered(nextProgress, w.levelId, def.id);
      if (marked) nextProgress = marked;
      // Click-roll eggs (the barrel) topple toward the closest map edge
      // and despawn once they leave. Heading aims at the nearest edge so
      // the barrel always rolls *off* the playfield rather than veering
      // back toward a wall.
      if (def.goldReward) {
        w.gold += def.goldReward;
        spawnParticles(w, burstPos, 14, "#ffd700", [3, 6], 0.7);
        spawnParticles(w, burstPos, 10, "#ffec80", [2, 4.5], 0.5);
        // Give the renderer a short window to fade/shrink the model out
        // rather than vanishing on the same tick the click registers.
        // clickRoll eggs (the barrel) overwrite this below with their
        // tumble lifetime; static gold rewards (skull) use the grace.
        egg.despawnAt = w.time + EASTER_EGG_DESPAWN_FADE;
        updates.ui = snapshot(w, s.towerVersion, s.treeVersion, s.inspectedEnemy);
      }
      if (def.clickRoll) {
        const distLeft = egg.pos.x + MAP_WIDTH / 2;
        const distRight = MAP_WIDTH / 2 - egg.pos.x;
        const distBottom = egg.pos.y + MAP_HEIGHT / 2;
        const distTop = MAP_HEIGHT / 2 - egg.pos.y;
        const minDist = Math.min(distLeft, distRight, distBottom, distTop);
        let dx = 0;
        let dy = 0;
        if (minDist === distLeft) dx = -1;
        else if (minDist === distRight) dx = 1;
        else if (minDist === distBottom) dy = -1;
        else dy = 1;
        const speed = def.clickRoll.speed;
        egg.vel = { x: dx * speed, y: dy * speed };
        // Model-forward at rotY=0 is -z_world; game-y maps to -z_world,
        // so heading = atan2(dx, -dy_game). Matches ModelEnemyMesh.
        egg.rotY = Math.atan2(dx, -dy);
        egg.spin = def.clickRoll.spinRate;
        egg.despawnAt = w.time + def.clickRoll.lifetime;
      }
      const unlock = tryUnlockEasterEgg(nextProgress, def.achievement);
      if (unlock) {
        nextProgress = unlock.progress;
        updates.achievementToasts = [
          ...s.achievementToasts,
          { id: unlock.id, key: nextToastKey++ },
        ];
        track("achievement_unlocked", { achievement_id: unlock.id });
      }
      if (nextProgress !== s.progress) {
        persistProgress(s.activeSlot, nextProgress);
        updates.progress = nextProgress;
      }
    }
    set(updates);
  },

  confirmRemoveRock: () => {
    const s = get();
    const w = s.world;
    const id = s.selectedRockId;
    if (id === null || w.status !== "running") return;
    const rock = rockById(w, id);
    if (!rock) {
      set({ selectedRockId: null });
      return;
    }
    if (w.gold < ROCK_REMOVE_COST) return;
    w.gold -= ROCK_REMOVE_COST;
    w.rocks = w.rocks.filter((r) => r.id !== id);
    const newTreeVersion = s.treeVersion + 1;
    set({
      treeVersion: newTreeVersion,
      selectedRockId: null,
      ui: snapshot(w, s.towerVersion, newTreeVersion, s.inspectedEnemy),
    });
  },

  tryPlaceOrSelect: (pos, options) => {
    const s = get();
    const w = s.world;

    const hit = towerAt(w, pos);
    if (hit) {
      // Drone-assignment cursor wins over normal selection: if the
      // player clicked a tower while armed for assignment, route the
      // click into the assignment action instead of switching selection.
      if (s.assigningDroneSlot) {
        get().assignDroneToTower(hit.id);
        return;
      }
      w.selectedTowerId = hit.id;
      w.selectedBase = false;
      if (w.robot.selected) w.robot.selected = false;
      set({
        selectedKind: null,
        selectedTreeId: null,
        selectedRockId: null,
        inspectedEnemy: emptyInspect,
        spotSelecting: false,
        ui: snapshot(w, s.towerVersion, s.treeVersion, emptyInspect),
      });
      return;
    }

    // HQ click — selects the base weapon panel. Wins over the empty-
    // ground deselect path below, but loses to active tower placement
    // and drone-assignment cursors since both want the click to go
    // through to the canvas action.
    if (s.selectedKind === null && !s.assigningDroneSlot && hqAt(w, pos)) {
      w.selectedTowerId = null;
      w.selectedBase = true;
      if (w.robot.selected) w.robot.selected = false;
      set({
        selectedTreeId: null,
        selectedRockId: null,
        inspectedEnemy: emptyInspect,
        spotSelecting: false,
        ui: snapshot(w, s.towerVersion, s.treeVersion, emptyInspect),
      });
      return;
    }

    // Empty-ground click cancels an in-flight drone assignment so the
    // cursor doesn't get stuck if the player thinks better of it.
    if (s.assigningDroneSlot) {
      set({ assigningDroneSlot: null });
      return;
    }

    // Spot-targeting: only while the player armed ground-pick mode by
    // clicking the "Spot" button (spotSelecting). The next in-range click
    // sets the aim point and disarms — a one-shot pick. Merely having the
    // mortar selected no longer arms this, so clicking the tower to open
    // its panel can't accidentally re-aim it.
    if (s.spotSelecting && s.selectedKind === null && w.selectedTowerId !== null) {
      const sel = w.towerById.get(w.selectedTowerId);
      if (sel && sel.kind === "mortar" && sel.targetingMode === "spot") {
        const dx = pos.x - sel.pos.x;
        const dy = pos.y - sel.pos.y;
        if (dx * dx + dy * dy <= sel.range * sel.range) {
          sel.targetSpot = { x: pos.x, y: pos.y };
          sel.targetId = null;
          const newVersion = s.towerVersion + 1;
          set({
            spotSelecting: false,
            towerVersion: newVersion,
            ui: snapshot(w, newVersion, s.treeVersion, s.inspectedEnemy),
          });
        }
        // Out-of-range click: stay armed so the player can retry in range.
        return;
      }
    }

    if (s.selectedKind === null) {
      const hasAnySelection =
        w.selectedTowerId !== null ||
        w.selectedBase ||
        s.selectedTreeId !== null ||
        s.selectedRockId !== null ||
        s.inspectedEnemy.id !== null;
      if (hasAnySelection) {
        w.selectedTowerId = null;
        w.selectedBase = false;
        set({
          selectedTreeId: null,
          selectedRockId: null,
          inspectedEnemy: emptyInspect,
          spotSelecting: false,
          ui: snapshot(w, s.towerVersion, s.treeVersion, emptyInspect),
        });
      }
      return;
    }
    // Tower placement spends gold and adds entities — only allowed during
    // an active wave. Selection/deselection above is fine in any state
    // (auto-pause on new-enemy sighting is a common moment to deselect).
    if (w.status !== "running") return;
    // Mode rule check before spending gold. The HUD greys out denied
    // kinds, but a stale picker selection (e.g. the player armed a kind
    // before opening the breach/containment run) is rejected here so rules
    // can't be bypassed mid-run.
    if (!isTowerKindAllowed(w, s.selectedKind)) {
      emit(w, { type: "place-failed", reason: "spot" });
      return;
    }
    // Hard per-kind build cap — applies even in free-towers debug mode
    // since it is a placement rule, not a gold gate.
    if (towerKindAtBuildLimit(w, s.selectedKind)) {
      emit(w, { type: "place-failed", reason: "limit" });
      return;
    }
    const cost = effectiveTowerCost(s.selectedKind, s.progress.metaSkills);
    // Debug "free towers" mode skips both the affordability check and
    // the spend; lets a tester sanity-check matchups without grinding.
    const free = s.freeTowers;
    if (!free && w.gold < cost) {
      emit(w, { type: "place-failed", reason: "gold" });
      return;
    }
    if (!canPlaceAt(w, pos)) {
      emit(w, { type: "place-failed", reason: "spot" });
      return;
    }
    if (!free) w.gold -= cost;
    const placed = createTower(w, s.selectedKind, pos);
    // Bake meta-skill ranks into the new tower's base stats. Done after
    // createTower (rather than inside it) so world.ts stays decoupled
    // from the progress system. totalSpent records the actual paid price,
    // including any meta discount.
    applyMetaSkillsToTower(placed, s.progress.metaSkills);
    placed.totalSpent = cost;
    autoAssignDroneToNewTower(w, placed);
    emit(w, { type: "tower-placed", towerKind: s.selectedKind });
    // Placing a tower is a deliberate "I'm not driving the robot right
    // now" action — mirror the tower-select branch above and de-select
    // the robot so the next click drops a tower or selects, not a move
    // order for the robot.
    if (w.robot.selected) w.robot.selected = false;
    // Don't auto-select the freshly dropped tower — being thrown into
    // the upgrade panel after every placement is noisy mid-wave.
    const newVersion = s.towerVersion + 1;
    // Desktop/gamepad can keep placing while the tower remains buildable —
    // i.e. still affordable AND not at the per-kind cap (w already
    // includes the tower just placed). Touch placement is one-shot so a
    // stray follow-up tap does not spend another tower by accident.
    const stillBuildable =
      !towerKindAtBuildLimit(w, s.selectedKind) &&
      (free || w.gold >= effectiveTowerCost(s.selectedKind, s.progress.metaSkills));
    const keepSelectedAfterPlacement = !options?.clearSelectionAfterPlacement && stillBuildable;
    const nextSelectedKind = keepSelectedAfterPlacement ? s.selectedKind : null;
    const nextPendingTouch = nextSelectedKind === null ? null : s.pendingTouchPlacement;
    set({
      towerVersion: newVersion,
      selectedKind: nextSelectedKind,
      pendingTouchPlacement: nextPendingTouch,
      ui: snapshot(w, newVersion, s.treeVersion, s.inspectedEnemy),
    });
  },

  selectTower: (id) => {
    const s = get();
    const { world, towerVersion, treeVersion } = s;
    // If switching to a non-hive tower (or closing the panel), drop any
    // in-flight drone-assignment cursor — it belonged to the previously
    // selected hive.
    const nextHive = id !== null ? world.towerById.get(id) : null;
    const keepAssigning =
      s.assigningDroneSlot !== null &&
      nextHive?.kind === "hive" &&
      nextHive.id === s.assigningDroneSlot.hiveId;
    world.selectedTowerId = id;
    if (id !== null) world.selectedBase = false;
    const nextInspect = id !== null ? emptyInspect : s.inspectedEnemy;
    set({
      selectedKind: id !== null ? null : s.selectedKind,
      selectedTreeId: null,
      selectedRockId: null,
      inspectedEnemy: nextInspect,
      assigningDroneSlot: keepAssigning ? s.assigningDroneSlot : null,
      spotSelecting: false,
      ui: snapshot(world, towerVersion, treeVersion, nextInspect),
    });
  },

  upgradeSelected: (branch) => {
    const s = get();
    if (s.world.selectedTowerId === null) return;
    const t = s.world.towerById.get(s.world.selectedTowerId);
    if (!t) return;
    if (applyUpgrade(s.world, t, branch)) {
      // Hive drone-bay path adds an idle drone slot. Leave it idle so the
      // player assigns it deliberately via the hive panel — auto-routing
      // the extra drone to whatever neighbour had room read as the tower
      // "quietly" scattering drones the player meant to stack on one.
      const newVersion = s.towerVersion + 1;
      set({
        towerVersion: newVersion,
        ui: snapshot(s.world, newVersion, s.treeVersion, s.inspectedEnemy),
      });
    }
  },

  sellSelected: () => {
    const s = get();
    if (s.world.selectedTowerId === null) return;
    const t = s.world.towerById.get(s.world.selectedTowerId);
    if (!t) return;
    // Containment mode disables selling entirely — every placement is committed
    // for the run. The UI hides the sell button, but reject defensively.
    if (s.world.sellingDisabled) return;
    sellTower(s.world, t);
    emit(s.world, { type: "tower-sold" });
    const newVersion = s.towerVersion + 1;
    set({
      towerVersion: newVersion,
      ui: snapshot(s.world, newVersion, s.treeVersion, s.inspectedEnemy),
    });
  },

  setTargetingMode: (mode) => {
    const s = get();
    if (s.world.selectedTowerId === null) return;
    const t = s.world.towerById.get(s.world.selectedTowerId);
    if (!t) return;
    // The "Spot" button always (re-)arms ground-pick mode — even when the
    // mortar is already in spot mode. Clicking it again is the ONLY way to
    // re-enter aim-point selection, which is what the player expects.
    if (mode === "spot") {
      t.targetingMode = "spot";
      t.targetId = null;
      const newVersion = s.towerVersion + 1;
      set({
        spotSelecting: true,
        towerVersion: newVersion,
        ui: snapshot(s.world, newVersion, s.treeVersion, s.inspectedEnemy),
      });
      return;
    }
    if (t.targetingMode === mode) return;
    t.targetingMode = mode;
    t.targetId = null;
    const newVersion = s.towerVersion + 1;
    set({
      spotSelecting: false,
      towerVersion: newVersion,
      ui: snapshot(s.world, newVersion, s.treeVersion, s.inspectedEnemy),
    });
  },

  selectBase: (on) => {
    const s = get();
    const w = s.world;
    if (w.selectedBase === on) return;
    w.selectedBase = on;
    if (on) {
      w.selectedTowerId = null;
      set({
        selectedKind: null,
        selectedTreeId: null,
        selectedRockId: null,
        inspectedEnemy: emptyInspect,
        ui: snapshot(w, s.towerVersion, s.treeVersion, emptyInspect),
      });
    } else {
      set({ ui: snapshot(w, s.towerVersion, s.treeVersion, s.inspectedEnemy) });
    }
  },

  upgradeBase: (branch) => {
    const s = get();
    if (!applyBaseUpgrade(s.world, branch)) return;
    // Bump towerVersion so the panel (which subscribes to it) re-reads
    // the new tier without needing its own version counter.
    const newVersion = s.towerVersion + 1;
    set({
      towerVersion: newVersion,
      ui: snapshot(s.world, newVersion, s.treeVersion, s.inspectedEnemy),
    });
  },

  callWaveEarly: () => {
    const s = get();
    if (!simCallWaveEarly(s.world)) return;
    emit(s.world, { type: "wave-called-early" });
    set({ ui: snapshot(s.world, s.towerVersion, s.treeVersion, s.inspectedEnemy) });
  },

  beginDroneAssignment: (hiveId, droneIdx) => {
    const s = get();
    const hive = s.world.towerById.get(hiveId);
    if (!hive || hive.kind !== "hive") return;
    if (droneIdx < 0 || droneIdx >= hive.droneCount) return;
    set({ assigningDroneSlot: { hiveId, droneIdx } });
  },

  assignDroneToTower: (towerId) => {
    const s = get();
    const slot = s.assigningDroneSlot;
    if (!slot) return;
    const hive = s.world.towerById.get(slot.hiveId);
    if (!hive || hive.kind !== "hive") {
      set({ assigningDroneSlot: null });
      return;
    }
    const target = s.world.towerById.get(towerId);
    if (!target) {
      // Defensive: the clicked tower no longer exists. Drop the cursor.
      set({ assigningDroneSlot: null });
      return;
    }
    // Refuse self-assignment + hive-to-hive: a hive can't host a drone.
    // Reject audibly with a reason and keep the cursor armed so the
    // player can retarget — never silently swallow the pick.
    if (target.kind === "hive") {
      emit(s.world, { type: "drone-assign-failed", reason: "unsupported" });
      return;
    }
    // Cap drones-per-target. The currently-picked slot may already
    // point at the same tower (re-confirming an existing assignment is
    // a no-op), so subtract that from the cap check to avoid spurious
    // rejections when the slot count is exactly at the limit.
    const currentAssignment = hive.droneAssignments[slot.droneIdx];
    if (currentAssignment !== towerId) {
      const stacked = countDronesOnTower(s.world, towerId);
      if (stacked >= HIVE_MAX_DRONES_PER_TOWER) {
        // Target already at the per-tower drone cap. Reject audibly and
        // keep the pick cursor armed so the player can retarget — never
        // silently reroute the drone onto a different tower.
        emit(s.world, { type: "drone-assign-failed", reason: "full" });
        return;
      }
    }
    hive.droneAssignments[slot.droneIdx] = towerId;
    const newVersion = s.towerVersion + 1;
    // Drone assignments aren't tick-driven sim events, so the
    // achievement check loop in tick() never sees them. Run a check
    // here so full_service can unlock the moment the last slot is
    // wired up — without making the player kill an enemy first.
    const ach = checkAchievements(s.progress, s.world, null);
    const newToasts = ach.unlocked.map((id) => ({ id, key: nextToastKey++ }));
    if (ach.unlocked.length > 0) {
      persistProgress(s.activeSlot, ach.progress);
      for (const id of ach.unlocked) track("achievement_unlocked", { achievement_id: id });
    }
    set({
      assigningDroneSlot: null,
      towerVersion: newVersion,
      progress: ach.unlocked.length > 0 ? ach.progress : s.progress,
      achievementToasts:
        newToasts.length > 0 ? [...s.achievementToasts, ...newToasts] : s.achievementToasts,
      ui: snapshot(s.world, newVersion, s.treeVersion, s.inspectedEnemy),
    });
  },

  clearDroneAssignment: (hiveId, droneIdx) => {
    const s = get();
    const hive = s.world.towerById.get(hiveId);
    if (!hive || hive.kind !== "hive") return;
    if (droneIdx < 0 || droneIdx >= hive.droneCount) return;
    if (hive.droneAssignments[droneIdx] === null) return;
    hive.droneAssignments[droneIdx] = null;
    const newVersion = s.towerVersion + 1;
    set({
      towerVersion: newVersion,
      ui: snapshot(s.world, newVersion, s.treeVersion, s.inspectedEnemy),
    });
  },

  cancelDroneAssignment: () => {
    set({ assigningDroneSlot: null });
  },

  onEvent: (fn) => {
    set((state) => ({ eventListeners: [...state.eventListeners, fn] }));
    return () => {
      set((state) => ({ eventListeners: state.eventListeners.filter((f) => f !== fn) }));
    };
  },

  // ── Debug actions ──────────────────────────────────────────────
  // All only ever called from the debug menu (PauseMenu + WorldMapUI),
  // which themselves only render under isDebug. Vite tree-shakes the
  // call sites in production, leaving these as orphan dead code that
  // gets minified away.
  freeTowers: false,
  invincible: false,
  pathDebug: false,
  compendiumLocks: { enemies: {}, matriarchs: {}, towers: {}, mechanics: {}, robots: {}, lore: {} },

  debugAddGold: (n) => {
    const s = get();
    s.world.gold += n;
    set({ ui: snapshot(s.world, s.towerVersion, s.treeVersion, s.inspectedEnemy) });
  },

  debugSkipWave: () => {
    const s = get();
    const w = s.world;
    // Allow paused too — the buttons live in the pause menu, which only
    // mounts while paused; auto-resume below so the skip is visible.
    if (w.status !== "running" && w.status !== "paused") return;
    // Clear pending spawns + any alive enemies so the current wave
    // immediately resolves; the spawnerTick will then advance to the
    // next wave on its normal schedule.
    w.spawnQueue.length = 0;
    for (const e of w.enemies) e.alive = false;
    // If we're between waves, jump the timer.
    w.nextWaveIn = 0;
    w.midwaveTimer = 0;
    if (w.status === "paused") w.status = "running";
    set({ ui: snapshot(w, s.towerVersion, s.treeVersion, s.inspectedEnemy) });
  },

  debugWinLevel: () => {
    const s = get();
    const w = s.world;
    if (w.status !== "running" && w.status !== "paused") return;
    // Mirror the natural win path: clear all enemies + spawn queue,
    // mark the run as won, and emit the game-over event so the
    // results screen + progress recording fire normally.
    w.spawnQueue.length = 0;
    for (const e of w.enemies) e.alive = false;
    w.wave = w.totalWaves;
    w.waveActive = false;
    w.status = "won";
    emit(w, { type: "game-over", won: true });
    set({ ui: snapshot(w, s.towerVersion, s.treeVersion, s.inspectedEnemy) });
  },

  debugSetFreeTowers: (on) => {
    set({ freeTowers: on });
  },

  debugSetInvincible: (on) => {
    const s = get();
    s.world.invincible = on;
    // Bump UI snapshot so the toggle's pressed state and the persistent
    // "INVINCIBLE" badge re-render immediately, even when paused.
    set({ invincible: on, ui: snapshot(s.world, s.towerVersion, s.treeVersion, s.inspectedEnemy) });
  },

  debugSetPathDebug: (on) => {
    set({ pathDebug: on });
  },

  debugSpawnEnemy: (kind) => {
    const s = get();
    const w = s.world;
    if (w.status !== "running" && w.status !== "paused") return;
    if (w.paths.length === 0) return;
    spawnEnemy(w, kind);
    set({ ui: snapshot(w, s.towerVersion, s.treeVersion, s.inspectedEnemy) });
  },

  debugForceWave: (n) => {
    const s = get();
    const w = s.world;
    if (w.status !== "running" && w.status !== "paused") return;
    const target = Math.max(1, Math.min(w.totalWaves, Math.floor(n)));
    // Wipe the current wave + sim queue, then call startWave directly so
    // the target wave begins immediately. setting wave=target-1 makes
    // startWave's `wave += 1` land on `target`, which queues
    // plannedWaves[target-1]. Calling startWave inline (vs. nudging the
    // spawnerTick to do it) keeps the response instant *and* works for
    // target=1, where the spawnerTick would bail because wave === 0.
    w.spawnQueue.length = 0;
    for (const e of w.enemies) e.alive = false;
    w.wave = target - 1;
    w.waveActive = false;
    w.nextWaveIn = 0;
    w.midwaveTimer = 0;
    w.midwaveTimerMax = 0;
    if (w.status === "paused") w.status = "running";
    startWave(w);
    set({ ui: snapshot(w, s.towerVersion, s.treeVersion, s.inspectedEnemy) });
  },

  debugTriggerEasterEgg: (defId) => {
    const s = get();
    const w = s.world;
    const def = EASTER_EGG_BY_ID[defId];
    if (!def) return;
    if (def.motion) {
      // Moving eggs (tumbleweed/rover): spawn one from a map edge —
      // user can chase it down.
      spawnMovingEasterEgg(w, defId);
    } else {
      // Static eggs: drop one near the map center so it's findable
      // regardless of biome eligibility, and give it a fresh id.
      w.easterEggs = [
        ...w.easterEggs,
        {
          id: w.nextEntityId++,
          defId,
          pos: { x: 0, y: 0 },
          rotY: Math.random() * Math.PI * 2,
          clickCount: 0,
          triggered: false,
          vel: null,
          despawnAt: null,
          spin: 0,
          rollPitch: 0,
        },
      ];
    }
    set({ ui: snapshot(w, s.towerVersion, s.treeVersion, s.inspectedEnemy) });
  },

  debugForceUnlockEasterEggAchievement: (defId) => {
    const s = get();
    const def = EASTER_EGG_DEFS.find((d) => d.id === defId);
    if (!def) return;
    if (s.progress.unlocked[def.achievement] !== undefined) return;
    const next: ProgressData = {
      ...s.progress,
      unlocked: { ...s.progress.unlocked, [def.achievement]: Date.now() },
    };
    persistProgress(s.activeSlot, next);
    set({
      progress: next,
      achievementToasts: [...s.achievementToasts, { id: def.achievement, key: nextToastKey++ }],
    });
    track("achievement_unlocked", { achievement_id: def.achievement });
  },

  debugSetEnemyEncountered: (kind, encountered) => {
    const s = get();
    const nextEncountered = { ...s.progress.encountered };
    if (encountered) nextEncountered[kind] = true;
    else delete nextEncountered[kind];
    let next: ProgressData = { ...s.progress, encountered: nextEncountered };
    // Re-run achievement checks so flipping the last species on lights up
    // Scholar (and flipping it off doesn't lock Scholar back, since
    // checkAchievements never revokes — that's intentional).
    const res = checkAchievements(next, s.world, null);
    next = res.progress;
    persistProgress(s.activeSlot, next);
    const newToasts = res.unlocked.map((id) => ({ id, key: nextToastKey++ }));
    set({
      progress: next,
      achievementToasts:
        newToasts.length > 0 ? [...s.achievementToasts, ...newToasts] : s.achievementToasts,
    });
  },

  debugSetEnemyDossierLocked: (kind, locked) => {
    const s = get();
    const nextEnemies = { ...s.compendiumLocks.enemies };
    nextEnemies[kind] = locked;
    set({ compendiumLocks: { ...s.compendiumLocks, enemies: nextEnemies } });
  },

  debugSetMatriarchDossierLocked: (variant, locked) => {
    const s = get();
    const nextMatriarchs = { ...s.compendiumLocks.matriarchs };
    nextMatriarchs[variant] = locked;
    set({ compendiumLocks: { ...s.compendiumLocks, matriarchs: nextMatriarchs } });
  },

  debugSetTowerLocked: (kind, locked) => {
    const s = get();
    const nextTowers = { ...s.compendiumLocks.towers };
    if (locked) nextTowers[kind] = true;
    else delete nextTowers[kind];
    set({ compendiumLocks: { ...s.compendiumLocks, towers: nextTowers } });
  },

  debugSetMechanicLocked: (id, locked) => {
    const s = get();
    const nextMech = { ...s.compendiumLocks.mechanics };
    if (locked) nextMech[id] = true;
    else delete nextMech[id];
    set({ compendiumLocks: { ...s.compendiumLocks, mechanics: nextMech } });
  },

  debugSetAllDossiersLocked: (locked) => {
    const nextEnemies: Partial<Record<EnemyKind, boolean>> = {};
    for (const kind of DEBUG_ENEMY_DOSSIER_KINDS) nextEnemies[kind] = locked;
    const nextMatriarchs: Partial<Record<BossVariant, boolean>> = {};
    for (const variant of DEBUG_MATRIARCH_DOSSIER_VARIANTS) nextMatriarchs[variant] = locked;
    const nextTowers: Partial<Record<TowerKind, boolean>> = {};
    for (const kind of DEBUG_TOWER_DOSSIER_KINDS) nextTowers[kind] = locked;
    const nextMechanics: Partial<Record<MechanicId, boolean>> = {};
    for (const id of MECHANIC_ORDER) nextMechanics[id] = locked;
    const nextRobots: Partial<Record<RobotVariant, boolean>> = {};
    for (const variant of ROBOT_VARIANTS) nextRobots[variant] = locked;
    const nextLore: Partial<Record<number, boolean>> = {};
    for (const id of LORE_FRAGMENT_ORDER) nextLore[id] = locked;

    set({
      compendiumLocks: {
        enemies: nextEnemies,
        matriarchs: nextMatriarchs,
        towers: nextTowers,
        mechanics: nextMechanics,
        robots: nextRobots,
        lore: nextLore,
      },
    });
  },

  debugSetAchievementUnlocked: (id, unlocked) => {
    const s = get();
    if (!ACHIEVEMENT_BY_ID[id]) return;
    const isUnlocked = s.progress.unlocked[id] !== undefined;
    if (isUnlocked === unlocked) return;
    const nextUnlocked = { ...s.progress.unlocked };
    if (unlocked) nextUnlocked[id] = Date.now();
    else delete nextUnlocked[id];
    const next: ProgressData = { ...s.progress, unlocked: nextUnlocked };
    persistProgress(s.activeSlot, next);
    set({
      progress: next,
      ...(unlocked
        ? { achievementToasts: [...s.achievementToasts, { id, key: nextToastKey++ }] }
        : {}),
    });
  },

  debugSetLevelStars: (levelId, stars) => {
    const s = get();
    let next: ProgressData = {
      ...s.progress,
      starsByLevel: { ...s.progress.starsByLevel },
    };
    // Debug only touches the normal-mode star slot. Breach + containment
    // stars are preserved if already earned so toggling normal back to 0 in
    // the debug menu doesn't nuke a player's challenge clears.
    const prev = s.progress.starsByLevel[levelId];
    if (stars === 0 && (!prev || (prev.breach === 0 && prev.containment === 0))) {
      delete next.starsByLevel[levelId];
    } else {
      next.starsByLevel[levelId] = {
        normal: stars,
        breach: prev?.breach ?? 0,
        containment: prev?.containment ?? 0,
      };
    }
    if (spentMetaStars(next.metaSkills) > totalStars(next)) {
      next = { ...next, metaSkills: resetAllRanks() };
    }
    // Re-run checks so progress-only achievements (campaign, perfect_run)
    // unlock when stars cross their thresholds via this debug path.
    const res = checkAchievements(next, s.world, null);
    persistProgress(s.activeSlot, res.progress);
    const newToasts = res.unlocked.map((id) => ({ id, key: nextToastKey++ }));
    set({
      progress: res.progress,
      achievementToasts: [...s.achievementToasts, ...newToasts],
    });
  },

  debugLoadSuggestedBuild: (trace) => {
    const s = get();
    const loadout = deriveSuggestedDebugLoadout(trace);
    const variant = loadout.activeRobot;
    const progress: ProgressData = {
      ...s.progress,
      metaSkills: loadout.metaSkills,
      activeRobot: variant,
      robotUnlocks: { ...s.progress.robotUnlocks, ...loadout.robotUnlocks },
      robotXp: { ...s.progress.robotXp, ...loadout.robotXp },
      robotSkills: { ...s.progress.robotSkills, ...loadout.robotSkills },
      bolts: Math.max(s.progress.bolts, ROBOT_SPECS[variant].unlockBolts),
    };
    persistProgress(s.activeSlot, progress);
    if (s.screen === "playing") applyRobotVariantToWorld(s.world, variant, progress);
    set({
      progress,
      ui: snapshot(s.world, s.towerVersion, s.treeVersion, s.inspectedEnemy),
    });
  },

  debugUnlockThroughLevel: (levelId) => {
    const s = get();
    const next: ProgressData = {
      ...s.progress,
      starsByLevel: { ...s.progress.starsByLevel },
    };
    for (const level of LEVELS) {
      if (level.id > levelId) continue;
      const prev = s.progress.starsByLevel[level.id];
      next.starsByLevel[level.id] = {
        normal: 3,
        breach: prev?.breach ?? 0,
        containment: prev?.containment ?? 0,
      };
    }
    const res = checkAchievements(next, s.world, null);
    persistProgress(s.activeSlot, res.progress);
    const newToasts = res.unlocked.map((id) => ({ id, key: nextToastKey++ }));
    set({
      progress: res.progress,
      achievementToasts: [...s.achievementToasts, ...newToasts],
    });
  },

  debugLockFromLevel: (levelId) => {
    const s = get();
    const firstStarLevelToClear = Math.max(1, Math.floor(levelId) - 1);
    const nextStarsByLevel = { ...s.progress.starsByLevel };
    for (const level of LEVELS) {
      if (level.id >= firstStarLevelToClear) delete nextStarsByLevel[level.id];
    }
    const next: ProgressData = {
      ...s.progress,
      starsByLevel: nextStarsByLevel,
      metaSkills: resetAllRanks(),
    };
    persistProgress(s.activeSlot, next);
    set({ progress: next });
  },

  debugResetProgress: () => {
    const s = get();
    const empty = emptyProgress();
    persistProgress(s.activeSlot, empty);
    set({ progress: empty, achievementToasts: [] });
  },
}));

// ── HMR state preservation ──────────────────────────────────────────
// When Vite re-evaluates this module the `create()` above builds a
// fresh store, wiping all game state. We stash the previous store on
// globalThis so the new module picks up the old state — this works
// regardless of whether the module self-accepts or the update bubbles
// to React Fast Refresh consumers.
const HMR_STORE_KEY = "__EP_GAME_STORE__" as const;
type HMRGlobal = typeof globalThis & { [K in typeof HMR_STORE_KEY]?: typeof useGame };

if (import.meta.hot) {
  const prev = (globalThis as HMRGlobal)[HMR_STORE_KEY];
  if (prev) {
    const old = prev.getState();
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(old)) {
      if (typeof v === "function") continue;
      data[k] = v;
    }
    data.eventListeners = [];
    data.engine = new Engine();
    useGame.setState(data);
  }
  (globalThis as HMRGlobal)[HMR_STORE_KEY] = useGame;
}
