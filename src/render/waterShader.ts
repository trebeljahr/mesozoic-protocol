import * as THREE from "three";
import type { Bridge, FlowPalette } from "../flowGeometry";

// Shared fluid-surface shader for rivers and lakes (water, lava, toxic, etc.).
// Originally lived inside ForestWater.tsx hard-wired to a blue-water palette;
// hoisted here so the dev editor's Rivers component and the per-level
// ForestWaterGroup can both render flowing surfaces with the same fresnel +
// ripple + foam + bridge-wake treatment, themed off a FlowPalette.
//
// Palette-driven colours:
//   - uColorDeep     = palette.fluidEmissive (centre-of-ribbon base)
//   - uColorShallow  = palette.fluidColor    (mixed in toward the bank edge)
//   - uColorFoam     = derived light tint    (foam band + wake foam)
//   - uEmissiveBoost = palette.fluidEmissiveIntensity (scales the trailing
//                      additive emissive so lava reads hot vs water reads wet)

const VERT = /* glsl */ `
#include <fog_pars_vertex>
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vViewDir;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vViewDir = normalize(cameraPosition - wp.xyz);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <fog_pars_fragment>

uniform float uTime;
uniform float uIsJoint;
uniform vec4 uBridges[8];
uniform int uBridgeCount;
uniform vec3 uColorDeep;
uniform vec3 uColorShallow;
uniform vec3 uColorFoam;
uniform vec3 uEmissiveTint;
uniform float uEmissiveBoost;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vViewDir;

float ripple(vec2 p) {
  return sin(p.x * 5.0 + p.y * 2.0)  * 0.35
       + sin(p.x * 11.0 - p.y * 3.5) * 0.20
       + sin(p.y * 7.0 + p.x * 1.5)  * 0.15;
}

void main() {
  // 0 = center, 1 = edge (cross-river for rivers, radial for lakes)
  float edge = uIsJoint > 0.5
    ? clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0)
    : abs(vUv.y - 0.5) * 2.0;

  // Rivers flow along vUv.x (cumulative length downstream); lakes have no
  // flow direction and drift in world space. Two layers at different scales
  // and speeds give the surface motion some parallax.
  vec2 sp, sp2;
  if (uIsJoint > 0.5) {
    sp  = vWorldPos.xz * 1.4 + vec2(uTime * 0.32, uTime * 0.14);
    sp2 = vWorldPos.xz * 2.6 + vec2(-uTime * 0.22, uTime * 0.30);
  } else {
    sp  = vec2(vUv.x * 1.6 - uTime * 1.0, vUv.y * 3.0);
    sp2 = vec2(vUv.x * 3.0 - uTime * 1.6, vUv.y * 5.0);
  }
  float r = ripple(sp);
  float r2 = ripple(sp2);
  r = r * 0.65 + r2 * 0.45;

  // Bridge wake disruption
  float wake = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uBridgeCount) break;
    float d = length(vWorldPos.xz - uBridges[i].xy);
    wake += 1.0 - smoothstep(0.0, uBridges[i].z, d);
  }
  wake = clamp(wake, 0.0, 1.0);

  float turb = sin(vWorldPos.x * 18.0 + uTime * 2.5)
             * sin(vWorldPos.z * 18.0 + uTime * 1.8);
  r += turb * wake * 0.5;

  // Deep center -> shallow edge gradient
  vec3 col = mix(uColorDeep, uColorShallow, edge * edge);
  col += r * 0.09;

  // Edge foam — river banks (uIsJoint=0) and lake rims (uIsJoint=1).
  float foam = smoothstep(0.72, 0.94, edge);
  float foamBreak = sin(vWorldPos.x * 12.0 + uTime * 0.7)
                  * sin(vWorldPos.z * 12.0 + uTime * 0.5);
  foam *= max(0.0, 0.5 + 0.5 * foamBreak);
  col = mix(col, uColorFoam, foam * 0.55);

  // Wake foam
  col = mix(col, uColorFoam, wake * (0.25 + 0.25 * abs(turb)) * 0.4);

  // Fresnel — wetness sheen
  float fresnel = pow(1.0 - max(dot(vec3(0.0, 1.0, 0.0), normalize(vViewDir)), 0.0), 3.5);
  col += fresnel * 0.10;

  // Moving specular highlight (aligned with scene directional light)
  vec3 L = normalize(vec3(0.45, 0.84, 0.32));
  vec3 N = normalize(vec3(r * 0.12, 1.0, r * 0.08));
  vec3 H = normalize(L + normalize(vViewDir));
  col += pow(max(dot(N, H), 0.0), 64.0) * 0.22;

  // Palette-driven trailing emissive — wet sheen for water, glow for lava/toxic.
  col += uEmissiveTint * (0.18 * uEmissiveBoost);

  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

const hexToVec3 = (hex: string): THREE.Vector3 => {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
};

const lerpColor = (a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 =>
  new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

// Derive a foam tint from the palette. Most fluids foam toward near-white,
// but a hot palette (lava) should bias toward bright ember-yellow so the
// crests read as cooled molten froth rather than steam.
const deriveFoamColor = (palette: FlowPalette): THREE.Vector3 => {
  const fluid = hexToVec3(palette.fluidColor);
  const emissive = hexToVec3(palette.fluidEmissive);
  // For low-emissive palettes (water): pure light wash. For hot palettes
  // (lava emissiveIntensity ≥ 1): blend in the emissive so foam glows.
  const hotShare = Math.min(1, palette.fluidEmissiveIntensity / 1.6);
  const cold = lerpColor(fluid, new THREE.Vector3(1, 1, 1), 0.78);
  const hot = lerpColor(cold, emissive, hotShare * 0.5);
  return hot;
};

const buildBridgeUniforms = (bridges: Bridge[]) => {
  const count = Math.min(bridges.length, 8);
  const arr: THREE.Vector4[] = [];
  for (let i = 0; i < count; i++) {
    const b = bridges[i];
    const r = b.kind === "plaza" ? b.radius * 1.2 : b.length * 0.45;
    arr.push(new THREE.Vector4(b.pos.x, -b.pos.y, r, 1));
  }
  while (arr.length < 8) arr.push(new THREE.Vector4());
  return { arr, count };
};

export type WaterMaterialOpts = {
  isJoint?: boolean;
  bridges?: Bridge[];
};

export const makeWaterMaterial = (
  palette: FlowPalette,
  { isJoint = false, bridges = [] }: WaterMaterialOpts = {},
): THREE.ShaderMaterial => {
  const bd = buildBridgeUniforms(bridges);
  const deep = hexToVec3(palette.fluidEmissive);
  const shallow = hexToVec3(palette.fluidColor);
  const foam = deriveFoamColor(palette);
  const emissiveTint = hexToVec3(palette.fluidEmissive);
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsLib.fog,
      uTime: { value: 0 },
      uIsJoint: { value: isJoint ? 1.0 : 0.0 },
      uBridges: { value: bd.arr },
      uBridgeCount: { value: bd.count },
      uColorDeep: { value: deep },
      uColorShallow: { value: shallow },
      uColorFoam: { value: foam },
      uEmissiveTint: { value: emissiveTint },
      uEmissiveBoost: { value: palette.fluidEmissiveIntensity },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: true,
    toneMapped: false,
  });
};
