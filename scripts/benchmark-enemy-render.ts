// Run: node --import tsx scripts/benchmark-enemy-render.ts
// CPU microbenchmark only: dispatch + live-ID lookup, not animation/GPU/FPS.
import { performance } from "node:perf_hooks";
import { EnemyRenderPartition } from "../src/render/enemyRenderPartition";
import type { BossVariant, Enemy, EnemyKind, World } from "../src/sim/types";

const kinds: EnemyKind[] = ["raptor", "swarm", "para", "allosaur", "stego", "armored", "titan"];
const variants: BossVariant[] = ["apex", "raptor", "stego", "para", "allosaur", "armored"];
const hosts = [
  ...kinds.map((kind) => ({ kind, variant: undefined as BossVariant | undefined })),
  ...variants.map((variant) => ({ kind: "boss" as EnemyKind, variant })),
];
let sink = 0;
for (const scenario of ["mixed", "swarm"] as const) {
  for (const count of [100, 500, 2000]) {
    const enemies = Array.from({ length: count }, (_, id) => {
      const host =
        scenario === "mixed"
          ? hosts[id % hosts.length]
          : hosts[id === 0 ? 7 : id % 10 === 0 ? 0 : 1];
      return { id, kind: host.kind, bossVariant: host.variant, alive: id % 17 !== 0 } as Enemy;
    });
    const world = { enemies } as World;
    const ownedIds = hosts.map((host) =>
      enemies
        .filter(
          (e) =>
            e.kind === host.kind && (host.variant === undefined || e.bossVariant === host.variant),
        )
        .map((e) => e.id),
    );
    const partition = new EnemyRenderPartition();
    const items = ownedIds.map((ids) => new Map(ids.map((id) => [id, { lastLiveFrame: 0 }])));
    const legacy = () => {
      let result = 0;
      hosts.forEach((host, i) => {
        const live = new Set<number>();
        for (const e of world.enemies) {
          if (e.kind !== host.kind) continue;
          if (host.variant !== undefined && e.bossVariant !== host.variant) continue;
          if (!e.alive) continue;
          live.add(e.id);
          // Both paths look up the existing mesh item before animating it.
          if (!items[i].has(e.id)) throw new Error("Missing item");
          result += e.id;
        }
        for (const id of ownedIds[i]) result += Number(live.has(id));
      });
      return result;
    };
    const shared = () => {
      partition.refresh(world);
      let result = 0;
      hosts.forEach((host, i) => {
        const bucket = partition.get(host.kind, host.variant);
        for (const e of bucket.enemies) {
          items[i].get(e.id)!.lastLiveFrame = partition.frame;
          result += e.id;
        }
        for (const item of items[i].values())
          result += Number(item.lastLiveFrame === partition.frame);
      });
      return result;
    };
    if (legacy() !== shared()) throw new Error("Dispatch mismatch");
    for (let i = 0; i < 2000; i++) {
      sink += legacy();
      sink += shared();
    }
    const samples: number[][] = [[], []];
    const runs = 2000;
    for (let sample = 0; sample < 9; sample++) {
      // Alternate measurement order to reduce warmup/thermal bias.
      for (const index of sample % 2 ? [1, 0] : [0, 1]) {
        const fn = index === 0 ? legacy : shared;
        const start = performance.now();
        for (let i = 0; i < runs; i++) sink += fn();
        samples[index].push(((performance.now() - start) * 1000) / runs);
      }
    }
    const medians = samples.map((values) => values.sort((a, b) => a - b)[4]);
    console.log(
      `${scenario}, ${count} enemies: legacy ${medians[0].toFixed(2)} µs/frame, shared ${medians[1].toFixed(2)} µs/frame, ${(medians[0] / medians[1]).toFixed(2)}x`,
    );
  }
}
console.log(`checksum ${sink}`);
