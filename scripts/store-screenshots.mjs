// Store-submission screenshot generator.
//
// Emits App Store Connect / Google Play Console upload-ready images at the
// EXACT pixel sizes each console accepts. A wrong-size upload is rejected at
// submission time, so every emitted file is resized to its target dimensions
// and flattened onto the brand background so it carries no alpha channel
// (Google Play rejects alpha; Apple rejects it for some slots too).
//
// The gameplay frames come from the same headless scene drivers the marketing
// capture uses (scripts/lib/capture-scenes.mjs) — this script only changes the
// viewport/deviceScaleFactor and the output post-processing.
//
// Mesozoic Protocol is landscape-locked (see src/ui/LandscapeNudge.tsx and the
// native orientation locks), so every set below is the LANDSCAPE orientation of
// the console's published size.
//
// Prereq: a *dev* server. `?capture=1` is gated on `import.meta.env.DEV`
// (src/debug.ts), so a `vite preview` over a production `dist/` will never
// expose `window.__game`.
//
//   pnpm dev --port 51837
//   BASE_URL=http://localhost:51837 node scripts/store-screenshots.mjs
//
// Flags:
//   --list             print the size table + counts and exit (no capture)
//   --only=a,b         capture only these set ids
//   --scenes=a,b       re-shoot only these scene slugs (keeps their NN- prefix)
//   --skip-gameplay    only build the Play feature graphic
//   --out=<dir>        override the output root

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  bootstrap,
  COMBAT_SCENARIOS,
  launchCaptureBrowser,
  stageCombat,
  stageCompendium,
  stageSkillTree,
  stageWorldMap,
} from "./lib/capture-scenes.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

/** Brand background. Matches <meta name="theme-color"> in index.html. */
export const BRAND_BG = "#0b1016";

// ---------------------------------------------------------------------------
// Capture groups — one headless render per distinct aspect ratio.
//
// The game's HUD is responsive, so a 4:3 iPad frame must be RENDERED at 4:3
// rather than cropped out of a 16:9 frame; otherwise the layout in the shot
// isn't the layout the device shows. Targets that share an aspect ratio reuse
// one capture and are scaled down from it.
// ---------------------------------------------------------------------------
export const CAPTURE_GROUPS = {
  // 2868x1320 = 2.173:1 — the 6.9" iPhone landscape frame.
  "iphone-ultrawide": { width: 2868, height: 1320, deviceScaleFactor: 2 },
  // 2752x2064 = 4:3 — the 13" iPad landscape frame.
  "ipad-4-3": { width: 2752, height: 2064, deviceScaleFactor: 2 },
  // 2560x1440 = 16:9 — master for every Google Play gameplay set.
  "wide-16-9": { width: 2560, height: 1440, deviceScaleFactor: 2 },
};

// ---------------------------------------------------------------------------
// THE SIZE TABLE.
//
// Single source of truth — edit here when Apple/Google change requirements.
// Verified 2026-07-30 against Apple's App Store Connect screenshot
// specifications and Google's Play Console "Graphic assets, screenshots and
// videos" support page (support.google.com/googleplay/android-developer/answer/9866151).
// ---------------------------------------------------------------------------
export const STORE_TARGETS = [
  {
    id: "ios-iphone-6.9",
    platform: "app-store",
    set: "iphone-6.9",
    label: 'App Store — 6.9" iPhone (landscape)',
    width: 2868,
    height: 1320,
    min: 1,
    max: 10,
    required: true,
    group: "iphone-ultrawide",
    notes:
      "Required if the app runs on iPhone. Apple accepts 1-10 (3+ is the practical ASO floor) and scales these down for every smaller iPhone class. Alpha channels are rejected.",
  },
  {
    id: "ios-ipad-13",
    platform: "app-store",
    set: "ipad-13",
    label: 'App Store — 13" iPad (landscape)',
    width: 2752,
    height: 2064,
    min: 1,
    max: 10,
    required: true,
    group: "ipad-4-3",
    notes:
      'Required because TARGETED_DEVICE_FAMILY = "1,2" (iPhone + iPad). Apple accepts 1-10; alpha channels are rejected.',
  },
  {
    id: "play-phone",
    platform: "google-play",
    set: "phone",
    label: "Google Play — phone (16:9 landscape)",
    width: 1920,
    height: 1080,
    min: 2,
    max: 8,
    required: true,
    group: "wide-16-9",
    notes:
      "Play accepts 320-3840px per side, max side <= 2x min side. 1920x1080 is Google's own recommended 16:9 landscape size. Min 2 screenshots across all device types to publish.",
  },
  {
    id: "play-tablet-7",
    platform: "google-play",
    set: "tablet-7",
    label: 'Google Play — 7" tablet (16:9 landscape)',
    width: 1920,
    height: 1080,
    min: 4,
    max: 8,
    required: false,
    group: "wide-16-9",
    notes:
      "Play requires 1080-7680px per side and a 16:9 / 9:16 ratio for tablet sets. Min 4 if the set is provided at all.",
  },
  {
    id: "play-tablet-10",
    platform: "google-play",
    set: "tablet-10",
    label: 'Google Play — 10" tablet (16:9 landscape)',
    width: 2560,
    height: 1440,
    min: 4,
    max: 8,
    required: false,
    group: "wide-16-9",
    notes:
      'Same 1080-7680px / 16:9 rule as the 7" set; 2560x1440 gives the larger class native pixels.',
  },
  {
    id: "play-feature-graphic",
    platform: "google-play",
    set: "feature-graphic",
    label: "Google Play — feature graphic",
    width: 1024,
    height: 500,
    min: 1,
    max: 1,
    required: true,
    group: null, // composed, not captured
    notes: "Exactly 1024x500, JPEG or 24-bit PNG, no alpha. Composed from the app icon + wordmark.",
  },
];

// ---------------------------------------------------------------------------
// Scenes. Deliberately 6 shots: satisfies Apple's 3-10, Play's phone min 2,
// and Play's tablet min 4, with headroom under every max.
// ---------------------------------------------------------------------------
const byFile = (f) => COMBAT_SCENARIOS.find((s) => s.file === f);

export const STORE_SCENES = [
  {
    slug: "outpost-defense",
    describe: "Defended forest outpost mid-wave",
    run: (page) => stageCombat(page, byFile("01-forest-defense")),
  },
  {
    slug: "boss-encounter",
    describe: "Boss wave in the lava biome",
    // No ultimate here — its screen-filling AoE would hide the boss itself.
    run: (page) =>
      stageCombat(page, byFile("03-lava-firefight"), { wave: "boss", ultimate: false }),
  },
  { slug: "world-map", describe: "Campaign world map", run: (page) => stageWorldMap(page) },
  { slug: "skill-tree", describe: "Meta skill tree", run: (page) => stageSkillTree(page) },
  {
    slug: "alien-firefight",
    describe: "Alien biome firefight with pilot ultimate",
    run: (page) => stageCombat(page, byFile("04-alien-biome")),
  },
  {
    slug: "compendium",
    describe: "Pilot compendium",
    run: (page) => stageCompendium(page, "robot"),
  },
];

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const flagValue = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

// Gitignored, and deliberately NOT under public/: these are hand-uploaded
// submission artifacts, so they must not be copied into dist/ (and from there
// into the Capacitor/Tauri bundles) by the vite build.
const OUT_ROOT = resolve(
  REPO,
  flagValue("out") ?? process.env.STORE_SCREENSHOT_OUT ?? "store-screenshots",
);
const BASE = process.env.BASE_URL ?? "http://localhost:51837";
const ICON_SRC = resolve(REPO, "src-tauri/icons/source.png");

function printList() {
  const scenes = STORE_SCENES.length;
  console.log(`\nStore screenshot targets — ${scenes} scenes captured per gameplay set.`);
  console.log(`Output root: ${OUT_ROOT}\n`);
  let lastPlatform = "";
  for (const t of STORE_TARGETS) {
    if (t.platform !== lastPlatform) {
      console.log(`  ${t.platform.toUpperCase()}`);
      lastPlatform = t.platform;
    }
    const gameplay = t.group !== null;
    const emitted = gameplay ? scenes : 1;
    const ok = emitted >= t.min && emitted <= t.max ? "ok" : "OUT OF RANGE";
    console.log(`    ${t.id}`);
    console.log(`      size      ${t.width}x${t.height}  (${(t.width / t.height).toFixed(3)}:1)`);
    console.log(`      count     ${t.min}-${t.max} required · this run emits ${emitted} → ${ok}`);
    console.log(`      required  ${t.required ? "yes" : "optional (recommended)"}`);
    console.log(`      alpha     none (flattened onto ${BRAND_BG})`);
    console.log(`      note      ${t.notes}`);
    console.log(`      → ${t.platform}/${t.set}/`);
    console.log("");
  }
  console.log("Scenes:");
  for (const [i, s] of STORE_SCENES.entries()) {
    console.log(`  ${String(i + 1).padStart(2, "0")}-${s.slug} — ${s.describe}`);
  }
  console.log("");
}

/**
 * Resize a captured PNG buffer to an exact target size and strip the alpha
 * channel by flattening onto the brand background.
 */
async function emit(buffer, target, index, slug) {
  const dir = `${OUT_ROOT}/${target.platform}/${target.set}`;
  await mkdir(dir, { recursive: true });
  const file = `${dir}/${String(index + 1).padStart(2, "0")}-${slug}.png`;
  await sharp(buffer)
    .resize(target.width, target.height, { fit: "cover", position: "centre", kernel: "lanczos3" })
    .flatten({ background: BRAND_BG })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(file);
  return file;
}

async function captureGameplay(targets, sceneFilter) {
  const groups = [...new Set(targets.filter((t) => t.group).map((t) => t.group))];
  if (groups.length === 0) return [];
  // Keep the original index so a re-shot scene keeps its NN- prefix.
  const scenes = STORE_SCENES.map((s, i) => ({ scene: s, index: i })).filter(
    ({ scene }) => !sceneFilter || sceneFilter.includes(scene.slug),
  );
  if (scenes.length === 0)
    throw new Error(
      `--scenes matched nothing. Known: ${STORE_SCENES.map((s) => s.slug).join(", ")}`,
    );

  const browser = await launchCaptureBrowser();
  const written = [];
  try {
    for (const groupId of groups) {
      const g = CAPTURE_GROUPS[groupId];
      const viewport = {
        width: g.width / g.deviceScaleFactor,
        height: g.height / g.deviceScaleFactor,
      };
      if (!Number.isInteger(viewport.width) || !Number.isInteger(viewport.height)) {
        throw new Error(`Capture group ${groupId} does not divide evenly by deviceScaleFactor`);
      }
      const consumers = targets.filter((t) => t.group === groupId);
      console.log(
        `\n── group ${groupId}: ${g.width}x${g.height} (viewport ${viewport.width}x${viewport.height} @${g.deviceScaleFactor}x) → ${consumers.map((c) => c.id).join(", ")}`,
      );

      for (const { scene, index: i } of scenes) {
        const page = await browser.newPage({ viewport, deviceScaleFactor: g.deviceScaleFactor });
        page.on("pageerror", (e) => console.warn(`  [page error] ${scene.slug}: ${e.message}`));
        try {
          await bootstrap(page, BASE);
          const info = await scene.run(page);
          const buffer = await page.screenshot({ type: "png" });
          const meta = await sharp(buffer).metadata();
          if (meta.width !== g.width || meta.height !== g.height) {
            throw new Error(
              `${groupId}/${scene.slug}: browser produced ${meta.width}x${meta.height}, expected ${g.width}x${g.height}`,
            );
          }
          for (const t of consumers) {
            written.push(await emit(buffer, t, i, scene.slug));
          }
          const detail = info?.biome
            ? ` (${info.biome} wave ${info.wave}, ${info.towers} towers, ${info.enemies} enemies)`
            : "";
          console.log(`  ✓ ${String(i + 1).padStart(2, "0")}-${scene.slug}${detail}`);
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  return written;
}

/**
 * Google Play feature graphic — 1024x500, no alpha. Not a gameplay capture:
 * the app icon plus the wordmark on the brand background. Deliberately plain.
 */
async function buildFeatureGraphic(target) {
  const W = target.width;
  const H = target.height;
  const ICON = 300;
  const ICON_X = 74;
  const ICON_Y = Math.round((H - ICON) / 2);
  const TEXT_X = ICON_X + ICON + 68;

  const icon = await sharp(ICON_SRC).resize(ICON, ICON, { fit: "cover" }).png().toBuffer();

  // Rounded-corner mask so the icon reads like an app tile rather than a
  // pasted square.
  const radius = Math.round(ICON * 0.22);
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON}" height="${ICON}"><rect width="${ICON}" height="${ICON}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
  );
  const roundedIcon = await sharp(icon)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();

  const font = "Helvetica Neue, Helvetica, Arial, sans-serif";
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1016"/>
      <stop offset="100%" stop-color="#121b25"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="${H - 4}" width="${W}" height="4" fill="#2f8f7a"/>
  <text x="${TEXT_X}" y="${Math.round(H * 0.42)}" font-family="${font}" font-size="76" font-weight="700" fill="#eaf2f8" letter-spacing="1">Mesozoic</text>
  <text x="${TEXT_X}" y="${Math.round(H * 0.65)}" font-family="${font}" font-size="76" font-weight="700" fill="#5fd3b2" letter-spacing="1">Protocol</text>
  <text x="${TEXT_X}" y="${Math.round(H * 0.82)}" font-family="${font}" font-size="27" font-weight="400" fill="#8fa3b3" letter-spacing="3">3D TOWER DEFENSE</text>
</svg>`);

  const dir = `${OUT_ROOT}/${target.platform}/${target.set}`;
  await mkdir(dir, { recursive: true });
  const file = `${dir}/feature-graphic.png`;

  const png = await sharp(overlay)
    .composite([{ input: roundedIcon, left: ICON_X, top: ICON_Y }])
    .flatten({ background: BRAND_BG })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();

  const meta = await sharp(png).metadata();
  if (meta.width !== W || meta.height !== H) {
    throw new Error(`feature graphic came out ${meta.width}x${meta.height}, expected ${W}x${H}`);
  }
  await writeFile(file, png);
  console.log(`  ✓ feature-graphic.png`);
  return [file];
}

async function main() {
  if (hasFlag("list")) {
    printList();
    return;
  }

  const only = flagValue("only")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let targets = STORE_TARGETS;
  if (only) {
    targets = STORE_TARGETS.filter((t) => only.includes(t.id) || only.includes(t.set));
    if (targets.length === 0)
      throw new Error(
        `--only matched no targets. Known ids: ${STORE_TARGETS.map((t) => t.id).join(", ")}`,
      );
  }

  console.log(`Base URL:  ${BASE}`);
  console.log(`Output:    ${OUT_ROOT}`);
  console.log(`Targets:   ${targets.map((t) => t.id).join(", ")}`);

  const written = [];
  if (!hasFlag("skip-gameplay")) {
    const sceneFilter = flagValue("scenes")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    written.push(...(await captureGameplay(targets, sceneFilter)));
  }

  const feature = targets.find((t) => t.set === "feature-graphic");
  if (feature) {
    console.log("\n── google-play feature graphic");
    written.push(...(await buildFeatureGraphic(feature)));
  }

  console.log(`\nDone — ${written.length} files written under ${OUT_ROOT}`);
  console.log("Verify with:  node scripts/store-screenshots.mjs --list");
}

// Only run when executed directly — the constants above are importable
// (e.g. by a submission checklist) without triggering a capture.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
