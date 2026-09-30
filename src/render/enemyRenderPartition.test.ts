import { describe, expect, it } from "vitest";
import type { BossVariant, Enemy, EnemyKind, World } from "../sim/types";
import { EnemyRenderPartition } from "./enemyRenderPartition";

const kinds: EnemyKind[] = [
  "raptor",
  "allosaur",
  "stego",
  "swarm",
  "armored",
  "para",
  "titan",
  "boss",
];
const variants: BossVariant[] = ["raptor", "stego", "para", "allosaur", "armored", "apex"];
const enemy = (id: number, kind: EnemyKind, bossVariant?: BossVariant): Enemy =>
  ({ id, kind, bossVariant, alive: true, pos: { x: id, y: 0 } }) as Enemy;
const world = (enemies: Enemy[]): World => ({ enemies, time: 0, status: "running" }) as World;

const expectLegacyMatches = (partition: EnemyRenderPartition, w: World) => {
  for (const kind of kinds) {
    for (const variant of kind === "boss" ? [undefined, ...variants] : [undefined]) {
      const expected = w.enemies.filter(
        (e) => e.kind === kind && e.alive && (variant === undefined || e.bossVariant === variant),
      );
      const actual = partition.get(kind, variant);
      expect(actual.enemies).toEqual(expected);
      actual.enemies.forEach((e, i) => {
        expect(e).toBe(expected[i]);
      });
    }
  }
};

describe("enemy render partition", () => {
  it("matches all legacy host filters, preserves order/identity and excludes dead enemies", () => {
    const w = world([
      ...kinds.map((k, i) => enemy(i, k)),
      ...variants.map((v, i) => enemy(i + 20, "boss", v)),
      enemy(50, "swarm"),
    ]);
    w.enemies[1].alive = false;
    const original = [...w.enemies];
    const partition = new EnemyRenderPartition();
    partition.refresh(w);
    expectLegacyMatches(partition, w);
    expect(w.enemies).toEqual(original);
  });

  it("refreshes same-time paused frames, in-place deaths/spawns, and variant changes", () => {
    const w = world([enemy(1, "swarm"), enemy(2, "boss", "apex")]);
    const partition = new EnemyRenderPartition();
    partition.refresh(w);
    const bucket = partition.get("swarm");
    const array = bucket.enemies;
    const firstFrame = partition.frame;
    w.status = "paused";
    w.enemies[0].alive = false;
    w.enemies[1].bossVariant = "raptor";
    partition.refresh(w);
    expectLegacyMatches(partition, w);
    expect(partition.frame).toBeGreaterThan(firstFrame);
    expect(bucket.enemies).toEqual([]); // host must enter its death/recycle path
    w.enemies.splice(0, 1, enemy(3, "swarm")); // same array and length, same time
    partition.refresh(w);
    expectLegacyMatches(partition, w);
    expect(partition.get("swarm")).toBe(bucket);
    expect(bucket.enemies).toBe(array);
    expect(partition.frame).toBe(firstFrame + 2);
    expect(bucket.enemies[0].id).toBe(3);
  });

  it("reads latest state after multiple ticks and clears references on retry/empty waves", () => {
    const partition = new EnemyRenderPartition();
    const w = world([enemy(1, "swarm")]);
    partition.refresh(w);
    w.enemies.push(enemy(2, "raptor"));
    w.enemies[0].alive = false;
    w.enemies = [enemy(3, "boss", "para")];
    partition.refresh(w);
    expectLegacyMatches(partition, w);
    const retry = world([enemy(1, "swarm")]);
    partition.refresh(retry);
    expect(partition.world).toBe(retry);
    expect(partition.get("swarm").enemies[0]).toBe(retry.enemies[0]);
    expectLegacyMatches(partition, retry);
    retry.enemies.length = 0;
    partition.refresh(retry);
    expectLegacyMatches(partition, retry);
  });

  it("keeps separate scene instances independent", () => {
    const a = new EnemyRenderPartition();
    const b = new EnemyRenderPartition();
    a.refresh(world([enemy(1, "swarm")]));
    b.refresh(world([enemy(1, "boss", "apex")]));
    expect(a.get("swarm").enemies[0].id).toBe(1);
    expect(b.get("swarm").enemies.length).toBe(0);
    expect(new EnemyRenderPartition().world).toBeNull();
  });
});
