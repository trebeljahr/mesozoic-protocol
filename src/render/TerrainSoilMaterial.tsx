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
  "leaf-litter/albedo.jpg",
  "grass/albedo.jpg",
  ...(LOW
    ? []
    : [
        "brown-mud/normal.jpg",
        "compacted-dirt/normal.jpg",
        "leaf-litter/normal.jpg",
        "grass/normal.jpg",
      ]),
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
      texture.colorSpace =
        index === 0 || (index >= 2 && index <= 4) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.needsUpdate = true;
      return texture;
    });
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: textures[0],
      roughnessMap: textures[1],
      normalMap: textures[5] ?? null,
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughness: 1,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRoadMap = { value: textures[2] };
      shader.uniforms.uRoadNormal = { value: textures[6] ?? null };
      shader.uniforms.uLeafMap = { value: textures[3] };
      shader.uniforms.uGrassMap = { value: textures[4] };
      shader.uniforms.uLeafNormal = { value: textures[7] ?? null };
      shader.uniforms.uGrassNormal = { value: textures[8] ?? null };
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
          `#include <common>
          varying vec3 vTerrainSurface;
          uniform vec3 uTerrainEdgeColor;
          uniform sampler2D uRoadMap, uRoadNormal, uLeafMap, uGrassMap, uLeafNormal, uGrassNormal;
          vec2 surfaceHash(vec2 p) {
            return fract(sin(vec2(dot(p, vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)))) * 43758.5453);
          }
          float habitatNoise(vec2 p) {
            vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(surfaceHash(i).x,surfaceHash(i+vec2(1,0)).x,f.x),
                       mix(surfaceHash(i+vec2(0,1)).x,surfaceHash(i+1.0).x,f.x),f.y);
          }
          // Overlapping world cells sample independent offsets; no identical tile grid.
          vec4 untiled(sampler2D tex, vec2 uv) {
            vec2 cell=floor(uv*0.45), f=fract(uv*0.45);
            vec2 dx=dFdx(uv), dy=dFdy(uv);
            f=f*f*(3.0-2.0*f);
            return mix(mix(texture2DGradEXT(tex,uv+surfaceHash(cell)*7.0,dx,dy),
                           texture2DGradEXT(tex,uv+surfaceHash(cell+vec2(1,0))*7.0,dx,dy),f.x),
                       mix(texture2DGradEXT(tex,uv+surfaceHash(cell+vec2(0,1))*7.0,dx,dy),
                           texture2DGradEXT(tex,uv+surfaceHash(cell+1.0)*7.0,dx,dy),f.x),f.y);
          }
        `,
        )
        .replace(
          "#include <map_fragment>",
          `
          vec2 world = vMapUv * 3.0;
          float habitat = habitatNoise(world*0.085) * 0.72 + habitatNoise(world*0.23+17.0)*0.28;
          float grassWeight = smoothstep(0.36,0.64,habitat) * (1.0-vTerrainSurface.y);
          float leafWeight = (1.0-grassWeight) * (1.0-vTerrainSurface.y) * 0.85;
          vec3 soil = untiled(map,vMapUv).rgb * 1.7;
          vec3 leaves = untiled(uLeafMap,vMapUv*0.85).rgb * 1.65;
          vec3 grass = untiled(uGrassMap,vMapUv*1.15).rgb * 1.35;
          vec3 road = untiled(uRoadMap,vMapUv).rgb * 2.25;
          vec3 surface = mix(soil,leaves,leafWeight);
          surface = mix(surface,grass,grassWeight);
          surface = mix(surface,road,vTerrainSurface.x);
          diffuseColor *= vec4(surface,1.0);
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
          float roughnessFactor = roughness;
          roughnessFactor *= untiled(roughnessMap,vRoughnessMapUv).g;
          roughnessFactor = mix(0.72 + roughnessFactor * 0.26,
            0.43 + roughnessFactor * 0.28, vTerrainSurface.y);
          roughnessFactor = mix(roughnessFactor, 0.92, vTerrainSurface.x);
        `,
        )
        .replace(
          "#include <normal_fragment_maps>",
          THREE.ShaderChunk.normal_fragment_maps
            .replaceAll(
              "texture2D( normalMap, vNormalMapUv )",
              "untiled( normalMap, vNormalMapUv )",
            )
            .replace(
              "mapN.xy *= normalScale;",
              `vec3 roadNormal = untiled(uRoadNormal, vNormalMapUv).xyz * 2.0 - 1.0;
             vec3 leafNormal = untiled(uLeafNormal, vNormalMapUv*0.85).xyz*2.0-1.0;
             vec3 grassNormal = untiled(uGrassNormal, vNormalMapUv*1.15).xyz*2.0-1.0;
             mapN = mix(mapN,leafNormal,leafWeight);
             mapN = mix(mapN,grassNormal,grassWeight);
             mapN = normalize(mix(mapN, roadNormal, vTerrainSurface.x));
             mapN.xy *= normalScale * mix(1.0, 0.65, vTerrainSurface.x) * vTerrainSurface.z;`,
            ),
        );
    };
    mat.customProgramCacheKey = () => "terrain-habitat-soil-v2";
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
