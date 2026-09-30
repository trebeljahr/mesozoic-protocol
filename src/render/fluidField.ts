import * as THREE from "three";
import type { Vec2 } from "../sim/types";

export type FluidRibbon = { points: Vec2[]; width: number };
export type FluidLake = { x: number; y: number; rx: number; ry: number; rot: number };

// A small, CPU-built union field keeps internal ribbon/lake edges out of the
// shoreline shading. No screen-depth pass, per-frame allocations, or changes
// to the gameplay outlines. R = bank distance, GB = downstream direction.
export function buildFluidField(rivers: FluidRibbon[], lakes: FluidLake[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const expand = (x: number, y: number, r: number) => {
    minX = Math.min(minX, x - r);
    minY = Math.min(minY, y - r);
    maxX = Math.max(maxX, x + r);
    maxY = Math.max(maxY, y + r);
  };
  for (const r of rivers) for (const p of r.points) expand(p.x, p.y, r.width);
  for (const l of lakes) expand(l.x, l.y, Math.max(l.rx, l.ry));
  if (!Number.isFinite(minX)) {
    minX = minY = 0;
    maxX = maxY = 1;
  }
  minX -= 1;
  minY -= 1;
  maxX += 1;
  maxY += 1;
  const sx = maxX - minX;
  const sy = maxY - minY;
  const width = Math.min(512, Math.max(16, Math.ceil(sx / 0.12)));
  const height = Math.min(512, Math.max(16, Math.ceil(sy / 0.12)));
  const depths = new Float32Array(width * height);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 1] = data[i * 4 + 2] = 128;
    data[i * 4 + 3] = 255;
  }
  const paint = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    sample: (x: number, y: number) => number,
    fx: number,
    fy: number,
  ) => {
    const left = Math.max(0, Math.floor(((x0 - minX) / sx) * width));
    const right = Math.min(width - 1, Math.ceil(((x1 - minX) / sx) * width));
    const top = Math.max(0, Math.floor(((y0 - minY) / sy) * height));
    const bottom = Math.min(height - 1, Math.ceil(((y1 - minY) / sy) * height));
    for (let iy = top; iy <= bottom; iy++)
      for (let ix = left; ix <= right; ix++) {
        const d = sample(minX + ((ix + 0.5) / width) * sx, minY + ((iy + 0.5) / height) * sy);
        const i = iy * width + ix;
        if (d <= depths[i]) continue;
        depths[i] = d;
        data[i * 4] = Math.round(Math.min(1, d / 1.2) * 255);
        data[i * 4 + 1] = Math.round((fx * 0.5 + 0.5) * 255);
        data[i * 4 + 2] = Math.round((-fy * 0.5 + 0.5) * 255);
      }
  };
  // Pools first; the deepest covering shape supplies the local current.
  for (const l of lakes) {
    const radius = Math.max(l.rx, l.ry);
    const c = Math.cos(l.rot),
      s = Math.sin(l.rot);
    paint(
      l.x - radius,
      l.y - radius,
      l.x + radius,
      l.y + radius,
      (x, y) => {
        const dx = x - l.x,
          dy = y - l.y;
        return (
          (1 - Math.hypot((c * dx + s * dy) / l.rx, (-s * dx + c * dy) / l.ry)) *
          Math.min(l.rx, l.ry)
        );
      },
      0,
      0,
    );
  }
  for (const r of rivers)
    for (let j = 1; j < r.points.length; j++) {
      const a = r.points[j - 1],
        b = r.points[j];
      const dx = b.x - a.x,
        dy = b.y - a.y,
        len = Math.hypot(dx, dy);
      if (len < 1e-5) continue;
      const half = r.width / 2;
      paint(
        Math.min(a.x, b.x) - half,
        Math.min(a.y, b.y) - half,
        Math.max(a.x, b.x) + half,
        Math.max(a.y, b.y) + half,
        (x, y) => {
          const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (len * len)));
          return half - Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
        },
        dx / len,
        dy / len,
      );
    }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, bounds: new THREE.Vector4(minX, minY, sx, sy) };
}
export type FluidField = ReturnType<typeof buildFluidField>;
