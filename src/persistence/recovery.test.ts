import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLevel } from "../levels";
import {
  backupKey,
  deleteSlot,
  emptyProgress,
  exportSlot,
  importSlot,
  listSlots,
  loadSlot,
  parseSaveImport,
  recoverSlot,
  saveSlot,
  slotKey,
} from "../progress";
import { createTower, createWorld } from "../sim/world";
import {
  captureCheckpoint,
  excludeWorldFromPersistence,
  restoreCheckpoint,
} from "./missionCheckpoint";
import { beginMission, checkpointMission, finishMission } from "./missionPersistence";
import {
  clearSaveIssue,
  getSaveIssues,
  migrateStorageKey,
  retryFailedSaves,
} from "./storageHealth";

let storage: Storage;
beforeEach(() => {
  const data = new Map<string, string>();
  storage = {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => data.clear(),
  };
  vi.stubGlobal("window", { localStorage: storage });
  for (const issue of getSaveIssues()) clearSaveIssue(issue.key);
});
afterEach(() => vi.unstubAllGlobals());

describe("save recovery", () => {
  it("retains a persistent warning and retries the latest failed transaction", async () => {
    const set = storage.setItem;
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(saveSlot(1, { ...emptyProgress(), bolts: 17 })).toBe(false);
    expect(saveSlot(1, { ...emptyProgress(), bolts: 23 })).toBe(false);
    expect(getSaveIssues()).toHaveLength(1);
    storage.setItem = set;
    await retryFailedSaves();
    expect(loadSlot(1).progress.bolts).toBe(23);
    expect(getSaveIssues()).toEqual([]);
  });

  it("rejects silent dropped writes without deleting migration sources", () => {
    storage.setItem("old", "valuable");
    storage.setItem = () => {};
    expect(migrateStorageKey(storage, "old", "new")).toBe(false);
    expect(storage.getItem("old")).toBe("valuable");
  });

  it("shows corrupt slots as occupied and refuses automatic overwrite", () => {
    storage.setItem(slotKey(2), "{broken");
    expect(listSlots()[1]).toMatchObject({ exists: true, health: "corrupt" });
    expect(() => loadSlot(2)).toThrow();
    expect(saveSlot(2, emptyProgress())).toBe(false);
    expect(storage.getItem(slotKey(2))).toBe("{broken");
    expect(exportSlot(2).text).toBe("{broken");
  });

  it("restores the last good backup and archives the damaged bytes", () => {
    saveSlot(1, { ...emptyProgress(), bolts: 7 });
    saveSlot(1, { ...emptyProgress(), bolts: 8 });
    storage.setItem(slotKey(1), "{broken");
    expect(listSlots()[0].recoverable).toBe(true);
    expect(recoverSlot(1)).toBe(true);
    expect(loadSlot(1).progress.bolts).toBe(7);
    expect(
      [...Array(storage.length)]
        .map((_, i) => storage.key(i))
        .some((key) => key?.includes(":recovered:") && storage.getItem(key) === "{broken"),
    ).toBe(true);
  });

  it("exports the chosen slot and requires a deliberate occupied destination", () => {
    saveSlot(2, { ...emptyProgress(), bolts: 44 }, "My mission");
    saveSlot(3, { ...emptyProgress(), bolts: 99 });
    const exported = exportSlot(2);
    expect(exported.filename).toContain("slot-2-My-mission");
    expect(() => importSlot(3, exported.text)).toThrow("Destination occupied");
    expect(loadSlot(3).progress.bolts).toBe(99);
    expect(importSlot(1, exported.text)).toBe(true);
    expect(loadSlot(1).progress.bolts).toBe(44);
    expect(importSlot(3, exported.text, true)).toBe(true);
  });

  it.each([
    { version: 99, starsByLevel: {} },
    { version: 5, starsByLevel: null },
    { version: 5, starsByLevel: {}, robotXp: { leela: -4 } },
    { version: 5, starsByLevel: {}, bolts: "44" },
    { version: 5, starsByLevel: {}, robotSkills: { leela: [] } },
  ])("rejects invalid imported schema %j", (progress) => {
    expect(() =>
      parseSaveImport(
        JSON.stringify({ format: "mesozoic-protocol-save", version: 1, slot: { progress } }),
      ),
    ).toThrow();
  });

  it("migrates both old prefix and old progress schema without overriding new keys", () => {
    storage.setItem(
      "extinction-protocol:slot:2:v1",
      JSON.stringify({
        progress: {
          version: 2,
          starsByLevel: { 1: { normal: 3, heroic: 1, iron: 1 } },
          heroXp: { george: 12 },
        },
      }),
    );
    expect(loadSlot(2).progress.robotXp.george).toBe(12);
    expect(loadSlot(2).progress.starsByLevel[1]).toEqual({ normal: 3, breach: 1, containment: 1 });
    expect(storage.getItem("extinction-protocol:slot:2:v1")).toBeNull();
    storage.setItem("extinction-protocol:slot:2:v1", "old");
    expect(loadSlot(2).progress.robotXp.george).toBe(12);
    expect(storage.getItem("extinction-protocol:slot:2:v1")).toBe("old");
    expect(deleteSlot(2)).toBe(true);
    expect(listSlots()[1].health).toBe("empty");
  });

  it("preserves and surfaces unreadable legacy data", () => {
    storage.setItem("extinction-protocol:progress:v1", "broken");
    expect(listSlots()[0]).toMatchObject({ health: "corrupt", exists: true });
    expect(storage.getItem("mesozoic-protocol:progress:v1")).toBe("broken");
  });

  it("never presents a failed legacy migration as an empty writable slot", async () => {
    storage.setItem(
      "mesozoic-protocol:progress:v1",
      JSON.stringify({ version: 2, starsByLevel: {}, bolts: 83 }),
    );
    const set = storage.setItem;
    storage.setItem = () => {
      throw new Error("quota");
    };
    expect(listSlots()[0]).toMatchObject({ exists: true, health: "unavailable" });
    expect(() => loadSlot(1)).toThrow();
    expect(saveSlot(1, emptyProgress())).toBe(false);
    storage.setItem = set;
    await retryFailedSaves();
    expect(loadSlot(1).progress.bolts).toBe(83);
  });
});

describe("mission transactions", () => {
  it("restores economy, targeting, upgrades, drones, robot state and paused combat", () => {
    const world = createWorld(getLevel(1));
    const tower = createTower(world, "mortar", { x: 2, y: 3 });
    const hive = createTower(world, "hive", { x: 5, y: 3 });
    tower.upgrades = { a: 2, b: 1 };
    tower.targetingMode = "spot";
    tower.targetSpot = { x: 4, y: 5 };
    hive.droneAssignments[0] = tower.id;
    world.gold = 123;
    world.lives = 13;
    world.wave = 4;
    world.robot.xp = 300;
    world.robot.abilityReadyAt = [11, 12, 13, 14];
    world.adaptation.perWave.set(4, { kinetic: 10, electric: 20, cold: 0, explosive: 0, flame: 0 });
    const checkpoint = captureCheckpoint(world, "hard", "medium")!;
    const restored = restoreCheckpoint(checkpoint);
    expect(restored).toMatchObject({ gold: 123, lives: 13, wave: 4, status: "paused" });
    expect(restored.towers).toEqual(world.towers);
    expect(restored.towerById.get(tower.id)).toBe(restored.towers[0]);
    expect(restored.robot.abilityReadyAt).toEqual([11, 12, 13, 14]);
    expect(restored.adaptation.perWave.get(4)).toEqual(world.adaptation.perWave.get(4));
  });

  it("rejects damaged nested simulation fields before importing a checkpoint", () => {
    const world = createWorld(getLevel(1));
    const checkpoint = captureCheckpoint(world, "medium", "medium")!;
    const raw = JSON.parse(checkpoint.world);
    delete raw.robot.moveTarget;
    checkpoint.world = JSON.stringify(raw);
    expect(() => restoreCheckpoint(checkpoint)).toThrow();
    expect(() =>
      parseSaveImport(
        JSON.stringify({
          format: "mesozoic-protocol-save",
          version: 1,
          slot: { progress: emptyProgress(), checkpoint },
        }),
      ),
    ).toThrow();
  });

  it("replays rewards from the same durable boundary without duplication", () => {
    const world = createWorld(getLevel(1));
    const initial = { ...emptyProgress(), bolts: 12, robotXp: { leela: 20 } };
    beginMission(1, world, initial);
    const earned = {
      ...initial,
      bolts: 19,
      robotXp: { leela: 30 },
      stats: { killsTotal: 2, winsTotal: 0 },
      unlocked: { first_blood: 1 },
    };
    world.waveActive = true;
    expect(checkpointMission(world, earned, "medium", true)).toBe(false);
    expect(loadSlot(1).progress.bolts).toBe(12);
    const reload = loadSlot(1);
    const resumed = restoreCheckpoint(reload.checkpoint!);
    beginMission(1, resumed, reload.progress, reload.checkpoint!);
    resumed.wave = 1;
    expect(checkpointMission(resumed, earned, "medium", true)).toBe(true);
    expect(loadSlot(1).progress).toMatchObject({
      bolts: 19,
      robotXp: { leela: 30 },
      unlocked: { first_blood: 1 },
    });
    expect(finishMission(resumed, earned)).toBe(true);
    expect(loadSlot(1).checkpoint).toBeNull();
    storage.setItem(slotKey(1), "broken");
    expect(recoverSlot(1)).toBe(true);
    expect(loadSlot(1).checkpoint).toBeNull();
  });

  it("training cannot replace a real checkpoint, and deletion cannot revive it", () => {
    const world = createWorld(getLevel(1));
    beginMission(1, world, emptyProgress());
    const before = storage.getItem(slotKey(1));
    const training = createWorld(getLevel(1));
    excludeWorldFromPersistence(training);
    beginMission(1, training, { ...emptyProgress(), bolts: 999 });
    expect(checkpointMission(training, emptyProgress(), "medium", true)).toBe(false);
    expect(storage.getItem(slotKey(1))).toBe(before);
    expect(deleteSlot(1)).toBe(true);
    expect(checkpointMission(world, emptyProgress(), "medium", true)).toBe(false);
    expect(finishMission(world, emptyProgress())).toBe(true);
    expect(storage.getItem(backupKey(1))).toBeNull();
    expect(loadSlot(1).checkpoint).toBeNull();
  });

  it("failed terminal writes keep rewards and old checkpoint in one transaction", () => {
    const world = createWorld(getLevel(1));
    beginMission(1, world, emptyProgress());
    const set = storage.setItem;
    storage.setItem = (key, value) => {
      if (key === slotKey(1)) throw new Error("quota");
      set(key, value);
    };
    expect(finishMission(world, { ...emptyProgress(), bolts: 90 })).toBe(false);
    expect(loadSlot(1).progress.bolts).toBe(0);
    expect(loadSlot(1).checkpoint).not.toBeNull();
  });
});
