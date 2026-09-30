import { useFrame } from "@react-three/fiber";
import { useGame } from "../store";
import { SIMULATION_FRAME_PRIORITY } from "./playFrameOrder";

export const SimTicker = () => {
  useFrame(() => {
    useGame.getState().tick(performance.now() / 1000);
  }, SIMULATION_FRAME_PRIORITY);
  return null;
};
