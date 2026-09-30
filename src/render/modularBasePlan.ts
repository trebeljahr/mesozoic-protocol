import type { Biome } from "../biomes";

export const BASE_MODULES = ["habitat", "lab", "power", "comms", "cargo"] as const;
export type BaseModule = (typeof BASE_MODULES)[number];
export type BaseBlock = {
  at: [number, number, number];
  size: [number, number, number];
  color: string;
};

export type BaseCondition = "intact" | "weathered" | "breached";
export type CourtyardLayout = "specimen" | "twin" | "recovery";
export const baseAppearance = (
  seed: number,
): { layout: CourtyardLayout; condition: BaseCondition } => {
  const n = Math.abs(Math.floor(seed));
  return {
    layout: (["specimen", "twin", "recovery"] as const)[n % 3],
    condition: (["intact", "weathered", "breached"] as const)[Math.floor(n / 3) % 3],
  };
};
export const baseSeed = (outpost: { id: number; pos: { x: number; y: number } }): number =>
  outpost.id + Math.round(Math.abs(outpost.pos.x * 7 + outpost.pos.y * 13));

export const courtyardTanks = (layout: CourtyardLayout) =>
  layout === "twin"
    ? [
        { x: -0.85, z: -0.2, scale: 1.7 },
        { x: 0.85, z: -0.2, scale: 1.7 },
      ]
    : [{ x: 0, z: layout === "recovery" ? -0.35 : 0, scale: layout === "recovery" ? 2.35 : 2.8 }];

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
export const courtyardBaseScale = (radius: number): number => Math.min(1, (radius * 0.94) / 6.4);

export function modularBasePlan(
  biome: Biome,
  seed: number,
  radius: number,
  courtyard = false,
): BaseBlock[] {
  const { layout, condition } = baseAppearance(seed);
  const [wall, trim, steel, lamp] = PALETTES[biome];
  const light = condition === "breached" ? "#4e5753" : lamp;
  const blocks: BaseBlock[] = [];
  const add = (at: BaseBlock["at"], size: BaseBlock["size"], color: string) =>
    blocks.push({ at, size, color });
  const variant = Math.abs(Math.floor(seed)) % 3;
  const slots = courtyard
    ? layout === "twin"
      ? [
          [-3.6, -1.8],
          [-3.6, 1.8],
          [3.6, -1.8],
          [3.6, 1.8],
        ]
      : layout === "recovery"
        ? [
            [-3.6, 0],
            [3.6, 0],
            [0, -3.6],
          ]
        : [
            [-3.6, 0],
            [3.6, 0],
            [-1.8, -3.6],
            [1.8, -3.6],
          ]
    : variant === 0
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
    const yaw = courtyard ? (x < -3 ? Math.PI / 2 : x > 3 ? -Math.PI / 2 : 0) : 0;
    const box = (at: BaseBlock["at"], size: BaseBlock["size"], color: string) =>
      add(
        [
          x + at[0] * Math.cos(yaw) + at[2] * Math.sin(yaw),
          at[1],
          z - at[0] * Math.sin(yaw) + at[2] * Math.cos(yaw),
        ],
        yaw === 0 ? size : [size[2], size[1], size[0]],
        color,
      );
    const h = kind === "cargo" ? 1.35 : kind === "comms" ? 1.9 : 1.65;
    box([0, 0.12, 0], [3.4, 0.24, 3.3], steel);
    box([0, 0.27, 0], [3.15, 0.12, 3.05], trim);
    const ruined = condition === "breached" && (index + seed) % 2 === 0;
    if (ruined) {
      // A hollow shell with a collapsed front corner, rather than a solid damaged box.
      box([0, 0.4, -0.25], [2.8, 0.14, 2.35], steel);
      box([0, h / 2 + 0.33, -1.35], [2.8, h, 0.15], wall);
      box([-1.32, h / 2 + 0.33, -0.25], [0.16, h, 2.35], wall);
      box([1.32, 0.65, -0.25], [0.16, 0.65, 2.35], wall);
      box([-0.7, 0.65, 0.87], [1.25, 0.65, 0.16], wall);
      box([0.75, 0.5, 0.85], [0.65, 0.25, 0.4], trim);
    } else box([0, h / 2 + 0.33, -0.25], [2.8, h, 2.35], wall);
    const roof = h + 0.54;
    if (!ruined) {
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
    }
    if (condition !== "intact") {
      // Patches follow surfaces; loss of roof geometry makes severe damage readable overhead.
      box([-0.7, 0.75, -1.44], [0.72, 0.6, 0.025], "#70513e");
      if (!ruined) {
        box([0.7, h + 0.54, 0.45], [0.82, 0.035, 0.48], "#805c43");
        box([1.42, 0.72, -0.2], [0.035, 0.65, 0.55], "#645843");
      } else {
        box([-1.05, h + 0.37, -0.25], [0.58, 0.14, 2.4], trim);
        box([0.1, 0.56, -0.3], [1.35, 0.25, 0.65], "#4c4b44");
        for (let i = 0; i < 4; i++)
          box([-0.85 + i * 0.48, 0.4, 1.25], [0.32, 0.15 + i * 0.02, 0.36], trim);
      }
    }
    // Climate hardware remains legible from the overhead gameplay camera.
    if (!ruined && biome === "snow") box([0, roof + 0.06, -1.28], [2.7, 0.13, 0.25], "#eff6f6");
    if (biome === "forest") box([1.48, 0.62, -0.45], [0.18, 0.65, 1.6], "#465e43");
    if (!ruined && (biome === "lava" || biome === "snow"))
      box([-1.12, roof + 0.43, -1], [0.26, 0.86, 0.3], steel);
    if (!ruined && biome === "alien") box([1.13, roof + 0.36, -1], [0.16, 0.72, 0.16], light);
    if (!ruined && biome === "wasteland") box([0.8, h + 0.55, 0.45], [0.85, 0.07, 0.48], "#835a43");
  }
  if (courtyard) {
    // Open U-shaped research court, with a broad entry and tank service plinth.
    add([0, 0.12, -0.3], [6.9, 0.24, 6.6], steel);
    add([0, 0.26, -0.3], [6.6, 0.04, 6.3], trim);
    add([0, 0.35, 0], [3.5, 0.16, 3.5], steel);
    for (const x of [-2.2, 2.2]) {
      add([x, 0.3, 0.3], [0.12, 0.05, 4.8], light);
      add([x, 0.68, 2.6], [0.5, 0.8, 0.5], steel);
      add([x, 1.1, 2.6], [0.55, 0.08, 0.55], light);
    }
    if (layout === "recovery") {
      // Hoist frame over the specimen recovery bay.
      for (const x of [-1.65, 1.65]) add([x, 1.95, -1.6], [0.18, 3.3, 0.2], steel);
      add([0, 3.62, -1.6], [3.5, 0.23, 0.26], trim);
      add([0, 3.2, -1.6], [0.09, 0.7, 0.09], steel);
    }
    // Feed pipes run back to the labs; console faces the open entry.
    for (const x of [-0.7, 0.7]) add([x, 0.48, -2], [0.16, 0.16, 2], steel);
    add([1.7, 0.75, 1.7], [0.65, 0.9, 0.6], wall);
    add([1.7, 1.23, 1.7], [0.56, 0.08, 0.5], light);
  }
  // A central service spine joins every module's apron, with inset edge markings.
  const minX = Math.min(...slots.map(([x]) => x)) - 1.6;
  const maxX = Math.max(...slots.map(([x]) => x)) + 1.6;
  if (!courtyard) add([(minX + maxX) / 2, 0.18, 0], [maxX - minX, 0.2, 0.8], steel);
  if (!courtyard) add([(minX + maxX) / 2, 0.29, 0], [maxX - minX - 0.2, 0.03, 0.12], trim);
  const extent = Math.max(
    ...blocks.map(({ at, size }) =>
      Math.hypot(Math.abs(at[0]) + size[0] / 2, Math.abs(at[2]) + size[2] / 2),
    ),
  );
  const scale = courtyard ? courtyardBaseScale(radius) : Math.min(1, (radius * 0.94) / extent);
  return blocks.map(({ at, size, color }) => ({
    at: at.map((v) => v * scale) as BaseBlock["at"],
    size: size.map((v) => v * scale) as BaseBlock["size"],
    color,
  }));
}
