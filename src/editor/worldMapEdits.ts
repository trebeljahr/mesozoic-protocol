import type { PlacedProp } from "../sim/types";

// Persistence for the dev-only world-map editor (src/editor). Hand-placed
// overworld props live in localStorage under a single key (the world map
// isn't level-scoped) and are re-applied on every load so authored
// decoration "stays that way" across reloads.
//
// This module has no top-level side effects, so when its only consumers
// (WorldMapEditorPanel / WorldMapEditorProps) are dead-coded in production,
// Rollup tree-shakes the whole module out.

export type WorldMapEdit = {
  v: 1;
  // Reserved for a future "suppress procedural BiomeProps on the world map"
  // toggle. Currently unused — render layer ignores it.
  override: boolean;
  props: PlacedProp[];
};

const STORAGE_KEY = "mz:worldmapedit:v1";

const isBrowser = typeof window !== "undefined" && typeof window.localStorage !== "undefined";

export const loadWorldMapEdit = (): WorldMapEdit | null => {
  if (!isBrowser) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorldMapEdit;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

export const saveWorldMapEdit = (edit: WorldMapEdit): void => {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(edit));
  } catch {
    // Quota / serialization failures are non-fatal for a dev tool.
  }
};

export const clearWorldMapEdit = (): void => {
  if (!isBrowser) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same as above — non-fatal.
  }
};
