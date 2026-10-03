import {
  type Difficulty,
  getSlotRevision,
  type ProgressData,
  type SlotId,
  saveSlot,
} from "../progress";
import type { World } from "../sim/types";
import { canPersistWorld, captureCheckpoint, type MissionCheckpoint } from "./missionCheckpoint";

type Session = { slot: SlotId; wave: number; time: number; revision: number };
const sessions = new WeakMap<World, Session>();

export const hasMissionSession = (world: World) => sessions.has(world);
export const detachMission = (world: World) => {
  sessions.delete(world);
};

export const beginMission = (
  slot: SlotId | null,
  world: World,
  progress: ProgressData,
  checkpoint?: MissionCheckpoint,
) => {
  if (slot === null || !canPersistWorld(world)) return;
  sessions.set(world, { slot, wave: -1, time: -1, revision: getSlotRevision(slot) });
  if (!checkpoint) checkpointMission(world, progress, progress.difficulty, true);
};

export const checkpointMission = (
  world: World,
  progress: ProgressData,
  minDifficulty: Difficulty,
  force = false,
): boolean => {
  const session = sessions.get(world);
  if (!session || !canPersistWorld(world)) return false;
  if (session.revision !== getSlotRevision(session.slot)) {
    detachMission(world);
    return false;
  }
  if (!force && session.wave === world.wave && world.time - session.time < 1) return false;
  const checkpoint = captureCheckpoint(world, progress.difficulty, minDifficulty);
  if (!checkpoint) return false;
  session.wave = world.wave;
  session.time = world.time;
  return saveSlot(session.slot, progress, undefined, checkpoint);
};

// Terminal progress and removal of the checkpoint are one atomic slot write.
// If it fails, keep the session alive and the retry warning visible. A reload
// then restores the previous transaction, never old combat plus new rewards.
export const finishMission = (world: World, progress: ProgressData): boolean => {
  const session = sessions.get(world);
  if (!canPersistWorld(world)) return true;
  if (!session) return true;
  if (session.revision !== getSlotRevision(session.slot)) {
    detachMission(world);
    return true;
  }
  if (!saveSlot(session.slot, progress, undefined, null)) return false;
  sessions.delete(world);
  return true;
};
