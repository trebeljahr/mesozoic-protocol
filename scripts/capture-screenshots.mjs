// Press / marketing screenshot generator.
//
// Regenerates the gameplay screenshots embedded in the marketing pages
// (public/about.html, public/press.html) — written to public/screenshots/
// with the canonical names those pages reference, plus -thumb variants.
//
// Drives the real game in headless Chromium via the `?capture=1` flag (see
// src/debug.ts): the store is exposed on window.__game, in-world debug
// overlays (planner labels, path debug, level editor) are suppressed, and the
// real-time frameloop runs normally — so the sim advances on its own and we
// just steer state, wait, and shoot.
//
// Prereq: a dev server must be running. Point BASE_URL at it.
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
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../public/screenshots");
const BASE = process.env.BASE_URL ?? "http://localhost:58741";
const PREFIX = "mesozoic-protocol-screenshot";

// Biomes run five levels each: forest 1-5, snow 6-10, desert 11-15,
// wasteland 16-20, lava 21-25, alien 26-30. Pilots are spread so the set
// shows all four kits and their ultimates.
const COMBAT = [
  { file: "01-forest-defense", level: 4, robot: "george", towers: ["pulse", "chain", "mortar", "flame", "cryo", "pulse"] },
  { file: "03-lava-firefight", level: 23, robot: "mike", towers: ["flame", "mortar", "pulse", "cryo", "flame", "chain"] },
  { file: "04-alien-biome", level: 28, robot: "stan", towers: ["mortar", "cryo", "pulse", "chain", "flame", "mortar"] },
  { file: "05-desert-crossing", level: 13, robot: "leela", towers: ["chain", "cryo", "pulse", "mortar", "chain", "flame"] },
  { file: "06-snow-outpost", level: 8, robot: "leela", towers: ["cryo", "pulse", "chain", "mortar", "flame", "cryo"] },
  { file: "07-wasteland-serpentine", level: 18, robot: "stan", towers: ["mortar", "pulse", "flame", "cryo", "chain", "mortar"] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=default", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
});

await mkdir(OUT, { recursive: true });

// Shared setup: unlock everything, fund the run, and keep clearing the
// auto-pause / new-enemy callout / achievement toasts so the frame stays
// clean and the wave keeps running.
async function bootstrap(page) {
  await page.goto(`${BASE}/?capture=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });
  await page.evaluate(() => {
    const g = window.__game;
    g.getState().selectSlot(1);
    g.getState().debugUnlockThroughLevel(30);
    g.setState((st) => ({
      progress: {
        ...st.progress,
        bolts: 99999,
        robotUnlocks: { george: true, leela: true, mike: true, stan: true },
        // Suppress the one-shot world-map reveal modals that the unlock-all
        // above would otherwise trigger.
        seenModesUnlockExplainer: true,
        seenEndlessUnlockExplainer: true,
      },
      assetsPrewarmed: true,
    }));
    window.__keepClean = setInterval(() => {
      const G = window.__game;
      G.setState({
        newEnemyQueue: [],
        deferredNewEnemyQueue: [],
        autoPausedForNewEnemy: false,
        levelIntroVisible: false,
        achievementToasts: [],
      });
      if (G.getState().world.status === "paused") G.getState().togglePause();
    }, 40);
  });
}

async function shoot(page, file) {
  const full = `${OUT}/${PREFIX}-${file}.jpg`;
  await page.screenshot({ path: full, type: "jpeg", quality: 88 });
  return full;
}

for (const sc of COMBAT) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.warn(`  [page error] ${sc.file}: ${e.message}`));
  await bootstrap(page);

  await page.evaluate((sc) => {
    const g = window.__game;
    g.getState().setActiveRobot(sc.robot);
    g.setState({ levelLoadPending: false });
    g.getState().startLevel(sc.level);
    g.getState().dismissLevelIntro();
    g.getState().debugSetFreeTowers(true);
    g.getState().debugAddGold(99999);
  }, sc);

  await page.waitForFunction(() => {
    const c = document.querySelector("canvas");
    return c && c.width > 800;
  }, null, { timeout: 20000 });
  await sleep(1300); // asset prewarm + first real frames

  const placed = await page.evaluate((sc) => {
    const G = window.__game;
    const path = G.getState().world.paths[0];
    let placed = 0;
    const stepN = 9;
    for (let i = stepN; i < path.length - stepN; i += stepN) {
      const p = path[i];
      const q = path[i + 1] || path[i];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      for (const side of [1, -1]) {
        G.getState().setSelectedKind(sc.towers[placed % sc.towers.length]);
        G.getState().tryPlaceOrSelect(
          { x: p.x + nx * 2.6 * side, y: p.y + ny * 2.6 * side },
          { clearSelectionAfterPlacement: true },
        );
        placed = G.getState().world.towers.length;
      }
    }
    G.getState().setSelectedKind(null);
    return placed;
  }, sc);

  await page.evaluate(() => window.__game.getState().debugForceWave(7));
  await sleep(3600);

  await page.evaluate(() => {
    const G = window.__game;
    const path = G.getState().world.paths[0];
    const mid = path[Math.floor(path.length * 0.5)];
    G.getState().selectRobotUnit(true);
    G.getState().orderRobotMove({ x: mid.x, y: mid.y + 1 });
  });
  await sleep(1500);
  await page.evaluate(() => {
    const G = window.__game;
    G.getState().triggerRobotAbility(3); // ultimate
    G.getState().triggerRobotAbility(0); // primary
  });
  await sleep(450);

  const info = await page.evaluate(() => {
    const w = window.__game.getState().world;
    clearInterval(window.__keepClean);
    return { biome: w.biome, wave: w.wave, enemies: w.enemies.filter((e) => e.alive).length, towers: w.towers.length };
  });
  const out = await shoot(page, sc.file);
  console.log(`✓ ${sc.file}: ${info.biome} L${sc.level} ${sc.robot} wave ${info.wave} · ${info.towers} towers · ${info.enemies} enemies · placed ${placed} → ${out}`);
  await page.close();
}

// World map.
{
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.warn(`  [page error] world-map: ${e.message}`));
  await bootstrap(page);
  await page.evaluate(() => window.__game.getState().goToWorldMap());
  await page.waitForFunction(() => {
    const c = document.querySelector("canvas");
    return c && c.width > 800;
  }, null, { timeout: 20000 });
  await sleep(2600); // world-map pulls all biome models
  await page.evaluate(() => clearInterval(window.__keepClean));
  const out = await shoot(page, "02-world-map");
  console.log(`✓ 02-world-map → ${out}`);
  await page.close();
}

// Compendium — the pilots section, so the shot shows the hero mechs.
{
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.warn(`  [page error] compendium: ${e.message}`));
  await bootstrap(page);
  await page.evaluate(() => {
    const g = window.__game;
    g.getState().goToWorldMap();
    g.getState().setCompendiumOpen(true, "robot");
  });
  await sleep(2200);
  await page.evaluate(() => clearInterval(window.__keepClean));
  const out = await shoot(page, "08-compendium");
  console.log(`✓ 08-compendium → ${out}`);
  await page.close();
}

await browser.close();
console.log(
  "done — full-size JPEGs written. Regenerate the -thumb variants with:\n" +
    "  cd public/screenshots && for f in *[0-9]-*.jpg; do [[ $f == *-thumb.jpg ]] || " +
    'sips -Z 960 -s formatOptions 82 "$f" --out "${f%.jpg}-thumb.jpg"; done',
);
