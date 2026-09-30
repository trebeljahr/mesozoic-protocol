import type * as THREE from "three";

// Coarse tiles keep nearby instances together without one draw per object.
// Geometry bounds, not tile edges, determine visibility (including overhangs).
export const SCENERY_CELL_SIZE = 16;
export function partitionScenery<T>(items: T[], position: (item: T) => { x: number; y: number }) {
  // Small variant groups cost more in extra submissions than they save.
  if (items.length <= 16) return items.length ? [{ key: "all", items }] : [];
  const cells = new Map<string, T[]>();
  for (const item of items) {
    const p = position(item);
    const key = `${Math.floor(p.x / SCENERY_CELL_SIZE)},${Math.floor(p.y / SCENERY_CELL_SIZE)}`;
    const cell = cells.get(key);
    if (cell) cell.push(item);
    else cells.set(key, [item]);
  }
  return Array.from(cells, ([key, items]) => ({ key, items }));
}

export function updateSceneryBounds(mesh: THREE.InstancedMesh) {
  mesh.instanceMatrix.needsUpdate = true;
  // Recompute after both growth and removal; Three caches these otherwise.
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
}
