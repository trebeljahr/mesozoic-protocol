import { useEffect, useState } from "react";
import { useWorldMapEditor } from "../editor/worldMapEditorStore";
import type { AuthoredLake, River } from "../sim/types";
import { Rivers } from "./Rivers";

// World-map rivers wrapper. The world map renders rivers in both dev and
// prod, but the source differs:
//
//   - DEV: subscribe to the world-map editor store so live edits update the
//     preview in real time.
//   - PROD: parse the same localStorage blob the editor writes (key
//     "mz:worldmapedit:v1") once on mount, so authored rivers ship to
//     players without keeping the editor surface live in the bundle.
//     Mirrors the pattern src/sim/world.ts uses for the per-level edit blob.
//
// `import.meta.env.DEV` is statically replaced at build time by Vite —
// Rollup dead-codes the unused branch, including the editor-store import
// when DEV is false. The store factory itself is also `/* @__PURE__ */`,
// so even if the import survives, its top-level has no observable effect.

const STORAGE_KEY = "mz:worldmapedit:v1";

// One-shot read of the authored world-map water (rivers + lakes) from
// localStorage. No subscribe — players don't edit the world map, so a
// snapshot at mount is correct.
const readStoredWater = (): { rivers: River[]; lakes: AuthoredLake[] } => {
  if (typeof window === "undefined") return { rivers: [], lakes: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { rivers: [], lakes: [] };
    const parsed = JSON.parse(raw) as { rivers?: unknown; lakes?: unknown };
    return {
      rivers: Array.isArray(parsed?.rivers) ? (parsed.rivers as River[]) : [],
      lakes: Array.isArray(parsed?.lakes) ? (parsed.lakes as AuthoredLake[]) : [],
    };
  } catch {
    return { rivers: [], lakes: [] };
  }
};

export const WorldMapRivers = () => {
  if (import.meta.env.DEV) {
    return <DevWorldMapRivers />;
  }
  return <ProdWorldMapRivers />;
};

// Dev path: live preview from the editor store. Only reached in DEV builds,
// so the editor-store subscription is gated behind the build-time flag.
// The store's version counter bumps on every commit; we subscribe to it and
// pull the live rivers array via getCurrent() — same invalidation pattern as
// the editor's render layer.
const DevWorldMapRivers = () => {
  const version = useWorldMapEditor((s) => s.version);
  void version;
  const { rivers, lakes } = useWorldMapEditor.getState().getCurrent();
  return <Rivers rivers={rivers} lakes={lakes} />;
};

// Prod path: snapshot localStorage once on mount. Re-reads on window focus
// so a player who edits in a separate tab sees the update on returning —
// cheap insurance, no event subscription needed otherwise.
const ProdWorldMapRivers = () => {
  const [water, setWater] = useState(() => readStoredWater());
  useEffect(() => {
    const refresh = () => setWater(readStoredWater());
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  return <Rivers rivers={water.rivers} lakes={water.lakes} />;
};
