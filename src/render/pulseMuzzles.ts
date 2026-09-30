import * as THREE from "three";
import type { Tower } from "../sim/types";

// Render-only anchors; old worlds and sold towers can be garbage collected.
export const pulseMuzzles = new WeakMap<Tower, THREE.Vector3>();

export function findPulseMuzzle(scene: THREE.Object3D): THREE.Vector3 {
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene);
  const front = new THREE.Box3();
  const point = new THREE.Vector3();
  const inverseRoot = scene.matrixWorld.clone().invert();
  // The pulse model points along +Z. Sample its front face so the flash
  // follows the actual barrel height rather than the tower's centre.
  const threshold = bounds.max.z - (bounds.max.z - bounds.min.z) * 0.015;
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const positions = mesh.geometry.getAttribute("position");
    if (!positions) return;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      if (point.z >= threshold) front.expandByPoint(point);
    }
  });
  front.getCenter(point);
  point.z = bounds.max.z + 0.02;
  return point.applyMatrix4(inverseRoot);
}
