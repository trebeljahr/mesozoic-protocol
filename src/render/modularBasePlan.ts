import type { Biome } from "../biomes";

export const BASE_MODULES = ["habitat", "lab", "power", "comms", "cargo"] as const;
export type BaseModule = (typeof BASE_MODULES)[number];
export type BaseBlock = {
  at: [number, number, number];
  size: [number, number, number];
  color: string;
};

// Shared construction language; climate changes both materials and equipment.
const PALETTES: Record<Biome, [string, string, string, string]> = {
  forest: ["#68796a", "#c0b99b", "#263f3b", "#b5dfc4"],
  desert: ["#ad8960", "#dfc799", "#514b40", "#80d2d0"],
  snow: ["#b7c8cb", "#e9eded", "#344c60", "#edab57"],
  wasteland: ["#776e5c", "#ab9272", "#353b38", "#dca05c"],
  lava: ["#565b60", "#a3a5a3", "#292e36", "#ff9861"],
  alien: ["#66667c", "#acacc8", "#303646", "#8ee5da"],
};
const ORDERS: Record<Biome, readonly BaseModule[]> = {
  forest: ["lab", "habitat", "comms", "power", "cargo"],
  desert: ["power", "cargo", "habitat", "comms", "lab"],
  snow: ["habitat", "power", "lab", "cargo", "comms"],
  wasteland: ["cargo", "comms", "power", "habitat", "lab"],
  lava: ["power", "lab", "cargo", "comms", "habitat"],
  alien: ["lab", "comms", "power", "habitat", "cargo"],
};

/** Build connected two-, three-, or five-module compounds, bounded by the reserved circle. */
export function modularBasePlan(biome: Biome, seed: number, radius: number): BaseBlock[] {
  const [wall, trim, steel, light] = PALETTES[biome];
  const blocks: BaseBlock[] = [];
  const add = (at: BaseBlock["at"], size: BaseBlock["size"], color: string) =>
    blocks.push({ at, size, color });
  const variant = Math.abs(Math.floor(seed)) % 3;
  const slots =
    variant === 0
      ? [
          [0, -1.8],
          [0, 1.8],
        ]
      : variant === 1
        ? [
            [-1.8, -1.8],
            [1.8, -1.8],
            [-1.8, 1.8],
          ]
        : [
            [-3.6, -1.8],
            [0, -1.8],
            [3.6, -1.8],
            [-1.8, 1.8],
            [1.8, 1.8],
          ];
  const order = ORDERS[biome];
  for (const [index, [x, z]] of slots.entries()) {
    const kind = order[(index + Math.abs(Math.floor(seed))) % order.length];
    const box = (at: BaseBlock["at"], size: BaseBlock["size"], color: string) =>
      add([x + at[0], at[1], z + at[2]], size, color);
    const h = kind === "cargo" ? 1.35 : kind === "comms" ? 1.9 : 1.65;
    box([0, 0.12, 0], [3.4, 0.24, 3.3], steel);
    box([0, 0.27, 0], [3.15, 0.12, 3.05], trim);
    box([0, h / 2 + 0.33, -0.25], [2.8, h, 2.35], wall);
    box([0, h + 0.38, -0.25], [3.02, 0.16, 2.55], trim);
    box([0, h + 0.49, -0.25], [2.7, 0.08, 2.23], steel);
    // Recessed door, lintel, lit window, wall ribs, and an entry step.
    box([-0.65, 0.96, 0.94], [0.68, 1.24, 0.08], steel);
    box([-0.65, 1.61, 1.05], [0.92, 0.1, 0.38], trim);
    box([-0.65, 1.48, 1], [0.38, 0.06, 0.04], light);
    box([0.6, 1.25, 0.96], [0.82, 0.36, 0.07], steel);
    box([0.6, 1.25, 1.01], [0.7, 0.2, 0.04], light);
    box([-0.65, 0.36, 1.32], [1, 0.18, 0.46], trim);
    for (const sx of [-1.32, 1.32]) {
      box([sx, h / 2 + 0.33, 0.96], [0.12, h, 0.13], trim);
      box([sx, h + 0.65, -0.25], [0.1, 0.25, 2.4], trim);
    }
    const roof = h + 0.54;
    if (kind === "habitat") {
      box([0, roof + 0.17, -0.25], [1.7, 0.34, 1.3], wall);
      for (const dx of [-0.55, 0, 0.55]) box([dx, roof + 0.36, -0.25], [0.43, 0.06, 1.12], light);
    } else if (kind === "lab") {
      for (const dx of [-0.65, 0.65]) {
        box([dx, roof + 0.32, -0.4], [0.65, 0.64, 0.8], trim);
        box([dx, roof + 0.35, 0.02], [0.45, 0.3, 0.05], light);
        box([dx, roof + 0.69, -0.4], [0.75, 0.1, 0.9], steel);
      }
      box([0, roof + 0.1, -0.4], [1.4, 0.12, 0.13], light);
    } else if (kind === "power") {
      for (const dx of [-0.72, 0.72]) {
        box([dx, roof + 0.16, -0.25], [1.1, 0.32, 1.75], trim);
        for (let i = 0; i < 5; i++)
          box(
            [dx, roof + 0.35, -0.9 + i * 0.32],
            [0.93, 0.06, 0.23],
            biome === "desert" ? "#38546c" : steel,
          );
      }
    } else if (kind === "comms") {
      box([0, roof + 0.18, -0.3], [1.15, 0.36, 1.15], wall);
      box([0, roof + 0.95, -0.3], [0.14, 1.6, 0.14], trim);
      box([0, roof + 1.37, -0.3], [1.45, 0.13, 0.22], steel);
      box([0, roof + 1.79, -0.3], [0.23, 0.16, 0.23], light);
    } else {
      for (const dx of [-0.8, 0, 0.8]) {
        box([dx, roof + 0.25, -0.4], [0.66, 0.5, 1.3], wall);
        box([dx, roof + 0.53, -0.4], [0.12, 0.06, 1.32], trim);
      }
    }
    // Climate hardware remains legible from the overhead gameplay camera.
    if (biome === "snow") box([0, roof + 0.06, -1.28], [2.7, 0.13, 0.25], "#eff6f6");
    if (biome === "forest") box([1.48, 0.62, -0.45], [0.18, 0.65, 1.6], "#465e43");
    if (biome === "lava" || biome === "snow")
      box([-1.12, roof + 0.43, -1], [0.26, 0.86, 0.3], steel);
    if (biome === "alien") box([1.13, roof + 0.36, -1], [0.16, 0.72, 0.16], light);
    if (biome === "wasteland") box([0.8, h + 0.55, 0.45], [0.85, 0.07, 0.48], "#835a43");
  }
  // A central service spine joins every module's apron, with inset edge markings.
  const minX = Math.min(...slots.map(([x]) => x)) - 1.6;
  const maxX = Math.max(...slots.map(([x]) => x)) + 1.6;
  add([(minX + maxX) / 2, 0.18, 0], [maxX - minX, 0.2, 0.8], steel);
  add([(minX + maxX) / 2, 0.29, 0], [maxX - minX - 0.2, 0.03, 0.12], trim);
  const extent = Math.max(
    ...blocks.map(({ at, size }) =>
      Math.hypot(Math.abs(at[0]) + size[0] / 2, Math.abs(at[2]) + size[2] / 2),
    ),
  );
  const scale = Math.min(1, (radius * 0.94) / extent);
  return blocks.map(({ at, size, color }) => ({
    at: at.map((v) => v * scale) as BaseBlock["at"],
    size: size.map((v) => v * scale) as BaseBlock["size"],
    color,
  }));
}
