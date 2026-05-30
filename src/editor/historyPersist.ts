import type { History } from "./history";

// Persistence for the dev-only editor undo/redo stacks. Level history is
// keyed by level id (each level keeps its own past/future across reloads);
// the world-map editor stores a single global stack. Snapshots embedded in
// the History share the same shape as the persisted LevelEdit / WorldMapEdit
// blobs (props/override/rivers/proceduralSeed) so the storage cost is roughly
// 2 × HISTORY_CAP × edit-size per level. Quota failures are swallowed —
// this is a dev tool and a fresh history is acceptable degradation.

const LEVEL_HISTORY_KEY = "mz:leveledithist:v1";
const WORLDMAP_HISTORY_KEY = "mz:worldmaphist:v1";

const isBrowser = typeof window !== "undefined" && typeof window.localStorage !== "undefined";

type LevelHistoryMap = Record<string, History>;

const EMPTY: History = { past: [], future: [] };

const isHistory = (v: unknown): v is History =>
  !!v &&
  typeof v === "object" &&
  Array.isArray((v as History).past) &&
  Array.isArray((v as History).future);

const readJson = <T>(key: string): T | null => {
  if (!isBrowser) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const writeJson = (key: string, value: unknown): void => {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota / serialization failures are non-fatal for a dev tool.
  }
};

const removeKey = (key: string): void => {
  if (!isBrowser) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Same fallback — non-fatal.
  }
};

export const loadLevelHistory = (levelId: number): History => {
  const map = readJson<LevelHistoryMap>(LEVEL_HISTORY_KEY) ?? {};
  const h = map[String(levelId)];
  return isHistory(h) ? h : { past: [], future: [] };
};

export const saveLevelHistory = (levelId: number, history: History): void => {
  const map = readJson<LevelHistoryMap>(LEVEL_HISTORY_KEY) ?? {};
  if (history.past.length === 0 && history.future.length === 0) {
    if (!(String(levelId) in map)) return;
    delete map[String(levelId)];
  } else {
    map[String(levelId)] = history;
  }
  writeJson(LEVEL_HISTORY_KEY, map);
};

export const clearLevelHistory = (levelId: number): void => {
  const map = readJson<LevelHistoryMap>(LEVEL_HISTORY_KEY) ?? {};
  if (!(String(levelId) in map)) return;
  delete map[String(levelId)];
  writeJson(LEVEL_HISTORY_KEY, map);
};

export const clearAllLevelHistories = (): void => removeKey(LEVEL_HISTORY_KEY);

export const loadWorldMapHistory = (): History => {
  const h = readJson<History>(WORLDMAP_HISTORY_KEY);
  return isHistory(h) ? h : EMPTY;
};

export const saveWorldMapHistory = (history: History): void => {
  if (history.past.length === 0 && history.future.length === 0) {
    removeKey(WORLDMAP_HISTORY_KEY);
    return;
  }
  writeJson(WORLDMAP_HISTORY_KEY, history);
};

export const clearWorldMapHistory = (): void => removeKey(WORLDMAP_HISTORY_KEY);
