// Per-enemy render-side transform published by ModelEnemyMesh each frame.
// Aura / halo / badge / eye renderers read from here so they track the
// smoothed, bobbed, yawed mesh pose instead of jumping to the raw sim
// position one tick ahead. Cleared when a mesh is pooled, despawned, or
// the world swaps.

export type EnemyRenderTransform = {
  // Smoothed body-center XZ in world space (matches the rendered skeleton's
  // centroid, not the sim `e.pos`).
  x: number;
  z: number;
  // Smoothed world-Y of the obj root — includes the resting lift
  // (`-scaledMinY`), bob, and any pose-driven dip. Decoration renderers
  // that want their own y-offset add to this rather than re-deriving it.
  y: number;
  // Vertical bob offset applied to the mesh this frame. Decorations add
  // this to their own base height so they ride the same up/down as the
  // model rather than hovering still while the dino bounces.
  bobY: number;
  // Rendered yaw (baseRotY + smoothed visYaw). Used by eye / decoration
  // renderers that have anchor offsets in body-local space and need to
  // rotate them into world space without owning the smoothing pass.
  yaw: number;
};

const map = new Map<number, EnemyRenderTransform>();

export const setEnemyRender = (id: number, t: EnemyRenderTransform): void => {
  let cur = map.get(id);
  if (!cur) {
    cur = { x: t.x, z: t.z, y: t.y, bobY: t.bobY, yaw: t.yaw };
    map.set(id, cur);
    return;
  }
  cur.x = t.x;
  cur.z = t.z;
  cur.y = t.y;
  cur.bobY = t.bobY;
  cur.yaw = t.yaw;
};

export const getEnemyRender = (id: number): EnemyRenderTransform | undefined => map.get(id);

export const clearEnemyRender = (id: number): void => {
  map.delete(id);
};

export const clearAllEnemyRender = (): void => {
  map.clear();
};
