import { isEnemyTargetable } from "./enemyState";
import type { Enemy, Tower, Vec2, World } from "./types";
import { distSq } from "./vec2";
import {
  applyDamage,
  applySlow,
  computeResistMul,
  createBeam,
  createCryoWave,
  createProjectile,
  emit,
  HIVE_MAX_DRONES,
  HIVE_MAX_DRONES_PER_TOWER,
  spawnParticles,
  TOWER_DAMAGE_TYPE,
} from "./world";

// Effective fire rate factors in any service buff currently applied to
// the tower by hive drones. We compute it on demand instead of caching
// because the bonus is recomputed at the top of every tick — caching
// would just add a state field that has to stay in sync.
export const effectiveFireRate = (t: Tower): number => t.fireRate * (1 + t.serviceFireRateBonus);

// Mirror of effectiveFireRate for damage — Hive A's "Reinforced Drones"
// meta lets each servicing drone add a damage bonus on top of the
// usual fire-rate buff. Aggregated into serviceDamageBonusFrom each
// tick alongside serviceFireRateBonus.
export const effectiveDamage = (t: Tower): number => t.damage * (1 + t.serviceDamageBonusFrom);

// Crit roll for pulse/chain. Returns the damage scaler to multiply
// against tower.damage at fire time. 1 = no crit, critMul on a hit.
const rollCritMul = (t: Tower): number =>
  t.critChance > 0 && Math.random() < t.critChance ? t.critMul : 1;

// How often ignite ticks while the burn is active. Half-second cadence
// keeps the floating damage numbers readable without flooding the
// damage-attribution pipe.
export const IGNITE_TICK_INTERVAL = 0.5;

// Cluster bonus threshold for the mortar meta. Splash impact applies
// the bonus damage only when at least this many enemies sit inside the
// splash radius — small groups don't get the bonus.
export const CLUSTER_THRESHOLD = 3;

// Stamp ignite state onto an enemy and (re)start its tick clock. Called
// from the flame fire path; the per-tick tick loop in enemies.ts is
// what actually applies the damage every IGNITE_TICK_INTERVAL.
const applyIgnite = (world: World, t: Tower, e: Enemy) => {
  if (t.flameIgniteDuration <= 0 || t.flameIgniteDps <= 0) return;
  e.igniteUntil = world.time + t.flameIgniteDuration;
  e.igniteDps = Math.max(e.igniteDps, t.flameIgniteDps);
  e.igniteAttackerTowerId = t.id;
  if (e.igniteTickAt <= world.time) {
    e.igniteTickAt = world.time + IGNITE_TICK_INTERVAL;
  }
};

const enemyProgress = (e: Enemy): number => e.segment + e.segmentT;

const resistMulForTower = (tower: Tower, e: Enemy): number =>
  computeResistMul(e, TOWER_DAMAGE_TYPE[tower.kind], tower.armorPierce);

type DamageEstimate = {
  totalDealt: number;
  rawShotsToKill: number;
};

const estimateDamageDealt = (tower: Tower, e: Enemy, amount = tower.damage): DamageEstimate => {
  let dmg = amount;
  let dealt = 0;
  if (e.shield > 0) {
    const shieldMul = tower.shieldDamageMul;
    const absorbed = Math.min(e.shield, dmg * shieldMul);
    dealt += absorbed;
    dmg -= absorbed / shieldMul;
  }
  const mul = resistMulForTower(tower, e);
  const hpDealt = dmg > 0 ? dmg * mul : 0;
  dealt += Math.max(0, Math.min(e.hp, hpDealt));
  const shieldRaw = e.shield > 0 ? e.shield / tower.shieldDamageMul : 0;
  const hpRaw = mul > 0 ? e.hp / mul : Number.POSITIVE_INFINITY;
  return {
    totalDealt: dealt,
    rawShotsToKill: shieldRaw + hpRaw,
  };
};

const collectChainTargets = (world: World, primary: Enemy, chainCount: number): Enemy[] => {
  const hit: Enemy[] = [primary];
  const hitSet = new Set<Enemy>([primary]);
  const chainRangeSq = 3.5 * 3.5;
  let current = primary;
  for (let i = 0; i < chainCount; i++) {
    let next: Enemy | null = null;
    let bestDistSq = chainRangeSq;
    for (const e of world.enemies) {
      if (!isEnemyTargetable(e)) continue;
      if (hitSet.has(e)) continue;
      const d2 = distSq(e.pos, current.pos);
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        next = e;
      }
    }
    if (!next) break;
    hit.push(next);
    hitSet.add(next);
    current = next;
  }
  return hit;
};

const impactBucketSize = (tower: Tower): number => Math.max(0.5, tower.damage * 0.12);

type TargetImpact = {
  totalDealt: number;
  tieHp: number;
};

const impactForTarget = (world: World, tower: Tower, primary: Enemy): TargetImpact => {
  const primaryEstimate = estimateDamageDealt(tower, primary);
  const tieHp = Number.isFinite(primaryEstimate.rawShotsToKill)
    ? primaryEstimate.rawShotsToKill
    : 1_000_000 + primary.hp + primary.shield;

  if (tower.kind === "chain") {
    let total = 0;
    let damage = tower.damage;
    for (const e of collectChainTargets(world, primary, tower.chainCount)) {
      total += estimateDamageDealt(tower, e, damage).totalDealt;
      damage = Math.max(1, damage * tower.chainFalloff);
    }
    return { totalDealt: total, tieHp };
  }

  if (tower.kind === "mortar") {
    let total = 0;
    const splashSq = tower.splashRadius * tower.splashRadius;
    for (const e of world.enemies) {
      if (!isEnemyTargetable(e)) continue;
      if (distSq(e.pos, primary.pos) > splashSq) continue;
      total += estimateDamageDealt(tower, e).totalDealt;
    }
    return { totalDealt: total, tieHp };
  }

  if (tower.kind === "flame") {
    let total = 0;
    for (const hit of collectFlameHits(world, tower, primary)) {
      total += estimateDamageDealt(
        tower,
        hit.enemy,
        flameTickDamage(tower, hit.index, hit.distance),
      ).totalDealt;
    }
    return { totalDealt: total, tieHp };
  }

  return { totalDealt: primaryEstimate.totalDealt, tieHp };
};

const scoreEnemy = (world: World, tower: Tower, e: Enemy): number => {
  if (tower.targetingMode === "tower") return -distSq(e.pos, tower.pos);
  if (tower.targetingMode === "start") return -enemyProgress(e);
  if (tower.targetingMode === "strongest") return e.maxHp;
  if (tower.targetingMode === "weakest") {
    // Shielded enemies rank as full HP so we don't waste shots draining
    // a shield while damaged unshielded enemies are nearby.
    const effHp = e.shield > 0 ? e.maxHp : e.hp;
    return -effHp;
  }
  if (tower.targetingMode === "vulnerable") {
    const impact = impactForTarget(world, tower, e);
    // Bucketize so near-identical impact falls back to low effective HP
    // instead of thrashing between almost-equal candidates every frame.
    const bucket = Math.round(impact.totalDealt / impactBucketSize(tower));
    return bucket * 1e9 - impact.tieHp * 1e4 + enemyProgress(e);
  }
  return enemyProgress(e);
};

const findTargetInRange = (world: World, tower: Tower): Enemy | null => {
  const rangeSq = tower.range * tower.range;
  let best: Enemy | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const e of world.enemies) {
    if (!isEnemyTargetable(e)) continue;
    if (distSq(e.pos, tower.pos) > rangeSq) continue;
    const score = scoreEnemy(world, tower, e);
    if (score > bestScore) {
      best = e;
      bestScore = score;
    }
  }
  return best;
};

// Pull T3 anti-modifier hit options off a tower for the projectile/
// applyDamage calls, plus the tower id for kill-credit attribution.
// T3 fields default inert; attackerTowerId is always populated so kills
// from chain ricochets / cryo / flame ticks land on the firing tower.
// The clusterDamageBonus comes from the meta tree; carrying it on the
// projectile lets the splash impact decide whether the bonus fires
// based on how many enemies are actually inside the radius at impact.
const towerHitOpts = (t: Tower) => ({
  shieldDamageMul: t.shieldDamageMul,
  armorPierce: t.armorPierce,
  resistStrip: t.resistStrip,
  regenSuppressOnHit: t.regenSuppressOnHit,
  attackerTowerId: t.id,
  clusterDamageBonus: t.clusterDamageBonus,
});

const firePulse = (world: World, t: Tower, target: Enemy) => {
  // Crit is rolled at fire time and baked into the projectile damage.
  // Resolving here keeps applyDamage agnostic of crit semantics so the
  // chain ricochet / mortar splash paths re-use the same crit treatment
  // by simply multiplying tower.damage before fire.
  const dmg = effectiveDamage(t) * rollCritMul(t);
  createProjectile(world, "direct", "kinetic", t.pos, target, dmg, 0, 22, false, towerHitOpts(t));
};

const fireChain = (world: World, t: Tower, primary: Enemy) => {
  const hit = collectChainTargets(world, primary, t.chainCount);
  // Single crit roll per shot — the whole arc carries the same crit
  // multiplier so high-value bounces still register as a "crit chain"
  // visually and statistically.
  let damage = effectiveDamage(t) * rollCritMul(t);

  const points = [t.pos, ...hit.map((e) => e.pos)];
  createBeam(world, points, "#9fd8ff", 0.1);

  const opts = towerHitOpts(t);
  const applyChainSlow = t.chainSlowFactor < 1 && t.chainSlowDuration > 0;
  for (const e of hit) {
    applyDamage(world, e, damage, "electric", undefined, undefined, false, opts);
    if (applyChainSlow && e.alive) {
      applySlow(e, world, t.chainSlowFactor, t.chainSlowDuration);
    }
    damage = Math.max(1, damage * t.chainFalloff);
  }
};

// Cryo damage/slow application — applied to a single enemy the moment a
// freeze wave's expanding front reaches it (see updateCryoWaveHits), so the
// effect is in lockstep with the visible ring instead of a bulk AoE pulse.
// Per-enemy hit particles intentionally absent: the freeze rings carry the
// visual, and a tiny per-enemy puff just added clutter.
const applyCryoHit = (world: World, t: Tower, e: Enemy) => {
  applySlow(e, world, t.slowFactor, t.slowDuration);
  // Subzero meta roll — chance to fully freeze the enemy for the
  // configured duration. Freeze pins effective speed to 0 in the
  // enemy update; baseline slow still applies once freeze elapses.
  if (t.freezeChance > 0 && t.freezeDuration > 0 && Math.random() < t.freezeChance) {
    e.freezeUntil = Math.max(e.freezeUntil, world.time + t.freezeDuration);
  }
  // Cryo T3 (Cryo Lock) — push regen pause out to end-of-slow so the
  // enemy can't tick HP back up while frozen.
  if (t.freezeBlocksRegen && e.regen) {
    e.regenPausedUntil = Math.max(e.regenPausedUntil, e.slowUntil);
  }
  e.flashUntil = world.time + 0.06;
  const dmg = effectiveDamage(t);
  if (dmg > 0) applyDamage(world, e, dmg, "cold", "#bfe9ff", 6, false, towerHitOpts(t));
};

// True if any live enemy is inside the tower's aura — used to gate the
// continuous mist emission so it only runs when there's something to chill.
const enemyInRange = (world: World, t: Tower): boolean => {
  const r2 = t.range * t.range;
  for (const e of world.enemies) {
    if (!isEnemyTargetable(e)) continue;
    if (distSq(e.pos, t.pos) <= r2) return true;
  }
  return false;
};

// A freeze wave lives 1.2 s as its front expands from the tower out to the
// aura edge. Each wave is both the visual and the attack: it's spawned on
// the fireRate cadence (so a base 1.5/s tower emits one every ~0.67 s, two
// in flight) and its front carries the slow/freeze/damage to each enemy it
// sweeps over (see updateCryoWaveHits).
const CRYO_WAVE_LIFE = 1.2;
const spawnCryoWave = (world: World, t: Tower) => {
  createCryoWave(world, t.pos, t.range, CRYO_WAVE_LIFE, t.id);
};

// Drive the freeze effect off the visible animation: each tick, advance
// every wave's leading edge to the same radius the renderer draws, then hit
// any in-range enemy the front has newly reached. hitIds gates one
// application per enemy per wave, so overlapping waves don't double-dip and
// the per-enemy cadence settles to the wave-spawn cadence.
const updateCryoWaveHits = (world: World) => {
  for (const w of world.cryoWaves) {
    const tower = world.towers.find((t) => t.id === w.towerId);
    if (!tower) continue;
    const progress = 1 - (w.expiresAt - world.time) / w.maxLife;
    const front = w.maxRadius * progress;
    if (front <= 0) continue;
    const frontSq = front * front;
    for (const e of world.enemies) {
      if (w.hitIds.has(e.id)) continue;
      if (!isEnemyTargetable(e)) continue;
      if (distSq(e.pos, w.pos) > frontSq) continue;
      w.hitIds.add(e.id);
      applyCryoHit(world, tower, e);
    }
  }
};

const fireMortar = (world: World, t: Tower, target: Enemy) => {
  createProjectile(
    world,
    "splash",
    "explosive",
    t.pos,
    target.pos,
    effectiveDamage(t),
    t.splashRadius,
    14,
    false,
    towerHitOpts(t),
  );
};

// Flamethrower — burns everything inside a forward cone. Damage is small
// but applied frequently so it reads as DoT on anything lingering in the
// stream.
const FLAME_HALF_CONE = Math.PI / 6; // 30° → 60° total spread
const FLAME_COS_HALF = Math.cos(FLAME_HALF_CONE);
export const FLAME_MAX_TARGETS = 7;
export const FLAME_SECONDARY_THROUGHPUT = 0.74;
export const FLAME_TAIL_FALLOFF = 0.45;
const FLAME_DISTANCE_FALLOFF = 0.35;
const FLAME_MIN_RANGE_MUL = 0.55;

type FlameHit = {
  enemy: Enemy;
  distance: number;
  index: number;
};

const flameThroughputMul = (index: number): number =>
  index === 0 ? 1 : FLAME_SECONDARY_THROUGHPUT * FLAME_TAIL_FALLOFF ** (index - 1);

export const flameThroughputCapacity = (enemiesOnScreen: number): number => {
  const hits = Math.min(FLAME_MAX_TARGETS, Math.max(0, Math.floor(enemiesOnScreen)));
  let total = 0;
  for (let i = 0; i < hits; i++) total += flameThroughputMul(i);
  return total;
};

const flameRangeMul = (distance: number, range: number): number =>
  Math.max(FLAME_MIN_RANGE_MUL, 1 - (distance / Math.max(1e-6, range)) * FLAME_DISTANCE_FALLOFF);

const flameTickDamage = (tower: Tower, index: number, distance: number): number =>
  effectiveDamage(tower) * flameThroughputMul(index) * flameRangeMul(distance, tower.range);

const collectFlameHits = (world: World, t: Tower, target: Enemy): FlameHit[] => {
  const dx = target.pos.x - t.pos.x;
  const dy = target.pos.y - t.pos.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const dirX = dx / len;
  const dirY = dy / len;

  const rangeSq = t.range * t.range;
  const candidates: { enemy: Enemy; d2: number }[] = [];
  for (const e of world.enemies) {
    if (!isEnemyTargetable(e)) continue;
    const ex = e.pos.x - t.pos.x;
    const ey = e.pos.y - t.pos.y;
    const d2 = ex * ex + ey * ey;
    if (d2 > rangeSq) continue;
    const eLen = Math.sqrt(d2) || 1;
    const dot = (ex * dirX + ey * dirY) / eLen;
    // Always include the locked target (avoid edge-case where target sits
    // right at the cone boundary and gets dropped due to FP noise).
    if (e !== target && dot < FLAME_COS_HALF) continue;
    candidates.push({ enemy: e, d2 });
  }
  candidates.sort((a, b) => a.d2 - b.d2 || enemyProgress(b.enemy) - enemyProgress(a.enemy));
  return candidates.slice(0, FLAME_MAX_TARGETS).map((c, index) => ({
    enemy: c.enemy,
    distance: Math.sqrt(c.d2),
    index,
  }));
};

const fireFlameDamage = (world: World, t: Tower, target: Enemy): boolean => {
  const hits = collectFlameHits(world, t, target);
  const canIgnite = t.flameIgniteDuration > 0 && t.flameIgniteDps > 0;
  for (const hit of hits) {
    applyDamage(
      world,
      hit.enemy,
      flameTickDamage(t, hit.index, hit.distance),
      "flame",
      "#ffb54a",
      3,
      false,
      towerHitOpts(t),
    );
    // Pyre Combustion meta — every flame contact refreshes the lingering
    // burn so the enemy keeps taking damage after it walks out of range.
    if (canIgnite && hit.enemy.alive) applyIgnite(world, t, hit.enemy);
  }
  return hits.length > 0;
};

// Continuous flame stream — emits a directed cone of particles every tick
// while the tower is targeting. Layered colours give a hot core + outer
// flame + trailing embers look.
//
// Particle reach has to track t.range so the visible flame wall lines up
// with the damage cone (also gated by t.range). Particles decay via
// `vel *= 1 - 2*dt` per tick in updateParticles; the continuous analogue
// is reach = v0/2 * (1 - exp(-2*lifetime)). Solving for v0 lets us pick
// initial speeds that land axial particles right at the range edge,
// regardless of any range upgrades.
const NOZZLE_OFFSET = 0.55;
const flameReachFactor = (life: number) => 0.5 * (1 - Math.exp(-2 * life));

const spawnFlameStream = (world: World, t: Tower, target: Enemy) => {
  const dx = target.pos.x - t.pos.x;
  const dy = target.pos.y - t.pos.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const dirX = dx / len;
  const dirY = dy / len;
  const dir = { x: dirX, y: dirY };
  // Nozzle slightly in front of the tower so particles don't pop out of
  // its body.
  const nozzle = { x: t.pos.x + dirX * NOZZLE_OFFSET, y: t.pos.y + dirY * NOZZLE_OFFSET };

  const reach = Math.max(0.4, t.range - NOZZLE_OFFSET);
  const speedRange = (life: number, frac: number, jitter = 0.18): [number, number] => {
    const mid = (reach * frac) / flameReachFactor(life);
    return [mid * (1 - jitter), mid * (1 + jitter)];
  };

  const yellowLife = 0.28;
  const orangeLife = 0.45;
  const redLife = 0.7;

  // Hot inner jet — narrowish, fast, short-lived; reaches ~70% down the cone.
  // One particle per tick is enough — the per-particle brightness boost
  // (Effects.tsx) ramps newly-spawned particles to ~2.2× and overlapping
  // tick spawns already pile a visible hot core on the centerline.
  spawnParticles(
    world,
    nozzle,
    1,
    "#ffae50",
    speedRange(yellowLife, 0.7),
    yellowLife,
    dir,
    Math.PI / 10,
  );
  // Mid orange flames — main flame body, fills most of the cone. Cone kept
  // just inside the damage cone so the body stays visibly contained.
  spawnParticles(
    world,
    nozzle,
    4,
    "#ffa040",
    speedRange(orangeLife, 0.9),
    orangeLife,
    dir,
    Math.PI / 7,
  );
  // Outer red wash + trailing embers — sized so axial embers land right at
  // the damage-cone edge (range), so the visible wall matches what burns.
  // Counts intentionally thin: the particle material is additive +
  // toneMapped:false, so each layer adds linearly to the framebuffer and
  // a dense stream paints the cone white over bright biome surfaces (lit
  // snow albedo already runs ~1.7-1.9 in linear and blooms on its own).
  spawnParticles(world, nozzle, 2, "#e8492a", speedRange(redLife, 1.0), redLife, dir, Math.PI / 6);
};

const fireMortarAtSpot = (world: World, t: Tower, pos: Vec2) => {
  createProjectile(
    world,
    "splash",
    "explosive",
    t.pos,
    { x: pos.x, y: pos.y },
    effectiveDamage(t),
    t.splashRadius,
    14,
    false,
    towerHitOpts(t),
  );
};

// Only fire at the spot if at least one live enemy is within splash radius;
// otherwise we're just wasting the cooldown.
const enemyInSplash = (world: World, spot: Vec2, splashRadius: number): boolean => {
  const r2 = splashRadius * splashRadius;
  for (const e of world.enemies) {
    if (!isEnemyTargetable(e)) continue;
    if (distSq(e.pos, spot) <= r2) return true;
  }
  return false;
};

export const updateTowers = (world: World, dt: number) => {
  // Recompute service buffs first. Each non-hive tower's
  // serviceFireRateBonus is the sum of every assigned drone's buff that
  // currently points at it. Reset on every tick so a re-assignment or
  // sold tower drops the buff on the very next frame, not after a
  // delayed fade.
  for (const t of world.towers) {
    t.serviceFireRateBonus = 0;
    t.serviceDamageBonusFrom = 0;
  }
  for (const h of world.towers) {
    if (h.kind !== "hive") continue;
    for (let d = 0; d < h.droneCount; d++) {
      const targetId = h.droneAssignments[d];
      if (targetId === null || targetId === undefined) continue;
      const target = world.towerById.get(targetId);
      // Drop stale assignments — the target may have been sold. Both
      // fields cleared here so the renderer + UI agree on idle state.
      if (!target || target.kind === "hive") {
        h.droneAssignments[d] = null;
        continue;
      }
      target.serviceFireRateBonus += h.serviceBuff;
      // Hive A meta "Reinforced Drones" — each servicing drone also
      // contributes a damage uplift on top of the fire-rate buff. Inert
      // (0) on non-meta hives, so existing builds see no change.
      target.serviceDamageBonusFrom += h.serviceDamageBonus;
    }
  }

  for (const t of world.towers) {
    t.cooldown = Math.max(0, t.cooldown - dt);

    // Hive is pure support — no targeting, no firing. Service bonuses
    // were already accumulated on each target tower above.
    if (t.kind === "hive") continue;

    if (t.kind === "cryo") {
      // The freeze wave IS the attack. On the fireRate cadence (so hive
      // service buffs still speed it up) a fresh ring leaves the tower
      // while any enemy is in range; its expanding front applies the
      // slow/freeze/damage as it sweeps over each enemy in updateCryoWaveHits,
      // keeping the visual and the effect in lockstep.
      if (t.cooldown === 0 && enemyInRange(world, t)) {
        spawnCryoWave(world, t);
        t.cooldown = 1 / effectiveFireRate(t);
        emit(world, { type: "shoot", towerId: t.id, towerKind: t.kind, pos: t.pos });
      }
      continue;
    }

    // Spot-targeting: mortars only. Aim at the fixed spot and only fire when
    // something is actually in its splash — saves ammo while still letting
    // the player pre-sight a chokepoint.
    if (t.kind === "mortar" && t.targetingMode === "spot") {
      t.targetId = null;
      if (t.targetSpot && t.cooldown === 0) {
        const inRange = distSq(t.targetSpot, t.pos) <= t.range * t.range;
        if (inRange && enemyInSplash(world, t.targetSpot, t.splashRadius)) {
          fireMortarAtSpot(world, t, t.targetSpot);
          t.cooldown = 1 / effectiveFireRate(t);
          emit(world, { type: "shoot", towerId: t.id, towerKind: t.kind, pos: t.pos });
        }
      }
      continue;
    }

    // Re-evaluate target every tick so the mode always reflects current
    // battlefield state — a slow enemy being passed by a faster one in "end"
    // mode should get dropped immediately, not at the old target's death.
    const target = findTargetInRange(world, t);
    t.targetId = target?.id ?? null;

    if (t.kind === "flame") {
      if (target) {
        if (!t.flameActive) {
          t.flameActive = true;
          emit(world, { type: "flame-start", towerId: t.id, pos: t.pos });
        }
        spawnFlameStream(world, t, target);
        if (t.cooldown === 0) {
          fireFlameDamage(world, t, target);
          t.cooldown = 1 / effectiveFireRate(t);
          emit(world, { type: "shoot", towerId: t.id, towerKind: t.kind, pos: t.pos });
        }
      } else if (t.flameActive) {
        t.flameActive = false;
        emit(world, { type: "flame-stop", towerId: t.id });
      }
      continue;
    }

    if (target && t.cooldown === 0) {
      if (t.kind === "pulse") firePulse(world, t, target);
      else if (t.kind === "chain") fireChain(world, t, target);
      else if (t.kind === "mortar") fireMortar(world, t, target);
      t.cooldown = 1 / effectiveFireRate(t);
      emit(world, { type: "shoot", towerId: t.id, towerKind: t.kind, pos: t.pos });
    }
  }

  // Resolve freeze-wave fronts after all towers have (maybe) spawned this
  // tick's waves, so a wave is hit-tested the same tick it appears.
  updateCryoWaveHits(world);
};

// --- Hive support drones ----------------------------------------------
//
// Drones orbit either the hive (when idle) or their assigned tower
// (when servicing). Their visible position is purely cosmetic — the
// service buff itself is recomputed at the top of updateTowers from
// each hive's droneAssignments array, so the renderer can lag the
// physical orbit without affecting damage timing.
//
// Orbit phase is a function of (hive.id, droneIdx) so the same drone
// keeps a consistent angle even as the orbit center swaps between hive
// and serviced tower — looks like the drone "flies over" rather than
// teleporting, even with snap-to-center positioning.

export const HIVE_ORBIT_RADIUS = 1.0;
export const HIVE_ORBIT_HEIGHT = 1.1;
const HIVE_ORBIT_SPEED = 0.55; // rad/s
const HIVE_AUTO_ASSIGN_RADIUS = 8.5;
const HIVE_AUTO_ASSIGN_RADIUS_SQ = HIVE_AUTO_ASSIGN_RADIUS * HIVE_AUTO_ASSIGN_RADIUS;

// How many drones (from every hive on the map) are currently servicing
// the given target tower. Used to enforce HIVE_MAX_DRONES_PER_TOWER so
// stacking is bounded regardless of how many hives the player owns.
export const countDronesOnTower = (world: World, towerId: number): number => {
  let n = 0;
  for (const h of world.towers) {
    if (h.kind !== "hive") continue;
    for (let i = 0; i < h.droneCount; i++) {
      if (h.droneAssignments[i] === towerId) n++;
    }
  }
  return n;
};

// Auto-wire idle drones so the player doesn't have to drill into the
// hive panel for every neighbour. Called only on tower placement —
// hive drone-bay upgrades intentionally leave the new drone idle so the
// player picks its target, rather than the hive quietly scattering it.
//
// Two directions:
//  1. Non-hive tower placed anywhere → grab closest hive's first idle
//     drone.
//  2. Hive placed → fill its idle slots round-robin so drones spread
//     across nearby towers instead of piling on one.
//
// Round-robin picks the candidate with the fewest currently-attached
// drones; distance breaks ties so a hive still favours its local
// cluster. Manual assignments are left untouched; stacking is capped
// at HIVE_MAX_DRONES_PER_TOWER per target.
export const autoAssignDroneToNewTower = (world: World, tower: Tower): boolean => {
  if (tower.kind === "hive") {
    const allCandidates: { id: number; d2: number; stacked: number }[] = [];
    for (const t of world.towers) {
      if (t === tower || t.kind === "hive") continue;
      const stacked = countDronesOnTower(world, t.id);
      if (stacked >= HIVE_MAX_DRONES_PER_TOWER) continue;
      allCandidates.push({ id: t.id, d2: distSq(t.pos, tower.pos), stacked });
    }
    if (allCandidates.length === 0) return false;
    const candidates = allCandidates.some((c) => c.d2 <= HIVE_AUTO_ASSIGN_RADIUS_SQ)
      ? allCandidates.filter((c) => c.d2 <= HIVE_AUTO_ASSIGN_RADIUS_SQ)
      : allCandidates;
    // Distance order is the tie-break preference — the min-stack scan
    // below walks the list in order, so the first equal-stack hit wins.
    candidates.sort((a, b) => a.d2 - b.d2);

    let assigned = false;
    for (let i = 0; i < tower.droneCount; i++) {
      if (tower.droneAssignments[i] !== null) continue;
      let pick = -1;
      let pickStack = Number.POSITIVE_INFINITY;
      for (let j = 0; j < candidates.length; j++) {
        const c = candidates[j];
        if (c.stacked >= HIVE_MAX_DRONES_PER_TOWER) continue;
        if (c.stacked < pickStack) {
          pickStack = c.stacked;
          pick = j;
        }
      }
      if (pick < 0) break;
      tower.droneAssignments[i] = candidates[pick].id;
      candidates[pick].stacked++;
      assigned = true;
    }
    return assigned;
  }

  // Non-hive tower: find the closest hive with a free slot anywhere
  // on the map, provided this tower isn't already at the stacking cap.
  // Nearby hives get first refusal; if none are local, we fall back.
  if (countDronesOnTower(world, tower.id) >= HIVE_MAX_DRONES_PER_TOWER) return false;
  let bestLocalHive: Tower | null = null;
  let bestLocalDroneIdx = -1;
  let bestLocalDistSq = Number.POSITIVE_INFINITY;
  let bestGlobalHive: Tower | null = null;
  let bestGlobalDroneIdx = -1;
  let bestGlobalDistSq = Number.POSITIVE_INFINITY;
  for (const h of world.towers) {
    if (h.kind !== "hive") continue;
    let freeIdx = -1;
    for (let i = 0; i < h.droneCount; i++) {
      if (h.droneAssignments[i] === null) {
        freeIdx = i;
        break;
      }
    }
    if (freeIdx < 0) continue;
    const d2 = distSq(h.pos, tower.pos);
    if (d2 < bestGlobalDistSq) {
      bestGlobalDistSq = d2;
      bestGlobalHive = h;
      bestGlobalDroneIdx = freeIdx;
    }
    if (d2 <= HIVE_AUTO_ASSIGN_RADIUS_SQ && d2 < bestLocalDistSq) {
      bestLocalDistSq = d2;
      bestLocalHive = h;
      bestLocalDroneIdx = freeIdx;
    }
  }
  const bestHive = bestLocalHive ?? bestGlobalHive;
  const bestDroneIdx = bestLocalHive ? bestLocalDroneIdx : bestGlobalDroneIdx;
  if (!bestHive) return false;
  bestHive.droneAssignments[bestDroneIdx] = tower.id;
  return true;
};

// Phase angle uses a fixed denominator (HIVE_MAX_DRONES) so adding
// drones via Path A doesn't reshuffle the existing drones' orbits —
// the new drone slots in at its own index without disrupting the
// already-flying ones.
export const hiveDroneAngle = (tower: Tower, time: number, droneIdx: number): number =>
  tower.id * 0.37 + (droneIdx * (2 * Math.PI)) / HIVE_MAX_DRONES + time * HIVE_ORBIT_SPEED;

// Returns the orbit center for a drone — the assigned tower's position
// when serviced, otherwise the hive's own position. Renderer + tooling
// both call this so the visual + sim agree on where the drone "is."
export const hiveDroneOrbitCenter = (hive: Tower, world: World, droneIdx: number): Vec2 => {
  const targetId = hive.droneAssignments[droneIdx];
  if (targetId === null || targetId === undefined) return hive.pos;
  const target = world.towerById.get(targetId);
  if (!target || target.kind === "hive") return hive.pos;
  return target.pos;
};

export const hiveDronePosition = (
  hive: Tower,
  world: World,
  time: number,
  droneIdx: number,
): Vec2 => {
  const center = hiveDroneOrbitCenter(hive, world, droneIdx);
  const a = hiveDroneAngle(hive, time, droneIdx);
  return {
    x: center.x + Math.cos(a) * HIVE_ORBIT_RADIUS,
    y: center.y + Math.sin(a) * HIVE_ORBIT_RADIUS,
  };
};
