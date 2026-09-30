import type { Vec2 } from "../sim/types";

// Atlas geography is independent of nodePos, which also identifies the gameplay
// biome in legacy level data. Keep save IDs and battlefield climates unchanged.
const POSITIONS: readonly (readonly [number, number])[] = [
  [-29, -22],
  [-18, -21],
  [-11, -14],
  [-22, -12],
  [-30, -5],
  [-28, 4],
  [-17, 2],
  [-10, 10],
  [-19, 15],
  [-28, 22],
  [-17, 28],
  [-6, 27],
  [3, 22],
  [-4, 14],
  [3, 6],
  [7, -3],
  [-2, -5],
  [-3, -14],
  [4, -21],
  [12, -14],
  [22, -22],
  [30, -14],
  [22, -6],
  [32, 0],
  [24, 7],
  [32, 15],
  [27, 24],
  [16, 30],
  [13, 20],
  [15, 11],
];
export const mapLevelPosition = (id: number): Vec2 => {
  const [x, y] = POSITIONS[id - 1];
  return { x, y };
};
