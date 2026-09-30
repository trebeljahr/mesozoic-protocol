import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  CARCASS_PALETTES,
  carcassGrowthPoints,
  carcassMaterial,
  createCarcassCrystals,
} from "./carcassAppearance";

describe("biome carcasses", () => {
  it("keeps source materials and textures intact across differently weathered clones", () => {
    const map = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({
      color: "#d2bca1",
      map,
      emissive: "#33ff99",
      emissiveIntensity: 2,
    });
    const original = source.color.clone();
    const forest = carcassMaterial(source, "forest") as THREE.MeshStandardMaterial;
    const snow = carcassMaterial(source, "snow") as THREE.MeshStandardMaterial;
    const lava = carcassMaterial(source, "lava") as THREE.MeshStandardMaterial;
    expect(source.color).toEqual(original);
    expect(source.emissiveIntensity).toBe(2);
    for (const material of [forest, snow, lava]) {
      expect(material).not.toBe(source);
      expect(material.map).toBe(map);
      expect(material.emissiveIntensity).toBe(0);
      expect(material.roughness).toBe(1);
      material.dispose();
    }
    expect(lava.color.r).toBeLessThan(forest.color.r);
    expect(forest.color.r).toBeLessThan(snow.color.r);
    expect(lava.customProgramCacheKey()).not.toBe(snow.customProgramCacheKey());
    source.dispose();
    map.dispose();
  });

  it("anchors growth to the current posed surface and follows its transform", () => {
    const geometry = new THREE.BoxGeometry(2, 1, 1, 4, 1, 3);
    const material = new THREE.MeshStandardMaterial();
    const body = new THREE.Mesh(geometry, material);
    // Model a skinned vertex displacement: getVertexPosition is the same
    // API used by SkinnedMesh after its bones have reached the death pose.
    const original = body.getVertexPosition.bind(body);
    vi.spyOn(body, "getVertexPosition").mockImplementation((i, target) =>
      original(i, target).add(new THREE.Vector3(0, 2, 0)),
    );
    body.position.set(7, 0.5, -3);
    const first = carcassGrowthPoints(body, 2, 42);
    expect(first).toHaveLength(5);
    expect(carcassGrowthPoints(body, 2, 42)).toEqual(first);
    for (const point of first) {
      expect(point.position.y).toBeCloseTo(3);
      expect(point.position.x).toBeGreaterThanOrEqual(6);
      expect(point.position.x).toBeLessThanOrEqual(8);
      expect(point.position.z).toBeGreaterThanOrEqual(-3.5);
      expect(point.position.z).toBeLessThanOrEqual(-2.5);
      expect(point.normal.y).toBeCloseTo(1);
    }
    const growth = createCarcassCrystals(body, 2, 42)!;
    expect(growth.geometry).not.toBe(geometry);
    expect(growth.geometry.attributes.position.count).toBeGreaterThan(0);
    const disposeSource = vi.spyOn(geometry, "dispose");
    growth.geometry.dispose();
    for (const mat of [growth.material].flat()) mat.dispose();
    expect(disposeSource).not.toHaveBeenCalled();
    geometry.dispose();
    material.dispose();
  });

  it("gives every environment a distinct palette, reserving pale remains for snow", () => {
    const snow = new THREE.Color(CARCASS_PALETTES.snow.skin);
    for (const [biome, palette] of Object.entries(CARCASS_PALETTES)) {
      if (biome === "snow") continue;
      const color = new THREE.Color(palette.skin);
      expect(color.r + color.g + color.b).toBeLessThan((snow.r + snow.g + snow.b) * 0.7);
    }
  });
});
