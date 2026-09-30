import * as THREE from "three";
import { PATH_WIDTH } from "../level";
import type { Vec2 } from "../sim/types";
import { distPointToSegSq } from "../sim/vec2";
import type { FluidLake, FluidRibbon } from "./fluidField";

const hash = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Signed union distance: negative in fluid. Sampling the union prevents a
// shoreline ring from cutting across a river/pool contact or confluence.
export function fluidDistance(x: number, y: number, rivers: FluidRibbon[], lakes: FluidLake[]) {
  let d = Infinity;
  for (const r of rivers)
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1],
        b = r.points[i];
      d = Math.min(d, Math.sqrt(distPointToSegSq(x, y, a.x, a.y, b.x, b.y)) - r.width / 2);
    }
  for (const l of lakes) {
    const c = Math.cos(l.rot),
      s = Math.sin(l.rot),
      dx = x - l.x,
      dy = y - l.y;
    d = Math.min(
      d,
      (Math.hypot((c * dx + s * dy) / l.rx, (-s * dx + c * dy) / l.ry) - 1) * Math.min(l.rx, l.ry),
    );
  }
  return d;
}

export function pathDistance(x: number, y: number, paths: Vec2[][]) {
  let d = Infinity;
  for (const path of paths)
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i];
      d = Math.min(d, distPointToSegSq(x, y, a.x, a.y, b.x, b.y));
    }
  return Math.sqrt(d);
}

// Flat actor/build surfaces with continuous material weights. Texture detail
// supplies small-scale relief without changing navigation or placement height.
export function buildTerrainSurface(
  paths: Vec2[][],
  rivers: FluidRibbon[],
  lakes: FluidLake[],
  groundColor: string,
  showcase: boolean,
  bankPalette = { wet: "#354a49", gravel: "#696959" },
) {
  const positions: number[] = [],
    colors: number[] = [],
    uvs: number[] = [],
    surface: number[] = [];
  const ground = new THREE.Color(groundColor);
  const rock = new THREE.Color("#b4b9b4"),
    soil = new THREE.Color("#c8c2b2");
  const road = new THREE.Color("#d5c8ae"),
    wet = new THREE.Color(bankPalette.wet);
  const gravel = new THREE.Color(bankPalette.gravel);
  const step = showcase ? 0.55 : 0.4;
  const halfX = 34,
    halfY = 26;
  const nx = Math.ceil((halfX * 2) / step),
    ny = Math.ceil((halfY * 2) / step);
  const vertices: [number, number][] = [];
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      vertices.push([
        -halfX + i * step + (hash(i, j) - 0.5) * step * 0.65,
        -halfY + j * step + (hash(i + 79, j) - 0.5) * step * 0.65,
      ]);
    }
  const color = new THREE.Color();
  const triangle = (ids: number[], detail = 0) => {
    const cx = ids.reduce((s, i) => s + vertices[i][0], 0) / 3;
    const cy = ids.reduce((s, i) => s + vertices[i][1], 0) / 3;
    const bank = fluidDistance(cx, cy, rivers, lakes);
    if (!showcase && (bank < -0.4 || bank > 1.4)) return;
    if (Math.abs(bank) < 0.65 && detail < 2) {
      const mids = ids.map((id, k) => {
        const a = vertices[id],
          b = vertices[ids[(k + 1) % 3]];
        vertices.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        return vertices.length - 1;
      });
      triangle([ids[0], mids[0], mids[2]], detail + 1);
      triangle([mids[0], ids[1], mids[1]], detail + 1);
      triangle([mids[2], mids[1], ids[2]], detail + 1);
      triangle(mids, detail + 1);
      return;
    }
    for (const id of ids) {
      const [x, y] = vertices[id];
      // Shared vertices must have the same colour across every triangle.
      const patch = Math.sin(x * 0.22 + Math.sin(y * 0.19) * 1.7) * Math.cos(y * 0.21 - x * 0.12);
      let lane = 0;
      const pd = pathDistance(x, y, paths);
      const fd = fluidDistance(x, y, rivers, lakes);
      const edge = Math.min(halfX - Math.abs(x), halfY - Math.abs(y));
      color.copy(ground);
      if (showcase) {
        color.copy(rock).lerp(soil, 0.4 + patch * 0.18);
        // Full legal lane stays readable; broad, irregular shoulders break
        // the visual road border without narrowing its gameplay footprint.
        const shoulder = 0.8 + 0.4 * Math.sin(x * 1.8 + y * 1.1) + 0.3 * patch;
        lane = 1 - smooth(PATH_WIDTH * 0.44, PATH_WIDTH * 0.5 + shoulder * 0.7, pd);
        color.lerp(road, lane * 0.8);
      }
      const bankBand = 1 - smooth(0.15, 1.1 + patch * 0.3, fd);
      if (pd > PATH_WIDTH * 0.5 + 0.1) color.lerp(gravel, bankBand * 0.65);
      if (fd < 0.32 && pd > PATH_WIDTH * 0.5) color.lerp(wet, 1 - smooth(-0.1, 0.32, fd));

      // Fade the textured surface into the surrounding untextured ground.
      const edgeBlend = showcase ? smooth(0, 7, edge) : 0;
      // Shelf only intrudes into water by centimetres. All dry land remains
      // at y=.003, so towers and props cannot float on decorative elevation.
      const shelfWidth = 0.17 + 0.11 * (0.5 + 0.5 * Math.sin(x * 4.2 + Math.sin(y * 3.1)));
      const shelf =
        fd < 0 && fd > -shelfWidth && pd > PATH_WIDTH * 0.5 + 0.35
          ? Math.sin((-fd / shelfWidth) * Math.PI) * 0.006
          : 0;
      positions.push(x, 0.003 + shelf, -y);
      colors.push(color.r, color.g, color.b);
      uvs.push(x / 3, y / 3);
      surface.push(lane, (1 - smooth(-0.1, 1.0, fd)) * (1 - lane), edgeBlend);
    }
  };
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i,
        b = a + 1,
        c = a + nx + 1,
        d = c + 1;
      triangle([a, b, c]);
      triangle([b, d, c]);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("terrainSurface", new THREE.Float32BufferAttribute(surface, 3));
  geometry.computeVertexNormals();
  return geometry;
}
