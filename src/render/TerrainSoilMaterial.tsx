import { useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { GRAPHICS_QUALITY } from "./effectsTunables";

const LOW = GRAPHICS_QUALITY === "low";
const ROOT = "/textures/terrain/";
const MAPS = [
  "brown-mud/albedo.jpg",
  "brown-mud/roughness.jpg",
  "compacted-dirt/albedo.jpg",
  ...(LOW ? [] : ["brown-mud/normal.jpg", "compacted-dirt/normal.jpg"]),
];

// Standard PBR lighting/shadows, with a world-scaled photographic surface.
// No displacement: props, actors and the placement plane keep their heights.
export const TerrainSoilMaterial = ({ groundColor }: { groundColor: string }) => {
  const sources = useLoader(
    THREE.TextureLoader,
    MAPS.map((name) => ROOT + name),
  );
  const gl = useThree((s) => s.gl);
  const material = useMemo(() => {
    const textures = sources.map((source, index) => {
      // Cached source images are shared; sampler state and GPU handles are owned.
      const texture = source.clone();
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(LOW ? 2 : 4, gl.capabilities.getMaxAnisotropy());
      texture.colorSpace = index === 0 || index === 2 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.needsUpdate = true;
      return texture;
    });
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: textures[0],
      roughnessMap: textures[1],
      normalMap: textures[3] ?? null,
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughness: 1,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRoadMap = { value: textures[2] };
      shader.uniforms.uRoadNormal = { value: textures[4] ?? null };
      shader.uniforms.uTerrainEdgeColor = { value: new THREE.Color(groundColor) };
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute vec3 terrainSurface;\nvarying vec3 vTerrainSurface;",
        )
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nvTerrainSurface = terrainSurface;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vTerrainSurface;\nuniform vec3 uTerrainEdgeColor;\nuniform sampler2D uRoadMap;\nuniform sampler2D uRoadNormal;",
        )
        .replace(
          "#include <map_fragment>",
          `
          vec4 soil = texture2D(map, vMapUv);
          // A second scale softens obvious tiling without losing close detail.
          vec3 broad = texture2D(map, vMapUv * 0.37 + vec2(0.31, 0.73)).rgb;
          soil.rgb = mix(soil.rgb, broad, 0.22);
          vec3 road = texture2D(uRoadMap, vMapUv).rgb;
          vec3 surface = mix(soil.rgb * 1.8, road * 2.5,
            mix(0.18, 1.0, vTerrainSurface.x));
          diffuseColor *= vec4(surface, soil.a);
        `,
        )
        .replace(
          "#include <color_fragment>",
          `
          #include <color_fragment>
          diffuseColor.rgb = mix(uTerrainEdgeColor, diffuseColor.rgb, vTerrainSurface.z);
        `,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          `
          #include <roughnessmap_fragment>
          roughnessFactor = mix(0.72 + roughnessFactor * 0.26,
            0.43 + roughnessFactor * 0.28, vTerrainSurface.y);
          roughnessFactor = mix(roughnessFactor, 0.92, vTerrainSurface.x);
        `,
        )
        .replace(
          "#include <normal_fragment_maps>",
          THREE.ShaderChunk.normal_fragment_maps.replace(
            "mapN.xy *= normalScale;",
            `vec3 roadNormal = texture2D(uRoadNormal, vNormalMapUv).xyz * 2.0 - 1.0;
             mapN = normalize(mix(mapN, roadNormal, vTerrainSurface.x));
             mapN.xy *= normalScale * mix(1.0, 0.65, vTerrainSurface.x) * vTerrainSurface.z;`,
          ),
        );
    };
    mat.customProgramCacheKey = () => "terrain-photographic-soil-v1";
    return { mat, textures };
  }, [sources, gl, groundColor]);
  useEffect(
    () => () => {
      material.mat.dispose();
      for (const texture of material.textures) texture.dispose();
    },
    [material],
  );
  return <primitive object={material.mat} attach="material" />;
};
