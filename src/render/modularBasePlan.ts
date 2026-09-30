import type { Biome } from "../biomes";
import { BASE_STRUCTURES, baseStructurePlan } from "./baseStructures";

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
/** Scale courtyards and their equipment into the shared reserved circle. */
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
  const variant = Math.abs(Math.floor(seed)) % 9;
  let slots = courtyard
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
    : variant === 6
      ? [
          [-3.6, -1.8],
          [-3.6, 1.8],
          [0, -1.8],
          [3.6, -1.8],
        ]
      : variant === 7
        ? [
            [-3.6, 0],
            [0, 0],
            [3.6, 0],
          ]
        : variant === 8
          ? [
              [-1.8, -3.6],
              [1.8, -3.6],
              [-3.6, 0],
              [3.6, 0],
            ]
          : variant === 3
            ? [
                [-2.8, 0],
                [0.8, 0],
                [4.4, 1.8],
              ]
            : variant === 4
              ? [
                  [-1.8, -3.6],
                  [-1.8, 0],
                  [1.8, 1.8],
                ]
              : variant === 5
                ? [
                    [0, 0],
                    [-3.6, 0],
                    [3.6, 0],
                    [0, -3.6],
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
  // Offset lab wings create asymmetrical courts independently of tank/damage choices.
  if (courtyard) {
    const wingLayout = Math.abs(Math.floor(seed / 9)) % 3;
    if (wingLayout === 1)
      slots = [
        [-3.6, -1.8],
        [-3.6, 1.8],
        [3.6, 0],
      ];
    if (wingLayout === 2)
      slots = [
        [-3.6, 0],
        [3.6, -1.8],
        [3.6, 1.8],
      ];
  }
  for (const [index, [x, z]] of slots.entries()) {
    const kind =
      BASE_STRUCTURES[(index * 5 + Math.abs(Math.floor(seed / 9))) % BASE_STRUCTURES.length].id;
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
    const heightScale = [1, 0.85, 1.12][Math.abs(Math.floor(seed / 6) + index) % 3];
    for (const block of baseStructurePlan(kind, PALETTES[biome], condition))
      box(
        [block.at[0], block.at[1] * heightScale, block.at[2]],
        [block.size[0], block.size[1] * heightScale, block.size[2]],
        block.color,
      );
    // Armoured observation strip and rooftop utility cluster, away from the central court.
    if (kind === "lab" || kind === "bunker" || kind === "hangar") {
      box([0, 1.05 * heightScale, 1.31], [1.7, 0.2, 0.05], light);
      for (const u of [-0.9, 0.9]) box([u, 0.7, 1.35], [0.15, 1.4, 0.14], steel);
    }
    if (!courtyard) {
      // Segmented protective walls follow exposed module edges, leaving a wide service opening.
      for (const [dx, dz] of [
        [-1, 0],
        [1, 0],
        [0, -1],
      ]) {
        if (
          slots.some(([sx, sz]) =>
            sx !== x || sz !== z ? Math.hypot(sx - x - dx * 3.6, sz - z - dz * 3.6) < 2.8 : false,
          )
        )
          continue;
        if (condition === "breached" && (index + dx + variant) % 3 === 0) continue;
        add([x + dx * 1.65, 0.5, z + dz * 1.65], [dx ? 0.15 : 3.3, 0.65, dz ? 0.15 : 3.3], wall);
        add([x + dx * 1.65, 0.86, z + dz * 1.65], [dx ? 0.18 : 3.3, 0.07, dz ? 0.18 : 3.3], trim);
      }
      // Watch mast at the exposed front corner; some sites use a low floodlight instead.
      const mastHeight = (variant + index) % 2 ? 2.8 : 1.6;
      add([x + 1.5, mastHeight / 2, z + 1.5], [0.12, mastHeight, 0.12], steel);
      add([x + 1.5, mastHeight, z + 1.5], [0.45, 0.12, 0.24], light);
    }
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
    for (const side of [-1, 1]) {
      add([side * 3.1, 0.65, 1.75], [0.18, 0.8, 2.5], wall);
      add([side * 3.1, 1.1, 1.75], [0.24, 0.1, 2.5], trim);
      add([side * 3.1, 1.75, 2.8], [0.12, 2.9, 0.12], steel);
      add([side * 3.1, 3.2, 2.8], [0.6, 0.14, 0.3], light);
    }
    // Feed pipes run back to the labs; console faces the open entry.
    for (const x of [-0.7, 0.7]) add([x, 0.48, -2], [0.16, 0.16, 2], steel);
    add([1.7, 0.75, 1.7], [0.65, 0.9, 0.6], wall);
    add([1.7, 1.23, 1.7], [0.56, 0.08, 0.5], light);
  }
  // A central service spine joins every module's apron, with inset edge markings.
  const minX = Math.min(...slots.map(([x]) => x)) - 1.6;
  const maxX = Math.max(...slots.map(([x]) => x)) + 1.6;
  if (!courtyard) add([(minX + maxX) / 2, 0.18, 0], [maxX - minX, 0.2, 1.6], steel);
  if (!courtyard) add([(minX + maxX) / 2, 0.29, 0], [maxX - minX - 0.2, 0.03, 0.12], trim);
  if (!courtyard)
    for (const [x, z] of slots) {
      if (z !== 0) add([x, 0.18, z / 2], [1.4, 0.2, Math.abs(z) + 0.5], steel);
    }
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
