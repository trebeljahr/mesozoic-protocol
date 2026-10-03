import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "../analytics";
import { getLevel } from "../levels";
import { emptyProgress } from "../progress";
import { useGame } from "../store";
import { canUseBattlefield } from "./playControl";
import { applyDamage, createWorld, spawnEnemy } from "./world";

vi.mock("../analytics", () => ({ track: vi.fn() }));
const state = () => useGame.getState();
beforeEach(() => {
  for (const reason of ["hidden", "orientation", "page-hidden", "native-background"] as const)
    state().setInterruptionBlocked(reason, false);
  useGame.setState({
    assetsPrewarmed: true,
    tutorial: null,
    tutorialReturnState: null,
    activeSlot: null,
    progress: emptyProgress(),
    difficultyPickerOpen: false,
    robotShopOpen: false,
    compendiumOpen: false,
    achievementsOpen: false,
    creditsOpen: false,
    skillTreeOpen: false,
  });
  state().startLevel(1);
  state().dismissLevelIntro();
  state().world.gold = 3000;
});
afterEach(() => state().setInterruptionBlocked("hidden", false));
const build = () => {
  state().setSelectedKind("pulse");
  for (let x = -18; x <= 18; x += 2)
    for (let y = -12; y <= 12; y += 2) {
      if (state().canPlace({ x, y })) {
        state().tryPlaceOrSelect({ x, y });
        return state().world.towers.at(-1)!;
      }
    }
  throw new Error("No build spot");
};
describe("battle pace and pause", () => {
  it("blocks tactical changes while the menu is paused and resumes explicitly", () => {
    const tower = build();
    state().selectTower(tower.id);
    state().togglePause();
    expect(canUseBattlefield(state())).toBe(false);
    const gold = state().world.gold;
    state().upgradeSelected("a");
    state().sellSelected();
    expect(state().world.gold).toBe(gold);
    expect(state().world.towerById.has(tower.id)).toBe(true);
    state().togglePause();
    expect(canUseBattlefield(state())).toBe(true);
  });
  it("resets speed on world replacement and leaves training pace in charge", () => {
    state().setSimulationSpeed(2);
    useGame.setState({ world: createWorld(getLevel(1)) });
    expect(state().simulationSpeed).toBe(1);
    Object.assign(state().world, { sessionKind: "tutorial" });
    state().setSimulationSpeed(2);
    expect(state().simulationSpeed).toBe(1);
  });
});

describe("combined practice and interruption controls", () => {
  it("resets controls through practice start/restart/return and excludes real practice kills from reports", () => {
    const original = state().world;
    const progress = state().progress;
    state().setSimulationSpeed(2);
    vi.mocked(track).mockClear();
    state().startTutorial("robot");
    expect(state().simulationSpeed).toBe(1);
    state().setSimulationSpeed(2);
    expect(state().simulationSpeed).toBe(1);
    const practice = state().world;
    applyDamage(practice, spawnEnemy(practice, "titan"), 100000, "electric", undefined, 0, false, {
      fromRobot: true,
    });
    practice.events.push({ type: "game-over", won: true });
    state().tick(0);
    expect(practice.runHistory.boltsEarned).toBeGreaterThan(0);
    expect(state().lastResult).toBeNull();
    expect(track).not.toHaveBeenCalled();
    state().restartTutorialLesson();
    expect(state().world.runHistory.boltsEarned).toBe(0);
    state().exitTutorial();
    expect(state().world).toBe(original);
    expect(state().progress).toBe(progress);
    expect(state().simulationSpeed).toBe(1);
    expect(original.runHistory.boltsEarned).toBe(0);
    expect(original.status).toBe("running");
  });
});
