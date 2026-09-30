import type { BaseBlock, BaseCondition } from "./modularBasePlan";

export const BASE_STRUCTURES = [
  { id: "hangar", label: "Ribbed hangar" },
  { id: "tower", label: "Observation tower" },
  { id: "bunker", label: "Terraced bunker" },
  { id: "shed", label: "Open service shed" },
  { id: "lab", label: "L-shaped field lab" },
  { id: "reservoir", label: "Twin reservoir plant" },
] as const;
export type BaseStructure = (typeof BASE_STRUCTURES)[number]["id"];
export const BASE_CONDITIONS: BaseCondition[] = ["intact", "weathered", "breached"];

/** Independent modules, all within the same 3.4 × 3.4 docking envelope. */
export function baseStructurePlan(
  kind: BaseStructure,
  palette: readonly [string, string, string, string],
  condition: BaseCondition,
): BaseBlock[] {
  const [wall, trim, steel, lamp] = palette;
  const light = condition === "breached" ? "#424c47" : lamp;
  const ruined = condition === "breached";
  const blocks: BaseBlock[] = [];
  const box = (at: BaseBlock["at"], size: BaseBlock["size"], color = wall) =>
    blocks.push({ at, size, color });
  const footing = (x: number, z: number, w: number, d: number) =>
    box([x, 0.12, z], [w, 0.24, d], steel);
  if (kind === "hangar") {
    footing(0, 0, 3.3, 3.1);
    // Barrel roof: narrow stepped strips follow a semicircular cross-section.
    for (let i = 0; i < 10; i++) {
      const x = -1.35 + i * 0.3;
      const y = 1.15 + Math.sqrt(2.25 - x * x);
      if (!ruined || i < 3 || i > 6) box([x, y, 0], [0.32, 0.18, 2.9], trim);
      for (const z of [-1.3, 0, 1.3]) {
        if (!ruined || i < 3 || z < 0) box([x, y + 0.13, z], [0.32, 0.1, 0.12], steel);
      }
    }
    for (const x of [-1.44, 1.44]) box([x, 0.965, 0], [0.16, 1.45, 2.9]);
    box([0, 1.05, -1.39], [2.7, 1.6, 0.12]);
    for (const x of [-1.1, 1.1]) box([x, 1.05, 1.36], [0.42, 1.6, 0.14]);
    if (!ruined) {
      box([0, 1, 1.38], [1.76, 1.5, 0.08], steel);
      for (let i = 0; i < 5; i++) box([0, 0.4 + i * 0.26, 1.44], [1.68, 0.035, 0.025], trim);
    }
    box([0, 1.91, 1.4], [1.8, 0.1, 0.12], light);
    box([0, 0.28, 1.48], [1.85, 0.08, 0.3], trim);
  } else if (kind === "tower") {
    footing(0, 0, 2.6, 2.6);
    box([0, 1.45, 0], [1.25, 2.45, 1.35]);
    for (const x of [-0.76, 0.76]) box([x, 1.4, -0.56], [0.2, 2.4, 0.2], steel);
    box([0, 2.64, 0], [2.55, 0.18, 2.3], trim);
    box([0, 3.07, 0], [2.1, 0.72, 1.85], steel);
    if (!ruined) {
      box([0, 3.15, 0.94], [1.85, 0.35, 0.04], light);
      box([1.07, 3.15, 0], [0.04, 0.35, 1.6], light);
      box([-1.07, 3.15, 0], [0.04, 0.35, 1.6], light);
      box([0, 3.5, 0], [2.65, 0.16, 2.4], trim);
      box([-0.65, 4, -0.5], [0.1, 0.9, 0.1], steel);
      box([-0.65, 4.44, -0.5], [0.16, 0.12, 0.16], light);
    } else box([-0.85, 3.5, 0], [0.8, 0.16, 2.4], trim);
    box([0, 0.8, 0.7], [0.65, 1.1, 0.05], steel);
    for (let i = 0; i < 8; i++) box([0.69, 0.45 + i * 0.26, 0.1], [0.08, 0.06, 0.6], trim);
  } else if (kind === "bunker") {
    footing(0, 0, 3.3, 2.7);
    box([0, 0.66, 0], [2.7, 0.85, 2.2]);
    for (const x of [-1.4, 1.4]) {
      box([x, 0.42, 0], [0.45, 0.35, 2.4], trim);
      box([x * 0.94, 0.72, 0], [0.3, 0.3, 2.25], trim);
    }
    if (!ruined) {
      box([0, 1.16, 0], [3.05, 0.3, 2.5], trim);
      box([0, 1.37, -0.2], [2.1, 0.12, 1.75], steel);
    } else {
      box([-0.95, 1.16, 0], [1.15, 0.3, 2.5], trim);
      box([0.85, 1.1, -0.8], [1.35, 0.2, 0.65], steel);
    }
    box([0, 0.67, 1.12], [0.85, 0.76, 0.08], steel);
    for (const x of [-0.95, 0.95]) box([x, 0.91, 1.13], [0.6, 0.12, 0.06], light);
    box([-0.55, 1.55, -0.35], [0.65, 0.28, 0.65], steel);
    box([0.7, 1.65, -0.65], [0.14, 0.9, 0.14], steel);
  } else if (kind === "shed") {
    footing(0, 0, 3.3, 2.85);
    for (const x of [-1.45, 1.45])
      for (const z of [-1.2, 1.2]) {
        box([x, 1.2, z], [0.16, 1.95, 0.16], trim);
      }
    box([0, 1.1, -1.25], [3.1, 1.7, 0.1]);
    box([0, 2.23, 0], [3.3, 0.2, ruined ? 0.9 : 2.85], steel);
    if (!ruined) for (const x of [-1, 0, 1]) box([x, 2.38, 0], [0.12, 0.1, 2.8], trim);
    for (const [x, z, h] of [
      [-0.75, -0.55, 0.75],
      [0.35, -0.65, 0.5],
      [0.7, 0.45, 0.45],
    ]) {
      box([x, 0.25 + h / 2, z], [0.75, h, 0.7], wall);
      box([x, 0.26 + h, z], [0.14, 0.04, 0.72], trim);
    }
    box([0, 1.95, -1.16], [1.4, 0.08, 0.07], light);
  } else if (kind === "lab") {
    footing(-0.72, 0, 1.5, 3.2);
    footing(0.72, -0.72, 1.45, 1.75);
    box([-0.72, 1.05, 0], [1.35, 1.6, 2.9]);
    box([0.72, 0.75, -0.72], [1.4, 1, 1.5]);
    box([-0.72, 1.92, ruined ? -0.8 : 0], [1.55, 0.15, ruined ? 1.3 : 3.1], trim);
    box([0.72, 1.33, -0.72], [1.55, 0.15, 1.7], trim);
    box([0, 1.25, 0.3], [0.05, 0.42, 1.4], light);
    box([0.75, 0.85, 0.05], [1.05, 0.32, 0.05], light);
    box([-0.72, 0.85, 1.47], [0.7, 1.15, 0.05], steel);
    if (!ruined)
      for (let i = 0; i < 3; i++) box([-0.72, 2.07, -0.9 + i * 0.7], [1, 0.15, 0.45], light);
    box([0.7, 0.3, 0.7], [1.4, 0.12, 1.3], steel);
    box([1.18, 0.75, 1.1], [0.28, 0.8, 0.28], trim);
  } else {
    footing(0, 0, 3.2, 2.6);
    for (const [x, h] of [
      [-0.8, 2.6],
      [0.8, ruined ? 0.9 : 1.9],
    ]) {
      // Crossed rectangular volumes form an octagonal industrial reservoir.
      box([x, 0.3 + h / 2, -0.25], [1.05, h, 0.8], wall);
      box([x, 0.3 + h / 2, -0.25], [0.8, h, 1.05], wall);
      for (const y of [0.4, 0.3 + h * 0.5, 0.3 + h]) {
        box([x, y, -0.25], [1.13, 0.13, 0.9], steel);
        box([x, y, -0.25], [0.9, 0.13, 1.13], steel);
      }
      box([x, 0.7, 0.31], [0.16, 0.65, 0.04], light);
    }
    box([0, 0.44, 0.9], [2.4, 0.22, 0.2], trim);
    for (const x of [-0.8, 0.8]) box([x, 0.6, 0.55], [0.18, 0.65, 0.2], trim);
    box([0, 0.65, 1.02], [0.4, 0.5, 0.45], steel);
  }
  if (condition !== "intact") {
    // Ground grime and scattered fragments work with every structure's unique shell.
    for (let i = 0; i < (ruined ? 7 : 3); i++) {
      box(
        [-1.15 + i * 0.35, 0.26 + (ruined ? 0.04 + (i % 3) * 0.02 : 0.015), 1.16 + (i % 3) * 0.15],
        [0.16 + (i % 2) * 0.12, ruined ? 0.08 + (i % 3) * 0.04 : 0.025, 0.12 + (i % 3) * 0.06],
        ruined ? (i % 2 ? trim : steel) : "#766047",
      );
    }
    if (kind === "tower") box([0, 1.3, 0.69], [0.7, 0.35, 0.025], "#70533f");
    if (kind === "hangar") box([1.535, 0.72, 0], [0.025, 0.35, 1.3], "#70533f");
  }
  return blocks;
}
