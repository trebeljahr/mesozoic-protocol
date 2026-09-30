import { beforeEach, expect, it, vi } from "vitest";
import { create } from "zustand";
import { getLevel } from "../levels";
import { createWorld } from "../sim/world";

const storage = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

vi.mock("../store", () => ({
  useGame: create((set) => ({
    world: createWorld(getLevel(4)),
    selectedLevelId: 4,
    treeVersion: 0,
    ui: { treeVersion: 0 },
    startLevel: (id: number) => set({ world: createWorld(getLevel(id)), treeVersion: 0 }),
    togglePause: () =>
      set((s: { world: ReturnType<typeof createWorld> }) => ({
        world: { ...s.world, status: "paused" },
      })),
  })),
}));

const { useGame } = await import("../store");
const { resetCurrentLevel, useEditor } = await import("./editorStore");
const { loadLevelEdit, saveLevelEdit } = await import("./levelEdits");
const { loadLevelHistory, saveLevelHistory } = await import("./historyPersist");

beforeEach(() => storage.clear());

it("restores the generated baseline and clears only the current level's edits and history", () => {
  const baseline = createWorld(getLevel(4));
  const edit = {
    v: 1 as const,
    override: true,
    proceduralSeed: 789,
    props: [],
    erasedProcedural: ["0,0"],
    rivers: [],
    lakes: [],
    bridges: [],
    easterEggs: [],
  };
  saveLevelEdit(4, edit);
  saveLevelEdit(5, edit);
  const history = { past: [edit], future: [edit] };
  saveLevelHistory(4, history);
  saveLevelHistory(5, history);
  useGame.setState({ world: createWorld(getLevel(4)) });
  useEditor.setState({
    active: true,
    history,
    selectedId: "old",
    selectedIds: new Set(["old"]),
    strokeOpen: true,
    strokeAnchor: edit,
    placingUrl: "old.glb",
  });

  resetCurrentLevel();

  const world = useGame.getState().world;
  for (const key of [
    "props",
    "rivers",
    "lakes",
    "autoBridges",
    "authoredEasterEggs",
    "proceduralSeed",
    "overrideActive",
    "erasedProcedural",
    "trees",
    "rocks",
    "outposts",
    "paths",
  ] as const) {
    expect(world[key], key).toEqual(baseline[key]);
  }
  expect(world.status).toBe("paused");
  expect(loadLevelEdit(4)).toBeNull();
  expect(loadLevelHistory(4)).toEqual({ past: [], future: [] });
  expect(loadLevelEdit(5)).toEqual(edit);
  expect(loadLevelHistory(5)).toEqual(history);
  expect(useEditor.getState().selectedIds.size).toBe(0);
  expect(useEditor.getState().strokeAnchor).toBeNull();
  expect(useEditor.getState().placingUrl).toBeNull();
  expect(useEditor.getState().canUndo()).toBe(false);
  expect(useEditor.getState().canRedo()).toBe(false);
  expect(createWorld(getLevel(4)).trees).toEqual(baseline.trees);
});
