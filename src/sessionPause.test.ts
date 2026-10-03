import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLevel } from "./levels";
import { emptyProgress } from "./progress";
import { listenForSessionInterruptions, SessionPause } from "./sessionPause";
import { createWorld, spawnEnemy } from "./sim/world";
import { useGame } from "./store";

const reasons = [
  "hidden",
  "page-hidden",
  "native-background",
  "orientation",
  "update-install",
] as const;
beforeEach(() => {
  for (const reason of reasons) useGame.getState().setInterruptionBlocked(reason, false);
  useGame.setState({
    assetsPrewarmed: true,
    progress: emptyProgress(),
    activeSlot: null,
    difficultyPickerOpen: false,
    robotShopOpen: false,
    compendiumOpen: false,
    achievementsOpen: false,
    creditsOpen: false,
    skillTreeOpen: false,
  });
  useGame.getState().startLevel(1);
});
afterEach(() => {
  for (const reason of reasons) useGame.getState().setInterruptionBlocked(reason, false);
});

const state = () => useGame.getState();
const run = () => {
  state().dismissLevelIntro();
  expect(state().world.status).toBe("running");
};

describe("mission interruption ownership", () => {
  it.each(reasons)("%s blocks combat and requires explicit resume after returning", (reason) => {
    run();
    useGame.setState({ progress: { ...state().progress, encountered: { raptor: true } } });
    const enemy = spawnEnemy(state().world, "raptor");
    state().tick(0);
    state().tick(0.2);
    const before = { ...enemy.pos };
    state().setInterruptionBlocked(reason, true);
    const time = state().world.time;
    state().tick(20);
    state().togglePause();
    expect(state().world.status).toBe("paused");
    expect(state().world.time).toBe(time);
    expect(enemy.pos).toEqual(before);
    state().setInterruptionBlocked(reason, false);
    expect(state().world.status).toBe("paused");
    state().togglePause();
    expect(state().world.status).toBe("running");
    state().tick(100);
    expect(state().world.time).toBe(time); // no suspended-frame catch-up
  });

  it("does not resume briefings, difficulty dialogs, or enemy alerts after interruption", () => {
    for (const modal of ["intro", "difficulty", "enemy"] as const) {
      state().startLevel(1);
      if (modal !== "intro") state().dismissLevelIntro();
      if (modal === "difficulty") state().setDifficultyPickerOpen(true);
      if (modal === "enemy") {
        state().world.status = "paused";
        useGame.setState({
          newEnemyQueue: [{ tag: "species", species: "raptor" }],
          autoPausedForNewEnemy: true,
        });
      }
      state().setInterruptionBlocked("hidden", true);
      state().setInterruptionBlocked("orientation", true);
      state().setInterruptionBlocked("hidden", false);
      if (modal === "intro") state().dismissLevelIntro();
      if (modal === "difficulty") state().setDifficultyPickerOpen(false);
      if (modal === "enemy") state().dismissNewEnemy();
      expect(state().world.status).toBe("paused");
      state().togglePause();
      expect(state().world.status).toBe("paused");
      state().setInterruptionBlocked("orientation", false);
      expect(state().world.status).toBe("paused");
      state().togglePause();
      expect(state().world.status).toBe("running");
      useGame.setState({ progress: emptyProgress() });
    }
  });

  it("preserves manual pauses and prevents resume through an open modal", () => {
    run();
    state().togglePause();
    state().setDifficultyPickerOpen(true);
    state().setInterruptionBlocked("hidden", true);
    state().setInterruptionBlocked("hidden", false);
    state().togglePause();
    expect(state().world.status).toBe("paused");
    state().setDifficultyPickerOpen(false);
    expect(state().world.status).toBe("paused");
  });

  it("applies existing app blockers to newly started missions", () => {
    state().setInterruptionBlocked("orientation", true);
    state().startLevel(1);
    state().dismissLevelIntro();
    expect(state().world.status).toBe("paused");
    state().tick(0);
    state().tick(1);
    expect(state().world.time).toBe(0);
  });

  it("keeps independent browser and native lifecycle signals until all clear", () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const win = new EventTarget();
    const world = createWorld(getLevel(1));
    const pause = new SessionPause();
    const cleanup = listenForSessionInterruptions(
      doc as unknown as Document,
      win as unknown as Window,
      (reason, blocked) => pause.setBlocked(reason, blocked, world),
    );
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("pagehide"));
    doc.dispatchEvent(new Event("pause"));
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("pageshow"));
    expect(pause.resume(world)).toBe(false);
    doc.dispatchEvent(new Event("resume"));
    expect(world.status).toBe("paused");
    expect(pause.canAutoResume(world)).toBe(false);
    expect(pause.resume(world)).toBe(true);
    cleanup();
    doc.dispatchEvent(new Event("pause"));
    expect(world.status).toBe("running");
  });
});
