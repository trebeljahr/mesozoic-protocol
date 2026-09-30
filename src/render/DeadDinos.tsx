import { useGLTF } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { Fragment, useEffect, useMemo } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Biome } from "../biomes";
import { mulberry32 } from "../sim/random";
import { findClip } from "./animUtils";
import { CARCASS_PALETTES, carcassMaterial, createCarcassCrystals } from "./carcassAppearance";
import { disposeModelInstance } from "./disposeModelInstance";
import { measureVisibleBox } from "./measureModel";

// Shared dead-dinosaur carcass renderer. Used both on the world map (under
// cleared levels) and inside levels (a few corpses near each HQ to read as
// aftermath of prior waves). Each instance gets its own skinned clone via
// SkeletonUtils.clone so per-instance pose state doesn't leak; an
// AnimationMixer is stepped once to the final Death-clip frame and the
// resulting bone pose is baked into the renderer with no per-frame work.

export type DeadDinoSpec = { url: string; footprint: number };

export const DEAD_DINO_SPECS: DeadDinoSpec[] = [
  { url: "/models/Velociraptor.glb", footprint: 3.6 },
  { url: "/models/Parasaurolophus.glb", footprint: 4.0 },
  { url: "/models/Stegosaurus.glb", footprint: 4.2 },
  { url: "/models/Triceratops.glb", footprint: 4.2 },
  { url: "/models/Trex.glb", footprint: 4.6 },
];

export const DEAD_DINO_URLS = DEAD_DINO_SPECS.map((s) => s.url);
export const DEAD_DINO_FOOTPRINT: Record<string, number> = Object.fromEntries(
  DEAD_DINO_SPECS.map((s) => [s.url, s.footprint]),
);
export const isDeadDinoUrl = (url: string) => DEAD_DINO_FOOTPRINT[url] !== undefined;

// Placement uses a circle around the corpse's intended visual center. Use
// more than half the normalized footprint so rotated bbox corners and
// long tail/head silhouettes stay clear of bases and props.
const DEAD_DINO_COLLISION_RADIUS_MUL = 0.62;

export const deadDinoCollisionRadius = (url: string, scale: number): number =>
  (DEAD_DINO_FOOTPRINT[url] ?? 2.0) * scale * DEAD_DINO_COLLISION_RADIUS_MUL;

export type DeadDinoItem = {
  id: string;
  pos: THREE.Vector3;
  rotY: number;
  scale: number;
};

const noRaycast: THREE.Mesh["raycast"] = () => {};
const CORPSE_BLOCKER_HEIGHT = 2.4;

const stopCorpseSelection = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
  e.stopPropagation();
  if ("preventDefault" in e.nativeEvent) e.nativeEvent.preventDefault();
};

type Splat = {
  x: number;
  z: number;
  radius: number;
  color: string;
  opacity: number;
};

type Corpse = {
  id: string;
  obj: THREE.Object3D;
  splats: Splat[];
  crystals: THREE.Mesh | null;
  blockerPos: THREE.Vector3;
  blockerRadius: number;
};

const hashString = (s: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export const DeadDinoInstancer = ({
  url,
  items,
  decorative = false,
  biome,
}: {
  url: string;
  items: DeadDinoItem[];
  decorative?: boolean;
  biome: Biome | ((item: DeadDinoItem) => Biome);
}) => {
  const gltf = useGLTF(url);
  const footprint = DEAD_DINO_FOOTPRINT[url] ?? 2.0;
  const blockerGeom = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 24), []);
  const blockerMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false,
        transparent: true,
        opacity: 0,
      }),
    [],
  );

  useEffect(
    () => () => {
      blockerGeom.dispose();
      blockerMat.dispose();
    },
    [blockerGeom, blockerMat],
  );

  // One skinned clone per instance, posed once at Death-clip end and then
  // left static. Memoized on the source scene + url so HMR rebuilds the
  // clones if the asset reloads but instances aren't re-cloned on every
  // render.
  const clones = useMemo<Corpse[]>(() => {
    return items.map((it) => {
      const habitat = typeof biome === "function" ? biome(it) : biome;
      const obj = cloneSkinned(gltf.scene);
      // Bake the Death-clip end pose. All shipped dino GLBs include
      // a "Death" clip; fall back to substrings (`Die`, `Dead`) for
      // future packs.
      const deathClip =
        findClip(gltf.animations, "Death") ??
        findClip(gltf.animations, "Die") ??
        findClip(gltf.animations, "Dead") ??
        null;
      if (deathClip) {
        const mixer = new THREE.AnimationMixer(obj);
        const action = mixer.clipAction(deathClip);
        action.play();
        action.setLoop(THREE.LoopOnce, 0);
        action.clampWhenFinished = true;
        mixer.setTime(deathClip.duration);
        obj.updateMatrixWorld(true);
      }
      // Normalize the post-death silhouette to the bucket footprint and
      // ground-rest it. measureVisibleBox walks the posed skin (not the
      // bind-pose attribute) so the corpse's actual footprint drives the
      // scale instead of the standing rig.
      const box = measureVisibleBox(obj);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 0.001);
      const s = (footprint / maxDim) * it.scale;
      obj.scale.setScalar(s);
      const scaledBox = measureVisibleBox(obj);
      const center = scaledBox.getCenter(new THREE.Vector3());
      const liftY = Number.isFinite(scaledBox.min.y) ? -scaledBox.min.y : 0;
      const cos = Math.cos(it.rotY);
      const sin = Math.sin(it.rotY);
      const centerX = center.x * cos + center.z * sin;
      const centerZ = -center.x * sin + center.z * cos;
      // Treat item.pos as the corpse's visual XZ center. Death poses are
      // often offset from the rig root, and leaving that offset in place
      // lets a bbox pass placement checks while the mesh clips into bases.
      obj.position.set(it.pos.x - centerX, liftY, it.pos.z - centerZ);
      obj.rotation.set(0, it.rotY, 0);
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        m.raycast = noRaycast;
        if (Array.isArray(m.material))
          m.material = m.material.map((mat) => carcassMaterial(mat, habitat));
        else m.material = carcassMaterial(m.material, habitat);
      });

      // Blood / goo splats — small dark ground decals around the corpse.
      // ~65% of corpses get 1–3 splats; the rest stay clean so the trail
      // doesn't read as a wall of red. Deterministic per corpse id so the
      // splats survive HMR and React re-renders.
      const rng = mulberry32(hashString(it.id));
      const splatColors = CARCASS_PALETTES[habitat].splats;
      const splats: Splat[] = [];
      if (rng() < 0.65) {
        const count = 1 + Math.floor(rng() * 3);
        const corpseHalf = footprint * it.scale * 0.5;
        for (let i = 0; i < count; i++) {
          const angle = rng() * Math.PI * 2;
          const off = corpseHalf * (0.2 + rng() * 0.55);
          const radius = corpseHalf * (0.22 + rng() * 0.28);
          const colorIdx = Math.floor(rng() * splatColors.length);
          splats.push({
            x: it.pos.x + Math.cos(angle) * off,
            z: it.pos.z + Math.sin(angle) * off,
            radius,
            color: splatColors[colorIdx],
            opacity: 0.5 + rng() * 0.25,
          });
        }
      }
      return {
        id: it.id,
        obj,
        splats,
        crystals:
          habitat === "alien"
            ? createCarcassCrystals(obj, footprint * it.scale, hashString(it.id))
            : null,
        blockerPos: it.pos,
        blockerRadius: deadDinoCollisionRadius(url, it.scale),
      };
    });
  }, [gltf.scene, gltf.animations, items, footprint, url, biome]);

  useEffect(
    () => () => {
      for (const corpse of clones) {
        disposeModelInstance(corpse.obj, gltf.scene);
        if (corpse.crystals) {
          corpse.crystals.geometry.dispose();
          for (const material of [corpse.crystals.material].flat()) material.dispose();
        }
      }
    },
    [clones, gltf.scene],
  );

  return (
    <group>
      {clones.map((c) => (
        <Fragment key={c.id}>
          <primitive object={c.obj} />
          {c.crystals && <primitive object={c.crystals} />}
          {!decorative && (
            // biome-ignore lint/a11y/noStaticElementInteractions: invisible r3f hit shield blocks corpse click-through
            <mesh
              geometry={blockerGeom}
              material={blockerMat}
              position={[c.blockerPos.x, CORPSE_BLOCKER_HEIGHT / 2, c.blockerPos.z]}
              scale={[c.blockerRadius, CORPSE_BLOCKER_HEIGHT, c.blockerRadius]}
              onPointerDown={stopCorpseSelection}
              onPointerUp={stopCorpseSelection}
              onClick={stopCorpseSelection}
              onContextMenu={stopCorpseSelection}
              userData={{ corpseClickBlocker: true }}
            />
          )}
          {c.splats.map((s, i) => (
            <mesh
              // biome-ignore lint/suspicious/noArrayIndexKey: deterministic per corpse id
              key={i}
              position={[s.x, 0.012, s.z]}
              rotation={[-Math.PI / 2, 0, 0]}
              raycast={noRaycast}
            >
              <circleGeometry args={[s.radius, 14]} />
              <meshBasicMaterial
                color={s.color}
                transparent
                opacity={s.opacity}
                depthWrite={false}
                polygonOffset
                polygonOffsetFactor={-2}
                polygonOffsetUnits={-2}
              />
            </mesh>
          ))}
        </Fragment>
      ))}
    </group>
  );
};

for (const url of DEAD_DINO_URLS) useGLTF.preload(url);
