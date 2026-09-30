import { describe, expect, it } from "vitest";
import { memoizeCandidate } from "./sceneryCandidateCache";
import expected from "./sceneryPlacement.fixture.json";
import { placementHash, placementHashes } from "./sceneryPlacementFixture";

describe("scenery candidate replay", () => {
  it.each(expected)("matches recorded placements for level $id seed $seed", ({
    id,
    seed,
    hashes,
  }) => {
    const results = placementHashes(id, seed);
    expect(results).toEqual(hashes);
    expect(results.at(-1)).toEqual(results[0]); // Reset restores the original sequence.
  });

  it("ignores floating-point noise but preserves meaningful placement changes", () => {
    const placement = { x: 1.1234561, url: "grass.glb" };
    expect(placementHash(placement)).toBe(placementHash({ ...placement, x: 1.123456100000001 }));
    expect(placementHash(placement)).not.toBe(placementHash({ ...placement, x: 1.12346 }));
    expect(placementHash(placement)).not.toBe(placementHash({ ...placement, url: "rock.glb" }));
    expect(placementHash([1, 2])).not.toBe(placementHash([2, 1]));
    expect(() => placementHash({ x: Number.NaN })).toThrow("Non-finite");
  });

  it("rechecks live blockers rather than freezing old placements", () => {
    expect(expected.some(({ hashes }) => hashes[0][0] !== hashes[5][0])).toBe(true);
    expect(expected.some(({ hashes }) => hashes[0][1] !== hashes[5][1])).toBe(true);
  });

  it("distinguishes candidates sharing an x coordinate", () => {
    const evaluate = memoizeCandidate((x, y) => x + y);
    expect(evaluate(1, 2)).toBe(3);
    expect(evaluate(1, 3)).toBe(4);
    expect(evaluate(1, 2)).toBe(3);
  });

  it("uses exact coordinates, caches false values, and survives eviction", () => {
    let calls = 0;
    const evaluate = memoizeCandidate((x, y) => {
      calls++;
      return x > y;
    }, 2);
    expect(evaluate(1, 1)).toBe(false);
    expect(evaluate(1, 1)).toBe(false);
    expect(calls).toBe(1);
    expect(evaluate(1 + Number.EPSILON, 1)).toBe(true);
    expect(evaluate(2, 1)).toBe(true);
    expect(evaluate(1, 1)).toBe(false);
    expect(calls).toBe(4);
  });
});
