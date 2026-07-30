// Press / marketing screenshot generator.
//
// Regenerates the gameplay screenshots embedded in the marketing pages
// (public/about.html, public/press.html) — written to public/screenshots/
// with the canonical names those pages reference, plus -thumb variants.
//
// Drives the real game in headless Chromium via the `?capture=1` flag (see
// src/debug.ts). The scene drivers themselves live in scripts/lib/capture-scenes.mjs
// and are shared with the store-submission capture (scripts/store-screenshots.mjs)
// so both emit the same scenes.
//
// Prereq: a *dev* server must be running (`?capture=1` is DEV-gated). Point
// BASE_URL at it.
//   pnpm dev
//   BASE_URL=http://localhost:5173 node scripts/capture-screenshots.mjs
//
// Combat scenarios enter a level with a chosen pilot, line both sides of the
// path with towers, force a late wave, let combat fill the screen, drive the
// pilot into the fight and fire its ultimate, then capture. Two non-combat
// shots (world map, compendium) round out the set.

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bootstrap,
  COMBAT_SCENARIOS,
  launchCaptureBrowser,
  stageCombat,
  stageCompendium,
  stageWorldMap,
} from "./lib/capture-scenes.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, process.env.SCREENSHOT_OUT ?? "../public/screenshots");
const BASE = process.env.BASE_URL ?? "http://localhost:58741";
const PREFIX = "mesozoic-protocol-screenshot";
const VIEWPORT = { width: 1920, height: 1080 };

const browser = await launchCaptureBrowser();
await mkdir(OUT, { recursive: true });

async function newPage(label) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.warn(`  [page error] ${label}: ${e.message}`));
  await bootstrap(page, BASE);
  return page;
}

async function shoot(page, file) {
  const full = `${OUT}/${PREFIX}-${file}.jpg`;
  await page.screenshot({ path: full, type: "jpeg", quality: 88 });
  return full;
}

for (const sc of COMBAT_SCENARIOS) {
  const page = await newPage(sc.file);
  const info = await stageCombat(page, sc);
  const out = await shoot(page, sc.file);
  console.log(
    `✓ ${sc.file}: ${info.biome} L${sc.level} ${sc.robot} wave ${info.wave} · ${info.towers} towers · ${info.enemies} enemies · placed ${info.placed} → ${out}`,
  );
  await page.close();
}

// World map.
{
  const page = await newPage("world-map");
  await stageWorldMap(page);
  console.log(`✓ 02-world-map → ${await shoot(page, "02-world-map")}`);
  await page.close();
}

// Compendium — the pilots section, so the shot shows the hero mechs.
{
  const page = await newPage("compendium");
  await stageCompendium(page, "robot");
  console.log(`✓ 08-compendium → ${await shoot(page, "08-compendium")}`);
  await page.close();
}

await browser.close();
console.log(
  "done — full-size JPEGs written. Regenerate the -thumb variants with:\n" +
    "  cd public/screenshots && for f in *[0-9]-*.jpg; do [[ $f == *-thumb.jpg ]] || " +
    'sips -Z 960 -s formatOptions 82 "$f" --out "${f%.jpg}-thumb.jpg"; done',
);
