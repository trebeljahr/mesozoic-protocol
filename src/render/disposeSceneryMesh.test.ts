import { applyProps } from "@react-three/fiber";
import * as THREE from "three";
import { expect, it, vi } from "vitest";
import { disposeSceneryMesh } from "./disposeSceneryMesh";

it("releases instance resources with R3F disposal disabled and preserves shared parts", () => {
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, 2);
  const sibling = new THREE.InstancedMesh(geometry, material, 2);
  const releaseInstances = vi.fn();
  const releaseSibling = vi.fn();
  mesh.addEventListener("dispose", releaseInstances);
  sibling.addEventListener("dispose", releaseSibling);
  const releaseGeometry = vi.spyOn(geometry, "dispose");
  const releaseMaterial = vi.spyOn(material, "dispose");
  mesh.morphTexture = new THREE.DataTexture();
  const releaseMorphTexture = vi.spyOn(mesh.morphTexture, "dispose");

  applyProps(mesh, { dispose: null });
  expect(mesh.dispose).toBeNull();
  disposeSceneryMesh(mesh);

  expect(releaseInstances).toHaveBeenCalledTimes(1);
  expect(releaseMorphTexture).toHaveBeenCalledTimes(1);
  expect(mesh.morphTexture).toBeNull();
  expect(releaseGeometry).not.toHaveBeenCalled();
  expect(releaseMaterial).not.toHaveBeenCalled();
  expect(releaseSibling).not.toHaveBeenCalled();
});
