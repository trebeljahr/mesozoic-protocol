import { describe, expect, it } from "vitest";
import {
  createFbm2D,
  createLandscapeField,
  createPerlin2D,
  getLandscapeField,
  type LandscapeBounds,
  type LandscapeMask,
  landscapeMaskForUrls,
  passesDensityCut,
  scaleTFromDensity,
  spacingForDensity,
  variantForStand,
} from "./landscape";

const BOUNDS: LandscapeBounds = { minX: -31, maxX: 31, minY: -21, maxY: 21 };
const MASKS: LandscapeMask[] = ["canopy", "understory", "groundCover", "damp", "rock", "open"];

// Grid of probe points covering the bounds, used for the range/variance
// assertions below.
const probes = (() => {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 20; i++) {
    for (let j = 0; j <= 14; j++) {
      out.push({
        x: BOUNDS.minX + ((BOUNDS.maxX - BOUNDS.minX) * i) / 20,
        y: BOUNDS.minY + ((BOUNDS.maxY - BOUNDS.minY) * j) / 14,
      });
    }
  }
  return out;
})();

describe("perlin / fbm", () => {
  it("is deterministic and stays inside a sane range", () => {
    const a = createPerlin2D(1234);
    const b = createPerlin2D(1234);
    const c = createPerlin2D(1235);
    let differsFromOtherSeed = false;
    for (const p of probes) {
      const va = a(p.x * 0.13, p.y * 0.13);
      expect(va).toBe(b(p.x * 0.13, p.y * 0.13));
      expect(Number.isFinite(va)).toBe(true);
      expect(Math.abs(va)).toBeLessThanOrEqual(1.5);
      if (va !== c(p.x * 0.13, p.y * 0.13)) differsFromOtherSeed = true;
    }
    expect(differsFromOtherSeed).toBe(true);
  });

  it("varies smoothly — neighbouring samples move less than distant ones", () => {
    const f = createFbm2D(99, { octaves: 4, wavelength: 12 });
    let near = 0;
    let far = 0;
    for (const p of probes) {
      near += Math.abs(f(p.x, p.y) - f(p.x + 0.2, p.y));
      far += Math.abs(f(p.x, p.y) - f(p.x + 12, p.y));
    }
    expect(near).toBeLessThan(far);
  });
});

describe("createLandscapeField", () => {
  const field = createLandscapeField({ seed: 4242, bounds: BOUNDS });

  it("keeps every field and mask inside [0, 1]", () => {
    for (const p of probes) {
      for (const v of [
        field.elevation(p.x, p.y),
        field.slope(p.x, p.y),
        field.moisture(p.x, p.y),
        field.fertility(p.x, p.y),
        field.rockiness(p.x, p.y),
        field.edgeBoost(p.x, p.y),
        field.hash(p.x, p.y),
      ]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      for (const m of MASKS) {
        const d = field.density(m, p.x, p.y);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
      }
    }
  });

  it("actually varies across the map — a constant mask would be no better than uniform scatter", () => {
    for (const m of MASKS) {
      const vals = probes.map((p) => field.density(m, p.x, p.y));
      expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.2);
    }
  });

  it("reproduces itself exactly for a given seed and diverges for another", () => {
    const same = createLandscapeField({ seed: 4242, bounds: BOUNDS });
    const other = createLandscapeField({ seed: 4243, bounds: BOUNDS });
    let diverged = false;
    for (const p of probes) {
      expect(same.fertility(p.x, p.y)).toBe(field.fertility(p.x, p.y));
      expect(same.density("rock", p.x, p.y)).toBe(field.density("rock", p.x, p.y));
      if (other.fertility(p.x, p.y) !== field.fertility(p.x, p.y)) diverged = true;
    }
    expect(diverged).toBe(true);
  });

  it("thickens toward the rim and leaves the middle clear", () => {
    expect(field.edgeBoost(0, 0)).toBe(0);
    expect(field.edgeBoost(BOUNDS.maxX, 0)).toBeCloseTo(1, 5);
    expect(field.edgeBoost(0, BOUNDS.maxY)).toBeCloseTo(1, 5);
    // Monotone outward along a ray.
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const v = field.edgeBoost(BOUNDS.maxX * t, 0);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("banks moisture up against authored water", () => {
    const dry = createLandscapeField({ seed: 7, bounds: BOUNDS });
    const wet = createLandscapeField({
      seed: 7,
      bounds: BOUNDS,
      // A pond at the origin.
      wetnessAt: (x, y) => (Math.hypot(x, y) < 5 ? 1 : 0),
    });
    expect(wet.moisture(0, 0)).toBe(1);
    expect(wet.moisture(0, 0)).toBeGreaterThan(dry.moisture(0, 0));
    // Far from the water the two agree.
    expect(wet.moisture(BOUNDS.maxX, BOUNDS.maxY)).toBe(dry.moisture(BOUNDS.maxX, BOUNDS.maxY));
  });

  it("puts rock and vegetation in different places", () => {
    let agree = 0;
    for (const p of probes) {
      const f = field.density("canopy", p.x, p.y);
      const r = field.density("rock", p.x, p.y);
      if (f > 0.5 && r > 0.5) agree++;
    }
    // Some overlap is fine — a boulder in a wood is normal — but the two
    // masks must not be the same field wearing different names.
    expect(agree / probes.length).toBeLessThan(0.25);
  });
});

describe("placement helpers", () => {
  const field = createLandscapeField({ seed: 11, bounds: BOUNDS });

  it("spacingForDensity interpolates between the dense and sparse radii", () => {
    expect(spacingForDensity(1, 2, 6)).toBeCloseTo(2, 6);
    expect(spacingForDensity(0, 2, 6)).toBeCloseTo(6, 6);
    const mid = spacingForDensity(0.5, 2, 6);
    expect(mid).toBeGreaterThan(2);
    expect(mid).toBeLessThan(6);
    // Denser ground always packs at least as tight.
    let prev = Number.POSITIVE_INFINITY;
    for (let d = 0; d <= 1.0001; d += 0.1) {
      const v = spacingForDensity(d, 2, 6);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });

  it("passesDensityCut always accepts peak density and thins the empty ground", () => {
    let lowAccepted = 0;
    for (const p of probes) {
      expect(passesDensityCut(field, 1, p.x, p.y)).toBe(true);
      if (passesDensityCut(field, 0, p.x, p.y, 0.12)) lowAccepted++;
    }
    const rate = lowAccepted / probes.length;
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(0.35);
  });

  it("scaleTFromDensity stays in [0, 1] and grows with density", () => {
    expect(scaleTFromDensity(0, 0)).toBe(0);
    expect(scaleTFromDensity(1, 1)).toBe(1);
    expect(scaleTFromDensity(1, 0.5)).toBeGreaterThan(scaleTFromDensity(0, 0.5));
  });

  it("variantForStand groups neighbours into stands instead of shuffling per prop", () => {
    const COUNT = 4;
    // No stray draws, so this measures the stand field alone.
    let sameAsNeighbour = 0;
    for (const p of probes) {
      const a = variantForStand(field, p.x, p.y, COUNT, 0.9);
      const b = variantForStand(field, p.x + 1.2, p.y, COUNT, 0.9);
      if (a === b) sameAsNeighbour++;
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(COUNT);
    }
    // Uniform-random variants would agree ~1/COUNT (0.25) of the time; the
    // stand field lands far above that, which is the whole point.
    expect(sameAsNeighbour / probes.length).toBeGreaterThan(0.6);
  });

  it("variantForStand still emits strays so a stand isn't a flat block", () => {
    const stand = variantForStand(field, 0, 0, 4, 0.9);
    const strays = new Set<number>();
    for (let i = 0; i < 18; i++) strays.add(variantForStand(field, 0, 0, 4, (i / 18) * 0.18));
    expect(strays.size).toBeGreaterThan(1);
    expect(strays.has(stand === 0 ? 1 : 0)).toBe(true);
  });
});

describe("landscapeMaskForUrls", () => {
  it("routes each prop family to the terrain story it belongs to", () => {
    expect(landscapeMaskForUrls(["/models/nature/Tree1.glb"])).toBe("canopy");
    expect(landscapeMaskForUrls(["/models/biomes/wasteland/DeadTree2.glb"])).toBe("canopy");
    expect(landscapeMaskForUrls(["/models/nature/Bush1.glb"])).toBe("understory");
    expect(landscapeMaskForUrls(["/models/nature/Rock1.glb"])).toBe("rock");
    expect(landscapeMaskForUrls(["/models/biomes/alien/Crystal_Small_1.glb"])).toBe("rock");
    expect(landscapeMaskForUrls(["/models/landmarks/forest/Mushroom.glb"])).toBe("damp");
    // Ground cover keeps the carpet mask whatever the model is…
    expect(landscapeMaskForUrls(["/models/nature/Grass1.glb"], true)).toBe("groundCover");
    expect(landscapeMaskForUrls(["/models/biomes/snow/Rock1.glb"], true)).toBe("groundCover");
    // …except the damp props, which should still follow the water.
    expect(landscapeMaskForUrls(["/models/landmarks/forest/BushFlowers.glb"], true)).toBe("damp");
    expect(landscapeMaskForUrls([])).toBe("understory");
  });
});

describe("getLandscapeField", () => {
  it("returns the same instance for a key and rebuilds for a new one", () => {
    const build = () => createLandscapeField({ seed: 5, bounds: BOUNDS });
    const a = getLandscapeField("test:cache:a", build);
    expect(getLandscapeField("test:cache:a", build)).toBe(a);
    expect(getLandscapeField("test:cache:b", build)).not.toBe(a);
  });
});
