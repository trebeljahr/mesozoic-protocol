import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Biome } from "../biomes";
import { mulberry32 } from "../sim/random";

export const CARCASS_PALETTES: Record<
  Biome,
  { skin: string; stain: string; strength: number; splats: string[] }
> = {
  forest: { skin: "#b3a77f", stain: "#4c5c36", strength: 0.35, splats: ["#30351c", "#39261a"] },
  snow: { skin: "#c3cdd0", stain: "#a1b9c3", strength: 0.25, splats: ["#52494a", "#4f5b60"] },
  desert: { skin: "#c3a477", stain: "#725834", strength: 0.3, splats: ["#624524", "#513a26"] },
  wasteland: { skin: "#a69578", stain: "#51472f", strength: 0.45, splats: ["#393329", "#43321f"] },
  lava: { skin: "#877064", stain: "#161310", strength: 0.9, splats: ["#1c1715", "#302019"] },
  alien: { skin: "#9a8aa5", stain: "#365d53", strength: 0.45, splats: ["#193f3b", "#342945"] },
};

// Clone only the material. Textures and skinned geometry remain loader-owned;
// no biome treatment can bleed back into living enemies or another carcass.
export function carcassMaterial(source: THREE.Material, biome: Biome, seed = 0): THREE.Material {
  const material = source.clone() as THREE.MeshStandardMaterial;
  const palette = CARCASS_PALETTES[biome];
  if (material.color) material.color.multiply(new THREE.Color(palette.skin));
  if (material.emissive) material.emissive.set(0);
  material.emissiveIntensity = 0;
  material.metalness = 0;
  material.roughness = 1;
  material.toneMapped = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.remainsStain = { value: new THREE.Color(palette.stain) };
    shader.uniforms.remainsFrost = { value: biome === "snow" ? 0.55 : 0 };
    shader.uniforms.remainsStrength = { value: palette.strength };
    // One stable choice for every material on a body; most remain dark and charred.
    const random = mulberry32(seed);
    shader.uniforms.remainsAsh = { value: biome === "lava" && random() < 0.4 ? 0.65 + random() * 0.25 : 0 };
    shader.vertexShader = `varying vec3 vRemainsPosition;\n${shader.vertexShader}`.replace(
      "#include <project_vertex>",
      "vRemainsPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>",
    );
    shader.fragmentShader = `
      varying vec3 vRemainsPosition;
      uniform vec3 remainsStain;
      uniform float remainsStrength, remainsFrost, remainsAsh;
      float remainsHash(vec3 p) { return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
      float remainsNoise(vec3 p) {
        vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(remainsHash(i),remainsHash(i+vec3(1,0,0)),f.x),
          mix(remainsHash(i+vec3(0,1,0)),remainsHash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(remainsHash(i+vec3(0,0,1)),remainsHash(i+vec3(1,0,1)),f.x),
          mix(remainsHash(i+vec3(0,1,1)),remainsHash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      ${shader.fragmentShader}`.replace(
      "#include <color_fragment>",
      `
        #include <color_fragment>
        float patina=remainsNoise(vRemainsPosition*3.2)*0.75+remainsNoise(vRemainsPosition*11.0)*0.25;
        diffuseColor.rgb *= mix(vec3(1.0),remainsStain,smoothstep(0.25,0.7,patina)*remainsStrength);
        diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.6,0.69,0.72),remainsFrost*smoothstep(0.2,0.65,patina));
        float ash=remainsNoise(vRemainsPosition*1.8+vec3(17.0))*0.7+patina*0.3;
        diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.57,0.54,0.49),remainsAsh*smoothstep(0.28,0.65,ash));
      `,
    );
  };
  material.customProgramCacheKey = () => `carcass-patina-${biome}`;
  return material;
}

type SurfacePoint = { position: THREE.Vector3; normal: THREE.Vector3 };

// Sample the actual frozen skin, keeping only the upper face in each XZ cell.
// Crystals grow from the fallen body rather than its standing bind-pose bounds.
export function carcassGrowthPoints(
  body: THREE.Object3D,
  span: number,
  seed: number,
): SurfacePoint[] {
  body.updateMatrixWorld(true);
  const cells = new Map<string, SurfacePoint>();
  const cellSize = span * 0.16;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const edge = new THREE.Vector3(),
    normal = new THREE.Vector3();
  body.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const geometry = mesh.geometry;
    const count = geometry.index?.count ?? geometry.attributes.position.count;
    for (let i = 0; i < count; i += 3) {
      const index = (j: number) => geometry.index?.getX(j) ?? j;
      mesh.getVertexPosition(index(i), a).applyMatrix4(mesh.matrixWorld);
      mesh.getVertexPosition(index(i + 1), b).applyMatrix4(mesh.matrixWorld);
      mesh.getVertexPosition(index(i + 2), c).applyMatrix4(mesh.matrixWorld);
      normal.subVectors(b, a).cross(edge.subVectors(c, a)).normalize();
      if (normal.y < 0.35) continue;
      const position = a
        .clone()
        .add(b)
        .add(c)
        .multiplyScalar(1 / 3);
      const key = `${Math.floor(position.x / cellSize)},${Math.floor(position.z / cellSize)}`;
      if ((cells.get(key)?.position.y ?? -Infinity) < position.y)
        cells.set(key, { position, normal: normal.clone() });
    }
  });
  const rng = mulberry32(seed);
  return [...cells.values()]
    .map((point) => ({ point, rank: rng() }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5)
    .map(({ point }) => point);
}

export function createCarcassCrystals(
  body: THREE.Object3D,
  span: number,
  seed: number,
): THREE.Mesh | null {
  const points = carcassGrowthPoints(body, span, seed);
  if (!points.length) return null;
  const rng = mulberry32(seed + 53);
  const pieces: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const point of points) {
    for (let i = 0; i < 3; i++) {
      const height = span * (i === 0 ? 0.2 : 0.09 + rng() * 0.05);
      const radius = height * 0.23;
      const direction = point.normal
        .clone()
        .add(new THREE.Vector3((rng() - 0.5) * 0.65, 0.45, (rng() - 0.5) * 0.65))
        .normalize();
      const shard = new THREE.CylinderGeometry(radius * 0.32, radius, height * 0.7, 5);
      const tip = new THREE.ConeGeometry(radius * 0.32, height * 0.3, 5);
      shard.translate(0, height * 0.35, 0);
      tip.translate(0, height * 0.85, 0);
      const rotation = new THREE.Quaternion().setFromUnitVectors(up, direction);
      for (const geometry of [shard, tip]) {
        geometry.applyQuaternion(rotation);
        const position = point.position.clone().addScaledVector(point.normal, -span * 0.008);
        geometry.translate(position.x, position.y, position.z);
        const color = new THREE.Color(i === 0 ? "#55b8c4" : "#9177bf");
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        for (let j = 0; j < colors.length; j += 3) color.toArray(colors, j);
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        pieces.push(geometry);
      }
    }
  }
  const geometry = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.48,
    metalness: 0.12,
    emissive: "#244b53",
    emissiveIntensity: 0.3,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.raycast = () => {};
  return mesh;
}
