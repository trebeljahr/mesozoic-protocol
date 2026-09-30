> Historical prompt reference. Current selection and exports: [store asset library](README.md).

# Mesozoic Protocol — store art generation prompts

Copy-paste, self-contained image prompts for every store asset, anchored to the existing key art
(the breached-wall / mech + turrets vs. reanimated dinosaurs piece). **Feed that key-art image into
the generator as a style + character reference alongside each prompt** so every asset stays on-model.
Generate larger than the target, then crop/resize to the exact pixels in the table at the bottom.
Reusable cross-project template lives in Claude memory (`store-art-asset-specs-and-prompts`).

---

## 1. ICON EMBLEM → App Store 1024², Play 512², Steam icon
```
App-icon emblem for the game 'Mesozoic Protocol'. Semi-realistic stylized painterly style — clean confident shapes, dramatic rim lighting, glowing energy, not photoreal and not cutesy. A single bold iconic mark: the head of a boxy battle mech (olive-green and tan armor plating) in three-quarter view, its single glowing cyan camera-eye front and center, framed inside a dark hexagonal tech badge with thin cyan circuit etching and a faint toxic-green rim glow. Centered, symmetrical, heavy silhouette, minimal deep teal-black background, no text, crisp and legible at very small sizes. Palette: deep teal-black (#0b1016), electric cyan (#5ad6ff), toxic green, amber accents (#ffd66a). Square composition.
```
Export: **App Store** 1024×1024 PNG no alpha, flat (no rounded corners), sRGB · **Play** 512×512 PNG with alpha · **Steam** 32×32 + 184×184 PNG.

## 2. LOGOTYPE / WORDMARK → Steam Library Logo (chroma-key to transparent)
```
Game logo on a solid, flat, pure magenta background (#FF00FF) for the game 'Mesozoic Protocol'. The wordmark 'MESOZOIC PROTOCOL' in bold uppercase, wide letter-spacing, a rugged military/tech stencil typeface, cyan-white lettering with a subtle amber edge glow, and a small scaffolding-bone-and-circuit motif fused into the letterforms. No scene, no other background elements, the flat magenta filling the entire frame evenly, subject centered with generous even padding. Palette: electric cyan (#5ad6ff) and amber (#ffd66a) lettering on flat magenta (#FF00FF).
```
Export: generate on flat magenta, then remove the background (sprite-tools or any keyer) → transparent **PNG** up to **1280×720**. Magenta is chosen because it appears nowhere in the cyan/amber logo, so it keys out cleanly.

## 3. LANDSCAPE HERO → Steam Header 920×430, Main 1232×706, Play Feature 1024×500
```
Steam capsule / feature-graphic key art for the game 'Mesozoic Protocol'. Widescreen cinematic composition, semi-realistic stylized painterly style with dramatic rim lighting and glow. A boxy piloted battle mech (olive-green and tan armor plating, a single glowing cyan camera-eye, dual arm-cannons firing bright cyan energy beams) mid-stride in the foreground-left, a sci-fi gatling turret on a hexagonal base flanking each side firing cyan beams. Behind, through a jagged breach in a cracked concrete containment wall, a pack of reanimated raptors with glowing eyes and a low-poly armored ceratopsian charge past tall glowing toxic-green specimen tanks, while a colossal apatosaur silhouette and an erupting volcano rise against a smoky red-orange sky; cyan lightning arcs overhead and orange embers rain down. Title 'MESOZOIC PROTOCOL' in the lower-left third, bold uppercase wide-tracked military-stencil lettering, cyan-white with an amber edge glow. Keep the title and the mech off dead-center and clear of the edges. Palette: deep teal-black (#0b1016), toxic green, electric cyan (#5ad6ff), amber-orange (#ffd66a). Tense heroic sci-fi last stand.
```
Export: **Header** 920×430 · **Main** 1232×706 · **Play Feature** 1024×500 (no alpha; nothing critical dead-center).

## 4. PORTRAIT HERO → Steam Vertical 748×896, Library Capsule 600×900
```
Vertical poster key art for the game 'Mesozoic Protocol'. Semi-realistic stylized painterly style, cinematic, dramatic rim lighting and glow. A boxy piloted battle mech (olive-green and tan armor plating, a single glowing cyan camera-eye, dual arm-cannons firing bright cyan energy beams) front-and-center, a sci-fi gatling turret low on each side firing cyan beams. A jagged breach in a cracked concrete containment wall frames the scene; a pack of reanimated raptors with glowing eyes and a low-poly armored ceratopsian flank the mech, tall glowing toxic-green specimen tanks behind them, a colossal apatosaur silhouette and an erupting volcano rising against a smoky red-orange sky, cyan lightning across the top, orange embers falling. Title banner 'MESOZOIC PROTOCOL' across the lower third, bold uppercase wide-tracked military-stencil lettering, cyan-white with an amber edge glow. Bold, centered, poster-like. Palette: deep teal-black (#0b1016), toxic green, electric cyan (#5ad6ff), amber-orange (#ffd66a).
```
Export: **Vertical** 748×896 · **Library capsule** 600×900.

## 5. SMALL CAPSULE → Steam 462×174
```
Compact wide store thumbnail for the game 'Mesozoic Protocol'. Semi-realistic stylized painterly style, high contrast. The title 'MESOZOIC PROTOCOL' dominates the frame in bold uppercase wide-tracked military-stencil lettering, cyan-white with an amber edge glow; beside it, the head of a boxy olive-and-tan battle mech with a glowing cyan camera-eye and one bright cyan arm-cannon beam. Simple dark teal-black background with a faint toxic-green tank glow and a few orange embers. Minimal clutter, legible at thumbnail scale. Palette: deep teal-black (#0b1016), electric cyan (#5ad6ff), amber (#ffd66a), toxic green.
```
Export: **462×174**.

## 6. LIBRARY HERO → Steam 3840×1240 (NO title — Steam overlays the logo bottom-left)
Steam only lets the logo anchor to 4 spots: **left bottom corner · centered top · centered middle · centered bottom**. This prompt reserves the **lower-left** for it.
```
Wide environmental banner key art for the game 'Mesozoic Protocol', with NO title or logo text (Steam overlays a separate logo layer). Ultra-widescreen cinematic composition, semi-realistic stylized painterly style with atmospheric haze and glow. A breached revival-biotech dinosaur facility: a boxy piloted battle mech (olive-green and tan armor, glowing cyan camera-eye, dual cyan arm-cannon beams) with flanking sci-fi gatling turrets as the focal point in the center-to-right, a jagged breach in a cracked concrete containment wall, tall glowing toxic-green specimen tanks, a pack of reanimated raptors with glowing eyes and a colossal apatosaur silhouette, an erupting volcano against a smoky red-orange sky, cyan lightning arcing across, orange embers falling. Keep the lower-left quarter a calm, darker, uncluttered area (ground shadow, smoke, haze) reserved for the game logo. Keep the main action within the central horizontal band. Palette: deep teal-black (#0b1016), toxic green, electric cyan (#5ad6ff), amber-orange (#ffd66a).
```
Export: generate **16:9** in Flow → crop to **3840×1240** (content stays in the central band). Keep focal art inside the central **860×380** safe zone; logo will sit **bottom-left**.

---

## Asset map — every store, exact export specs

| Store | Asset | Pixels | Format | Alpha | Prompt |
|---|---|---|---|---|---|
| Steam | Small capsule | 462×174 | JPG/PNG ≤2MB | no | §5 |
| Steam | Header capsule | 920×430 | JPG/PNG ≤2MB | no | §3 |
| Steam | Main capsule | 1232×706 | JPG/PNG ≤2MB | no | §3 |
| Steam | Vertical capsule | 748×896 | JPG/PNG ≤2MB | no | §4 |
| Steam | Library capsule | 600×900 | JPG/PNG ≤2MB | no | §4 |
| Steam | Library hero | 3840×1240 | JPG/PNG | no | §6 |
| Steam | Library logo | ≤1280×720 | PNG | **yes** | §2 |
| Steam | Client/community icon | 32×32, 184×184 | PNG | yes | §1 |
| Play | App icon | 512×512 | PNG 32-bit | **yes** | §1 |
| Play | Feature graphic | 1024×500 | JPG/PNG | no | §3 |
| Play | Phone screenshots (2–8) | 1080×1920 (9:16) | JPG/PNG-24 | no | game capture |
| App Store | App icon | 1024×1024 | PNG | **no** | §1 (flat, no rounded corners) |
| App Store | iPhone 6.9″ shots | 1290×2796 | PNG/JPG | no | game capture |
| App Store | iPad 13″ shots | 2064×2752 | PNG/JPG | no | game capture |

## Google Flow — which ratio to generate (Flow only offers 16:9, 4:3, 1:1, 3:4, 9:16)
Generate the closest ratio, then crop to the exact px above. For anything wider than 16:9
(small capsule, library hero), keep all key content + the logo zone in the **central horizontal band** — the top/bottom get cropped away.

| Prompt | Asset | Target px | Generate in Flow | After |
|---|---|---|---|---|
| §1 | Icons (App Store / Play / Steam) | 1024² · 512² · 184² · 32² | **1:1** | downscale to each; Apple flat/opaque |
| §2 | Library logo | ≤1280×720 | **16:9** | on magenta → key out → crop tight |
| §3 | Steam header | 920×430 | **16:9** | crop sides (2.14:1) |
| §3 | Steam main | 1232×706 | **16:9** | near-exact, minor crop |
| §3 | Play feature | 1024×500 | **16:9** | crop top/bottom (2.05:1) |
| §4 | Steam vertical | 748×896 | **3:4** | slight crop |
| §4 | Library capsule | 600×900 | **3:4** | crop to 2:3 (narrower) |
| §5 | Small capsule | 462×174 | **16:9** | crop to wide strip; content in central band |
| §6 | Library hero | 3840×1240 | **16:9** | crop to wide strip; content + bottom-left logo zone in central band |

## Tips (for "out of the box")
- Attach the existing key art as a **reference image** every time — keeps mech, dinos, palette on-model.
- Generate at 2–4× the target and downscale; export the **exact** pixels above (stores reject wrong sizes).
- **Transparency:** generators like Flow can't output alpha. The only asset that truly needs it is the library logo (§2) — render it on flat magenta (#FF00FF) and key it out with sprite-tools. Icons are full-bleed squares, so generate them opaque; the store masks the corners.
- App Store icon: **no rounded corners, no transparency** — Apple masks it. Play/Steam icons can also be opaque full-bleed.
- Steam capsules must show the game name and must not bake in review scores, awards, discounts, or "coming soon" text.
- Screenshots are real gameplay captures (from play.mesozoicprotocol.com); an optional branded frame can reuse the palette + title font.

## Sources
Steam [Store Assets](https://partner.steamgames.com/doc/store/assets/standard) · [Library Assets](https://partner.steamgames.com/doc/store/assets/libraryassets) · [presskit.gg guide](https://presskit.gg/field-guides/steam-capsule-art-guide) — Play [Preview assets](https://support.google.com/googleplay/android-developer/answer/9866151) — Apple [Screenshot specs](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/)
