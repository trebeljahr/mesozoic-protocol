import { describe, expect, it } from "vitest";
import { LEVELS } from "../levels";
import { emptyProgress } from "../progress";
import { initialDiscovery, isMapLevelDiscovered, mapDiscovery } from "./worldMapDiscovery";

describe("campaign map discovery", () => {
  it("starts with only the first playable outpost visible", () => {
    const p = emptyProgress();
    expect(LEVELS.filter((l) => isMapLevelDiscovered(l.id, p)).map((l) => l.id)).toEqual([1]);
    expect(mapDiscovery(p).radii.filter((r) => r > 0)).toHaveLength(1);
    expect(mapDiscovery(p).complete).toBe(false);
  });
  it("reveals the next outpost after a standard clear, without requiring three stars", () => {
    const p = emptyProgress();
    p.starsByLevel[1] = { normal: 1, breach: 0, containment: 0 };
    const discovery = mapDiscovery(p);
    expect(LEVELS.filter((l) => isMapLevelDiscovered(l.id, p)).map((l) => l.id)).toEqual([1, 2]);
    expect(discovery.radii[0]).toBeGreaterThan(discovery.radii[1]);
    expect(discovery.radii[1]).toBeGreaterThan(0);
  });
  it("reconstructs old saves and retains earned outposts in noncontiguous progress", () => {
    const p = emptyProgress();
    p.starsByLevel[12] = { normal: 2, breach: 0, containment: 0 };
    expect(isMapLevelDiscovered(12, p)).toBe(true);
    expect(isMapLevelDiscovered(13, p)).toBe(true);
    const target = mapDiscovery(p);
    expect(initialDiscovery(target)).toEqual(target);
  });
  it("fully lifts fog only after the entire standard campaign is cleared", () => {
    const p = emptyProgress();
    for (const level of LEVELS.slice(0, -1))
      p.starsByLevel[level.id] = { normal: 1, breach: 0, containment: 0 };
    expect(mapDiscovery(p).complete).toBe(false);
    p.starsByLevel[LEVELS.at(-1)!.id] = { normal: 1, breach: 0, containment: 0 };
    expect(mapDiscovery(p).complete).toBe(true);
  });
  it("animates newly earned ground but never leaks a previous save on reset", () => {
    const start = mapDiscovery(emptyProgress());
    const p = emptyProgress();
    p.starsByLevel[1] = { normal: 3, breach: 0, containment: 0 };
    const next = mapDiscovery(p);
    expect(initialDiscovery(next, start)).toEqual(start);
    expect(initialDiscovery(start, next)).toEqual(start);
    expect(initialDiscovery(start, { radii: start.radii.map(() => 11), complete: true })).toEqual(
      start,
    );
  });
});
