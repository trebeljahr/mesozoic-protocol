import { GodRaysEffect } from "postprocessing";
import * as THREE from "three";
import { expect, it, vi } from "vitest";
import { disposePrimitiveEffect } from "./disposePrimitiveEffect";

it("releases nested effect resources despite a primitive's null dispose property", () => {
  const sun = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshBasicMaterial());
  const effect = new GodRaysEffect(new THREE.PerspectiveCamera(), sun);
  const releaseBlur = vi.spyOn(effect.blurPass, "dispose");
  const releaseSunMaterial = vi.spyOn(sun.material, "dispose");
  Object.defineProperty(effect, "dispose", { value: null, writable: true });
  disposePrimitiveEffect(effect);
  expect(releaseBlur).toHaveBeenCalledTimes(1);
  expect(releaseSunMaterial).not.toHaveBeenCalled();
});
