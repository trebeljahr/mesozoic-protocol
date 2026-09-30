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
