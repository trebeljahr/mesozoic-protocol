// Run against a dev server: node scripts/check-scene-resources.mjs http://127.0.0.1:<port>
// No screenshots or recordings. Owns and closes one muted browser.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { bootstrap, stopKeepClean } from "./lib/capture-scenes.mjs";

const base = process.argv[2];
if (!base) throw new Error("Pass the URL of an existing local development server");
const browser = await chromium.launch({
  headless: true,
  args: [
    "--mute-audio",
    "--use-gl=angle",
    "--use-angle=default",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
  ],
});
const deadline = setTimeout(() => void browser.close(), 180_000);
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await bootstrap(page, base);
  await stopKeepClean(page);
  const settle = async () => {
    await page.waitForTimeout(1800);
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          let frames = 8;
          const tick = () => (--frames ? requestAnimationFrame(tick) : resolve());
          requestAnimationFrame(tick);
        }),
    );
  };
  const sample = async (label) => {
    const memory = await page.evaluate(async () => {
      const { rendererMemory } = await import("/scripts/lib/scene-resource-probe.ts");
      return rendererMemory();
    });
    console.log(JSON.stringify({ label, ...memory }));
    return memory;
  };
  const start = async (level) => {
    await page.evaluate((level) => {
      const game = window.__game;
      game.setState({ levelLoadPending: false });
      game.getState().startLevel(level);
      game.getState().dismissLevelIntro();
    }, level);
    await settle();
  };
  const bounded = (first, last, label) => {
    assert.ok(
      last.geometries <= first.geometries,
      `${label}: geometries ${first.geometries} -> ${last.geometries}`,
    );
    assert.ok(
      last.textures <= first.textures,
      `${label}: textures ${first.textures} -> ${last.textures}`,
    );
  };
  await start(4);
  for (const mode of ["fluid fixture remount", "player retry", "combat retry"]) {
    let warm;
    let last;
    for (let cycle = 0; cycle < 6; cycle++) {
      if (mode === "combat retry") {
        await page.evaluate(() => {
          const game = window.__game.getState();
          for (const kind of ["raptor", "para", "stego"]) game.debugSpawnEnemy(kind);
        });
        await settle();
      }
      if (mode === "fluid fixture remount") {
        await page.evaluate(() =>
          window.__game.setState((state) => ({
            world: { ...state.world, rivers: [], lakes: [] },
          })),
        );
        await settle();
      }
      await page.evaluate((mode) => {
        const game = window.__game;
        if (mode !== "fluid fixture remount") {
          game.setState({ levelLoadPending: false });
          game.getState().retryCurrentLevel();
          game.getState().dismissLevelIntro();
        } else
          game.setState((state) => ({
            world: {
              ...state.world,
              rivers: [
                {
                  id: "bend",
                  material: "water",
                  width: 2.4,
                  points: [
                    { x: -19, y: 0 },
                    { x: -10, y: 0 },
                    { x: -7, y: 5 },
                    { x: -4, y: 0 },
                    { x: 4, y: 0 },
                  ],
                },
              ],
              lakes: [
                { id: "join", material: "water", pos: { x: 5, y: 0 }, rx: 4, ry: 3, rot: 0.4 },
              ],
              flowFeatures: { rivers: [], lakes: [], bridges: [] },
            },
          }));
      }, mode);
      await settle();
      last = await sample(`${mode} ${cycle}`);
      if (cycle === 1) warm = last;
    }
    bounded(warm, last, mode);
  }
  let warm;
  let last;
  for (let cycle = 0; cycle < 4; cycle++) {
    await page.evaluate(() => window.__game.getState().goToWorldMap());
    await settle();
    for (const level of [8, 23, 28, 4]) await start(level);
    last = await sample(`biome round trip ${cycle}`);
    if (cycle === 1) warm = last;
  }
  bounded(warm, last, "biome round trip");
  assert.deepEqual(errors, []);
} finally {
  clearTimeout(deadline);
  await browser.close();
}
