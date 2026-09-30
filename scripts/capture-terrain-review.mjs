import { chromium } from "playwright";

// Development QA only; not a store screenshot producer.
if (!process.argv[2] || !process.env.BASE_URL)
  throw new Error(
    "Usage: BASE_URL=http://127.0.0.1:PORT node scripts/capture-terrain-review.mjs OUTPUT.png [LEVEL=4] [low] [--build]",
  );
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio", "--use-gl=angle", "--use-angle=default", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  if (process.argv[4] === "low")
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 4 }),
    );
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  await page.goto(`${process.env.BASE_URL}/?capture=1`);
  await page.waitForFunction(() => !!window.__game);
  await page.evaluate(
    (level) => {
      const g = window.__game;
      g.getState().selectSlot(1);
      g.getState().debugUnlockThroughLevel(30);
      g.setState({ assetsPrewarmed: true, levelLoadPending: false });
      g.getState().startLevel(level);
      g.getState().dismissLevelIntro();
    },
    Number(process.argv[3] || 4),
  );
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    const g = window.__game;
    g.setState({ levelIntroVisible: false, newEnemyQueue: [], achievementToasts: [] });
  });
  if (process.argv.includes("--build")) {
    await page.evaluate(() => {
      const g = window.__game;
      g.getState().debugSetFreeTowers(true);
      const path = g.getState().world.paths[0];
      for (let i = 9; i < path.length - 9; i += 9) {
        const p = path[i],
          q = path[i + 1];
        const dx = q.x - p.x,
          dy = q.y - p.y,
          length = Math.hypot(dx, dy) || 1;
        for (const side of [-1, 1]) {
          g.getState().setSelectedKind("pulse");
          g.getState().tryPlaceOrSelect(
            { x: p.x - (dy / length) * 2.6 * side, y: p.y + (dx / length) * 2.6 * side },
            { clearSelectionAfterPlacement: true },
          );
        }
      }
      g.getState().setSelectedKind(null);
    });
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: process.argv[2] });
  console.log(
    await page.evaluate(() => {
      const w = window.__game.getState().world;
      return {
        towers: w.towers.length,
        level: w.levelId,
        seed: w.proceduralSeed,
        biome: w.biome,
        qualityCores: navigator.hardwareConcurrency,
        riverCount: w.flowFeatures?.rivers.length,
        poolCount: w.flowFeatures?.lakes.length,
      };
    }),
  );
} finally {
  await browser.close();
}
