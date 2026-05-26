import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { CanisterPalette } from "./biomeColors";
import { measureVisibleBox } from "./measureModel";

// Procedural cloning canister — biotech-outpost backstory prop. Glass tank
// with a glowing fluid and a tiny dino specimen suspended inside; the
// indicator lights on top pulse out-of-phase with the fluid. Built from
// primitives so no DCC pipeline is required; the GLB hook below lets a
// real authored mesh drop in later without touching the call sites.

const SPECIMEN_URL = "/models/Velociraptor.glb";
// A real authored mesh would live here. When present, this component
// could switch to useGLTF(GLB_URL) and skip the procedural geometry —
// keep the slot documented even though the file doesn't exist yet.
// const GLB_URL = "/models/cloning-canister.glb";

useGLTF.preload(SPECIMEN_URL);

// Shared geometries — one tank is ~1.7m tall: 0.22 base + 1.4 glass + 0.1 cap.
const GEOMS = {
  base: new THREE.CylinderGeometry(0.36, 0.42, 0.22, 16),
  pipe: new THREE.CylinderGeometry(0.045, 0.045, 0.42, 8),
  glass: new THREE.CylinderGeometry(0.3, 0.3, 1.4, 24, 1, true),
  fluid: new THREE.CylinderGeometry(0.27, 0.27, 1.32, 20),
  capPlate: new THREE.CylinderGeometry(0.32, 0.32, 0.08, 16),
  capRing: new THREE.TorusGeometry(0.3, 0.05, 8, 24),
  indicator: new THREE.SphereGeometry(0.05, 8, 6),
  valve: new THREE.BoxGeometry(0.12, 0.06, 0.06),
};

const STEEL = new THREE.MeshStandardMaterial({
  color: "#3a4250",
  roughness: 0.55,
  metalness: 0.55,
});
const STEEL_DARK = new THREE.MeshStandardMaterial({
  color: "#1d232c",
  roughness: 0.6,
  metalness: 0.7,
});

// Specimen sits centered inside the glass cylinder.
const BASE_Y = 0.22;
const GLASS_CENTER_Y = BASE_Y + 0.7;
const CAP_PLATE_Y = BASE_Y + 1.4 + 0.04;
const CAP_RING_Y = BASE_Y + 1.4 + 0.09;
const INDICATOR_Y = BASE_Y + 1.4 + 0.14;

// Curled specimen ~0.55m tall — small enough to read as a fetus / hatchling
// floating in the tank, big enough to be legible at gameplay camera distance.
const SPECIMEN_TARGET = 0.55;

const noRaycast: THREE.Mesh["raycast"] = () => {};

// Palette-keyed material caches. Every canister in one biome reuses the
// same glass + per-submesh specimen materials so the scene doesn't end up
// with N copies of the same MeshStandardMaterial (each carrying its own
// uniforms + shader handle) when CloningVats places ~10 tanks around the
// HQs. Per-canister state (fluid pulse, indicator phases) still gets its
// own material instances below — those genuinely vary frame-to-frame.
const glassMatCache = new Map<string, THREE.MeshStandardMaterial>();
const getGlassMat = (palette: CanisterPalette): THREE.MeshStandardMaterial => {
  const key = `${palette.glass}|${palette.fluid}`;
  const cached = glassMatCache.get(key);
  if (cached) return cached;
  // MeshPhysicalMaterial with transmission gave true refraction but
  // forced an extra full framebuffer pass per frame and ate
  // disproportionate budget for a background prop. The translucent
  // MeshStandardMaterial reads as glass at gameplay camera distance
  // for a fraction of the cost.
  const m = new THREE.MeshStandardMaterial({
    color: palette.glass,
    transparent: true,
    opacity: 0.32,
    roughness: 0.2,
    metalness: 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  glassMatCache.set(key, m);
  return m;
};

type SpecimenSource = {
  source: THREE.Object3D;
  centerOffset: THREE.Vector3;
  uniformScale: number;
};
const specimenSourceCache = new Map<string, SpecimenSource>();
const getSpecimenSource = (scene: THREE.Object3D, palette: CanisterPalette): SpecimenSource => {
  // Cache a single "tinted-for-this-fluid-color" specimen tree per palette
  // so we don't re-clone materials per canister. We still cloneSkinned()
  // the cached source per canister so each tank has its own Object3D
  // wrapper (and skeleton instance), but SkeletonUtils.clone shares the
  // material refs between clones — so all canisters in one biome point at
  // the same 5-or-so MeshStandardMaterials instead of 5 × N copies.
  const key = palette.fluid;
  const cached = specimenSourceCache.get(key);
  if (cached) return cached;
  const sourceClone = cloneSkinned(scene);
  const fluidCol = new THREE.Color(palette.fluid);
  sourceClone.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const remapped = mats.map((m) => {
      if (!(m instanceof THREE.MeshStandardMaterial)) return m;
      const c = m.clone();
      c.color.lerp(fluidCol, 0.5);
      c.emissive = fluidCol.clone().multiplyScalar(0.35);
      c.transparent = true;
      c.opacity = 0.92;
      return c;
    });
    obj.material = Array.isArray(obj.material) ? remapped : remapped[0];
    obj.castShadow = false;
    obj.receiveShadow = false;
  });
  const box = measureVisibleBox(sourceClone);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const uniformScale = SPECIMEN_TARGET / maxDim;
  const entry: SpecimenSource = {
    source: sourceClone,
    centerOffset: center.multiplyScalar(uniformScale).negate(),
    uniformScale,
  };
  specimenSourceCache.set(key, entry);
  return entry;
};

type Props = {
  worldX: number;
  worldZ: number;
  yaw: number;
  palette: CanisterPalette;
  seed: number;
};

export const CloningCanister = ({ worldX, worldZ, yaw, palette, seed }: Props) => {
  const { scene } = useGLTF(SPECIMEN_URL);

  // Per-canister specimen wrapper. SkeletonUtils.clone gives this tank its
  // own Object3D + skeleton without re-cloning the (already palette-tinted)
  // materials hanging off the cached source; all canisters in one biome
  // therefore share ~5 specimen mats instead of 5 × N copies.
  const specimen = useMemo(() => {
    const src = getSpecimenSource(scene, palette);
    const cloneObj = cloneSkinned(src.source);
    cloneObj.scale.setScalar(src.uniformScale);
    cloneObj.position.copy(src.centerOffset);
    return cloneObj;
  }, [scene, palette]);

  // Fluid pulses opacity per-canister-seed, so the material must be per
  // instance — dispose it on unmount to avoid leaking on every level swap.
  const fluidMat = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.fluid),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
  }, [palette.fluid]);
  useEffect(() => () => fluidMat.dispose(), [fluidMat]);

  // Glass tube material is identical across canisters of one biome —
  // pull from the palette-keyed cache so the renderer compiles + uploads
  // it once per biome rather than once per tank.
  const glassMat = getGlassMat(palette);

  // One material per indicator so each light can pulse on its own phase.
  // Base colours alternate so neighbouring tanks don't look like they're
  // pulsing in lockstep. Per-canister mats need explicit disposal on
  // unmount so a level transition doesn't leak 3 mats per tank.
  const indicatorMats = useMemo(
    () =>
      [0, 1, 2].map((i) => {
        const base = i === 1 ? palette.indicator : palette.indicatorAlt;
        return new THREE.MeshBasicMaterial({ color: new THREE.Color(base), toneMapped: false });
      }),
    [palette.indicator, palette.indicatorAlt],
  );
  useEffect(
    () => () => {
      for (const m of indicatorMats) m.dispose();
    },
    [indicatorMats],
  );
  const indicatorBaseColors = useMemo(
    () => [0, 1, 2].map((i) => new THREE.Color(i === 1 ? palette.indicator : palette.indicatorAlt)),
    [palette.indicator, palette.indicatorAlt],
  );

  const specimenRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Fluid breathing — opacity oscillates ~0.45→0.75 over ~2s, scaled by
    // a per-canister seed so neighbours don't pulse in sync.
    const pulse01 = 0.5 + 0.5 * Math.sin(t * Math.PI + seed * 1.7);
    fluidMat.opacity = 0.45 + pulse01 * 0.3;

    // Specimen — slow Y rotation (period ~6s) + gentle vertical bob.
    if (specimenRef.current) {
      specimenRef.current.position.y = GLASS_CENTER_Y + Math.sin(t * 0.7 + seed) * 0.07;
      specimenRef.current.rotation.y = t * (Math.PI / 3) + seed;
    }

    // Indicator pulse — out of phase per light, faster than the fluid so
    // they read as a separate system (status lights vs. fluid pulse).
    for (let i = 0; i < indicatorMats.length; i++) {
      const m = indicatorMats[i];
      const k = 0.5 + 0.5 * Math.sin(t * 1.6 + seed + i * 2.1);
      m.color.copy(indicatorBaseColors[i]).multiplyScalar(0.7 + k * 1.4);
    }
  });

  const pipeAngles = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];

  return (
    <group position={[worldX, 0, worldZ]} rotation={[0, yaw, 0]}>
      {/* Steel base — stocky cylinder anchoring the tank to the ground. */}
      <mesh
        geometry={GEOMS.base}
        material={STEEL}
        position={[0, BASE_Y / 2, 0]}
        raycast={noRaycast}
        castShadow
        receiveShadow
      />
      {/* Three vertical conduits dropping from the base rim into the ground
          — sells the tank as plumbed-in equipment rather than a free-floating
          prop. */}
      {pipeAngles.map((a, i) => (
        <mesh
          key={`pipe-${i}`}
          geometry={GEOMS.pipe}
          material={STEEL_DARK}
          position={[Math.cos(a) * 0.4, 0.05, Math.sin(a) * 0.4]}
          raycast={noRaycast}
          castShadow
        />
      ))}
      {/* Glass cylinder. Hollow (openEnded) so the inner fluid surface is
          visible through the transmission pass. */}
      <mesh
        geometry={GEOMS.glass}
        material={glassMat}
        position={[0, GLASS_CENTER_Y, 0]}
        renderOrder={2}
        raycast={noRaycast}
      />
      {/* Glowing fluid — additive blend onto whatever sits behind, so the
          specimen reads as suspended in the medium rather than blocked by it. */}
      <mesh
        geometry={GEOMS.fluid}
        material={fluidMat}
        position={[0, GLASS_CENTER_Y, 0]}
        renderOrder={1}
        raycast={noRaycast}
        userData={{ bloom: true }}
      />
      {/* Specimen — cloned raptor, scaled down + bobbing inside the fluid. */}
      <group ref={specimenRef} position={[0, GLASS_CENTER_Y, 0]}>
        <primitive object={specimen} />
      </group>
      {/* Cap hardware — plate, torus ring, and a couple of valves bolted on
          for silhouette detail. */}
      <mesh
        geometry={GEOMS.capPlate}
        material={STEEL}
        position={[0, CAP_PLATE_Y, 0]}
        raycast={noRaycast}
        castShadow
      />
      <mesh
        geometry={GEOMS.capRing}
        material={STEEL_DARK}
        position={[0, CAP_RING_Y, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        raycast={noRaycast}
      />
      <mesh
        geometry={GEOMS.valve}
        material={STEEL_DARK}
        position={[0.3, CAP_PLATE_Y + 0.04, 0]}
        raycast={noRaycast}
      />
      <mesh
        geometry={GEOMS.valve}
        material={STEEL_DARK}
        position={[-0.28, CAP_PLATE_Y + 0.04, 0.1]}
        rotation={[0, Math.PI / 3, 0]}
        raycast={noRaycast}
      />
      {/* Indicator lights — additive bloom dots on the cap rim. */}
      {pipeAngles.map((a, i) => (
        <mesh
          key={`led-${i}`}
          geometry={GEOMS.indicator}
          material={indicatorMats[i]}
          position={[Math.cos(a) * 0.22, INDICATOR_Y, Math.sin(a) * 0.22]}
          raycast={noRaycast}
          userData={{ bloom: true }}
        />
      ))}
    </group>
  );
};
