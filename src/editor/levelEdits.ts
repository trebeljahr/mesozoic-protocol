import type { PlacedProp, River } from "../sim/types";

// Persistence for the dev-only level editor (src/editor). Hand-placed props
// and the per-level "override procedural" flag are stored in localStorage,
// keyed by level id, and re-applied by createWorld on every load so authored
// layouts "stay that way" across reloads.
//
// This module has no top-level side effects, so when world.ts references
// readLevelEditForWorld only inside `if (import.meta.env.DEV)`, Rollup
// tree-shakes the whole module out of production builds.

export type LevelEdit = {
  v: 1;
  // When true, createWorld blanks procedural trees/rocks/outposts/cosmetics
  // for this level so the hand-placed props are the only set-dressing.
  override: boolean;
  // Extra deterministic seed offset for regenerating procedural placement.
  proceduralSeed?: number;
  props: PlacedProp[];
  // Hand-painted rivers from the river tool. Additive over v:1 — older
  // blobs without this field load with rivers defaulting to []. The
  // schema version stays at 1 because the addition is purely additive.
  rivers?: River[];
};

const STORAGE_KEY = "mz:leveledits:v1";

type EditMap = Record<string, LevelEdit>;

const isBrowser = typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const readAll = (): EditMap => {
  if (!isBrowser) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as EditMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeAll = (map: EditMap): void => {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota / serialization failures are non-fatal for a dev tool.
  }
};

export const loadLevelEdit = (levelId: number): LevelEdit | null =>
  readAll()[String(levelId)] ?? null;

export const saveLevelEdit = (levelId: number, edit: LevelEdit): void => {
  const map = readAll();
  map[String(levelId)] = edit;
  writeAll(map);
};

export const clearLevelEdit = (levelId: number): void => {
  const map = readAll();
  delete map[String(levelId)];
  writeAll(map);
};

// Wipe every level's stored edits in one shot. Used by the editor's
// "Clear All Levels" affordance; the caller is responsible for any user
// confirmation, since this is irreversible.
export const clearAllLevelEdits = (): void => {
  if (!isBrowser) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same fallback as writeAll — non-fatal for a dev tool.
  }
};

// Dump every level's edits, keyed by level id. Used by the editor's
// "Download All Levels" export so a single JSON file captures the full
// authored set.
export const readAllLevelEdits = (): EditMap => readAll();
