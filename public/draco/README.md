# Draco decoder (vendored)

Google Draco mesh decoder, served from this origin so the game can load its
Draco-compressed `public/models/*.glb` **without any network access**. Before
this existed the decoder was pulled from Google's CDN at runtime, which
meant: no models offline (a hard failure on the iOS/Android
shells and under App Review's network tests), a contradiction of the "runs
entirely offline, no network activity" claim in the store privacy
declarations, and the player's IP handed to Google on every launch.

## Provenance

Copied verbatim from `node_modules/three/examples/jsm/libs/draco/gltf/`.

| | |
| --- | --- |
| `three` version | **0.167.1** |
| Source directory | `three/examples/jsm/libs/draco/gltf/` |
| License | Apache License 2.0 — https://github.com/google/draco/blob/master/LICENSE |
| Upstream | https://github.com/google/draco |

The `gltf/` build is the right one: it is the decoder targeted by the
`KHR_draco_mesh_compression` extension, which is what `GLTFLoader` /
`DRACOLoader` actually feed. It is also roughly 40% smaller than the
general-purpose build in the parent directory.

## Keeping this in sync with `three`

**A decoder/loader version mismatch produces corrupt geometry, not a clean
error** — exploded or collapsed meshes rather than a thrown exception. So a
`three` upgrade must re-copy these files.

`src/dracoSetup.test.ts` byte-compares this directory against the installed
`three` package and fails `pnpm test` if they drift, so the upgrade cannot
land silently. When it fails, re-run:

```sh
cp node_modules/three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js \
   node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm \
   public/draco/
```

and update the version in the table above (the test checks that too).

## What is deliberately NOT here

- **`draco_decoder.js`** (512 KB) — the pure-JS decoder, used by `DRACOLoader`
  only when `typeof WebAssembly !== "object"`. The game already hard-requires
  WebAssembly (the Rapier physics engine is a `.wasm` module) and WebGL2, so
  any browser that would reach for this fallback cannot run the game at all.
  Shipping it would add half a megabyte of permanently dead weight to every
  store binary.
- **`draco_encoder.js`** — encoding is a build-time asset-pipeline concern.
  Nothing at runtime compresses a mesh.

## Wiring

`src/dracoSetup.ts` is the single place that points every consumer here.
