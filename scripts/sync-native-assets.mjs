// Native app icon / splash generator for the Capacitor projects.
//
// `npx cap add ios|android` scaffolds the native projects with Capacitor's
// default placeholder art (a blue "X" on white). Those get rejected by the
// App Store and Play Store, and nothing in the Capacitor sync path replaces
// them — `cap sync` only copies the web build and plugin config, never the
// asset catalogs. So this script owns them instead.
//
// Single source of truth is the 1024x1024 icon that Tauri already uses for
// the desktop builds (src-tauri/icons/source.png); everything below is
// derived from it, so the three shipping platforms stay in visual sync.
//
//   node scripts/sync-native-assets.mjs
//
// Deterministic and idempotent: re-running with an unchanged source rewrites
// byte-identical files, so it is safe to wire into a release script.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const SOURCE = path.join(root, "src-tauri/icons/source.png");

// Brand background. Matches `backgroundColor` in capacitor.config.ts — the
// colour the webview shows before the first frame, so splash art that uses
// the same value hands off without a flash.
const BRAND_RGB = { r: 0x0b, g: 0x10, b: 0x16, alpha: 1 };

// The source art is a full-bleed icon with its own rounded corners and a
// radial background that fades to this colour at the card edge (sampled from
// source.png). Anywhere the art has to sit on an opaque canvas that the
// platform will then mask again — the iOS icon, the Android adaptive
// background layer — this is the fill to use. Flattening onto BRAND instead
// leaves dark wedges outside the baked corner radius once iOS applies its own
// squircle.
const ICON_EDGE = "#29364d";
const ICON_EDGE_RGB = { r: 0x29, g: 0x36, b: 0x4d, alpha: 1 };

// Fraction of the canvas the icon occupies on splash screens (measured
// against the shorter edge, so landscape and portrait read the same).
const SPLASH_ICON_RATIO = 0.3;

// Adaptive icons are 108dp with only the inner 66-72dp guaranteed visible —
// the launcher masks and parallaxes everything outside it. Art sized exactly
// to the 66dp safe zone (0.611) survives every mask but reads as a small badge
// floating in the middle of the icon. 78/108 lets the card fill the mask while
// keeping the turret itself — which sits well inside the card — clear of the
// crop. The background layer is ICON_EDGE, so the card's own edge blends into
// it and the two layers read as one full-bleed icon.
const ADAPTIVE_SAFE_RATIO = 78 / 108;

// Density buckets for the Android mipmaps. `legacy` is the pre-O launcher
// icon (48dp), `foreground` the adaptive layer (108dp), both scaled by the
// bucket's density factor (1x / 1.5x / 2x / 3x / 4x).
const DENSITIES = [
  { dir: "mipmap-mdpi", legacy: 48, foreground: 108 },
  { dir: "mipmap-hdpi", legacy: 72, foreground: 162 },
  { dir: "mipmap-xhdpi", legacy: 96, foreground: 216 },
  { dir: "mipmap-xxhdpi", legacy: 144, foreground: 324 },
  { dir: "mipmap-xxxhdpi", legacy: 192, foreground: 432 },
];

// The 11 splash drawables Capacitor scaffolds, at the exact dimensions the
// scaffold used. Sizes are kept verbatim rather than recomputed so the
// resource set stays identical to what the Android tooling expects.
const ANDROID_SPLASHES = [
  { dir: "drawable", width: 480, height: 320 },
  { dir: "drawable-port-mdpi", width: 320, height: 480 },
  { dir: "drawable-port-hdpi", width: 480, height: 800 },
  { dir: "drawable-port-xhdpi", width: 720, height: 1280 },
  { dir: "drawable-port-xxhdpi", width: 960, height: 1600 },
  { dir: "drawable-port-xxxhdpi", width: 1280, height: 1920 },
  { dir: "drawable-land-mdpi", width: 480, height: 320 },
  { dir: "drawable-land-hdpi", width: 800, height: 480 },
  { dir: "drawable-land-xhdpi", width: 1280, height: 720 },
  { dir: "drawable-land-xxhdpi", width: 1600, height: 960 },
  { dir: "drawable-land-xxxhdpi", width: 1920, height: 1280 },
];

// Capacitor's Splash.imageset points 1x/2x/3x at three separate files that
// hold the same square artwork; Contents.json expects all three to exist.
const IOS_SPLASH_FILES = [
  "splash-2732x2732.png",
  "splash-2732x2732-1.png",
  "splash-2732x2732-2.png",
];
const IOS_SPLASH_SIZE = 2732;

let source;
let written = 0;

const rel = (file) => path.relative(root, file);

async function emit(file, buffer) {
  await writeFile(file, buffer);
  written += 1;
  console.log(`  wrote ${rel(file)}`);
}

// Icon art resized to `size`, preserving its alpha. `fit: "contain"` with a
// transparent pad keeps the aspect ratio even if the source is ever swapped
// for something non-square.
const iconAt = (size) =>
  sharp(source)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

// Solid brand canvas with the icon centred on it.
async function onBrand(width, height, iconSize) {
  const icon = await iconAt(iconSize);
  return sharp({
    create: { width, height, channels: 4, background: BRAND_RGB },
  })
    .composite([{ input: icon, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// A white disc used as a `dest-in` mask — keeps only the pixels inside the
// circle, which is what `ic_launcher_round` is expected to be.
const circleMask = (size) =>
  Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );

async function buildIosIcon() {
  console.log("iOS app icon");
  const file = path.join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png");

  // App Store Connect rejects icons that carry an alpha channel, so the art
  // is flattened onto the card-edge colour and the channel dropped entirely.
  // Contents.json already declares the modern single 1024x1024 universal
  // entry, so no catalog edit is needed.
  const buffer = await sharp(await iconAt(1024))
    .flatten({ background: ICON_EDGE_RGB })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();

  await emit(file, buffer);
}

async function buildIosSplash() {
  console.log("iOS splash");
  const iconSize = Math.round(IOS_SPLASH_SIZE * SPLASH_ICON_RATIO);
  const buffer = await onBrand(IOS_SPLASH_SIZE, IOS_SPLASH_SIZE, iconSize);
  for (const name of IOS_SPLASH_FILES) {
    await emit(path.join(root, "ios/App/App/Assets.xcassets/Splash.imageset", name), buffer);
  }
}

async function buildAndroidLauncherIcons() {
  console.log("Android launcher icons");
  for (const { dir, legacy } of DENSITIES) {
    const out = path.join(root, "android/app/src/main/res", dir);
    const square = await onBrand(legacy, legacy, legacy);
    await emit(path.join(out, "ic_launcher.png"), square);

    const round = await sharp(square)
      .composite([{ input: circleMask(legacy), blend: "dest-in" }])
      .png({ compressionLevel: 9 })
      .toBuffer();
    await emit(path.join(out, "ic_launcher_round.png"), round);
  }
}

async function buildAndroidAdaptiveForeground() {
  console.log("Android adaptive foreground");
  for (const { dir, foreground } of DENSITIES) {
    // Transparent canvas — the background layer supplies the colour, and the
    // art is inset to the 66dp safe zone so no launcher mask can clip it.
    const art = await iconAt(Math.round(foreground * ADAPTIVE_SAFE_RATIO));
    const buffer = await sharp({
      create: {
        width: foreground,
        height: foreground,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: art, gravity: "center" }])
      .png({ compressionLevel: 9 })
      .toBuffer();

    await emit(
      path.join(root, "android/app/src/main/res", dir, "ic_launcher_foreground.png"),
      buffer,
    );
  }
}

// mipmap-anydpi-v26/ic_launcher{,_round}.xml point their background layer at
// `@color/ic_launcher_background`, which the scaffold left at #FFFFFF. Only
// the colour resource needs to change — no drawable indirection involved.
async function syncAdaptiveBackgroundColor() {
  console.log("Android adaptive background colour");
  const file = path.join(root, "android/app/src/main/res/values/ic_launcher_background.xml");
  const current = await readFile(file, "utf8");
  const next = current.replace(
    /(<color name="ic_launcher_background">)[^<]*(<\/color>)/,
    `$1${ICON_EDGE.toUpperCase()}$2`,
  );

  if (next === current) {
    console.log(`  unchanged ${rel(file)}`);
    return;
  }
  await emit(file, next);
}

async function buildAndroidSplashes() {
  console.log("Android splash drawables");
  for (const { dir, width, height } of ANDROID_SPLASHES) {
    const iconSize = Math.round(Math.min(width, height) * SPLASH_ICON_RATIO);
    const buffer = await onBrand(width, height, iconSize);
    await emit(path.join(root, "android/app/src/main/res", dir, "splash.png"), buffer);
  }
}

try {
  source = await readFile(SOURCE);
} catch {
  console.error(`sync-native-assets: missing icon source at ${rel(SOURCE)}`);
  console.error("Regenerate it with the Tauri icon pipeline, or restore it from git.");
  process.exit(1);
}

const meta = await sharp(source).metadata();
console.log(`source ${rel(SOURCE)} (${meta.width}x${meta.height})\n`);

await buildIosIcon();
await buildIosSplash();
await buildAndroidLauncherIcons();
await buildAndroidAdaptiveForeground();
await syncAdaptiveBackgroundColor();
await buildAndroidSplashes();

console.log(`\nsync-native-assets: ${written} file(s) written.`);
