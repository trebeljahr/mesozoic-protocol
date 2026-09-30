# Store asset library

**Start here.** [Current upload files](current/) · [Asset manifest](current/manifest.json) · [Assembly guide](WORKFLOW.md) · [Catalog](catalog.json)

The selected artwork is **A5 / original A palette**, approved on 30 September 2026. The earlier experiments remain archived. These files are outside `public/` so the upload package does not increase the shipped game's size.

![Approved A5 artwork and layout proofs](artwork-selection-2026-09-30/a5-original-palette/review-sheet.jpg)

## Files to use

| Store / purpose | Location | State as of 30 September 2026 |
| --- | --- | --- |
| Steam capsules, hero, transparent logo | [current/steam](current/steam/) | Eight approved exports. User completed uploads; Steam's store and library checklists pass. |
| Steam Linux client icon bundle | [current/steam/client](current/steam/client/) | Original upload ZIP recovered from temporary storage. |
| Desktop gameplay screenshots | [current/shared/gameplay-desktop](current/shared/gameplay-desktop/) | Eight existing captures for Steam/itch. Review freshness and select the shots to upload. |
| Google Play icon and feature graphic | [current/google-play](current/google-play/) | Existing assets; draft uploads recorded in rollout audit. These predate A5 and retain the earlier icon branding. |
| App Store icon | [current/app-store](current/app-store/) | Opaque 1024×1024 icon from the native asset catalog. Normally delivered in the app build. |
| Shared icon master / desktop icons | [current/shared](current/shared/) | Existing master, ICO and ICNS. Changes to these copies do not update the native projects. |
| Apple / Play mobile screenshots | Not yet approved | Capture tooling exists. Legacy [Play screenshots](google-play/) are reference only, not a validated phone/tablet set. |
| itch.io cover | Exact upload source not recovered | Draft cover and five screenshots were uploaded in the earlier rollout. Do not substitute a random capsule and call it the uploaded cover. |
| Microsoft Store | Not yet assembled | Product listing is not created. Select requirements for its actual product type before exporting. |
| Gameplay trailer | Missing | Generated key art is not a gameplay trailer or screenshot. |

`current/` is a committed upload snapshot, assembled by **copying** catalogued source files. It contains no generated replacement art. The manifest records dimensions, source paths, SHA-256 hashes, status and known gaps. A populated folder does not mean the store is published.

## Steam drag-and-drop map

Drag the **eight PNGs at the top level of `current/steam/`** into Graphical Assets → “Drop images here to upload.” Do not drag the `client` subfolder or the manifest.

| File | Steam slot | Pixels |
| --- | --- | --- |
| header-capsule.png | Header Capsule | 920×430 |
| small-capsule.png | Small Capsule | 462×174 |
| main-capsule.png | Main Capsule | 1232×706 |
| vertical-capsule.png | Vertical Capsule | 748×896 |
| library-capsule.png | Library Capsule | 600×900 |
| library-header.png | Library Header | 920×430 |
| library-hero.png | Library Hero, no title | 3840×1240 |
| library-logo.png | Library Logo, transparent | 1280×441 |

Header Capsule and Library Header have identical dimensions and bytes but require **two separate assignments**. Use English as the base asset language. Save the library logo at the **bottom-left** anchor. The live Steam preview showed the title readable beside the central mech; a real client resize/parallax test remains separate. Steam reported the uploaded logo as 1280×720, while the retained local logo is 1280×441: the live upload bytes were not downloaded or compared, so their exact identity is unverified.

Steam app ID: `4798230`; store editor record: `1202837`. [Store editor](https://partner.steamgames.com/admin/game/edit/1202837?activetab=tab_graphicalassets&subtab=library). Client icons belong under Steamworks client images, not capsule slots. Upload/save, survey publication, store review, Coming Soon publication and game release are separate operations.

## Exploration and decisions

- [A / B / C contact sheet](artwork-selection-2026-09-30/selection-sheet.jpg), [original images](artwork-selection-2026-09-30/originals/) and [exact Flow prompts](artwork-selection-2026-09-30/flow-prompts.json).
- **A:** strongest palette and drama, initially too busy. **B:** preferred reference for future in-game visual work. **C:** least preferred.
- **A2:** cleaner landscape, too calm. **A3:** restored breach action.
- [A4](artwork-selection-2026-09-30/a4-steam/): established portrait/hero layouts, but its cobalt/yellow palette was rejected. Do not upload these exports.
- [A5](artwork-selection-2026-09-30/a5-original-palette/): approved layouts with A's charcoal/petrol teal, tan/rust, cyan-white weapon light and localized green tank glow. [Prompts](artwork-selection-2026-09-30/a5-original-palette/prompts.json), [masters](artwork-selection-2026-09-30/a5-original-palette/), [crop/alignment proofs](artwork-selection-2026-09-30/a5-original-palette/proofs/).
- [Production recipe](recipes/a5-layout.json), [portable export script](../../scripts/assemble-steam-artwork.mjs), [Rajdhani Bold and license](sources/fonts/).

The A5 hero was upscaled from 2170×725 to the required 3840×1240. The title is **typeset Rajdhani Bold**, not generated lettering. The scenes are AI-generated marketing art, not evidence of game graphics. AI use in Steam marketing was disclosed in the content survey on 30 September 2026.

## Maintain this package

```sh
pnpm assets:store        # copy the selected sources and write the manifest
pnpm assets:store:check  # read-only checks of copies, hashes, sizes and alpha
```

Edit the sources and `catalog.json`, then rebuild and review the diff. Never edit `current/` directly. Preserve an old approved package before selecting a new one. The checker rejects stale or extra files; remove superseded current copies explicitly after archiving them.

Historical listing notes under `steam/`, `google-play/` and `app-store/` are not authoritative status records. The current rollout audit lives in the separate notes vault: `projects/mesozoic-protocol/mesozoic-protocol-store-rollout-audit.md`. This repo owns the asset bytes, recipes, upload mappings and verification tools.
