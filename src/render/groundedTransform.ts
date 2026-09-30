import type { Object3D } from "three";
import type { Vec2 } from "../sim/types";

/** Put the model's ground centre at the checked simulation position. */
export const setGroundedTransform = (
  object: Object3D,
  source: { centerX: number; centerZ: number; minY: number },
  pos: Vec2,
  yaw: number,
  scale: number,
): void => {
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  // Three's positive Y rotation maps +X toward -Z, not +Z.
  const x = (source.centerX * c + source.centerZ * s) * scale;
  const z = (-source.centerX * s + source.centerZ * c) * scale;
  object.position.set(pos.x - x, -source.minY * scale, -pos.y - z);
  object.rotation.set(0, yaw, 0);
  object.scale.setScalar(scale);
  object.updateMatrix();
};
