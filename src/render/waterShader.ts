import * as THREE from "three";
import type { Bridge, FlowPalette } from "../flowGeometry";

// Shared fluid-surface shader for rivers and lakes (water, lava, toxic, etc.).
// Every biome's flow geometry goes through this material — FlowWater.tsx
// builds the ribbon/disc meshes, this file gives them a surface.
//
// The previous version summed three sine waves in UV space, which produced a
// visible diagonal plaid across every river and a hard white foam band down
// both banks. Two structural problems fed that:
//
//   1. The ripple domain was UV-based, but the two geometry builders disagree
//      on what U means (world arc length in FlowWater's ribbon, normalized
//      0..1 in Rivers.tsx's spline). A long river got 1.6 ripple cycles
//      smeared over its whole length; a short one got dozens.
//   2. Sine sums have no gradient information, so the "specular" term used a
//      near-constant normal and the surface never read as a height field.
//
// Both are fixed by working in WORLD space along a per-vertex flow direction
// (the `aFlow` attribute, see FlowWater.tsx). Ripples are value-noise octaves
// stretched along the flow axis and advected downstream, and the noise is
// evaluated with analytic derivatives so we get a real surface normal for
// free — that normal drives fresnel, specular glints and whitecaps.
//
// Palette-driven colours:
//   - uColorDeep     = palette.fluidEmissive (channel centre)
//   - uColorShallow  = palette.fluidColor    (mixed in toward the bank)
//   - uColorFoam     = derived light tint    (foam band + wake foam)
//   - uColorCrust    = derived dark tint     (lava's cooled crust)
//   - uEmissiveBoost = palette.fluidEmissiveIntensity, which also selects
//                      between the "wet" treatment (water/toxic) and the
//                      "molten" treatment (lava crust over glowing cracks).

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
// 1 = directional ribbon (ripples stretch downstream), 0 = still water
// (isotropic, so a pond doesn't read as smeared streaks).
uniform float uAniso;

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

  // Flow frame. Ribbons carry a real tangent; lakes fall back to a fixed
  // diagonal so their two noise layers still slide past each other.
  float flowLen = length(vFlow);
  vec2 dir = flowLen > 1e-3 ? vFlow / flowLen : normalize(vec2(0.83, 0.56));
  vec2 side = vec2(-dir.y, dir.x);
  float s = dot(vWorldPos.xz, dir);
  float t = dot(vWorldPos.xz, side);

  // Rivers run faster mid-channel than at the banks, so ripples near the
  // centre are dragged further downstream. Cheap, and it kills the "rigid
  // conveyor belt" read the old uniform scroll had.
  float shear = mix(1.0, 0.45, edge * edge);
  float drift = uTime * uFlowSpeed * shear;

  // Three octaves. A ribbon samples the along-flow axis ~2.5x coarser than the
  // cross axis, so crests elongate downstream into streaks. A lake (uAniso=0)
  // is isotropic and tighter — ponds are only a couple of world units across,
  // so river-scale noise would give them two soft blobs and nothing else.
  float fx = 0.62 * mix(4.2, 1.0, uAniso);
  float fy = mix(2.60, 1.55, uAniso);
  vec3 n1 = noised(vec2(s * fx - drift * 1.00, t * fy));
  vec3 n2 = noised(vec2(s * fx * 2.34 - drift * 1.70, t * fy * 2.06 + 7.3));
  vec3 n3 = noised(vec2(s * fx * 5.00 - drift * 2.55, t * fy * 4.13 - 3.1));
  float height = n1.x * 0.55 + n2.x * 0.30 + n3.x * 0.15;

  // Gradient in flow-local space, rotated back into world XZ. Each octave's
  // derivative is scaled by its own domain frequency (chain rule).
  vec2 grad = vec2(
    n1.y * 0.55 * fx + n2.y * 0.30 * fx * 2.34 + n3.y * 0.15 * fx * 5.00,
    n1.z * 0.55 * fy + n2.z * 0.30 * fy * 2.06 + n3.z * 0.15 * fy * 4.13
  );
  vec2 gradW = grad.x * dir + grad.y * side;

  // Bridge wake — piers churn the surface into a foamy, choppier patch.
  float wake = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uBridgeCount) break;
    float d = length(vWorldPos.xz - uBridges[i].xy);
    wake += 1.0 - smoothstep(0.0, uBridges[i].z, d);
  }
  wake = clamp(wake, 0.0, 1.0);
  vec3 chop = noised(vec2(s * 7.0 - drift * 4.0, t * 7.0));
  height += chop.x * wake * 0.45;
  gradW += (chop.y * dir + chop.z * side) * wake * 3.0;

  // Still water gets a gentler height field — a pond's noise is tighter than
  // a river's, and full-strength normals there turn the sun glint into speckle.
  float bump = mix(0.55, 0.18, uMolten) * mix(0.6, 1.0, uAniso);
  vec3 N = normalize(vec3(-gradW.x * bump, 1.0, -gradW.y * bump));
  vec3 V = normalize(vViewDir);

  // Shoreline. The bank line is broken up by its own slow noise so the water
  // doesn't end on a mathematically perfect ribbon edge.
  float bankNoise = noised(vec2(s * 2.4 + uTime * 0.05, t * 2.4)).x;
  float bankEdge = clamp(edge + (bankNoise - 0.5) * 0.14, 0.0, 1.0);

  // The edge coord is normalized to the shape, so a fixed band there would be
  // a thin trim on a wide river and half the surface of a 2-unit pond. fwidth
  // gives the edge gradient per pixel, so this band keeps a roughly constant
  // on-screen thickness on every body of water regardless of its size.
  float band = clamp(fwidth(edge) * 16.0, 0.05, 0.32);
  float shore = smoothstep(1.0 - band * 2.5, 1.0, bankEdge);

  // Depth: opaque, dark channel in the middle grading to a lighter shallow
  // shelf at the banks.
  float depth = smoothstep(0.0, 0.80, 1.0 - bankEdge);
  vec3 col = mix(uColorShallow, uColorDeep, depth);

  // -------- wet treatment (water, toxic goo) --------
  // Sky-ish sheen where the surface tilts away from the viewer, plus tight
  // sun glints off the ripple crests.
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
  vec3 sky = mix(uColorShallow, vec3(0.78, 0.88, 1.0), 0.85);
  vec3 wet = col + height * 0.06;
  wet = mix(wet, sky, fres * 0.20 * (1.0 - shore));
  vec3 H = normalize(SUN + V);
  wet += pow(max(dot(N, H), 0.0), 64.0) * 0.38;
  wet += pow(max(dot(N, H), 0.0), 12.0) * 0.035;

  // Whitecaps on steep, tall crests — dense mid-channel where the flow is
  // fastest, and inside bridge wakes.
  float slope = clamp(length(gradW) * 0.55, 0.0, 1.0);
  float caps = smoothstep(0.62, 1.05, height * 0.65 + slope * 0.5);
  caps *= (1.0 - edge * 0.7) * (0.35 + 0.65 * wake);
  wet = mix(wet, uColorFoam, clamp(caps, 0.0, 1.0) * 0.34);

  // Bank foam — a lapping band, animated by the same noise field so it
  // breathes instead of strobing.
  float lap = 0.55 + 0.45 * sin(s * 2.2 - uTime * 1.1 + height * 6.0);
  float foam = smoothstep(1.0 - band, 1.0 - band * 0.15, bankEdge) * lap;
  wet = mix(wet, uColorFoam, foam * 0.34);

  // -------- molten treatment (lava) --------
  // Cooled crust floats on the flow: high, slow-moving parts of the height
  // field go dark and matte, troughs stay incandescent. Crust thickens toward
  // the banks where the flow is slowest.
  float crust = smoothstep(0.42, 0.78, height + edge * 0.30);
  vec3 molten = mix(uColorDeep * 1.15, uColorCrust, crust);
  float cracks = pow(1.0 - crust, 2.0);
  molten += uEmissiveTint * cracks * 0.55;
  // Thin hot rim where crust plates part.
  molten += uColorFoam * smoothstep(0.44, 0.52, height + edge * 0.30)
                       * (1.0 - smoothstep(0.52, 0.62, height + edge * 0.30)) * 0.35;
  molten = mix(molten, uColorCrust, wake * 0.35);

  col = mix(wet, molten, uMolten);

  // Palette-driven trailing emissive — wet sheen for water, ambient heat for
  // lava/toxic. Scaled down for molten since the cracks already carry it.
  col += uEmissiveTint * (0.16 * uEmissiveBoost) * (1.0 - uMolten * 0.6);

  // Shallow water lets a little ground colour through; molten stays opaque.
  // Silhouette is only antialiased, not feathered — a wide alpha ramp turned
  // ponds into blue haze with no readable shoreline. The bank still breaks up
  // irregularly because bankEdge carries the noise offset.
  float aa = max(fwidth(bankEdge) * 1.5, 0.004);
  float feather = 1.0 - smoothstep(1.0 - aa, 1.0, bankEdge);
  float alpha = (1.0 - 0.20 * smoothstep(0.45, 0.95, bankEdge)) * feather;
  alpha = mix(alpha, feather, uMolten);

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
  return lerpColor(fluid, new THREE.Vector3(0.06, 0.035, 0.03), 0.82);
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
  const molten = moltenFactor(palette);
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsLib.fog,
      uTime: { value: 0 },
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
      // Lakes only drift; rivers run, and lava runs at a fraction of water's
      // pace so it reads as viscous.
      uFlowSpeed: { value: isJoint ? 0.06 : 0.42 - 0.3 * molten },
      uAniso: { value: isJoint ? 0.0 : 1.0 },
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
};
