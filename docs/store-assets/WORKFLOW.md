# Reuse this asset workflow for another game

This is the technical procedure for assembling this repository's store files. Copy the structure and adapt the catalog for another title. Do not reuse Mesozoic artwork, claims, app IDs or account details by accident.

## 1. Inventory before creating

Collect existing game screenshots, model reference sheets, icons, fonts and earlier art. Keep exploratory source material in the project vault under `assets/design-history/<date>/<topic>/`; promote selected production masters into this repository. Save the prompt, tool/model where known, references, native size and approval state with each result. Export originals from the generation service immediately; browser history and temporary files are not an archive.

We used the existing Google Flow project and its game model ingredients for A/B/C, A2 and A3. Later edits used built-in ChatGPT image generation. The original A generation model is unknown. Flow displayed zero-credit requests during this session; that is historical information, not a guarantee for another account or date.

## 2. Select a direction before making every size

Review a small contact sheet, including a thumbnail-sized title test. Record both the selected version and rejected choices. Keep a separate visual target for game rendering if it differs from marketing artwork. Here the user subsequently clarified that the uploaded A5 package is also the primary in-game target; the earlier B preference is historical. Assess an integrated playable scene against the actual A5 capsules and hero before calling the visual pass complete.

Use separate landscape, portrait and text-free panoramic masters. A portrait cropped from a wide scene often loses the character or title space. For palette corrections, pass the actual approved color reference as an image and distinguish color instructions from composition instructions. Our successful A5 prompts preserve A4 geometry while restoring original A colors.

## 3. Typeset and export

Keep the title separate from the scene. Preserve the font and its license. A5 uses Rajdhani Bold with ivory `#e7e1cf`, pale cyan `#bfe4df` and outline `#0d1f20`. A transparent file must contain real transparent pixels, not a checkerboard painted into an opaque image.

The exact crop, title position and size values are in [a5-layout.json](recipes/a5-layout.json). The recovered assembly script is portable and writes into a separate output directory:

```sh
# Requires Node and ImageMagick (`magick` on PATH). Never overwrites approved sources.
node scripts/assemble-steam-artwork.mjs --out=/tmp/meso-artwork-rebuild
```

This recreates the deterministic layout from the committed masters and font. ImageMagick/font-renderer versions can change PNG bytes or text rasterization; visually compare before replacing approved exports. AI generation itself is not byte-reproducible. Preserve the approved master images rather than relying on prompts alone.

Inspect the small capsule at 120, 184 and 231 pixels wide; both portrait crops; the hero's safe area; and the transparent logo over the hero. Keep text off the hero master. Preserve proofs, but label simulated layouts as simulations. A5's official-template overlay is retained in the vault design archive; rebuilding it requires downloading the current Valve template separately.

The other-store format recipe uses the already approved scene and logo layers; it does not regenerate artwork:

```sh
node scripts/assemble-other-store-artwork.mjs --out=/tmp/meso-other-store-candidates
```

[other-stores-layout.json](recipes/other-stores-layout.json) records crop anchors, title placement, dimensions and official references checked on 30 September 2026. The script uses the existing `sharp` dependency, one worker and a bounded cache. It writes seven exports, a contact sheet and source hashes. Review the sheet in recipe order before copying outputs into a dated source folder and adding them to the catalog. Opaque formats have their alpha channel removed after compositing. Shortcut PNG retains real transparency; Steam app JPG flattens against the native icon background.

## 4. Capture actual gameplay separately

**Current decision, 30 September 2026:** fresh screenshots wait until game visuals improve. Trailer capture is also deferred pending that pass; the existing trailer-and-asset-plan in the project notes vault contains reference shot lists. Recheck those older feature claims against the game before recording.

Desktop sources are in `public/screenshots/`; the curated package copies them into `current/shared/gameplay-desktop/`. Use full-size images, not `-thumb` files. Never place concept art in gameplay screenshot slots.

Mobile capture tooling already exists:

```sh
pnpm screenshots:store:list
# Start a muted dev server on an unused high port, as required by AGENTS.md.
# Use its actual address. The capture hook needs DEV, not a production preview.
BASE_URL=http://127.0.0.1:YOUR_PORT pnpm screenshots:store --only=ios-iphone-6.9,ios-ipad-13
```

The size table and scene names live in `scripts/store-screenshots.mjs`; shared scene drivers live in `scripts/lib/capture-scenes.mjs`. Raw captures go to ignored `store-screenshots/`. They render each aspect ratio rather than crop the HUD from a desktop image. This still does not establish native-device fidelity: inspect actual iPhone/iPad/Android layouts and controls before approving a set. Copy reviewed outputs into a dated source folder under `docs/store-assets/`, catalog them, and commit the selected files. Stop only the preview processes you started.

The existing six Play PNGs are historical references with inconsistent crops/dimensions. They are deliberately excluded from `current/`. No approved mobile screenshot set was recovered during this consolidation.

## 5. Native icons and other stores

`src-tauri/icons/source.png` is the native icon source. `pnpm sync:native-assets` derives the iOS icon, Android launchers and splash assets; see [DISTRIBUTION.md](../../DISTRIBUTION.md). The App Store icon is carried by the build, so uploading a file to a folder does not update an existing build.

Play's retained JPG is the earlier uploaded feature graphic. The new opaque 1024×500 `feature-graphic-a5.png` is the local replacement. Keep the historical JPG as an upload reference. The 512×512 icon remains the existing native branding.

The new itch cover is 630×500 (315:250 ratio). Its old uploaded cover was not recovered; do not claim byte identity. Microsoft box/poster/hero files are candidates using published dimensions. Choose the product/package type and inspect live slots and bottom-third overlays before upload. Never use these scene exports as gameplay screenshots. The Microsoft hero is text-free and is not a trailer thumbnail; derive that thumbnail from eventual footage.

## 6. Verify and upload

1. Review the current official slot requirements and record the date. The table below is a source directory, not a claim that sizes never change.
2. Add each selected source, upload path, slot, dimensions, alpha rule and status to `catalog.json`.
3. Run `pnpm assets:store`, inspect the results, then run `pnpm assets:store:check`.
4. Upload per store, inspect previews and language/category assignments, then save. On Steam, two 920×430 files need distinct Header Capsule and Library Header assignments.
5. Use Steam's placement tool for the separate logo. Bottom-left worked for A5; verify at different widths and with client scrolling before launch.
6. Record uploaded versus locally ready versus publicly published separately. A successful upload is not a release.
7. If AI generated marketing art, include it when answering a store's AI disclosure question. Do not infer that procedural rendering or ordinary code assistance is the same as generated player-facing content; read the actual question.

Steam's legacy drop zone did not expose a usable file chooser in our browser automation. Native cross-window dragging also proved unreliable. The successful handoff was: open the exact export folder beside the store editor, let the user drag the eight PNGs, then verify the slots and logo alignment. Do not spend repeated attempts on synthetic drag events or hidden file inputs.

| Reference | Official source |
| --- | --- |
| Steam capsules | https://partner.steamgames.com/doc/store/assets/standard |
| Steam library / hero / logo | https://partner.steamgames.com/doc/store/assets/libraryassets |
| Steam asset rules | https://partner.steamgames.com/doc/store/assets/rules |
| Steam client icons | https://partner.steamgames.com/doc/store/assets/community |
| Play listing images | https://support.google.com/googleplay/android-developer/answer/9866151 |
| Apple screenshots | https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications |
| Apple icon | https://developer.apple.com/help/app-store-connect/manage-app-information/add-an-app-icon |
| itch.io project setup | https://itch.io/docs/creators/getting-started |
| Microsoft MSI/EXE images | https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/screenshots-and-images |
| Microsoft MSIX dimensions and placement | https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images |

Keep credentials, signing material, personal records and account-console screenshots out of the artwork package. Track remaining release operations in the project notes vault. The reusable technical memory is this file, the catalog, source manifests, recipes and scripts.

## Design history location

See [the archive guide](DESIGN-HISTORY.md). Store rejected concepts, crop studies, render comparisons, and historical QA media in the project vault, with captions and provenance. Ignore binary design-history media in vault Git; track the lightweight index and metadata. Verify copies and repair links before removing originals. Approved masters, selected exports, fonts/licenses, recipes, and technical rendering contracts stay here so a clean checkout remains usable.
