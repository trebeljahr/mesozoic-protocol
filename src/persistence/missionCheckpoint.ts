import type { Difficulty } from "../progress";
import type { World } from "../sim/types";
import { matchesWorldSchema } from "./checkpointValidation";

export type MissionCheckpoint = {
  version: 1;
  savedAt: number;
  difficulty: Difficulty;
  minDifficulty: Difficulty;
  world: string;
};

const excluded = new WeakSet<World>();
/** Call before entering training. Exclusion follows this world, never the slot. */
export const excludeWorldFromPersistence = (world: World) => {
  excluded.add(world);
};
export const canPersistWorld = (world: World) =>
  world.sessionKind !== "tutorial" && !excluded.has(world);

// Keep Maps, Sets and infinite ability deadlines intact. Entity lookup maps
// are rebuilt on restore so their entries share identity with the arrays.
const replacer = (_key: string, value: unknown): unknown => {
  if (value instanceof Map) return { $map: [...value] };
  if (value instanceof Set) return { $set: [...value] };
  if (value === Infinity) return { $infinity: 1 };
  if (value === -Infinity) return { $infinity: -1 };
  return value;
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const vector = (v: unknown) => record(v) && finite(v.x) && finite(v.y);
const numbered = (v: unknown, keys: string[]) => record(v) && keys.every((key) => finite(v[key]));
const strings = (v: unknown, choices: string[]) => typeof v === "string" && choices.includes(v);
const towers = ["pulse", "chain", "cryo", "mortar", "flame", "hive"];
const robots = ["george", "leela", "mike", "stan"];
const difficulties = ["easy", "medium", "hard", "extinction"];

const reviver = (key: string, value: unknown): unknown => {
  if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Unsafe key");
  if (!record(value)) return value;
  if ("$map" in value) {
    if (
      Object.keys(value).length !== 1 ||
      !Array.isArray(value.$map) ||
      !value.$map.every((entry) => Array.isArray(entry) && entry.length === 2)
    )
      throw new Error("Invalid map");
    return new Map(value.$map as [unknown, unknown][]);
  }
  if ("$set" in value) {
    if (Object.keys(value).length !== 1 || !Array.isArray(value.$set))
      throw new Error("Invalid set");
    return new Set(value.$set);
  }
  if ("$infinity" in value) {
    if (Object.keys(value).length !== 1 || ![1, -1].includes(value.$infinity as number))
      throw new Error("Invalid deadline");
    return value.$infinity === 1 ? Infinity : -Infinity;
  }
  return value;
};

// This format deliberately accepts only quiet between-wave worlds. Combat
// objects have much wider union schemas; keeping them out makes recovery
// independent of transient enemy/projectile/render state.
const validWorld = (w: unknown): w is World => {
  if (!matchesWorldSchema(w)) return false;
  // The optional schema field keeps pre-training checkpoints compatible, but
  // training payloads must never be accepted as resumable campaign missions.
  if ((w as World).sessionKind === "tutorial") return false;
  if (
    !record(w) ||
    !numbered(w, [
      "time",
      "tickCount",
      "levelId",
      "wave",
      "totalWaves",
      "nextWaveIn",
      "gold",
      "lives",
      "startLives",
      "nextEntityId",
      "speedMul",
      "goldKillMul",
      "bossTrickleIntervalMul",
      "waveTotalEnemies",
      "midwaveTimer",
      "midwaveTimerMax",
      "winHoldTimer",
      "proceduralSeed",
    ])
  )
    return false;
  if (
    !Number.isInteger(w.wave) ||
    (w.wave as number) < 0 ||
    (w.lives as number) <= 0 ||
    (w.gold as number) < 0 ||
    w.waveActive !== false
  )
    return false;
  if (
    !strings(w.status, ["running", "paused"]) ||
    !strings(w.mode, ["normal", "breach", "containment"]) ||
    !strings(w.biome, ["forest", "desert", "snow", "wasteland", "lava", "alien"])
  )
    return false;
  for (const key of ["enemies", "spawnQueue", "bossTrickleStreams", "projectiles", "events"]) {
    if (!Array.isArray(w[key]) || w[key].length !== 0) return false;
  }
  for (const key of [
    "trees",
    "rocks",
    "outposts",
    "props",
    "rivers",
    "lakes",
    "autoBridges",
    "beams",
    "explosions",
    "cryoWaves",
    "coalEmbers",
    "robotCraters",
    "particles",
    "puffs",
    "easterEggs",
    "easterEggSchedule",
    "authoredEasterEggs",
    "plannedWaves",
    "pathRibbonStart",
  ]) {
    if (!Array.isArray(w[key])) return false;
  }
  if (
    !Array.isArray(w.paths) ||
    w.paths.length === 0 ||
    !w.paths.every((p) => Array.isArray(p) && p.length >= 2 && p.every(vector))
  )
    return false;
  if (!Array.isArray(w.towers) || w.towers.length > 48) return false;
  const ids = new Set<number>();
  for (const t of w.towers) {
    if (
      !record(t) ||
      !numbered(t, [
        "id",
        "range",
        "damage",
        "fireRate",
        "cooldown",
        "totalSpent",
        "kills",
        "damageDealt",
        "droneCount",
        "serviceBuff",
      ]) ||
      !strings(t.kind, towers) ||
      !vector(t.pos) ||
      !numbered(t.upgrades, ["a", "b"]) ||
      !strings(t.targetingMode, [
        "tower",
        "end",
        "start",
        "strongest",
        "weakest",
        "vulnerable",
        "spot",
      ]) ||
      !Array.isArray(t.droneAssignments) ||
      !t.droneAssignments.every((id) => id === null || finite(id))
    )
      return false;
    if (ids.has(t.id as number)) return false;
    ids.add(t.id as number);
  }
  if (
    !record(w.robot) ||
    !strings(w.robot.variant, robots) ||
    !vector(w.robot.pos) ||
    !vector(w.robot.vel) ||
    !numbered(w.robot, [
      "id",
      "hp",
      "maxHp",
      "xp",
      "level",
      "kills",
      "damageDealt",
      "attackCooldown",
    ]) ||
    !(w.robot.respawnAt === null || finite(w.robot.respawnAt)) ||
    !Array.isArray(w.robot.abilityReadyAt) ||
    w.robot.abilityReadyAt.length !== 4 ||
    !w.robot.abilityReadyAt.every(finite) ||
    !Array.isArray(w.robot.abilityActiveUntil) ||
    !Array.isArray(w.robot.pendingShots)
  )
    return false;
  if (
    !numbered(w.base, ["damage", "fireRate", "range", "totalSpent", "kills", "damageDealt"]) ||
    !record(w.base) ||
    !numbered(w.base.upgrades, ["a", "b"]) ||
    !Array.isArray(w.base.cooldowns) ||
    !Array.isArray(w.base.targetIds)
  )
    return false;
  if (
    !(w.forbiddenTowers instanceof Set) ||
    !(w.erasedProcedural instanceof Set) ||
    !record(w.adaptation) ||
    !(w.adaptation.perWave instanceof Map)
  )
    return false;
  if (
    !record(w.runEnemyKinds) ||
    !record(w.runTowerKinds) ||
    !numbered(w.shake, ["magnitude", "decay"])
  )
    return false;
  if (
    w.endless !== null &&
    (!record(w.endless) ||
      !numbered(w.endless, ["seed", "hpMul", "baseSpeedMul", "bestWave"]) ||
      typeof w.endless.mapId !== "string" ||
      typeof w.endless.mapName !== "string")
  )
    return false;
  return true;
};

export const isBetweenWaves = (world: World) =>
  canPersistWorld(world) &&
  (world.status === "running" || world.status === "paused") &&
  !world.waveActive &&
  world.enemies.length === 0 &&
  world.spawnQueue.length === 0 &&
  world.bossTrickleStreams.length === 0 &&
  world.projectiles.length === 0;

export const captureCheckpoint = (
  world: World,
  difficulty: Difficulty,
  minDifficulty: Difficulty,
): MissionCheckpoint | null => {
  if (!isBetweenWaves(world)) return null;
  return {
    version: 1,
    savedAt: Date.now(),
    difficulty,
    minDifficulty,
    world: JSON.stringify(
      { ...world, events: [], enemyById: new Map(), towerById: new Map() },
      replacer,
    ),
  };
};

export const restoreCheckpoint = (checkpoint: MissionCheckpoint): World => {
  const world: unknown = JSON.parse(checkpoint.world, reviver);
  if (!validWorld(world)) throw new Error("Invalid mission checkpoint");
  world.enemyById = new Map();
  world.towerById = new Map(world.towers.map((t) => [t.id, t]));
  world.status = "paused";
  world.selectedTowerId = null;
  world.selectedBase = false;
  world.robot.selected = false;
  return world;
};

export const isMissionCheckpoint = (value: unknown): value is MissionCheckpoint => {
  if (
    !record(value) ||
    value.version !== 1 ||
    !finite(value.savedAt) ||
    !strings(value.difficulty, difficulties) ||
    !strings(value.minDifficulty, difficulties) ||
    typeof value.world !== "string" ||
    value.world.length > 8_000_000
  )
    return false;
  try {
    restoreCheckpoint(value as MissionCheckpoint);
    return true;
  } catch {
    return false;
  }
};
