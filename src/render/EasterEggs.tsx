import { useGLTF, useTexture } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  type ChimneyOffset,
  EASTER_EGG_BY_ID,
  type EasterEggDef,
  type EasterEggVisual,
  PRELOAD_URLS,
} from "../easterEggs";
import { useEditor } from "../editor/editorStore";
import type { EasterEgg } from "../sim/types";
import { clamp01 } from "../sim/vec2";
import { EASTER_EGG_DESPAWN_FADE, useGame } from "../store";
import { findClip } from "./animUtils";
import { measureVisibleBox } from "./measureModel";

// Apply tint + opacity to every material under the clone. Each material is
// itself cloned first so we don't mutate the cached GLB used by other
// renderers. Casts to MeshStandardMaterial for `.color` access — the non-
// standard branch just gets transparency applied.
const applyVisual = (root: THREE.Object3D, visual: EasterEggVisual | undefined) => {
  if (!visual) return;
  const tint = visual.tint ? new THREE.Color(visual.tint) : null;
  const opacity = visual.opacity;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const cloned = mats.map((mat) => {
      const c = mat.clone();
      if (opacity !== undefined && opacity < 1) {
        c.transparent = true;
        c.opacity = opacity;
        c.depthWrite = false;
      }
      const std = c as THREE.MeshStandardMaterial;
      if (tint && std.color) std.color.multiply(tint);
      return c;
    });
    m.material = Array.isArray(m.material) ? cloned : cloned[0];
  });
};

// Build a renderable clone sized to def.targetSize. Skinned clones go
// through SkeletonUtils so their skeleton stays intact for animation;
// everything else uses a plain deep clone.
const buildInstance = (scene: THREE.Object3D, def: EasterEggDef) => {
  const skinned = def.visual?.skinned ?? false;
  const clone = skinned ? (cloneSkinned(scene) as THREE.Object3D) : scene.clone(true);
  const box = measureVisibleBox(clone);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const scale = def.targetSize / maxDim;
  // Some GLBs (the KayKit sci-fi props — rover, rocket, satellite, glyph,
  // radio) are authored with their geometry sitting several units off the
  // node origin (the rover mesh is at +2,+1.5 in model space). The egg
  // group's origin is where the hit sphere and the click-burst particles
  // live, so an uncorrected horizontal offset puts the visible model
  // (which is itself raycastable) way off to the side of its own hitbox
  // and particle origin. Recenter horizontally so model, hit sphere, and
  // burst all coincide at egg.pos. Y is grounded separately via minY.
  clone.position.x -= center.x;
  clone.position.z -= center.z;
  applyVisual(clone, def.visual);
  clone.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
  });
  return {
    clone,
    scale,
    minY: box.min.y,
    minX: box.min.x - center.x,
    centerX: center.x,
    centerZ: center.z,
  };
};

// Damped scale oscillation for click-pop. Real-time-driven (not gated by
// game time) so the squash plays even while paused, and using
// performance.now elsewhere keeps the decay linked to wall-clock seconds.
const POP_DURATION = 0.4;
const computePop = (elapsed: number, intensity: number): number => {
  if (intensity <= 0 || elapsed < 0 || elapsed > POP_DURATION) return 1;
  return 1 + intensity * Math.exp(-elapsed * 8) * Math.cos(elapsed * 28);
};

// Bell curve over the face-camera window: 0 → 1 (peak look-at) → 0 (home).
const FACE_CAMERA_DURATION = 1.2;

// Barrel tumble helpers. The forest barrel GLB is authored upright with
// its long axis on local +Y, so once it starts rolling we build an
// explicit world basis from its travel direction instead of relying on a
// guessed tip order.
const _barrelBaseQ = new THREE.Quaternion();
const _barrelSpinQ = new THREE.Quaternion();
const _barrelBasis = new THREE.Matrix4();
const _barrelForward = new THREE.Vector3();
const _barrelSide = new THREE.Vector3();
const _barrelUp = new THREE.Vector3(0, 1, 0);
const _barrelLongAxis = new THREE.Vector3(0, 1, 0);

// Smoke column rising from a chimney. Mounted only after the cabin has
// been clicked at least once. Each particle is an instanced sphere that
// spawns at the chimney top, drifts up and slightly outward, billows in
// scale as it rises, and shrinks to nothing at end of life. Repeat clicks
// (tracked through `clickCount`) refresh a handful of stale slots so the
// column visibly thickens with a fresh puff for a moment.
//
// Coordinates are in the outer egg group's local space, so the offset
// rotates with egg.rotY (chimney stays attached to its corner of the
// roof) but smoke still rises along world Y because rotation is around
// the Y axis.
const SMOKE_PARTICLE_COUNT = 22;

type SmokeParticle = {
  age: number;
  life: number;
  offX: number;
  offY: number;
  offZ: number;
  velX: number;
  velY: number;
  velZ: number;
  baseScale: number;
};

const respawnSmoke = (p: SmokeParticle, fresh: boolean) => {
  p.age = 0;
  p.life = 2.0 + Math.random() * 0.8;
  p.offX = (Math.random() - 0.5) * 0.08;
  p.offZ = (Math.random() - 0.5) * 0.08;
  p.offY = 0;
  const ang = Math.random() * Math.PI * 2;
  const drift = 0.22 + Math.random() * 0.18;
  p.velX = Math.cos(ang) * drift;
  p.velZ = Math.sin(ang) * drift;
  // Click-driven respawns are slightly faster and bigger so each click
  // reads as a visible puff against the steady column.
  p.velY = (fresh ? 1.4 : 0.95) + Math.random() * 0.5;
  p.baseScale = fresh ? 0.45 : 0.32;
};

const ChimneySmokeColumn = ({
  egg,
  chimney,
}: {
  egg: EasterEgg;
  chimney: { x: number; y: number; z: number };
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);
  // Initialise to the current click count rather than 0 — without this,
  // a cabin that was already clicked (e.g. via load-of-progress someday)
  // would burst on first frame.
  const lastClickRef = useRef(egg.clickCount);
  const particlesRef = useRef<SmokeParticle[] | null>(null);
  if (particlesRef.current === null) {
    const arr: SmokeParticle[] = [];
    // Each slot is initialised through respawnSmoke so it gets non-zero
    // velocities from the start; a plain `velY: 0` init would leave the
    // first generation of particles stuck at the chimney until they hit
    // `age > life` and respawned naturally (~2.6s in).
    //
    // Negative starting ages then stagger the column build-up so it
    // emerges gradually over the first ~2s rather than popping in.
    for (let i = 0; i < SMOKE_PARTICLE_COUNT; i++) {
      const p: SmokeParticle = {
        age: 0,
        life: 0,
        offX: 0,
        offY: 0,
        offZ: 0,
        velX: 0,
        velY: 0,
        velZ: 0,
        baseScale: 0.12,
      };
      respawnSmoke(p, false);
      p.age = -i * 0.11;
      arr.push(p);
    }
    particlesRef.current = arr;
  }

  useFrame((_, dt) => {
    const mesh = meshRef.current;
    const ps = particlesRef.current;
    if (!mesh || !ps) return;

    // No clicks yet → nothing to render. Mounted unconditionally so we
    // notice the very first click even when it doesn't change React
    // state (e.g. on a re-run where the achievement was already unlocked,
    // the click handler ends with `set({})` and never re-renders).
    if (egg.clickCount === 0) {
      mesh.count = 0;
      mesh.instanceMatrix.needsUpdate = true;
      return;
    }

    // The store mutates egg.clickCount in place and then sometimes calls
    // `set({})`, which doesn't trigger a React re-render — so we can't
    // rely on a useEffect on a prop to detect repeat clicks. Read the
    // live value here each frame and compare against a ref instead.
    if (egg.clickCount > lastClickRef.current) {
      lastClickRef.current = egg.clickCount;
      // Refresh the 4 oldest slots as a fresh, slightly faster puff so
      // the column visibly thickens on each click.
      const sorted = ps.map((p, i) => ({ p, i, age: p.age })).sort((a, b) => b.age - a.age);
      for (let i = 0; i < 4 && i < sorted.length; i++) {
        respawnSmoke(sorted[i].p, true);
      }
    }

    const step = Math.min(dt, 0.05);
    let n = 0;
    for (const p of ps) {
      p.age += step;
      if (p.age < 0) continue;
      if (p.age > p.life) {
        respawnSmoke(p, false);
      }
      // Kinematics: gentle horizontal drift, slow vertical damping.
      p.offX += p.velX * step;
      p.offY += p.velY * step;
      p.offZ += p.velZ * step;
      p.velX *= 1 - 0.45 * step;
      p.velZ *= 1 - 0.45 * step;
      p.velY *= 1 - 0.04 * step;

      const t = Math.min(1, p.age / p.life);
      const grow = p.baseScale + t * 0.55;
      // Hold full size most of life, then taper to zero in the last 30%
      // so dying particles vanish instead of popping out.
      const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      const scale = grow * fade;
      if (scale <= 0.001) continue;

      dummy.position.set(chimney.x + p.offX, chimney.y + p.offY, chimney.z + p.offZ);
      dummy.scale.setScalar(scale);
      dummy.rotation.set(0, t * Math.PI, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);

      // Wood-fire smoke: dark grey at the chimney, lifting toward the
      // bright snow background as it disperses. Without enough contrast
      // up front the column blends invisibly into the white ground.
      const r = 0.18 + t * 0.42;
      const g = 0.2 + t * 0.42;
      const b = 0.24 + t * 0.42;
      tmpColor.setRGB(r, g, b);
      mesh.setColorAt(n, tmpColor);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, SMOKE_PARTICLE_COUNT]}
      // Particle positions are baked into per-instance matrices, so the
      // default origin-centered bounding sphere fails the frustum test
      // when zoomed in near the chimney — culling the whole batch and
      // making the smoke vanish exactly when looked at. Disable culling.
      frustumCulled={false}
    >
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial toneMapped={false} transparent opacity={0.85} depthWrite={false} />
    </instancedMesh>
  );
};

// shiftX/shiftZ mirror the horizontal recenter applied to the model clone
// in buildInstance, so the smoke column stays anchored to the chimney even
// when the model's geometry was authored off its node origin.
const chimneyLocal = (
  offset: ChimneyOffset,
  scale: number,
  yModel: number,
  shiftX: number,
  shiftZ: number,
): { x: number; y: number; z: number } => ({
  x: (offset.x - shiftX) * scale,
  y: yModel + offset.y * scale,
  z: (offset.z - shiftZ) * scale,
});

// Persistent flame that ignites on the snow torch the first time it's lit
// (clicked). Three pools share two camera-facing billboard meshes:
//   - fire + embers ride one additive whitepuff mesh — hot core fading
//     white→orange→deep-red as it rises, plus a few tiny twinkling sparks.
//     Additive means "fade out" is a colour ramp toward black, no per-
//     instance alpha needed.
//   - smoke rides a separate alpha-blended whitepuff mesh above the flame.
//     Additive smoke is invisible against the bright snow ground, so this
//     one carries real per-instance opacity via the same onBeforeCompile
//     `aOpacity` hook SmokePuffs uses.
// Offsets live in the egg's outer-group local space (like the chimney
// column), so the flame rotates with egg.rotY; billboards are counter-
// rotated by the group's world rotation so they still face the camera.
const FIRE_COUNT = 22;
const EMBER_COUNT = 12;
const SMOKE_COUNT = 12;
const FLAME_MESH_COUNT = FIRE_COUNT + EMBER_COUNT;

type FlameParticle = {
  age: number;
  life: number;
  offX: number;
  offY: number;
  offZ: number;
  velX: number;
  velY: number;
  velZ: number;
  seed: number;
};

const newFlameParticle = (): FlameParticle => ({
  age: 0,
  life: 1,
  offX: 0,
  offY: 0,
  offZ: 0,
  velX: 0,
  velY: 0,
  velZ: 0,
  seed: 0,
});

const respawnFire = (p: FlameParticle) => {
  p.age = 0;
  p.life = 0.42 + Math.random() * 0.3;
  const ang = Math.random() * Math.PI * 2;
  const rad = Math.random() * 0.05;
  p.offX = Math.cos(ang) * rad;
  p.offZ = Math.sin(ang) * rad;
  p.offY = 0;
  p.velX = Math.cos(ang) * 0.12;
  p.velZ = Math.sin(ang) * 0.12;
  p.velY = 1.7 + Math.random() * 0.9;
  p.seed = Math.random() * 10;
};

const respawnEmber = (p: FlameParticle) => {
  p.age = 0;
  p.life = 0.55 + Math.random() * 0.7;
  const ang = Math.random() * Math.PI * 2;
  p.offX = Math.cos(ang) * 0.04;
  p.offZ = Math.sin(ang) * 0.04;
  p.offY = 0.05;
  const drift = 0.25 + Math.random() * 0.3;
  p.velX = Math.cos(ang) * drift;
  p.velZ = Math.sin(ang) * drift;
  p.velY = 2.2 + Math.random() * 1.5;
  p.seed = Math.random() * 10;
};

const respawnFlameSmoke = (p: FlameParticle) => {
  p.age = 0;
  p.life = 1.2 + Math.random() * 1.0;
  p.offX = (Math.random() - 0.5) * 0.1;
  p.offZ = (Math.random() - 0.5) * 0.1;
  p.offY = 0.18;
  const ang = Math.random() * Math.PI * 2;
  const drift = 0.14 + Math.random() * 0.16;
  p.velX = Math.cos(ang) * drift;
  p.velZ = Math.sin(ang) * drift;
  p.velY = 0.55 + Math.random() * 0.4;
  p.seed = Math.random() * 10;
};

const TorchFlame = ({
  egg,
  anchor,
}: {
  egg: EasterEgg;
  anchor: { x: number; y: number; z: number };
}) => {
  const tex = useTexture("/textures/fx/whitepuff15.png");
  const groupRef = useRef<THREE.Group>(null);
  const fireRef = useRef<THREE.InstancedMesh>(null);
  const smokeRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const hot = useMemo(() => new THREE.Color("#fff1c0"), []);
  const mid = useMemo(() => new THREE.Color("#ff8a2c"), []);
  const cool = useMemo(() => new THREE.Color("#cc2a10"), []);
  const billboard = useMemo(() => new THREE.Quaternion(), []);
  const parentQuat = useMemo(() => new THREE.Quaternion(), []);

  // Per-instance opacity for the alpha-blended smoke, injected the same way
  // SmokePuffs does (MeshBasicMaterial has no per-instance alpha otherwise).
  const smokeOpacity = useMemo(
    () => new THREE.InstancedBufferAttribute(new Float32Array(SMOKE_COUNT), 1),
    [],
  );
  const smokeMat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float aOpacity;\nvarying float vOpacity;",
        )
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvOpacity = aOpacity;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vOpacity;")
        .replace(
          "#include <dithering_fragment>",
          "gl_FragColor.a *= vOpacity;\n#include <dithering_fragment>",
        );
    };
    return m;
  }, [tex]);

  const fire = useMemo<FlameParticle[]>(() => {
    const arr: FlameParticle[] = [];
    for (let i = 0; i < FIRE_COUNT; i++) {
      const p = newFlameParticle();
      respawnFire(p);
      p.age = -Math.random() * p.life; // stagger so the column doesn't pop in
      arr.push(p);
    }
    return arr;
  }, []);
  const embers = useMemo<FlameParticle[]>(() => {
    const arr: FlameParticle[] = [];
    for (let i = 0; i < EMBER_COUNT; i++) {
      const p = newFlameParticle();
      respawnEmber(p);
      p.age = -Math.random() * p.life;
      arr.push(p);
    }
    return arr;
  }, []);
  const smoke = useMemo<FlameParticle[]>(() => {
    const arr: FlameParticle[] = [];
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const p = newFlameParticle();
      respawnFlameSmoke(p);
      p.age = -Math.random() * p.life;
      arr.push(p);
    }
    return arr;
  }, []);

  useEffect(() => {
    const m = smokeRef.current;
    if (m) m.geometry.setAttribute("aOpacity", smokeOpacity);
  }, [smokeOpacity]);

  useFrame((state, dt) => {
    const fireMesh = fireRef.current;
    const smokeMesh = smokeRef.current;
    const grp = groupRef.current;
    if (!fireMesh || !smokeMesh || !grp) return;

    // Unlit until clicked — mounted unconditionally (like the chimney) so we
    // catch the very first click even when it doesn't re-render React.
    if (egg.clickCount === 0) {
      fireMesh.count = 0;
      smokeMesh.count = 0;
      fireMesh.instanceMatrix.needsUpdate = true;
      smokeMesh.instanceMatrix.needsUpdate = true;
      return;
    }

    const step = Math.min(dt, 0.05);
    // Counter-rotate billboards by the group's world rotation so they face
    // the camera even though the egg group spins them by egg.rotY.
    grp.getWorldQuaternion(parentQuat);
    billboard.copy(parentQuat).invert().multiply(state.camera.quaternion);

    // --- Fire + embers (additive) ---
    let n = 0;
    for (const p of fire) {
      p.age += step;
      if (p.age > p.life) respawnFire(p);
      if (p.age < 0) continue;
      p.offX += p.velX * step;
      p.offY += p.velY * step;
      p.offZ += p.velZ * step;
      p.velY *= 1 - 0.6 * step; // buoyancy bleeds off so flames lick and curl
      const t = p.age / p.life;
      const fadeIn = Math.min(1, p.age / 0.05);
      const fadeOut = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
      const flick = Math.sin(p.age * 30 + p.seed) * 0.03;
      const size = (0.27 - 0.16 * t) * fadeIn;
      if (size <= 0.001) continue;
      if (t < 0.5) color.copy(hot).lerp(mid, t / 0.5);
      else color.copy(mid).lerp(cool, (t - 0.5) / 0.5);
      color.multiplyScalar((0.5 + 0.9 * (1 - t)) * fadeIn * fadeOut);
      dummy.position.set(anchor.x + p.offX + flick, anchor.y + p.offY, anchor.z + p.offZ);
      dummy.quaternion.copy(billboard);
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      fireMesh.setMatrixAt(n, dummy.matrix);
      fireMesh.setColorAt(n, color);
      n++;
    }
    for (const p of embers) {
      p.age += step;
      if (p.age > p.life) respawnEmber(p);
      if (p.age < 0) continue;
      p.offX += p.velX * step;
      p.offY += p.velY * step;
      p.offZ += p.velZ * step;
      p.velY *= 1 - 0.25 * step;
      const t = p.age / p.life;
      const fadeOut = 1 - t;
      const twinkle = 0.55 + 0.45 * Math.sin(p.age * 34 + p.seed);
      const size = (0.07 - 0.04 * t) * Math.min(1, p.age / 0.04);
      if (size <= 0.001) continue;
      color.setRGB(1, 0.8, 0.38).multiplyScalar(twinkle * fadeOut * 1.9);
      dummy.position.set(anchor.x + p.offX, anchor.y + p.offY, anchor.z + p.offZ);
      dummy.quaternion.copy(billboard);
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      fireMesh.setMatrixAt(n, dummy.matrix);
      fireMesh.setColorAt(n, color);
      n++;
    }
    fireMesh.count = n;
    fireMesh.instanceMatrix.needsUpdate = true;
    if (fireMesh.instanceColor) fireMesh.instanceColor.needsUpdate = true;

    // --- Smoke (alpha) ---
    let s = 0;
    for (const p of smoke) {
      p.age += step;
      if (p.age > p.life) respawnFlameSmoke(p);
      if (p.age < 0) continue;
      p.offX += p.velX * step;
      p.offY += p.velY * step;
      p.offZ += p.velZ * step;
      p.velX *= 1 - 0.4 * step;
      p.velZ *= 1 - 0.4 * step;
      const t = p.age / p.life;
      const fadeIn = Math.min(1, p.age / 0.18);
      const fadeOut = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      const size = 0.12 + t * 0.42;
      // Sooty grey lifting toward pale so the column reads against snow.
      const grey = 0.22 + t * 0.32;
      color.setRGB(grey, grey, grey);
      dummy.position.set(anchor.x + p.offX, anchor.y + p.offY, anchor.z + p.offZ);
      dummy.quaternion.copy(billboard);
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      smokeMesh.setMatrixAt(s, dummy.matrix);
      smokeMesh.setColorAt(s, color);
      smokeOpacity.array[s] = 0.5 * fadeIn * fadeOut;
      s++;
    }
    smokeMesh.count = s;
    smokeMesh.instanceMatrix.needsUpdate = true;
    if (smokeMesh.instanceColor) smokeMesh.instanceColor.needsUpdate = true;
    smokeOpacity.needsUpdate = true;
  });

  return (
    <group ref={groupRef}>
      <instancedMesh
        ref={smokeRef}
        args={[undefined, undefined, SMOKE_COUNT]}
        material={smokeMat}
        renderOrder={2}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
      </instancedMesh>
      <instancedMesh
        ref={fireRef}
        args={[undefined, undefined, FLAME_MESH_COUNT]}
        renderOrder={3}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={tex}
          toneMapped={false}
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
    </group>
  );
};

// Eggs must out-priority every other clickable (dinos, rocks, trees, the
// placement plane) even when they sit *behind* one in screen space. R3F
// dispatches pointer events in ascending intersection.distance order and
// honors stopPropagation, so the front-most hit normally wins. We run the
// real sphere intersection, then subtract a large constant from the
// reported distance — eggs sort to the front of the merged hit list while
// preserving relative order between two overlapping eggs.
const EGG_PRIORITY_OFFSET = 1000;
const eggPriorityRaycast: THREE.Mesh["raycast"] = function (
  this: THREE.Mesh,
  raycaster,
  intersects,
) {
  const before = intersects.length;
  THREE.Mesh.prototype.raycast.call(this, raycaster, intersects);
  for (let i = before; i < intersects.length; i++) {
    intersects[i].distance -= EGG_PRIORITY_OFFSET;
  }
};

const EasterEggMesh = ({ egg, def }: { egg: EasterEgg; def: EasterEggDef }) => {
  const { scene, animations } = useGLTF(def.model);
  const clickEasterEgg = useGame((s) => s.clickEasterEgg);
  const [hovered, setHovered] = useState(false);
  const groupRef = useRef<THREE.Group>(null);
  const innerRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  // Click-feedback bookkeeping. The store mutates egg.clickCount in place
  // (the world reference doesn't change), so we detect new clicks by
  // diffing against the last value we saw and stamp performance.now()
  // for a real-time decay independent of paused world.time.
  const lastPopRef = useRef<number>(Number.NEGATIVE_INFINITY);
  const prevClickCountRef = useRef<number>(0);
  const prevTriggeredRef = useRef<boolean>(false);
  const isUnlockPopRef = useRef<boolean>(false);

  const { clone, scale, minY, minX, centerX, centerZ } = useMemo(
    () => buildInstance(scene, def),
    [scene, def],
  );
  const rollLift = Math.max(-minX, 0) * scale;

  // Triggered eggs with motion (the freed parasaur) swap their idle clip
  // for the triggeredClip so the run cycle plays as they sprint away.
  const isFleeing = egg.vel != null && def.visual?.triggeredClip != null;
  const activeClipName = isFleeing ? def.visual?.triggeredClip : def.visual?.clip;

  useEffect(() => {
    if (!activeClipName && animations.length === 0) return;
    const clip = findClip(animations, activeClipName) ?? animations[0] ?? null;
    if (!clip) return;
    const mixer = new THREE.AnimationMixer(clone);
    mixer.clipAction(clip).play();
    mixerRef.current = mixer;
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(clone);
      mixerRef.current = null;
    };
  }, [clone, animations, activeClipName]);

  useEffect(() => {
    if (!hovered) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = "pointer";
    return () => {
      document.body.style.cursor = prev;
    };
  }, [hovered]);

  // Outer group sits at ground level; the model is lifted by yModel so its
  // bottom lands on y=yOffset (negative = buried). The hit sphere sits in
  // outer-group space so it's always at a predictable world height,
  // regardless of how deep a buried egg goes.
  const yOffset = def.visual?.yOffset ?? 0;
  const yModel = yOffset - minY * scale;
  const hitRadius = def.hitRadius ?? Math.max(def.targetSize * 0.7, 0.9);
  const hitY = Math.max(def.targetSize * 0.5, 0.9);

  useFrame((state, delta) => {
    if (useGame.getState().world.status === "running") mixerRef.current?.update(delta);

    // Detect a new click via clickCount transition. If this same click
    // crossed the unlock threshold (`triggered` flipped true), amplify
    // the pop so the achievement moment lands harder than a regular tap.
    if (egg.clickCount !== prevClickCountRef.current) {
      const wasTriggered = prevTriggeredRef.current;
      prevClickCountRef.current = egg.clickCount;
      prevTriggeredRef.current = egg.triggered;
      lastPopRef.current = performance.now();
      isUnlockPopRef.current = egg.triggered && !wasTriggered;
    }

    const popElapsed = (performance.now() - lastPopRef.current) / 1000;
    const baseIntensity = def.reaction?.popIntensity ?? 0.25;
    const intensity = isUnlockPopRef.current ? baseIntensity * 1.6 : baseIntensity;
    const pop = computePop(popElapsed, intensity);

    // Static gold-reward eggs (skull) shrink out over the despawn grace
    // window so collecting one reads as the prop dissolving into the
    // particle burst instead of disappearing on the same frame the click
    // lands. Moving eggs keep fade=1 and just despawn at the edge.
    let fade = 1;
    if (
      egg.triggered &&
      egg.vel == null &&
      egg.despawnAt !== null &&
      def.goldReward !== undefined
    ) {
      const worldTime = useGame.getState().world.time;
      const remaining = egg.despawnAt - worldTime;
      fade = clamp01(remaining / EASTER_EGG_DESPAWN_FADE);
    }

    // Apply pop to the visible (inner) group only — the outer hit sphere
    // keeps its constant radius so multi-click eggs don't have a moving
    // hitbox between taps. Axial barrel-roll rotation lives here too.
    if (innerRef.current) {
      innerRef.current.scale.setScalar(scale * pop * fade);
      if (egg.vel != null && def.clickRoll?.tumble) {
        innerRef.current.position.y = rollLift;
        _barrelForward.set(egg.vel.x, 0, -egg.vel.y);
        if (_barrelForward.lengthSq() <= 1e-6) {
          _barrelForward.set(Math.sin(egg.rotY), 0, -Math.cos(egg.rotY));
        }
        _barrelForward.normalize();
        _barrelSide.crossVectors(_barrelUp, _barrelForward);
        if (_barrelSide.lengthSq() <= 1e-6) _barrelSide.set(-1, 0, 0);
        else _barrelSide.normalize();
        _barrelBasis.makeBasis(_barrelForward, _barrelSide, _barrelUp);
        _barrelBaseQ.setFromRotationMatrix(_barrelBasis);
        _barrelSpinQ.setFromAxisAngle(_barrelLongAxis, egg.rollPitch);
        innerRef.current.quaternion.copy(_barrelBaseQ).multiply(_barrelSpinQ);
      } else {
        innerRef.current.rotation.set(egg.rollPitch, 0, 0);
        // Non-tumble eggs that have started moving (the freed parasaur)
        // rise out of any burial offset so they don't drag through the
        // ground while running.
        if (egg.vel != null) innerRef.current.position.y = 0;
      }
    }

    if (!groupRef.current) return;

    if (egg.vel) {
      // Moving eggs follow the sim every frame.
      groupRef.current.position.set(egg.pos.x, 0, -egg.pos.y);
      groupRef.current.rotation.y = def.clickRoll?.tumble ? 0 : egg.rotY;
    } else if (def.reaction?.faceCamera) {
      // Skinned static dinos arc to face the camera, then ease back.
      // The convention matches moving eggs: model "forward" at rotY=0
      // is -z_world, so the heading is atan2(dx_world, dy_game-delta).
      if (popElapsed >= 0 && popElapsed <= FACE_CAMERA_DURATION) {
        const cam = state.camera.position;
        const dxW = cam.x - egg.pos.x;
        const dyG = -cam.z - egg.pos.y;
        const targetRotY = Math.atan2(dxW, dyG);
        const home = egg.rotY;
        let rotDelta = targetRotY - home;
        while (rotDelta > Math.PI) rotDelta -= Math.PI * 2;
        while (rotDelta < -Math.PI) rotDelta += Math.PI * 2;
        const t = Math.sin((popElapsed / FACE_CAMERA_DURATION) * Math.PI);
        groupRef.current.rotation.y = home + rotDelta * t;
      } else {
        groupRef.current.rotation.y = egg.rotY;
      }
    } else {
      groupRef.current.rotation.y = egg.rotY;
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (useEditor.getState().active) return;
    // Snapshot the visible egg pos at click time. Outer-group world pos
    // maps back to game space as (x, -z). Passed through so the burst
    // anchors to what the user clicked, not the sim-integrated egg.pos
    // a few frames later (moving eggs travel 1-2 units per sim tick).
    const g = groupRef.current;
    const hitPos = g ? { x: g.position.x, y: -g.position.z } : { x: egg.pos.x, y: egg.pos.y };
    clickEasterEgg(egg.id, hitPos);
  };

  return (
    <group
      ref={groupRef}
      position={[egg.pos.x, 0, -egg.pos.y]}
      rotation={[0, egg.rotY, 0]}
      onClick={onClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        setHovered(false);
      }}
    >
      <group ref={innerRef} position={[0, yModel, 0]} scale={scale}>
        <primitive object={clone} />
      </group>
      {def.chimneyOffset ? (
        <ChimneySmokeColumn
          egg={egg}
          chimney={chimneyLocal(def.chimneyOffset, scale, yModel, centerX, centerZ)}
        />
      ) : null}
      {def.flameOffset ? (
        <TorchFlame
          egg={egg}
          anchor={{
            x: (def.flameOffset.x ?? 0) * scale,
            y: yModel + def.flameOffset.y * scale,
            z: (def.flameOffset.z ?? 0) * scale,
          }}
        />
      ) : null}
      <mesh position={[0, hitY, 0]} raycast={eggPriorityRaycast}>
        <sphereGeometry args={[hitRadius, 12, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
};

export const EasterEggs = () => {
  const eggs = useGame((s) => s.world.easterEggs);
  if (eggs.length === 0) return null;
  return (
    <>
      {eggs.map((egg) => {
        const def = EASTER_EGG_BY_ID[egg.defId];
        if (!def) return null;
        return <EasterEggMesh key={egg.id} egg={egg} def={def} />;
      })}
    </>
  );
};

for (const url of PRELOAD_URLS) useGLTF.preload(url);
