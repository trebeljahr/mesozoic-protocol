import { describe, expect, it } from "vitest";
import { emptyProgress, recordLevelResult } from "../progress";
import {
  ABS_MAX_ZOOM,
  computeFitZoom,
  computeOutpostFocus,
  findCurrentLevelIndex,
  MAX_ZOOM_MULT,
  restoreMapView,
} from "./worldMapFocus";
import { mapLevelPosition } from "./worldMapLayout";

describe("outpost camera entry", () => {
  it.each([
    [1440, 900],
    [2560, 1080],
    [844, 390],
  ])("frames the fresh frontier at %sx%s", (width, height) => {
    const frontier = findCurrentLevelIndex(emptyProgress());
    const fit = computeFitZoom(width, height);
    const max = Math.min(ABS_MAX_ZOOM, fit * MAX_ZOOM_MULT);
    const focus = computeOutpostFocus(frontier, fit, max, width, height)!;
    expect(frontier).toBe(0);
    expect(focus.targetX).toBe(mapLevelPosition(1).x);
    expect(Math.abs(focus.targetZ + mapLevelPosition(1).y)).toBeLessThan(4);
    expect(focus.zoom).toBeGreaterThan(fit);
    expect(focus.zoom).toBeLessThanOrEqual(max);
  });
  it("preserves user pan and zoom until the frontier changes", () => {
    const saved = { frontier: 0, targetX: 7, targetZ: 5, zoom: 30 };
    expect(restoreMapView(saved, 0, 10, 42)).toEqual({ targetX: 7, targetZ: 5, zoom: 30 });
    const frontier = findCurrentLevelIndex(recordLevelResult(emptyProgress(), 1, "normal", 1));
    expect(frontier).toBe(1);
    expect(restoreMapView(saved, frontier, 10, 42)).toBeNull();
    expect(restoreMapView(saved, 0, 10, 25)?.zoom).toBe(25);
  });
});
