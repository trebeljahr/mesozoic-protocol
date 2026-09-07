import type { AuthoredLake, AutoBridge, PlacedEasterEgg, PlacedProp, River } from "../sim/types";

// Undo/redo helpers for the dev-only editors. Pure helpers, no globals.
// A snapshot captures the pre-mutation state; each mutating action pushes
// the previous snapshot via pushHistory before applying its change, which
// also drops the redo stack (canonical semantics: any new mutation
// invalidates pending redos). The stack itself is persisted by the editor
// adapter (see historyPersist) so a page reload preserves both past and
// future stacks alongside the prop/override state from levelEdits /
// worldMapEdits.

export type Snapshot = {
  props: PlacedProp[];
  override: boolean;
  rivers: River[];
  // Hand-painted lakes from the lake tool. Captured so undo/redo restores
  // the water bodies alongside the rivers that feed them.
  lakes: AuthoredLake[];
  // Editor-managed bridges resolved from rivers × paths at commit time.
  // Captured here so undo/redo restores the same bridge ids the user saw.
  bridges: AutoBridge[];
  // Author-placed easter eggs. Editor only — world-map adapter feeds an
  // empty array since the world map doesn't seed eggs.
  easterEggs: PlacedEasterEgg[];
  proceduralSeed?: number;
  // Per-position keys for procedural items the author erased/overwrote.
  // Captured so undo/redo restores the same procedural-decor mask.
  erasedProcedural?: string[];
};
export type History = { past: Snapshot[]; future: Snapshot[] };

export const HISTORY_CAP = 50;

export const pushHistory = (h: History, prev: Snapshot): History => {
  const past =
    h.past.length >= HISTORY_CAP
      ? [...h.past.slice(h.past.length - HISTORY_CAP + 1), prev]
      : [...h.past, prev];
  return { past, future: [] };
};

export const undoHistory = (
  h: History,
  current: Snapshot,
): { next: History; restored: Snapshot } | null => {
  if (h.past.length === 0) return null;
  const restored = h.past[h.past.length - 1];
  return {
    next: { past: h.past.slice(0, -1), future: [...h.future, current] },
    restored,
  };
};

export const redoHistory = (
  h: History,
  current: Snapshot,
): { next: History; restored: Snapshot } | null => {
  if (h.future.length === 0) return null;
  const restored = h.future[h.future.length - 1];
  return {
    next: { past: [...h.past, current], future: h.future.slice(0, -1) },
    restored,
  };
};

export const canUndo = (h: History): boolean => h.past.length > 0;
export const canRedo = (h: History): boolean => h.future.length > 0;
