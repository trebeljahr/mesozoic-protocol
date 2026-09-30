import { useFrame } from "@react-three/fiber";
import { createContext, type ReactNode, useContext, useState } from "react";
import { useGame } from "../store";
import { EnemyRenderPartition } from "./enemyRenderPartition";
import { ENEMY_PARTITION_FRAME_PRIORITY } from "./playFrameOrder";

const PartitionContext = createContext<EnemyRenderPartition | null>(null);

export const EnemyRenderPartitionProvider = ({ children }: { children: ReactNode }) => {
  const [partition] = useState(() => new EnemyRenderPartition());
  // Refresh after SimTicker and before mesh/decoration updates. Never key
  // freshness to world.time: paused frames, editor mutations,
  // retries and multiple simulation steps can all share a timestamp.
  useFrame(() => {
    partition.refresh(useGame.getState().world);
  }, ENEMY_PARTITION_FRAME_PRIORITY);
  return <PartitionContext.Provider value={partition}>{children}</PartitionContext.Provider>;
};

export const useEnemyRenderPartition = (): EnemyRenderPartition => {
  const partition = useContext(PartitionContext);
  if (!partition) throw new Error("ModelEnemyMesh requires EnemyRenderPartitionProvider");
  return partition;
};
