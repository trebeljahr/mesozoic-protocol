import { sessionPause } from "../sessionPause";
import type { World } from "./types";

export type SimulationSpeed = 1 | 2;
// Training owns its pace and action gates. Keep this structural check compatible
// with hosts that load training separately from the campaign store.
export const isTrainingSession = (world: World) =>
  "sessionKind" in world && world.sessionKind === "tutorial";

export const effectiveSimulationSpeed = (
  world: World,
  requested: SimulationSpeed,
): SimulationSpeed => (!isTrainingSession(world) && requested === 2 ? 2 : 1);

export type BattleAccess = {
  world: World;
  screen: string;
  levelIntroVisible: boolean;
  newEnemyQueue: readonly unknown[];
  difficultyPickerOpen: boolean;
  compendiumOpen: boolean;
  achievementsOpen: boolean;
  creditsOpen: boolean;
  robotShopOpen: boolean;
  skillTreeOpen: boolean;
};

export const canUseBattlefield = (s: BattleAccess) =>
  s.screen === "playing" &&
  sessionPause.canAutoResume(s.world) &&
  s.world.status === "running" &&
  !s.levelIntroVisible &&
  s.newEnemyQueue.length === 0 &&
  !s.difficultyPickerOpen &&
  !s.compendiumOpen &&
  !s.achievementsOpen &&
  !s.creditsOpen &&
  !s.robotShopOpen &&
  !s.skillTreeOpen;
