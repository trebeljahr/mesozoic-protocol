import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { Biome } from "../biomes";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useMemo: (create: () => unknown) => create(),
  useEffect: () => {},
}));
vi.mock("@react-three/fiber", () => ({
  useLoader: (_loader: unknown, paths: string[]) => paths.map(() => new THREE.Texture()),
  useThree: (select: (state: unknown) => unknown) =>
    select({ gl: { capabilities: { getMaxAnisotropy: () => 4 } } }),
}));
vi.mock("./effectsTunables", () => ({ getGraphicsQuality: () => "high" }));

import { TerrainSoilMaterial } from "./TerrainSoilMaterial";

const createMaterial = (biome: Biome) =>
  TerrainSoilMaterial({ biome, groundColor: "#63503c" }).props.object as THREE.MeshStandardMaterial;

// Resolve only our biome conditionals; Three.js resolves its own feature macros.
const specialize = (source: string, forest: boolean) =>
  source.replace(/#ifdef TERRAIN_FOREST\n([\s\S]*?)#endif/g, (_block, branches: string) => {
    const [yes, no = ""] = branches.split("#else");
    return forest ? yes : no;
  });

const fragment = (material: THREE.MeshStandardMaterial) => {
  const shader = {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
  };
  material.onBeforeCompile(
    shader as Parameters<THREE.MeshStandardMaterial["onBeforeCompile"]>[0],
    {} as THREE.WebGLRenderer,
  );
  expect(shader.uniforms).not.toHaveProperty("uForest");
  return specialize(shader.fragmentShader, !!material.defines.TERRAIN_FOREST);
};

describe("terrain biome shader specialization", () => {
  it("uses distinct forest and mineral program keys while sharing mineral programs", () => {
    const forest = createMaterial("forest");
    const desert = createMaterial("desert");
    const snow = createMaterial("snow");
    expect(forest.customProgramCacheKey()).not.toBe(desert.customProgramCacheKey());
    expect(desert.customProgramCacheKey()).toBe(snow.customProgramCacheKey());
    expect(forest.defines.TERRAIN_FOREST).toBe(1);
    expect(snow.vertexColors).toBe(false);
    expect(desert.vertexColors).toBe(true);
    expect(desert.defines.TERRAIN_FOREST).toBeUndefined();
  });

  it.each<Biome>([
    "desert",
    "snow",
    "wasteland",
    "lava",
    "alien",
  ])("%s removes forest samples and weights from both color and normals", (biome) => {
    const source = fragment(createMaterial(biome));
    expect(source).not.toMatch(/(?:stochastic|untiled|untiledNormal)\(u(?:Leaf|Grass)/);
    expect(source).not.toMatch(/leafWeight|grassWeight|uForest/);
    expect(source).toContain("vec3 surface = uMineralTint");
    expect(source).toContain("vec3 road = uRoadTint");
    expect(source).toContain("normalize(mix(mapN, roadNormal, vTerrainSurface.x))");
  });

  it("retains forest color and normal contributions and explicit texture gradients", () => {
    const source = fragment(createMaterial("forest"));
    expect(source).toContain("untiled(uLeafMap,vMapUv*1.3)");
    expect(source).toContain("stochastic(uGrassMap,vMapUv*1.55,false,true)");
    expect(source).toContain("mix(mapN,leafNormal,leafWeight)");
    expect(source).toContain("mix(mapN,grassNormal,grassWeight)");
    expect(source).toContain("turn*dFdx(uv)*scale,turn*dFdy(uv)*scale");
    expect(source).not.toContain("vec3 surface = uMineralTint");
  });
});
