import { useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { GRAPHICS_QUALITY } from "./effectsTunables";

const LOW = GRAPHICS_QUALITY === "low";
const ROOT = "/textures/terrain/";
const MAPS = [
  "brown-mud/albedo.jpg",
  "compacted-dirt/albedo.jpg",
  "leaf-litter/albedo.jpg",
  "grass/albedo.jpg",
  ...(LOW ? [] : ["brown-mud/normal.jpg"]),
];

// Same photographic soils and stochastic patching as the battlefield, with
// vertex habitat weights spanning all six regions in one shadowed draw call.
export const WorldMapSoilMaterial = () => {
  const sources = useLoader(
    THREE.TextureLoader,
    MAPS.map((name) => ROOT + name),
  );
  const gl = useThree((s) => s.gl);
  const surface = useMemo(() => {
    const textures = sources.map((source, i) => {
      const texture = source.clone();
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = i < 4 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = Math.min(LOW ? 2 : 4, gl.capabilities.getMaxAnisotropy());
      texture.needsUpdate = true;
      return texture;
    });
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: textures[0],
      normalMap: textures[4] ?? null,
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughness: 0.96,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uAtlasRoad = { value: textures[1] };
      shader.uniforms.uAtlasLeaf = { value: textures[2] };
      shader.uniforms.uAtlasGrass = { value: textures[3] };
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
        attribute float atlasShore;
        varying float vAtlasShore;
        attribute vec3 atlasCover, atlasSurface, atlasHabitat;
        varying vec3 vAtlasCover, vAtlasSurface, vAtlasHabitat;`,
        )
        .replace(
          "#include <uv_vertex>",
          `#include <uv_vertex>
          vAtlasShore=atlasShore; vAtlasCover=atlasCover; vAtlasSurface=atlasSurface; vAtlasHabitat=atlasHabitat;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
        varying vec3 vAtlasCover, vAtlasSurface, vAtlasHabitat;
        varying float vAtlasShore;
        uniform sampler2D uAtlasRoad, uAtlasLeaf, uAtlasGrass;
        vec2 atlasHash(vec2 p) {
          return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);
        }
        vec3 atlasPatch(sampler2D tex, vec2 uv, vec2 cell, bool grass, bool normalData) {
          vec2 h=atlasHash(cell);
          float angle=h.x*6.2831853;
          mat2 turn=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));
          float scale=0.75+h.y*0.65;
          vec2 coord=turn*uv*scale+h*11.0;
          vec3 value=texture2DGradEXT(tex,coord,turn*dFdx(uv)*scale,turn*dFdy(uv)*scale).rgb;
          if(grass) {
            vec3 mean=texture2DLodEXT(tex,coord,7.0).rgb;
            value=clamp(value-mean*0.65+vec3(0.11,0.13,0.065),0.025,0.65);
          }
          if(normalData) {
            vec2 n=value.xy*2.0-1.0;
            value.xy=vec2(dot(turn[0],n),dot(turn[1],n))*0.5+0.5;
          }
          return value;
        }
        vec3 atlasSample(sampler2D tex, vec2 uv, bool grass, bool normalData) {
          vec2 q=uv*0.72, cell=floor(q), f=fract(q);
          vec2 a=cell, b=cell+vec2(1,0), c=cell+vec2(0,1);
          vec3 w=vec3(1.0-f.x-f.y,f.x,f.y);
          if(f.x+f.y>1.0) { a=cell+1.0; w=vec3(f.x+f.y-1.0,1.0-f.y,1.0-f.x); }
          w=pow(max(w,vec3(0.0)),vec3(1.5)); w/=dot(w,vec3(1.0));
          return atlasPatch(tex,uv,a,grass,normalData)*w.x+atlasPatch(tex,uv,b,grass,normalData)*w.y+atlasPatch(tex,uv,c,grass,normalData)*w.z;
        }`,
        )
        .replace(
          "#include <map_fragment>",
          `
          vec3 soil=atlasSample(map,vMapUv,false,false)*1.7;
          vec3 track=atlasSample(uAtlasRoad,vMapUv*1.2,false,false);
          vec3 leaves=atlasSample(uAtlasLeaf,vMapUv*1.3,false,false)*1.2;
          vec3 grass=atlasSample(uAtlasGrass,vMapUv*1.55,true,false);
          float grain=dot(soil,vec3(0.2126,0.7152,0.0722));
          float fine=dot(track,vec3(0.2126,0.7152,0.0722));
          vec3 mineral=vColor*(0.72+grain*0.85);
          vec3 cover=vAtlasCover*(0.82+fine*1.1);
          vec3 habitat=mix(mineral,cover,clamp(vAtlasHabitat.y,0.0,0.85));
          float forest=vAtlasHabitat.x;
          vec3 floor=mix(soil,leaves,0.32+vAtlasSurface.y*0.4);
          floor=mix(floor,grass,clamp(0.3+vAtlasHabitat.y*0.55-vAtlasSurface.y*0.25,0.0,0.8));
          habitat=mix(habitat,floor,forest);
          habitat*=1.0-vAtlasSurface.z*0.18;
          vec3 road=mix(vColor*(0.8+fine*2.8),mix(track*3.4,vec3(0.38,0.285,0.17),0.38),forest);
          habitat=mix(habitat,road,vAtlasSurface.x);
          habitat=mix(habitat,habitat*vec3(0.48,0.55,0.52),vAtlasShore*0.75);
          diffuseColor.rgb*=mix(vec3(0.227,0.282,0.345),habitat,vAtlasHabitat.z);
        `,
        )
        // The vertex color is the mineral tint above, not another multiplier.
        .replace("#include <color_fragment>", "")
        .replace(
          "#include <roughnessmap_fragment>",
          "float roughnessFactor = mix(0.96, 0.68, vAtlasShore);",
        )
        .replace(
          "#include <normal_fragment_maps>",
          THREE.ShaderChunk.normal_fragment_maps
            .replaceAll(
              "texture2D( normalMap, vNormalMapUv )",
              "vec4(atlasSample(normalMap, vNormalMapUv, false, true), 1.0)",
            )
            .replace(
              "mapN.xy *= normalScale;",
              "mapN.xy *= normalScale * mix(1.0, 0.6, vAtlasSurface.x) * vAtlasHabitat.z;",
            ),
        );
    };
    material.customProgramCacheKey = () => "world-map-habitats-v2";
    return { material, textures };
  }, [sources, gl]);
  useEffect(
    () => () => {
      surface.material.dispose();
      for (const texture of surface.textures) texture.dispose();
    },
    [surface],
  );
  return <primitive object={surface.material} attach="material" />;
};
