import { describe, expect, it } from "vitest";
import { MAP_HEIGHT, MAP_WIDTH, PATH_ENTRY_MARGIN_X, PATH_ENTRY_MARGIN_Y } from "../level";
import { LEVELS } from "../levels";
import {
  BATTLE_MAX_POLAR,
  BATTLE_MIN_POLAR,
  CAMERA_BASE_POSITION,
  computeFitZoom,
  computeMaxPathExtents,
  TILT_HALF_FACTOR,
} from "./cameraFraming";

describe("battle camera framing", () => {
  it("fits every authored route and the gameplay rectangle across desktop and phone viewports", () => {
    for (const [width, height] of [
      [1440, 900],
      [2560, 1080],
      [390, 844],
      [844, 390],
    ]) {
      for (const level of LEVELS) {
        const extents = computeMaxPathExtents(level.paths);
        const zoom = computeFitZoom(width, height, extents);
        const halfX = width / (2 * zoom);
        const halfZ = (TILT_HALF_FACTOR * height) / zoom;
        expect(halfX + 1e-8).toBeGreaterThanOrEqual(
          Math.max(MAP_WIDTH / 2 + PATH_ENTRY_MARGIN_X, extents.x),
        );
        const margin = width <= 720 || height <= 500 ? PATH_ENTRY_MARGIN_Y + 1.5 : 4.5;
        expect(halfZ + 1e-8).toBeGreaterThanOrEqual(Math.max(MAP_HEIGHT / 2 + margin, extents.z));
      }
    }
  });
  it("starts inside the orbit limits and derives projection from the actual elevation", () => {
    const angle = Math.atan2(CAMERA_BASE_POSITION[2], CAMERA_BASE_POSITION[1]);
    expect(angle).toBeGreaterThan(BATTLE_MIN_POLAR);
    expect(angle).toBeLessThan(BATTLE_MAX_POLAR);
    expect(TILT_HALF_FACTOR).toBeCloseTo(0.5 / Math.cos(angle), 12);
  });
});
