import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyProgress, loadSlot, saveSlot } from "../progress";
import { useGame } from "../store";

vi.mock("../analytics", () => ({ track: () => {} }));
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
      removeItem: (k: string) => data.delete(k),
    },
  });
  useGame.setState({ assetsPrewarmed: true, activeSlot: null, screen: "slots" });
});
afterEach(() => vi.unstubAllGlobals());

it("resumes the checkpoint through slot selection and discards it on restart/abandon", () => {
  useGame.getState().selectSlot(1);
  useGame.getState().startLevel(1);
  const world = useGame.getState().world;
  world.status = "running";
  world.gold = 777;
  useGame.getState().callWaveEarly();
  expect(loadSlot(1).checkpoint).not.toBeNull();
  useGame.getState().goToSlots();
  useGame.getState().selectSlot(1);
  expect(useGame.getState().world).toMatchObject({ gold: 777, wave: 0, status: "paused" });
  useGame.getState().retryCurrentLevel();
  expect(useGame.getState().world.gold).not.toBe(777);
  useGame.getState().goToWorldMap();
  expect(loadSlot(1).checkpoint).toBeNull();
});

it("defers live kills/bolts/XP until a quiet checkpoint commits them together", () => {
  useGame.getState().selectSlot(1);
  useGame.getState().startLevel(1);
  const world = useGame.getState().world;
  world.status = "paused";
  world.waveActive = true;
  world.robot.xp = 15;
  world.events.push({
    type: "death",
    target: "enemy",
    enemyKind: "raptor",
    bolts: 8,
    pos: { x: 0, y: 0 },
  });
  useGame.getState().tick(0);
  expect(useGame.getState().progress.bolts).toBe(8);
  expect(loadSlot(1).progress.bolts).toBe(0);
  expect(loadSlot(1).progress.robotXp.leela ?? 0).toBe(0);
  useGame.getState().goToSlots();
  useGame.getState().selectSlot(1);
  expect(useGame.getState().progress.bolts).toBe(0);
  expect(useGame.getState().world.robot.xp).toBe(0);
});

it("slot switching and deletion cannot let the old world overwrite another slot", () => {
  saveSlot(2, { ...emptyProgress(), bolts: 42 });
  useGame.getState().selectSlot(1);
  useGame.getState().startLevel(1);
  useGame.getState().goToSlots();
  useGame.getState().selectSlot(2);
  useGame.getState().goToWorldMap();
  expect(loadSlot(1).checkpoint).not.toBeNull();
  expect(loadSlot(2).checkpoint).toBeNull();
  expect(loadSlot(2).progress.bolts).toBe(42);
  useGame.getState().selectSlot(1);
  useGame.getState().deleteSlot(1);
  useGame.getState().goToWorldMap();
  expect(loadSlot(1).checkpoint).toBeNull();
});
