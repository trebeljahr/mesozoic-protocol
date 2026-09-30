import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLevel } from "../levels";
import type { World } from "../sim/types";
import { createWorld } from "../sim/world";

// Exercise the components' actual selectors and memo dependencies without GLTF
// loading or a GPU. Each render uses React's Object.is dependency comparison.
const harness = vi.hoisted(() => ({
  state: null as unknown as { world: World; ui: { towerVersion: number; treeVersion: number } },
  cursor: 0,
  memos: [] as { deps: unknown[]; value: unknown }[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useMemo: (compute: () => unknown, deps: unknown[]) => {
    const index = harness.cursor++;
    const old = harness.memos[index];
    if (old && deps.length === old.deps.length && deps.every((d, i) => Object.is(d, old.deps[i])))
      return old.value;
    const value = compute();
    harness.memos[index] = { deps, value };
    return value;
  },
}));
vi.mock("../store", () => ({
  useGame: Object.assign(
    (selector: (s: typeof harness.state) => unknown) => selector(harness.state),
    { getState: () => harness.state },
  ),
}));
vi.mock("@react-three/drei", () => ({ useGLTF: Object.assign(() => ({}), { preload: () => {} }) }));
vi.mock("./TerrainSurface", () => ({ TerrainSurface: () => null }));
vi.mock("./InstancedGroup", () => ({ InstancedGroup: () => null }));
vi.mock("./groundPlacement", async (original) => {
  const actual = await original<typeof import("./groundPlacement")>();
  return { ...actual, prepareGroundPlacement: vi.fn(actual.prepareGroundPlacement) };
});
vi.mock("./outerSceneryPlacement", async (original) => {
  const actual = await original<typeof import("./outerSceneryPlacement")>();
  return { ...actual, prepareOuterPlacement: vi.fn(actual.prepareOuterPlacement) };
});

import { Ground } from "./Ground";
import { prepareGroundPlacement } from "./groundPlacement";
import { OuterScenery } from "./OuterScenery";
import { prepareOuterPlacement } from "./outerSceneryPlacement";

beforeEach(() => {
  harness.state = { world: createWorld(getLevel(1)), ui: { towerVersion: 0, treeVersion: 0 } };
  harness.memos = [];
  vi.clearAllMocks();
});

describe.each([
  ["ground", Ground, prepareGroundPlacement],
  ["outer", OuterScenery, prepareOuterPlacement],
] as const)("%s placement invalidation", (_name, Component, prepare) => {
  it("reuses static candidates across clears, tower place/sell and prop edits; invalidates static inputs", () => {
    const render = () => {
      harness.cursor = 0;
      return Component();
    };
    render();
    const initial = harness.memos[0].value;
    const w = harness.state.world;
    for (let i = 0; i < 3; i++) {
      w.trees = w.trees.slice(1);
      w.rocks = w.rocks.slice(1);
      harness.state.ui.treeVersion++;
      render();
    }
    // Towers mutate in place. Their version, and editor prop versions, must
    // still reach the existing render-time cull without rebuilding candidates.
    w.towers.push({ pos: { x: 0, y: 0 } } as World["towers"][number]);
    harness.state.ui.towerVersion++;
    render();
    w.towers.pop();
    harness.state.ui.towerVersion++;
    render();
    w.props = [...w.props];
    harness.state.ui.treeVersion++;
    render();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(harness.memos[0].value).toBe(initial);
    w.outposts = w.outposts.slice(1);
    render();
    expect(prepare).toHaveBeenCalledTimes(1);
    w.proceduralSeed++;
    render();
    expect(prepare).toHaveBeenCalledTimes(2);
    w.paths = w.paths.map((p) => p.map((v) => ({ x: v.x + 0.1, y: v.y })));
    render();
    expect(prepare).toHaveBeenCalledTimes(3);
    w.overrideActive = true;
    render();
    expect(harness.memos[0].value).toBeNull();
    w.overrideActive = false;
    render();
    expect(prepare).toHaveBeenCalledTimes(4);
    harness.state.world = createWorld(getLevel(7));
    render();
    expect(prepare).toHaveBeenCalledTimes(5);
    harness.state.world = createWorld(getLevel(1));
    render();
    expect(prepare).toHaveBeenCalledTimes(6);
  });
});

it("still culls and restores ground placements on tower and editor prop versions", () => {
  type Layers = { buckets: { placements: { x: number; y: number }[] }[] }[];
  const render = () => {
    harness.cursor = 0;
    Ground();
    return harness.memos[2].value as Layers;
  };
  const count = (layers: Layers) =>
    layers.reduce((n, l) => n + l.buckets.reduce((m, b) => m + b.placements.length, 0), 0);
  const initial = render();
  const point = initial.flatMap((l) => l.buckets).flatMap((b) => b.placements)[0];
  expect(point).toBeDefined();
  const w = harness.state.world;
  w.towers.push({ pos: point } as World["towers"][number]);
  harness.state.ui.towerVersion++;
  expect(count(render())).toBeLessThan(count(initial));
  w.towers.pop();
  harness.state.ui.towerVersion++;
  expect(render()).toBe(initial);
  w.props.push({ pos: point, url: "/natural/Grass.glb", scale: 1 } as World["props"][number]);
  harness.state.ui.treeVersion++;
  expect(count(render())).toBeLessThan(count(initial));
  w.props.pop();
  harness.state.ui.treeVersion++;
  expect(render()).toBe(initial);
  expect(prepareGroundPlacement).toHaveBeenCalledTimes(1);
});
