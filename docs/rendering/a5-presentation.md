# A5 gameplay presentation

Level 4 (Marsh Breach) is the integrated showcase for the approved A5 capsule
and library hero. Those illustrations guide material hierarchy and composition;
the playable camera keeps the full tactical field accessible. This does not
establish visual acceptance for all biomes.

## Reusable rules

- Build depth with geometry, directed light and grouped silhouettes first.
  A global green tint, extra scatter or a stronger grade cannot supply walls,
  broken edges or terrain contact.
- Keep the key warm and the fill cool. Current gameplay key is at `[14,26,10]`,
  intensity 3; environment fill is .22, ambient .16 and hemisphere .48.
  Keep fill below the key so upright faces differ from roofs and ground.
- `waterShader.ts` uses the normalized key direction `[.451,.838,.322]`.
  Change both contracts together if moving the sun. Light and water direction
  did not change in this pass.
- Preserve neutral material midtones. Petrol shadow fill and tan/rust highlights
  should reveal local materials. Green belongs primarily to research tanks;
  cyan energy remains a small bright combat accent.
- Bloom selection and HDR threshold remain separate from material exposure.
  Do not brighten whole meshes to obtain muzzle or lightning bloom. Keep depth
  tests and corrected lightning-core treatment intact.
- Keep dust sparse (.12 forest density) so particles do not compete with targets.
  Ground contact comes from correctly grounded geometry and cast shadows, not
  floating dark decals or heavy screen-wide ambient occlusion.

## Camera and interaction

`cameraFraming.ts` owns the shared battle pose and fit calculation. The base is
`[0,24,20]`, about 40 degrees from vertical; orbit limits remain .35–.75 radians.
The Z half-extent factor is `hypot(y,z)/(2*y)`, derived from the actual pose.
Fit uses both map bounds and route extrema, with larger margins on phones.
Start zoom is 1.08 times fit; users can pull back to fit or zoom in to 2.5 times
fit (absolute maximum 80). Starting slightly inside fit leaves a small pan range.

Preserve level/viewport recentering, loss-shake reset, build/aim gesture
reservation, editor pointer ownership, touch pan/pinch and existing yaw controls.
Keep this orthographic tactical view; do not copy the illustration's low
perspective at the cost of aiming or route visibility.

## Acceptance procedure

Use campaign level 4, procedural seed 0, a fresh local browser context and muted
audio. Capture baseline and final at identical viewport, pose and zoom; distinguish
a comparison pose from any changed default camera. Check walls and tank scale,
terrain/bank contact, lit versus shadowed faces, cyan effects, tower selection,
hero movement and a real wave. Repeat at low quality and phone aspect ratios.
Review save-slot and world-map transitions. Development captures are not store
screenshots, and a build passing is not visual acceptance.

Terrain and architecture contracts live alongside this document. Preserve editor
overrides, flat build surfaces, route clearance and save compatibility when
extending the showcase to other levels.
