import { endlessSpeedFactor, generateEndlessWave } from "./endless";
import type { BossVariant, DamageType, EnemyKind, WaveArchetype, WaveSpec, World } from "./types";
import { clamp01 } from "./vec2";
import {
  ADAPT_WINDOW,
  ADAPTIVE_RESISTANCE_ENABLED,
  addShake,
  computeAdaptiveDominant,
  emit,
  emptyAdaptBucket,
  spawnEnemy,
} from "./world";

export type { WaveArchetype };

export const WAVE_ARCHETYPE_LABEL: Record<WaveArchetype, string> = {
  intro: "Intro",
  mixed: "Mixed",
  swarm: "Swarm rush",
  heavy: "Armored push",
  chaos: "Chaos",
  vanguard: "Vanguard",
  echelon: "Echelon",
  trickle: "Trickle",
  convoy: "Convoy",
};

export const WAVE_ARCHETYPE_HINT: Record<WaveArchetype, string> = {
  intro: "",
  mixed: "balanced composition",
  swarm: "favors AoE towers",
  heavy: "favors single-target",
  chaos: "bring everything",
  vanguard: "heavies lead, swarm trails",
  echelon: "tiered escalation in order",
  trickle: "long sparse spacing",
  convoy: "tank flanked by escorts",
};

const ORDERED_ARCHETYPES = new Set<WaveArchetype>(["swarm", "vanguard", "echelon", "convoy"]);

const inferArchetype = (spec: WaveSpec): WaveArchetype => {
  const counts: Partial<Record<EnemyKind, number>> = {};
  let total = 0;
  for (const s of spec.spawns) {
    counts[s.kind] = (counts[s.kind] ?? 0) + s.count;
    total += s.count;
  }
  const distinct = Object.keys(counts).length;
  const hasArmored = (counts.armored ?? 0) > 0;
  const hasStego = (counts.stego ?? 0) > 0;
  const swarmShare = (counts.swarm ?? 0) / Math.max(1, total);

  if (distinct >= 4 || (hasArmored && hasStego)) return "chaos";
  if (hasArmored) return "heavy";
  if (swarmShare >= 0.6 && total >= 15) return "swarm";
  if (distinct >= 2) return "mixed";
  return "intro";
};

// Single indirection the sim uses to fetch the spec for wave `n` (1-based).
// Campaign indexes the finite plannedWaves array (unchanged behavior);
// endless generates the spec on demand so the run can go forever. The rest
// of the loop stays mode-agnostic.
export const getWave = (world: World, n: number): WaveSpec | null => {
  if (world.endless) {
    if (n < 1) return null;
    return generateEndlessWave(n, world.endless.seed, world.endless.hpMul, world.paths.length);
  }
  if (n < 1 || n > world.plannedWaves.length) return null;
  return world.plannedWaves[n - 1];
};

export const getWavePlan = (world: World, wave: number): { archetype: WaveArchetype } | null => {
  const spec = getWave(world, wave);
  if (!spec) return null;
  return { archetype: spec.archetype ?? inferArchetype(spec) };
};

type RosterEntry = {
  kind: EnemyKind;
  pathIndex: number;
  shielded: boolean;
  healAura: boolean;
  regen: boolean;
  resists?: Partial<Record<DamageType, number>>;
  bossVariant?: BossVariant;
};

const rosterFromSpec = (spec: WaveSpec): RosterEntry[] => {
  const out: RosterEntry[] = [];
  for (const s of spec.spawns) {
    const pathIndex = s.pathIndex ?? 0;
    const shielded = s.shielded ?? false;
    const healAura = s.healAura ?? false;
    const regen = s.regen ?? false;
    for (let i = 0; i < s.count; i++) {
      out.push({
        kind: s.kind,
        pathIndex,
        shielded,
        healAura,
        regen,
        resists: s.resists,
        bossVariant: s.bossVariant,
      });
    }
  }
  const archetype = spec.archetype ?? inferArchetype(spec);
  if (ORDERED_ARCHETYPES.has(archetype)) return out;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const WAVE_GAP_SECONDS = 20;
const EARLY_CALL_THRESHOLD = 1 / 2;
const MIDWAVE_PER_ENEMY_SEC = 0.4;
const MIDWAVE_BUFFER_SEC = 1.0;

const remainingEnemies = (world: World) => world.spawnQueue.length + world.enemies.length;

const midwaveThresholdCrossed = (world: World): boolean => {
  if (!world.waveActive) return false;
  if (world.waveTotalEnemies <= 0) return false;
  return remainingEnemies(world) <= world.waveTotalEnemies * EARLY_CALL_THRESHOLD;
};

// Exported for the debug menu's "force wave" action — production gameplay
// only ever enters this through spawnerTick or callWaveEarly, both of
// which respect the regular gating.
export const startWave = (world: World) => {
  world.wave += 1;
  world.waveActive = true;
  world.midwaveTimer = 0;
  world.midwaveTimerMax = 0;
  world.bossTrickleStreams = [];
  // Adaptive resistance — pick the dominant damage type from the
  // trailing window *before* this wave's spawns are queued so
  // spawnEnemy can snapshot the type into each adapted enemy. Also
  // reap stale buckets so the Map doesn't grow unbounded across a
  // full run. See docs/adaptive-resistance.md.
  if (ADAPTIVE_RESISTANCE_ENABLED && !world.endless) {
    const prev = world.adaptation.dominantNext;
    const { type, share } = computeAdaptiveDominant(world);
    // Streak only ticks while a real dominant was found. A wave with
    // zero recorded damage (e.g. pre-trigger or a fresh run) leaves
    // streak at 0 so the boost ramp doesn't start until the player
    // has actually committed to a damage type.
    if (type === null) world.adaptation.dominantStreak = 0;
    else if (type === prev) world.adaptation.dominantStreak += 1;
    else world.adaptation.dominantStreak = 1;
    world.adaptation.dominantNext = type;
    world.adaptation.dominantShare = share;
    if (!world.adaptation.perWave.has(world.wave)) {
      world.adaptation.perWave.set(world.wave, emptyAdaptBucket());
    }
    const keepFrom = Math.max(1, world.wave - ADAPT_WINDOW);
    for (const w of Array.from(world.adaptation.perWave.keys())) {
      if (w < keepFrom) world.adaptation.perWave.delete(w);
    }
  }
  // Endless: bump the spawn-speed multiplier for this wave (read by
  // spawnEnemy for every unit spawned while this wave is current) before
  // fetching the generated spec. Mild + capped so it never runs away.
  if (world.endless) {
    world.speedMul = world.endless.baseSpeedMul * endlessSpeedFactor(world.wave);
  }
  const spec = getWave(world, world.wave);
  if (!spec) {
    world.waveActive = false;
    return;
  }
  const roster = rosterFromSpec(spec);
  world.waveTotalEnemies = roster.length;
  const hpMul = spec.hpMul ?? 1;
  const spacing = spec.spacing ?? Math.max(0.35, 0.75 - world.wave * 0.03);
  for (let i = 0; i < roster.length; i++) {
    const t = world.time + i * spacing;
    const entry = roster[i];
    world.spawnQueue.push({
      kind: entry.kind,
      at: t,
      hpMul,
      pathIndex: entry.pathIndex,
      shielded: entry.shielded,
      healAura: entry.healAura,
      regen: entry.regen,
      resists: entry.resists,
      bossVariant: entry.bossVariant,
    });
  }
  if (spec.bossTrickle) {
    const mul = world.bossTrickleIntervalMul;
    for (const s of spec.bossTrickle) {
      world.bossTrickleStreams.push({
        kinds: s.kinds.slice(),
        pathIndex: s.pathIndex,
        minInterval: s.minInterval * mul,
        maxInterval: s.maxInterval * mul,
        nextAt: world.time + (s.startDelay ?? 0),
        hpMul,
        shielded: s.shielded,
      });
    }
  }
  emit(world, { type: "wave-start", wave: world.wave });
  if (spec.bossWave) {
    emit(world, { type: "boss-wave-start", wave: world.wave });
    // Heavy ground tremor sells the matriarch's arrival before her
    // silhouette is even on screen — sustained decay so the camera
    // judders for ~a second rather than flicking once.
    addShake(world, 0.47, 1.6);
  }
};

const bossesStillActive = (world: World): boolean => {
  for (const e of world.enemies) if (e.kind === "boss") return true;
  for (const q of world.spawnQueue) if (q.kind === "boss") return true;
  return false;
};

const tickBossTrickle = (world: World) => {
  if (world.bossTrickleStreams.length === 0) return;
  const bossesLeft = bossesStillActive(world);
  if (!bossesLeft) {
    world.bossTrickleStreams = [];
    return;
  }
  for (const stream of world.bossTrickleStreams) {
    while (stream.nextAt <= world.time) {
      const kind = stream.kinds[Math.floor(Math.random() * stream.kinds.length)];
      spawnEnemy(world, kind, {
        hpMul: stream.hpMul,
        pathIndex: stream.pathIndex,
        shielded: stream.shielded,
      });
      const interval =
        stream.minInterval + Math.random() * (stream.maxInterval - stream.minInterval);
      stream.nextAt += Math.max(0.1, interval);
    }
  }
};

const earlyCallBase = (world: World): number => (world.wave === 0 ? 0 : 15 + world.wave);

export const earlyCallBonus = (world: World): number => {
  const base = earlyCallBase(world);
  if (base <= 0) return 0;
  if (!world.waveActive) {
    if (WAVE_GAP_SECONDS <= 0) return 0;
    const frac = clamp01(world.nextWaveIn / WAVE_GAP_SECONDS);
    return Math.ceil(base * frac);
  }
  if (world.midwaveTimerMax <= 0) return 0;
  const frac = clamp01(world.midwaveTimer / world.midwaveTimerMax);
  return Math.ceil(base * frac);
};

// Whether the "call next wave" affordance applies to the current wave
// phase. Deliberately phase-only — it does NOT gate on pause, so the HUD
// keeps showing the call-wave button while paused instead of falling back
// to the between-waves "{n}s" countdown. The pause guard lives in
// `callWaveEarly` so the action itself stays a no-op while frozen.
export const canCallEarly = (world: World): boolean => {
  if (!world.endless && world.wave >= world.totalWaves) return false;
  if (!world.waveActive) return true;
  return midwaveThresholdCrossed(world) && world.midwaveTimerMax > 0;
};

export const earlyCallGoldReward = (world: World): number =>
  canCallEarly(world) ? earlyCallBonus(world) : 0;

export const earlyCallTimerSec = (world: World): number => {
  if (!world.waveActive) return world.nextWaveIn;
  return world.midwaveTimer;
};

export const callWaveEarly = (world: World): boolean => {
  if (world.status !== "running") return false;
  if (!canCallEarly(world)) return false;
  world.gold += earlyCallBonus(world);
  world.nextWaveIn = 0;
  startWave(world);
  return true;
};

export const spawnerTick = (world: World, dt: number) => {
  if (!world.waveActive) {
    if (world.wave === 0) return;
    world.nextWaveIn = Math.max(0, world.nextWaveIn - dt);
    if (world.nextWaveIn === 0 && (world.endless || world.wave < world.totalWaves)) {
      startWave(world);
    }
    return;
  }

  while (world.spawnQueue.length > 0 && world.spawnQueue[0].at <= world.time) {
    const req = world.spawnQueue.shift()!;
    spawnEnemy(world, req.kind, {
      hpMul: req.hpMul,
      pathIndex: req.pathIndex,
      shielded: req.shielded,
      healAura: req.healAura,
      regen: req.regen,
      resists: req.resists,
      bossVariant: req.bossVariant,
    });
  }

  tickBossTrickle(world);

  if (midwaveThresholdCrossed(world)) {
    if (world.midwaveTimerMax === 0) {
      const initial = remainingEnemies(world) * MIDWAVE_PER_ENEMY_SEC + MIDWAVE_BUFFER_SEC;
      world.midwaveTimerMax = initial;
      world.midwaveTimer = initial;
    } else {
      world.midwaveTimer = Math.max(0, world.midwaveTimer - dt);
    }
    if (world.midwaveTimer <= 0 && (world.endless || world.wave < world.totalWaves)) {
      world.nextWaveIn = 0;
      startWave(world);
      return;
    }
  }

  if (world.spawnQueue.length === 0 && world.bossTrickleStreams.length === 0) {
    // Hold wave-clear until any enemy mid-HQ-attack has resolved. Without
    // this, the "WAVE CLEAR +Xg" banner can show while a matriarch is
    // still chomping the gate; the life loss then registers immediately
    // afterward and reads as broken.
    for (const e of world.enemies) {
      if (e.alive && e.leak) return;
    }
    world.waveActive = false;
    world.nextWaveIn = world.endless || world.wave < world.totalWaves ? WAVE_GAP_SECONDS : 0;
    world.midwaveTimer = 0;
    world.midwaveTimerMax = 0;
    const bonus = 5 + world.wave;
    world.gold += bonus;
    emit(world, { type: "wave-clear", wave: world.wave });
  }
};

// Grace window after the final enemy is cleared before the win fires.
// Sized above the longest death clip (Triceratops, 1.79s) plus a frame
// of render-start latency, so the last dino's death animation plays out
// instead of being cut off the instant the enemy count hits zero.
const WIN_DEATH_ANIM_HOLD_SEC = 2;

export const checkRunEnd = (world: World, dt: number) => {
  if (world.status !== "running") return;
  if (world.lives <= 0) {
    world.status = "lost";
    world.shake.magnitude = 0;
    world.winHoldTimer = 0;
    emit(world, { type: "game-over", won: false });
    return;
  }
  if (
    !world.endless &&
    world.wave >= world.totalWaves &&
    !world.waveActive &&
    world.spawnQueue.length === 0 &&
    world.enemies.length === 0
  ) {
    // Hold the win back so the final death animation completes. Status
    // stays "running" through the window: that keeps world.time advancing
    // and the render mixer unfrozen, so the corpse actually falls before
    // the results screen appears.
    world.winHoldTimer += dt;
    if (world.winHoldTimer < WIN_DEATH_ANIM_HOLD_SEC) return;
    world.status = "won";
    world.shake.magnitude = 0;
    emit(world, { type: "game-over", won: true });
  }
};
