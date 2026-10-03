import { usePresentation } from "../preferences";
import { useMediaQuery } from "./useMediaQuery";

export const useReducedMotion = (): boolean => {
  const motion = usePresentation((s) => s.preferences.motion);
  const system = useMediaQuery("(prefers-reduced-motion: reduce)");
  return motion === "reduced" || (motion === "system" && system);
};
