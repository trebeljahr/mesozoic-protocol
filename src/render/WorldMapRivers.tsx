import { useEffect, useState } from "react";
import { useWorldMapEditor } from "../editor/worldMapEditorStore";
import type { River } from "../sim/types";
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

// One-shot read of authored world-map rivers from localStorage. No subscribe
// — players don't edit the world map, so a snapshot at mount is correct.
const readStoredRivers = (): River[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { rivers?: unknown };
    return Array.isArray(parsed?.rivers) ? (parsed.rivers as River[]) : [];
  } catch {
    return [];
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
const DevWorldMapRivers = () => {
  const rivers = useWorldMapEditor((s) => s.rivers);
  return <Rivers rivers={rivers} />;
};

// Prod path: snapshot localStorage once on mount. Re-reads on window focus
// so a player who edits in a separate tab sees the update on returning —
// cheap insurance, no event subscription needed otherwise.
const ProdWorldMapRivers = () => {
  const [rivers, setRivers] = useState<River[]>(() => readStoredRivers());
  useEffect(() => {
    const refresh = () => setRivers(readStoredRivers());
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  return <Rivers rivers={rivers} />;
};
