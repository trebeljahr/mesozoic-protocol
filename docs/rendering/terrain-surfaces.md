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
  0.03. Do not add actor-height changes without updating the simulation.
- Use a coarse jittered triangle lattice, refining only shore triangles twice.
  Colour, UVs, blend weights and height depend only on position, keeping shared
  vertices continuous.
  Palette comes from the biome for banks. The full A5 soil treatment is currently
  level-4-only and is not an all-biome art-direction switch.
- The mesh is non-interactive, receives shadows, uses no post-processing passes, and disposes on
  replacement/unmount. Level 4 blends locally bundled photographic mud and
  compacted dirt with world-scaled UVs, wet-bank roughness and tangent normals.
  Low quality retains colour/roughness but skips both normal maps. Source images
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
