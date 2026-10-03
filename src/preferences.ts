import { create } from "zustand";

export type GraphicsQuality = "low" | "medium" | "high";
export type GraphicsPreference = GraphicsQuality | "auto";
export type MotionPreference = "system" | "reduced" | "full";
export type PresentationPreferences = {
  graphics: GraphicsPreference;
  motion: MotionPreference;
  cameraShake: boolean;
};

export const PRESENTATION_KEY = "mesozoic-protocol:presentation:v1";
export const DEFAULT_PRESENTATION: PresentationPreferences = {
  graphics: "auto",
  motion: "system",
  cameraShake: true,
};

export const normalizePresentation = (raw: unknown): PresentationPreferences => {
  const value = raw && typeof raw === "object" ? (raw as Partial<PresentationPreferences>) : {};
  return {
    graphics:
      value.graphics === "low" || value.graphics === "medium" || value.graphics === "high"
        ? value.graphics
        : "auto",
    motion: value.motion === "reduced" || value.motion === "full" ? value.motion : "system",
    cameraShake: typeof value.cameraShake === "boolean" ? value.cameraShake : true,
  };
};

const readPresentation = (): PresentationPreferences => {
  try {
    return normalizePresentation(
      JSON.parse(window.localStorage.getItem(PRESENTATION_KEY) ?? "null"),
    );
  } catch {
    return { ...DEFAULT_PRESENTATION };
  }
};

export const detectGraphicsQuality = (
  cores = typeof navigator === "undefined" ? 6 : (navigator.hardwareConcurrency ?? 8),
  mobile = typeof navigator !== "undefined" &&
    /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent),
  coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
): GraphicsQuality => (mobile || coarse || cores <= 4 ? "low" : cores >= 8 ? "high" : "medium");

export const qualityForPreference = (choice: GraphicsPreference): GraphicsQuality =>
  choice === "auto" ? detectGraphicsQuality() : choice;

export const QUALITY_SETTINGS: Record<
  GraphicsQuality,
  { dpr: number; samples: number; shadows: boolean }
> = {
  low: { dpr: 1, samples: 0, shadows: false },
  medium: { dpr: 1.5, samples: 2, shadows: true },
  high: { dpr: 2, samples: 4, shadows: true },
};

export const usePresentation = create<{
  preferences: PresentationPreferences;
  storageFailed: boolean;
  update: (patch: Partial<PresentationPreferences>) => void;
}>((set, get) => ({
  preferences: readPresentation(),
  storageFailed: false,
  update: (patch) => {
    const preferences = normalizePresentation({ ...get().preferences, ...patch });
    let storageFailed = false;
    try {
      window.localStorage.setItem(PRESENTATION_KEY, JSON.stringify(preferences));
    } catch {
      storageFailed = true;
    }
    set({ preferences, storageFailed });
  },
}));

// Render trees remount when the resolved preset changes; simulation state stays
// in the game store. Every allocation reads the current preset at mount time.
export const getGraphicsQuality = (): GraphicsQuality =>
  qualityForPreference(usePresentation.getState().preferences.graphics);
