import type * as THREE from "three";

// SkeletonUtils clones skeletons but shares asset geometry and textures.
// Materials may be shared or cloned by the caller. Dispose only instance-owned
// resources; the loader cache and other instances still use the source assets.
export const disposeModelInstance = (instance: THREE.Object3D, source: THREE.Object3D): void => {
  const sharedMaterials = new Set<THREE.Material>();
  const sharedSkeletons = new Set<THREE.Skeleton>();
  source.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.material) for (const material of [mesh.material].flat()) sharedMaterials.add(material);
    if (mesh.skeleton) sharedSkeletons.add(mesh.skeleton);
  });
  const materials = new Set<THREE.Material>();
  const skeletons = new Set<THREE.Skeleton>();
  instance.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.material) for (const material of [mesh.material].flat()) materials.add(material);
    if (mesh.skeleton) skeletons.add(mesh.skeleton);
  });
  for (const material of materials) if (!sharedMaterials.has(material)) material.dispose();
  for (const skeleton of skeletons) if (!sharedSkeletons.has(skeleton)) skeleton.dispose();
};
