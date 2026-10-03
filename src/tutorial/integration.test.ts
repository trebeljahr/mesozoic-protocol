import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "../analytics";
import { DEFAULT_BINDINGS } from "../input/keyBindings";
import {
  canPersistWorld,
  captureCheckpoint,
  isMissionCheckpoint,
  restoreCheckpoint,
} from "../persistence/missionCheckpoint";
import {
  beginMission,
  checkpointMission,
  finishMission,
  hasMissionSession,
} from "../persistence/missionPersistence";
import { clearSaveIssue, getSaveIssues, retryFailedSaves } from "../persistence/storageHealth";
import { emptyProgress, loadSlot, slotKey } from "../progress";
import { useGame } from "../store";
import { tutorialKeyboardHints } from "./keyboardHints";
import { CHAPTERS, createTraining } from "./lessons";

vi.mock("../analytics", () => ({ track: vi.fn() }));
const initial = useGame.getState();
const state = () => useGame.getState();
const reasons = ["hidden", "page-hidden", "native-background", "orientation"] as const;
let data: Map<string, string>;
let failWrites: boolean;
let writes: ReturnType<typeof vi.fn>;

beforeEach(() => {
  data = new Map();
  failWrites = false;
  writes = vi.fn((key: string, value: string) => {
    if (failWrites) throw new Error("QuotaExceededError");
    data.set(key, value);
  });
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: writes,
      removeItem: (key: string) => data.delete(key),
    },
  });
  useGame.setState({
    ...initial,
    activeSlot: null,
    assetsPrewarmed: true,
    progress: emptyProgress(),
  });
  for (const reason of reasons) state().setInterruptionBlocked(reason, false);
  for (const issue of getSaveIssues()) clearSaveIssue(issue.key);
  state().selectSlot(1);
  state().startLevel(1);
  state().dismissLevelIntro();
  state().world.gold = 777;
  checkpointMission(state().world, state().progress, "medium", true);
  writes.mockClear();
  vi.mocked(track).mockClear();
});
afterEach(() => {
  for (const reason of reasons) state().setInterruptionBlocked(reason, false);
  for (const issue of getSaveIssues()) clearSaveIssue(issue.key);
  vi.unstubAllGlobals();
});

describe("training / mission persistence integration", () => {
  for (const exit of ["exitTutorial", "goToWorldMap", "goToSlots"] as const) {
    it.each(
      CHAPTERS,
    )(`${exit} restores %s practice without banking dirty campaign rewards`, (chapter) => {
      const world = state().world;
      // Live rewards newer than the checkpoint must remain in the original session.
      const progress = { ...state().progress, bolts: 91, robotXp: { leela: 430 } };
      useGame.setState({ progress });
      world.robot.xp = 430;
      world.waveActive = true;
      const saved = new Map(data);
      state().startTutorial(chapter);
      const training = state().world;
      expect(canPersistWorld(training)).toBe(false);
      beginMission(1, training, state().progress);
      expect(hasMissionSession(training)).toBe(false);
      expect(checkpointMission(training, state().progress, "medium", true)).toBe(false);
      finishMission(training, state().progress);
      state().restartTutorialLesson();
      state().startTutorial(chapter);
      state().world.events.push(
        { type: "death", target: "enemy", enemyKind: "raptor", bolts: 999, pos: { x: 0, y: 0 } },
        { type: "game-over", won: true },
      );
      state().tick(0);
      state().tick(0.1);
      expect(state().achievementToasts).toEqual([]);
      expect(state().lastResult).toBeNull();
      state()[exit]();
      expect(state().world).toBe(world);
      expect(state().progress).toBe(progress);
      expect(state().activeSlot).toBe(1);
      expect(state().screen).toBe("playing");
      expect(hasMissionSession(world)).toBe(true);
      expect(data).toEqual(saved);
      expect(writes).not.toHaveBeenCalled();
      expect(track).not.toHaveBeenCalled();
    });
  }

  it("preserves a failed transaction and retries its original campaign payload after training", async () => {
    const world = state().world;
    const progress = { ...state().progress, bolts: 123 };
    useGame.setState({ progress });
    world.gold = 456;
    failWrites = true;
    expect(checkpointMission(world, progress, "medium", true)).toBe(false);
    const issues = getSaveIssues();
    const saved = new Map(data);
    writes.mockClear();
    for (const chapter of CHAPTERS) {
      state().startTutorial(chapter);
      state().restartTutorialLesson();
    }
    state().startTutorial("progression");
    state().setMetaSkillTier("pulse", "a", 1);
    state().setRobotSkillRank("leela", "vitality", 1);
    state().exitTutorial();
    expect(getSaveIssues()).toBe(issues);
    expect(state().progress).toBe(progress);
    expect(state().world).toBe(world);
    expect(data).toEqual(saved);
    expect(writes).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
    failWrites = false;
    await retryFailedSaves();
    expect(getSaveIssues()).toEqual([]);
    const loaded = loadSlot(1);
    expect(loaded.progress.bolts).toBe(123);
    expect(restoreCheckpoint(loaded.checkpoint!).gold).toBe(456);
  });

  it("accepts legacy absent sessionKind, but rejects tagged training checkpoints even after serialization", () => {
    const checkpoint = loadSlot(1).checkpoint!;
    expect(JSON.parse(checkpoint.world)).not.toHaveProperty("sessionKind");
    expect(isMissionCheckpoint(checkpoint)).toBe(true);
    expect(restoreCheckpoint(checkpoint).sessionKind).toBeUndefined();
    const training = createTraining().world;
    expect(captureCheckpoint(training, "medium", "medium")).toBeNull();
    const tagged = {
      ...checkpoint,
      world: JSON.stringify({ ...JSON.parse(checkpoint.world), sessionKind: "tutorial" }),
    };
    expect(isMissionCheckpoint(tagged)).toBe(false);
    expect(() => restoreCheckpoint(tagged)).toThrow("Invalid mission checkpoint");
    const unknown = {
      ...checkpoint,
      world: JSON.stringify({ ...JSON.parse(checkpoint.world), sessionKind: "unknown" }),
    };
    expect(isMissionCheckpoint(unknown)).toBe(false);
    const clone = { ...state().world, sessionKind: "tutorial" as const };
    expect(canPersistWorld(clone)).toBe(false); // no WeakSet registration required
    expect(data.get(slotKey(1))).toBeTruthy();
  });
});

describe("training interruption integration", () => {
  it.each(
    reasons,
  )("%s freezes training and latches the suspended campaign until explicit resume", (reason) => {
    const original = state().world;
    state().tick(1);
    state().tick(1.1);
    const originalTime = original.time;
    state().startTutorial();
    state().tick(10);
    state().tick(10.1);
    state().setInterruptionBlocked(reason, true);
    const frozen = state().world.time;
    state().tick(40);
    expect(state().world.time).toBe(frozen);
    expect(state().ui.status).toBe("paused");
    state().startTutorial("field");
    state().restartTutorialLesson();
    expect(state().world.status).toBe("paused");
    state().tick(50);
    state().tick(51);
    expect(state().world.time).toBe(0);
    state().setInterruptionBlocked(reason, false);
    expect(state().world.status).toBe("paused");
    state().exitTutorial();
    expect(state().world).toBe(original);
    expect(state().ui.status).toBe("paused");
    expect(original.time).toBe(originalTime);
    state().tick(60);
    expect(original.time).toBe(originalTime);
    state().togglePause();
    expect(original.status).toBe("running");
    state().tick(500);
    expect(original.time).toBe(originalTime);
  });

  it("does not resume on progression-dialog completion or restore a manual pause as running", () => {
    state().togglePause();
    const original = state().world;
    state().startTutorial("progression");
    state().setSkillTreeOpen(true);
    state().setInterruptionBlocked("hidden", true);
    state().setInterruptionBlocked("hidden", false);
    state().setMetaSkillTier("pulse", "a", 1);
    expect(state().ui.status).toBe("paused");
    state().setRobotShopOpen(true);
    state().setRobotSkillRank("leela", "vitality", 1);
    expect(state().ui.status).toBe("paused");
    state().exitTutorial();
    expect(state().world).toBe(original);
    expect(state().ui.status).toBe("paused");
  });

  it("inherits current blockers when resuming a real checkpoint", () => {
    state().goToSlots();
    state().setInterruptionBlocked("orientation", true);
    state().selectSlot(1);
    expect(state().world.status).toBe("paused");
    state().togglePause();
    expect(state().world.status).toBe("paused");
    state().setInterruptionBlocked("orientation", false);
    expect(state().world.status).toBe("paused");
  });
});

it("uses the configured robot and ability shortcuts", () => {
  expect(
    tutorialKeyboardHints({
      ...DEFAULT_BINDINGS,
      robot: "Digit9",
      ability1: "KeyA",
      ability2: "KeyS",
      ability3: "KeyD",
      ability4: "KeyF",
    }),
  ).toEqual({ robot: "9", abilities: "A / S / D / F" });
});
