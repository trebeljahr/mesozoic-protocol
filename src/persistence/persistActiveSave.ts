import { saveSlot } from "../progress";
import { useGame } from "../store";
import { canPersistWorld } from "./missionCheckpoint";
import { checkpointMission, hasMissionSession } from "./missionPersistence";

/** Commit current rewards and their mission world together before closing or updating. */
export const persistActiveSave = (): boolean => {
  const state = useGame.getState();
  if (state.activeSlot === null || state.tutorial !== null || !canPersistWorld(state.world))
    return true;
  if (hasMissionSession(state.world))
    return checkpointMission(
      state.world,
      state.progress,
      state.runMinDifficulty ?? state.progress.difficulty,
      true,
    );
  return saveSlot(state.activeSlot, state.progress);
};
