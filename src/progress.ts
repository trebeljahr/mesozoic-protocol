import { isLevelBeyondDemo } from "./demo";
import enModes from "./locales/en/modes.json";
import { isMissionCheckpoint, type MissionCheckpoint } from "./persistence/missionCheckpoint";
import { clearSaveIssue, migrateStorageKey, reportSaveIssue } from "./persistence/storageHealth";
import { type AllMetaSkills, migrateLegacyMetaSkills } from "./sim/metaSkills";
import type { AllRobotSkills } from "./sim/robotSkills";
import type { BossVariant, EnemyKind, RobotVariant } from "./sim/types";

const withLocalStorage = <T>(fn: (ls: Storage) => T, fallback: T): T => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return fallback;
    return fn(window.localStorage);
  } catch {
    return fallback;
  }
};

export type Stars = 0 | 1 | 2 | 3;
export type SlotId = 1 | 2 | 3;

// Per-level mode: orthogonal to Difficulty. Normal is the base 3-star
// campaign; Breach + Containment are challenge variants with handcrafted
// waves and rules. Each adds one bonus star per level on top of normal's
// three (max 5 stars per level).
export type LevelMode = "normal" | "breach" | "containment";

export const LEVEL_MODES: LevelMode[] = ["normal", "breach", "containment"];

// English label/tagline source is the en i18n catalog (src/locales/en/
// modes.json). Localized pickers read the same keys via react-i18next; these
// Records remain the canonical English values for non-localized lookups.
export const LEVEL_MODE_LABEL: Record<LevelMode, string> = enModes.mode.label;

export const LEVEL_MODE_TAGLINE: Record<LevelMode, string> = enModes.mode.tagline;

// Per-level mode-star record. Normal still grades 0-3 from lives saved;
// breach + containment are binary (clear = 1 bonus star). Sum across all
// modes gives a single level's contribution to totalStars (max 5).
export type ModeStars = {
  normal: Stars;
  breach: 0 | 1;
  containment: 0 | 1;
};

export const emptyModeStars = (): ModeStars => ({ normal: 0, breach: 0, containment: 0 });

export type ProgressStats = {
  killsTotal: number;
  winsTotal: number;
};

export type Difficulty = "easy" | "medium" | "hard" | "extinction";

export type DifficultyMultipliers = {
  hp: number;
  startGold: number;
  goldKill: number;
  speed: number;
  // Scales the gap between boss-wave trickle spawns. <1 = denser drip
  // (harder); >1 = sparser drip (easier). The trickle gives the player
  // gold-generating targets while the matriarch lumbers in.
  bossTrickleIntervalMul: number;
  // HP escalation across a level, indexed by the wave's POSITION: the first
  // wave is unchanged and the final wave gets (1 + lateWaveHpRamp)× HP, with
  // waves in between interpolated linearly (see lateWaveHpFactor in
  // world.ts). 0 = flat HP across the level (legacy behaviour). The flat
  // curve let a fully-upgraded board trivialize the back half of every level
  // — accumulated gold outpaced the static roster, so feasibility ballooned
  // from ~4× on wave 1 to 20–40× by wave 10. This ramp keeps the late waves
  // threatening without turning early waves into sponges. Position-relative
  // so long late-campaign levels (20 waves) don't get over-tanked mid-list.
  // Currently non-zero only on extinction (the tier this targets); 0
  // elsewhere preserves existing balance and the fresh-save clear guarantee.
  lateWaveHpRamp: number;
};

export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard", "extinction"];

export const DIFFICULTY_MULTIPLIERS: Record<Difficulty, DifficultyMultipliers> = {
  easy: {
    hp: 0.7,
    startGold: 1.3,
    goldKill: 1.2,
    speed: 1.0,
    bossTrickleIntervalMul: 1.5,
    lateWaveHpRamp: 0,
  },
  medium: {
    hp: 1.0,
    startGold: 1.0,
    goldKill: 1.0,
    speed: 1.0,
    bossTrickleIntervalMul: 1.15,
    lateWaveHpRamp: 0,
  },
  hard: {
    hp: 1.4,
    startGold: 0.9,
    goldKill: 0.95,
    speed: 1.0,
    bossTrickleIntervalMul: 0.85,
    lateWaveHpRamp: 0,
  },
  extinction: {
    hp: 1.8,
    startGold: 0.8,
    goldKill: 0.7,
    speed: 1.2,
    bossTrickleIntervalMul: 0.7,
    lateWaveHpRamp: 1.0,
  },
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = enModes.difficulty.label;

export const DIFFICULTY_TAGLINE: Record<Difficulty, string> = enModes.difficulty.tagline;

// Single source of truth for the per-difficulty accent palette so every
// surface that surfaces difficulty (world map, HUD, picker) reads from
// the same hue. Class fragments map to Tailwind utility classes whose
// underlying CSS variables live in src/index.css.
export type DifficultyAccent = {
  text: string;
  border: string;
  tint: string;
};

export const DIFFICULTY_ACCENT: Record<Difficulty, DifficultyAccent> = {
  easy: { text: "text-mint", border: "border-mint", tint: "bg-tint-green" },
  medium: { text: "text-blue", border: "border-blue", tint: "bg-tint-blue" },
  hard: { text: "text-orange", border: "border-orange", tint: "bg-[rgba(255,178,102,0.12)]" },
  extinction: { text: "text-red", border: "border-red", tint: "bg-tint-red" },
};

export const DEFAULT_DIFFICULTY: Difficulty = "medium";

// v2 added mode-stars (breach + containment, originally named heroic +
// iron). v1 saves auto-migrate: the old per-level number becomes
// ModeStars.normal with breach + containment zeroed. v3 renamed the
// in-memory hero fields to robot (activeHero → activeRobot etc.).
// normalizeProgress accepts the legacy keys as fallback so v2 saves load
// without wiping unlocked robots / XP / skill trees. v4 renamed the
// challenge modes from heroic/iron to breach/containment; normalizeModeStars
// copies the legacy keys into the new slots, and unlocked-achievement IDs
// `heroic_effort` / `iron_will` are rewritten to `breach_holdout` /
// `containment_holdout` so prior earners keep their badges.
// v5 makes Leela the starter; existing saves retain their free George unlock.
export const PROGRESS_VERSION = 5 as const;

export type ProgressData = {
  version: 5;
  starsByLevel: Record<number, ModeStars>;
  encountered: Partial<Record<EnemyKind, boolean>>;
  // Per-variant matriarch encounter set. The Compendium's matriarch
  // entries unlock as the player first sees each biome's queen. Legacy
  // saves with `encountered.boss === true` get auto-migrated to mark
  // all six variants as encountered (see normalizeProgress below).
  matriarchsEncountered: Partial<Record<BossVariant, boolean>>;
  stats: ProgressStats;
  unlocked: Record<string, number>;
  difficulty: Difficulty;
  seenIntros?: Record<number, true>;
  // Meta-skill ranks per tower kind. Each rank costs 1 star and is
  // applied at tower creation. Total invested stars + freed stars must
  // not exceed totalStars(progress) — enforced at the store layer.
  metaSkills: AllMetaSkills;
  // Active robot variant — drives robotDefaults at every level start.
  // New saves start with Leela; existing explicit selections are preserved.
  activeRobot: RobotVariant;
  // Permanent unlock map. Leela is implicitly unlocked even when
  // missing from the map; the others must be purchased from the robot
  // shop with dropped metal bolts.
  robotUnlocks: Partial<Record<RobotVariant, boolean>>;
  // Per-robot XP — accrues from kills, never decays. Level + available
  // skill points derive from this.
  robotXp: Partial<Record<RobotVariant, number>>;
  // Per-robot skill tree ranks. Shape mirrors AllMetaSkills. XP grants
  // skill points; dropped metal bolts pay the rank costs.
  robotSkills: AllRobotSkills;
  // Scrap bolts and nuts dropped by dinosaurs. Bolts are the currency
  // for robot unlocks and robot skill ranks; kills before a failed wave
  // still persist their drops so grinding works.
  bolts: number;
  // Persistent per-(levelId, eggId) one-shot guard. Once an egg fires on
  // a given map it never spawns there again, even before the achievement
  // unlocks globally. Keyed `${levelId}:${eggId}`.
  triggeredEasterEggs: Record<string, true>;
  // One-shot flag for the "you unlocked Breach + Containment modes"
  // world-map explainer. Breach + Containment are gated per-level by a
  // normal 3-star clear, but the explanation only needs to surface the
  // first time the player crosses that gate on any level.
  seenModesUnlockExplainer?: true;
  // Best wave reached per endless arena + difficulty. Key is
  // `${mapId}:${difficulty}` (see endlessBestKey). Local-only; there is
  // no online/Steam leaderboard. Persists across reloads like the rest of
  // ProgressData.
  endlessBest?: Record<string, number>;
  // One-shot flag for the "Endless mode unlocked" world-map reveal. Set
  // once the player dismisses the explainer after clearing the final
  // campaign level. Mirrors seenModesUnlockExplainer.
  seenEndlessUnlockExplainer?: true;
};

export type SlotMeta = {
  name: string;
  lastPlayed: number;
};

export type SlotInfo = {
  id: SlotId;
  exists: boolean;
  meta: SlotMeta;
  progress: ProgressData;
  levelsCleared: number;
  totalStars: number;
  health: "empty" | "ready" | "corrupt" | "unavailable";
  recoverable: boolean;
  checkpoint: MissionCheckpoint | null;
};

export const SLOT_IDS: readonly SlotId[] = [1, 2, 3] as const;

export const slotKey = (id: SlotId) => `mesozoic-protocol:slot:${id}:v1`;
export const backupKey = (id: SlotId) => `${slotKey(id)}:backup`;
const slotRevisions = new Map<SlotId, number>();
export const getSlotRevision = (id: SlotId) => slotRevisions.get(id) ?? 0;
const invalidateSlotSession = (id: SlotId) => slotRevisions.set(id, getSlotRevision(id) + 1);
const LEGACY_KEY = "mesozoic-protocol:progress:v1";
const STARTING_LIVES = 20;
const NAME_MAX_LEN = 24;

const emptyStats = (): ProgressStats => ({ killsTotal: 0, winsTotal: 0 });

export const emptyProgress = (): ProgressData => ({
  version: PROGRESS_VERSION,
  starsByLevel: {},
  encountered: {},
  matriarchsEncountered: {},
  stats: emptyStats(),
  unlocked: {},
  difficulty: DEFAULT_DIFFICULTY,
  seenIntros: {},
  metaSkills: {},
  activeRobot: "leela",
  robotUnlocks: { leela: true },
  robotXp: {},
  robotSkills: {},
  bolts: 0,
  triggeredEasterEggs: {},
  endlessBest: {},
});

const defaultName = (id: SlotId) => `Save ${id}`;

const isDifficulty = (v: unknown): v is Difficulty =>
  typeof v === "string" && (DIFFICULTIES as readonly string[]).includes(v);

const isProgressLike = (parsed: unknown): parsed is Partial<ProgressData> => {
  if (typeof parsed !== "object" || parsed === null) return false;
  const v = (parsed as { version?: unknown }).version;
  if (v !== 1 && v !== 2 && v !== 3 && v !== 4 && v !== 5) return false;
  return isRecord((parsed as { starsByLevel?: unknown }).starsByLevel);
};

// Normalize a per-level entry from any historical shape into ModeStars.
// v1 saves stored a bare 0|1|2|3 number per level; v2 stores ModeStars.
// v4 renamed the challenge-mode keys from heroic/iron to breach/containment;
// fall back to the legacy keys so prior earners keep their bonus stars.
const normalizeModeStars = (raw: unknown): ModeStars => {
  if (typeof raw === "number") {
    const n = (Math.max(0, Math.min(3, Math.floor(raw))) | 0) as Stars;
    return { normal: n, breach: 0, containment: 0 };
  }
  if (raw && typeof raw === "object") {
    const o = raw as Partial<ModeStars> & { heroic?: 0 | 1; iron?: 0 | 1 };
    const normal = (Math.max(0, Math.min(3, Math.floor(Number(o.normal ?? 0)))) | 0) as Stars;
    const breachRaw = o.breach ?? o.heroic;
    const containmentRaw = o.containment ?? o.iron;
    const breach = (breachRaw === 1 ? 1 : 0) as 0 | 1;
    const containment = (containmentRaw === 1 ? 1 : 0) as 0 | 1;
    return { normal, breach, containment };
  }
  return emptyModeStars();
};

const normalizeStarsMap = (raw: unknown): Record<number, ModeStars> => {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<number, ModeStars> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    const m = normalizeModeStars(v);
    if (m.normal === 0 && m.breach === 0 && m.containment === 0) continue;
    out[id] = m;
  }
  return out;
};

// Endless best-wave records: a flat `${mapId}:${difficulty}` → wave map.
// Drop any non-finite / negative entries so a corrupt save can't surface
// a bogus best.
const normalizeEndlessBest = (raw: unknown): Record<string, number> => {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = Math.floor(v);
  }
  return out;
};

const pickActiveRobot = (raw: Partial<ProgressData>): RobotVariant => {
  const candidate = raw.activeRobot ?? (raw as { activeHero?: RobotVariant }).activeHero ?? "leela";
  return candidate === "leela" ||
    candidate === "mike" ||
    candidate === "stan" ||
    candidate === "george"
    ? candidate
    : "leela";
};

const pickRecord = <K extends string, V>(
  next: Partial<Record<K, V>> | undefined,
  legacy: Partial<Record<K, V>> | undefined,
): Partial<Record<K, V>> => {
  const src =
    next && typeof next === "object" ? next : legacy && typeof legacy === "object" ? legacy : null;
  return src ?? {};
};

// v3 → v4 migration for unlocked achievements: the challenge-mode
// achievement IDs were renamed when Heroic / Iron became Breach /
// Containment. Rewrite the legacy IDs so prior earners keep their badges;
// if both old and new are present (impossible in practice but defensive)
// the newer entry wins.
const LEGACY_ACH_ID_MAP: Record<string, string> = {
  heroic_effort: "breach_holdout",
  iron_will: "containment_holdout",
};

const migrateUnlocked = (raw: unknown): Record<string, number> => {
  if (!raw || typeof raw !== "object") return {};
  const src = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v !== "number") continue;
    const target = LEGACY_ACH_ID_MAP[k] ?? k;
    // Prefer the explicit new-id timestamp if both forms coexist.
    if (out[target] === undefined) out[target] = v;
  }
  return out;
};

const normalizeProgress = (raw: Partial<ProgressData>): ProgressData => {
  const stats = raw.stats as Partial<ProgressStats> | undefined;
  const encountered = (raw.encountered as Partial<Record<EnemyKind, boolean>>) ?? {};
  // Legacy migration: pre-variant saves only know `encountered.boss`.
  // Any save with the apex boss seen has, by definition, also cleared
  // L5–L30, so all six variants count as encountered. New saves track
  // each variant individually via the store's per-tick mark below.
  const rawMatriarchs = (raw.matriarchsEncountered as Partial<Record<BossVariant, boolean>>) ?? {};
  const matriarchsEncountered: Partial<Record<BossVariant, boolean>> =
    Object.keys(rawMatriarchs).length === 0 && encountered.boss === true
      ? { raptor: true, stego: true, para: true, allosaur: true, armored: true, apex: true }
      : rawMatriarchs;
  return {
    version: PROGRESS_VERSION,
    starsByLevel: normalizeStarsMap(raw.starsByLevel),
    encountered,
    matriarchsEncountered,
    stats: {
      killsTotal: typeof stats?.killsTotal === "number" ? stats.killsTotal : 0,
      winsTotal: typeof stats?.winsTotal === "number" ? stats.winsTotal : 0,
    },
    unlocked: migrateUnlocked(raw.unlocked),
    difficulty: isDifficulty(raw.difficulty) ? raw.difficulty : DEFAULT_DIFFICULTY,
    seenIntros:
      raw.seenIntros && typeof raw.seenIntros === "object"
        ? (raw.seenIntros as Record<number, true>)
        : {},
    metaSkills: migrateLegacyMetaSkills(raw.metaSkills),
    // v2 → v3 migration: pre-rename saves stored these as activeHero /
    // heroUnlocks / heroXp / heroSkills. Fall back to the legacy keys so
    // an existing save keeps its unlocked robots, XP totals, and skill
    // tree ranks after the rename.
    activeRobot: pickActiveRobot(raw),
    robotUnlocks: {
      // Preserve the former starter for saves created before the roster change.
      ...((raw.version ?? 0) < 5 ? { george: true } : {}),
      ...((raw.robotUnlocks ??
        (raw as { heroUnlocks?: Partial<Record<RobotVariant, boolean>> }).heroUnlocks ??
        {}) as Partial<Record<RobotVariant, boolean>>),
      leela: true,
    },
    robotXp: pickRecord<RobotVariant, number>(
      raw.robotXp,
      (raw as { heroXp?: Partial<Record<RobotVariant, number>> }).heroXp,
    ),
    robotSkills: (raw.robotSkills ??
      (raw as { heroSkills?: AllRobotSkills }).heroSkills ??
      {}) as AllRobotSkills,
    bolts:
      typeof raw.bolts === "number" && Number.isFinite(raw.bolts) ? Math.max(0, raw.bolts | 0) : 0,
    triggeredEasterEggs:
      raw.triggeredEasterEggs && typeof raw.triggeredEasterEggs === "object"
        ? (raw.triggeredEasterEggs as Record<string, true>)
        : {},
    seenModesUnlockExplainer: raw.seenModesUnlockExplainer === true ? true : undefined,
    endlessBest: normalizeEndlessBest(raw.endlessBest),
    seenEndlessUnlockExplainer: raw.seenEndlessUnlockExplainer === true ? true : undefined,
  };
};

export type SlotPayload = {
  meta: SlotMeta;
  progress: ProgressData;
  checkpoint: MissionCheckpoint | null;
};
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const safeNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const safeTree = (value: unknown, depth = 0): boolean => {
  if (depth > 40) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every((v) => safeTree(v, depth + 1));
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([k, v]) => !["__proto__", "constructor", "prototype"].includes(k) && safeTree(v, depth + 1),
    )
  );
};

// Historical versions may omit fields, but provided fields must have the
// right shape. Normalization is migration, not a license to erase corruption.
const validProgress = (raw: unknown): raw is Partial<ProgressData> => {
  if (!isProgressLike(raw) || !safeTree(raw)) return false;
  const p = raw as Record<string, unknown>;
  for (const key of [
    "stats",
    "encountered",
    "matriarchsEncountered",
    "unlocked",
    "seenIntros",
    "metaSkills",
    "robotUnlocks",
    "heroUnlocks",
    "robotXp",
    "heroXp",
    "robotSkills",
    "heroSkills",
    "triggeredEasterEggs",
    "endlessBest",
  ]) {
    if (p[key] !== undefined && !isRecord(p[key])) return false;
  }
  for (const key of ["robotXp", "heroXp", "stats", "unlocked", "endlessBest"]) {
    if (isRecord(p[key]) && !Object.values(p[key]).every(safeNumber)) return false;
  }
  for (const key of [
    "encountered",
    "matriarchsEncountered",
    "robotUnlocks",
    "heroUnlocks",
    "seenIntros",
    "triggeredEasterEggs",
  ]) {
    if (isRecord(p[key]) && !Object.values(p[key]).every((v) => typeof v === "boolean"))
      return false;
  }
  for (const key of ["robotSkills", "heroSkills", "metaSkills"]) {
    if (
      isRecord(p[key]) &&
      !Object.values(p[key]).every((v) => isRecord(v) && Object.values(v).every(safeNumber))
    )
      return false;
  }
  if (p.bolts !== undefined && !safeNumber(p.bolts)) return false;
  return Object.values(p.starsByLevel as Record<string, unknown>).every(
    (v) => safeNumber(v) || (isRecord(v) && Object.values(v).every(safeNumber)),
  );
};

export const parseSlotPayload = (raw: string, id: SlotId = 1): SlotPayload => {
  if (raw.length > 10_000_000) throw new Error("Save too large");
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || !validProgress(parsed.progress) || !safeTree(parsed))
    throw new Error("Invalid save schema");
  if (parsed.checkpoint != null && !isMissionCheckpoint(parsed.checkpoint))
    throw new Error("Invalid checkpoint");
  const meta = isRecord(parsed.meta) ? parsed.meta : {};
  return {
    meta: {
      name:
        typeof meta.name === "string" && meta.name.trim()
          ? meta.name.slice(0, NAME_MAX_LEN)
          : defaultName(id),
      lastPlayed: safeNumber(meta.lastPlayed) ? (meta.lastPlayed as number) : 0,
    },
    progress: normalizeProgress(parsed.progress),
    checkpoint: (parsed.checkpoint as MissionCheckpoint | null | undefined) ?? null,
  };
};

type SlotRead = { health: SlotInfo["health"]; payload: SlotPayload | null; raw: string | null };
const DELETED_SLOT = '{"deleted":true}';
const readSlot = (id: SlotId): SlotRead => {
  try {
    if (typeof window === "undefined") return { health: "empty", payload: null, raw: null };
    const raw = window.localStorage.getItem(slotKey(id));
    if (raw === null) {
      const pending =
        window.localStorage.getItem(`extinction-protocol:slot:${id}:v1`) ??
        (id === 1
          ? (window.localStorage.getItem(LEGACY_KEY) ??
            window.localStorage.getItem("extinction-protocol:progress:v1"))
          : null);
      if (pending !== null) return { health: "unavailable", payload: null, raw: pending };
    }
    if (raw === null || raw === DELETED_SLOT) return { health: "empty", payload: null, raw };
    try {
      return { health: "ready", payload: parseSlotPayload(raw, id), raw };
    } catch {
      return { health: "corrupt", payload: null, raw };
    }
  } catch {
    reportSaveIssue({ key: slotKey(id), reason: "read" }, () => {
      if (readSlot(id).health === "unavailable") return false;
      clearSaveIssue(slotKey(id));
      return true;
    });
    return { health: "unavailable", payload: null, raw: null };
  }
};

const writeSlotRaw = (
  id: SlotId,
  payload: SlotPayload,
  replaceCorrupt = false,
  onSuccess?: () => void,
): boolean => {
  const key = slotKey(id);
  const attempt = (): boolean => {
    try {
      const ls = window.localStorage;
      const stored = ls.getItem(key);
      const old = stored === DELETED_SLOT ? null : stored;
      if (old !== null) {
        try {
          parseSlotPayload(old, id);
        } catch {
          if (!replaceCorrupt) {
            reportSaveIssue({ key, reason: "corrupt" });
            return false;
          }
        }
      }
      const next = JSON.stringify(payload);
      parseSlotPayload(next, id);
      // Archive an unreadable source before deliberate recovery/import.
      if (old !== null && replaceCorrupt) {
        const archiveKey = `${key}:recovered:${Date.now()}`;
        ls.setItem(archiveKey, old);
        if (ls.getItem(archiveKey) !== old) throw new Error("Archive verification failed");
      }
      // Keep the last verified state. Backup failure blocks the primary write.
      const backup = old ?? next;
      if (!replaceCorrupt) {
        ls.setItem(backupKey(id), backup);
        if (ls.getItem(backupKey(id)) !== backup) throw new Error("Backup verification failed");
      }
      ls.setItem(key, next);
      if (ls.getItem(key) !== next) throw new Error("Save verification failed");
      clearSaveIssue(key);
      onSuccess?.();
      return true;
    } catch {
      reportSaveIssue({ key, reason: "write" }, attempt);
      return false;
    }
  };
  return attempt();
};

const ensureMigrated = () => {
  withLocalStorage<void>((ls) => {
    for (const id of SLOT_IDS)
      migrateStorageKey(ls, `extinction-protocol:slot:${id}:v1`, slotKey(id));
    migrateStorageKey(ls, "extinction-protocol:progress:v1", LEGACY_KEY);
    const legacy = ls.getItem(LEGACY_KEY);
    if (legacy === null || ls.getItem(slotKey(1)) !== null) return;
    try {
      const parsed: unknown = JSON.parse(legacy);
      if (!validProgress(parsed)) {
        // Surface unreadable pre-slot data as occupied, while retaining the
        // untouched legacy source for export/recovery.
        ls.setItem(slotKey(1), legacy);
        return;
      }
      if (
        writeSlotRaw(1, {
          meta: { name: defaultName(1), lastPlayed: Date.now() },
          progress: normalizeProgress(parsed),
          checkpoint: null,
        })
      )
        ls.removeItem(LEGACY_KEY);
    } catch {
      try {
        if (ls.getItem(slotKey(1)) === null) ls.setItem(slotKey(1), legacy);
      } catch {
        reportSaveIssue({ key: slotKey(1), reason: "write" }, () => {
          ensureMigrated();
          return readSlot(1).health !== "empty";
        });
      }
    }
  }, undefined);
};

// Total stars summed across every level × every mode. Normal contributes
// 0-3, breach + containment contribute 0-1 each, so each level caps at 5.
export const totalStars = (p: ProgressData): number => {
  let sum = 0;
  for (const m of Object.values(p.starsByLevel)) sum += m.normal + m.breach + m.containment;
  return sum;
};

// A level counts as "cleared" once normal has at least one star — breach
// and containment can only be attempted after normal is fully starred, so
// they can't backfill this count.
const levelsClearedCount = (p: ProgressData): number => {
  let n = 0;
  for (const m of Object.values(p.starsByLevel)) if (m.normal > 0) n++;
  return n;
};

export const listSlots = (): SlotInfo[] => {
  ensureMigrated();
  return SLOT_IDS.map((id) => {
    const read = readSlot(id);
    const payload = read.payload;
    const recoverable = withLocalStorage((ls) => {
      try {
        parseSlotPayload(ls.getItem(backupKey(id)) ?? "", id);
        return read.health !== "empty";
      } catch {
        return false;
      }
    }, false);
    if (!payload) {
      return {
        id,
        exists: read.health !== "empty",
        health: read.health,
        recoverable,
        checkpoint: null,
        meta: { name: defaultName(id), lastPlayed: 0 },
        progress: emptyProgress(),
        levelsCleared: 0,
        totalStars: 0,
      };
    }
    return {
      id,
      exists: true,
      health: read.health,
      recoverable,
      checkpoint: payload.checkpoint,
      meta: payload.meta,
      progress: payload.progress,
      levelsCleared: levelsClearedCount(payload.progress),
      totalStars: totalStars(payload.progress),
    };
  });
};

export const loadSlot = (id: SlotId): SlotPayload => {
  ensureMigrated();
  const { payload, health } = readSlot(id);
  if (payload) return payload;
  if (health !== "empty") {
    reportSaveIssue({ key: slotKey(id), reason: health === "corrupt" ? "corrupt" : "read" });
    throw new Error(`Slot ${id} is ${health}`);
  }
  return {
    progress: emptyProgress(),
    meta: { name: defaultName(id), lastPlayed: 0 },
    checkpoint: null,
  };
};

export const saveSlot = (
  id: SlotId,
  progress: ProgressData,
  name?: string,
  checkpoint?: MissionCheckpoint | null,
): boolean => {
  const read = readSlot(id);
  if (read.health === "unavailable" && read.raw !== null) return false;
  const existing = read.payload;
  const nextName = name ?? existing?.meta.name ?? defaultName(id);
  return writeSlotRaw(id, {
    meta: { name: nextName, lastPlayed: Date.now() },
    progress,
    checkpoint: checkpoint === undefined ? (existing?.checkpoint ?? null) : checkpoint,
  });
};

export const deleteSlot = (id: SlotId): boolean => {
  const attempt = () => {
    try {
      // A durable tombstone prevents an old native mirror or legacy source
      // from bringing a deleted mission back after reload.
      window.localStorage.setItem(slotKey(id), DELETED_SLOT);
      if (window.localStorage.getItem(slotKey(id)) !== DELETED_SLOT)
        throw new Error("Delete failed");
      invalidateSlotSession(id);
      window.localStorage.removeItem(backupKey(id));
      clearSaveIssue(slotKey(id));
      return true;
    } catch {
      reportSaveIssue({ key: slotKey(id), reason: "write" }, attempt);
      return false;
    }
  };
  return attempt();
};

export const recoverSlot = (id: SlotId): boolean => {
  try {
    const payload = parseSlotPayload(window.localStorage.getItem(backupKey(id)) ?? "", id);
    // A last-good copy may predate a finished/abandoned mission. Recover
    // campaign progress only, so stale checkpoints can never replay rewards.
    return writeSlotRaw(id, { ...payload, checkpoint: null }, true, () =>
      invalidateSlotSession(id),
    );
  } catch {
    reportSaveIssue({ key: slotKey(id), reason: "corrupt" });
    return false;
  }
};

export const exportSlot = (id: SlotId): { filename: string; text: string } => {
  const read = readSlot(id);
  if (!read.raw || read.health === "empty") throw new Error("No save to export");
  const name = (read.payload?.meta.name ?? `damaged-slot-${id}`).replace(/[^a-zA-Z0-9_-]+/g, "-");
  return {
    filename: `mesozoic-protocol-slot-${id}-${name}-${new Date().toISOString().slice(0, 10)}.json`,
    text: read.payload
      ? JSON.stringify(
          { format: "mesozoic-protocol-save", version: 1, slot: read.payload },
          null,
          2,
        )
      : read.raw,
  };
};

export const parseSaveImport = (text: string): SlotPayload => {
  if (text.length > 10_000_000) throw new Error("Save too large");
  const value: unknown = JSON.parse(text);
  if (
    !isRecord(value) ||
    value.format !== "mesozoic-protocol-save" ||
    value.version !== 1 ||
    !isRecord(value.slot)
  )
    throw new Error("Invalid save export");
  return parseSlotPayload(JSON.stringify(value.slot));
};

export const importSlot = (id: SlotId, text: string, overwrite = false): boolean => {
  const payload = parseSaveImport(text);
  const read = readSlot(id);
  if (read.health !== "empty" && !overwrite) throw new Error("Destination occupied");
  if (read.health === "unavailable") return false;
  return writeSlotRaw(id, payload, read.health === "corrupt", () => invalidateSlotSession(id));
};

export const starsForLives = (lives: number): Stars => {
  if (lives >= STARTING_LIVES) return 3;
  if (lives >= 10) return 2;
  if (lives >= 1) return 1;
  return 0;
};

// Mode-aware star resolution from a finished run. Normal grades on lives;
// breach + containment are binary win/lose. Containment clears imply 0
// leaks because the run had one life — no extra logic needed.
export const starsForRun = (mode: LevelMode, lives: number, won: boolean): number => {
  if (!won) return 0;
  if (mode === "normal") return starsForLives(lives);
  return 1;
};

export const getModeStars = (p: ProgressData, levelId: number): ModeStars =>
  p.starsByLevel[levelId] ?? emptyModeStars();

// Back-compat: the campaign/world-map still cares only about normal-mode
// stars when gating progression. New mode-aware UI reads via getModeStars.
export const getStars = (p: ProgressData, levelId: number): Stars =>
  getModeStars(p, levelId).normal;

export const levelTotalStars = (p: ProgressData, levelId: number): number => {
  const m = getModeStars(p, levelId);
  return m.normal + m.breach + m.containment;
};

// True once the player has earned 3 normal-mode stars on any level —
// the moment Breach + Containment become available somewhere.
export const hasUnlockedChallengeModes = (p: ProgressData): boolean => {
  for (const m of Object.values(p.starsByLevel)) if (m.normal >= 3) return true;
  return false;
};

export const markModesUnlockExplainerSeen = (p: ProgressData): ProgressData =>
  p.seenModesUnlockExplainer ? p : { ...p, seenModesUnlockExplainer: true };

// Final campaign level. Clearing it on normal (≥1 star) is the gate for
// Endless mode. The level-unlock chain guarantees that clearing this
// level implies every prior level is cleared too, so it doubles as an
// "all campaign levels cleared" check. Hardcoded — the campaign is a
// fixed 30-level arc (see src/biomes.ts band comments).
export const ENDLESS_UNLOCK_LEVEL = 30;

// True once the player has cleared the final campaign level on normal —
// the moment Endless mode becomes available.
export const hasUnlockedEndless = (p: ProgressData): boolean =>
  getStars(p, ENDLESS_UNLOCK_LEVEL) >= 1;

export const markEndlessUnlockExplainerSeen = (p: ProgressData): ProgressData =>
  p.seenEndlessUnlockExplainer ? p : { ...p, seenEndlessUnlockExplainer: true };

const endlessBestKey = (mapId: string, difficulty: Difficulty): string => `${mapId}:${difficulty}`;

export const getEndlessBest = (p: ProgressData, mapId: string, difficulty: Difficulty): number =>
  p.endlessBest?.[endlessBestKey(mapId, difficulty)] ?? 0;

// Record a finished endless run's wave reached. Returns the same
// ProgressData reference when it didn't beat the existing best (lets the
// store skip a redundant persist), a new object when it did.
export const recordEndlessResult = (
  p: ProgressData,
  mapId: string,
  difficulty: Difficulty,
  waveReached: number,
): ProgressData => {
  const key = endlessBestKey(mapId, difficulty);
  const prev = p.endlessBest?.[key] ?? 0;
  if (waveReached <= prev) return p;
  return { ...p, endlessBest: { ...p.endlessBest, [key]: waveReached } };
};

export const isLevelUnlocked = (levelId: number, p: ProgressData): boolean => {
  // Demo build: the campaign stops at the five forest outposts. This single
  // chokepoint makes levels 6+ unreachable everywhere — world map nodes,
  // gamepad nav, startLevel, the results "next level" button, the mode picker.
  // Folds to a no-op in the default build (IS_DEMO === false).
  if (isLevelBeyondDemo(levelId)) return false;
  if (levelId <= 1) return true;
  return getStars(p, levelId - 1) >= 1;
};

// Mode availability gating on a level the player has already unlocked.
//   normal                      → as soon as the level itself is unlocked
//   breach + containment        → both unlock once normal is 3-starred
//                                 on this level
// Breach + containment are siblings (not a chain) so the player picks
// whichever challenge fits the mood, not whichever they grind to first.
export const isModeUnlocked = (p: ProgressData, levelId: number, mode: LevelMode): boolean => {
  if (!isLevelUnlocked(levelId, p)) return false;
  if (mode === "normal") return true;
  return getModeStars(p, levelId).normal >= 3;
};

export const recordLevelResult = (
  p: ProgressData,
  levelId: number,
  mode: LevelMode,
  stars: number,
): ProgressData => {
  const prev = getModeStars(p, levelId);
  let next = prev;
  if (mode === "normal") {
    const s = (Math.max(0, Math.min(3, Math.floor(stars))) | 0) as Stars;
    if (s <= prev.normal) return p;
    next = { ...prev, normal: s };
  } else if (mode === "breach") {
    if (stars < 1 || prev.breach >= 1) return p;
    next = { ...prev, breach: 1 };
  } else {
    if (stars < 1 || prev.containment >= 1) return p;
    next = { ...prev, containment: 1 };
  }
  return { ...p, starsByLevel: { ...p.starsByLevel, [levelId]: next } };
};

export const markEncountered = (p: ProgressData, kinds: EnemyKind[]): ProgressData | null => {
  const missing = kinds.filter((k) => !p.encountered[k]);
  if (missing.length === 0) return null;
  const next: ProgressData = {
    ...p,
    encountered: { ...p.encountered },
  };
  for (const k of missing) next.encountered[k] = true;
  return next;
};

export const hasEncountered = (p: ProgressData, kind: EnemyKind): boolean =>
  p.encountered[kind] === true;

// Sibling of markEncountered for boss variants. Returns null when every
// requested variant was already in the set so the store's per-tick
// merge can short-circuit without rebuilding ProgressData on the hot
// path.
export const markMatriarchsEncountered = (
  p: ProgressData,
  variants: BossVariant[],
): ProgressData | null => {
  const missing = variants.filter((v) => !p.matriarchsEncountered[v]);
  if (missing.length === 0) return null;
  const next: ProgressData = {
    ...p,
    matriarchsEncountered: { ...p.matriarchsEncountered },
  };
  for (const v of missing) next.matriarchsEncountered[v] = true;
  return next;
};

export const hasMatriarchEncountered = (p: ProgressData, variant: BossVariant): boolean =>
  p.matriarchsEncountered[variant] === true;

export const setDifficulty = (p: ProgressData, difficulty: Difficulty): ProgressData =>
  p.difficulty === difficulty ? p : { ...p, difficulty };

export const getMultipliers = (p: ProgressData): DifficultyMultipliers =>
  DIFFICULTY_MULTIPLIERS[p.difficulty];

// Lower-is-easier comparator. DIFFICULTIES is ordered easy → extinction, so
// the smaller index wins. Used for per-run minimum tracking when the player
// changes difficulty mid-level.
export const minDifficulty = (a: Difficulty, b: Difficulty): Difficulty =>
  DIFFICULTIES.indexOf(a) <= DIFFICULTIES.indexOf(b) ? a : b;

export const easterEggTriggerKey = (levelId: number, eggId: string): string =>
  `${levelId}:${eggId}`;

export const triggeredEasterEggIdsForLevel = (p: ProgressData, levelId: number): Set<string> => {
  const out = new Set<string>();
  const prefix = `${levelId}:`;
  for (const k of Object.keys(p.triggeredEasterEggs)) {
    if (k.startsWith(prefix)) out.add(k.slice(prefix.length));
  }
  return out;
};

export const markEasterEggTriggered = (
  p: ProgressData,
  levelId: number,
  eggId: string,
): ProgressData | null => {
  const key = easterEggTriggerKey(levelId, eggId);
  if (p.triggeredEasterEggs[key]) return null;
  return {
    ...p,
    triggeredEasterEggs: { ...p.triggeredEasterEggs, [key]: true },
  };
};
