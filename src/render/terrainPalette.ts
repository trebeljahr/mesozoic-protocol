import type { Biome } from "../biomes";

// Linear-light surface tints. Non-forest habitats reuse the photographic
// mineral grain without importing green grass or fallen leaves into ice/ash.
export const TERRAIN_PALETTE: Record<
  Biome,
  {
    mineral: string;
    road: string;
    cover: string;
    coverAmount: number;
  }
> = {
  forest: { mineral: "#9b8d72", road: "#ae916a", cover: "#7d865d", coverAmount: 1 },
  snow: { mineral: "#cbd6dd", road: "#9ba9b3", cover: "#edf0ec", coverAmount: 0.8 },
  desert: { mineral: "#bea075", road: "#a78c65", cover: "#dfc393", coverAmount: 0.45 },
  wasteland: { mineral: "#93816a", road: "#a49179", cover: "#6d7062", coverAmount: 0.24 },
  lava: { mineral: "#65605b", road: "#897f78", cover: "#423f40", coverAmount: 0.35 },
  alien: { mineral: "#77718b", road: "#a497b4", cover: "#626d7b", coverAmount: 0.4 },
};

// Match the outer ground plane to the lit surface; avoid a saturated border.
export const TERRAIN_EDGE: Record<Biome, string> = {
  forest: "#59594c",
  snow: "#a0afb5",
  desert: "#a28c68",
  wasteland: "#7a715f",
  lava: "#53504d",
  alien: "#696276",
};
