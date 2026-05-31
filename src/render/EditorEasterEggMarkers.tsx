import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { EASTER_EGG_BY_ID, type EasterEggDef, PRELOAD_URLS } from "../easterEggs";
import { useEditor } from "../editor/editorStore";
import type { PlacedEasterEgg } from "../sim/types";
import { useGame } from "../store";

// Dev-only editor preview for author-placed easter eggs. Renders the live
// GLB at each authored position with a translucent tint and a direction
// arrow so the author can see exactly where the egg will spawn and which
// way moving eggs (tumbleweed/rover/ghost trike) will travel.
//
// Mounted only when the level editor is open (see Scene.tsx). The runtime
// renderer (EasterEggs.tsx) is gated on world.easterEggs which is built
// fresh per level start; this marker layer reads world.authoredEasterEggs
// directly so the preview reflects the in-progress authoring source even
// before the next level reload commits it to runtime.

// Lighter than the runtime renderer's per-egg normalization — we just want
// a recognizable silhouette at the authored position, no click handling or
// animation mixers.
const buildMarkerInstance = (
  scene: THREE.Object3D,
  def: EasterEggDef,
): { clone: THREE.Object3D; scale: number; minY: number } => {
  const clone = scene.clone(true);
  const box = new THREE.Box3().setFromObject(clone);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const scale = def.targetSize / maxDim;
  // Recenter horizontally so the model sits on its own footprint (same as
  // runtime buildInstance — KayKit sci-fi props have geometry offset from
  // origin and would otherwise float to the side of the marker pos).
  clone.position.x -= center.x;
  clone.position.z -= center.z;
  // Apply translucent ghost tint so the marker reads as "preview" vs the
  // solid runtime egg. Clone materials per traversal so we don't bleed the
  // tint into other instances of the same GLB.
  clone.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const cloneMat = (m: THREE.Material): THREE.Material => {
      const cm = m.clone();
      const std = cm as THREE.MeshStandardMaterial;
      if (std.emissive) std.emissive = new THREE.Color("#4fa8ff");
      if (typeof std.emissiveIntensity === "number") std.emissiveIntensity = 0.35;
      std.transparent = true;
      std.opacity = 0.72;
      std.depthWrite = false;
      return cm;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(cloneMat)
      : cloneMat(mesh.material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
  return { clone, scale, minY: box.min.y };
};

const Marker = ({
  egg,
  def,
  selected,
}: {
  egg: PlacedEasterEgg;
  def: EasterEggDef;
  selected: boolean;
}) => {
  const { scene } = useGLTF(def.model);
  const { clone, scale, minY } = useMemo(() => buildMarkerInstance(scene, def), [scene, def]);
  const yOffset = def.visual?.yOffset ?? 0;
  const yModel = yOffset - minY * scale;
  // Selection halo radius scales with the egg footprint so a tiny mushroom
  // doesn't get a giant ring around it.
  const haloRadius = Math.max(def.targetSize * 0.6, 0.8);
  // Arrow length scales similarly. Authored eggs that traverse benefit from
  // a longer arrow so the heading reads clearly in a top-down editor view.
  const arrowLen = def.motion ? 2.6 : 1.4;
  return (
    <group position={[egg.pos.x, 0, -egg.pos.y]} rotation={[0, egg.rotY, 0]}>
      <group position={[0, yModel, 0]} scale={scale}>
        <primitive object={clone} />
      </group>
      {/* Direction arrow — `spawnMovingEasterEgg` derives `vel = (sin rotY,
          -cos rotY)` in game space (game-y maps to -world-z), so the world
          velocity vector at rotY=θ is (sin θ, 0, cos θ). After the outer
          group rotates by rotY around Y, that direction is local +z. So
          the arrow extends along local +z and its tip sits at +arrowLen.
          (The historical comment in src/sim/world.ts:1032 claims model-
          forward is -z; the actual three.js rotation math gives +z, which
          is what the runtime tumbleweed/rover visibly travel along.) */}
      <group position={[0, 0.05, 0]}>
        <mesh position={[0, 0, arrowLen * 0.5]}>
          <boxGeometry args={[0.08, 0.04, arrowLen]} />
          <meshStandardMaterial
            color={selected ? "#ffd86a" : "#4fa8ff"}
            emissive={selected ? "#ffae20" : "#4fa8ff"}
            emissiveIntensity={selected ? 0.9 : 0.5}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, 0, arrowLen]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.18, 0.36, 12]} />
          <meshStandardMaterial
            color={selected ? "#ffd86a" : "#4fa8ff"}
            emissive={selected ? "#ffae20" : "#4fa8ff"}
            emissiveIntensity={selected ? 1.1 : 0.6}
            toneMapped={false}
          />
        </mesh>
      </group>
      {selected && (
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[haloRadius * 0.9, haloRadius, 28]} />
          <meshBasicMaterial color="#ffd86a" transparent opacity={0.65} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
};

export const EditorEasterEggMarkers = () => {
  const active = useEditor((s) => s.active);
  const easterEggTool = useEditor((s) => s.easterEggTool);
  // Subscribe to the editor's version counter so commits trigger a fresh
  // pull of authoredEasterEggs (which lives on the game world).
  const version = useEditor((s) => s.version);
  void version;
  const authored = useGame((s) => s.world.authoredEasterEggs);
  if (!active || authored.length === 0) return null;
  return (
    <group>
      {authored.map((egg) => {
        const def = EASTER_EGG_BY_ID[egg.defId];
        if (!def) return null;
        return (
          <Marker key={egg.id} egg={egg} def={def} selected={easterEggTool.selectedId === egg.id} />
        );
      })}
    </group>
  );
};

// Preload every egg GLB so the editor can flip between defs without each
// click triggering a fresh fetch. The runtime renderer already preloads
// these for gameplay, but the editor surface mounts only in DEV — having
// the preload mirrored here is harmless and keeps the editor's first
// marker swap snappy when running the editor in isolation.
for (const url of PRELOAD_URLS) useGLTF.preload(url);
