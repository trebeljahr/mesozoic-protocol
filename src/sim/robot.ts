import { isOnFlowSurface } from "../flowGeometry";
import { MAP_HEIGHT, MAP_WIDTH } from "../level";
import { dampFactor, shortAngleDelta } from "./angle";
import { isEnemyTargetable } from "./enemyState";
import { type DashSpec, ROBOT_SPECS, type RobotVariantSpec } from "./robotVariants";
import type {
  BeamPoint,
  DamageType,
  Enemy,
  EntityId,
  Robot,
  RobotAbilitySlot,
  RobotVariant,
  Vec2,
  World,
} from "./types";
import { distSq } from "./vec2";
import {
  addShake,
  applyDamage,
  applyPathKnockback,
  applyRobotBurn,
  createBeam,
  createCoalEmber,
  createExplosion,
  createProjectile,
  ENEMY_ROBOT_DAMAGE,
  emit,
  ROBOT_RADIUS,
  ROBOT_RESPAWN_DELAY,
  ROCK_FOOTPRINT,
  spawnParticles,
  TOWER_FOOTPRINT,
  TREE_FOOTPRINT,
} from "./world";

const ROBOT_TURN_RATE = 9.5;
const ROBOT_ACCEL_HALFLIFE = 0.05;
const ROBOT_ARRIVE_RADIUS = 0.25;
const ROBOT_PUSH_ITERATIONS = 3;
const ROBOT_PROJECTILE_SPEED = 26;
// Seconds after the last damage tick before regen kicks back in.
const ROBOT_REGEN_DELAY = 2.5;
const ROBOT_REGEN_PER_SEC = 38;
// Look-ahead steering — distance the robot "sees" ahead of their motion
// for trees/rocks/towers. Anything inside the lateral clearance band
// applies a sideways nudge so the robot arcs around it instead of
// hitting + sliding off via resolveOverlap. Primary obstacle avoidance
// now that move orders are free-roam straight-line across terrain;
// resolveOverlap + the map clamp are the hard backstop.
const ROBOT_AVOID_LOOKAHEAD = 2.6;
const ROBOT_AVOID_CLEARANCE = 0.25;
const ROBOT_AVOID_STRENGTH = 2.4;
// World units the robot walks between footfalls. Step rate = speed / stride,
// so fast variants patter quicker and slow ones plod — matches the shared
// walk clip well enough without hooking animation frames.
const ROBOT_FOOTSTEP_STRIDE = 1.45;
// Visual hover offset (world units) while over a liquid surface.
const ROBOT_HOVER_HEIGHT = 0.55;
const ROBOT_HOVER_HALFLIFE = 0.12;
// Skirmish: how far the robot will reach to "engage" the closest dino
// in melee. Engaged dinos halt forward path movement until the robot
// either dies, dashes free, or walks out of this range.
const ROBOT_ENGAGE_RANGE = 1.6;
// Cap on simultaneous melee attackers per robot. Closest-N in range get
// locked into the skirmish (frozen + chipping HP); extras in range keep
// marching past so packs don't deadlock around a single robot.
const MAX_ENGAGED_DINOS = 5;
// Window in which a pre-dash aim stays valid before auto-clearing.
const DASH_AIM_LIFETIME = 4.0;
// Free-roam move orders: a click up to this far past the map edge still
// registers (the target is clamped back inside). Clicks beyond it — the
// camera margin / spawn aprons — are rejected so the touch "tap away to
// deselect" gesture still has dead space to land on.
const ROBOT_MOVE_BOUNDS_PAD = 1.0;
// Mike dash coal-trail tuning.
const COAL_DROP_INTERVAL = 0.045; // ~9 embers per default 0.4s dash
const COAL_TICK_DAMAGE = 16;
const COAL_RADIUS = 0.85;
const COAL_LIFETIME = 2.6;
const ROBOT_MUZZLE_FORWARD_OFFSET = 0.42;
const ROBOT_MUZZLE_SIDE_OFFSET = 0.18;
const ROBOT_MUZZLE_HEIGHT = 1.05;

// Single source of truth for the robot blocker set. Trees / rocks /
// towers each carry their own footprint constant; iterating them via
// this helper keeps resolveOverlap, avoidObstacles, and any future
// robot-vs-static check from drifting if a footprint is retuned. Lava
// is intentionally not included — mecha treats it as crossable terrain
// and applies DoT separately (see updateRobot).
const forRobotBlockers = (world: World, fn: (bx: number, by: number, br: number) => void): void => {
  for (const t of world.trees) fn(t.pos.x, t.pos.y, TREE_FOOTPRINT * t.scale);
  for (const r of world.rocks) fn(r.pos.x, r.pos.y, ROCK_FOOTPRINT * r.scale);
  for (const t of world.towers) fn(t.pos.x, t.pos.y, TOWER_FOOTPRINT * 0.6);
};

// Push position out of any overlapping blocker by the smallest displacement
// along the connecting normal. Iterating 2-3× lets the robot squeeze
// between paired blockers instead of jittering against the first one we
// resolved.
const resolveOverlap = (world: World, pos: Vec2, radius: number): Vec2 => {
  let x = pos.x;
  let y = pos.y;
  for (let iter = 0; iter < ROBOT_PUSH_ITERATIONS; iter++) {
    let moved = false;
    forRobotBlockers(world, (bx, by, br) => {
      const r = br + radius;
      const dx = x - bx;
      const dy = y - by;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = (r - d) / d;
        x += dx * push;
        y += dy * push;
        moved = true;
      }
    });
    if (!moved) break;
  }
  const halfW = MAP_WIDTH / 2 - radius;
  const halfH = MAP_HEIGHT / 2 - radius;
  if (x < -halfW) x = -halfW;
  if (x > halfW) x = halfW;
  if (y < -halfH) y = -halfH;
  if (y > halfH) y = halfH;
  return { x, y };
};

const findRobotTarget = (world: World, robot: Robot, rangeMul = 1): Enemy | null => {
  const effRange = robot.range * rangeMul;
  const r2 = effRange * effRange;
  let best: Enemy | null = null;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const e of world.enemies) {
    if (!isEnemyTargetable(e)) continue;
    const d2 = distSq(e.pos, robot.pos);
    if (d2 > r2) continue;
    if (d2 < bestDistSq) {
      best = e;
      bestDistSq = d2;
    }
  }
  return best;
};

const findEnemyByProgress = (world: World, pos: Vec2, range: number): Enemy | null => {
  const r2 = range * range;
  let best: Enemy | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const e of world.enemies) {
    if (!isEnemyTargetable(e)) continue;
    if (distSq(e.pos, pos) > r2) continue;
    const score = e.segment + e.segmentT;
    if (score > bestScore) {
      best = e;
      bestScore = score;
    }
  }
  return best;
};

const robotMuzzlePoint = (robot: Robot, pos: Vec2 = robot.pos): BeamPoint => {
  if (pos === robot.pos && robot.muzzlePos) return robot.muzzlePos;
  const fx = Math.sin(robot.facing);
  const fy = -Math.cos(robot.facing);
  const sx = Math.cos(robot.facing);
  const sy = Math.sin(robot.facing);
  return {
    x: pos.x + fx * ROBOT_MUZZLE_FORWARD_OFFSET + sx * ROBOT_MUZZLE_SIDE_OFFSET,
    y: pos.y + fy * ROBOT_MUZZLE_FORWARD_OFFSET + sy * ROBOT_MUZZLE_SIDE_OFFSET,
    h: ROBOT_MUZZLE_HEIGHT + robot.hoverHeight,
  };
};

const enemyLightningHeight = (enemy: Enemy): number => {
  switch (enemy.kind) {
    case "swarm":
      return 0.48;
    case "raptor":
      return 0.82;
    case "para":
      return 0.96;
    case "allosaur":
      return 1.12;
    case "stego":
      return 1.0;
    case "armored":
      return 0.95;
    case "titan":
      return 2.2;
    case "boss":
      return 2.8;
  }
};

const enemyLightningPoint = (enemy: Enemy): BeamPoint => ({
  x: enemy.pos.x,
  y: enemy.pos.y,
  h: enemyLightningHeight(enemy),
});

const findNextChainTarget = (
  world: World,
  from: Vec2,
  radius: number,
  seen: Set<EntityId>,
): Enemy | null => {
  const r2 = radius * radius;
  let best: Enemy | null = null;
  let bd = Number.POSITIVE_INFINITY;
  for (const e of world.enemies) {
    if (!isEnemyTargetable(e)) continue;
    if (seen.has(e.id)) continue;
    const d2 = distSq(e.pos, from);
    if (d2 > r2) continue;
    if (d2 < bd) {
      bd = d2;
      best = e;
    }
  }
  return best;
};

const nearestEnemyFrom = (enemies: Enemy[], from: Vec2): Enemy | null => {
  let best: Enemy | null = null;
  let bd = Number.POSITIVE_INFINITY;
  for (const e of enemies) {
    const d2 = distSq(e.pos, from);
    if (d2 < bd) {
      bd = d2;
      best = e;
    }
  }
  return best;
};

const applyRobotLightningDamage = (
  world: World,
  enemy: Enemy,
  damage: number,
  damageType: DamageType,
  deathParticles = 4,
) => {
  applyDamage(world, enemy, damage, damageType, "#cfe8ff", deathParticles, false, {
    fromRobot: true,
  });
  enemy.flashUntil = world.time + 0.1;
};

const fireRobotShot = (world: World, robot: Robot, target: Enemy) => {
  const variant = ROBOT_SPECS[robot.variant];
  // George Sidestep flags the next shot as a piercing crit (×mul, no
  // projectile travel — applied as a hitscan tracer so the lunge → shot
  // combo reads instantly). Consumed on fire.
  const crit = robot.pendingCrit;
  robot.pendingCrit = null;
  const critMul = crit ? crit.mul : 1;
  const dmg = robot.damage * robot.damageMul * critMul;
  const source = robotMuzzlePoint(robot);

  // Leela auto-attack — hitscan lightning that visibly bounces from
  // enemy to enemy. Damage lands in chain order so kill/XP attribution
  // stays robot-owned for every hop.
  if (variant.attackChain) {
    const { hops, damagePerHop, radius } = variant.attackChain;
    const seen = new Set<EntityId>([target.id]);
    const points: BeamPoint[] = [source, enemyLightningPoint(target)];
    applyRobotLightningDamage(world, target, dmg, robot.damageType, 6);
    spawnParticles(world, source, 4, "#cfe8ff", [2, 5], 0.18);
    spawnParticles(world, target.pos, 6, "#cfe8ff", [3, 6], 0.3);
    let from: Vec2 = target.pos;
    for (let i = 0; i < hops; i++) {
      const next = findNextChainTarget(world, from, radius, seen);
      if (!next) break;
      applyRobotLightningDamage(world, next, damagePerHop * robot.damageMul, robot.damageType, 4);
      spawnParticles(world, next.pos, 4, "#cfe8ff", [3, 6], 0.25);
      points.push(enemyLightningPoint(next));
      seen.add(next.id);
      from = next.pos;
    }
    createBeam(world, points, "#7ee0ff", 0.12);
  } else if (variant.attackTracer || crit?.pierce) {
    // Hitscan tracer (George sniper) — direct hit, no projectile entity.
    // Draw a thin beam from the animated muzzle to the target for the
    // visual read.
    applyDamage(world, target, dmg, robot.damageType, "#fff4d6", crit ? 12 : 5, false, {
      fromRobot: true,
    });
    createBeam(world, [source, enemyLightningPoint(target)], crit ? "#ffe9a0" : "#cfe8ff", 0.12);
    spawnParticles(world, source, 4, "#cfe8ff", [2, 5], 0.18);
    spawnParticles(world, target.pos, crit ? 14 : 6, crit ? "#ffe9a0" : "#cfe8ff", [3, 7], 0.3);
  } else if (robot.attackSplashRadius > 0) {
    createProjectile(
      world,
      "splash",
      robot.damageType,
      source,
      target.pos,
      dmg,
      robot.attackSplashRadius,
      ROBOT_PROJECTILE_SPEED,
      false,
      { fromRobot: true, suppressShake: true },
    );
  } else {
    createProjectile(
      world,
      "direct",
      robot.damageType,
      source,
      target,
      dmg,
      0,
      ROBOT_PROJECTILE_SPEED,
      false,
      { fromRobot: true },
    );
  }

  // Mike Ignition (slot 2 buff) tags every shot with a short burn DoT.
  const buffSpec = variant.abilities[2];
  if (
    buffSpec.type === "buff" &&
    buffSpec.igniteOnHit &&
    robot.selfBuff &&
    world.time < robot.selfBuff.endAt
  ) {
    applyRobotBurn(world, target, buffSpec.igniteOnHit.duration, buffSpec.igniteOnHit.totalDamage);
  }

  robot.shootFlashUntil = world.time + 0.18;
  emit(world, { type: "shoot", towerId: robot.id, towerKind: "pulse", pos: robot.pos });
};

const firePendingShot = (
  world: World,
  robot: Robot,
  shot: { damage: number; range: number; splashRadius: number; damageType: DamageType },
) => {
  const target = findEnemyByProgress(world, robot.pos, shot.range);
  if (!target) return;
  createProjectile(
    world,
    "splash",
    shot.damageType,
    robot.pos,
    target.pos,
    shot.damage * robot.damageMul,
    shot.splashRadius,
    18,
    false,
    { fromRobot: true },
  );
  emit(world, { type: "shoot", towerId: robot.id, towerKind: "mortar", pos: robot.pos });
};

// Applies robot damage path — leaks through invincibility while dashing
// and during respawn grace. Negative HP triggers respawn timer. Death
// fires a multi-layer explosion (warm fireball, white-hot core, ground
// shockwave) mirroring the HQ destruction sequence so a wipe feels
// equally violent.
export const damageRobot = (world: World, amount: number) => {
  const robot = world.robot;
  if (!robot.alive) return;
  if (world.time < robot.abilityActiveUntil[0]) return; // dash i-frames
  if (world.time < robot.iFrameUntil) return; // post-respawn i-frames
  // Slot-2 self-buff damage resist absorbs a fraction of every hit.
  // Clamped to <1 so a max-resist buff still leaks a sliver of damage.
  const resist = Math.min(0.95, Math.max(0, robot.damageResist));
  robot.hp -= amount * (1 - resist);
  robot.flashUntil = world.time + 0.12;
  robot.lastDamagedAt = world.time;
  if (robot.hp <= 0) {
    robot.hp = 0;
    robot.alive = false;
    robot.selected = false;
    robot.dashAim = null;
    robot.motionState = "dead";
    robot.respawnAt = world.time + ROBOT_RESPAWN_DELAY;
    robot.lastDeathAt = world.time;
    robot.moveTarget = null;
    robot.vel = { x: 0, y: 0 };
    robot.pendingShots.length = 0;
    robot.payload = null;
    // Drop engagement on every dino that was locked onto this robot so
    // they resume marching instead of attacking thin air.
    for (const e of world.enemies) {
      if (e.engagedRobotId === robot.id) e.engagedRobotId = null;
    }
    // HQ-style explosion: warm fireball + hot core + ground shockwave.
    createExplosion(world, robot.pos, 2.4, 0.7);
    spawnParticles(world, robot.pos, 48, "#ffb04a", [4, 9], 0.7);
    spawnParticles(world, robot.pos, 28, "#ff5a3a", [5, 11], 0.55);
    spawnParticles(world, robot.pos, 22, "#fff4d6", [2, 5], 0.35);
    addShake(world, 0.7, 3.2);
    emit(world, { type: "death", pos: robot.pos, target: "robot" });
  }
};

// Cursor-driven aim direction setter — UI calls this each pointermove
// while robot.dashAim is active so the rendered arrow tracks the mouse.
export const setRobotDashAimDir = (world: World, dir: Vec2) => {
  const robot = world.robot;
  if (!robot.alive || !robot.dashAim) return;
  const d = Math.hypot(dir.x, dir.y);
  if (d < 1e-3) return;
  robot.dashAim.dir = { x: dir.x / d, y: dir.y / d };
};

// Cancels a pending robot dash aim (Esc, right-click, deselect, variant
// swap, tower pickup). Cooldown was never consumed, so the dash stays
// ready for the next press.
export const cancelRobotDashAim = (world: World) => {
  const robot = world.robot;
  if (!robot.dashAim) return;
  robot.dashAim = null;
};

const respawnRobot = (world: World, robot: Robot) => {
  robot.hp = robot.maxHp;
  robot.alive = true;
  robot.respawnAt = null;
  robot.motionState = "idle";
  // Respawn i-frames go on a dedicated field. Reusing
  // abilityActiveUntil[0] would also trip the dash-velocity branch in
  // updateRobot, making the robot sprint in their facing direction the
  // instant they revive.
  robot.iFrameUntil = world.time + 0.8;
  robot.attackCooldown = 0;
  robot.vel = { x: 0, y: 0 };
  robot.moveTarget = null;
  robot.dashAim = null;
  robot.stuckTimer = 0;
  spawnParticles(world, robot.pos, 24, ROBOT_SPECS[robot.variant].tint, [2, 5], 0.5);
};

// Local steering: nudge desired velocity sideways around any blocker
// the robot is heading at. Skips obstacles behind the robot or outside
// the look-ahead cone. Multiple obstacles sum so a cluster (grove)
// produces a clean arc rather than oscillation. Returns the steered
// velocity; falls through unchanged when desired is near-zero.
const avoidObstacles = (world: World, robot: Robot, dx: number, dy: number): Vec2 => {
  const mag = Math.hypot(dx, dy);
  if (mag < 0.1) return { x: dx, y: dy };
  const fx = dx / mag;
  const fy = dy / mag;
  // Left-perpendicular (rotate forward 90° CCW in world XY).
  const px = -fy;
  const py = fx;
  let pushX = 0;
  let pushY = 0;
  const consider = (bx: number, by: number, br: number) => {
    const ox = bx - robot.pos.x;
    const oy = by - robot.pos.y;
    const forward = ox * fx + oy * fy;
    if (forward <= 0 || forward > ROBOT_AVOID_LOOKAHEAD) return;
    const lateral = ox * px + oy * py;
    const band = br + ROBOT_RADIUS + ROBOT_AVOID_CLEARANCE;
    const absLat = Math.abs(lateral);
    if (absLat > band) return;
    // Push to the opposite side of where the blocker sits. Urgency
    // ramps as the obstacle approaches: full strength at touch range,
    // ~0 at the lookahead horizon.
    const urgency = 1 - forward / ROBOT_AVOID_LOOKAHEAD;
    const sign = lateral >= 0 ? -1 : 1;
    const strength = ((band - absLat) / band) * urgency * ROBOT_AVOID_STRENGTH * mag;
    pushX += px * sign * strength;
    pushY += py * sign * strength;
  };
  forRobotBlockers(world, consider);
  return { x: dx + pushX, y: dy + pushY };
};

const dashDir = (robot: Robot): Vec2 => {
  if (robot.moveTarget) {
    const dx = robot.moveTarget.x - robot.pos.x;
    const dy = robot.moveTarget.y - robot.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-3) return { x: dx / d, y: dy / d };
  }
  return { x: Math.sin(robot.facing), y: -Math.cos(robot.facing) };
};

// Mid-tick payload servicing for slot 3 ongoing effects (ultimate).
// - storm (Leela): every tickInterval, lash the N nearest enemies in
//   radius with chain beams.
// - flameRings (Mike): spawn rings on cadence, advance each ring's
//   radius and damage any enemy newly inside the circle.
// - frenzy (George): pure stat multipliers, no per-tick effect of its
//   own — auto-attacks naturally pump through the buffed cadence.
// - killshot (Stan): charge timer, then delete the locked target with
//   splash at impact.
// The slot-2 self-buff is its own tick pass (tickBuff) — they stack.
const tickPayload = (
  world: World,
  robot: Robot,
  dt: number,
): { dmgMul: number; rateMul: number } => {
  const p = robot.payload;
  const idle = { dmgMul: 1, rateMul: 1 };
  if (!p) return idle;
  if (p.kind === "killshot") {
    const target = world.enemyById.get(p.targetId);
    const lockedTarget = target && isEnemyTargetable(target) ? target : null;
    if (lockedTarget) {
      p.targetPos.x = lockedTarget.pos.x;
      p.targetPos.y = lockedTarget.pos.y;
    }
    if (world.time >= p.fireAt) {
      const impactPos: Vec2 = { x: p.targetPos.x, y: p.targetPos.y };
      const impactPoint = lockedTarget
        ? enemyLightningPoint(lockedTarget)
        : { x: impactPos.x, y: impactPos.y, h: 0.85 };
      createBeam(world, [robotMuzzlePoint(robot), impactPoint], "#ffe9a0", 0.25);
      if (lockedTarget) {
        applyDamage(world, lockedTarget, p.damage, p.damageType, "#fff4d6", 28, false, {
          fromRobot: true,
        });
      }
      // Splash at the locked impact point so escorts still eat the
      // warhead when the priority target dies during chargeTime.
      const r2 = p.splashRadius * p.splashRadius;
      for (const e of world.enemies) {
        if (!isEnemyTargetable(e)) continue;
        if (lockedTarget && e.id === lockedTarget.id) continue;
        if (distSq(e.pos, impactPos) > r2) continue;
        applyDamage(world, e, p.splashDamage, p.damageType, "#ffe9a0", 10, false, {
          fromRobot: true,
        });
      }
      createExplosion(world, impactPos, p.splashRadius, 0.55);
      spawnParticles(world, impactPos, 48, "#ffb04a", [4, 10], 0.7);
      spawnParticles(world, impactPos, 28, "#ffe9a0", [3, 7], 0.5);
      addShake(world, 0.7, 5);
      emit(world, { type: "impact", pos: impactPos });
      robot.payload = null;
    }
    return idle;
  }
  if (p.kind === "frenzy") {
    if (world.time >= p.endAt) {
      robot.payload = null;
      return idle;
    }
    return { dmgMul: p.damageMul, rateMul: p.fireRateMul };
  }
  if (p.kind === "storm") {
    if (world.time >= p.endAt) {
      robot.payload = null;
      return idle;
    }
    if (world.time >= p.nextTickAt) {
      // Pick a lightning path instead of independent robot→enemy rays:
      // first hop starts at the animated muzzle, each later hop bounces
      // from the enemy it just struck.
      const source = robotMuzzlePoint(robot);
      const seen = new Set<EntityId>();
      const points: BeamPoint[] = [source];
      let from: Vec2 = source;
      for (let i = 0; i < p.arcsPerTick; i++) {
        const target = findNextChainTarget(world, from, p.radius, seen);
        if (!target) break;
        applyRobotLightningDamage(world, target, p.damagePerArc, p.damageType, 6);
        points.push(enemyLightningPoint(target));
        seen.add(target.id);
        from = target.pos;
        spawnParticles(world, target.pos, 6, "#cfe8ff", [3, 6], 0.3);
      }
      if (points.length > 1) createBeam(world, points, "#9beaff", 0.15);
      // Sparkles around the robot so the storm reads even with no
      // enemies inside the ring this tick.
      spawnParticles(world, source, 4, "#9beaff", [2, 4], 0.25);
      p.nextTickAt = world.time + p.tickInterval;
    }
    return idle;
  }
  if (p.kind === "flameRings") {
    // Spawn the next ring if cadence elapsed and rings remain.
    if (world.time >= p.nextRingAt && p.ringsRemaining > 0) {
      p.rings.push({ radius: 0, hitIds: new Set<EntityId>() });
      p.ringsRemaining -= 1;
      p.nextRingAt = p.ringsRemaining > 0 ? world.time + p.ringInterval : Number.POSITIVE_INFINITY;
      createExplosion(world, robot.pos, p.maxRadius, 0.55);
      spawnParticles(world, robot.pos, 18, "#ff8a3a", [3, 7], 0.4);
      addShake(world, 0.25, 3);
    }
    // Advance each active ring outward and damage any enemy newly
    // inside the circle (per-ring hit-set so a unit eats one hit per
    // ring even at low frame rates).
    const survivors: typeof p.rings = [];
    for (const ring of p.rings) {
      ring.radius += p.expandSpeed * dt;
      const r2 = ring.radius * ring.radius;
      for (const e of world.enemies) {
        if (!isEnemyTargetable(e)) continue;
        if (ring.hitIds.has(e.id)) continue;
        if (distSq(e.pos, robot.pos) > r2) continue;
        ring.hitIds.add(e.id);
        applyDamage(world, e, p.damagePerRing, p.damageType, "#ff8a3a", 8, false, {
          fromRobot: true,
        });
        e.flashUntil = world.time + 0.12;
        spawnParticles(world, e.pos, 8, "#ff8a3a", [3, 7], 0.35);
        if (p.burn) {
          applyRobotBurn(world, e, p.burn.duration, p.burn.totalDamage);
        }
      }
      if (ring.radius < p.maxRadius) survivors.push(ring);
    }
    p.rings = survivors;
    // Done when every ring has been emitted AND every active ring has
    // finished expanding.
    if (p.ringsRemaining === 0 && p.rings.length === 0) {
      robot.payload = null;
    }
    return idle;
  }
  return idle;
};

// Slot-2 self-buff servicing. Stacks multiplicatively with payload muls
// (mark) so a buff + mark combo lands the planned burst damage. Cleared
// when the window expires. rangeMul is sourced from the variant's slot-2
// spec while the buff is active (George Spotter Drone scope-in).
const tickBuff = (
  world: World,
  robot: Robot,
): {
  damageMul: number;
  fireRateMul: number;
  speedMul: number;
  damageResist: number;
  rangeMul: number;
} => {
  const b = robot.selfBuff;
  if (!b) return { damageMul: 1, fireRateMul: 1, speedMul: 1, damageResist: 0, rangeMul: 1 };
  if (world.time >= b.endAt) {
    robot.selfBuff = null;
    return { damageMul: 1, fireRateMul: 1, speedMul: 1, damageResist: 0, rangeMul: 1 };
  }
  const buffSpec = ROBOT_SPECS[robot.variant].abilities[2];
  const rangeMul = buffSpec.type === "buff" && buffSpec.rangeMul ? buffSpec.rangeMul : 1;
  return {
    damageMul: b.damageMul,
    fireRateMul: b.fireRateMul,
    speedMul: b.speedMul,
    damageResist: b.damageResist,
    rangeMul,
  };
};

// Each tick: order → desired velocity → obstacle resolve → facing →
// targeting + auto-shoot → ability state advancement.
export const updateRobot = (world: World, dt: number) => {
  const robot = world.robot;

  if (!robot.alive) {
    if (robot.respawnAt !== null && world.time >= robot.respawnAt) {
      respawnRobot(world, robot);
    } else {
      return;
    }
  }

  robot.attackCooldown = Math.max(0, robot.attackCooldown - dt);
  // Ultimate (slot 3) and self-buff (slot 2) refresh the robot's per-tick
  // multipliers. Damage and fire rate stack multiplicatively across the
  // payload + buff (George's Bullet Storm + Spotter Drone is the
  // intended combo). damageResist clamped <1 inside damageRobot.
  const payloadMul = tickPayload(world, robot, dt);
  const buff = tickBuff(world, robot);
  robot.damageMul = payloadMul.dmgMul * buff.damageMul;
  robot.fireRateMul = payloadMul.rateMul * buff.fireRateMul;
  robot.speedMul = buff.speedMul;
  robot.damageResist = buff.damageResist;

  // Drain queued multi-shot payload entries (barrage / saturation). Each
  // entry self-describes its damage so a re-spec mid-flight still lands
  // the planned hit. Iterates in-place via swap-and-pop.
  if (robot.pendingShots.length > 0) {
    let kept = 0;
    for (let i = 0; i < robot.pendingShots.length; i++) {
      const s = robot.pendingShots[i];
      if (world.time >= s.when) firePendingShot(world, robot, s);
      else robot.pendingShots[kept++] = s;
    }
    robot.pendingShots.length = kept;
  }

  const dashing = world.time < robot.abilityActiveUntil[0];
  // Pull dash speed from the spec so per-variant dash potency carries
  // through. Fallback to walk speed if the slot somehow lost the spec
  // (shouldn't happen — robotDefaults builds it).
  const variant = ROBOT_SPECS[robot.variant];
  const dashSpec = variant.abilities[0];
  const baseSpeed = robot.speed * robot.speedMul;
  const speed = dashing ? dashSpec.speed : baseSpeed;

  // Auto-clear an expired pre-dash aim — an aim ignored for a few
  // seconds shouldn't trap the cursor in commit-on-click mode.
  if (robot.dashAim && world.time >= robot.dashAim.expiresAt) robot.dashAim = null;

  let desiredX = 0;
  let desiredY = 0;
  let walking = false;
  // Free-roam move follow: steer straight at the target, cutting across
  // terrain between the enemy lanes instead of snapping to a painted
  // path. avoidObstacles arcs the robot around trees/rocks/towers in its
  // look-ahead cone; resolveOverlap + the map-bounds clamp are the hard
  // backstop that keep it out of blockers and inside the playfield.
  if (robot.moveTarget) {
    const dx = robot.moveTarget.x - robot.pos.x;
    const dy = robot.moveTarget.y - robot.pos.y;
    const d = Math.hypot(dx, dy);
    if (d <= ROBOT_ARRIVE_RADIUS) {
      robot.moveTarget = null;
    } else {
      const inv = 1 / d;
      // Ease into the arrive point so the robot doesn't oscillate around it.
      const slow = d < 1.2 ? d / 1.2 : 1;
      desiredX = dx * inv * speed * slow;
      desiredY = dy * inv * speed * slow;
      walking = true;
      const steered = avoidObstacles(world, robot, desiredX, desiredY);
      desiredX = steered.x;
      desiredY = steered.y;
    }
  }

  if (dashing) {
    const fx = Math.sin(robot.facing);
    const fy = -Math.cos(robot.facing);
    desiredX = fx * dashSpec.speed;
    desiredY = fy * dashSpec.speed;
    walking = true;
    // Mike leaves a burning-coal trail behind him during the dash.
    // Drops one ember per COAL_DROP_INTERVAL so the path is dense
    // enough to read as a continuous burn lane without flooding the
    // sim with embers on a single dash.
    if (robot.variant === "mike") {
      if (world.time >= robot.mikeCoalDropAt) {
        createCoalEmber(world, robot.pos, COAL_TICK_DAMAGE, COAL_RADIUS, COAL_LIFETIME);
        robot.mikeCoalDropAt = world.time + COAL_DROP_INTERVAL;
      }
    }
  }

  const k = dampFactor(dt, ROBOT_ACCEL_HALFLIFE);
  robot.vel.x += (desiredX - robot.vel.x) * k;
  robot.vel.y += (desiredY - robot.vel.y) * k;
  if (Math.abs(robot.vel.x) < 0.05 && Math.abs(robot.vel.y) < 0.05) {
    robot.vel.x = 0;
    robot.vel.y = 0;
  }

  const candidate: Vec2 = {
    x: robot.pos.x + robot.vel.x * dt,
    y: robot.pos.y + robot.vel.y * dt,
  };
  const prevX = robot.pos.x;
  const prevY = robot.pos.y;
  const resolved = resolveOverlap(world, candidate, ROBOT_RADIUS);
  robot.pos = resolved;

  if (walking) {
    const moved2 = (robot.pos.x - prevX) ** 2 + (robot.pos.y - prevY) ** 2;
    const expected = Math.max(robot.speed * dt * 0.25, 0.01);
    if (moved2 < expected * expected) {
      robot.stuckTimer += dt;
      if (robot.stuckTimer > 0.6) {
        robot.moveTarget = null;
        robot.stuckTimer = 0;
      }
    } else {
      robot.stuckTimer = 0;
    }
  } else {
    robot.stuckTimer = 0;
  }

  const movingMagSq = robot.vel.x * robot.vel.x + robot.vel.y * robot.vel.y;
  let targetYaw = robot.facing;
  if (movingMagSq > 0.04) {
    targetYaw = Math.atan2(robot.vel.x, -robot.vel.y);
  } else {
    const target = findRobotTarget(world, robot, buff.rangeMul);
    if (target) {
      targetYaw = Math.atan2(target.pos.x - robot.pos.x, -(target.pos.y - robot.pos.y));
    }
  }
  const ky = 1 - Math.exp(-ROBOT_TURN_RATE * dt);
  robot.facing += shortAngleDelta(robot.facing, targetYaw) * ky;

  // Skirmish lock + continuous melee. A robot can fight up to
  // MAX_ENGAGED_DINOS attackers at once — closest-N in melee range get
  // locked, everyone else (in range or not) keeps marching. Each engaged
  // dino chips the robot per tick via ENEMY_ROBOT_DAMAGE (its own axis
  // from `e.damage`, which is the leak/HQ damage), so a t-rex feels
  // devastating in melee while swarm chip is a tickle.
  const ROBOT_HURT_RANGE = ROBOT_ENGAGE_RANGE;
  const hurtR2 = ROBOT_HURT_RANGE * ROBOT_HURT_RANGE;
  const candidates: { e: Enemy; d2: number }[] = [];
  if (robot.alive && world.time >= robot.abilityActiveUntil[0] && world.time >= robot.iFrameUntil) {
    for (const e of world.enemies) {
      if (!isEnemyTargetable(e)) continue;
      if (e.leak) continue;
      const d2 = distSq(e.pos, robot.pos);
      if (d2 > hurtR2) {
        if (e.engagedRobotId === robot.id) e.engagedRobotId = null;
        continue;
      }
      candidates.push({ e, d2 });
    }
    if (candidates.length > MAX_ENGAGED_DINOS) {
      candidates.sort((a, b) => a.d2 - b.d2);
    }
    const engagedCount = Math.min(candidates.length, MAX_ENGAGED_DINOS);
    // Release in-range candidates that didn't make the cut so the lane
    // marches past instead of stalling outside an invisible scrum.
    for (let i = engagedCount; i < candidates.length; i++) {
      const e = candidates[i].e;
      if (e.engagedRobotId === robot.id) e.engagedRobotId = null;
    }
    for (let i = 0; i < engagedCount; i++) {
      const e = candidates[i].e;
      e.engagedRobotId = robot.id;
      const perTick = ENEMY_ROBOT_DAMAGE[e.kind] ?? e.damage;
      damageRobot(world, perTick * dt);
    }
  } else {
    // Robot is mid-dash (i-frames) or dead — drop every engagement so
    // dinos resume their lane march instead of attacking thin air.
    for (const e of world.enemies) {
      if (e.engagedRobotId === robot.id) e.engagedRobotId = null;
    }
  }
  // Liquid surface check feeds both the jetpack hover state and the
  // lava DOT exemption. Auto-engage hover whenever the robot is over
  // lava/water/goo so the visual lift + jet VFX read instantly; the
  // lava DOT is suppressed for that exact span so the jetpack does
  // what it looks like it does.
  const onLiquid = isOnFlowSurface(world.flowFeatures, robot.pos.x, robot.pos.y, ROBOT_RADIUS);
  robot.hovering = onLiquid;
  const hoverTarget = onLiquid ? ROBOT_HOVER_HEIGHT : 0;
  robot.hoverHeight += (hoverTarget - robot.hoverHeight) * dampFactor(dt, ROBOT_HOVER_HALFLIFE);
  if (
    robot.alive &&
    world.biome === "lava" &&
    !robot.hovering &&
    world.time >= robot.abilityActiveUntil[0] &&
    isOnFlowSurface(world.flowFeatures, robot.pos.x, robot.pos.y, ROBOT_RADIUS)
  ) {
    damageRobot(world, 14 * dt);
  }
  if (!robot.alive) return;

  // Out-of-combat HP regen. Suppressed for ROBOT_REGEN_DELAY seconds
  // after any damage tick, so a grazing brush doesn't gate full regen.
  if (robot.hp < robot.maxHp && world.time - robot.lastDamagedAt > ROBOT_REGEN_DELAY) {
    robot.hp = Math.min(robot.maxHp, robot.hp + ROBOT_REGEN_PER_SEC * dt);
  }

  // Auto-attack — pick the closest in-range enemy. Doesn't fire while
  // dashing because the upper-body pose flips into the dash anim.
  const target = !dashing ? findRobotTarget(world, robot, buff.rangeMul) : null;
  robot.targetId = target?.id ?? null;
  if (target && robot.attackCooldown === 0) {
    fireRobotShot(world, robot, target);
    // Slot-2 buffs can boost cadence (Mike's Ignition doubles it); the
    // floor of 1ms keeps the divide safe if a buff somehow zeros the mul.
    const effectiveRate = Math.max(0.001, robot.fireRate * robot.fireRateMul);
    robot.attackCooldown = 1 / effectiveRate;
  }

  if (!robot.alive) robot.motionState = "dead";
  else if (dashing) robot.motionState = "dash";
  else if (world.time < robot.shootFlashUntil && !walking) robot.motionState = "shoot";
  else if (walking) robot.motionState = "walk";
  else robot.motionState = "idle";

  // Footfall cadence for the walk cycle. Uses real displacement (post-
  // collision) so a robot grinding against an obstacle doesn't keep stepping.
  // Dash is excluded — it has its own ability voicing. Primed to the stride
  // whenever not walking so the first step lands the moment the robot moves.
  if (robot.motionState === "walk") {
    robot.footstepAccum += Math.hypot(robot.pos.x - prevX, robot.pos.y - prevY);
    if (robot.footstepAccum >= ROBOT_FOOTSTEP_STRIDE) {
      robot.footstepAccum %= ROBOT_FOOTSTEP_STRIDE;
      emit(world, { type: "footstep", source: "robot", pos: robot.pos, weight: 1 });
    }
  } else {
    robot.footstepAccum = ROBOT_FOOTSTEP_STRIDE;
  }
};

// --- Player-issued actions ---------------------------------------------

// Returns true if the order was accepted. Free-roam: any click inside the
// playfield (plus a small pad past the edge) is taken; the robot walks
// straight there, cutting across terrain between lanes. The target is
// clamped to the reachable rect so it always arrives instead of grinding
// the wall. Clicks well outside the field are rejected so the caller
// (store/UI) can surface feedback or drop robot command mode.
export const orderRobotMove = (world: World, pos: Vec2): boolean => {
  const robot = world.robot;
  if (!robot.alive) return false;
  const acceptHalfW = MAP_WIDTH / 2 + ROBOT_MOVE_BOUNDS_PAD;
  const acceptHalfH = MAP_HEIGHT / 2 + ROBOT_MOVE_BOUNDS_PAD;
  if (pos.x < -acceptHalfW || pos.x > acceptHalfW || pos.y < -acceptHalfH || pos.y > acceptHalfH) {
    return false;
  }
  const reachHalfW = MAP_WIDTH / 2 - ROBOT_RADIUS;
  const reachHalfH = MAP_HEIGHT / 2 - ROBOT_RADIUS;
  robot.moveTarget = {
    x: Math.max(-reachHalfW, Math.min(reachHalfW, pos.x)),
    y: Math.max(-reachHalfH, Math.min(reachHalfH, pos.y)),
  };
  return true;
};

export const selectRobot = (world: World, on: boolean) => {
  const robot = world.robot;
  if (!robot.alive) return;
  robot.selected = on;
};

// Commit a dash in the supplied direction: orients the robot, marks
// the dash window for i-frames + velocity, and fires variant riders
// (Mike coal trail, George next-shot crit, Leela end-chain arcs, Stan
// landing blast). Caller owns cooldown bookkeeping so this helper
// stays purely about effects.
const commitDash = (
  world: World,
  robot: Robot,
  variant: RobotVariantSpec,
  spec: DashSpec,
  dir: Vec2,
) => {
  robot.facing = Math.atan2(dir.x, -dir.y);
  robot.abilityActiveUntil[0] = world.time + spec.duration;
  if (robot.variant === "mike") robot.mikeCoalDropAt = world.time;
  spawnParticles(world, robot.pos, 14, variant.tint, [2, 5], 0.35);
  if (spec.nextShotCrit) {
    robot.pendingCrit = { mul: spec.nextShotCrit.mul, pierce: spec.nextShotCrit.pierce };
  }
  if (spec.endChain) {
    const endX = robot.pos.x + Math.sin(robot.facing) * spec.speed * spec.duration;
    const endY = robot.pos.y + -Math.cos(robot.facing) * spec.speed * spec.duration;
    const endPos: Vec2 = { x: endX, y: endY };
    const seen = new Set<EntityId>();
    const points: BeamPoint[] = [robotMuzzlePoint(robot, endPos)];
    let from: Vec2 = endPos;
    for (let i = 0; i < spec.endChain.hops; i++) {
      const best = findNextChainTarget(world, from, spec.endChain.radius, seen);
      if (!best) break;
      applyRobotLightningDamage(
        world,
        best,
        spec.endChain.damagePerHop,
        spec.endChain.damageType,
        4,
      );
      points.push(enemyLightningPoint(best));
      seen.add(best.id);
      from = best.pos;
    }
    if (points.length > 1) createBeam(world, points, "#7ee0ff", 0.18);
  }
  if (spec.landingBlast) {
    const lbX = robot.pos.x + Math.sin(robot.facing) * spec.speed * spec.duration;
    const lbY = robot.pos.y + -Math.cos(robot.facing) * spec.speed * spec.duration;
    const lbPos: Vec2 = { x: lbX, y: lbY };
    const r2 = spec.landingBlast.radius * spec.landingBlast.radius;
    for (const e of world.enemies) {
      if (!isEnemyTargetable(e)) continue;
      if (distSq(e.pos, lbPos) > r2) continue;
      applyDamage(world, e, spec.landingBlast.damage, spec.landingBlast.damageType, "#ffb054", 8);
      e.flashUntil = world.time + 0.12;
    }
    createExplosion(world, lbPos, spec.landingBlast.radius, 0.45);
    spawnParticles(world, lbPos, 24, "#ffb04a", [3, 7], 0.5);
    spawnParticles(world, lbPos, 14, variant.tint, [4, 9], 0.4);
    addShake(world, 0.5, 5);
    emit(world, { type: "impact", pos: lbPos });
  }
};

// Variant-aware ability dispatch. Slot 0 always = dash, slot 1 = burst,
// slot 2 = the variant's payload (barrage/mark/incinerate). The cooldown
// stored on the spec is scaled by robot.abilityCooldownMul (from the
// Power Core skill node) at trigger time so re-spec is one tick away.
export const triggerRobotAbility = (world: World, slot: RobotAbilitySlot): boolean => {
  const robot = world.robot;
  if (!robot.alive) return false;

  const variant = ROBOT_SPECS[robot.variant];
  const spec = variant.abilities[slot];

  // Dash is a 2-stage ability for every variant: first press arms aim
  // (cursor-driven arrow on the HUD via robot.dashAim), second press /
  // ground click commits in that direction. No cooldown is consumed by
  // the aim stage so previewing is free; Esc clears dashAim without
  // spending the cooldown (see cancelRobotDashAim).
  if (slot === 0 && spec.type === "dash") {
    if (robot.dashAim === null) {
      if (world.time < robot.abilityReadyAt[slot]) return false;
      const initial = dashDir(robot);
      robot.dashAim = { dir: initial, expiresAt: world.time + DASH_AIM_LIFETIME };
      emit(world, { type: "robot-ability", kind: "dash-aim", pos: robot.pos });
      return true;
    }
    if (world.time < robot.abilityReadyAt[slot]) {
      robot.dashAim = null;
      return false;
    }
    const dir = robot.dashAim.dir;
    robot.dashAim = null;
    robot.abilityReadyAt[slot] = world.time + spec.cooldown * robot.abilityCooldownMul;
    commitDash(world, robot, variant, spec, dir);
    emit(world, { type: "robot-ability", kind: "dash", pos: robot.pos });
    return true;
  }

  if (world.time < robot.abilityReadyAt[slot]) return false;
  robot.abilityReadyAt[slot] = world.time + spec.cooldown * robot.abilityCooldownMul;

  if (spec.type === "dash") {
    // Defensive: dashes are slot-0 only in current variants and route
    // through the 2-stage path above. This branch keeps a single-press
    // fallback if a future variant puts a dash in another slot.
    commitDash(world, robot, variant, spec, dashDir(robot));
    emit(world, { type: "robot-ability", kind: "dash", pos: robot.pos });
    return true;
  }

  if (spec.type === "burst") {
    const r2 = spec.radius * spec.radius;
    const hit: Enemy[] = [];
    for (const e of world.enemies) {
      if (!isEnemyTargetable(e)) continue;
      if (distSq(e.pos, robot.pos) > r2) continue;
      applyDamage(world, e, spec.damage, spec.damageType, "#ffb054", 10, false, {
        fromRobot: true,
      });
      e.flashUntil = world.time + 0.12;
      hit.push(e);
      if (spec.burn) {
        applyRobotBurn(world, e, spec.burn.duration, spec.burn.totalDamage);
      }
      if (spec.knockback) {
        applyPathKnockback(world, e, spec.knockback.pathPush);
      }
    }
    // Leela chain-fork: pick `hops` extra enemies near the burst circle,
    // arc beams between them. Distinct from auto-attack chain.
    if (spec.chainHops) {
      const seen = new Set<EntityId>(hit.map((e) => e.id));
      const source = robotMuzzlePoint(robot);
      const first = nearestEnemyFrom(hit, source);
      const points: BeamPoint[] = [source];
      let from: Vec2 = source;
      if (first) {
        points.push(enemyLightningPoint(first));
        from = first.pos;
      }
      for (let i = 0; i < spec.chainHops.hops; i++) {
        const best = findNextChainTarget(world, from, spec.chainHops.radius, seen);
        if (!best) break;
        applyRobotLightningDamage(world, best, spec.chainHops.damagePerHop, spec.damageType, 4);
        points.push(enemyLightningPoint(best));
        seen.add(best.id);
        from = best.pos;
      }
      if (points.length > 1) createBeam(world, points, "#7ee0ff", 0.18);
    }
    createExplosion(world, robot.pos, spec.radius, 0.45);
    // Burst particles now key off variant tint instead of a hard-coded
    // orange — an electric burst no longer reads as flame.
    spawnParticles(world, robot.pos, 24, variant.tint, [3, 7], 0.5);
    spawnParticles(world, robot.pos, 14, variant.tint, [4, 9], 0.4);
    addShake(world, 0.4, 5);
    emit(world, { type: "impact", pos: robot.pos });
    emit(world, { type: "robot-ability", kind: "burst", pos: robot.pos });
    return true;
  }

  if (spec.type === "buff") {
    robot.selfBuff = {
      endAt: world.time + spec.duration,
      damageMul: spec.damageMul,
      fireRateMul: spec.fireRateMul,
      speedMul: spec.speedMul,
      damageResist: spec.damageResist,
    };
    spawnParticles(world, robot.pos, 18, variant.tint, [2, 5], 0.5);
    emit(world, { type: "robot-ability", kind: "buff", pos: robot.pos });
    return true;
  }

  if (spec.type === "storm") {
    robot.payload = {
      kind: "storm",
      endAt: world.time + spec.duration,
      nextTickAt: world.time,
      tickInterval: spec.tickInterval,
      radius: spec.radius,
      arcsPerTick: spec.arcsPerTick,
      damagePerArc: spec.damagePerArc,
      damageType: spec.damageType,
    };
    spawnParticles(world, robot.pos, 28, "#9beaff", [3, 7], 0.5);
    addShake(world, 0.3, 4);
    emit(world, { type: "robot-ability", kind: "storm", pos: robot.pos });
    return true;
  }

  if (spec.type === "flameRings") {
    const totalLife = spec.ringCount * spec.ringInterval + spec.maxRadius / spec.expandSpeed;
    robot.payload = {
      kind: "flameRings",
      endAt: world.time + totalLife + 0.5,
      nextRingAt: world.time,
      ringsRemaining: spec.ringCount,
      ringInterval: spec.ringInterval,
      maxRadius: spec.maxRadius,
      expandSpeed: spec.expandSpeed,
      damagePerRing: spec.damagePerRing,
      damageType: spec.damageType,
      burn: spec.burn,
      rings: [],
    };
    spawnParticles(world, robot.pos, 22, "#ff8a3a", [3, 7], 0.45);
    addShake(world, 0.35, 4);
    emit(world, { type: "robot-ability", kind: "flameRings", pos: robot.pos });
    return true;
  }

  if (spec.type === "frenzy") {
    robot.payload = {
      kind: "frenzy",
      endAt: world.time + spec.duration,
      damageMul: spec.damageMul,
      fireRateMul: spec.fireRateMul,
    };
    spawnParticles(world, robot.pos, 20, variant.tint, [2, 5], 0.5);
    emit(world, { type: "robot-ability", kind: "frenzy", pos: robot.pos });
    return true;
  }

  if (spec.type === "killshot") {
    const target = findEnemyByProgress(world, robot.pos, spec.range);
    if (!target) {
      // Refund cooldown — no valid target = no payload, no charge.
      robot.abilityReadyAt[slot] = world.time;
      return false;
    }
    robot.payload = {
      kind: "killshot",
      targetId: target.id,
      targetPos: { x: target.pos.x, y: target.pos.y },
      fireAt: world.time + spec.chargeTime,
      endAt: world.time + spec.chargeTime + 0.05,
      damage: spec.damage,
      splashDamage: spec.splashDamage,
      splashRadius: spec.splashRadius,
      damageType: spec.damageType,
    };
    spawnParticles(world, robot.pos, 12, variant.tint, [2, 5], 0.45);
    emit(world, { type: "robot-ability", kind: "killshot", pos: robot.pos });
    return true;
  }

  return false;
};

// Helpers exported for store glue. Variant lookup avoids importing the
// spec table into robot consumers that just need stats for the HUD.
export const robotVariantStats = (variant: RobotVariant): RobotVariantSpec => ROBOT_SPECS[variant];
