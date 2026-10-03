import { saveSlot } from "../progress";
import { useGame } from "../store";
import { canPersistWorld, isBetweenWaves } from "./missionCheckpoint";
import { checkpointMission, finishMission, hasMissionSession } from "./missionPersistence";

/** Commit current rewards and their mission world together before closing or updating. */
export const persistActiveSave = (): boolean => {
  const state = useGame.getState();
  if (state.activeSlot === null || state.tutorial !== null || !canPersistWorld(state.world))
    return true;
  if (hasMissionSession(state.world)) {
    if (state.world.status === "won" || state.world.status === "lost")
      return finishMission(state.world, state.progress);
    // Combat resumes from the last complete between-wave transaction. Saving
    // newer rewards alone would pair them with an older world on restart.
    if (!isBetweenWaves(state.world)) return true;
    return checkpointMission(
      state.world,
      state.progress,
      state.runMinDifficulty ?? state.progress.difficulty,
      true,
    );
  }
  return saveSlot(state.activeSlot, state.progress);
};
