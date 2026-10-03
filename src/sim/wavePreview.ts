import { availableDamageTypes } from "./immunityCoverage";
import { getWave } from "./spawner";
import type { BossVariant, DamageType, EnemyKind, EnemySpec, World } from "./types";
import {
  ADAPT_TRIGGER_LEVEL,
  ADAPTIVE_RESISTANCE_ENABLED,
  BOSS_VARIANT_BARRAGE,
  BOSS_VARIANT_CHILD,
  BOSS_VARIANT_RESIST,
  BOSS_VARIANT_STATS,
  ENEMY_RESIST,
  ENEMY_STATS,
  SHIELD_BY_KIND,
} from "./world";

export const PREVIEW_DAMAGE_TYPES: DamageType[] = [
  "kinetic",
  "electric",
  "cold",
  "explosive",
  "flame",
];
export type PreviewGroup = {
  key: string;
  kind: EnemyKind;
  bossVariant?: BossVariant;
  count: number;
  hp: number;
  shield: number;
  healAura: boolean;
  regen: boolean;
  resists: Record<DamageType, number>;
  counters: DamageType[];
  reinforcements: boolean;
};
export type PreviewLane = {
  index: number;
  groups: PreviewGroup[];
  count: number;
  streams: { kinds: EnemyKind[]; minInterval: number; maxInterval: number; shielded: boolean }[];
};
export type IncomingWave = {
  number: number;
  count: number;
  boss: boolean;
  adaptivePossible: boolean;
  lanes: PreviewLane[];
};

// This is an inspection of the exact resolved spawner input. Do not roll RNG,
// spawn entities, mark encounters, or read story/briefing content here.
export function previewNextWave(world: World): IncomingWave | null {
  const number = world.wave + 1;
  const spec = getWave(world, number);
  if (!spec || world.paths.length === 0) return null;
  const lanes = new Map<number, PreviewLane>();
  const laneFor = (requested = 0) => {
    const index = world.paths[requested] ? requested : 0;
    let lane = lanes.get(index);
    if (!lane) {
      lane = { index, groups: [], count: 0, streams: [] };
      lanes.set(index, lane);
    }
    return lane;
  };
  const available = availableDamageTypes(world.forbiddenTowers, world.lockedLoadout);
  for (const spawn of spec.spawns) {
    // Match rosterFromSpec's integer loop even for a malformed fractional count.
    const count = Math.max(0, Math.ceil(spawn.count));
    if (!count || !Number.isFinite(count)) continue;
    const lane = laneFor(spawn.pathIndex);
    const variant = spawn.kind === "boss" ? (spawn.bossVariant ?? "apex") : undefined;
    const baseResist = variant ? BOSS_VARIANT_RESIST[variant] : ENEMY_RESIST[spawn.kind];
    const resists = Object.fromEntries(
      PREVIEW_DAMAGE_TYPES.map((type) => [type, baseResist[type] * (spawn.resists?.[type] ?? 1)]),
    ) as Record<DamageType, number>;
    const best = Math.max(0, ...available.map((type) => resists[type]));
    const counters = best > 0 ? available.filter((type) => resists[type] === best) : [];
    const hp = Math.ceil(
      (variant ? BOSS_VARIANT_STATS[variant].hp : ENEMY_STATS[spawn.kind].hp) * (spec.hpMul ?? 1),
    );
    const shield = spawn.shielded ? SHIELD_BY_KIND[spawn.kind] : 0;
    const key = groupKey(spawn, resists);
    const existing = lane.groups.find((group) => group.key === key);
    if (existing) existing.count += count;
    else
      lane.groups.push({
        key,
        kind: spawn.kind,
        bossVariant: variant,
        count,
        hp,
        shield,
        healAura: !!spawn.healAura,
        regen: !!spawn.regen,
        resists,
        counters,
        reinforcements:
          !!variant && (!!BOSS_VARIANT_CHILD[variant] || !!BOSS_VARIANT_BARRAGE[variant]),
      });
    lane.count += count;
  }
  for (const stream of spec.bossTrickle ?? []) {
    laneFor(stream.pathIndex).streams.push({
      kinds: [...stream.kinds],
      minInterval: stream.minInterval * world.bossTrickleIntervalMul,
      maxInterval: stream.maxInterval * world.bossTrickleIntervalMul,
      shielded: !!stream.shielded,
    });
  }
  const list = [...lanes.values()].sort((a, b) => a.index - b.index);
  return {
    number,
    count: list.reduce((sum, lane) => sum + lane.count, 0),
    boss:
      !!spec.bossWave || list.some((lane) => lane.groups.some((group) => group.kind === "boss")),
    adaptivePossible:
      ADAPTIVE_RESISTANCE_ENABLED && !world.endless && world.levelId >= ADAPT_TRIGGER_LEVEL,
    lanes: list,
  };
}

const groupKey = (spawn: EnemySpec, resists: Record<DamageType, number>) =>
  JSON.stringify([
    spawn.kind,
    spawn.kind === "boss" ? (spawn.bossVariant ?? "apex") : null,
    !!spawn.shielded,
    !!spawn.healAura,
    !!spawn.regen,
    PREVIEW_DAMAGE_TYPES.map((type) => resists[type]),
  ]);
