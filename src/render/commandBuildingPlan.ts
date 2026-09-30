import type { Biome } from "../biomes";
import { type BaseStructure, baseStructurePlan } from "./baseStructures";
import { HQ_GUN_DECK_HEIGHT } from "./commandBaseLayout";
import type { BaseBlock } from "./modularBasePlan";

export const COMMAND_LAYOUTS = [
  "operations",
  "relay",
  "hangar",
  "logistics",
  "containment",
  "radar",
] as const;
export const COMMAND_PALETTES: Record<Biome, [string, string, string, string]> = {
  forest: ["#8c9185", "#b3b2a0", "#444f4c", "#add1c5"],
  desert: ["#ab9271", "#d5c29a", "#555147", "#a6d8d3"],
  snow: ["#a9bcc1", "#dce4df", "#3e5260", "#dfb577"],
  wasteland: ["#86816e", "#b2a188", "#484b42", "#c8b07b"],
  lava: ["#737b7e", "#a6aba8", "#353c43", "#d7ad88"],
  alien: ["#8c8a9d", "#c1bfd3", "#424758", "#a8e0d6"],
};
export function commandBuildingPlan(biome: Biome, variant: number, linked = false): BaseBlock[] {
  const palette = COMMAND_PALETTES[biome];
  const [wall, trim, steel, lamp] = palette;
  const blocks: BaseBlock[] = [];
  const add = (at: BaseBlock["at"], size: BaseBlock["size"], color: string) =>
    blocks.push({ at, size, color });
  // Stable forward battery deck: turret origins, aim, and destruction effects do not move.
  if (!linked) add([0, 0.1, -0.4], [5.8, 0.2, 4.6], steel);
  add([0, (HQ_GUN_DECK_HEIGHT - 0.12) / 2, 0], [2.2, HQ_GUN_DECK_HEIGHT - 0.12, 2.15], wall);
  add([0, HQ_GUN_DECK_HEIGHT - 0.06, 0], [2.5, 0.12, 2.45], trim);
  // Armoured battery face with cooling slits; no domestic doorway silhouette.
  add([0, 1.25, 1.09], [1.6, 0.58, 0.05], steel);
  for (const x of [-0.5, 0, 0.5]) add([x, 1.25, 1.13], [0.3, 0.08, 0.025], trim);
  for (const x of [-1.12, 1.12])
    for (let i = 0; i < 3; i++) add([x, 0.85 + i * 0.18, 0.2], [0.04, 0.065, 0.65], steel);
  if (linked) {
    // Rear battery housing joins the broad research wings on the shared apron.
    add([0, 0.98, -1.7], [1.8, 1.5, 1.7], wall);
    add([0, 1.81, -1.7], [1.95, 0.16, 1.85], trim);
    return blocks;
  }
  const module = (kind: BaseStructure, x: number, z: number, scale: number) => {
    for (const block of baseStructurePlan(kind, palette, "intact"))
      add(
        [x + block.at[0] * scale, 0.2 + block.at[1] * scale, z + block.at[2] * scale],
        block.size.map((v) => v * scale) as BaseBlock["size"],
        block.color,
      );
  };
  switch (Math.abs(variant) % COMMAND_LAYOUTS.length) {
    case 0: // Wide, low operations hall with a second rear roof tier.
      add([0, 0.95, -1.65], [4.8, 1.5, 1.8], wall);
      add([0, 1.78, -1.65], [5, 0.16, 2], trim);
      add([0, 2, -2], [3.2, 0.3, 1.1], steel);
      for (const x of [-1.65, 1.65]) {
        add([x, 1.3, -0.72], [1.25, 0.3, 0.05], lamp);
        add([x, 1.89, -1.65], [1, 0.06, 1.4], steel);
      }
      break;
    case 1:
      module("tower", -1.55, -1.55, 0.63);
      module("bunker", 1.4, -1.7, 0.65);
      break;
    case 2:
      module("hangar", 0, -1.65, 0.75);
      add([-2, 0.6, -1.6], [0.65, 0.8, 1.35], wall);
      add([2, 0.6, -1.6], [0.65, 0.8, 1.35], wall);
      break;
    case 3:
      module("lab", -1.4, -1.55, 0.65);
      module("shed", 1.35, -1.65, 0.65);
      break;
    case 4:
      // Two wings around an open service court, with an elevated observation room.
      module("lab", -1.65, -1.65, 0.55);
      module("lab", 1.65, -1.65, 0.55);
      add([0, 1.35, -2.25], [1.8, 2.3, 0.75], wall);
      add([0, 2.58, -2.25], [2, 0.16, 0.95], trim);
      add([0, 1.9, -1.86], [1.5, 0.35, 0.04], lamp);
      break;
    case 5:
      module("bunker", -1.25, -1.65, 0.72);
      module("tower", 1.65, -1.85, 0.48);
      for (const x of [-1.7, -0.9]) {
        add([x, 2.15, -1.7], [0.08, 1.4, 0.08], steel);
        add([x, 2.75, -1.7], [0.65, 0.12, 0.2], trim);
      }
      break;
  }
  // Laboratory observation strips and armoured buttresses unify all wing types.
  for (const x of [-2.45, 2.45]) {
    add([x, 0.75, -1.65], [0.18, 1.1, 1.5], steel);
    add([x, 1.35, -1.65], [0.24, 0.1, 1.6], trim);
  }
  // Shared docking band visually ties different wings into one command complex.
  add([0, 0.48, -1.7], [4.8, 0.16, 0.45], steel);
  for (const x of [-2.5, 2.5]) {
    add([x, 0.45, 1.35], [0.28, 0.8, 0.28], steel);
    add([x, 0.86, 1.35], [0.32, 0.08, 0.32], lamp);
  }
  return blocks;
}
