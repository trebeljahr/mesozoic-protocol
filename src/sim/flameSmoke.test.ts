import { expect, it } from "vitest";
import { updateParticles, updatePuffs } from "./effects";
import type { Particle, World } from "./types";

const particle = (id = 5, kind: Particle["kind"] = "flame"): Particle => ({
  id,
  kind,
  pos: { x: 2, y: 3 },
  vel: { x: 1, y: 0 },
  maxLife: 0.7,
  expiresAt: 1,
  color: "#ffaa00",
});
const world = (particles = [particle()]): World =>
  ({
    time: 0.9,
    nextEntityId: 5000,
    particles,
    puffs: [],
  }) as unknown as World;

it("leaves smoke once on flame expiry, which rises then expires independently", () => {
  const w = world();
  updateParticles(w, 0);
  expect(w.puffs).toHaveLength(0);
  w.time = 1;
  updateParticles(w, 0);
  expect(w.particles).toHaveLength(0);
  expect(w.puffs).toHaveLength(1);
  const puff = w.puffs[0];
  const height = puff.h;
  updateParticles(w, 0);
  expect(w.puffs).toHaveLength(1);
  w.time += 0.1;
  updatePuffs(w, 0.1);
  expect(puff.h).toBeGreaterThan(height);
  w.time = puff.expiresAt + 0.01;
  updatePuffs(w, 0);
  expect(w.puffs).toHaveLength(0);
});

it("does not turn impact sparks or short-lived hot cores into soot", () => {
  const spark = particle();
  delete spark.kind;
  const core = particle(13);
  core.maxLife = 0.28;
  const w = world([spark, core]);
  w.time = 1;
  updateParticles(w, 0);
  expect(w.puffs).toHaveLength(0);
});

it("caps cooling smoke during a large simultaneous flame expiry", () => {
  const w = world(Array.from({ length: 3000 }, (_, i) => particle(i + 1)));
  w.time = 1;
  updateParticles(w, 0);
  expect(w.puffs).toHaveLength(384);
  expect(w.particles).toHaveLength(0);
  expect(new Set(w.puffs.map((p) => p.id)).size).toBe(384);
});
