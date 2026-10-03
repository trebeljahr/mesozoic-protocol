import { useMemo } from "react";
import { previewNextWave } from "../sim/wavePreview";
import { useGame } from "../store";
export function useIncomingWave() {
  const world = useGame((s) => s.world);
  const wave = useGame((s) => s.ui.wave);
  const plannedWaves = useGame((s) => s.world.plannedWaves);
  const endlessHp = useGame((s) => s.world.endless?.hpMul);
  const trickleInterval = useGame((s) => s.world.bossTrickleIntervalMul);
  // world is mutable; these scalar/array dependencies track inputs changed by
  // wave transitions and live difficulty changes without rebuilding each tick.
  return useMemo(
    () =>
      previewNextWave({
        ...world,
        wave,
        plannedWaves,
        endless: world.endless && { ...world.endless, hpMul: endlessHp ?? world.endless.hpMul },
        bossTrickleIntervalMul: trickleInterval,
      }),
    [world, wave, plannedWaves, endlessHp, trickleInterval],
  );
}
