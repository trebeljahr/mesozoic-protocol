# Reuse this asset workflow for another game

This is the technical procedure for assembling this repository's store files. Copy the structure and adapt the catalog for another title. Do not reuse Mesozoic artwork, claims, app IDs or account details by accident.

## 1. Inventory before creating

Collect existing game screenshots, model reference sheets, icons, fonts and earlier art. Keep source material in a dated exploration folder. Save the prompt, tool/model where known, references, native size and approval state with each result. Export originals from the generation service immediately; browser history and temporary files are not an archive.

We used the existing Google Flow project and its game model ingredients for A/B/C, A2 and A3. Later edits used built-in ChatGPT image generation. The original A generation model is unknown. Flow displayed zero-credit requests during this session; that is historical information, not a guarantee for another account or date.

## 2. Select a direction before making every size

Review a small contact sheet, including a thumbnail-sized title test. Record both the selected version and rejected choices. Keep a separate visual target for game rendering if it differs from marketing artwork. Here B remains a game-art reference, while A5 is the approved marketing package.

Use separate landscape, portrait and text-free panoramic masters. A portrait cropped from a wide scene often loses the character or title space. For palette corrections, pass the actual approved color reference as an image and distinguish color instructions from composition instructions. Our successful A5 prompts preserve A4 geometry while restoring original A colors.

## 3. Typeset and export

Keep the title separate from the scene. Preserve the font and its license. A5 uses Rajdhani Bold with ivory `#e7e1cf`, pale cyan `#bfe4df` and outline `#0d1f20`. A transparent file must contain real transparent pixels, not a checkerboard painted into an opaque image.

The exact crop, title position and size values are in [a5-layout.json](recipes/a5-layout.json). The recovered assembly script is portable and writes into a separate output directory:

```sh
# Requires Node and ImageMagick (`magick` on PATH). Never overwrites approved sources.
node scripts/assemble-steam-artwork.mjs --out=/tmp/meso-artwork-rebuild
```

This recreates the deterministic layout from the committed masters and font. ImageMagick/font-renderer versions can change PNG bytes or text rasterization; visually compare before replacing approved exports. AI generation itself is not byte-reproducible. Preserve the approved master images rather than relying on prompts alone.

Inspect the small capsule at 120, 184 and 231 pixels wide; both portrait crops; the hero's safe area; and the transparent logo over the hero. Keep text off the hero master. Preserve proofs, but label simulated layouts as simulations. A5's official-template overlay is retained as a proof; rebuilding it requires downloading the current Valve template separately.

## 4. Capture actual gameplay separately

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

Play's retained feature graphic is 1024×500, opaque; its icon is 512×512. These are the existing earlier-branding exports, not newly approved A5 adaptations. Keep them until a replacement is selected.

For itch.io, retain the actual chosen cover and screenshot selection once recovered. For Microsoft Store, first choose the product/package type and inspect its listing slots. Do not treat the Windows executable icon as a complete store asset package. Trailers are a separate workflow and must represent actual gameplay.

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

Keep credentials, signing material, personal records and account-console screenshots out of the artwork package. Track remaining release operations in the project notes vault. The reusable technical memory is this file, the catalog, source manifests, recipes and scripts.
