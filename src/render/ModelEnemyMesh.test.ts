import * as THREE from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Enemy, World } from "../sim/types";
import { EnemyRenderPartition } from "./enemyRenderPartition";

// Drive the real mesh callback with a synthetic GLTF and an imperative host.
// No DOM/WebGL needed; Three's transforms, mixers, clones and cleanup are real.
const harness = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  cleanups: [] as (() => void)[],
  callbacks: [] as ((state: unknown, delta: number) => void)[],
  partition: null as EnemyRenderPartition | null,
  asset: null as { scene: THREE.Group; animations: THREE.AnimationClip[] } | null,
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useRef: (current: unknown) => {
    const ref = { current };
    harness.refs.push(ref);
    return ref;
  },
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => () => void) => harness.cleanups.push(fn()),
  useLayoutEffect: (fn: () => () => void) => harness.cleanups.push(fn()),
}));
vi.mock("@react-three/fiber", () => ({
  useFrame: (fn: (state: unknown, delta: number) => void) => harness.callbacks.push(fn),
}));
vi.mock("@react-three/drei", () => ({
  useGLTF: Object.assign(() => harness.asset, { preload: () => {} }),
}));
vi.mock("./EnemyRenderPartitionProvider", () => ({
  useEnemyRenderPartition: () => harness.partition,
}));
vi.mock("./PaintedPostFx", () => ({ OUTLINE_LAYER: 1 }));
vi.mock("../audio/AudioManager", () => ({ audio: { playFootstep: vi.fn() } }));
vi.mock("../editor/editorStore", () => ({ useEditor: { getState: () => ({ active: false }) } }));
vi.mock("../store", () => ({ useGame: { getState: () => ({ world: harness.partition!.world }) } }));

import { clearAllEnemyRender, getEnemyRender } from "./enemyRenderRegistry";
import { ModelEnemyMesh } from "./ModelEnemyMesh";

const enemy = (id: number): Enemy =>
  ({
    id,
    kind: "swarm",
    alive: true,
    maxHp: 10,
    pos: { x: 1, y: 0 },
    pathIndex: 0,
    segment: 0,
    segmentT: 0,
    engagedRobotId: null,
    slowUntil: 0,
  }) as Enemy;
const world = (enemies: Enemy[]): World =>
  ({
    enemies,
    status: "running",
    time: 0,
    paths: [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    ],
  }) as World;
const mount = () => {
  ModelEnemyMesh({ kind: "swarm", url: "test.glb", targetSize: 1 });
  const host = new THREE.Group();
  harness.refs[0].current = host;
  return host;
};
const render = (w: World) => {
  harness.partition!.refresh(w);
  for (const fn of harness.callbacks) fn({}, 0.1);
};
beforeEach(() => {
  harness.refs = [];
  harness.cleanups = [];
  harness.callbacks = [];
  harness.partition = new EnemyRenderPartition();
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  harness.asset = {
    scene,
    animations: [new THREE.AnimationClip("Run", 1, []), new THREE.AnimationClip("Death", 0.5, [])],
  };
});
afterEach(() => {
  for (const cleanup of harness.cleanups.reverse()) cleanup();
  harness.asset!.scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  });
  clearAllEnemyRender();
  vi.restoreAllMocks();
});

it("keeps animation cadence, strips corpse metadata, pauses death and reuses pooled clones", () => {
  const updates = vi.spyOn(THREE.AnimationMixer.prototype, "update");
  const host = mount();
  const e = enemy(1);
  const w = world([e]);
  render(w);
  const body = host.children[0];
  const proxy = host.children[1];
  expect(body.userData.enemyId).toBe(1);
  expect(getEnemyRender(1)).toBeDefined();
  render(w); // same simulation time, still one animation update per render frame
  expect(updates).toHaveBeenCalledTimes(2);
  e.alive = false;
  render(w);
  expect(body.userData.enemyId).toBeUndefined();
  expect(body.children[0].userData.enemyId).toBeUndefined();
  expect(body.userData.deadEnemyClickBlocker).toBe(true);
  expect(proxy.visible).toBe(false);
  expect(getEnemyRender(1)).toBeUndefined();
  w.status = "paused";
  const pose = body.position.clone();
  render(w);
  expect(updates).toHaveBeenCalledTimes(2);
  expect(body.position).toEqual(pose);
  w.status = "running";
  w.time = 0.6;
  render(w);
  expect(body.visible).toBe(false);
  w.enemies = [enemy(2)];
  render(w);
  expect(host.children[0]).toBe(body);
  expect(body.visible).toBe(true);
  expect(body.userData.enemyId).toBe(2);
  expect(body.children[0].userData.enemyId).toBe(2);
  expect(body.userData.deadEnemyClickBlocker).toBeUndefined();
  expect(proxy.userData.enemyId).toBe(2);
});

it("clears mid-death items on world replacement with reused IDs, and skips death for leaks", () => {
  const host = mount();
  const w = world([enemy(1)]);
  render(w);
  const body = host.children[0];
  w.enemies.length = 0; // removal even while the old enemy object remains alive
  render(w);
  expect(body.userData.deadEnemyClickBlocker).toBe(true);
  const retry = world([enemy(1)]);
  retry.enemies[0].pos.x = 8;
  render(retry);
  expect(host.children[0]).toBe(body);
  expect(body.position.x).toBe(8);
  expect(body.userData.enemyId).toBe(1);
  expect(body.userData.deadEnemyClickBlocker).toBeUndefined();
  retry.enemies[0].leak = { startedAt: 0, impactAt: 1 } as Enemy["leak"];
  render(retry);
  retry.enemies.length = 0;
  render(retry);
  expect(body.visible).toBe(false);
  expect(getEnemyRender(1)).toBeUndefined();
  for (const cleanup of harness.cleanups.reverse()) cleanup();
  harness.cleanups = [];
  expect(host.children).toHaveLength(0);
});
