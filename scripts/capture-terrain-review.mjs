import { chromium } from "playwright";

// Development QA only; not a store screenshot producer.
if (!process.argv[2] || !process.env.BASE_URL)
  throw new Error(
    "Usage: BASE_URL=http://127.0.0.1:PORT node scripts/capture-terrain-review.mjs OUTPUT.png [LEVEL=4] [low]",
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
  await page.screenshot({ path: process.argv[2] });
  console.log(
    await page.evaluate(() => {
      const w = window.__game.getState().world;
      return {
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
