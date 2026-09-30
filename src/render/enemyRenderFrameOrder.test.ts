import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { Enemy, World } from "../sim/types";

const frame = vi.hoisted(() => ({
  callbacks: [] as { callback: () => void; priority: number }[],
  world: null as World | null,
  tick: vi.fn(),
}));
vi.mock("@react-three/fiber", () => ({
  useFrame: (callback: () => void, priority = 0) => frame.callbacks.push({ callback, priority }),
}));
vi.mock("../store", () => ({
  useGame: { getState: () => ({ world: frame.world, tick: frame.tick }) },
}));

import { useFrame } from "@react-three/fiber";
import {
  EnemyRenderPartitionProvider,
  useEnemyRenderPartition,
} from "./EnemyRenderPartitionProvider";
import {
  ENEMY_MODEL_FRAME_PRIORITY,
  ENEMY_PARTITION_FRAME_PRIORITY,
  PLAY_CAMERA_FRAME_PRIORITY,
  PLAY_PAN_CLAMP_FRAME_PRIORITY,
  SIMULATION_FRAME_PRIORITY,
} from "./playFrameOrder";
import { SimTicker } from "./SimTicker";

beforeEach(() => {
  frame.callbacks = [];
  frame.world = { enemies: [], time: 0 } as unknown as World;
  frame.tick.mockReset();
});

it("runs simulation then fresh partition then consumers regardless of subscription order", () => {
  const seen: Enemy[][] = [];
  const Consumer = () => {
    const partition = useEnemyRenderPartition();
    useFrame(() => {
      seen.push([...partition.get("swarm").enemies]);
    }, ENEMY_MODEL_FRAME_PRIORITY);
    return null;
  };
  // Deliberately put ticker after consumer: JSX/effect order must not determine freshness.
  renderToString(
    createElement(
      EnemyRenderPartitionProvider,
      null,
      createElement(Consumer),
      createElement(SimTicker),
    ),
  );
  const runFrame = () => {
    for (const subscriber of [...frame.callbacks]
      .reverse()
      .sort((a, b) => a.priority - b.priority)) {
      subscriber.callback();
    }
  };
  const spawned = { id: 1, kind: "swarm", alive: true } as Enemy;
  frame.tick.mockImplementationOnce(() => {
    frame.world!.enemies.push(spawned);
  });
  runFrame();
  expect(seen[0]).toEqual([spawned]);
  spawned.alive = false; // no world-time advance: still refresh on next render frame
  runFrame();
  expect(seen[1]).toEqual([]);
  frame.tick.mockImplementationOnce(() => {
    frame.world = { enemies: [{ ...spawned, alive: true }], time: 0 } as World;
  });
  runFrame();
  expect(seen[2][0]).toBe(frame.world!.enemies[0]);
  expect(frame.tick).toHaveBeenCalledTimes(3);
  expect(frame.callbacks.map((s) => s.priority).sort((a, b) => a - b)).toEqual([
    SIMULATION_FRAME_PRIORITY,
    ENEMY_PARTITION_FRAME_PRIORITY,
    ENEMY_MODEL_FRAME_PRIORITY,
  ]);
  expect(ENEMY_MODEL_FRAME_PRIORITY).toBeGreaterThan(ENEMY_PARTITION_FRAME_PRIORITY);
  expect(ENEMY_MODEL_FRAME_PRIORITY).toBeLessThan(0); // decoration/registry readers
  expect(PLAY_PAN_CLAMP_FRAME_PRIORITY).toBeGreaterThan(-1); // Drei OrbitControls
  expect(PLAY_CAMERA_FRAME_PRIORITY).toBeGreaterThan(PLAY_PAN_CLAMP_FRAME_PRIORITY);
  expect(SIMULATION_FRAME_PRIORITY).toBeGreaterThan(PLAY_CAMERA_FRAME_PRIORITY);
});
