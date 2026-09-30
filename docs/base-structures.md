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

`commandBuildingPlan.ts` supplies six operational HQ layouts: operations,
relay, hangar, logistics, containment, and radar. Standalone HQs have one
or two specimen bays where the actual approach lanes leave space. All keep the functional turret at the original
path endpoint and `HQ_GUN_DECK_HEIGHT`. The campaign selects them by level
and endpoint index with biome materials.

`commandComplexPlan` groups eligible rear docks. `sharedCommandGeometry`
replaces those groups' individual slabs and rear buildings with one apron,
central research halls, broad connecting wings, animated specimen tanks,
and an exterior perimeter. Research halls use six seeded roof profiles, including ventilation spines
and communications arrays; communications
and storage equipment occupy the rear flanks. Batteries use armored panels
and cooling vents instead of door-like hatches.

Shared structures must clear all gameplay paths and remain inside the union
of existing HQ reservation circles. Perimeter openings follow the actual
approach lanes. Unsafe or distant pairs remain separate. Coincident endpoints
share one architectural shell without changing simulation endpoints or guns.
The HQ scenery layer removes internal fences and keeps corpses outside the
shared facility. Geometry tests cover pairs, triples, and all campaign paths.

Campaign scenery combines its placement seed with the level ID. Module
height, structure mix, damage, and court equipment therefore stay stable
on rerender while varying between levels. Exposed module edges have
segmented protective walls and watch lights; wider service decks connect
the buildings. Courtyard sites retain their large specimen tanks and gain
guarded flanks. All additions fit the existing placement reservations.
