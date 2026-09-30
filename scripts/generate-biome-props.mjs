// Deterministic climate-specific scenery, with bounded geometry and no textures.
import fs from "node:fs/promises";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

globalThis.FileReader = class {
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
};
const root = "public/models/natural";
await fs.mkdir(root, { recursive: true });
function rng(initialSeed) {
  let seed = initialSeed;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function branch(a, b, radius, tip = 0.008) {
  const d = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(tip, radius, d.length(), 7, 1);
  g.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()),
  );
  g.translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
  return g;
}
function pine(seed) {
  const random = rng(seed),
    wood = [],
    needles = [],
    snow = [];
  const h = 3.5,
    lean = (random() - 0.5) * 0.2;
  wood.push(branch(new THREE.Vector3(), new THREE.Vector3(lean, h, 0), 0.11, 0.015));
  for (let i = 0; i < 52; i++) {
    const y = 0.6 + (i / 52) * 2.7,
      angle = i * 2.399 + random() * 0.5;
    const width = (1 - y / h) * (0.85 + random() * 0.35);
    const start = new THREE.Vector3((lean * y) / h, y, 0);
    const end = new THREE.Vector3(Math.cos(angle) * width, y - 0.12, Math.sin(angle) * width);
    wood.push(branch(start, end, 0.028));
    for (let j = 0; j < 7; j++) {
      const center = start.clone().lerp(end, 0.24 + j * 0.11);
      const g = new THREE.SphereGeometry(1, 7, 4);
      g.scale(0.14 + width * 0.13, 0.07, 0.1 + width * 0.13);
      g.rotateY(angle + j * 0.4);
      g.translate(center.x, center.y, center.z);
      needles.push(g);
      if ((i + j) % 3 !== 0) {
        const cap = new THREE.SphereGeometry(1, 7, 4);
        cap.scale(0.12 + width * 0.1, 0.038, 0.08 + width * 0.1);
        cap.rotateY(angle + j * 0.4);
        cap.translate(center.x + 0.025, center.y + 0.055, center.z);
        snow.push(cap);
      }
    }
  }
  const model = new THREE.Group();
  for (const [pieces, color] of [
    [wood, "#655a50"],
    [needles, "#52645b"],
    [snow, "#dbe3e2"],
  ])
    model.add(
      new THREE.Mesh(
        mergeGeometries(pieces),
        new THREE.MeshStandardMaterial({ color, roughness: 1 }),
      ),
    );
  return model;
}
function rock(seed, color) {
  const g = new THREE.SphereGeometry(1, 16, 10),
    p = g.attributes.position;
  const phase = seed * 0.79;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const n =
      1 +
      Math.sin(x * 4.1 + phase) * Math.cos(z * 3.7 - phase) * 0.12 +
      Math.sin(y * 7 + x * 3) * 0.06;
    p.setXYZ(i, x * n, Math.max(0, (y * n + 0.87) * 0.65), z * n * (0.65 + (seed % 3) * 0.08));
  }
  g.computeVertexNormals();
  const colors = [];
  for (let i = 0; i < p.count; i++) {
    const shade = new THREE.Color(color).multiplyScalar(
      0.85 + Math.sin(p.getX(i) * 9 + p.getY(i) * 12 + phase) * 0.07,
    );
    colors.push(shade.r, shade.g, shade.b);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97 }));
}
async function save(name, model) {
  await fs.writeFile(
    `${root}/${name}.glb`,
    Buffer.from(await new GLTFExporter().parseAsync(model, { binary: true })),
  );
}
for (let i = 1; i <= 4; i++) await save(`SnowPine${i}`, pine(i * 719));
for (const [biome, color] of [
  ["Desert", "#a68c6d"],
  ["Snow", "#89969e"],
  ["Waste", "#7d756b"],
])
  for (let i = 1; i <= 5; i++) {
    const sourceBiome = { Desert: "desert", Snow: "snow", Waste: "wasteland" }[biome];
    const sourcePath = `public/models/biomes/${sourceBiome}/Rock${i}.glb`;
    let source;
    try {
      source = await fs.readFile(sourcePath);
    } catch {
      source = await fs.readFile(`public/models/biomes/${sourceBiome}/Rock1.glb`);
    }
    const original = await new GLTFLoader().parseAsync(
      source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
      "",
    );
    const size = new THREE.Box3().setFromObject(original.scene).getSize(new THREE.Vector3());
    const model = rock(i * 43, color);
    const actual = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    model.geometry.scale(size.x / actual.x, size.y / actual.y, size.z / actual.z);
    await save(`${biome}Rock${i}`, model);
  }
console.log("Generated four snow pines and fifteen weathered stones.");
