import { LEVELS, levelHasMode } from "./levels";
import { isLevelUnlocked, isModeUnlocked, type ProgressData } from "./progress";

export function outpostActivation(
  id: number,
  progress: ProgressData,
): "locked" | "picker" | "normal" {
  const level = LEVELS.find((entry) => entry.id === id);
  if (!level || !isLevelUnlocked(id, progress)) return "locked";
  return (["breach", "containment"] as const).some(
    (mode) => levelHasMode(level, mode) && isModeUnlocked(progress, id, mode),
  )
    ? "picker"
    : "normal";
}
