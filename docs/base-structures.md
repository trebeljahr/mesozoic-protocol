# Base structure library

The level and world-map editors expose 18 reusable models in **Buildings**:
ribbed hangar, observation tower, terraced bunker, open service shed,
L-shaped field lab, and twin reservoir plant. Each has intact, weathered,
and breached versions. Select the model by name, then place, rotate, scale,
and combine it with other props using the existing editor tools.

`src/render/baseStructures.ts` owns the geometry. Campaign bases use this
same generator with biome palettes, mixing structures into compounds.
`src/render/modularBasePlan.ts` owns compound layouts and clearance scaling.
Tank courtyards retain their animated specimens, spills, and remains.

The editor models are neutral forest-colored static GLBs in
`public/models/base-structures/`. They use the existing model preview,
placement, collision, save, and stamp workflows. Rebuild after geometry edits:

```sh
pnpm assets:bases
```

Commit the generated models with their source. The asset test loads every
GLB, checks its building classification and docking envelope, and compares
its part count to the source. The compound tests check clearances across
biomes and damage states.

## Main command bases

`commandBuildingPlan.ts` supplies four operational HQ layouts: operations,
relay, hangar, and logistics. All keep the functional turret at the original
path endpoint and `HQ_GUN_DECK_HEIGHT`. The campaign selects them by level
and endpoint index with biome materials.

`commandComplexPlan` connects eligible rear docks with a minimal gallery
network. Every gallery edge must clear all gameplay paths and stay inside
the union of the existing HQ reservation circles. Unsafe or distant pairs
remain separate. Coincident endpoints share one architectural shell; this
does not alter the simulation's endpoints or guns. The HQ scenery layer
removes internal fences and keeps corpses off the galleries.
