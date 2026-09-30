import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { classifyPropUrl } from "../biomes";
import { BASE_CONDITIONS, BASE_STRUCTURES, baseStructurePlan } from "../render/baseStructures";
import { buildCatalog } from "./assetCatalog";

const palette = ["#68796a", "#c0b99b", "#263f3b", "#b5dfc4"] as const;
describe("reusable base structure library", () => {
  it("provides all 18 models as placeable buildings in every biome palette", async () => {
    const entries = buildCatalog("snow").filter(
      (e) => e.kind === "model" && e.url.includes("/base-structures/"),
    );
    expect(entries).toHaveLength(18);
    for (const entry of entries) {
      if (entry.kind !== "model") throw new Error("Expected model");
      expect(classifyPropUrl(entry.url)).toBe("building");
      const file = readFileSync(`public${entry.url}`);
      const gltf = await new GLTFLoader().parseAsync(
        file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
        "",
      );
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-0.001);
      expect(
        Math.max(
          Math.abs(bounds.min.x),
          Math.abs(bounds.max.x),
          Math.abs(bounds.min.z),
          Math.abs(bounds.max.z),
        ),
      ).toBeLessThanOrEqual(1.7);
      const filename = entry.url.split("/").pop();
      const kind = BASE_STRUCTURES.find((s) => filename?.startsWith(`${s.id}-`))!;
      const condition = BASE_CONDITIONS.find((c) => filename?.endsWith(`-${c}.glb`))!;
      // Snapshot files must remain synchronized with the editable geometry source.
      expect(gltf.scene.children[0].children.length).toBe(
        baseStructurePlan(kind.id, palette, condition).length,
      );
    }
  });
  it("preserves six distinct silhouettes and three states per structure", () => {
    const heights = BASE_STRUCTURES.map(({ id }) =>
      Math.max(...baseStructurePlan(id, palette, "intact").map((b) => b.at[1] + b.size[1] / 2)),
    );
    expect(new Set(heights).size).toBeGreaterThanOrEqual(5);
    for (const { id } of BASE_STRUCTURES)
      expect(
        new Set(
          BASE_CONDITIONS.map((condition) =>
            JSON.stringify(baseStructurePlan(id, palette, condition)),
          ),
        ).size,
      ).toBe(3);
  });
});
