import type { DamageType, EnemySpec, TowerKind, WaveSpec } from "./types";
import { ENEMY_RESIST, TOWER_DAMAGE_TYPE } from "./world";

const ALL_TOWER_KINDS: TowerKind[] = ["pulse", "chain", "cryo", "mortar", "flame", "hive"];

// Damage types the player can reach this level given the mode's roster
// restrictions. Forbidden tower kinds drop their damage type only if no
// other usable tower kind covers it (e.g. forbidding pulse alone still
// leaves kinetic on the table via hive drones).
export const availableDamageTypes = (
  forbidden: ReadonlySet<TowerKind>,
  locked: readonly TowerKind[] | null,
): DamageType[] => {
  const usable = (locked ?? ALL_TOWER_KINDS).filter((k) => !forbidden.has(k));
  const types = new Set<DamageType>();
  for (const k of usable) types.add(TOWER_DAMAGE_TYPE[k]);
  return Array.from(types);
};

// Diversification checks enter after the opening two levels. Levels 3–5
// introduce partial resistance; level 6 onward can include full immunity.
// Preserve explicitly authored resist chips at every level.
export const ensureImmunityCoverage = (
  waves: WaveSpec[],
  damageTypes: DamageType[],
  levelId: number,
): WaveSpec[] => {
  if (levelId < 3) return waves;
  const resistMultiplier = levelId < 6 ? 0.5 : 0;
  if (waves.length === 0 || damageTypes.length === 0) return waves;

  const covered = new Set<DamageType>();
  for (const w of waves) {
    for (const s of w.spawns) {
      if (!s.resists) continue;
      for (const t of damageTypes) {
        if ((s.resists[t] ?? 1) <= resistMultiplier) covered.add(t);
      }
    }
  }
  const missing = damageTypes.filter((t) => !covered.has(t));
  if (missing.length === 0) return waves;

  const out: WaveSpec[] = waves.map((w) => ({
    ...w,
    spawns: w.spawns.map((s) => ({
      ...s,
      ...(s.resists ? { resists: { ...s.resists } } : {}),
    })),
  }));

  const nonBossWaveIdx: number[] = [];
  for (let i = 0; i < out.length; i++) {
    if (!out[i].bossWave) nonBossWaveIdx.push(i);
  }
  if (nonBossWaveIdx.length === 0) return out;
  const midStart = Math.floor(nonBossWaveIdx.length / 3);
  const lateCandidates = nonBossWaveIdx.slice(midStart);
  const candidates = lateCandidates.length > 0 ? lateCandidates : nonBossWaveIdx;

  const pickCarrierSpawn = (
    waveIdx: number,
    type: DamageType,
  ): { wave: WaveSpec; spawnIdx: number } | null => {
    const wave = out[waveIdx];
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < wave.spawns.length; i++) {
      const s = wave.spawns[i];
      if (s.kind === "boss") continue;
      if (s.count < 1) continue;
      // Existing resistance already meets this level’s coverage threshold.
      if ((s.resists?.[type] ?? 1) <= resistMultiplier) continue;
      const base = ENEMY_RESIST[s.kind][type] ?? 1;
      if (base > bestScore) {
        bestScore = base;
        best = i;
      }
    }
    return best < 0 ? null : { wave, spawnIdx: best };
  };

  missing.forEach((type, n) => {
    let picked: { wave: WaveSpec; spawnIdx: number } | null = null;
    for (let k = 0; k < candidates.length && !picked; k++) {
      const wIdx = candidates[(n + k) % candidates.length];
      picked = pickCarrierSpawn(wIdx, type);
    }
    if (!picked) {
      for (let i = 0; i < out.length && !picked; i++) {
        if (out[i].bossWave) continue;
        picked = pickCarrierSpawn(i, type);
      }
    }
    if (!picked) return;
    const spawn = picked.wave.spawns[picked.spawnIdx];
    if (spawn.count <= 1) {
      spawn.resists = { ...(spawn.resists ?? {}), [type]: resistMultiplier };
    } else {
      spawn.count -= 1;
      const resistant: EnemySpec = {
        ...spawn,
        count: 1,
        resists: { ...(spawn.resists ?? {}), [type]: resistMultiplier },
      };
      picked.wave.spawns.push(resistant);
    }
  });
  return out;
};
