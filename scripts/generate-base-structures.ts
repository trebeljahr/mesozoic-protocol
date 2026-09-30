// Rebuild the editor's reusable modules from the same geometry used by campaign bases.
import { mkdir, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { BASE_CONDITIONS, BASE_STRUCTURES, baseStructurePlan } from "../src/render/baseStructures";

// GLTFExporter only needs FileReader's async ArrayBuffer path for binary geometry.
class BinaryFileReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
}
Object.assign(globalThis, { FileReader: BinaryFileReader });
const directory = new URL("../public/models/base-structures/", import.meta.url);
await mkdir(directory, { recursive: true });
const exporter = new GLTFExporter();
const geometry = new THREE.BoxGeometry();
const palette = ["#68796a", "#c0b99b", "#263f3b", "#b5dfc4"] as const;
for (const { id } of BASE_STRUCTURES)
  for (const condition of BASE_CONDITIONS) {
    const group = new THREE.Group();
    group.name = `${id}-${condition}`;
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    for (const block of baseStructurePlan(id, palette, condition)) {
      let material = materials.get(block.color);
      if (!material) {
        material = new THREE.MeshStandardMaterial({
          color: block.color,
          roughness: 0.83,
          metalness: 0.15,
        });
        materials.set(block.color, material);
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...block.at);
      mesh.scale.set(...block.size);
      group.add(mesh);
    }
    const glb = (await exporter.parseAsync(group, { binary: true })) as ArrayBuffer;
    await writeFile(new URL(`${id}-${condition}.glb`, directory), Buffer.from(glb));
    for (const material of materials.values()) material.dispose();
  }
geometry.dispose();
console.log(`Generated ${BASE_STRUCTURES.length * BASE_CONDITIONS.length} base structure assets.`);
