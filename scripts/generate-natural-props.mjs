// Deterministic, repository-owned geometry. Re-run after editing silhouettes.
import fs from "node:fs/promises";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

globalThis.FileReader = class {
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
  async readAsDataURL(blob) {
    this.result =
      "data:application/octet-stream;base64," +
      Buffer.from(await blob.arrayBuffer()).toString("base64");
    this.onloadend?.();
  }
};
const dir = "public/models/natural";
await fs.mkdir(dir, { recursive: true });
function rng(initialSeed) {
  let seed = initialSeed;
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function colored(g, color) {
  const c = new THREE.Color(color),
    a = [];
  for (let i = 0; i < g.attributes.position.count; i++) a.push(c.r, c.g, c.b);
  g.setAttribute("color", new THREE.Float32BufferAttribute(a, 3));
  return g;
}
function branch(a, b, r1, r2) {
  const delta = b.clone().sub(a),
    g = new THREE.CylinderGeometry(r2, r1, delta.length(), 9, 4);
  g.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()),
  );
  g.translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
  return g;
}
function tree(seed, shrub = false) {
  const random = rng(seed),
    wood = [],
    foliage = [];
  const h = shrub ? 1.1 : 3.5;
  const trunk = new THREE.Vector3((random() - 0.5) * 0.12, h * 0.7, (random() - 0.5) * 0.12);
  wood.push(branch(new THREE.Vector3(), trunk, shrub ? 0.06 : 0.11, 0.035));
  const count = shrub ? 13 : 22;
  for (let n = 0; n < count; n++) {
    const angle = n * 2.399 + random() * 0.4,
      y = h * ((shrub ? 0.3 : 0.46) + ((shrub ? 0.55 : 0.39) * n) / count);
    const spread =
      (shrub ? 0.6 : 1.12) *
      Math.sin(Math.PI * (0.18 + (0.7 * n) / count)) *
      (0.8 + random() * 0.25);
    const start = new THREE.Vector3((trunk.x * y) / h, y, (trunk.z * y) / h);
    const end = new THREE.Vector3(Math.cos(angle) * spread, y + h * 0.19, Math.sin(angle) * spread);
    wood.push(branch(start, end, shrub ? 0.019 : 0.035, 0.008));
    for (let t = 0; t < 4; t++) {
      const twigStart = start.clone().lerp(end, 0.35 + t * 0.17);
      const twigEnd = end
        .clone()
        .add(
          new THREE.Vector3(
            (random() - 0.5) * 0.6,
            (random() - 0.35) * 0.4,
            (random() - 0.5) * 0.6,
          ),
        );
      wood.push(branch(twigStart, twigEnd, 0.01, 0.002));
      for (let k = 0; k < 22; k++) {
        const center = twigStart
          .clone()
          .lerp(twigEnd, 0.2 + random() * 0.8)
          .add(
            new THREE.Vector3(
              (random() - 0.5) * 0.48,
              (random() - 0.5) * 0.35,
              (random() - 0.5) * 0.48,
            ),
          );
        const length = (shrub ? 0.13 : 0.16) * (0.7 + random() * 0.6),
          width = length * 0.42;
        const g = new THREE.BufferGeometry();
        // Folded lanceolate leaves: pointed ends, raised central vein.
        const p = [
          0,
          0.014,
          0,
          0,
          0,
          -length,
          -width,
          0,
          -length * 0.2,
          0,
          0.014,
          0,
          -width,
          0,
          -length * 0.2,
          0,
          0,
          length,
          0,
          0.014,
          0,
          0,
          0,
          length,
          width,
          0,
          -length * 0.2,
          0,
          0.014,
          0,
          width,
          0,
          -length * 0.2,
          0,
          0,
          -length,
        ];
        g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
        g.rotateX((random() - 0.5) * 1.1);
        g.rotateZ((random() - 0.5) * 1.1);
        g.rotateY(random() * 6.28);
        g.translate(...center.toArray());
        g.computeVertexNormals();
        const c = new THREE.Color().setHSL(
          0.24 + random() * 0.075,
          0.26 + random() * 0.16,
          0.13 + random() * 0.105,
        );
        colored(g, c);
        foliage.push(g);
      }
    }
  }
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(
      mergeGeometries(wood),
      new THREE.MeshStandardMaterial({ color: "#625344", roughness: 1 }),
    ),
  );
  group.add(
    new THREE.Mesh(
      mergeGeometries(foliage),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.88,
        side: THREE.DoubleSide,
      }),
    ),
  );
  return group;
}
async function save(name, model) {
  const raw = Buffer.from(await new GLTFExporter().parseAsync(model, { binary: true }));
  await fs.writeFile(`${dir}/${name}.glb`, raw);
}
for (let i = 1; i <= 4; i++) await save(`Tree${i}`, tree(i * 179));
for (let i = 1; i <= 3; i++) await save(`Bush${i}`, tree(i * 397, true));
console.log("Generated four branching trees and three shrubs.");
