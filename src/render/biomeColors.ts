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
