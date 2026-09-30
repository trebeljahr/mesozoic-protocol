import type { World } from "./types";

// Swap-and-pop in place — avoids allocating a new array each tick when
// few items expire. Predicate returns true to keep the entry.
const retainInPlace = <T>(arr: T[], keep: (x: T) => boolean) => {
  let w = 0;
  for (let r = 0; r < arr.length; r++) {
    const x = arr[r];
    if (keep(x)) arr[w++] = x;
  }
  arr.length = w;
};

export const updateBeams = (world: World) => {
  const t = world.time;
  retainInPlace(world.beams, (b) => b.expiresAt > t);
};

export const updateExplosions = (world: World) => {
  const t = world.time;
  retainInPlace(world.explosions, (e) => e.expiresAt > t);
};

export const updateCryoWaves = (world: World) => {
  const t = world.time;
  retainInPlace(world.cryoWaves, (w) => w.expiresAt > t);
};

export const updateParticles = (world: World, dt: number) => {
  const decay = 1 - 2 * dt;
  for (const p of world.particles) {
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.vel.x *= decay;
    p.vel.y *= decay;
  }
  const t = world.time;
  retainInPlace(world.particles, (p) => {
    if (p.expiresAt > t) return true;
    // A sparse fraction of cooling flame billows leaves rising soot. This
    // lives in the normal puff lifecycle, so it lingers after firing stops.
    if (
      p.kind === "flame" &&
      p.maxLife >= 0.45 &&
      (p.id * 0.61803398875) % 1 < 0.16 &&
      world.puffs.length < 384
    ) {
      const seed = (p.id * 0.38196601125) % 1;
      const life = 1.1 + seed * 0.5;
      world.puffs.push({
        id: world.nextEntityId++,
        pos: { ...p.pos },
        vel: { x: p.vel.x * 0.1, y: p.vel.y * 0.1 },
        h: 0.85,
        vh: 0.45 + seed * 0.3,
        expiresAt: t + life,
        maxLife: life,
        size0: 0.5,
        size1: 1.35,
        rot: seed * Math.PI * 2,
        rotVel: (seed - 0.5) * 0.6,
        tint: "#a79b8e",
        alpha0: 0.32,
      });
    }
    return false;
  });
};

export const updatePuffs = (world: World, dt: number) => {
  // Heavier drag than spark particles — smoke billows then loses momentum.
  const decay = 1 - 1.4 * dt;
  // Buoyancy minus light gravity ≈ small upward residual after rise.
  const vhDecay = 1 - 0.9 * dt;
  for (const p of world.puffs) {
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.h += p.vh * dt;
    p.vel.x *= decay;
    p.vel.y *= decay;
    p.vh *= vhDecay;
    p.rot += p.rotVel * dt;
  }
  const t = world.time;
  retainInPlace(world.puffs, (p) => p.expiresAt > t);
};

export const updateShake = (world: World, dt: number) => {
  if (world.shake.magnitude > 0) {
    world.shake.magnitude = Math.max(0, world.shake.magnitude - world.shake.decay * dt);
  }
};
