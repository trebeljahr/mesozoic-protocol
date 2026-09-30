import * as THREE from "three";
import { lakeRadius } from "../lakeShape";

// Undeformed UVs retain radial depth coordinates for the shader fallback.
export function makeLakeGeometry(ring = false) {
  const geo = ring ? new THREE.RingGeometry(0.97, 1, 128) : new THREE.CircleGeometry(1, 128);
  const positions = geo.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i);
    const radius = lakeRadius(Math.atan2(y, x));
    positions.setXY(i, x * radius, y * radius);
  }
  geo.setAttribute("aFlow", new THREE.BufferAttribute(new Float32Array(positions.count * 2), 2));
  geo.computeBoundingSphere();
  return geo;
}
