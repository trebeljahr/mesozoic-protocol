import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { partitionScenery, updateSceneryBounds } from "./sceneryBounds";

const geometry = new THREE.BoxGeometry(4, 8, 4);
function meshAt(points: { x: number; y: number }[]) {
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), points.length);
  points.forEach((p, i) => mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, 4, -p.y)));
  updateSceneryBounds(mesh);
  mesh.updateMatrixWorld();
  return mesh;
}
function cameraAt(x: number, z: number, span: number) {
  const camera = new THREE.OrthographicCamera(-span, span, span, -span, 0.1, 200);
  camera.position.set(x, 70, z);
  camera.lookAt(x, 0, z);
  camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  return frustum;
}
describe("scenery batch visibility", () => {
  it("retains every item exactly once, including negative coordinates and cell edges", () => {
    const points = Array.from({ length: 80 }, (_, i) => ({ x: i - 40, y: (i % 4) - 2 }));
    const cells = partitionScenery(points, (p) => p);
    expect(new Set(cells.flatMap((c) => c.items))).toEqual(new Set(points));
    expect(partitionScenery(points.slice(0, 8), (p) => p)).toHaveLength(1);
    expect(partitionScenery([], (p: { x: number; y: number }) => p)).toEqual([]);
  });
  it("refreshes translated, rotated and scaled bounds after moves and removals", () => {
    const mesh = meshAt([
      { x: 100, y: 100 },
      { x: -100, y: -100 },
    ]);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(160, 4, -80),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7),
      new THREE.Vector3(2, 3, 2),
    );
    mesh.setMatrixAt(0, matrix);
    mesh.count = 1;
    updateSceneryBounds(mesh);
    const box = geometry.boundingBox!.clone().applyMatrix4(matrix);
    expect(mesh.boundingBox!.min.distanceTo(box.min)).toBeLessThan(1e-5);
    expect(mesh.boundingBox!.max.distanceTo(box.max)).toBeLessThan(1e-5);
    for (const x of [-2, 2])
      for (const y of [-4, 4])
        for (const z of [-2, 2]) {
          const vertex = new THREE.Vector3(x, y, z).applyMatrix4(matrix);
          expect(mesh.boundingSphere!.distanceToPoint(vertex)).toBeLessThanOrEqual(1e-5);
        }
    const ray = new THREE.Raycaster(new THREE.Vector3(160, 60, -80), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
    expect(cameraAt(-100, 100, 10).intersectsObject(mesh)).toBe(false);
  });
  it("preserves overhangs at camera edges and independently visible shadow casters", () => {
    const mesh = meshAt([{ x: 11, y: 0 }]);
    expect(cameraAt(0, 0, 10).intersectsObject(mesh)).toBe(true);
    const offscreen = meshAt([{ x: 40, y: 0 }]);
    expect(cameraAt(0, 0, 10).intersectsObject(offscreen)).toBe(false);
    expect(cameraAt(40, 0, 15).intersectsObject(offscreen)).toBe(true);
    expect(offscreen.visible).toBe(true);
  });
  it("keeps every individually visible instance in angled battle and light views", () => {
    const points = Array.from({ length: 160 }, (_, i) => ({
      x: (i % 20) * 4 - 40,
      y: Math.floor(i / 20) * 5 - 20,
    }));
    const cells = partitionScenery(points, (p) => p);
    for (const [x, y, z, span] of [
      [0, 24, 20, 28],
      [18, 24, 30, 10],
      [-18, 24, 10, 10],
      [14, 26, 10, 24],
    ]) {
      const camera = new THREE.OrthographicCamera(-span, span, span, -span, 1, 90);
      camera.position.set(x, y, z);
      camera.lookAt(x === 14 ? 0 : x, 0, x === 14 ? 0 : z - 20);
      camera.updateMatrixWorld();
      const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
      for (const cell of cells) {
        const batch = meshAt(cell.items);
        for (const point of cell.items) {
          if (frustum.intersectsObject(meshAt([point])))
            expect(frustum.intersectsObject(batch)).toBe(true);
        }
      }
    }
  });
  it("reduces submitted instances at close zoom while retaining all geometry at wide zoom", () => {
    const points = Array.from({ length: 750 }, (_, i) => ({
      x: (i % 30) * 3 - 45,
      y: Math.floor(i / 30) * 3 - 36,
    }));
    const meshes = partitionScenery(points, (p) => p).map((c) => meshAt(c.items));
    const counters = (frustum: THREE.Frustum) => {
      const visible = meshes.filter((m) => frustum.intersectsObject(m));
      return { calls: visible.length, instances: visible.reduce((n, m) => n + m.count, 0) };
    };
    const close = counters(cameraAt(28, -20, 10));
    const wide = counters(cameraAt(0, 0, 100));
    expect(close.instances).toBeLessThan(750 / 2);
    expect(wide.instances).toBe(750);
    console.info("Synthetic 750-instance submission estimate (one geometry part)", {
      uncullled: { calls: 1, instances: 750 },
      close,
      wide,
    });
  });
});
