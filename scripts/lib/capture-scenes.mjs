// Shared headless-capture scene drivers.
//
// Extracted from scripts/capture-screenshots.mjs so the marketing capture and
// the store-submission capture (scripts/store-screenshots.mjs) drive the *same*
// scenes through the *same* store calls — only the viewport and the output
// post-processing differ between them.
//
// Everything here talks to the real game running in headless Chromium behind
// the `?capture=1` flag (see src/debug.ts): the Zustand store is exposed on
// `window.__game`, in-world debug overlays are suppressed, and the real-time
// frameloop runs normally — so the sim advances on its own and we just steer
// state, wait, and shoot.
//
// IMPORTANT: `?capture=1` is gated on `import.meta.env.DEV` (src/debug.ts), so
// these helpers need a *dev* server (`pnpm dev`). `vite preview` over a
// production `dist/` dead-codes the whole debug surface and `window.__game`
// never appears.

import { chromium } from "playwright";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Biomes run five levels each: forest 1-5, snow 6-10, desert 11-15,
// wasteland 16-20, lava 21-25, alien 26-30. Pilots are spread so the set
// shows all four kits and their ultimates.
export const COMBAT_SCENARIOS = [
  {
    file: "01-forest-defense",
    level: 4,
    robot: "george",
    towers: ["pulse", "chain", "mortar", "flame", "cryo", "pulse"],
  },
  {
    file: "03-lava-firefight",
    level: 23,
    robot: "mike",
    towers: ["flame", "mortar", "pulse", "cryo", "flame", "chain"],
  },
  {
    file: "04-alien-biome",
    level: 28,
    robot: "stan",
    towers: ["mortar", "cryo", "pulse", "chain", "flame", "mortar"],
  },
  {
    file: "05-desert-crossing",
    level: 13,
    robot: "leela",
    towers: ["chain", "cryo", "pulse", "mortar", "chain", "flame"],
  },
  {
    file: "06-snow-outpost",
    level: 8,
    robot: "leela",
    towers: ["cryo", "pulse", "chain", "mortar", "flame", "cryo"],
  },
  {
    file: "07-wasteland-serpentine",
    level: 18,
    robot: "stan",
    towers: ["mortar", "pulse", "flame", "cryo", "chain", "mortar"],
  },
];

export function launchCaptureBrowser() {
  return chromium.launch({
    headless: true,
    args: [
      "--use-gl=angle",
      "--use-angle=default",
      "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader",
    ],
  });
}

// Shared setup: unlock everything, fund the run, and keep clearing the
// auto-pause / new-enemy callout / achievement toasts so the frame stays
// clean and the wave keeps running.
export async function bootstrap(page, base) {
  await page.goto(`${base}/?capture=1`, { waitUntil: "domcontentloaded" });
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

export function stopKeepClean(page) {
  return page.evaluate(() => clearInterval(window.__keepClean));
}

export function waitForCanvas(page) {
  return page.waitForFunction(
    () => {
      const c = document.querySelector("canvas");
      return c && c.width > 800;
    },
    null,
    { timeout: 20000 },
  );
}

/**
 * Enter a level, line both sides of the path with towers, force a late wave,
 * drive the pilot into the fight and fire its ultimate. Leaves the page one
 * screenshot away from a defended-outpost-mid-wave frame.
 *
 * @param {object} sc  entry from COMBAT_SCENARIOS
 * @param {{ wave?: number | "boss", ultimate?: boolean }} [opts]  `wave` to
 *        force ("boss" picks the level's own boss wave out of
 *        `world.plannedWaves`); `ultimate: false` fires only the primary, which
 *        keeps a big screen-filling ultimate AoE from hiding the enemy the shot
 *        is meant to show.
 * @returns {Promise<{biome:string,wave:number,enemies:number,towers:number,placed:number}>}
 */
export async function stageCombat(page, sc, opts = {}) {
  const wanted = opts.wave ?? 7;
  const ultimate = opts.ultimate ?? true;

  await page.evaluate((sc) => {
    const g = window.__game;
    g.getState().setActiveRobot(sc.robot);
    g.setState({ levelLoadPending: false });
    g.getState().startLevel(sc.level);
    g.getState().dismissLevelIntro();
    g.getState().debugSetFreeTowers(true);
    g.getState().debugAddGold(99999);
  }, sc);

  await waitForCanvas(page);
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

  // Resolve "boss" against the level's own wave plan rather than hardcoding a
  // number — boss waves sit at different indices per level.
  await page.evaluate((wanted) => {
    const G = window.__game;
    let n = wanted;
    if (wanted === "boss") {
      const planned = G.getState().world.plannedWaves ?? [];
      const idx = planned.findIndex((w) => w?.bossWave === true);
      n = idx >= 0 ? idx + 1 : G.getState().world.totalWaves;
    }
    G.getState().debugForceWave(n);
  }, wanted);
  // Boss waves lead with an escort entourage; give the boss itself time to
  // walk on-screen before the shot.
  await sleep(wanted === "boss" ? 6000 : 3600);

  await page.evaluate(() => {
    const G = window.__game;
    const path = G.getState().world.paths[0];
    const mid = path[Math.floor(path.length * 0.5)];
    G.getState().selectRobotUnit(true);
    G.getState().orderRobotMove({ x: mid.x, y: mid.y + 1 });
  });
  await sleep(1500);
  await page.evaluate((ultimate) => {
    const G = window.__game;
    if (ultimate) G.getState().triggerRobotAbility(3); // ultimate
    G.getState().triggerRobotAbility(0); // primary
  }, ultimate);
  await sleep(450);

  const info = await page.evaluate(() => {
    const w = window.__game.getState().world;
    clearInterval(window.__keepClean);
    return {
      biome: w.biome,
      wave: w.wave,
      enemies: w.enemies.filter((e) => e.alive).length,
      towers: w.towers.length,
    };
  });
  return { ...info, placed };
}

/** World map, all biomes revealed. */
export async function stageWorldMap(page) {
  await page.evaluate(() => window.__game.getState().goToWorldMap());
  await waitForCanvas(page);
  await sleep(2600); // world-map pulls all biome models
  await stopKeepClean(page);
}

/** Compendium overlay on the world map. Defaults to the pilots section. */
export async function stageCompendium(page, section = "robot") {
  await page.evaluate((section) => {
    const g = window.__game;
    g.getState().goToWorldMap();
    g.getState().setCompendiumOpen(true, section);
  }, section);
  await sleep(2200);
  await stopKeepClean(page);
}

/** Meta skill tree overlay, funded with stars so tiers read as attainable. */
export async function stageSkillTree(page) {
  await page.evaluate(() => {
    const g = window.__game;
    g.getState().goToWorldMap();
    g.getState().setSkillTreeOpen(true);
  });
  await sleep(2200);
  await stopKeepClean(page);
}
