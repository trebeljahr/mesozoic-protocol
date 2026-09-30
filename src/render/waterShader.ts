import * as THREE from "three";
import type { Bridge, FlowPalette } from "../flowGeometry";

import type { FluidField } from "./fluidField";

// Shared, world-scale surface. The optional union field removes false banks
// at ribbon/pool joins; the fallback also supports standalone material users.
const VERT = /* glsl */ `
#include <fog_pars_vertex>

// World-space XZ flow direction at this vertex. Ribbon geometry writes the
// curve tangent here; lake discs supply zeros (no preferred direction).
attribute vec2 aFlow;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vViewDir;
varying vec2 vFlow;

void main() {
  vUv = uv;
  vFlow = aFlow;
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
uniform vec3 uColorCrust;
uniform vec3 uEmissiveTint;
uniform float uEmissiveBoost;
// 0 = wet fluid (water, toxic goo), 1 = molten (lava crust + glowing cracks).
uniform float uMolten;
// Downstream advection speed, world units/sec. Lava creeps, water runs.
uniform float uFlowSpeed;
uniform sampler2D uSurfaceField;
uniform vec4 uFieldBounds;
uniform float uHasField;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vViewDir;
varying vec2 vFlow;

// Scene key light — matches <directionalLight position={[14, 26, 10]}/> in
// Scene.tsx, normalized. Kept as a constant so the water picks up glints from
// the same direction as everything else the sun hits.
const vec3 SUN = vec3(0.451, 0.838, 0.322);

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Value noise returning (value, d/dx, d/dy). The derivatives let us build a
// surface normal from one evaluation per octave instead of finite-differencing
// the whole height field three times.
vec3 noised(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  float k1 = b - a;
  float k2 = c - a;
  float k3 = a - b - c + d;
  return vec3(
    a + k1 * u.x + k2 * u.y + k3 * u.x * u.y,
    du.x * (k1 + k3 * u.y),
    du.y * (k2 + k3 * u.x)
  );
}

void main() {
  // 0 = centre, 1 = edge (cross-river for ribbons, radial for lake discs).
  float edge = uIsJoint > 0.5
    ? clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0)
    : clamp(abs(vUv.y - 0.5) * 2.0, 0.0, 1.0);

  vec3 field = texture2D(uSurfaceField,
    (vec2(vWorldPos.x, -vWorldPos.z) - uFieldBounds.xy) / uFieldBounds.zw).rgb;
  vec2 current = mix(vFlow, field.gb * 2.0 - 1.0, uHasField);
  float bankDistance = mix((1.0 - edge) * 0.9, field.r * 1.2, uHasField);
  float depth = smoothstep(0.02, 0.52, bankDistance);
  float shore = 1.0 - smoothstep(0.02, 0.30, bankDistance);

  // Two overlapping, bounded advection phases prevent stretching at bends
  // after long play sessions. Never rotate the absolute world coordinates
  // by a changing tangent: that creates swimming/plaid patterns on curves.
  vec2 velocity = vec2(0.025, 0.018) + current * uFlowSpeed;
  float phase = fract(uTime * 0.10);
  float phaseB = fract(phase + 0.5);
  float blend = abs(phase * 2.0 - 1.0);
  vec2 p = vWorldPos.xz * 0.85;
  vec3 a = noised(p - velocity * phase * 8.5);
  vec3 b = noised(p - velocity * phaseB * 8.5);
  vec3 broad = mix(a, b, blend);
  // Offset, rotated detail breaks the axis-aligned value-noise grid.
  mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
  vec3 detail = noised(turn * p * vec2(0.85, 3.2) + vec2(13.7, 5.2) - uTime * 0.035);
  float height = broad.x * 0.80 + detail.x * 0.20;
  vec2 gradW = broad.yz * 0.68 + vec2(dot(turn[0], detail.yz * vec2(0.85, 3.2)), dot(turn[1], detail.yz * vec2(0.85, 3.2))) * 0.17;

  float wake = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uBridgeCount) break;
    float d = length(vWorldPos.xz - uBridges[i].xy);
    wake += 1.0 - smoothstep(0.0, uBridges[i].z, d);
  }
  wake = clamp(wake, 0.0, 1.0);
  vec3 N = normalize(vec3(-gradW.x * 0.11, 1.0, -gradW.y * 0.11));
  vec3 V = normalize(vViewDir);
  vec3 col = mix(uColorShallow, uColorDeep, depth);

  // Quiet petrol depths; highlights describe movement, not a crumpled foil
  // normal map. Toxic pools keep localized emissive eddies instead of glitter.
  float toxic = (1.0 - uMolten) * smoothstep(0.25, 0.55, uEmissiveBoost);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
  vec3 wet = col * (0.96 + height * 0.08);
  wet += vec3(0.23, 0.32, 0.34) * fres * 0.12;
  vec3 H = normalize(SUN + V);
  float glint = pow(max(dot(N, H), 0.0), 48.0);
  wet += vec3(0.62, 0.73, 0.72) * glint * 0.065 * (1.0 - shore);
  float crest = smoothstep(0.58, 0.72, height) * (1.0 - smoothstep(0.73, 0.84, height));
  float ripple = smoothstep(0.35, 0.9, detail.z) * smoothstep(0.45, 0.70, detail.x);
  wet = mix(wet, uColorFoam, (ripple * 0.04 + crest * (0.018 + wake * 0.045)) * depth * (1.0 - toxic * 0.65));
  wet += uEmissiveTint * toxic * smoothstep(0.52, 0.76, height) * 0.16 * depth;
  // Contact is a dark wet shelf, never a permanent white outline.
  wet *= 1.0 - shore * 0.12;
  edge = 1.0 - depth;

  // -------- molten treatment (lava) --------
  // Cooled crust floats on the flow: high, slow-moving parts of the height
  // field go dark and matte, troughs stay incandescent. Crust thickens toward
  // the banks where the flow is slowest.
  if (uMolten > 0.001) {
  float platesA = noised(p * 2.8 - velocity * phase * 8.5).x;
  float platesB = noised(p * 2.8 - velocity * phaseB * 8.5).x;
  float moltenHeight = mix(platesA, platesB, blend) * 0.65 + height * 0.35;
  float crust = smoothstep(0.26, 0.56, moltenHeight + edge * 0.30);
  vec3 molten = mix(uColorDeep * 1.15, uColorCrust, crust);
  float cracks = pow(1.0 - crust, 2.0);
  molten += uEmissiveTint * cracks * 0.55;
  // Thin hot rim where crust plates part.
  molten += uColorFoam * smoothstep(0.44, 0.52, moltenHeight + edge * 0.30)
                       * (1.0 - smoothstep(0.52, 0.62, moltenHeight + edge * 0.30)) * 0.35;
  molten = mix(molten, uColorCrust, wake * 0.35);

  wet = mix(wet, molten, uMolten);
  }
  col = wet;

  // Palette-driven trailing emissive — wet sheen for water, ambient heat for
  // lava/toxic. Scaled down for molten since the cracks already carry it.
  col += uEmissiveTint * (0.16 * uEmissiveBoost) * (1.0 - uMolten * 0.6);

  float aa = max(fwidth(bankDistance), 0.015);
  // Keep the mesh silhouette at miter corners, where the sampled capsule
  // field is conservative. The union distance fills interior join edges.
  float shapeDistance = (1.0 - (uIsJoint > 0.5
    ? clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0)
    : clamp(abs(vUv.y - 0.5) * 2.0, 0.0, 1.0))) * 0.9;
  float alpha = smoothstep(0.0, max(0.07, aa), max(bankDistance, shapeDistance));

  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}
`;

const hexToVec3 = (hex: string): THREE.Vector3 => {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
};

const lerpColor = (a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 =>
  new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

// How "molten" a palette is. Lava sits at emissiveIntensity 1.6, toxic goo at
// 0.55 and water at 0.18, so the ramp cleanly separates lava from the two
// fluids that should stay wet-looking.
const moltenFactor = (palette: FlowPalette): number => {
  const x = (palette.fluidEmissiveIntensity - 0.9) / 0.6;
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

// Derive a foam tint from the palette. Most fluids foam toward near-white,
// but a hot palette (lava) should bias toward bright ember-yellow so the
// crests read as molten seams rather than steam.
const deriveFoamColor = (palette: FlowPalette): THREE.Vector3 => {
  const fluid = hexToVec3(palette.fluidColor);
  const emissive = hexToVec3(palette.fluidEmissive);
  const hotShare = moltenFactor(palette);
  const cold = lerpColor(fluid, new THREE.Vector3(1, 1, 1), 0.72);
  return lerpColor(cold, emissive, hotShare * 0.6);
};

// Cooled-crust tint — the fluid colour taken most of the way to a dark, warm
// basalt. Only visible on molten palettes.
const deriveCrustColor = (palette: FlowPalette): THREE.Vector3 => {
  const fluid = hexToVec3(palette.fluidColor);
  return lerpColor(fluid, new THREE.Vector3(0.012, 0.009, 0.008), 0.96);
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
  field?: FluidField;
};

export const makeWaterMaterial = (
  palette: FlowPalette,
  { isJoint = false, bridges = [], field }: WaterMaterialOpts = {},
): THREE.ShaderMaterial => {
  const bd = buildBridgeUniforms(bridges);
  const molten = moltenFactor(palette);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsLib.fog,
      uTime: { value: 0 },
      uSurfaceField: { value: field?.texture ?? null },
      uFieldBounds: { value: field?.bounds ?? new THREE.Vector4(0, 0, 1, 1) },
      uHasField: { value: field ? 1 : 0 },
      uIsJoint: { value: isJoint ? 1.0 : 0.0 },
      uBridges: { value: bd.arr },
      uBridgeCount: { value: bd.count },
      uColorDeep: { value: hexToVec3(palette.fluidEmissive) },
      uColorShallow: { value: hexToVec3(palette.fluidColor) },
      uColorFoam: { value: deriveFoamColor(palette) },
      uColorCrust: { value: deriveCrustColor(palette) },
      uEmissiveTint: { value: hexToVec3(palette.fluidEmissive) },
      uEmissiveBoost: { value: palette.fluidEmissiveIntensity },
      uMolten: { value: molten },
      // Field current is zero in pools. Lava moves at a fraction of water speed.
      uFlowSpeed: { value: 0.18 - 0.13 * molten },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: true,
    toneMapped: false,
    transparent: true,
    // The surface sits a hair above the opaque ground and never occludes
    // anything, so writing depth would only make it fight the placement plane
    // and self-sort badly where two rivers overlap.
    depthWrite: false,
  });
  material.defaultAttributeValues.aFlow = [0, 0];
  return material;
};
