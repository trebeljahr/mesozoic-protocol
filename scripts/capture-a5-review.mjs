// Development acceptance only. Never used for store screenshots.

import fs from "node:fs/promises";
import { chromium } from "playwright";

const mode = process.argv[2] || "static";
const out = process.argv[3];
if (
  !process.env.BASE_URL ||
  !out ||
  !["static", "detail", "props", "combat", "low", "mobile", "transitions"].includes(mode)
)
  throw new Error(
    "Usage: BASE_URL=http://127.0.0.1:PORT node scripts/capture-a5-review.mjs [static|detail|props|combat|low|mobile|transitions] OUTPUT_PREFIX",
  );
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
const log = { mode, errors: [] };
try {
  const page = await browser.newPage({
    viewport: mode === "mobile" ? { width: 844, height: 390 } : { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    hasTouch: mode === "mobile",
    isMobile: mode === "mobile",
  });
  page.on("pageerror", (e) => log.errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") log.errors.push(message.text());
  });
  await page.addInitScript(
    ({ low }) => {
      localStorage.setItem("mesozoic-protocol:audio:v2", JSON.stringify({ muted: true }));
      if (low) Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 4 });
    },
    { low: mode === "low" || mode === "mobile" },
  );
  await page.goto(`${process.env.BASE_URL}/?capture=1`);
  await page.waitForFunction(() => !!window.__game);
  await page.evaluate(
    (level) => {
      const g = window.__game;
      g.getState().selectSlot(1);
      g.getState().debugUnlockThroughLevel(30);
      g.setState((st) => ({
        assetsPrewarmed: true,
        progress: {
          ...st.progress,
          seenModesUnlockExplainer: true,
          seenEndlessUnlockExplainer: true,
        },
      }));
      g.getState().startLevel(level);
      g.getState().dismissLevelIntro();
      g.setState({ achievementToasts: [] });
    },
    Number(process.env.REVIEW_LEVEL || 4),
  );
  await page.waitForTimeout(5000);
  await page.evaluate(async () => {
    const f = await import(
      performance
        .getEntriesByType("resource")
        .find((e) => e.name.includes("/@react-three_fiber.js?")).name
    );
    window.__reviewRoot = f._roots.get(document.querySelector("canvas")).store.getState();
  });
  if (mode === "detail") {
    await page.evaluate(() => {
      const root = window.__reviewRoot;
      root.camera.zoom = 44;
      root.camera.updateProjectionMatrix();
      root.invalidate();
    });
    await page.waitForTimeout(1200);
  }
  log.camera = await page.evaluate(() => ({
    position: window.__reviewRoot.camera.position.toArray(),
    zoom: window.__reviewRoot.camera.zoom,
    quality: navigator.hardwareConcurrency,
  }));
  await page.screenshot({ path: out + "-start.png" });
  if (mode === "props") {
    const target = await page.evaluate(() => {
      const g = window.__game;
      g.getState().debugAddGold(500);
      const tree = [...g.getState().world.trees].sort(
        (a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y),
      )[0];
      const root = window.__reviewRoot;
      const v = root.camera.position
        .clone()
        .set(tree.pos.x, 0.02, -tree.pos.y)
        .project(root.camera);
      return { id: tree.id, x: (v.x + 1) * 720, y: (1 - v.y) * 450 };
    });
    await page.mouse.click(target.x, target.y);
    log.treeRemoval = await page.evaluate((id) => {
      const g = window.__game;
      const selected = g.getState().selectedTreeId;
      const before = g.getState().world.trees.length;
      g.getState().confirmRemoveTree();
      return {
        id,
        selected,
        before,
        after: g.getState().world.trees.length,
        removed: !g.getState().world.trees.some((t) => t.id === id),
        stoneCount: g.getState().world.rocks.filter((r) => r.layerIndex === 2).length,
      };
    }, target.id);
    if (
      !log.treeRemoval.removed ||
      log.treeRemoval.selected !== target.id ||
      log.treeRemoval.stoneCount !== 0
    )
      throw new Error("Prop selection/removal failed: " + JSON.stringify(log.treeRemoval));
  }
  if (mode === "props") {
    const shrub = await page.evaluate(() => {
      const r = window.__game.getState().world.rocks.find((r) => r.layerIndex === 1);
      const root = window.__reviewRoot;
      const p = root.camera.position.clone().set(r.pos.x, 0.02, -r.pos.y).project(root.camera);
      return { id: r.id, x: (p.x + 1) * 720, y: (1 - p.y) * 450 };
    });
    await page.mouse.click(shrub.x, shrub.y);
    log.shrubRemoval = await page.evaluate((id) => {
      const g = window.__game,
        selected = g.getState().selectedRockId;
      g.getState().confirmRemoveRock();
      return { id, selected, removed: !g.getState().world.rocks.some((r) => r.id === id) };
    }, shrub.id);
    if (!log.shrubRemoval.removed || log.shrubRemoval.selected !== shrub.id)
      throw new Error("Shrub selection/removal failed: " + JSON.stringify(log.shrubRemoval));
    await page.waitForTimeout(300);
    const base = await page.evaluate(() => {
      const root = window.__reviewRoot,
        path = window.__game.getState().world.paths[0],
        end = path[path.length - 1];
      const prev = path[path.length - 2];
      const length = Math.hypot(prev.x - end.x, prev.y - end.y) || 1;
      // Click just inside the approach; the HQ centre can lie on the map boundary.
      const p = root.camera.position
        .clone()
        .set(
          end.x + ((prev.x - end.x) / length) * 0.35,
          0.001,
          -end.y - ((prev.y - end.y) / length) * 0.35,
        )
        .project(root.camera);
      return { x: (p.x + 1) * 720, y: (1 - p.y) * 450 };
    });
    await page.mouse.click(base.x, base.y);
    log.baseSelected = await page.evaluate(() => window.__game.getState().world.selectedBase);
    if (!log.baseSelected) {
      log.baseDebug = await page.evaluate(
        ({ x, y }) => ({
          state: window.__game.getState().world.status,
          element: document.elementFromPoint(x, y)?.outerHTML.slice(0, 300),
        }),
        base,
      );
      throw new Error("Base selection failed: " + JSON.stringify({ base, ...log.baseDebug }));
    }
  }
  if (mode === "combat") {
    log.placement = await page.evaluate(() => {
      const g = window.__game;
      g.getState().debugAddGold(2000);
      const path = g.getState().world.paths[0];
      const placements = [];
      for (let i = 15; i < path.length - 10; i += 18) {
        const p = path[i];
        const q = path[i + 1];
        const len = Math.hypot(q.x - p.x, q.y - p.y);
        for (const side of [-1, 1]) {
          const pos = {
            x: p.x - ((q.y - p.y) / len) * 3.2 * side,
            y: p.y + ((q.x - p.x) / len) * 3.2 * side,
          };
          g.getState().setSelectedKind(placements.length % 2 ? "chain" : "pulse");
          if (g.getState().canPlace(pos)) {
            g.getState().tryPlaceOrSelect(pos, { clearSelectionAfterPlacement: true });
            placements.push(pos);
          }
        }
        if (placements.length >= 6) break;
      }
      g.getState().setSelectedKind(null);
      return placements;
    });
    const point = await page.evaluate(() => {
      const t = window.__game.getState().world.towers[0];
      const root = window.__reviewRoot;
      const v = root.camera.position.clone().set(t.pos.x, 0.5, -t.pos.y).project(root.camera);
      return { x: (v.x + 1) * 720, y: (1 - v.y) * 450, id: t.id };
    });
    await page.mouse.click(point.x, point.y);
    log.selection = await page.evaluate(() => window.__game.getState().world.selectedTowerId);
    log.clickedTower = point.id;
    log.heroBefore = await page.evaluate(() => {
      const g = window.__game;
      const w = g.getState().world;
      const p = w.paths[0][Math.floor(w.paths[0].length * 0.55)];
      g.getState().selectRobotUnit(true);
      return { pos: { ...w.robot.pos }, target: p, accepted: g.getState().orderRobotMove(p) };
    });
    await page.evaluate(() => window.__game.getState().selectRobotUnit(false));
    await page.keyboard.press("Space");
    await page.evaluate(() => {
      window.__qaClean = setInterval(() => {
        const g = window.__game;
        g.setState({
          newEnemyQueue: [],
          deferredNewEnemyQueue: [],
          autoPausedForNewEnemy: false,
          achievementToasts: [],
        });
        if (g.getState().world.status === "paused") g.getState().togglePause();
      }, 100);
    });
    await page.waitForTimeout(12000);
    log.combat = await page.evaluate(() => {
      const w = window.__game.getState().world;
      return {
        wave: w.wave,
        active: w.waveActive,
        enemies: w.enemies.filter((e) => e.alive).map((e) => ({ pos: e.pos, hp: e.hp })),
        hero: w.robot.pos,
        kills: w.robot.kills,
        lives: w.lives,
        towers: w.towers.map((t) => ({ kind: t.kind, kills: t.kills })),
      };
    });
    await page.screenshot({ path: out + "-wave.png" });
    await page.waitForTimeout(12000);
    await page.waitForFunction(
      () => {
        const w = window.__game.getState().world;
        return w.beams.some((b) => b.color === "#9fd8ff" && b.expiresAt > w.time + 0.05);
      },
      null,
      { timeout: 30000 },
    );
    await page.screenshot({ path: out + "-energy.png" });
    await page.waitForFunction(
      () => {
        const w = window.__game.getState().world;
        return w.wave > 1 || (w.wave === 1 && !w.waveActive);
      },
      null,
      { timeout: 60000 },
    );
    log.waveLater = await page.evaluate(() => {
      clearInterval(window.__qaClean);
      const w = window.__game.getState().world;
      return {
        wave: w.wave,
        active: w.waveActive,
        enemies: w.enemies.filter((e) => e.alive).length,
        lives: w.lives,
        hero: w.robot.pos,
      };
    });
  }
  if (mode === "mobile") {
    await page.getByRole("button", { name: /build/i }).tap();
    log.mobileButtons = await page.getByRole("button").allTextContents();
    await page.screenshot({ path: out + "-build.png" });
    await page.getByRole("button", { name: /Pulse Rifle/ }).tap();
    log.mobileSelectedKind = await page.evaluate(() => window.__game.getState().selectedKind);
    await page.screenshot({ path: out + "-placement.png" });
  }
  if (mode === "transitions") {
    await page.evaluate(() => window.__game.getState().goToWorldMap());
    await page.waitForTimeout(2500);
    await page.screenshot({ path: out + "-map.png" });
    await page.evaluate(() => window.__game.getState().goToSlots());
    await page.waitForTimeout(2500);
    await page.screenshot({ path: out + "-slots.png" });
  }
  console.log(JSON.stringify(log, null, 2));
  await fs.writeFile(out + ".json", JSON.stringify(log, null, 2));
  if (
    log.errors.length ||
    (mode === "combat" && log.selection !== log.clickedTower) ||
    (mode === "mobile" && log.mobileSelectedKind !== "pulse")
  )
    throw new Error("A5 interaction/render acceptance failed; inspect JSON log");
} finally {
  await browser.close();
}
