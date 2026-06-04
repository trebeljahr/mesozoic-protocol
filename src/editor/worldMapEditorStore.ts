import { PAN_LIMIT_X, PAN_LIMIT_Z } from "../render/worldMapBounds";
import type { AutoBridge, PlacedProp, River } from "../sim/types";
import { distSq } from "../sim/vec2";
import { createEditorStore, type EditorStore, isOnRiver, propRadius } from "./editorCore";
import { loadWorldMapHistory, saveWorldMapHistory } from "./historyPersist";
import { loadWorldMapEdit, saveWorldMapEdit } from "./worldMapEdits";

// Inset from the pan-limit edge so a candidate placed at the very corner
// can't sit half-off the editable area. Matches the spirit of the level
// adapter's MAP_WIDTH/2 clamp.
const WORLDMAP_BOUNDS_INSET = 0.5;

// Dev-only world-map editor store. A thin adapter over the shared
// editorCore factory: unlike the level editor (which writes through
// useGame.world.props/rivers), the world map owns its own arrays in the
// adapter's closure and persists to a single localStorage entry — the world
// map is global, not level-scoped.

// PURE annotation: tree-shake the whole world-map editor surface out of
// production builds where the only consumers (WorldMapEditorPanel /
// WorldMapEditorProps) are dead-coded behind import.meta.env.DEV. The
// localStorage seed lives inside the factory so it only runs when
// createEditorStore actually executes (i.e. when a DEV consumer subscribes).
export const useWorldMapEditor: EditorStore = /* @__PURE__ */ createEditorStore(() => {
  const seed = loadWorldMapEdit();
  // Closure-owned source of truth. The factory reads via getCurrent() and
  // writes via commit() — and bumps its version counter on each commit so
  // the panel + render layer re-render without subscribing to these refs.
  let props: PlacedProp[] = seed?.props ?? [];
  // Additive field — older v:1 blobs without rivers load with [].
  let rivers: River[] = seed?.rivers ?? [];
  // Additive field — older v:1 blobs without bridges load with [].
  let bridges: AutoBridge[] = seed?.bridges ?? [];
  let override: boolean = seed?.override ?? false;
  return {
    // World-map editor has no easter-egg authoring (eggs are per-level), so
    // the editor source feeds an empty array. The shared store still walks
    // through the `easterEggs` field on every snapshot/commit, but it never
    // grows.
    getCurrent: () => ({ props, override, rivers, bridges, easterEggs: [] }),
    commit: (next) => {
      props = next.props;
      rivers = next.rivers;
      bridges = next.bridges;
      override = next.override;
      saveWorldMapEdit({ v: 1, override, props, rivers, bridges });
    },
    // History persists alongside props/rivers so reloads keep the undo/redo
    // stacks. World-map history is a single global blob (no level scope).
    loadHistory: () => loadWorldMapHistory(),
    saveHistory: (history) => saveWorldMapHistory(history),
    // Mirrors the level adapter's collision gate: bounds + existing props +
    // hand-painted rivers. World-map data has no explicit path geometry
    // (worldMapEdits.ts persists only props + rivers + override), so the
    // path-overlap check is intentionally omitted.
    canPlaceAt: (x, y, candidateRadius, ignorePropId) => {
      if (Math.abs(x) > PAN_LIMIT_X - WORLDMAP_BOUNDS_INSET) return false;
      if (Math.abs(y) > PAN_LIMIT_Z - WORLDMAP_BOUNDS_INSET) return false;
      if (isOnRiver(rivers, x, y, candidateRadius)) return false;
      const pos = { x, y };
      // Normalise the ignore arg so the prop-loop just calls .has(). Single-
      // string callers and Set callers (future group/stamp validation paths)
      // take the same code path.
      const ignoreSet =
        ignorePropId instanceof Set ? ignorePropId : ignorePropId ? new Set([ignorePropId]) : null;
      for (const p of props) {
        if (ignoreSet?.has(p.id)) continue;
        const r = propRadius(p.url, p.scale) + candidateRadius;
        if (distSq(p.pos, pos) < r * r) return false;
      }
      return true;
    },
    // World-map dimensions aren't pinned today — the pan-limit rectangle
    // is the editable area, but rivers were painted free-form. Returning
    // null suppresses the edge-snap so existing world-map rivers keep
    // whatever endpoints they had; the level editor (where bounds are
    // well-defined) is the one that needs the strict snap.
    getMapBounds: () => null,
    // No path geometry on the world map today, so the bridge resolver
    // always returns []. Kept here so the resolver still gets called and
    // any stale bridges in older blobs get pruned out on next commit.
    getPaths: () => [],
    // Export adds metadata (scope/generatedAt) on top of the persisted
    // shape so a downloaded file is self-describing.
    exportJson: () =>
      JSON.stringify(
        {
          v: 1,
          scope: "worldMap",
          generatedAt: new Date().toISOString(),
          override,
          props,
          rivers,
          bridges,
        },
        null,
        2,
      ),
  };
});
