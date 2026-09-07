import { describe, expect, it } from "vitest";
import {
  clampPropScale,
  MAX_PROP_SCALE,
  MIN_PROP_SCALE,
  normalizeYaw,
  sanitizePlacedProps,
} from "./propTransform";
import type { PlacedProp } from "./types";

const prop = (over: Partial<PlacedProp> = {}): PlacedProp => ({
  id: "a",
  url: "/models/tree.glb",
  pos: { x: 0, y: 0 },
  scale: 1,
  rot: 0,
  blocks: true,
  ...over,
});

describe("clampPropScale", () => {
  it("clamps to the authored bounds", () => {
    expect(clampPropScale(0)).toBe(MIN_PROP_SCALE);
    expect(clampPropScale(999)).toBe(MAX_PROP_SCALE);
    expect(clampPropScale(2.5)).toBe(2.5);
  });
});

describe("normalizeYaw", () => {
  it("wraps into [0, 2π)", () => {
    expect(normalizeYaw(0)).toBe(0);
    expect(normalizeYaw(Math.PI * 2)).toBe(0);
    expect(normalizeYaw(-Math.PI / 2)).toBeCloseTo((Math.PI * 3) / 2);
    expect(normalizeYaw(Math.PI * 5)).toBeCloseTo(Math.PI);
  });

  it("falls back to 0 for non-finite input", () => {
    expect(normalizeYaw(Number.NaN)).toBe(0);
    expect(normalizeYaw(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("sanitizePlacedProps", () => {
  it("round-trips authored scale and rotation untouched", () => {
    const yaw = Math.PI / 4;
    const [p] = sanitizePlacedProps([prop({ scale: 1.75, rot: yaw })]);
    expect(p.scale).toBe(1.75);
    expect(p.rot).toBeCloseTo(yaw);
  });

  it("defaults legacy props missing scale/rot to the identity transform", () => {
    // Blobs authored before the fields were editable — undefined would reach
    // the instancer as NaN and collapse the whole batch.
    const legacy = { id: "a", url: "/models/tree.glb", pos: { x: 1, y: 2 }, blocks: true };
    const [p] = sanitizePlacedProps([legacy as PlacedProp]);
    expect(p.scale).toBe(1);
    expect(p.rot).toBe(0);
    expect(p.pos).toEqual({ x: 1, y: 2 });
  });

  it("clamps out-of-range scale and wraps out-of-range rotation", () => {
    const [p] = sanitizePlacedProps([prop({ scale: 40, rot: -Math.PI })]);
    expect(p.scale).toBe(MAX_PROP_SCALE);
    expect(p.rot).toBeCloseTo(Math.PI);
  });
});
