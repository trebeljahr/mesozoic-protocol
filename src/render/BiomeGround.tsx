import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Biome } from "../biomes";
import { TERRAIN_PALETTE } from "./terrainPalette";
import { WorldMapSoilMaterial } from "./WorldMapSoilMaterial";
import {
  MAP_FACILITIES,
  mapHabitatDensity,
  mapHabitatY,
  mapNodeDistance,
  mapNoise,
  mapRouteDistance,
  mapShoreDistance,
  smoothMap,
} from "./worldMapLandscape";

const BANDS: { biome: Biome; upper: number }[] = [
  { biome: "forest", upper: -9 },
  { biome: "snow", upper: -2 },
  { biome: "desert", upper: 5 },
  { biome: "wasteland", upper: 12 },
  { biome: "lava", upper: 19 },
  { biome: "alien", upper: Infinity },
];
const PALETTES = BANDS.map(({ biome }) => ({
  mineral: new THREE.Color(TERRAIN_PALETTE[biome].mineral),
  cover: new THREE.Color(TERRAIN_PALETTE[biome].cover),
  amount: TERRAIN_PALETTE[biome].coverAmount,
}));

// Shadow-receiving mineral/grass/leaf surface. Keep the ground flat like the
// levels: props, authored water and the editor all share the same zero plane.
export const BiomeGround = ({
  width,
  height,
  segments = 320,
}: {
  width: number;
  height: number;
  segments?: number;
}) => {
  const geometry = useMemo(() => {
    const geom = new THREE.PlaneGeometry(
      width,
      height,
      segments,
      Math.round((segments * height) / width),
    );
    geom.rotateX(-Math.PI / 2);
    const pos = geom.attributes.position,
      uv = geom.attributes.uv;
    const colors = new Float32Array(pos.count * 3),
      covers = new Float32Array(pos.count * 3);
    const surfaces = new Float32Array(pos.count * 3),
      habitats = new Float32Array(pos.count * 3);
    const shores = new Float32Array(pos.count);
    const mineral = new THREE.Color(),
      cover = new THREE.Color();
    const axis = (value: number, extent: number) => {
      const t = Math.abs(value) / (extent / 2),
        core = Math.min(52, extent * 0.4);
      return (
        Math.sign(value) *
        (t < 0.88 ? (t / 0.88) * core : core + ((t - 0.88) / 0.12) ** 2 * (extent / 2 - core))
      );
    };
    for (let i = 0; i < pos.count; i++) {
      const x = axis(pos.getX(i), width),
        y = -axis(pos.getZ(i), height);
      pos.setXYZ(i, x, 0, -y);
      uv.setXY(i, x / 3, -y / 3);
      const hy = mapHabitatY(x, y);
      let band = BANDS.findIndex((b) => hy <= b.upper);
      let next = band,
        blend = 0;
      for (let j = 0; j < BANDS.length - 1; j++) {
        if (Math.abs(hy - BANDS[j].upper) < 1.8) {
          band = j;
          next = j + 1;
          blend = smoothMap(-1.8, 1.8, hy - BANDS[j].upper);
          break;
        }
      }
      const a = PALETTES[band],
        b = PALETTES[next];
      mineral.copy(a.mineral).lerp(b.mineral, blend);
      cover.copy(a.cover).lerp(b.cover, blend);
      mineral.toArray(colors, i * 3);
      cover.toArray(covers, i * 3);
      const inAtlas = Math.abs(x) < 52 && Math.abs(y) < 48;
      shores[i] = inAtlas ? 1 - smoothMap(-0.1, 1.1, mapShoreDistance(x, y)) : 0;
      const density = inAtlas ? mapHabitatDensity(x, y) : { grove: 0, rock: 0 };
      const noise = mapNoise(x * 0.18, y * 0.18);
      const route = inAtlas ? 1 - smoothMap(0.28, 0.95, mapRouteDistance(x, y)) : 0;
      const node = inAtlas ? 1 - smoothMap(1.5, 2.7, mapNodeDistance(x, y)) : 0;
      const apron = inAtlas
        ? Math.max(
            ...MAP_FACILITIES.map(
              (f) =>
                1 - smoothMap(f.radius - 0.8, f.radius + 0.8, Math.hypot(x - f.pos.x, y - f.pos.y)),
            ),
          )
        : 0;
      surfaces[i * 3] = Math.max(route, node * 0.85, apron * 0.85);
      surfaces[i * 3 + 1] = density.grove;
      surfaces[i * 3 + 2] = density.rock;
      habitats[i * 3] = band === 0 ? 1 - blend : 0;
      habitats[i * 3 + 1] =
        (a.amount * (1 - blend) + b.amount * blend) * (0.28 + noise * 0.55 + density.grove * 0.3);
      habitats[i * 3 + 2] = smoothMap(
        0,
        24,
        Math.min(width / 2 - Math.abs(x), height / 2 - Math.abs(y)),
      );
    }
    geom.setAttribute("atlasShore", new THREE.BufferAttribute(shores, 1));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geom.setAttribute("atlasCover", new THREE.BufferAttribute(covers, 3));
    geom.setAttribute("atlasSurface", new THREE.BufferAttribute(surfaces, 3));
    geom.setAttribute("atlasHabitat", new THREE.BufferAttribute(habitats, 3));
    return geom;
  }, [width, height, segments]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} receiveShadow>
      <WorldMapSoilMaterial />
    </mesh>
  );
};
