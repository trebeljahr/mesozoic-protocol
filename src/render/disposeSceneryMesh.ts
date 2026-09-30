import { InstancedMesh } from "three";

export function disposeSceneryMesh(mesh: InstancedMesh): void {
  // R3F assigns dispose={null} over the instance method to protect shared parts.
  // The native method releases instance buffers without disposing those parts.
  InstancedMesh.prototype.dispose.call(mesh);
}
