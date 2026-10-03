import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useGame } from "../store";

// Mounted with the last deferred scene group. The timeout runs after R3F's
// current frame, so the load cover leaves only after a complete render.
export const LevelSceneReady = () => {
  const world = useGame((s) => s.world);
  const markReady = useGame((s) => s.markLevelSceneReady);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFrame(() => {
    if (timer.current !== null) return;
    timer.current = setTimeout(() => markReady(world), 0);
  });

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return null;
};
