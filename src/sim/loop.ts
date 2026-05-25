import { updateBase } from "./base";
import { updateDefensive } from "./defensive";
import {
  updateBeams,
  updateCryoWaves,
  updateExplosions,
  updateParticles,
  updatePuffs,
  updateShake,
} from "./effects";
import { updateEnemies } from "./enemies";
import { updateProjectiles } from "./projectiles";
import { updateRobot } from "./robot";
import { checkRunEnd, spawnerTick } from "./spawner";
import { updateTowers } from "./towers";
import type { World } from "./types";
import { updateCoalEmbers, updateEasterEggs, updateRobotCraters } from "./world";

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
const MAX_FRAME_DT = 0.25;

export class Engine {
  private accumulator = 0;
  private lastRealTime: number | null = null;

  reset() {
    this.accumulator = 0;
    this.lastRealTime = null;
  }

  step(world: World, realTimeSec: number) {
    if (this.lastRealTime === null) {
      this.lastRealTime = realTimeSec;
      return;
    }
    if (world.status !== "running") {
      this.lastRealTime = realTimeSec;
      this.accumulator = 0;
      return;
    }
    const frameDt = Math.min(realTimeSec - this.lastRealTime, MAX_FRAME_DT);
    this.lastRealTime = realTimeSec;
    this.accumulator += frameDt;
    while (this.accumulator >= TICK_DT) {
      this.tick(world);
      this.accumulator -= TICK_DT;
    }
  }

  private tick(world: World) {
    world.time += TICK_DT;
    world.tickCount += 1;
    spawnerTick(world, TICK_DT);
    updateEnemies(world, TICK_DT);
    updateRobot(world, TICK_DT);
    updateDefensive(world, TICK_DT);
    updateTowers(world, TICK_DT);
    updateBase(world, TICK_DT);
    updateProjectiles(world, TICK_DT);
    updateBeams(world);
    updateExplosions(world);
    updateCryoWaves(world);
    updateCoalEmbers(world, TICK_DT);
    updateRobotCraters(world, TICK_DT);
    updateParticles(world, TICK_DT);
    updatePuffs(world, TICK_DT);
    updateShake(world, TICK_DT);
    updateEasterEggs(world, TICK_DT);
    checkRunEnd(world, TICK_DT);
  }
}
