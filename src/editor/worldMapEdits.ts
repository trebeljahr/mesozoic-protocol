import type { AuthoredLake, AutoBridge, PlacedProp, River } from "../sim/types";

// Persistence for the dev-only world-map editor (src/editor). Hand-placed
// overworld props live in localStorage under a single key (the world map
// isn't level-scoped) and are re-applied on every load so authored
// decoration "stays that way" across reloads.
//
// Rivers also live in this blob — but unlike props, the world-map renderer
// reads rivers in production too, so the prod-safe Rivers wrapper in
// src/render/WorldMap.tsx parses the same localStorage key directly to
// avoid pulling this module into the production bundle.

export type WorldMapEdit = {
  v: 1;
  // Reserved for a future "suppress procedural BiomeProps on the world map"
  // toggle. Currently unused — render layer ignores it.
  override: boolean;
  props: PlacedProp[];
  // Hand-painted rivers from the river tool. Additive over v:1 — older
  // blobs without this field load with rivers defaulting to [].
  rivers?: River[];
  // Hand-painted lakes from the lake tool. Additive over v:1 — older blobs
  // without this field load with lakes defaulting to [].
  lakes?: AuthoredLake[];
  // Editor-managed bridges resolved per commit from rivers × paths.
  // Additive over v:1 — older blobs without this field load with
  // bridges defaulting to []. The world map has no path geometry today
  // so the array stays empty; the field is here for parity with the
  // level edit blob and future world-map paths.
  bridges?: AutoBridge[];
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
