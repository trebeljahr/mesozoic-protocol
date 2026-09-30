import { Object3D, Vector3 } from "three";
import { expect, it } from "vitest";
import { setGroundedTransform } from "./groundedTransform";

it("keeps off-centre model pivots grounded at their clearance position at every yaw", () => {
  const source = { centerX: 3.7, centerZ: -2.2, minY: -0.8 };
  const pos = { x: 12, y: -7 };
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.83]) {
    for (const scale of [0.2, 1, 2.5]) {
      const object = new Object3D();
      setGroundedTransform(object, source, pos, yaw, scale);
      const ground = new Vector3(source.centerX, source.minY, source.centerZ).applyMatrix4(
        object.matrix,
      );
      expect(ground.x).toBeCloseTo(pos.x, 10);
      expect(ground.y).toBeCloseTo(0, 10);
      expect(ground.z).toBeCloseTo(-pos.y, 10);
    }
  }
});
