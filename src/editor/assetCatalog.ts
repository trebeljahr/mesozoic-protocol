import {
  ALL_BIOME_URLS,
  type Biome,
  biomeAssetUrls,
  classifyPropUrl,
  type PropRole,
} from "../biomes";
import type { Stamp } from "./stampLibrary";

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

// Discriminated union — model entries are atomic GLB swatches, stamp entries
// are saved multi-prop arrangements that re-drop as a unit. The `role` field
// drives palette bucketing for both: a stamp's role is derived from its
// centroid-nearest child so a "campsite" of tree-heavy props lands in the
// Trees bucket next to the individual trees it composes.
export type CatalogEntry =
  | { kind: "model"; role: PropRole; url: string; label: string }
  | {
      kind: "stamp";
      role: PropRole;
      stampId: string;
      label: string;
      childCount: number;
      // First few child urls — feeds the composite 2×2 StampPreview tile so
      // the palette doesn't have to load every child of every stamp just to
      // render a thumbnail.
      sampleUrls: string[];
    };

// Deduped, role-grouped catalog of every biome asset. A function (not an
// eager module const) so this module stays side-effect-free and Rollup can
// tree-shake the whole editor out of production builds. Pass a biome to
// restrict the catalog to that biome's roster (layers + trees + cosmetics +
// story props); omit to get every asset across every biome.
export const buildCatalog = (biome?: Biome): CatalogEntry[] => {
  const urls = biome ? biomeAssetUrls(biome) : ALL_BIOME_URLS;
  return Array.from(new Set(urls))
    .map(
      (url): CatalogEntry => ({
        kind: "model",
        role: classifyPropUrl(url),
        url,
        label: labelFor(url),
      }),
    )
    .sort(
      (a, b) =>
        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.label.localeCompare(b.label),
    );
};

// Build catalog entries from a stamp library. Each stamp's role is the role
// of its centroid-nearest child — already computed at save time and stored
// on the stamp, so the palette doesn't re-classify per render. `sampleUrls`
// is capped at 4 for the 2×2 StampPreview tile.
export const buildStampEntries = (stamps: Stamp[]): CatalogEntry[] =>
  stamps
    .map(
      (s): CatalogEntry => ({
        kind: "stamp",
        role: s.role,
        stampId: s.id,
        label: s.label,
        childCount: s.childCount,
        sampleUrls: s.children.slice(0, 4).map((c) => c.url),
      }),
    )
    .sort(
      (a, b) =>
        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.label.localeCompare(b.label),
    );
