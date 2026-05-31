import { useGLTF } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { useEditor } from "../editor/editorStore";
import { dampFactor, shortAngleDelta } from "../sim/angle";
import { ROBOT_SPECS } from "../sim/robotVariants";
import { clamp01 } from "../sim/vec2";
import { useGame } from "../store";
import { cloneAndCaptureBase, findClip } from "./animUtils";
import { ROBOT_EMISSIVE_PATTERNS, ROBOT_VENT_PATTERNS } from "./emissiveRegistry";
import {
  applyEmissiveSpec,
  applyToonRimPatch,
  biomeRimColor,
  RIM_COLOR_ALLY,
  RIM_INTENSITY_ALLY,
} from "./materialTunables";
import { measureVisibleBox } from "./measureModel";
import { BLOOM_LAYER, OUTLINE_LAYER } from "./PaintedPostFx";

const ROBOT_URL: Record<string, string> = {
  george: "/models/robots/George.glb",
  leela: "/models/robots/Leela.glb",
  mike: "/models/robots/Mike.glb",
  stan: "/models/robots/Stan.glb",
};

const TARGET_SIZE = 1.8;
const POS_HALFLIFE = 0.04;
const YAW_HALFLIFE = 0.08;
// Reference hover lift used to normalize jet opacity. Stays in sync
// with ROBOT_HOVER_HEIGHT in sim/robot.ts; render reads robot.hoverHeight
// directly and divides by this to get a 0..1 intensity.
const HOVER_HEIGHT_FULL = 0.55;
const FLASH_COLOR = new THREE.Color("#ff8a4a");
const MUZZLE_ANCHOR_NAMES = [
  "Hand.R",
  "LowerArm.R",
  "UpperArm.R",
  "Shoulder.R",
  "Chest",
  "Body",
  "Head",
];
const MUZZLE_FORWARD_OFFSET = 0.3;
const MUZZLE_SIDE_OFFSET = 0.12;

const isCorpseClickBlocker = (object: THREE.Object3D): boolean => {
  let obj: THREE.Object3D | null = object;
  while (obj) {
    if (obj.userData.corpseClickBlocker === true || obj.userData.deadEnemyClickBlocker === true) {
      return true;
    }
    obj = obj.parent;
  }
  return false;
};

export const ModelRobotMesh = () => {
  const variant = useGame((s) => s.world.robot.variant);
  const url = ROBOT_URL[variant] ?? ROBOT_URL.george;
  const jetColor = useMemo(() => new THREE.Color(ROBOT_SPECS[variant].tint), [variant]);
  const { scene, animations } = useGLTF(url);

  const groupRef = useRef<THREE.Group>(null);
  const objRef = useRef<THREE.Object3D | null>(null);
  const muzzleAnchorRef = useRef<THREE.Object3D | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const currentClipRef = useRef<string | null>(null);
  const matsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const visRef = useRef<{ x: number; z: number; yaw: number; init: boolean }>({
    x: 0,
    z: 0,
    yaw: 0,
    init: false,
  });
  const jetRef = useRef<THREE.Mesh>(null);
  const muzzleWorld = useMemo(() => new THREE.Vector3(), []);
  const muzzleForward = useMemo(() => new THREE.Vector3(), []);
  const muzzleSide = useMemo(() => new THREE.Vector3(), []);

  const { normalizedScale, centerXZ, scaledMinY } = useMemo(() => {
    const box = measureVisibleBox(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const s = TARGET_SIZE / maxDim;
    return {
      normalizedScale: s,
      centerXZ: { x: center.x * s, z: center.z * s },
      scaledMinY: box.min.y * s,
    };
  }, [scene]);

  const clips = useMemo(() => {
    const rawDeath = findClip(animations, ["Death"]);
    // Strip position tracks from the death clip so the model dies in
    // place. Otherwise the death anim's baked root motion translates the
    // mesh, and on revive the bones snap back to bind pose — reading as
    // a teleport at the moment of revive.
    const death = rawDeath
      ? new THREE.AnimationClip(
          rawDeath.name,
          rawDeath.duration,
          rawDeath.tracks.filter((t) => !t.name.endsWith(".position")),
        )
      : null;
    return {
      idle: findClip(animations, ["Idle"]),
      walk: findClip(animations, ["Walk"]),
      run: findClip(animations, ["Run"]),
      shoot: findClip(animations, ["Shoot"]),
      death,
      dash: findClip(animations, ["Run", "Walk_Tall"]),
    };
  }, [animations]);

  useEffect(() => {
    const parent = groupRef.current;
    if (!parent) return;
    const obj = cloneSkinned(scene);
    obj.scale.setScalar(normalizedScale);
    const mats: THREE.MeshStandardMaterial[] = [];
    const world = useGame.getState().world;
    const rimTinted = biomeRimColor(RIM_COLOR_ALLY, world.biome);
    obj.traverse((o) => {
      // Robot opts into selective bloom (canopy / vents / shoot flash) and
      // outline (silhouette pop at thumbnail scale). Layer membership is
      // per-Object3D, so applying on every descendant covers the skinned
      // skeleton plus any attached props.
      o.layers.enable(BLOOM_LAYER);
      o.layers.enable(OUTLINE_LAYER);
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        if (Array.isArray(m.material)) {
          m.material = m.material.map((mm) => {
            const c = cloneAndCaptureBase(mm);
            if ((c as THREE.MeshStandardMaterial).emissive) {
              mats.push(c as THREE.MeshStandardMaterial);
            }
            return c;
          });
        } else if (m.material) {
          const c = cloneAndCaptureBase(m.material as THREE.Material);
          m.material = c;
          if ((c as THREE.MeshStandardMaterial).emissive) {
            mats.push(c as THREE.MeshStandardMaterial);
          }
        }
        // Rim + toon shader patch on every cloned material. Hit-flash
        // and muzzle-flash code below already restores baseEmissive on
        // each frame, so the registry visor/vent glows survive the
        // flash dip via the emissiveOverride flag.
        const mlist = Array.isArray(m.material) ? m.material : [m.material];
        const meshNameLc = (m.name || "").toLowerCase();
        let anyEmissive = false;
        for (const mm of mlist) {
          if (!mm) continue;
          applyToonRimPatch(mm, {
            rim: { color: rimTinted, intensity: RIM_INTENSITY_ALLY },
          });
          const matName = (mm.name || "").toLowerCase();
          const visorPattern = ROBOT_EMISSIVE_PATTERNS.find(
            (p) =>
              (meshNameLc.includes(p.match) || matName.includes(p.match)) && p.intensityMul > 0,
          );
          if (visorPattern) {
            applyEmissiveSpec(mm, {
              color: jetColor,
              intensity: visorPattern.intensityMul,
              bloom: true,
            });
            anyEmissive = true;
            continue;
          }
          const ventPattern = ROBOT_VENT_PATTERNS.find(
            (p) =>
              (meshNameLc.includes(p.match) || matName.includes(p.match)) && p.intensityMul > 0,
          );
          if (ventPattern) {
            applyEmissiveSpec(mm, {
              color: jetColor,
              intensity: ventPattern.intensityMul,
              bloom: true,
            });
            anyEmissive = true;
          }
        }
        if (anyEmissive) m.userData.bloom = true;
      }
    });
    muzzleAnchorRef.current =
      MUZZLE_ANCHOR_NAMES.map((name) => obj.getObjectByName(name)).find(Boolean) ?? obj;
    const mixer = new THREE.AnimationMixer(obj);
    parent.add(obj);
    objRef.current = obj;
    mixerRef.current = mixer;
    matsRef.current = mats;
    return () => {
      mixer.stopAllAction();
      parent.remove(obj);
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.material) return;
        if (Array.isArray(m.material)) for (const mm of m.material) mm.dispose();
        else (m.material as THREE.Material).dispose();
      });
      objRef.current = null;
      muzzleAnchorRef.current = null;
      mixerRef.current = null;
      matsRef.current = [];
      currentClipRef.current = null;
    };
  }, [scene, normalizedScale, jetColor]);

  useFrame((_, delta) => {
    const obj = objRef.current;
    const mixer = mixerRef.current;
    if (!obj || !mixer) return;
    const { world } = useGame.getState();
    const robot = world.robot;
    const frozen = world.status !== "running";

    // Pick clip by state. Shoot stamps a quick flash; dash + walk are
    // looping; death pinned to last frame.
    let pick: THREE.AnimationClip | null = null;
    let key = "idle";
    if (robot.motionState === "dead") {
      pick = clips.death ?? clips.idle;
      key = "death";
    } else if (robot.motionState === "dash") {
      pick = clips.run ?? clips.walk ?? clips.idle;
      key = "run";
    } else if (robot.motionState === "walk") {
      pick = clips.walk ?? clips.run ?? clips.idle;
      key = "walk";
    } else if (robot.motionState === "shoot") {
      pick = clips.shoot ?? clips.idle;
      key = "shoot";
    } else {
      pick = clips.idle ?? clips.walk;
      key = "idle";
    }
    if (currentClipRef.current !== key) {
      mixer.stopAllAction();
      if (pick) {
        const action = mixer.clipAction(pick);
        action.reset();
        if (key === "death") {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        action.play();
      }
      currentClipRef.current = key;
    }
    mixer.timeScale = robot.motionState === "dash" ? 1.45 : 1;
    if (!frozen) mixer.update(delta);

    // Smoothed visual transform. Source-of-truth pos stays on robot.pos.
    const vis = visRef.current;
    const targetX = robot.pos.x;
    const targetZ = -robot.pos.y;
    if (!vis.init) {
      vis.x = targetX;
      vis.z = targetZ;
      vis.yaw = robot.facing;
      vis.init = true;
    } else {
      const kp = dampFactor(delta, POS_HALFLIFE);
      vis.x += (targetX - vis.x) * kp;
      vis.z += (targetZ - vis.z) * kp;
      const ky = dampFactor(delta, YAW_HALFLIFE);
      vis.yaw += shortAngleDelta(vis.yaw, robot.facing) * ky;
    }

    obj.position.set(vis.x - centerXZ.x, -scaledMinY + robot.hoverHeight, vis.z - centerXZ.z);
    obj.rotation.set(0, vis.yaw, 0);
    obj.visible = robot.alive || robot.motionState === "dead";
    obj.updateMatrixWorld(true);

    // Feed sim/VFX with the animated muzzle point. Leela's model has no
    // explicit arm bone, so the anchor search falls back through upper
    // body nodes and still follows the active animation instead of the
    // static robot center.
    if (robot.alive) {
      const anchor = muzzleAnchorRef.current ?? obj;
      anchor.getWorldPosition(muzzleWorld);
      muzzleForward.set(Math.sin(vis.yaw), 0, Math.cos(vis.yaw));
      muzzleSide.set(Math.cos(vis.yaw), 0, -Math.sin(vis.yaw));
      muzzleWorld
        .addScaledVector(muzzleForward, MUZZLE_FORWARD_OFFSET)
        .addScaledVector(muzzleSide, MUZZLE_SIDE_OFFSET);
      robot.muzzlePos = {
        x: muzzleWorld.x,
        y: -muzzleWorld.z,
        h: Math.max(0.45, muzzleWorld.y),
      };
    } else {
      robot.muzzlePos = null;
    }

    // Jetpack jet visual — two downward thrust cones beneath the
    // robot whose opacity tracks the hover engagement so they fade in
    // as the robot lifts off and out as she touches dry ground.
    const jet = jetRef.current;
    if (jet) {
      const lift = robot.hoverHeight;
      const intensity = clamp01(lift / HOVER_HEIGHT_FULL);
      jet.visible = intensity > 0.02;
      if (jet.visible) {
        jet.position.set(vis.x, lift * 0.55, vis.z);
        const flicker = 0.85 + Math.sin(world.time * 38) * 0.15;
        jet.scale.set(0.55, 0.55 * flicker, 0.55);
        const mat = jet.material as THREE.MeshBasicMaterial;
        mat.opacity = intensity * 0.85;
      }
    }

    // Flash tint: hurt + muzzle flare share a warm emissive pop.
    const flashing = world.time < robot.flashUntil || world.time < robot.shootFlashUntil;
    for (const m of matsRef.current) {
      const base = m.userData.baseEmissive as THREE.Color | undefined;
      if (!base) continue;
      if (flashing) m.emissive.copy(FLASH_COLOR).multiplyScalar(0.5);
      else m.emissive.copy(base);
    }
  });

  // Click target — invisible sphere above the robot so a single click
  // is enough to "select" her (then the next ground click moves).
  const proxyRadius = TARGET_SIZE * 0.6;
  const proxyGeom = useMemo(() => new THREE.SphereGeometry(proxyRadius, 8, 6), [proxyRadius]);
  const proxyMat = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    [],
  );
  // Jetpack thrust cone — open end down, tapers toward the robot's feet.
  // ConeGeometry's default orientation points +Y, so rotate it so the
  // wide end faces the ground (-Y) for a plausible exhaust shape.
  const jetGeom = useMemo(() => {
    const g = new THREE.ConeGeometry(0.55, 1.1, 14, 1, true);
    g.rotateX(Math.PI);
    return g;
  }, []);
  const jetMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: jetColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [jetColor],
  );
  useEffect(
    () => () => {
      proxyGeom.dispose();
      proxyMat.dispose();
      jetGeom.dispose();
      jetMat.dispose();
    },
    [proxyGeom, proxyMat, jetGeom, jetMat],
  );
  const proxyRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const mesh = proxyRef.current;
    if (!mesh) return;
    const robot = useGame.getState().world.robot;
    mesh.visible = robot.alive;
    mesh.position.set(robot.pos.x, proxyRadius * 0.9, -robot.pos.y);
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (useEditor.getState().active) {
      e.stopPropagation();
      return;
    }
    const state = useGame.getState();
    const robotHitIndex = e.intersections.findIndex(
      (hit) => hit.object.userData.robotProxy === true,
    );
    const corpseHitIndex = e.intersections.findIndex((hit) => isCorpseClickBlocker(hit.object));
    if (corpseHitIndex !== -1 && (robotHitIndex === -1 || corpseHitIndex <= robotHitIndex)) {
      e.stopPropagation();
      return;
    }
    // Mortar spot mode still wins — clicking the robot while aiming a
    // mortar sets the spot, not the selection.
    const selId = state.world.selectedTowerId;
    if (selId !== null) {
      const sel = state.world.towerById.get(selId);
      if (sel && sel.kind === "mortar" && sel.targetingMode === "spot") return;
    }
    // An armed dash aim owns the next click: yield so it bubbles to the
    // placement plane and commits the dash instead of toggling selection.
    if (state.world.robot.dashAim) return;
    e.stopPropagation();
    // Selecting the robot cancels active tower placement (selectRobotUnit
    // nulls selectedKind), so a click on the robot mid-placement switches
    // intent to the robot instead of dropping a tower under it.
    state.selectRobotUnit(!state.world.robot.selected);
  };

  return (
    <group ref={groupRef}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: invisible r3f mesh is the robot click proxy */}
      <mesh
        ref={proxyRef}
        geometry={proxyGeom}
        material={proxyMat}
        onClick={onClick}
        userData={{ robotProxy: true }}
      />
      <mesh ref={jetRef} geometry={jetGeom} material={jetMat} visible={false} />
    </group>
  );
};

useGLTF.preload("/models/robots/George.glb");
useGLTF.preload("/models/robots/Leela.glb");
useGLTF.preload("/models/robots/Mike.glb");
useGLTF.preload("/models/robots/Stan.glb");
