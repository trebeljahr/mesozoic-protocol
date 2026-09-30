# Containment compounds

Level 4, default procedural seed, uses `ContainmentCompound` through
`WorldOutposts`. Other levels, reseeds and editor replacement use the existing
outpost templates. The visual reference is the approved A5 artwork in
`docs/store-assets/artwork-selection-2026-09-30/a5-original-palette/`.

## Layout rules

- `containmentLayout.ts` owns wall endpoints in simulation coordinates (x, y).
  Rendering maps them to (x, height, -y).
- Solid walls sit outside the 40 × 24 pilot movement rectangle. The west entry
  remains open around the existing route at y = -8. A separate opening admits
  the river. `wallClearsRoutes` checks the actual smoothed lanes with a margin
  covering thickness, buttresses and sampling error.
- `ContainmentWallRun` supplies connected concrete panels, caps, dark uprights
  and optional jagged ends. Keep wall height dominant over service sheds;
  keep tanks larger than crates. Palette belongs to these materials, not a
  scene-wide green tint.
- `ResearchDeck` stays inside the existing interior outpost reservation. It is
  an open work pad, not a closed room or a new navigation barrier. Canisters
  and cargo reuse existing render components/models.
- Outer service buildings sit outside pilot movement bounds and inside their
  existing colony reservations. Added rubble remains outside the playable
  rectangle and away from the entry route.
- Do not move footprints, paths or reservations just to fit art. A new layout
  with interior walls needs explicit simulation collision and placement work.

## Editor and compatibility

No world/save fields, paths, collision or build rules are changed. The west
procedural outpost is the perimeter's parent: erasing that outpost removes the
walls and debris. Erasing other outposts removes their replacement decks or
sheds. Full editor override and nonzero procedural seeds disable this layout.
The wall runs are not separate editor-selectable objects.

`containmentSceneryBlockers` reserves space only in outer cosmetic placement;
it does not remove gameplay trees or rocks. Keep terrain rendering independent.
All wall/deck geometry uses ordinary standard materials and works without
postprocessing. Canisters retain their existing low-cost translucent material.
There are no added dynamic lights, textures, physics bodies or per-frame loops.

## Extending

Author new wall lists and a level-specific gate; do not apply this scene to
other biomes implicitly. Validate the complete silhouette against pilot bounds,
smoothed routes, flow surfaces and HQ clearance. Add route/override checks, then
inspect fixed-camera gameplay and low quality rendering. Build success alone
does not establish visual acceptance against the A5 reference.

The level-4 north edge stays open: the long north wall, its detached remnant
and rubble, and the eastern exterior annex are omitted. The west breach and
central research tanks remain. This changes scenery only, not simulation
reservations or saved layouts.

## Command base

`CommandBase` replaces the assorted HQ kit cluster with one command block,
recessed doorway, shaded observation windows, roof ventilation, solar array and
communications mast. Local +Z faces the route endpoint. The 5.8×4.6 apron stays
inside the 4.5-unit HQ reservation. The defence turret, aiming, loss animation
and base upgrades remain driven by `HQTurret`; the command building is scenery.

Natural forest trees and shrubs use the generated meshes documented in
`public/models/natural/README.md`. The instanced renderers refresh bounding
spheres after matrix changes, including invisible hit discs, so selection tracks
loaded and removed props. Forest stone generation is disabled, with no hidden
obstacle left by the sampling fallback. Other biomes retain their prop sets.
