import { ALL_BIOME_URLS, classifyPropUrl, type PropRole } from "../biomes";

// Shared role taxonomy + asset catalog for the dev-only editors
// (LevelEditorPanel + WorldMapEditorPanel). Side-effect-free so Rollup
// tree-shakes the whole editor out of production builds.

export const ROLE_ORDER: PropRole[] = ["building", "tree", "bush", "rock", "grass", "cosmetic"];

export const ROLE_LABEL: Record<PropRole, string> = {
  building: "Buildings",
  tree: "Trees",
  bush: "Bushes",
  rock: "Rocks",
  grass: "Grass",
  cosmetic: "Cosmetics",
};

export const labelFor = (url: string): string =>
  url
    .split("/")
    .pop()
    ?.replace(/\.(glb|gltf)$/i, "") ?? url;

export type CatalogEntry = { role: PropRole; url: string; label: string };

// Deduped, role-grouped catalog of every biome asset. A function (not an
// eager module const) so this module stays side-effect-free and Rollup can
// tree-shake the whole editor out of production builds.
export const buildCatalog = (): CatalogEntry[] =>
  Array.from(new Set(ALL_BIOME_URLS))
    .map((url) => ({ role: classifyPropUrl(url), url, label: labelFor(url) }))
    .sort(
      (a, b) =>
        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.label.localeCompare(b.label),
    );
