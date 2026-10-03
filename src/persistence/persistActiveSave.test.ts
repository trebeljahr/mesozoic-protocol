import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadSlot, slotKey } from "../progress";
import { useGame } from "../store";
import { excludeWorldFromPersistence, restoreCheckpoint } from "./missionCheckpoint";
import { detachMission } from "./missionPersistence";
import { persistActiveSave } from "./persistActiveSave";

vi.mock("../analytics", () => ({ track: vi.fn() }));
const initial = useGame.getState();
const state = () => useGame.getState();
let data: Map<string, string>;
let failWrites: boolean;
beforeEach(() => {
  data = new Map();
  failWrites = false;
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failWrites) throw new Error("disk full");
        data.set(key, value);
      },
      removeItem: (key: string) => data.delete(key),
    },
  });
  useGame.setState({ ...initial, activeSlot: null, screen: "slots", assetsPrewarmed: true });
  state().selectSlot(1);
  state().startLevel(1);
  state().dismissLevelIntro();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it("forces a same-wave checkpoint before the next periodic save is due", () => {
  const world = state().world;
  const previous = loadSlot(1);
  const oldTime = restoreCheckpoint(previous.checkpoint!).time;
  world.time += 0.25;
  world.gold += 9;
  world.runHistory.boltsEarned += 7;
  useGame.setState({
    progress: { ...state().progress, bolts: state().progress.bolts + 7 },
    runMinDifficulty: "easy",
  });
  expect(persistActiveSave()).toBe(true);
  const saved = loadSlot(1);
  const restored = restoreCheckpoint(saved.checkpoint!);
  expect(restored.time).toBe(oldTime + 0.25);
  expect(restored.gold).toBe(world.gold);
  expect(saved.progress.bolts).toBe(state().progress.bolts);
  expect(restored.runHistory.boltsEarned).toBe(world.runHistory.boltsEarned);
  expect(saved.checkpoint!.minDifficulty).toBe("easy");
});

it("saves campaign progress outside an active mission session", () => {
  detachMission(state().world);
  useGame.setState({ progress: { ...state().progress, bolts: state().progress.bolts + 4 } });
  expect(persistActiveSave()).toBe(true);
  expect(loadSlot(1).progress.bolts).toBe(state().progress.bolts);
});

it("never replaces campaign data from tutorial worlds or without an active slot", () => {
  const original = data.get(slotKey(1));
  excludeWorldFromPersistence(state().world);
  useGame.setState({ progress: { ...state().progress, bolts: 99999 } });
  expect(persistActiveSave()).toBe(true);
  expect(data.get(slotKey(1))).toBe(original);
  useGame.setState({ activeSlot: null });
  expect(persistActiveSave()).toBe(true);
  expect(data.get(slotKey(1))).toBe(original);
});

it("reports checkpoint failure without committing newer rewards alone", () => {
  const original = data.get(slotKey(1));
  state().world.time += 0.25;
  useGame.setState({ progress: { ...state().progress, bolts: state().progress.bolts + 7 } });
  failWrites = true;
  expect(persistActiveSave()).toBe(false);
  expect(data.get(slotKey(1))).toBe(original);
});
