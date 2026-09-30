# Blender asset pipeline

Author in Blender; deliver embedded GLB files to the existing Three.js renderer. The design brief and proposed roster live in the notes vault at `projects/mesozoic-protocol/mesozoic-protocol-creature-and-environment-workflow.md`.

## Local connection

Verified on 2026-09-30: Blender 5.2.2 LTS, `mcp-for-blender==2.1.1`, add-on protocol 11. Blender is installed at `/Applications/Blender.app`; the add-on is enabled in its user preferences. Codex's user configuration contains:

```toml
[mcp_servers.blender]
command = "/opt/homebrew/bin/uvx"
args = ["mcp-for-blender==2.1.1"]

[mcp_servers.blender.env]
DISABLE_TELEMETRY = "true"
BLENDER_HOST = "127.0.0.1"
BLENDER_PORT = "9876"
```

Open Blender, then open the viewport sidebar with **N → MCP for Blender → Start MCP Server** if it has not started automatically. Reload Codex to load newly registered MCP tools. First call `get_addon_status`, then `get_scene_info`. Inspect the current scene before editing it. Save before mutations. The add-on executes Python with Blender's local permissions; keep its socket local and do not expose it to the network.

No external model-generation account is required. Provider integrations remain disabled. Do not update just the server or just the add-on: pin and verify both together. The tested upstream package includes the add-on installer:

```sh
DISABLE_TELEMETRY=true /opt/homebrew/bin/uvx mcp-for-blender==2.1.1 install-addon
```

[Blender MCP upstream](https://github.com/ahujasid/mcp-for-blender) · [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

## Asset source contract

- One `.blend` per asset. Use `assets/blender/<asset-id>/<asset-id>-v001.blend` for approved project sources. Keep temporary experiments outside shipped `public/`.
- Put runtime meshes, their armature, and required parent empties in a collection named `EXPORT`. Keep lights, cameras, reference art, and review geometry outside it. No parent or armature dependency may live outside `EXPORT`.
- For a dinosaur, keep exactly one armature and one NLA track per clip, with one action strip on each track. Use `Idle`, `Walk`, `Run`, `Attack`, and `Death` for new assets. Existing species-prefixed names are accepted by the renderer and should be preserved when editing originals.
- Animate locomotion in place. Game simulation owns translation and turning. Bake constraints/IK into exported animation, retain the editable control rig in the source, and inspect feet, jaws, tail tips, and silhouette through the entire cycle.
- Work in consistent metric units. Apply intended mesh transforms before rigging; never blindly apply armature transforms to an existing animated asset. GLB uses Y-up; the exporter handles Blender's axis conversion. Match an imported game reference's forward direction and verify in game.
- Use Principled BSDF materials and embedded textures. Bake unsupported procedural material effects. Separate skin, alloy, and tiny emission accents. Keep broad facets visible; avoid transparent leaf layers for the first tree set.
- Trees and decor are static meshes. The current renderer instances them and derives placement footprints from lower geometry. Skeletal wind animation requires separate runtime work.

## Export and preflight

From the repository root, with a saved source file containing the `EXPORT` collection:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  assets/blender/raptor/raptor-v001.blend \
  --python-exit-code 1 --python scripts/blender/export_asset.py -- \
  --kind enemy --output /private/tmp/raptor-v001.glb

python3 scripts/blender/inspect_glb.py --kind enemy /private/tmp/raptor-v001.glb
```

Use `--kind prop` for static trees/props. Choose a fresh output filename each time; the exporter refuses to overwrite. It exports only `EXPORT` (excluding bone display widgets), samples NLA clips, checks the result, then publishes the candidate file. It does not save changes to the source `.blend`, compress, or replace any game asset.

The preflight reports bytes, triangles, primitives, materials, joint counts, clip names/end times, required extensions, and SHA-256. It rejects external resources, empty meshes, missing enemy skin/locomotion/attack/death, and animated props. It is a structural screen, not a complete glTF validator or visual sign-off. It does not prove correct weights, material appearance, root motion, animation contact, or mobile performance.

Starting budgets, to revise after profiling: ordinary enemies 1,200–3,000 triangles, about 29 joints, 1–3 materials (existing parasaur uses four); ordinary trees 300–1,200 triangles, 1–2 materials. Current dinosaurs span 1,248–2,278 triangles. Larger exceptions need a measured reason. Uncompressed GLBs are intentional during review; texture reduction and compression come after approval.

## Game integration

1. Re-import the candidate GLB into a clean Blender scene. Confirm clips, textures, bounds, normals, and deformation survived. Inspect both neutral light and the actual game lighting.
2. Add approved GLBs under versioned paths in `public/models/`; retain old files until the replacement is accepted. Keep provenance and original pack/license references with the source. Current credits identify the base dinosaurs as Quaternius Animated Dinosaurs.
3. Update both `src/render/Scene.tsx` and `ENEMY_MODEL`/`BOSS_VARIANT_MODEL` in `src/sim/world.ts`. They currently duplicate URLs and some sizes differ; neither table alone updates every consumer. `ModelEnemyMesh` normalizes the maximum visible dimension to `targetSize`, not height.
4. Check icon/preview framing in `src/ui/EnemyIcon.specs.ts`, `EnemyPreview.tsx`, preloads, death pooling, hit flashes, chip VFX, shield/eye anchors, and matriarch footsteps. Walk/run and attack are selected by clip-name matching; a new `Charge` or `Spit` clip alone does not create gameplay.
5. New enemy kinds also need simulation stats/behavior, `EnemyKind`, wave/spawner entries, text/localization, compendium/alerts, rewards, and encounter tests. Do this only after a role is selected. Existing `shielded`, `healAura`, and `regen` chips are reusable.
6. Trees use `BIOME_TREE_URLS` in `src/biomes.ts`; preserve the four-variant contract. `Trees.tsx` normalizes height and calculates root footprints. Check tower placement, tree selection/removal, and path occlusion.
7. Run typecheck/build, relevant behavior tests, and enemy-text/i18n checks when those surfaces change. Review the same level, camera, quality, and wave before/after; test desktop and landscape phone at low/medium/high quality and representative enemy counts. Record frame time and draw calls before approving higher budgets.

## Verified scope

MCP initialization, add-on status, scene query, Python execution, and exports of copies of `Velociraptor.glb` and `nature/Tree1.glb` passed. The raptor retained all six named animations. The game's Three.js GLTFLoader loaded both exports, matched raptor clip names/durations to the original, and produced finite bounds at four sampled times per clip. This establishes the authoring/export path; it is not an approval of new art or a visual comparison inside the game. No shipped model or gameplay rule was changed by setup.
