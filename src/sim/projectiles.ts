import { isEnemyTargetable } from "./enemyState";
import type { Projectile, World } from "./types";
import { distSq } from "./vec2";
import {
  addShake,
  applyDamage,
  applyPathKnockback,
  createExplosion,
  emit,
  spawnParticles,
} from "./world";

const HIT_RADIUS = 0.5;

const applyHit = (world: World, p: Projectile) => {
  const ownerKind =
    p.ownerTowerId !== null ? (world.towerById.get(p.ownerTowerId)?.kind ?? null) : null;
  if (ownerKind !== "pulse") emit(world, { type: "impact", pos: p.pos });
  // Carry T3 anti-modifier flags + kill-credit attribution from the
  // firing tower into applyDamage.
  const hitOpts = {
    shieldDamageMul: p.shieldDamageMul,
    armorPierce: p.armorPierce,
    resistStrip: p.resistStrip,
    regenSuppressOnHit: p.regenSuppressOnHit,
    attackerTowerId: p.ownerTowerId,
    fromRobot: p.fromRobot,
  };

  if (p.kind === "splash") {
    createExplosion(world, p.pos, p.splashRadius, 0.35, p.damageType);
    // Robot normal-attack splash (Mike, Stan) sets suppressShake —
    // every shot shaking the camera felt annoying. Robot specials
    // (Stan Saturation barrage) leave it false so the ult still kicks.
    if (!p.suppressShake) addShake(world, 0.25);
    spawnParticles(
      world,
      p.pos,
      14,
      "#ffb266",
      [3, 7],
      0.45,
      undefined,
      undefined,
      p.damageType === "flame" ? "flame" : undefined,
    );
    spawnParticles(world, p.pos, 8, "#fff2c8", [4, 9], 0.22);
    const rSq = p.splashRadius * p.splashRadius;
    // Mortar Targeting meta — count enemies in range first so the
    // cluster bonus applies uniformly to the whole splash, not just
    // the targets after the threshold.
    let inSplash = 0;
    if (p.clusterDamageBonus > 0) {
      for (const e of world.enemies) {
        if (!isEnemyTargetable(e)) continue;
        if (distSq(e.pos, p.pos) <= rSq) inSplash++;
      }
    }
    const clusterMul = inSplash >= 3 ? 1 + p.clusterDamageBonus : 1;
    const finalDamage = p.damage * clusterMul;
    for (const e of world.enemies) {
      if (!isEnemyTargetable(e)) continue;
      if (distSq(e.pos, p.pos) <= rSq) {
        applyDamage(world, e, finalDamage, p.damageType, "#c44848", 10, p.pierceShield, hitOpts);
        e.flashUntil = world.time + 0.1;
      }
    }
  } else {
    const target = p.targetId !== null ? world.enemyById.get(p.targetId) : null;
    if (target && isEnemyTargetable(target)) {
      spawnParticles(world, p.pos, 3, "#ffe866", [1, 3], 0.2);
      applyDamage(world, target, p.damage, p.damageType, "#c44848", 8, p.pierceShield, hitOpts);
      if (p.ballistic?.knockback && isEnemyTargetable(target))
        applyPathKnockback(world, target, p.ballistic.knockback);
    }
  }
};

export const updateProjectiles = (world: World, dt: number) => {
  const arr = world.projectiles;
  for (let i = 0; i < arr.length; i++) {
    const p = arr[i];
    if (!p.alive) continue;

    if (p.targetId !== null && p.kind === "direct") {
      const target = world.enemyById.get(p.targetId);
      if (!target || !isEnemyTargetable(target)) {
        p.alive = false;
        continue;
      }
      p.targetPos.x = target.pos.x;
      p.targetPos.y = target.pos.y;
    }

    const step = p.speed * dt;
    const dx = p.targetPos.x - p.pos.x;
    const dy = p.targetPos.y - p.pos.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (p.ballistic) {
      p.ballistic.tail.x = p.pos.x;
      p.ballistic.tail.y = p.pos.y;
      p.ballistic.tailHeight = p.ballistic.height;
      p.ballistic.height +=
        (p.ballistic.targetHeight - p.ballistic.height) * Math.min(1, step / Math.max(d, 0.001));
    }
    if (d <= (p.ballistic ? step : Math.max(step, HIT_RADIUS))) {
      p.pos.x = p.targetPos.x;
      p.pos.y = p.targetPos.y;
      applyHit(world, p);
      p.alive = false;
    } else {
      const inv = 1 / d;
      p.pos.x += dx * inv * step;
      p.pos.y += dy * inv * step;
    }
  }
  // Swap-and-pop dead in place.
  let w = 0;
  for (let r = 0; r < arr.length; r++) {
    const p = arr[r];
    if (p.alive) arr[w++] = p;
  }
  arr.length = w;
};
