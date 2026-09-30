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
