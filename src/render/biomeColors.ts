import type { Biome } from "../biomes";

export type BiomeStoryTraceStyle = {
  trace: string;
  traceOpacity: number;
  marker: string;
  markerAccent: string;
};

export const BIOME_STORY_TRACE_STYLE: Record<Biome, BiomeStoryTraceStyle> = {
  forest: { trace: "#2f271f", traceOpacity: 0.24, marker: "#f1c94b", markerAccent: "#2b3038" },
  desert: { trace: "#6a3f24", traceOpacity: 0.28, marker: "#f3b23f", markerAccent: "#35271e" },
  snow: { trace: "#5f7180", traceOpacity: 0.3, marker: "#9bdcff", markerAccent: "#2e4050" },
  wasteland: { trace: "#221a16", traceOpacity: 0.3, marker: "#ffb04a", markerAccent: "#2b2020" },
  lava: { trace: "#120b08", traceOpacity: 0.36, marker: "#ff7a3d", markerAccent: "#32130d" },
  alien: { trace: "#46ffd2", traceOpacity: 0.22, marker: "#8dffdc", markerAccent: "#32205a" },
};

// Per-biome rim color bias used by the unit material pipeline. Stored
// here so future biome-specific tinting (lights, ambient VFX, etc.) can
// reuse the same source of truth. See materialTunables.ts for the live
// values — kept canonical there to avoid two copies of the same table.
export { BIOME_MATRIARCH_RIM, BIOME_RIM_BIAS } from "./materialTunables";

// Cloning-canister palette. The biotech-outpost backstory lands per-biome:
// temperate worlds default to green growth medium, lava/wasteland to amber
// (volcanic specimens), snow to pale-cyan cryogenic fluid, alien to magenta
// xeno-fluid. Glass tint stays subtle so the fluid carries the colour.
export type CanisterPalette = {
  fluid: string;
  glass: string;
  indicator: string;
  indicatorAlt: string;
};

export const CANISTER_PALETTE: Record<Biome, CanisterPalette> = {
  forest: { fluid: "#7bff6a", glass: "#bff0d8", indicator: "#73f7ff", indicatorAlt: "#a5ffd0" },
  desert: { fluid: "#9aff6a", glass: "#c6e6c2", indicator: "#73f7ff", indicatorAlt: "#fff0a8" },
  snow: { fluid: "#9af0ff", glass: "#d0eaff", indicator: "#bef6ff", indicatorAlt: "#7fc8ff" },
  wasteland: { fluid: "#ffb84a", glass: "#dec8a8", indicator: "#ff9a3a", indicatorAlt: "#ffd58a" },
  lava: { fluid: "#ff9a3a", glass: "#d4b89a", indicator: "#ffe060", indicatorAlt: "#ff5a2a" },
  alien: { fluid: "#ff70d8", glass: "#e6c8ff", indicator: "#b070ff", indicatorAlt: "#ffb0e8" },
};
