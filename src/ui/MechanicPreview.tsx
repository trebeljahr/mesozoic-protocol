import { Environment, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { cloneAndCaptureBase, findClip } from "../render/animUtils";
import { ExpectedCanvasTeardown } from "../render/ExpectedCanvasTeardown";
import { HEAL_HUG_RADIUS_BY_KIND } from "../render/HealAuras.constants";
import { measureVisibleBox } from "../render/measureModel";
import {
  buildPlusGeometry,
  buildPlusMaterial,
  REGEN_PLUS_LENGTH,
} from "../render/RegenBadges.geometry";
import type { MechanicId } from "../sim/mechanicsText";
import type { DamageType, EnemyKind } from "../sim/types";
import {
  ADAPTIVE_EMISSIVE_BY_TYPE,
  ADAPTIVE_TINT_BY_TYPE,
  ENEMY_MODEL,
  HEAL_AURA_RANGE,
} from "../sim/world";

// Preview-only single-instance copies of the in-world effect renderers
// (ShieldBubbles / HealAuras / RegenBadges / model frost + adaptation
// tint from ModelEnemyMesh). The instanced versions read from the live
// world store, which we don't want to fake out for a static preview —
// but the geometries, materials, colors and pulse math are intentionally
// identical so the player sees the same visual in the compendium that
// they get in-game.

// === Visual constants ===
// Mirrored from src/render/{ShieldBubbles,HealAuras}.tsx and
// src/render/ModelEnemyMesh.tsx. Duplicated rather than re-exported
// because the in-world files keep them as module-locals; one number per
// effect is cheaper than a refactor that bloats the public surface of
// the render layer.
const SHIELD_COLOR = "#7fc8ff";
const HEAL_AURA_COLOR = "#7eff8a";
const FROST_COLOR = new THREE.Color("#cfe6ff");
const FROST_EMISSIVE = new THREE.Color("#3a6aa0");
const REGEN_BADGE_COMPENDIUM_CLEARANCE = REGEN_PLUS_LENGTH * 0.25;

// Mirrors SHIELD_RADIUS_BY_KIND in ShieldBubbles.tsx.
const SHIELD_RADIUS_BY_KIND: Record<EnemyKind, number> = {
  raptor: 0.7,
  swarm: 0.45,
  para: 0.85,
  allosaur: 1.0,
  stego: 1.0,
  armored: 1.05,
  titan: 3.0,
  boss: 5.0,
};

// One representative dino per mechanic — silhouette chosen so the
// effect reads obviously.
const PREVIEW_KIND: Record<MechanicId, EnemyKind> = {
  shielded: "armored",
  healAura: "para",
  regen: "stego",
  slow: "raptor",
  adaptation: "stego",
};

// Adaptation preview tint cycle — one stop per damage type so the
// player sees every body discoloration the herd can evolve. Order
// matches the in-game ADAPTIVE_TINT_BY_TYPE record. Each phase holds
// for ADAPT_PHASE_HOLD then crossfades over ADAPT_PHASE_FADE.
const ADAPT_PHASE_ORDER: DamageType[] = ["kinetic", "electric", "cold", "explosive", "flame"];
const ADAPT_PHASE_HOLD = 1.6;
const ADAPT_PHASE_FADE = 0.6;
const ADAPT_TINT_AMOUNT = 0.45;
const ADAPT_EMISSIVE_AMOUNT = 0.3;

type AdaptPhase = { from: DamageType; to: DamageType; mix: number };
const adaptPhaseAt = (t: number): AdaptPhase => {
  const cycle = ADAPT_PHASE_HOLD + ADAPT_PHASE_FADE;
  const total = cycle * ADAPT_PHASE_ORDER.length;
  const u = ((t % total) + total) % total;
  const idx = Math.floor(u / cycle);
  const within = u - idx * cycle;
  const from = ADAPT_PHASE_ORDER[idx];
  const to = ADAPT_PHASE_ORDER[(idx + 1) % ADAPT_PHASE_ORDER.length];
  const mix = within < ADAPT_PHASE_HOLD ? 0 : (within - ADAPT_PHASE_HOLD) / ADAPT_PHASE_FADE;
  return { from, to, mix };
};

// === Creature ===
// Same scale-fit + animation playback as EnemyPreview, but applies the
// frost or adaptation tint from ModelEnemyMesh. Materials are cloned
// per-mesh so this preview Canvas can't bleed material state into the
// main PlayScene renderer.
const MechanicCreature = ({ kind, effect }: { kind: EnemyKind; effect: MechanicId }) => {
  const cfg = ENEMY_MODEL[kind];
  const gltf = useGLTF(cfg.url);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const adaptTints = useMemo(() => {
    const out = {} as Record<DamageType, THREE.Color>;
    for (const t of ADAPT_PHASE_ORDER) out[t] = new THREE.Color(ADAPTIVE_TINT_BY_TYPE[t]);
    return out;
  }, []);
  const adaptEmissives = useMemo(() => {
    const out = {} as Record<DamageType, THREE.Color>;
    for (const t of ADAPT_PHASE_ORDER) out[t] = new THREE.Color(ADAPTIVE_EMISSIVE_BY_TYPE[t]);
    return out;
  }, []);
  const adaptTintTmp = useMemo(() => new THREE.Color(), []);
  const adaptEmissiveTmp = useMemo(() => new THREE.Color(), []);

  const obj = useMemo(() => {
    // precise=true via measureVisibleBox so the bbox reflects the
    // bind-pose visible skin, not raw POSITION attribute. The Kenney
    // Triceratops in particular has POSITION vertices ~5.6 units below
    // where its bind-pose mesh renders; without this, grounding by
    // box.min.y * s lifts the body well above the floor and the dino
    // floats inside its shield bubble. Measured on the original gltf
    // scene because the SkeletonUtils clone hasn't had its world
    // matrices propagated yet at this point.
    const measureBox = measureVisibleBox(gltf.scene);
    const size = measureBox.getSize(new THREE.Vector3());
    const center = measureBox.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const s = cfg.targetSize / maxDim;
    const cloned = cloneSkinned(gltf.scene);
    cloned.scale.setScalar(s);
    cloned.position.set(-center.x * s, -measureBox.min.y * s, -center.z * s);
    cloned.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      if (Array.isArray(m.material)) {
        m.material = m.material.map((mm) => cloneAndCaptureBase(mm));
      } else if (m.material) {
        m.material = cloneAndCaptureBase(m.material as THREE.Material);
      }
    });
    return cloned;
  }, [gltf.scene, cfg.targetSize]);

  useEffect(() => {
    const mx = new THREE.AnimationMixer(obj);
    const target = cfg.clip ?? "Idle";
    const clip =
      findClip(gltf.animations, target) ??
      findClip(gltf.animations, "Run") ??
      findClip(gltf.animations, "Walk") ??
      gltf.animations[0];
    if (clip) mx.clipAction(clip).play();
    // Pose-aware re-grounding — bind-pose box.min.y can sit below the
    // animated rest pose's foot on a few rigs (raptor/stego/triceratops),
    // which left them visibly floaty inside the diorama. Re-measure after
    // the first mixer tick and shift Y so feet plant at world y=0.
    mx.update(0);
    obj.updateMatrixWorld(true);
    const animBox = new THREE.Box3().setFromObject(obj, true);
    if (Number.isFinite(animBox.min.y)) obj.position.y -= animBox.min.y;
    mixerRef.current = mx;
    return () => {
      mx.stopAllAction();
      mixerRef.current = null;
    };
  }, [obj, gltf.animations, cfg.clip]);

  useFrame((state, delta) => {
    mixerRef.current?.update(delta);
    // Frost = full chill (1.0) for the slow preview so the dino reads
    // unambiguously frozen-blue. Adaptation cycles through the five
    // ADAPTIVE tints so the player sees every body discoloration the
    // herd can evolve.
    // Reset when no effect applies so re-entering this creature for a
    // different mechanic restores the original palette.
    const frost = effect === "slow" ? 1 : 0;
    const isAdapt = effect === "adaptation";
    if (isAdapt) {
      const phase = adaptPhaseAt(state.clock.elapsedTime);
      adaptTintTmp.copy(adaptTints[phase.from]).lerp(adaptTints[phase.to], phase.mix);
      adaptEmissiveTmp.copy(adaptEmissives[phase.from]).lerp(adaptEmissives[phase.to], phase.mix);
    }
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
      const apply = (mm: THREE.MeshStandardMaterial) => {
        const base = mm.userData.baseColor as THREE.Color | undefined;
        if (base && mm.color) {
          if (frost > 0.01) mm.color.copy(base).lerp(FROST_COLOR, frost);
          else if (isAdapt) mm.color.copy(base).lerp(adaptTintTmp, ADAPT_TINT_AMOUNT);
          else mm.color.copy(base);
        }
        if (!mm.emissive) return;
        if (frost > 0.05) mm.emissive.copy(FROST_EMISSIVE).multiplyScalar(frost * 0.5);
        else if (isAdapt) mm.emissive.copy(adaptEmissiveTmp).multiplyScalar(ADAPT_EMISSIVE_AMOUNT);
        else mm.emissive.setRGB(0, 0, 0);
      };
      if (Array.isArray(mat)) mat.forEach(apply);
      else apply(mat as THREE.MeshStandardMaterial);
    });
  });

  return <primitive object={obj} />;
};

// === Effects ===

const ShieldEffect = ({ kind }: { kind: EnemyKind }) => {
  const radius = SHIELD_RADIUS_BY_KIND[kind];
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    const pulse = 1 + Math.sin(t * 2.5) * 0.025;
    m.scale.setScalar(radius * pulse);
    m.rotation.y = t * 0.3;
  });
  return (
    <mesh ref={ref} position={[0, radius * 0.6, 0]} renderOrder={5}>
      <icosahedronGeometry args={[1, 1]} />
      <meshBasicMaterial
        color={SHIELD_COLOR}
        transparent
        opacity={0.32}
        depthWrite={false}
        wireframe
        toneMapped={false}
      />
    </mesh>
  );
};

// Compendium-side heal preview: matches HealAuras.tsx's narrow inner ring
// + three phased outgoing waves. Kept as separate refs (not instanced)
// because the preview shows exactly one healer.
const HEAL_WAVE_PERIOD = 1.6;
const HEAL_WAVES = 3;
const HealAuraEffect = ({ kind }: { kind: EnemyKind }) => {
  const hugR = HEAL_HUG_RADIUS_BY_KIND[kind];
  const hugRef = useRef<THREE.Mesh>(null);
  const waveRefs = useRef<Array<THREE.Mesh | null>>([]);
  const haloRefs = useRef<Array<THREE.Mesh | null>>([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const hug = hugRef.current;
    if (hug) {
      const hugPulse = 1 + Math.sin(t * 2.4) * 0.04;
      hug.scale.set(hugR * hugPulse, hugR * hugPulse, 1);
    }
    for (let k = 0; k < HEAL_WAVES; k++) {
      const wave = waveRefs.current[k];
      const halo = haloRefs.current[k];
      if (!wave || !halo) continue;
      const phase = k / HEAL_WAVES;
      const progress = (t / HEAL_WAVE_PERIOD + phase) % 1;
      const radius = hugR + (HEAL_AURA_RANGE - hugR) * progress;
      const fadeIn = Math.min(1, progress / 0.08);
      const alpha = fadeIn * (1 - progress);
      wave.scale.set(radius, radius, 1);
      halo.scale.set(radius * 0.96, radius * 0.96, 1);
      (wave.material as THREE.MeshBasicMaterial).opacity = alpha * 0.9;
      (halo.material as THREE.MeshBasicMaterial).opacity = alpha * 0.5;
      wave.visible = alpha > 0.01;
      halo.visible = alpha > 0.01;
    }
  });
  return (
    <group position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh ref={hugRef}>
        <ringGeometry args={[0.86, 1.0, 56]} />
        <meshBasicMaterial
          color={HEAL_AURA_COLOR}
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {Array.from({ length: HEAL_WAVES }).map((_, k) => (
        <group key={k}>
          <mesh
            ref={(el) => {
              waveRefs.current[k] = el;
            }}
          >
            <ringGeometry args={[0.96, 1.0, 64]} />
            <meshBasicMaterial
              color={HEAL_AURA_COLOR}
              transparent
              opacity={0.9}
              side={THREE.DoubleSide}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh
            ref={(el) => {
              haloRefs.current[k] = el;
            }}
          >
            <ringGeometry args={[0.88, 1.0, 64]} />
            <meshBasicMaterial
              color={HEAL_AURA_COLOR}
              transparent
              opacity={0.5}
              side={THREE.DoubleSide}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
};

const RegenBadgeEffect = ({ kind }: { kind: EnemyKind }) => {
  const cfg = ENEMY_MODEL[kind];
  const ref = useRef<THREE.Mesh>(null);
  // Reuses the same geometry + material builder the in-game RegenBadges
  // use so a tweak to the cross shape or color updates both surfaces.
  const geom = useMemo(buildPlusGeometry, []);
  const mat = useMemo(buildPlusMaterial, []);
  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    const bob = Math.sin(t * 2.6) * 0.04;
    const pulse = 1.05 + 0.1 * Math.sin(t * 4);
    // Add one-quarter cross-length of air so the compendium badge clears
    // the stego plates without drifting away from the creature.
    m.position.set(0, cfg.targetSize * 0.6 + REGEN_BADGE_COMPENDIUM_CLEARANCE + bob, 0);
    m.rotation.set(0, t * 1.1, 0);
    m.scale.set(pulse, pulse, pulse);
  });
  return <mesh ref={ref} geometry={geom} material={mat} renderOrder={6} />;
};

// === Public component ===

type Props = {
  id: MechanicId;
  size?: number;
};

export const MechanicPreview = ({ id, size = 360 }: Props) => {
  const kind = PREVIEW_KIND[id];
  // Match EnemyPreview's padding so long-bodied creatures (and the
  // overlay effects sized off targetSize) frame cleanly at every orbit.
  const span = ENEMY_MODEL[kind].targetSize * 1.2 + 0.4;
  const target: [number, number, number] = [0, span * 0.4, 0];
  return (
    <div className="mechanic-preview" style={{ width: size, height: size }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        frameloop="always"
        camera={{
          position: [span * 1.4, span * 0.8, span * 2.0],
          fov: 32,
          near: 0.1,
          far: 50,
        }}
      >
        <ExpectedCanvasTeardown />
        <color attach="background" args={["#3a4858"]} />

        <Environment
          files="/hdri/rooitou_park_1k.hdr"
          background={false}
          environmentIntensity={0.6}
        />
        <ambientLight intensity={0.55} color="#eaf2ff" />
        <directionalLight
          position={[span * 1.6, span * 2.6, span * 1.2]}
          intensity={2.2}
          color="#fff4dc"
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-left={-span * 2.5}
          shadow-camera-right={span * 2.5}
          shadow-camera-top={span * 2.5}
          shadow-camera-bottom={-span * 2.5}
          shadow-bias={-0.0005}
        />
        <hemisphereLight args={["#bcd8ff", "#5a4a2a", 0.85]} />

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
          <circleGeometry args={[span * 2.5, 56]} />
          <meshStandardMaterial color="#4a4438" roughness={0.98} metalness={0} />
        </mesh>

        <Suspense fallback={null}>
          <MechanicCreature kind={kind} effect={id} />
        </Suspense>

        {id === "shielded" && <ShieldEffect kind={kind} />}
        {id === "healAura" && <HealAuraEffect kind={kind} />}
        {id === "regen" && <RegenBadgeEffect kind={kind} />}
        {/* "slow" + "adaptation" tint the creature itself; no overlay mesh. */}

        <OrbitControls
          makeDefault
          target={target}
          enablePan={false}
          enableZoom
          minDistance={span * 1.2}
          maxDistance={span * 4.5}
          minPolarAngle={Math.PI * 0.15}
          // Match EnemyPreview: clamp at horizontal so orbit can't look
          // up through the floor at the creature.
          maxPolarAngle={Math.PI * 0.5}
          autoRotate
          autoRotateSpeed={0.9}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>
    </div>
  );
};
