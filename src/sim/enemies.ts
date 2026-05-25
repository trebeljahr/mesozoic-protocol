import { advanceAlongPath, pathProgress, samplePath, segmentLength, smoothDirection } from "./path";
import { IGNITE_TICK_INTERVAL } from "./towers";
import type { Enemy, EnemyKind, Vec2, World } from "./types";
import { clamp01 } from "./vec2";
import {
  addShake,
  applyDamage,
  BOSS_VARIANT_BARRAGE,
  BOSS_VARIANT_CHILD,
  BOSS_VARIANT_STATS,
  emit,
  spawnEnemy,
} from "./world";

const LEAK_RUN_IN_SECONDS = 0.28;
const LEAK_POSE_SECONDS = 0.34;
const LEAK_ATTACK_STANDOFF = 0.18;
const LEAK_TRIGGER_MIN_DISTANCE = 0.28;
const LEAK_TRIGGER_MAX_DISTANCE = 0.75;

// Heavy kinds that thud as they walk. `stride` = world units between
// footfalls (longer = sparser steps); `weight` 0..1 scales the synth's depth
// and loudness. Distance-based so cryo slow/freeze thins the steps in lockstep
// with the slowed walk. The matriarch (`boss`) is intentionally absent: her
// footsteps are phase-locked to the actual walk clip in the render layer
// (BOSS_VARIANT_FOOTSTEP) so each variant's thuds land on her own foot plants
// instead of a shared fixed stride. Lighter/faster kinds are omitted entirely.
const FOOTSTEP_PROFILE: Partial<Record<EnemyKind, { stride: number; weight: number }>> = {
  titan: { stride: 1.2, weight: 1.0 },
};
const remainingPathDistance = (path: Vec2[], segment: number, segmentT: number): number => {
  if (path.length < 2) return 0;
  let total = segmentLength(path, segment) * (1 - segmentT);
  for (let i = segment + 1; i < path.length - 1; i++) total += segmentLength(path, i);
  return total;
};

const pathEndDirection = (path: Vec2[]): Vec2 => {
  const last = path[path.length - 1];
  const prev = path[path.length - 2];
  const dx = last.x - prev.x;
  const dy = last.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
};

const applyLeakHit = (world: World, e: Enemy) => {
  if (!world.invincible) world.lives -= e.damage;
  // Record which HQ took the killing leak. checkRunEnd reads this in the
  // same tick to gate the death explosion to that endpoint only — without
  // it, multi-path levels detonate every HQ in lockstep.
  if (world.lives <= 0 && world.killingPathIndex === null) {
    world.killingPathIndex = e.pathIndex;
  }
  e.alive = false;
  emit(world, { type: "life-lost", pathIndex: e.pathIndex });
  // Slight jolt so the hit registers — previous 0.18 mag with decay 6
  // faded in two frames and was easy to miss. Scales with the enemy's
  // damage so a titan at the gate hits harder than a lone raptor.
  const mag = 0.32 + Math.min(0.28, e.damage * 0.06);
  addShake(world, mag, 3.5);
};

const beginLeakAttack = (world: World, e: Enemy, path: Vec2[]) => {
  const end = path[path.length - 1];
  const dir = pathEndDirection(path);
  const attackPos = {
    x: end.x - dir.x * LEAK_ATTACK_STANDOFF,
    y: end.y - dir.y * LEAK_ATTACK_STANDOFF,
  };
  // If the enemy has already overrun the standoff point (fast enemy on
  // a slow frame can land past `attackPos`), start from the standoff so
  // the run-in lerp never slides backwards.
  const offsetX = e.pos.x - attackPos.x;
  const offsetY = e.pos.y - attackPos.y;
  const past = offsetX * dir.x + offsetY * dir.y > 0;
  e.leak = {
    startedAt: world.time,
    impactAt: world.time + LEAK_RUN_IN_SECONDS + LEAK_POSE_SECONDS,
    startPos: past ? { ...attackPos } : { ...e.pos },
    attackPos,
  };
  e.segment = path.length - 2;
  e.segmentT = 1;
  e.lateralOffset = 0;
  e.slowFactor = 1;
  e.slowUntil = 0;
  // Clear frost so a cryo'd enemy doesn't pose at HQ with full blue
  // tint — leak path skips the frost-decay branch in updateEnemies.
  e.frost = 0;
};

const updateLeakAttack = (world: World, e: Enemy) => {
  const leak = e.leak;
  if (!leak) return;
  const t = clamp01((world.time - leak.startedAt) / LEAK_RUN_IN_SECONDS);
  const eased = 1 - (1 - t) ** 3;
  e.pos = {
    x: leak.startPos.x + (leak.attackPos.x - leak.startPos.x) * eased,
    y: leak.startPos.y + (leak.attackPos.y - leak.startPos.y) * eased,
  };
  if (world.time >= leak.impactAt) applyLeakHit(world, e);
};

const plantEnemyOnPath = (
  world: World,
  child: Enemy,
  pathIndex: number,
  segment: number,
  segmentT: number,
) => {
  const path = world.paths[pathIndex] ?? world.paths[0];
  const maxSegment = Math.max(0, path.length - 2);
  let nextSegment = Math.max(0, Math.min(maxSegment, segment));
  let nextT = segmentT;
  while (nextT < 0 && nextSegment > 0) {
    nextSegment -= 1;
    nextT += 1;
  }
  while (nextT > 1 && nextSegment < maxSegment) {
    nextSegment += 1;
    nextT -= 1;
  }

  child.segment = nextSegment;
  child.segmentT = clamp01(nextT);
  const basePos = samplePath(path, child.segment, child.segmentT);
  const dir = smoothDirection(path, child.segment, child.segmentT);
  if (dir.x * dir.x + dir.y * dir.y > 1e-12) {
    child.pos = {
      x: basePos.x + -dir.y * child.lateralOffset,
      y: basePos.y + dir.x * child.lateralOffset,
    };
  } else {
    child.pos = basePos;
  }
};

export const updateEnemies = (world: World, dt: number) => {
  // Collect matriarch child-spawn requests during the tick. Deferred so
  // we don't mutate world.enemies while iterating it — the new child
  // will be picked up by the next tick instead.
  type DeferredChild = {
    kind: EnemyKind;
    pathIndex: number;
    hpMul: number;
    segment: number;
    segmentT: number;
    spawnIndex: number;
    spawnCount: number;
  };
  const childSpawns: DeferredChild[] = [];
  type DeferredBarrage = {
    kind: EnemyKind;
    pathIndex: number;
    hpMul: number;
    spawnIndex: number;
    spawnCount: number;
  };
  const barrageSpawns: DeferredBarrage[] = [];

  const robot = world.robot;
  const robotAlive = robot.alive;

  for (const e of world.enemies) {
    if (!e.alive) continue;
    // Refresh robot-engage status before the early-out for leak enemies —
    // leakers never engage, so flip it off explicitly.
    if (e.leak) {
      e.engagedWithRobot = false;
      updateLeakAttack(world, e);
      continue;
    }
    // Visual swivel is gated on the actual skirmish lock owned by robot.ts,
    // not raw distance. With the per-robot engage cap, in-range dinos that
    // didn't make the cut keep marching and must not turn to face the robot.
    e.engagedWithRobot = robotAlive && e.engagedRobotId === robot.id;

    // Pyre Combustion meta — ignited enemies tick damage on a fixed
    // cadence while world.time < igniteUntil. Damage routes through
    // applyDamage so kill credit lands on the firing tower (id stamped
    // when the ignite was applied) and the dot integrates with regen
    // suppression / death cleanup like any other damage source.
    if (e.igniteUntil > 0 && world.time < e.igniteUntil && world.time >= e.igniteTickAt) {
      const tickDmg = e.igniteDps * IGNITE_TICK_INTERVAL;
      const hitOpts =
        e.igniteAttackerTowerId !== null ? { attackerTowerId: e.igniteAttackerTowerId } : undefined;
      applyDamage(world, e, tickDmg, "flame", "#ffb54a", 2, false, hitOpts);
      e.igniteTickAt = world.time + IGNITE_TICK_INTERVAL;
      if (!e.alive) continue;
    } else if (e.igniteUntil > 0 && world.time >= e.igniteUntil) {
      e.igniteUntil = 0;
      e.igniteDps = 0;
      e.igniteAttackerTowerId = null;
    }

    // Matriarch child-spawn — variant matriarchs drip their namesake
    // species behind them every BOSS_VARIANT_CHILD interval. Disabled
    // while she's slowed (cryo "freezes" her brood in place) so cold
    // becomes a way to suppress the spawn stream, not just slow her HP.
    if (
      e.kind === "boss" &&
      e.bossVariant !== undefined &&
      e.childSpawnAt !== undefined &&
      world.time >= e.childSpawnAt &&
      world.time >= e.slowUntil &&
      world.time >= e.freezeUntil
    ) {
      const cfg = BOSS_VARIANT_CHILD[e.bossVariant];
      if (cfg) {
        // Inherit the wave's hpMul from the matriarch herself so children
        // scale with level difficulty without us having to thread the
        // multiplier through Enemy. Late-game raptor children should be
        // late-game-tough, not L5 chaff.
        const variantHp = BOSS_VARIANT_STATS[e.bossVariant].hp;
        const spawnCount = Math.max(1, cfg.count ?? 1);
        for (let spawnIndex = 0; spawnIndex < spawnCount; spawnIndex++) {
          childSpawns.push({
            kind: cfg.kind,
            pathIndex: e.pathIndex,
            hpMul: e.maxHp / variantHp,
            segment: e.segment,
            segmentT: e.segmentT,
            spawnIndex,
            spawnCount,
          });
        }
        e.childSpawnAt = world.time + cfg.interval;
      }
    }

    // End-of-run barrage — once she's past the threshold fraction of
    // her walk, drop a wave of her species at the path start every
    // BOSS_VARIANT_BARRAGE interval. Same slow/freeze suppression as
    // the trickle so cold still gates the pressure.
    if (
      e.kind === "boss" &&
      e.bossVariant !== undefined &&
      e.barrageSpawnAt !== undefined &&
      world.time >= e.barrageSpawnAt &&
      world.time >= e.slowUntil &&
      world.time >= e.freezeUntil
    ) {
      const bcfg = BOSS_VARIANT_BARRAGE[e.bossVariant];
      if (bcfg) {
        const path = world.paths[e.pathIndex];
        const total = pathProgress(path, path.length - 2, 1);
        const here = pathProgress(path, e.segment, e.segmentT);
        const progress = total > 0 ? here / total : 0;
        if (progress >= bcfg.threshold) {
          const variantHp = BOSS_VARIANT_STATS[e.bossVariant].hp;
          const hpMul = e.maxHp / variantHp;
          const spawnCount = Math.max(1, bcfg.count);
          for (let i = 0; i < spawnCount; i++) {
            barrageSpawns.push({
              kind: bcfg.kind,
              pathIndex: e.pathIndex,
              hpMul,
              spawnIndex: i,
              spawnCount,
            });
          }
        }
        e.barrageSpawnAt = world.time + bcfg.interval;
      }
    }

    if (world.time >= e.slowUntil && e.slowFactor !== 1) {
      e.slowFactor = 1;
    }

    // Frost accumulates while slowed (only cryo applies slow today) and
    // decays back to 0 once free. The visual layer reads this to tint the
    // model from base color toward white-blue as it builds up.
    if (world.time < e.slowUntil) {
      if (e.frost < 1) e.frost = Math.min(1, e.frost + dt * 0.7);
    } else if (e.frost > 0) {
      e.frost = Math.max(0, e.frost - dt * 0.35);
    }

    // Skirmish lock: a dino engaged with the robot halts forward path
    // movement so the fight stays put. The lock is owned by robot.ts —
    // robot stepping out of ROBOT_ENGAGE_RANGE clears it before this
    // tick runs. While engaged, ENEMY_ROBOT_DAMAGE (applied in robot.ts)
    // drains robot HP; the render layer flips to the dino's Attack clip.
    if (e.engagedRobotId !== null) {
      const robot = world.robot;
      if (!robot?.alive || robot.id !== e.engagedRobotId) {
        e.engagedRobotId = null;
      } else {
        continue; // skip path advance + leak check this tick
      }
    }

    // Cryo Subzero meta — freeze pins effective speed to 0 for the
    // freeze window. Independent of the regular slowFactor so the
    // baseline slow still applies once the freeze elapses.
    const frozen = e.freezeUntil > 0 && world.time < e.freezeUntil;
    const effectiveSpeed = frozen ? 0 : e.speed * e.slowFactor;
    const path = world.paths[e.pathIndex];
    const adv = advanceAlongPath(path, e.segment, e.segmentT, effectiveSpeed * dt);
    e.segment = adv.segment;
    e.segmentT = adv.segmentT;

    // Nudge off the centerline so enemies spread across the lane. The
    // normal is the segment direction rotated 90° — computed per-tick
    // so the offset tracks the path through corners.
    if (e.lateralOffset !== 0 && !adv.finished) {
      const dir = smoothDirection(path, adv.segment, adv.segmentT);
      if (dir.x * dir.x + dir.y * dir.y > 1e-12) {
        e.pos = {
          x: adv.pos.x + -dir.y * e.lateralOffset,
          y: adv.pos.y + dir.x * e.lateralOffset,
        };
      } else {
        e.pos = adv.pos;
      }
    } else {
      e.pos = adv.pos;
    }

    // Footfall cadence — accumulate ground distance and emit a step each time
    // it crosses the kind's stride. Distance-based (not a wall-clock timer) so
    // cryo slow / freeze thin the steps out in lockstep with the slowed walk
    // animation; a single oversized frame collapses to one step, never a burst.
    const footProfile = FOOTSTEP_PROFILE[e.kind];
    if (footProfile && !adv.finished) {
      const moved = effectiveSpeed * dt;
      if (moved > 0) {
        e.footstepAccum += moved;
        if (e.footstepAccum >= footProfile.stride) {
          e.footstepAccum %= footProfile.stride;
          emit(world, {
            type: "footstep",
            source: "dino",
            pos: e.pos,
            weight: footProfile.weight,
          });
        }
      }
    }

    const triggerDistance = Math.max(
      LEAK_TRIGGER_MIN_DISTANCE,
      Math.min(LEAK_TRIGGER_MAX_DISTANCE, e.speed * LEAK_RUN_IN_SECONDS),
    );
    if (adv.finished || remainingPathDistance(path, e.segment, e.segmentT) <= triggerDistance) {
      // Debug invincibility absorbs the leak at impact time — enemy still
      // runs the HQ attack, despawns, and emits the shake/event so the
      // leak is visually unmistakable.
      beginLeakAttack(world, e, path);
    }
  }
  // Swap-and-pop dead enemies in place; keep enemyById in sync.
  const arr = world.enemies;
  let w = 0;
  for (let r = 0; r < arr.length; r++) {
    const e = arr[r];
    if (e.alive) {
      arr[w++] = e;
    } else {
      world.enemyById.delete(e.id);
    }
  }
  arr.length = w;

  // Drop matriarch-spawned children at her current path position so
  // they read as trailing behind her rather than teleporting in at the
  // path origin. Done after the swap-and-pop above so the new entries
  // don't get scanned by the dead-cull pass on this same tick.
  for (const c of childSpawns) {
    const child = spawnEnemy(world, c.kind, { pathIndex: c.pathIndex, hpMul: c.hpMul });
    // Plant the child immediately near the matriarch instead of leaving
    // the default path-start position for a frame. Center the brood near
    // her current progress, with enough lateral spread to read as a
    // swarm bursting from around the body instead of a trailing queue.
    const mid = (c.spawnCount - 1) / 2;
    // All children spawn AT or BEHIND the matriarch on the path. Positive
    // progress would clip a hatchling through her model from the front,
    // which the L5 raptor matriarch debut shows clearly.
    const progressSpread = c.spawnCount > 1 ? -Math.abs(c.spawnIndex - mid) * 0.07 : -0.05;
    const sideSpread = c.spawnCount > 1 ? (c.spawnIndex - mid) * 0.42 : 0;
    child.lateralOffset += sideSpread;
    plantEnemyOnPath(world, child, c.pathIndex, c.segment, c.segmentT - 0.04 + progressSpread);
  }

  // Barrage children drop at the actual path origin so they read as a
  // fresh wave entering the lane behind the matriarch. Lateral spread
  // fans them out so the burst looks like a pack, not a single-file
  // queue.
  for (const b of barrageSpawns) {
    const child = spawnEnemy(world, b.kind, { pathIndex: b.pathIndex, hpMul: b.hpMul });
    const mid = (b.spawnCount - 1) / 2;
    const sideSpread = b.spawnCount > 1 ? (b.spawnIndex - mid) * 0.5 : 0;
    child.lateralOffset += sideSpread;
  }
};
