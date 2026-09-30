import type { BossVariant, Enemy, EnemyKind, World } from "../sim/types";

const bucket = () => ({ enemies: [] as Enemy[] });
type Bucket = ReturnType<typeof bucket>;

/** Scene-owned scratch storage. Refresh unconditionally once per render frame. */
export class EnemyRenderPartition {
  world: World | null = null;
  frame = 0;
  private readonly kinds: Record<EnemyKind, Bucket> = {
    raptor: bucket(),
    allosaur: bucket(),
    stego: bucket(),
    swarm: bucket(),
    armored: bucket(),
    para: bucket(),
    titan: bucket(),
    boss: bucket(),
  };
  private readonly variants: Record<BossVariant, Bucket> = {
    raptor: bucket(),
    stego: bucket(),
    para: bucket(),
    allosaur: bucket(),
    armored: bucket(),
    apex: bucket(),
  };
  private readonly buckets = [...Object.values(this.kinds), ...Object.values(this.variants)];

  refresh(world: World): void {
    this.world = world;
    this.frame++;
    for (const group of this.buckets) {
      group.enemies.length = 0;
    }
    // Preserve world order and object identity. Never sort or mutate simulation data.
    for (const enemy of world.enemies) {
      if (!enemy.alive) continue;
      const group = this.kinds[enemy.kind];
      group.enemies.push(enemy);
      if (enemy.kind === "boss" && enemy.bossVariant !== undefined) {
        const variant = this.variants[enemy.bossVariant];
        variant.enemies.push(enemy);
      }
    }
  }

  get(kind: EnemyKind, bossVariant?: BossVariant): Bucket {
    return kind === "boss" && bossVariant !== undefined
      ? this.variants[bossVariant]
      : this.kinds[kind];
  }
}
