// Press / marketing screenshot generator.
//
// Drives the real game in headless Chromium and writes gameplay PNGs to
// press-assets/. Uses the `?capture=1` flag (see src/debug.ts): the store is
// exposed on window.__game, in-world debug overlays (planner labels, path
// debug, level editor) are suppressed, and the real-time frameloop runs
// normally — so the sim advances on its own and we just steer state, wait,
// and shoot.
//
// Prereq: a dev server must be running. Point BASE_URL at it.
//   pnpm dev   # in another terminal (note the port)
//   BASE_URL=http://localhost:5173 node scripts/capture-screenshots.mjs
//
// Each scenario: enter a level with a chosen pilot, line both sides of the
// path with towers, force a late wave, let combat fill the screen, drive the
// pilot into the fight and fire its ultimate, then capture.

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../press-assets");
const BASE = process.env.BASE_URL ?? "http://localhost:58741";

// Level ids are spread across the six biomes (5 levels each: forest, snow,
// desert, wasteland, lava, alien). The file name is stamped with the actual
// biome read back from the world, so picking the wrong id just renames.
const SCENARIOS = [
  { name: "george", level: 4, robot: "george", towers: ["pulse", "chain", "mortar", "flame", "cryo", "pulse"] },
  { name: "leela", level: 9, robot: "leela", towers: ["chain", "cryo", "pulse", "mortar", "chain", "flame"] },
  { name: "mike", level: 15, robot: "mike", towers: ["flame", "mortar", "pulse", "cryo", "flame", "chain"] },
  { name: "stan", level: 22, robot: "stan", towers: ["mortar", "pulse", "cryo", "chain", "mortar", "flame"] },
  { name: "lava", level: 27, robot: "mike", towers: ["flame", "pulse", "mortar", "cryo", "chain", "flame"] },
  { name: "boss", level: 30, robot: "stan", towers: ["mortar", "cryo", "pulse", "chain", "flame", "mortar"], wave: 99 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=default", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
});

await mkdir(OUT, { recursive: true });

for (const sc of SCENARIOS) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => console.warn(`  [page error] ${sc.name}: ${e.message}`));
  await page.goto(`${BASE}/?capture=1`, { waitUntil: "domcontentloaded" });

  // Wait for the store handle to attach.
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });

  // Unlock everything, fund the run, pick the pilot, enter the level.
  await page.evaluate((sc) => {
    const g = window.__game;
    g.getState().selectSlot(1);
    g.getState().debugUnlockThroughLevel(30);
    g.setState((st) => ({
      progress: {
        ...st.progress,
        bolts: 99999,
        robotUnlocks: { george: true, leela: true, mike: true, stan: true },
      },
      assetsPrewarmed: true,
    }));
    g.getState().setActiveRobot(sc.robot);
    g.setState({ levelLoadPending: false });
    g.getState().startLevel(sc.level);
    g.getState().dismissLevelIntro();
    g.getState().debugSetFreeTowers(true);
    g.getState().debugAddGold(99999);
    // The game auto-pauses to show a new-enemy dossier; keep clearing it so
    // the wave keeps running. Also drop achievement toasts that the
    // unlock-all above fires, and the new-enemy callout, so the frame is
    // clean.
    window.__keepRunning = setInterval(() => {
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
  }, sc);

  // Wait for the canvas to be sized (R3F measured) and the scene to paint.
  await page.waitForFunction(
    () => {
      const c = document.querySelector("canvas");
      return c && c.width > 800;
    },
    null,
    { timeout: 20000 },
  );
  await sleep(1200); // asset prewarm + first real frames

  // Line both sides of the path with towers.
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
        const kind = sc.towers[placed % sc.towers.length];
        G.getState().setSelectedKind(kind);
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

  // Force a late wave and let combat fill the field. The boss scenario forces
  // the final wave (clamped) so the biome matriarch is on screen.
  await page.evaluate((wave) => window.__game.getState().debugForceWave(wave), sc.wave ?? 7);
  await sleep(3600);

  // Drive the pilot into the middle of the path, then fire its ultimate +
  // primary so the screenshot catches the ability effect.
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
    G.getState().triggerRobotAbility(3); // ultimate (R)
    G.getState().triggerRobotAbility(0); // primary (Q)
  });
  await sleep(450);

  const info = await page.evaluate(() => {
    const w = window.__game.getState().world;
    clearInterval(window.__keepRunning);
    return {
      biome: w.biome,
      wave: w.wave,
      enemies: w.enemies.filter((e) => e.alive).length,
      towers: w.towers.length,
    };
  });

  const file = `${OUT}/mesozoic-${sc.name}-${info.biome}.png`;
  await page.screenshot({ path: file });
  console.log(
    `✓ ${sc.name}: ${info.biome} L${sc.level} wave ${info.wave} · ${info.towers} towers · ${info.enemies} enemies · placed ${placed} → ${file}`,
  );
  await page.close();
}

await browser.close();
console.log("done");
