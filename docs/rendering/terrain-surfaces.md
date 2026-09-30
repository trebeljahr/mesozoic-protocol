# Campaign terrain surfaces

`TerrainSurface` adds one static surface mesh beneath campaign actors.
Level 4 uses the full soil/path surface; other procedural fluid levels receive
only shoreline strips. `BiomeGround` is the separate world-map renderer.

- Derive lane distance from `world.paths`, with `PATH_WIDTH` as the legal core.
  Only the visual shoulder varies. `PathLine` retains spawn rings and debug
  overlays; authored overrides retain its original fill and outline.
- Derive shore distance from the union of `world.flowFeatures` rivers and lakes.
  Never add interior rings where those shapes overlap.
- Keep dry terrain at y=0.003. Shelf relief is confined inside existing fluid
  bounds and excluded from the lane plus bridge-approach margin. It peaks below
  0.01, below the water/foam surface. Do not add actor-height changes without updating the simulation.
- Use a coarse jittered triangle lattice, refining only shore triangles twice.
  Colour, UVs, blend weights and height depend only on position, keeping shared
  vertices continuous.
  Palette comes from the biome for banks. The full A5 soil treatment is currently
  level-4-only and is not an all-biome art-direction switch.
- The mesh is non-interactive, receives shadows, uses no post-processing passes, and disposes on
  replacement/unmount. Level 4 blends locally bundled photographic mud, compacted dirt, grass and leaf litter with world-scaled UVs, wet-bank roughness and tangent normals.
  Triangular stochastic patches vary texture rotation, scale and offset, with explicit
  UV gradients to avoid mip seams. Normal XY rotates back into the shared tangent
  frame. Broad, overlapping habitat weights soften grassy/leaf-covered transitions;
  the compacted route keeps a consistent lighter core for tactical readability.
  Lane and union-shore weights preserve tracks and wet banks.
  Low quality retains colour/roughness but skips all four terrain normal maps. Source images
  are CC0 from Poly Haven; per-asset `source.json` files under
  `public/textures/terrain/` record URLs and SHA-256 hashes.
- Editor overrides skip this layer because authored rivers use spline sampling;
  adding authored support requires sampling exactly the same spline and honoring
  the editor's persisted geometry. Do not use the control polygon as its bank.

For development review, use a muted local dev server on an unused high port:

```sh
BASE_URL=http://127.0.0.1:PORT node scripts/capture-terrain-review.mjs /tmp/terrain.png 4
BASE_URL=http://127.0.0.1:PORT node scripts/capture-terrain-review.mjs /tmp/terrain-low.png 4 low
BASE_URL=http://127.0.0.1:PORT node scripts/capture-terrain-review.mjs /tmp/lava.png 23
```

The script uses a fresh browser context, default camera, campaign seed 0,
1440×1000 viewport, and no combat. It closes its browser even on failure.
These captures are development evidence, not approved store media.

Water foam uses the union shore distance and two animated noise scales. Broken
patches gather near banks; lake/river joins have no interior foam outlines. Lava
retains its crust treatment.

## World map

`worldMapLandscape.ts` owns campaign curves, facility access spurs, habitat
masses and the three default pools. Ground shoulders and prop clearances sample
those same curves. Grove species, understory and stones share deterministic
anchors; progress only appends remains after the permanent layout is complete.

`BiomeGround` keeps the editor's flat ground plane and concentrates vertices
around the visible atlas. Its mineral/cover weights blend by habitat, with
leaf litter under forest groves, compacted access tracks and damp shores.
`WorldMapSoilMaterial` uses the battlefield's bundled soil textures with
stochastic sampling and rotated tangent normals; low quality omits normals.
The map uses `SceneryBatches` for bounded instancing and shares campaign
`ResearchDeck`/`ServiceAnnex` architecture at six reserved regional sites.
Procedural prop and facility erasure keys remain position-derived.
