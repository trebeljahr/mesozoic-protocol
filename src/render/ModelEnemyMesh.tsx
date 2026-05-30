import { useGLTF } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { audio } from "../audio/AudioManager";
import { dampFactor, shortAngleDelta } from "../sim/angle";
import { smoothDirection } from "../sim/path";
import type { BossVariant, DamageType, EnemyKind, World } from "../sim/types";
import { clamp01 } from "../sim/vec2";
import {
  ADAPTIVE_TINT_BY_TYPE,
  BOSS_VARIANT_FOOTSTEP,
  BOSS_VARIANT_MATERIAL,
  BOSS_VARIANT_TINT,
} from "../sim/world";
import { useGame } from "../store";
import { cloneAndCaptureBase, findClip } from "./animUtils";
import { ENEMY_EMISSIVE, EYE_FALLBACK_NAMES } from "./emissiveRegistry";
import {
  buildEyePositions,
  clearEnemyEyeProfile,
  type EyePosition,
  eyeColorFor,
  setEnemyEyeProfile,
} from "./enemyEyeProfiles";
import { buildPlateGroup, resolveEnemyTier, syncPlateGroup } from "./enemyGrafts";
import { clearEnemyRender, setEnemyRender } from "./enemyRenderRegistry";
import {
  applyEmissiveSpec,
  applyToonRimPatch,
  BIOME_MATRIARCH_RIM,
  biomeRimColor,
  MATRIARCH_VARIANT_BIOME,
  RIM_COLOR_ENEMY,
  RIM_INTENSITY_BOSS,
  RIM_INTENSITY_ENEMY,
  setRimColor,
  setRimIntensity,
} from "./materialTunables";
import { measureVisibleBox } from "./measureModel";
import { BLOOM_LAYER, OUTLINE_LAYER } from "./PaintedPostFx";

type Props = {
  kind: EnemyKind;
  url: string;
  targetSize: number;
  yOffset?: number;
  baseRotY?: number;
  bob?: boolean;
  clip?: string;
  timeScale?: number;
  // Only matched when kind === "boss". Lets Scene.tsx mount one mesh per
  // biome-themed matriarch variant (each loads a different GLB) so the
  // renderer doesn't need to swap models per-enemy at runtime.
  bossVariant?: BossVariant;
};

// Frost tint target — pale ice blue. Enemies lerp from their base color
// toward this as e.frost climbs from 0 → 1.
const FROST_COLOR = new THREE.Color("#cfe6ff");
// Frost rim handoff: as frost climbs, the rim hue drifts toward this so
// frozen enemies read with a cold halo, not the bio-green one.
const FROST_RIM_COLOR = new THREE.Color("#cfe6ff");

const BODY_TINT_BY_KIND: Record<EnemyKind, THREE.ColorRepresentation> = {
  swarm: "#9a7a4f",
  raptor: "#9a7a4f",
  para: "#7b6f73",
  allosaur: "#7d6854",
  stego: "#6e7461",
  armored: "#84705e",
  titan: "#72756a",
  boss: "#72756a",
};

const BODY_TINT_AMOUNT: Record<EnemyKind, number> = {
  swarm: 0.72,
  raptor: 0.72,
  para: 0.62,
  allosaur: 0.62,
  stego: 0.58,
  armored: 0.66,
  titan: 0.5,
  boss: 0.46,
};

const applyBodyPalette = (material: THREE.Material, tint: THREE.Color, amount: number): void => {
  const std = material as THREE.MeshStandardMaterial;
  const base = std.userData.baseColor as THREE.Color | undefined;
  if (!base || !std.color) return;
  base.lerp(tint, amount);
  std.color.copy(base);
};

type Item = {
  enemyId: number;
  obj: THREE.Object3D;
  proxy: THREE.Mesh | null;
  mixer: THREE.AnimationMixer;
  clip: THREE.AnimationClip | null;
  // Smoothed visual state — lags `e.pos` / path yaw slightly so corner
  // turns arc instead of teleport+snap. Sim-side `e.pos` stays the
  // source of truth for towers and click hits.
  visX: number;
  visZ: number;
  visYaw: number;
  visInit: boolean;
  // Carries the enemy's leak state from the prior live frame so the
  // render layer can tell a true kill (play death anim) apart from an
  // HQ-impact despawn (just pool — the leak attack pose already played).
  wasLeak: boolean;
  // Death-anim bookkeeping. While `dying`, the item stays mounted at
  // its last-known pose so the Death clip (or tilt-fall fallback) can
  // finish before pooling.
  dying: boolean;
  dyingStart: number;
  dyingDuration: number;
  dyingBaseRotX: number;
  dyingBaseY: number;
  // Normalized walk-clip phase [0,1) sampled last frame, for matriarch
  // footstep crossing detection. -1 = unprimed (don't emit until the next
  // frame seeds a baseline, so a clip (re)start can't burst a step).
  lastStepPhase: number;
  // Bone-grafted plate scaffolding mounted as a sibling of obj. Each mesh
  // stores a local bind to a body/head/tail bone and is synced after the
  // animation mixer advances, so armor hugs the dinosaur through clips.
  plateGroup: THREE.Group | null;
  eyePositions: EyePosition[];
};

// Exp-damp half-life (seconds). Lower = snappier, higher = floatier.
// Position halflife is tiny — sim now walks a smoothed polyline so there's
// no waypoint snap to mask, and any larger value pulls the rendered model
// perpendicular-inside the painted lane on curves. Yaw stays a touch
// floatier so corner turns read as a rotation, not an instant flip.
const POS_HALFLIFE = 0.02;
const YAW_HALFLIFE = 0.06;

// Soft cap on pooled clones per kind. Beyond this we let GC reclaim them
// so a single oversized swarm doesn't pin a permanent ceiling of skinned
// meshes in the scene graph.
const POOL_LIMIT = 16;
const DEAD_ENEMY_CLICK_BLOCKER = "deadEnemyClickBlocker";

const hasEnemyId = (object: THREE.Object3D | null): boolean => {
  let obj: THREE.Object3D | null = object;
  while (obj) {
    if (obj.userData.enemyId !== undefined) return true;
    obj = obj.parent;
  }
  return false;
};

const isDeadEnemyBodyHit = (object: THREE.Object3D): boolean => {
  let obj: THREE.Object3D | null = object;
  while (obj) {
    if (obj.userData[DEAD_ENEMY_CLICK_BLOCKER] === true) return true;
    if (obj.userData.enemyId !== undefined) return false;
    obj = obj.parent;
  }
  return !hasEnemyId(object);
};

const resetEnemyMaterialState = (obj: THREE.Object3D, restoreEmissive = true): void => {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.material) return;
    const reset = (mm: THREE.Material) => {
      const std = mm as THREE.MeshStandardMaterial;
      const baseColor = std.userData.baseColor as THREE.Color | undefined;
      if (baseColor && std.color) std.color.copy(baseColor);
      const baseEmissive = std.userData.baseEmissive as THREE.Color | undefined;
      if (std.emissive) {
        if (restoreEmissive && baseEmissive) std.emissive.copy(baseEmissive);
        else std.emissive.setRGB(0, 0, 0);
      }
    };
    if (Array.isArray(m.material)) m.material.forEach(reset);
    else reset(m.material);
  });
};

export const ModelEnemyMesh = ({
  kind,
  url,
  targetSize,
  yOffset = 0,
  baseRotY = 0,
  bob = false,
  clip = "Run",
  timeScale = 1,
  bossVariant,
}: Props) => {
  const { scene, animations } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);
  const itemsRef = useRef<Map<number, Item>>(new Map());
  // Tracks the World reference last seen in useFrame. startLevel swaps the
  // World object wholesale (new createWorld()); PlayScene stays mounted on
  // results→next-level / retry, so itemsRef carries over corpses still in
  // mid-death anim. After the swap, world.time resets to 0 < item.dyingStart,
  // so elapsed clamps to 0 and the Death clip restarts at the old position
  // — playtest reads it as "dinos dying all over the map on every new
  // level". When this ref doesn't match the current world, force-recycle
  // all stale items before the live pass runs.
  const worldRef = useRef<World | null>(null);
  // Stable matriarch color — built once and reused for the body lerp
  // every frame so we don't allocate THREE.Color in the inner loop.
  const variantTint = useMemo(
    () => new THREE.Color(bossVariant ? BOSS_VARIANT_TINT[bossVariant] : "#ffffff"),
    [bossVariant],
  );
  const matriarchMaterial = bossVariant !== undefined ? BOSS_VARIANT_MATERIAL[bossVariant] : null;
  const footstepProfile = bossVariant !== undefined ? BOSS_VARIANT_FOOTSTEP[bossVariant] : null;
  const bodyTint = useMemo(() => new THREE.Color(BODY_TINT_BY_KIND[kind]), [kind]);
  const bodyTintAmount = BODY_TINT_AMOUNT[kind];
  // Adaptive-resistance tint palette — one stable THREE.Color per damage
  // type so the per-frame body lerp doesn't allocate. Built once and
  // shared by every enemy in this mesh; the per-enemy snapshot
  // (`enemy.adaptiveResistType`) picks which key to read.
  const adaptiveTintByType = useMemo<Record<DamageType, THREE.Color>>(
    () => ({
      kinetic: new THREE.Color(ADAPTIVE_TINT_BY_TYPE.kinetic),
      electric: new THREE.Color(ADAPTIVE_TINT_BY_TYPE.electric),
      cold: new THREE.Color(ADAPTIVE_TINT_BY_TYPE.cold),
      explosive: new THREE.Color(ADAPTIVE_TINT_BY_TYPE.explosive),
      flame: new THREE.Color(ADAPTIVE_TINT_BY_TYPE.flame),
    }),
    [],
  );
  // Free list of skinned clones from dead-but-recyclable enemies. Reusing
  // is significantly cheaper than another `cloneSkinned + AnimationMixer`,
  // which matters for swarms.
  const poolRef = useRef<Item[]>([]);

  const { normalizedScale, centerXZ, scaledMinY } = useMemo(() => {
    const box = measureVisibleBox(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const s = targetSize / maxDim;
    return {
      normalizedScale: s,
      centerXZ: { x: center.x * s, z: center.z * s },
      scaledMinY: box.min.y * s,
    };
  }, [scene, targetSize]);

  // Per-enemy eye color. Eye positions are computed per clone because the
  // glow is bound to that clone's animated Head bone.
  const eyeBaseColor = useMemo(() => eyeColorFor(kind, bossVariant), [kind, bossVariant]);

  const activeClip = useMemo(
    () => findClip(animations, clip) ?? findClip(animations, "Walk") ?? animations[0] ?? null,
    [animations, clip],
  );
  const attackClip = useMemo(
    () =>
      findClip(animations, "Attack") ??
      findClip(animations, "Bite") ??
      findClip(animations, "Roar") ??
      null,
    [animations],
  );
  // Optional per-kind Death clip. All shipping GLBs include one (the
  // findClip needle is case-insensitive substring), but we still fall
  // back to a tilt-fall in the dying tick if a future model omits it.
  const deathClip = useMemo(
    () =>
      findClip(animations, "Death") ??
      findClip(animations, "Die") ??
      findClip(animations, "Dead") ??
      null,
    [animations],
  );
  // How long the dying mesh lingers before pooling when no Death clip
  // is available. A real Death clip plays to its full duration instead.
  const DEATH_FALLBACK_SEC = 0.6;
  // Death anims flatten the skeleton — bones swing below the rest-pose
  // bounding-box floor that `scaledMinY` was measured against, so the
  // corpse clips into the ground. Lift the corpse by a small fraction
  // of its visible size as the anim progresses to absorb the dip.
  const deathGroundLift = targetSize * 0.06;

  // Invisible, oversized tap target. Lets users hit the enemy even when
  // their finger lands next to the silhouette — critical on touch. The
  // titan and boss native silhouettes are already huge, so they opt out.
  const useProxy = kind !== "titan" && kind !== "boss";
  const proxyRadius = useMemo(() => Math.max(targetSize * 0.8, 1.0), [targetSize]);
  // Invisible click target — no need for smooth silhouette.
  const proxyGeom = useMemo(
    () => (useProxy ? new THREE.SphereGeometry(proxyRadius, 6, 4) : null),
    [proxyRadius, useProxy],
  );
  const proxyMat = useMemo(
    () =>
      useProxy
        ? new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
        : null,
    [useProxy],
  );

  useEffect(
    () => () => {
      proxyGeom?.dispose();
      proxyMat?.dispose();
    },
    [proxyGeom, proxyMat],
  );

  useEffect(
    () => () => {
      const parent = groupRef.current;
      if (!parent) return;
      for (const [, item] of itemsRef.current) {
        item.mixer.stopAllAction();
        clearEnemyRender(item.enemyId);
        clearEnemyEyeProfile(item.enemyId);
        parent.remove(item.obj);
        if (item.proxy) parent.remove(item.proxy);
        if (item.plateGroup) parent.remove(item.plateGroup);
      }
      itemsRef.current.clear();
      for (const item of poolRef.current) {
        item.mixer.stopAllAction();
        clearEnemyRender(item.enemyId);
        clearEnemyEyeProfile(item.enemyId);
        parent.remove(item.obj);
        if (item.proxy) parent.remove(item.proxy);
        if (item.plateGroup) parent.remove(item.plateGroup);
      }
      poolRef.current.length = 0;
    },
    [],
  );

  const recycleOrDispose = useCallback((item: Item) => {
    const parent = groupRef.current;
    if (!parent) return;
    item.mixer.stopAllAction();
    resetEnemyMaterialState(item.obj);
    item.obj.rotation.x = 0;
    item.obj.rotation.z = 0;
    clearEnemyRender(item.enemyId);
    clearEnemyEyeProfile(item.enemyId);
    if (poolRef.current.length < POOL_LIMIT) {
      item.obj.visible = false;
      item.obj.userData.enemyId = undefined;
      item.obj.userData[DEAD_ENEMY_CLICK_BLOCKER] = undefined;
      // Clear the stale id from every descendant too — the click handler
      // walks UP from the hit object, so a child that still carries the
      // old id would resurface a panel for an enemy that's been pooled.
      item.obj.traverse((o) => {
        o.userData.enemyId = undefined;
        o.userData[DEAD_ENEMY_CLICK_BLOCKER] = undefined;
      });
      if (item.proxy) {
        item.proxy.visible = false;
        item.proxy.userData.enemyId = undefined;
      }
      if (item.plateGroup) item.plateGroup.visible = false;
      poolRef.current.push(item);
    } else {
      item.obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.material) return;
        if (Array.isArray(m.material)) for (const mm of m.material) mm.dispose();
        else (m.material as THREE.Material).dispose();
      });
      parent.remove(item.obj);
      if (item.proxy) parent.remove(item.proxy);
      if (item.plateGroup) {
        parent.remove(item.plateGroup);
        item.plateGroup.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.geometry) {
            // Plate geometry is the shared singleton from getPlateGeometry;
            // don't dispose it. Material is also shared.
          }
        });
      }
    }
  }, []);

  useFrame((_, delta) => {
    const parent = groupRef.current;
    if (!parent) return;
    const { world } = useGame.getState();
    if (worldRef.current !== null && worldRef.current !== world) {
      for (const [, item] of itemsRef.current) recycleOrDispose(item);
      itemsRef.current.clear();
    }
    worldRef.current = world;
    const frozen = world.status !== "running";

    const live = new Set<number>();
    for (const e of world.enemies) {
      if (e.kind !== kind) continue;
      // Boss meshes are partitioned by variant: each variant owns its own
      // GLB, so the apex apatosaurus mesh shouldn't claim a raptor
      // matriarch entity. When `bossVariant` is unset on Props (kind !==
      // "boss"), this branch is a no-op.
      if (bossVariant !== undefined && e.bossVariant !== bossVariant) continue;
      if (!e.alive) continue;
      live.add(e.id);
      let item = itemsRef.current.get(e.id);
      if (!item) {
        const recycled = poolRef.current.pop();
        if (recycled) {
          // Reuse: update id metadata, restart the animation, unhide.
          recycled.enemyId = e.id;
          resetEnemyMaterialState(recycled.obj);
          recycled.obj.visible = true;
          recycled.obj.userData.enemyId = e.id;
          recycled.obj.userData.enemyMaxHp = e.maxHp;
          recycled.obj.userData[DEAD_ENEMY_CLICK_BLOCKER] = undefined;
          recycled.obj.traverse((o) => {
            o.userData.enemyId = e.id;
            o.userData.enemyMaxHp = e.maxHp;
            o.userData[DEAD_ENEMY_CLICK_BLOCKER] = undefined;
          });
          recycled.mixer.stopAllAction();
          recycled.clip = null;
          if (recycled.proxy) {
            recycled.proxy.visible = true;
            recycled.proxy.userData.enemyId = e.id;
            recycled.proxy.userData.enemyMaxHp = e.maxHp;
          }
          if (recycled.plateGroup) {
            recycled.plateGroup.visible = true;
          }
          recycled.visInit = false;
          // Pool may have stashed a corpse mid-fall; reset transient
          // death state so the recycled clone runs fresh.
          recycled.wasLeak = false;
          recycled.dying = false;
          recycled.dyingStart = 0;
          recycled.dyingDuration = 0;
          recycled.dyingBaseRotX = 0;
          recycled.dyingBaseY = 0;
          recycled.lastStepPhase = -1;
          recycled.obj.rotation.x = 0;
          recycled.obj.rotation.z = 0;
          item = recycled;
        } else {
          const obj = cloneSkinned(scene);
          obj.scale.setScalar(normalizedScale);
          obj.userData.enemyId = e.id;
          obj.userData.enemyMaxHp = e.maxHp;
          obj.userData[DEAD_ENEMY_CLICK_BLOCKER] = undefined;
          // Boss draws after environment props so dense trees / rocks
          // can't visually swallow her silhouette during a wave. Shadow
          // still grounds her since shadows render in their own pass.
          const bossOnTop = kind === "boss";
          obj.traverse((o) => {
            o.userData.enemyId = e.id;
            o.userData.enemyMaxHp = e.maxHp;
            o.userData[DEAD_ENEMY_CLICK_BLOCKER] = undefined;
            if (bossOnTop) o.renderOrder = 10;
            // Painted-look outline gives dinosaurs a dark silhouette pop at
            // gameplay scale. Bloom is deliberately reserved for eyes/VFX;
            // putting the whole body on BLOOM_LAYER made every dinosaur glow.
            o.layers.enable(OUTLINE_LAYER);
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.castShadow = true;
              m.receiveShadow = true;
              // Matriarch GLBs are huge with wide walk-cycle swings (neck +
              // tail). three.js computes a skinned mesh's bounding sphere
              // once from the bind pose, so once the boss is close and her
              // animated silhouette extends past that stale sphere, the
              // per-mesh frustum test culls the whole body the moment the
              // sphere center drifts off-screen — she vanishes mid-fight.
              // Disabling per-mesh culling on the (singleton) boss is cheap
              // and keeps her body drawn for her full lifetime.
              if (kind === "boss") m.frustumCulled = false;
              // SkeletonUtils.clone shares material references across
              // clones, so mutating .emissive for the hit-flash (and
              // .color for the frost tint) would light up every enemy of
              // this kind. Give each clone its own material, and capture
              // the original base color in userData so the frost lerp can
              // restore it each frame.
              if (Array.isArray(m.material)) {
                m.material = m.material.map((mm) => cloneAndCaptureBase(mm));
              } else if (m.material) {
                m.material = cloneAndCaptureBase(m.material as THREE.Material);
              }
              // Rim + toon shader patch on the cloned materials. Stock
              // PBR maps + tint code paths (frost / matriarch tint /
              // adaptive resist) keep working because the patch only
              // adds to outgoingLight before gl_FragColor. Per-frame
              // code refreshes the rim uniform from world.biome so the
              // same recycled clone reads correctly across biomes.
              const rimIntensity =
                bossVariant !== undefined ? RIM_INTENSITY_BOSS : RIM_INTENSITY_ENEMY;
              const mats = Array.isArray(m.material) ? m.material : [m.material];
              const meshName = (m.name || "").toLowerCase();
              const isEye = EYE_FALLBACK_NAMES.some((p) => meshName.includes(p));
              for (const mm of mats) {
                if (!mm) continue;
                applyToonRimPatch(mm, {
                  rim: { color: RIM_COLOR_ENEMY, intensity: rimIntensity },
                });
                const matName = (mm.name || "").toLowerCase();
                const matIsEye = EYE_FALLBACK_NAMES.some((p) => matName.includes(p));
                if (!isEye && !matIsEye) applyBodyPalette(mm, bodyTint, bodyTintAmount);
                // Eye glow: registry-matched material name or fallback
                // mesh/material-name pattern.
                if (isEye || matIsEye) {
                  const eyeSpec = ENEMY_EMISSIVE[kind]?.[0]?.spec;
                  if (eyeSpec) applyEmissiveSpec(mm, eyeSpec);
                  m.layers.enable(BLOOM_LAYER);
                  m.userData.bloom = true;
                }
              }
            }
          });
          const mixer = new THREE.AnimationMixer(obj);
          parent.add(obj);

          let proxy: THREE.Mesh | null = null;
          if (proxyGeom && proxyMat) {
            proxy = new THREE.Mesh(proxyGeom, proxyMat);
            proxy.userData.enemyId = e.id;
            proxy.userData.enemyMaxHp = e.maxHp;
            proxy.renderOrder = -1;
            parent.add(proxy);
          }

          // Bone-grafted alloy plates. The group is a scene sibling, but
          // each plate stores a bind to a clone-local bone so it follows
          // walk/attack/death animation instead of hovering off the skin.
          const matriarch = bossVariant !== undefined;
          const effectiveTier = resolveEnemyTier(kind, matriarch);
          const plateGroup = buildPlateGroup(
            obj,
            kind,
            bossVariant,
            effectiveTier,
            targetSize,
            centerXZ,
          );
          // Plates join the painted-look outline pass so they read as
          // part of the silhouette rather than pasted 3D shapes; they
          // skip BLOOM_LAYER because steel has no emissive.
          plateGroup.traverse((o) => {
            o.layers.enable(OUTLINE_LAYER);
          });
          parent.add(plateGroup);

          item = {
            enemyId: e.id,
            obj,
            proxy,
            mixer,
            clip: null,
            visX: 0,
            visZ: 0,
            visYaw: 0,
            visInit: false,
            wasLeak: false,
            dying: false,
            dyingStart: 0,
            dyingDuration: 0,
            dyingBaseRotX: 0,
            dyingBaseY: 0,
            lastStepPhase: -1,
            plateGroup,
            eyePositions: buildEyePositions(url, targetSize, obj, centerXZ),
          };
        }
        itemsRef.current.set(e.id, item);
        // Register the per-enemy eye profile for the global EnemyEyes pass.
        // Fires on first mount and on every recycle so each enemy id gets a
        // fresh pulseSeed; cleared in recycleOrDispose so a pooled slot
        // doesn't keep emitting for a stale id.
        if (item.eyePositions.length > 0) {
          setEnemyEyeProfile(e.id, {
            positions: item.eyePositions,
            baseColor: eyeBaseColor,
            pulseSeed: (e.id * 0.137) % (Math.PI * 2),
          });
        }
      }

      const leak = e.leak;
      // Stash for the dead-detection pass: leaked enemies (made it to
      // HQ) skip the death anim — they already played the attack pose
      // and despawning them at the gate looks cleaner without a corpse.
      item.wasLeak = leak !== undefined;
      // Engaged dinos (skirmishing with the robot) also pick the attack
      // clip — same animation, different driver. Falls back to the
      // walk loop if the GLB has no Attack/Bite/Roar clip.
      const engagingRobot = !leak && e.engagedRobotId !== null;
      const desiredClip = (leak || engagingRobot) && attackClip ? attackClip : activeClip;
      if (item.clip !== desiredClip) {
        item.mixer.stopAllAction();
        if (desiredClip) item.mixer.clipAction(desiredClip).reset().play();
        item.clip = desiredClip;
      }
      const leakProgress = leak
        ? clamp01((world.time - leak.startedAt) / (leak.impactAt - leak.startedAt))
        : 0;
      const slowed = world.time < e.slowUntil;
      item.mixer.timeScale = (leak && !attackClip ? 0.45 : slowed ? e.slowFactor : 1) * timeScale;
      if (!frozen) item.mixer.update(delta);

      // Matriarch footsteps — phase-locked to the live walk clip so each
      // queen's thuds land on HER foot plants and slow/speed in lockstep with
      // timeScale + cryo. Only fires while the walk clip is the one actually
      // playing (not mid-bite/leak) and the sim is live; otherwise the phase
      // is unprimed so resuming doesn't burst a step.
      if (footstepProfile && !frozen && activeClip?.duration && item.clip === activeClip) {
        const phase =
          (item.mixer.clipAction(activeClip).time % activeClip.duration) / activeClip.duration;
        const prev = item.lastStepPhase;
        if (prev >= 0) {
          for (const p of footstepProfile.phases) {
            const crossed = prev <= phase ? p > prev && p <= phase : p > prev || p <= phase;
            if (crossed) {
              audio.playFootstep("dino", footstepProfile.weight);
              break;
            }
          }
        }
        item.lastStepPhase = phase;
      } else if (footstepProfile) {
        item.lastStepPhase = -1;
      }

      const path = world.paths[e.pathIndex] ?? world.paths[0];
      const dir = smoothDirection(path, e.segment, e.segmentT);
      const targetX = e.pos.x;
      const targetZ = -e.pos.y;
      // Engaged dinos face the robot so the bite/roar reads as an
      // attack on them, not at thin air. Falls back to path yaw when
      // the robot is gone or robot pos coincides with the enemy.
      let pathYaw = dir.x * dir.x + dir.y * dir.y > 1e-6 ? Math.atan2(dir.x, -dir.y) : item.visYaw;
      if (engagingRobot) {
        const robot = world.robot;
        if (robot) {
          const hdx = robot.pos.x - e.pos.x;
          const hdy = robot.pos.y - e.pos.y;
          if (hdx * hdx + hdy * hdy > 1e-6) pathYaw = Math.atan2(hdx, -hdy);
        }
      }
      const motionX = targetX - item.visX;
      const motionZ = targetZ - item.visZ;
      const motionLenSq = motionX * motionX + motionZ * motionZ;
      const pathWorldX = dir.x;
      const pathWorldZ = -dir.y;
      // Engaged with robot — swivel toward the robot while still marching
      // along the path. Sim doesn't redirect movement (no chase), only
      // the model's facing is overridden so the skirmish reads.
      let targetYaw: number;
      if (e.engagedWithRobot) {
        const robotDX = world.robot.pos.x - targetX;
        const robotDZ = -world.robot.pos.y - targetZ;
        if (robotDX * robotDX + robotDZ * robotDZ > 1e-6) {
          targetYaw = Math.atan2(robotDX, robotDZ);
        } else {
          targetYaw = pathYaw;
        }
      } else if (motionLenSq > 1e-6 && motionX * pathWorldX + motionZ * pathWorldZ > 0) {
        targetYaw = Math.atan2(motionX, motionZ);
      } else {
        targetYaw = pathYaw;
      }
      if (!item.visInit) {
        item.visX = targetX;
        item.visZ = targetZ;
        item.visYaw = targetYaw;
        item.visInit = true;
      } else {
        const kp = dampFactor(delta, POS_HALFLIFE);
        item.visX += (targetX - item.visX) * kp;
        item.visZ += (targetZ - item.visZ) * kp;
        const ky = dampFactor(delta, YAW_HALFLIFE);
        item.visYaw += shortAngleDelta(item.visYaw, targetYaw) * ky;
      }

      const poseT = leak ? clamp01((leakProgress - 0.35) / 0.65) : 0;
      const attackPose = Math.sin(poseT * Math.PI);
      const bobY = bob ? Math.sin(world.time * 3 + e.id) * 0.12 : 0;
      item.obj.position.set(
        item.visX - centerXZ.x,
        yOffset - scaledMinY + bobY - attackPose * 0.08,
        item.visZ - centerXZ.z,
      );
      if (item.proxy) {
        // Click target tracks the true sim position so taps line up with
        // the actual enemy state, not the smoothed render lag.
        item.proxy.visible = !leak;
        if (!leak) {
          item.proxy.position.set(
            e.pos.x,
            yOffset - scaledMinY + bobY + proxyRadius * 0.55,
            -e.pos.y,
          );
        }
      }
      item.obj.rotation.set(attackPose * 0.18, baseRotY + item.visYaw, attackPose * 0.035);
      // Publish smoothed body-center XZ + bob so any decoration renderers
      // ride the same animated pose as the skeleton instead of snapping
      // to the raw sim position.
      setEnemyRender(e.id, {
        x: item.visX,
        z: item.visZ,
        y: item.obj.position.y,
        bobY: bobY - attackPose * 0.08,
        yaw: baseRotY + item.visYaw,
      });

      if (item.plateGroup) syncPlateGroup(item.plateGroup);

      const flashing = world.time < e.flashUntil;
      const frost = e.frost;
      // Matriarchs always wear their variant tint — they're a distinct
      // queen, not a chip-stacked rank-and-file. Captured here once per
      // enemy so the inner traverse callback is a cheap branch.
      const matriarch = bossVariant !== undefined;
      // Adaptive-resistance render: enemies whose extraResists were
      // bumped at spawn carry a slight off-color body tint hinting at
      // which damage type they're now hardened against. Lerp amount
      // scales with level (set at spawn into e.adaptiveResistAmount)
      // so later mutations read as more pronounced on screen.
      // Priority is below frost and matriarch tint.
      const adaptiveType = e.adaptiveResistType;
      const adaptiveAmount = e.adaptiveResistAmount ?? 0;
      const adaptiveTint = adaptiveType ? adaptiveTintByType[adaptiveType] : null;
      // Rim hue/intensity handoff. Frost drifts every enemy's rim toward
      // the cool frost color; matriarchs hold their variant biome accent
      // regardless of which biome they walk through, ordinary enemies
      // pick up the biome bias.
      const rimLerp = clamp01(frost * 1.2);
      const rimBoost = flashing ? 1.5 : 1.0;
      const matriarchBiomeForRim =
        bossVariant !== undefined ? MATRIARCH_VARIANT_BIOME[bossVariant] : null;
      const teamRimBase = matriarchBiomeForRim
        ? BIOME_MATRIARCH_RIM[matriarchBiomeForRim]
        : RIM_COLOR_ENEMY;
      const rimAccentBiome = matriarchBiomeForRim ?? world.biome;
      const currentRim = biomeRimColor(teamRimBase, rimAccentBiome);
      const rimScratch = currentRim.clone();
      item.obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
        const apply = (mm: THREE.MeshStandardMaterial) => {
          // Restore base color each frame, then layer on tints in order
          // of priority: frost wins outright (the "frozen solid" read
          // shouldn't fight with body tint). Skipping when both are 0
          // keeps the no-op fast path allocation-free.
          const base = mm.userData.baseColor as THREE.Color | undefined;
          if (base && mm.color) {
            if (frost > 0.01) mm.color.copy(base).lerp(FROST_COLOR, frost);
            else if (matriarch && matriarchMaterial)
              mm.color.copy(base).lerp(variantTint, matriarchMaterial.tintAmount);
            else if (adaptiveTint && adaptiveAmount > 0)
              mm.color.copy(base).lerp(adaptiveTint, adaptiveAmount);
            else mm.color.copy(base);
          }
          if (matriarch && matriarchMaterial) {
            mm.metalness = matriarchMaterial.metalness;
            mm.roughness = matriarchMaterial.roughness;
          }
          // Rim drifts toward frost as the enemy freezes, and brightens
          // briefly on hit. currentRim was composed once per enemy from
          // the team base + biome bias; scratch holds the per-frame
          // tinted value so the inner callback never allocates.
          if (mm.userData.rimColorBase) {
            rimScratch.copy(currentRim);
            if (rimLerp > 0.001) rimScratch.lerp(FROST_RIM_COLOR, rimLerp);
            setRimColor(mm, rimScratch);
            const rimBaseIntensity =
              (mm.userData.rimIntensityBase as number | undefined) ??
              (matriarch ? RIM_INTENSITY_BOSS : RIM_INTENSITY_ENEMY);
            setRimIntensity(mm, rimBaseIntensity * rimBoost);
          }
          if (!mm.emissive) return;
          // Registry-applied emissive overrides are eyes only. Body
          // materials stay dark except for the short hit flash.
          const baseEmissive = mm.userData.baseEmissive as THREE.Color | undefined;
          if (flashing) {
            // Warm-tinted, dimmed flash instead of pure white at full
            // intensity — reads as "got hit" without the harsh clinical
            // pop the (1,1,1) version had against varied dino base colors.
            mm.emissive.setRGB(0.7, 0.6, 0.5);
          } else if (baseEmissive) {
            // Restore captured baseEmissive — preserves registry eye /
            // glow across frames. cloneAndCaptureBase populates
            // baseEmissive at clone time; applyEmissiveSpec overwrites
            // it when the material was tagged with an override.
            mm.emissive.copy(baseEmissive);
          } else {
            mm.emissive.setRGB(0, 0, 0);
          }
        };
        if (Array.isArray(mat)) mat.forEach(apply);
        else apply(mat as THREE.MeshStandardMaterial);
      });
    }

    for (const [id, item] of itemsRef.current) {
      if (live.has(id)) continue;

      if (item.dying) {
        // Death anim in flight: keep ticking the mixer (or tilt-fall the
        // pose if no Death clip is driving it) until the duration runs
        // out, then pool. world.time freezes when status !== "running",
        // so a pause mid-fall holds the pose until the player resumes.
        if (!frozen) item.mixer.update(delta);
        const elapsed = world.time - item.dyingStart;
        const t = clamp01(elapsed / item.dyingDuration);
        const eased = 1 - (1 - t) ** 2;
        if (item.clip === null) {
          item.obj.rotation.x = item.dyingBaseRotX - eased * (Math.PI / 2);
        }
        // Ramp ground lift so the corpse rises just enough to cancel
        // the rest-pose bbox dip as the skeleton flattens. Eased so the
        // first frame doesn't pop and the held-final-pose stays lifted.
        item.obj.position.y = item.dyingBaseY + deathGroundLift * eased;
        if (item.plateGroup) syncPlateGroup(item.plateGroup);
        if (t >= 1) {
          recycleOrDispose(item);
          itemsRef.current.delete(id);
        }
        continue;
      }

      // Fresh transition from live → gone. Skip the death anim for
      // leakers (they reached HQ — the attack pose already covered it)
      // and for non-running states (wave reset shouldn't pile corpses).
      const playDeath = !item.wasLeak && world.status === "running";
      if (!playDeath) {
        recycleOrDispose(item);
        itemsRef.current.delete(id);
        continue;
      }

      item.dying = true;
      item.dyingStart = world.time;
      item.dyingBaseRotX = item.obj.rotation.x;
      item.dyingBaseY = item.obj.position.y;
      clearEnemyRender(id);
      resetEnemyMaterialState(item.obj, false);
      // Strip click affordance immediately — corpse mid-fall is not a
      // valid inspect target.
      item.obj.userData.enemyId = undefined;
      item.obj.userData[DEAD_ENEMY_CLICK_BLOCKER] = true;
      item.obj.traverse((o) => {
        o.userData.enemyId = undefined;
        o.userData[DEAD_ENEMY_CLICK_BLOCKER] = true;
      });
      if (item.proxy) {
        item.proxy.visible = false;
        item.proxy.userData.enemyId = undefined;
      }
      if (deathClip) {
        item.mixer.stopAllAction();
        const action = item.mixer.clipAction(deathClip);
        action.reset();
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.timeScale = 1;
        action.play();
        item.clip = deathClip;
        item.mixer.timeScale = 1;
        item.dyingDuration = Math.max(0.1, deathClip.duration);
      } else {
        // No Death clip in this GLB — freeze the run/walk loop so the
        // pose holds, and let the dying tick handle the forward topple.
        item.mixer.stopAllAction();
        item.clip = null;
        item.dyingDuration = DEATH_FALLBACK_SEC;
      }
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    const state = useGame.getState();
    if (isDeadEnemyBodyHit(e.object)) {
      e.stopPropagation();
      return;
    }
    // Placing a tower? Let the placement plane handle the click.
    if (state.selectedKind !== null) return;
    // Mortar aiming in spot mode outranks inspecting a passing dino —
    // otherwise a wandering enemy would swallow the spot-set click.
    const selId = state.world.selectedTowerId;
    if (selId !== null) {
      const sel = state.world.towerById.get(selId);
      if (sel && sel.kind === "mortar" && sel.targetingMode === "spot") return;
    }
    // An armed dash aim owns the next ground click: yield so it bubbles to
    // the placement plane, which commits the dash toward this spot. Without
    // this, tapping a dino to set the dash direction would inspect it instead
    // and leave the dash hanging — the reported "dash fights dino selection".
    if (state.world.robot.dashAim) return;
    // Robot control outranks dino inspection. When the robot is selected,
    // left-click on a dino must NOT pop the enemy panel and must NOT
    // de-select the robot — instead, let the click bubble through to the
    // placement plane so it becomes an orderRobotMove (treats the dino's
    // ground spot as a waypoint). Right-click on a dino is the dedicated
    // inspect channel below.
    if (state.world.robot.selected) return;
    // Robot outranks dino selection: if the robot proxy is among this click's
    // intersections, yield without stopPropagation so the robot's onClick
    // fires next in the R3F bubbling chain.
    if (
      state.world.robot.alive &&
      e.intersections.some((i) => i.object.userData.robotProxy === true)
    )
      return;
    let obj: THREE.Object3D | null = e.object;
    while (obj && obj.userData.enemyId === undefined) obj = obj.parent;
    if (!obj) return;
    const enemyId = obj.userData.enemyId as number;
    // Defensive: only inspect an enemy that actually exists and is alive.
    // Pooled / dying / leaker meshes are supposed to have enemyId cleared
    // before they go invisible, but a child userData entry can outlive
    // the root clear on the leaker path — refuse to pop a panel for a
    // dino that isn't on the map.
    const enemy = state.world.enemyById.get(enemyId);
    if (!enemy?.alive) return;
    e.stopPropagation();
    state.inspectEnemy(enemyId, kind, obj.userData.enemyMaxHp as number, bossVariant ?? null);
  };

  // Right-click on a dino always opens its info panel, regardless of
  // robot selection. Stop propagation so the placement plane's
  // contextmenu (which would normally issue an orderRobotMove) doesn't
  // also fire — the player asked for info, not a move order.
  const handleContextMenu = (e: ThreeEvent<MouseEvent>) => {
    const state = useGame.getState();
    if (isDeadEnemyBodyHit(e.object)) {
      e.nativeEvent.preventDefault();
      e.stopPropagation();
      return;
    }
    if (state.selectedKind !== null) return;
    // Right-click while a dash aim is armed cancels the aim (handled by the
    // placement plane's contextmenu) rather than inspecting the dino —
    // symmetric with Esc / desktop dash-aim cancel.
    if (state.world.robot.dashAim) return;
    let obj: THREE.Object3D | null = e.object;
    while (obj && obj.userData.enemyId === undefined) obj = obj.parent;
    if (!obj) return;
    const enemyId = obj.userData.enemyId as number;
    const enemy = state.world.enemyById.get(enemyId);
    if (!enemy?.alive) return;
    e.nativeEvent.preventDefault();
    e.stopPropagation();
    state.inspectEnemy(enemyId, kind, obj.userData.enemyMaxHp as number, bossVariant ?? null);
  };

  const handlePointerBlock = (e: ThreeEvent<PointerEvent>) => {
    if (!isDeadEnemyBodyHit(e.object)) return;
    e.stopPropagation();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f scene group handles mesh pointer events, not DOM UI
    <group
      ref={groupRef}
      onPointerDown={handlePointerBlock}
      onPointerUp={handlePointerBlock}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    />
  );
};

useGLTF.preload("/models/Velociraptor.glb");
useGLTF.preload("/models/Trex.glb");
useGLTF.preload("/models/Stegosaurus.glb");
useGLTF.preload("/models/Triceratops.glb");
useGLTF.preload("/models/Parasaurolophus.glb");
useGLTF.preload("/models/Apatosaurus.glb");
