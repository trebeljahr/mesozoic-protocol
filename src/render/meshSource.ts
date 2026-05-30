import * as THREE from "three";

// GLTFLoader flattens multi-primitive nodes into multiple THREE.Mesh
// children — instancing only the first one drops the secondary parts
// (Quaternius snow trees: trunk + cap; sci-fi rocks: body + crystal;
// Kenney space-kit chassis + lights). This collector walks every Mesh
// and clones its geometry into the world frame so the caller can pass
// each part to its own InstancedMesh.

export type MeshPart = {
  geom: THREE.BufferGeometry;
  material: THREE.Material;
};

export type MeshSource = {
  parts: MeshPart[];
  // Union AABB extents in scene-local space. Kept as scalars rather than
  // the full Box3 because every caller wants a derived number, not the
  // box itself — and reading `boundingBox.max` through the Box3 has
  // crashed on mobile Safari when a malformed Box3 slips through.
  minY: number;
  maxY: number;
  // X/Z center of the visible mesh bounds in scene-local space. Some GLBs
  // ship with pivots at an edge/corner; editors expect the authored point
  // to sit under the model center.
  centerX: number;
  centerZ: number;
  // Vertical extent of the union AABB (maxY - minY, floored at a tiny
  // positive to avoid divide-by-zero downstream).
  height: number;
  // Largest axis-aligned dimension across the union — input for
  // TARGET_SIZE_BY_ROLE normalization in the cosmetic renderers.
  maxDim: number;
  // Max |x|/|z| of the union — the cylinder radius that contains the
  // model. Used by Trees/Rocks for hit discs and placement blocking.
  xzRadius: number;
};

// Keyed on the scene Object3D, not the URL: drei's useGLTF guarantees
// scene identity per URL, and the WeakMap entry GCs with the scene on
// HMR. The clones are otherwise never disposed — multiple InstanceGroups
// for the same URL would each re-clone the same geometry without this.
const cache = new WeakMap<THREE.Object3D, MeshSource>();

const collect = (scene: THREE.Object3D): MeshSource | null => {
  scene.updateMatrixWorld(true);
  const parts: MeshPart[] = [];
  const union = new THREE.Box3();
  let unionSet = false;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const geom = m.geometry.clone();
      geom.applyMatrix4(m.matrixWorld);
      geom.computeBoundingBox();
      if (geom.boundingBox) {
        if (!unionSet) {
          union.copy(geom.boundingBox);
          unionSet = true;
        } else union.union(geom.boundingBox);
      }
      parts.push({ geom, material: mat as THREE.Material });
    }
  });
  if (parts.length === 0 || !unionSet) return null;
  const size = union.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  // Read min/max through accessors that tolerate a partially-initialised
  // Box3. iOS Safari has surfaced "Cannot read properties of undefined
  // (reading 'max')" through this chain when a model finishes parsing
  // under memory pressure with a Box3 missing its .max Vector3.
  const minVec = union.min;
  const maxVec = union.max;
  const minX = minVec?.x ?? -size.x / 2;
  const maxX = maxVec?.x ?? size.x / 2;
  const minY = minVec?.y ?? 0;
  const maxY = maxVec?.y ?? size.y;
  const minZ = minVec?.z ?? -size.z / 2;
  const maxZ = maxVec?.z ?? size.z / 2;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const xzRadius = Math.max(
    Math.abs(minX - centerX),
    Math.abs(maxX - centerX),
    Math.abs(minZ - centerZ),
    Math.abs(maxZ - centerZ),
  );
  const height = Math.max(maxY - minY, 0.001);
  return { parts, minY, maxY, centerX, centerZ, height, maxDim, xzRadius };
};

export const collectMeshSource = (scene: THREE.Object3D): MeshSource | null => {
  const hit = cache.get(scene);
  if (hit) return hit;
  const src = collect(scene);
  if (src) cache.set(scene, src);
  return src;
};
