import { useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Biome } from "../biomes";
import { getGraphicsQuality } from "./effectsTunables";
import { TERRAIN_PALETTE } from "./terrainPalette";

const ROOT = "/textures/terrain/";
const terrainMaps = (low: boolean) => [
  "brown-mud/albedo.jpg",
  "brown-mud/roughness.jpg",
  "compacted-dirt/albedo.jpg",
  "leaf-litter/albedo.jpg",
  "grass/albedo.jpg",
  ...(low
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
export const TerrainSoilMaterial = ({
  groundColor,
  biome,
}: {
  groundColor: string;
  biome: Biome;
}) => {
  const low = getGraphicsQuality() === "low";
  const sources = useLoader(
    THREE.TextureLoader,
    terrainMaps(low).map((name) => ROOT + name),
  );
  const gl = useThree((s) => s.gl);
  const material = useMemo(() => {
    const textures = sources.map((source, index) => {
      // Cached source images are shared; sampler state and GPU handles are owned.
      const texture = source.clone();
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(low ? 2 : 4, gl.capabilities.getMaxAnisotropy());
      texture.colorSpace =
        index === 0 || (index >= 2 && index <= 4) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.needsUpdate = true;
      return texture;
    });
    const mat = new THREE.MeshStandardMaterial({
      // Snow keeps the texture grain without the geometry's beige soil underpainting.
      vertexColors: biome !== "snow",
      map: textures[0],
      roughnessMap: textures[1],
      normalMap: textures[5] ?? null,
      normalScale: new THREE.Vector2().setScalar(biome === "snow" ? 0.2 : 0.32),
      roughness: 1,
    });
    const palette = TERRAIN_PALETTE[biome];
    const forest = biome === "forest";
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uMineralTint = { value: new THREE.Color(palette.mineral) };
      shader.uniforms.uRoadTint = { value: new THREE.Color(palette.road) };
      shader.uniforms.uCoverTint = { value: new THREE.Color(palette.cover) };
      shader.uniforms.uCoverAmount = { value: palette.coverAmount };
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
          uniform vec3 uMineralTint, uRoadTint, uCoverTint;
          uniform float uCoverAmount;
          uniform sampler2D uRoadMap, uRoadNormal, uLeafMap, uGrassMap, uLeafNormal, uGrassNormal;
          vec2 surfaceHash(vec2 p) {
            return fract(sin(vec2(dot(p, vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)))) * 43758.5453);
          }
          float habitatNoise(vec2 p) {
            vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(surfaceHash(i).x,surfaceHash(i+vec2(1,0)).x,f.x),
                       mix(surfaceHash(i+vec2(0,1)).x,surfaceHash(i+1.0).x,f.x),f.y);
          }
          // Triangular stochastic patches: random rotation, scale and offset.
          // Explicit derivatives prevent mip seams; normal XY follows the rotation.
          vec4 patchSample(sampler2D tex, vec2 uv, vec2 cell, bool normalData, bool grassData) {
            vec2 h=surfaceHash(cell);
            float angle=h.x*6.2831853;
            mat2 turn=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));
            float scale=0.75+h.y*0.65;
            vec4 sampleValue=texture2DGradEXT(tex,turn*uv*scale+h*11.0,
              turn*dFdx(uv)*scale,turn*dFdy(uv)*scale);
            if(grassData) {
              vec3 mean=texture2DLodEXT(tex,turn*uv*scale+h*11.0,7.0).rgb;
              sampleValue.rgb=clamp(sampleValue.rgb-mean*0.65+vec3(0.11,0.13,0.065),0.025,0.65);
            }
            if(normalData) {
              vec2 n=sampleValue.xy*2.0-1.0;
              sampleValue.xy=vec2(dot(turn[0],n),dot(turn[1],n))*0.5+0.5;
            }
            return sampleValue;
          }
          vec4 stochastic(sampler2D tex, vec2 uv, bool normalData, bool grassData) {
            vec2 warp=vec2(habitatNoise(uv*0.31),habitatNoise(uv*0.31+43.7));
            vec2 q=uv*0.72+(warp-0.5)*1.8, cell=floor(q), f=fract(q);
            vec2 a=cell, b=cell+vec2(1,0), c=cell+vec2(0,1);
            vec3 weights=vec3(1.0-f.x-f.y,f.x,f.y);
            if(f.x+f.y>1.0) {
              a=cell+1.0;
              weights=vec3(f.x+f.y-1.0,1.0-f.y,1.0-f.x);
            }
            weights=pow(max(weights,vec3(0.0)),vec3(1.5));
            weights/=dot(weights,vec3(1.0));
            return patchSample(tex,uv,a,normalData,grassData)*weights.x
                 + patchSample(tex,uv,b,normalData,grassData)*weights.y
                 + patchSample(tex,uv,c,normalData,grassData)*weights.z;
          }
          vec4 untiled(sampler2D tex, vec2 uv) { return stochastic(tex,uv,false,false); }
          vec4 untiledNormal(sampler2D tex, vec2 uv) { return stochastic(tex,uv,true,false); }

        `,
        )
        .replace(
          "#include <map_fragment>",
          `
          vec2 world = vMapUv * 3.0;
          float habitat = habitatNoise(world*0.085) * 0.72 + habitatNoise(world*0.23+17.0)*0.28;
          #ifdef TERRAIN_FOREST
          float grassWeight = smoothstep(0.12,0.88,habitat) * (1.0-vTerrainSurface.y) * 0.65;
          float leafWeight = (1.0-grassWeight) * (1.0-vTerrainSurface.y) * 0.58;
          #endif
          vec3 soil = untiled(map,vMapUv).rgb * 1.7;
          vec3 roadTex = untiled(uRoadMap,vMapUv*1.2).rgb;
          #ifdef TERRAIN_FOREST
          vec3 leaves = untiled(uLeafMap,vMapUv*1.3).rgb * 1.2;
          // Suppress broad sandy stripes in each rotated patch before blending.
          vec3 grass = stochastic(uGrassMap,vMapUv*1.55,false,true).rgb;
          vec3 road = mix(roadTex*3.4,vec3(0.38,0.285,0.17),0.38);
          vec3 surface = mix(soil,leaves,leafWeight);
          surface = mix(surface,grass,grassWeight);
          #else
            float grain = dot(soil,vec3(0.2126,0.7152,0.0722));
            float fineGrain = dot(roadTex,vec3(0.2126,0.7152,0.0722));
            vec3 surface = uMineralTint * (0.72 + grain*0.85);
            surface = mix(surface,uCoverTint*(0.82+fineGrain*1.1),
              smoothstep(0.22,0.78,habitat)*uCoverAmount*(1.0-vTerrainSurface.y));
            vec3 road = uRoadTint * (0.5 + fineGrain*5.0);
          #endif
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
              "untiledNormal( normalMap, vNormalMapUv )",
            )
            .replace(
              "mapN.xy *= normalScale;",
              `vec3 roadNormal = untiledNormal(uRoadNormal, vNormalMapUv*1.2).xyz * 2.0 - 1.0;
             #ifdef TERRAIN_FOREST
             vec3 leafNormal = untiledNormal(uLeafNormal, vNormalMapUv*1.3).xyz*2.0-1.0;
             vec3 grassNormal = untiledNormal(uGrassNormal, vNormalMapUv*1.55).xyz*2.0-1.0;
             mapN = mix(mapN,leafNormal,leafWeight);
             mapN = mix(mapN,grassNormal,grassWeight);
             #endif
             mapN = normalize(mix(mapN, roadNormal, vTerrainSurface.x));
             mapN.xy *= normalScale * mix(1.0, 0.65, vTerrainSurface.x) * vTerrainSurface.z;`,
            ),
        );
    };
    // Specialize before compilation: nonforest surfaces never use leaf/grass
    // samples. Keep derivative-bearing samples outside runtime branches.
    if (forest) mat.defines = { TERRAIN_FOREST: 1 };
    mat.customProgramCacheKey = () =>
      `terrain-stochastic-biomes-v3-${forest ? "forest" : "mineral"}`;
    return { mat, textures };
  }, [sources, gl, groundColor, biome, low]);
  useEffect(
    () => () => {
      material.mat.dispose();
      for (const texture of material.textures) texture.dispose();
    },
    [material],
  );
  return <primitive object={material.mat} attach="material" />;
};
