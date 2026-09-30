import { useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { GRAPHICS_QUALITY } from "./effectsTunables";

const LOW = GRAPHICS_QUALITY === "low";
const MAPS = [
  "/textures/terrain/compacted-dirt/albedo.jpg",
  ...(LOW ? [] : ["/textures/terrain/compacted-dirt/normal.jpg"]),
];

// The atlas shares the levels' mineral grain, at a scale suited to distant
// viewing. Neutral luminance preserves snow, ash and alien habitat colors.
export const WorldMapSoilMaterial = () => {
  const sources = useLoader(THREE.TextureLoader, MAPS);
  const gl = useThree((s) => s.gl);
  const surface = useMemo(() => {
    const textures = sources.map((source, i) => {
      const texture = source.clone();
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = i === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = Math.min(4, gl.capabilities.getMaxAnisotropy());
      texture.needsUpdate = true;
      return texture;
    });
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: textures[0],
      normalMap: textures[1] ?? null,
      normalScale: new THREE.Vector2(0.24, 0.24),
      roughness: 0.94,
    });
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `
        vec3 fine = texture2D(map, vMapUv).rgb;
        vec3 broad = texture2D(map, vMapUv * 0.173 + vec2(0.31, 0.73)).rgb;
        float grain = dot(fine, vec3(0.2126, 0.7152, 0.0722));
        float strata = dot(broad, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb *= clamp(0.66 + grain * 2.8 + strata * 1.2, 0.68, 1.24);
        `,
      );
    };
    material.customProgramCacheKey = () => "world-map-mineral-v1";
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
