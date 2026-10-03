import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "../analytics";
import { getLevel } from "../levels";
import { emptyProgress } from "../progress";
import { sessionPause } from "../sessionPause";
import { useGame } from "../store";
import { canUseBattlefield } from "./playControl";
import { applyDamage, createTower, createWorld, spawnEnemy } from "./world";

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
describe("planning pause", () => {
  it("permits paid tactical changes without advancing combat or calling waves", () => {
    state().togglePlanningPause();
    expect(state().planningPaused).toBe(true);
    expect(canUseBattlefield(state())).toBe(true);
    const tower = build();
    const afterBuild = state().world.gold;
    state().selectTower(tower.id);
    state().upgradeSelected("a");
    expect(tower.upgrades.a).toBe(1);
    expect(state().world.gold).toBeLessThan(afterBuild);
    state().setTargetingMode("strongest");
    expect(tower.targetingMode).toBe("strongest");
    const hive = createTower(state().world, "hive", { x: 0, y: 0 });
    state().beginDroneAssignment(hive.id, 0);
    state().assignDroneToTower(tower.id);
    expect(hive.droneAssignments[0]).toBe(tower.id);
    state().clearDroneAssignment(hive.id, 0);
    expect(hive.droneAssignments[0]).toBeNull();
    state().selectTower(tower.id);
    state().sellSelected();
    expect(state().world.towerById.has(tower.id)).toBe(false);
    state().tick(0);
    state().tick(30);
    state().callWaveEarly();
    expect(state().world.time).toBe(0);
    expect(state().world.wave).toBe(0);
    state().togglePlanningPause();
    expect(state().world.status).toBe("running");
  });
  it("preserves Containment selling rules during planning", () => {
    const tower = build();
    state().selectTower(tower.id);
    state().world.sellingDisabled = true;
    state().togglePlanningPause();
    const gold = state().world.gold;
    state().sellSelected();
    expect(state().world.gold).toBe(gold);
    expect(state().world.towerById.has(tower.id)).toBe(true);
  });
  it("keeps menu and interruption pauses separate from planning", () => {
    const tower = build();
    state().selectTower(tower.id);
    state().togglePlanningPause();
    state().togglePause();
    expect(state().planningPaused).toBe(false);
    expect(state().world.status).toBe("paused");
    const gold = state().world.gold;
    state().upgradeSelected("a");
    state().sellSelected();
    expect(state().world.gold).toBe(gold);
    expect(state().world.towerById.has(tower.id)).toBe(true);
    state().togglePlanningPause();
    expect(state().world.status).toBe("paused");
    state().togglePause();
    state().togglePlanningPause();
    state().setInterruptionBlocked("hidden", true);
    expect(state().planningPaused).toBe(false);
    state().setInterruptionBlocked("hidden", false);
    state().togglePlanningPause();
    expect(state().world.status).toBe("paused");
    state().togglePause();
    expect(state().world.status).toBe("running");
  });
  it("does not resume planning through a modal and resets speed between runs", () => {
    state().setSimulationSpeed(2);
    state().togglePlanningPause();
    state().setDifficultyPickerOpen(true);
    state().togglePlanningPause();
    expect(state().world.status).toBe("paused");
    expect(canUseBattlefield(state())).toBe(false);
    state().setDifficultyPickerOpen(false);
    expect(state().world.status).toBe("paused");
    state().retryCurrentLevel();
    expect(state().simulationSpeed).toBe(1);
    expect(state().planningPaused).toBe(false);
  });
  it("resets transient controls for checkpoint or training world replacements", () => {
    state().setSimulationSpeed(2);
    state().togglePlanningPause();
    useGame.setState({ world: createWorld(getLevel(1)) });
    expect(state().simulationSpeed).toBe(1);
    expect(state().planningPaused).toBe(false);
  });
  it("leaves training pace and action gates in charge", () => {
    Object.assign(state().world, { sessionKind: "tutorial" });
    state().setSimulationSpeed(2);
    state().togglePlanningPause();
    expect(state().simulationSpeed).toBe(1);
    expect(state().planningPaused).toBe(false);
    expect(state().world.status).toBe("running");
  });
});

describe("combined practice and interruption controls", () => {
  it("rejects stale planning ownership during interruption and until explicit resume", () => {
    const tower = build();
    state().selectTower(tower.id);
    state().togglePlanningPause();
    // Exercise the shared access guard independently of the setter that normally clears planning.
    sessionPause.setBlocked("hidden", true, state().world);
    expect(state().planningPaused).toBe(true);
    expect(canUseBattlefield(state())).toBe(false);
    const gold = state().world.gold;
    state().upgradeSelected("a");
    state().sellSelected();
    expect(state().world.gold).toBe(gold);
    sessionPause.setBlocked("hidden", false, state().world);
    expect(canUseBattlefield(state())).toBe(false);
    state().setInterruptionBlocked("hidden", true);
    state().setInterruptionBlocked("hidden", false);
    state().togglePause();
    expect(canUseBattlefield(state())).toBe(true);
  });

  it("resets controls through practice start/restart/return and excludes real practice kills from reports", () => {
    const original = state().world;
    const progress = state().progress;
    state().setSimulationSpeed(2);
    state().togglePlanningPause();
    vi.mocked(track).mockClear();
    state().startTutorial("robot");
    expect(state().simulationSpeed).toBe(1);
    expect(state().planningPaused).toBe(false);
    state().setSimulationSpeed(2);
    state().togglePlanningPause();
    expect(state().simulationSpeed).toBe(1);
    expect(state().planningPaused).toBe(false);
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
    expect(state().planningPaused).toBe(false);
    state().exitTutorial();
    expect(state().world).toBe(original);
    expect(state().progress).toBe(progress);
    expect(state().planningPaused).toBe(false);
    expect(state().simulationSpeed).toBe(1);
    expect(original.runHistory.boltsEarned).toBe(0);
    expect(original.status).toBe("paused");
  });
});
