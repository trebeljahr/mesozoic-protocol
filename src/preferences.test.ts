import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PRESENTATION,
  detectGraphicsQuality,
  normalizePresentation,
  PRESENTATION_KEY,
  QUALITY_SETTINGS,
  usePresentation,
} from "./preferences";

afterEach(() => {
  vi.unstubAllGlobals();
  usePresentation.setState({ preferences: { ...DEFAULT_PRESENTATION }, storageFailed: false });
});

describe("presentation preferences", () => {
  it("recovers unknown and damaged values without discarding valid options", () => {
    expect(normalizePresentation(null)).toEqual(DEFAULT_PRESENTATION);
    expect(
      normalizePresentation({ graphics: "ultra", motion: "reduced", cameraShake: false }),
    ).toEqual({
      graphics: "auto",
      motion: "reduced",
      cameraShake: false,
    });
    expect(normalizePresentation({ graphics: "low", motion: 3, cameraShake: "false" })).toEqual({
      graphics: "low",
      motion: "system",
      cameraShake: true,
    });
  });

  it("keeps conservative auto detection and distinct render budgets", () => {
    expect(detectGraphicsQuality(16, true, false)).toBe("low");
    expect(detectGraphicsQuality(16, false, true)).toBe("low");
    expect(detectGraphicsQuality(4, false, false)).toBe("low");
    expect(detectGraphicsQuality(6, false, false)).toBe("medium");
    expect(detectGraphicsQuality(8, false, false)).toBe("high");
    expect(QUALITY_SETTINGS.low.dpr).toBeLessThan(QUALITY_SETTINGS.medium.dpr);
    expect(QUALITY_SETTINGS.medium.samples).toBeLessThan(QUALITY_SETTINGS.high.samples);
  });

  it("applies a preference even when storage fails, then clears the warning after a successful retry", () => {
    const write = vi.fn().mockImplementationOnce(() => {
      throw new Error("quota");
    });
    vi.stubGlobal("window", { localStorage: { setItem: write } });
    usePresentation.getState().update({ graphics: "low" });
    expect(usePresentation.getState().preferences.graphics).toBe("low");
    expect(usePresentation.getState().storageFailed).toBe(true);
    usePresentation.getState().update({ cameraShake: false });
    expect(usePresentation.getState().storageFailed).toBe(false);
    expect(JSON.parse(write.mock.calls[1][1])).toEqual({
      graphics: "low",
      motion: "system",
      cameraShake: false,
    });
    expect(write.mock.calls[1][0]).toBe(PRESENTATION_KEY);
  });
});
