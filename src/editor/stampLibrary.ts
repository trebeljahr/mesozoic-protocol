import type { PropRole } from "../biomes";
import type { Vec2 } from "../sim/types";

// Persistence for the dev-only stamp library — a global pool of pre-built
// multi-prop arrangements ("save selection as stamp") that the editor can
// re-drop with one click. Lives outside the per-level / world-map blobs
// because stamps are reusable across every editor instance.
//
// Storage layout mirrors levelEdits.ts: a single JSON blob under one key,
// no top-level side effects (every read/write goes through a function
// guarded by an isBrowser check) so dead-code elimination still drops the
// whole module in production where the editor is gated behind
// import.meta.env.DEV.

// One child of a stamp. `relPos` is the offset from the stamp's centroid,
// so dropping the stamp at world (x, y) places each child at
// (x + relPos.x, y + relPos.y). Storing relative positions means the
// authored layout survives even if the original world coords drift.
export type StampChild = {
  url: string;
  relPos: Vec2;
  scale: number;
  rot: number;
  blocks: boolean;
};

// One saved stamp. `role` is the role of the child closest to the
// centroid — drives which palette bucket the stamp slots into (so a
// "campsite" of tree-heavy children shows up under Trees, not in some
// new "stamps" tab). `childCount` is denormalised for the palette badge
// (so we don't have to load every stamp just to render the count).
export type Stamp = {
  id: string;
  label: string;
  role: PropRole;
  childCount: number;
  children: StampChild[];
  createdAt: string;
};

// On-disk shape. Versioned so future additive fields can be detected even
// though the current plan doesn't bump the schema.
export type StampLibrary = { v: 1; stamps: Stamp[] };

const STORAGE_KEY = "mz:stamplib:v1";

const isBrowser = typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const EMPTY_LIBRARY: StampLibrary = { v: 1, stamps: [] };

// Defensive parse — any malformed blob (missing fields, wrong types, JSON
// parse failures) is treated as a fresh empty library rather than throwing.
// Mirrors the levelEdits.ts / worldMapEdits.ts convention: dev-tool storage
// must never crash the host app.
const parseLibrary = (raw: string | null): StampLibrary => {
  if (!raw) return EMPTY_LIBRARY;
  try {
    const parsed = JSON.parse(raw) as Partial<StampLibrary>;
    if (!parsed || typeof parsed !== "object") return EMPTY_LIBRARY;
    if (!Array.isArray(parsed.stamps)) return EMPTY_LIBRARY;
    return { v: 1, stamps: parsed.stamps as Stamp[] };
  } catch {
    return EMPTY_LIBRARY;
  }
};

export const loadStampLibrary = (): StampLibrary => {
  if (!isBrowser) return EMPTY_LIBRARY;
  try {
    return parseLibrary(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return EMPTY_LIBRARY;
  }
};

export const saveStampLibrary = (lib: StampLibrary): void => {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
  } catch {
    // Quota / serialization failures are non-fatal for a dev tool.
  }
};

// Append a stamp to the library and persist. Caller is responsible for
// ensuring `stamp.id` is unique (nanoid keeps collisions vanishingly rare).
export const addStamp = (stamp: Stamp): void => {
  const lib = loadStampLibrary();
  saveStampLibrary({ v: 1, stamps: [...lib.stamps, stamp] });
};

// Remove a stamp by id. No-op if no match — caller's confirm dialog
// already gates the intent.
export const removeStamp = (id: string): void => {
  const lib = loadStampLibrary();
  const next = lib.stamps.filter((s) => s.id !== id);
  if (next.length === lib.stamps.length) return;
  saveStampLibrary({ v: 1, stamps: next });
};

export const getStamp = (id: string): Stamp | null => {
  const lib = loadStampLibrary();
  return lib.stamps.find((s) => s.id === id) ?? null;
};
