import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { describe, expect, it, vi } from "vitest";
import { disposeModelInstance } from "./disposeModelInstance";

describe("disposeModelInstance", () => {
  it("releases each clone's skeleton and owned material while preserving cached assets", () => {
    const geometry = new THREE.BufferGeometry();
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const source = new THREE.Group();
    const bone = new THREE.Bone();
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    source.add(mesh);
    const cachedDisposals = [geometry, texture, material, mesh.skeleton].map((resource) =>
      vi.spyOn(resource, "dispose"),
    );
    for (let cycle = 0; cycle < 4; cycle++) {
      const instance = clone(source);
      const skin = instance.children[0] as THREE.SkinnedMesh;
      skin.skeleton.computeBoneTexture();
      const boneTexture = skin.skeleton.boneTexture!;
      const textureDisposed = vi.spyOn(boneTexture, "dispose");
      const ownedMaterial = material.clone();
      skin.material = [ownedMaterial, material, ownedMaterial];
      const materialDisposed = vi.spyOn(ownedMaterial, "dispose");
      disposeModelInstance(instance, source);
      expect(textureDisposed).toHaveBeenCalledTimes(1);
      expect(materialDisposed).toHaveBeenCalledTimes(1);
      expect(skin.skeleton.boneTexture).toBeNull();
    }
    for (const dispose of cachedDisposals) expect(dispose).not.toHaveBeenCalled();
  });

  it("does not dispose a skeleton shared by a plain Object3D clone", () => {
    const source = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    source.bind(new THREE.Skeleton());
    const dispose = vi.spyOn(source.skeleton, "dispose");
    disposeModelInstance(source.clone(), source);
    expect(dispose).not.toHaveBeenCalled();
  });
});
