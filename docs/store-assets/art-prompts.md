# Mesozoic Protocol — store art generation prompts

Copy-paste image prompts for every store asset, anchored to the existing key art
(the breached-wall / mech + turrets vs. reanimated dinosaurs piece). **Feed that key-art
image into the generator as a style + character reference alongside each text prompt** so
every asset stays on-model. Generate larger than the target, then crop/resize to the exact
pixels in the table. Reusable template for other projects lives in Claude memory
(`store-art-asset-specs-and-prompts`).

---

## 0. MASTER STYLE BLOCK (prepend to every prompt, or use as the style-reference text)

```
Style: semi-realistic stylized digital painting — cinematic mobile-game key-art. Clean, confident shapes with painterly rendering, dramatic rim lighting and glow; not photoreal, not cutesy. High contrast, atmospheric haze, wet reflective ground.
World "Mesozoic Protocol": a last stand at a breached revival-biotech dinosaur facility. A boxy piloted battle mech — olive-green and tan armor plating, a single glowing cyan camera-eye, dual arm-cannons firing cyan energy beams — fights alongside sci-fi gatling turrets on hexagonal bases. Enemies are reanimated dinosaurs whose bones are laced with glowing bio-tech scaffolding: a raptor pack with glowing eyes, a low-poly armored ceratopsian, and a colossal apatosaur silhouette. Environment: cracked concrete containment walls, tall glowing toxic-green specimen tanks, an erupting volcano under a smoky red-orange sky, crackling cyan electrical arcs, raining orange embers.
Palette: deep desaturated teal/slate base (#0b1016), toxic green (specimen tanks), electric cyan glow (#5ad6ff), amber/orange accents (#ffd66a, volcano, sparks).
Title treatment when shown: "MESOZOIC PROTOCOL" in bold uppercase, wide letter-spacing, rugged military/tech stencil typeface, cyan-white with a subtle amber edge glow.
```

---

## 1. ICON EMBLEM  → App Store 1024², Play 512², Steam client/community icon
One iconic mark that reads at 32px. Not a full scene.
```
[MASTER STYLE BLOCK]
A single bold app-icon emblem for "Mesozoic Protocol": the olive-and-tan mech's head in three-quarter view, glowing cyan camera-eye front and center, framed by a dark hexagonal tech badge with thin cyan circuit etching and a faint toxic-green rim glow. Centered, symmetrical, heavy silhouette, minimal background (deep teal-black). No text. Crisp and legible at very small sizes.
```
Export: **App Store** 1024×1024 PNG, no alpha, flat square (no rounded corners), sRGB · **Play** 512×512 32-bit PNG with alpha · **Steam** 32×32 + 184×184 PNG.

## 2. LOGOTYPE / WORDMARK  → Steam Library Logo (transparent)
```
[MASTER STYLE BLOCK]
Only the game logo on a fully transparent background: "MESOZOIC PROTOCOL" in bold uppercase wide-tracked military-stencil lettering, cyan-white with amber edge glow and a small scaffolding-bone-and-circuit motif fused into the lettering. No scene, no box, transparent alpha.
```
Export: transparent **PNG**, up to **1280×720**, subject centered with padding.

## 3. LANDSCAPE HERO  → Steam Header 920×430, Main 1232×706, Play Feature Graphic 1024×500
Same scene, widescreen. Keep the title and the mech OUT of the dead-center (Play overlays a play-button there) and clear of edges.
```
[MASTER STYLE BLOCK]
Widescreen hero key art: the piloted mech mid-stride in the foreground-left firing dual cyan beams, a sci-fi gatling turret on each flank, the raptor pack and armored ceratopsian charging through a jagged breach in a concrete containment wall, glowing toxic-green specimen tanks and a colossal apatosaur silhouette against an erupting volcano and red sky behind, cyan lightning arcing overhead, embers falling. "MESOZOIC PROTOCOL" title set into the lower-left third. Cinematic wide composition, strong depth, readable focal point.
```
Export: **Header** 920×430 · **Main** 1232×706 · **Play Feature** 1024×500 (title + mech offset from center; nothing critical in the middle). JPG or PNG (Play feature: **no alpha**).

## 4. PORTRAIT HERO  → Steam Vertical Capsule 748×896, Library Capsule 600×900
Closest to your existing art. Title readable as "boxart."
```
[MASTER STYLE BLOCK]
Vertical poster key art: the piloted mech front-and-center firing dual cyan beams, a gatling turret low on each side, the breached containment wall framing the scene, raptor pack and armored ceratopsian flanking, glowing green specimen tanks, the apatosaur silhouette and erupting volcano rising behind under a red sky, cyan lightning across the top, embers falling. "MESOZOIC PROTOCOL" title banner across the lower third. Bold, centered, poster-like.
```
Export: **Vertical** 748×896 · **Library capsule** 600×900. JPG or PNG.

## 5. SMALL CAPSULE  → Steam 462×174
Tiny + wide → logo-forward, one hero element, minimal detail.
```
[MASTER STYLE BLOCK]
Compact wide store thumbnail: "MESOZOIC PROTOCOL" title dominating the frame, the mech's head with glowing cyan eye and one arm-cannon beam to one side, simple dark teal background with a faint green tank glow and a few embers. Bold, high-contrast, legible at thumbnail scale. Minimal clutter.
```
Export: **462×174** JPG or PNG.

---

## Asset map — every store, exact export specs

| Store | Asset | Pixels | Format | Alpha | Use prompt |
|---|---|---|---|---|---|
| Steam | Small capsule | 462×174 | JPG/PNG ≤2MB | no | §5 |
| Steam | Header capsule | 920×430 | JPG/PNG ≤2MB | no | §3 |
| Steam | Main capsule | 1232×706 | JPG/PNG ≤2MB | no | §3 |
| Steam | Vertical capsule | 748×896 | JPG/PNG ≤2MB | no | §4 |
| Steam | Library capsule | 600×900 | JPG/PNG ≤2MB | no | §4 |
| Steam | Library hero | 3840×1240 | JPG/PNG | no | §3 (env only, **no title** — logo overlays separately; leave negative space) |
| Steam | Library logo | ≤1280×720 | PNG | **yes** | §2 |
| Steam | Client/community icon | 32×32, 184×184 | PNG | yes | §1 |
| Play | App icon | 512×512 | PNG 32-bit | **yes** | §1 |
| Play | Feature graphic | 1024×500 | JPG/PNG | no | §3 (center-safe) |
| Play | Phone screenshots (2–8) | 1080×1920 (9:16) | JPG/PNG-24 | no | game capture, not AI |
| App Store | App icon | 1024×1024 | PNG | **no** | §1 (flat, no rounded corners) |
| App Store | iPhone 6.9″ shots | 1290×2796 | PNG/JPG | no | game capture |
| App Store | iPad 13″ shots | 2064×2752 | PNG/JPG | no | game capture |

## Generation tips (for "out of the box")
- Attach the existing key art as a **reference image** every time — keeps mech, dinos, palette on-model.
- Generate at 2–4× the target and downscale; export the **exact** pixels above (stores reject wrong sizes).
- **Flatten alpha** for every asset marked "no" (App Store icon + all capsules/feature graphic). Keep alpha only for the Play/Steam icons and the Steam library logo.
- App Store icon: **no rounded corners, no transparency** — Apple masks it.
- Steam **library hero carries no title** (the logo is a separate transparent layer that parallaxes over it) — leave a clean area where the logo will sit.
- Steam capsules must show the game name and must not bake in review scores, awards, discounts, or "coming soon" text.
- Screenshots are real gameplay captures (from play.mesozoicprotocol.com); an optional branded frame/caption can use the §0 palette + title font.

## Sources
Steam [Store Assets](https://partner.steamgames.com/doc/store/assets/standard) · [Library Assets](https://partner.steamgames.com/doc/store/assets/libraryassets) · [presskit.gg guide](https://presskit.gg/field-guides/steam-capsule-art-guide) — Play [Preview assets](https://support.google.com/googleplay/android-developer/answer/9866151) — Apple [Screenshot specs](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/)
