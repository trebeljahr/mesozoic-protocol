import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { TowerKind, TowerUpgrades } from "../sim/types";
import { useGame } from "../store";
import { TOWER_EMISSIVE } from "./emissiveRegistry";
import {
  applyEmissiveSpec,
  applyToonRimPatch,
  biomeRimColor,
  RIM_COLOR_ALLY,
  RIM_COLOR_CRYO,
  RIM_COLOR_FLAME,
  RIM_INTENSITY_ALLY,
} from "./materialTunables";
import { type AtlasSwatch, computeTowerTints, tierKey } from "./towerTints";

type AtlasState = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  source: TexImageSource;
};

type AtlasMaterial = THREE.MeshStandardMaterial & {
  __atlasState?: AtlasState;
};

const setupAtlasState = (mat: AtlasMaterial): AtlasState | null => {
  if (mat.__atlasState) return mat.__atlasState;
  const origMap = mat.map;
  const src = origMap?.image as TexImageSource | undefined;
  if (!origMap || !src) return null;
  const w = (src as HTMLImageElement | HTMLCanvasElement).width;
  const h = (src as HTMLImageElement | HTMLCanvasElement).height;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = origMap.magFilter;
  tex.minFilter = origMap.minFilter;
  tex.wrapS = origMap.wrapS;
  tex.wrapT = origMap.wrapT;
  tex.colorSpace = origMap.colorSpace;
  tex.flipY = origMap.flipY;
  tex.generateMipmaps = false;
  mat.map = tex;
  // Atlas materials previously relied on `mat.color` / `mat.emissive` to
  // multiply the shared texture. Now the texture itself carries the
  // per-part colours, so neutralise both factors.
  mat.color.setRGB(1, 1, 1);
  mat.emissive.setRGB(0, 0, 0);
  mat.emissiveIntensity = 0;
  mat.needsUpdate = true;
  const state: AtlasState = { canvas, ctx, tex, source: src };
  mat.__atlasState = state;
  return state;
};

const repaintAtlas = (state: AtlasState, swatches: AtlasSwatch[]) => {
  const { ctx, canvas, source } = state;
  // Reset to the pristine baked atlas, then stamp the per-tier swatches.
  // Starting from the source on every tier change keeps swatches that the
  // current tier doesn't override at their original baked colours.
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source as CanvasImageSource, 0, 0);
  for (const sw of swatches) {
    const r = Math.round(Math.min(1, Math.max(0, sw.rgb[0])) * 255);
    const g = Math.round(Math.min(1, Math.max(0, sw.rgb[1])) * 255);
    const b = Math.round(Math.min(1, Math.max(0, sw.rgb[2])) * 255);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(sw.x, 0, 4, canvas.height);
  }
  state.tex.needsUpdate = true;
};

// Per-kind rim base. Most kinds use the cyan-white ally rim; flame
// pulls warm orange, cryo pulls cool blue-white.
const TOWER_RIM_BASE: Record<TowerKind, string> = {
  pulse: RIM_COLOR_ALLY,
  chain: RIM_COLOR_ALLY,
  cryo: RIM_COLOR_CRYO,
  mortar: RIM_COLOR_ALLY,
  flame: RIM_COLOR_FLAME,
  hive: RIM_COLOR_ALLY,
};

const applyTints = (item: THREE.Object3D, kind: TowerKind, upgrades: TowerUpgrades) => {
  const tints = computeTowerTints(kind, upgrades);
  if (tints.length === 0) return;
  item.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const raw of mats) {
      const mat = raw as AtlasMaterial;
      if (!mat) continue;
      const tint = tints.find((tn) => mat.name.includes(tn.match));
      if (!tint) continue;
      if (tint.kind === "material") {
        // Untextured baseColorFactor part — set its colour directly.
        mat.color.setRGB(tint.rgb[0], tint.rgb[1], tint.rgb[2]);
        if (tint.emissive) {
          mat.emissive.setRGB(tint.emissive[0], tint.emissive[1], tint.emissive[2]);
          mat.emissiveIntensity = 1;
        }
        mat.needsUpdate = true;
      } else {
        // Atlas part — repaint the per-instance cloned PaletteBaseColor.
        const state = setupAtlasState(mat);
        if (state) repaintAtlas(state, tint.swatches);
      }
    }
  });
};

type Props = {
  kind: TowerKind;
  url: string;
  targetSize: number;
  yOffset?: number;
  baseRotY?: number;
  idleSpin?: boolean;
};

export const ModelTowerMesh = ({
  kind,
  url,
  targetSize,
  yOffset = 0,
  baseRotY = 0,
  idleSpin = false,
}: Props) => {
  const { scene } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);
  const itemsRef = useRef<Map<number, THREE.Object3D>>(new Map());
  // Last upgrade-tier pair we tinted each tower at. Lets the frame loop
  // skip re-applying tints when nothing changed.
  const tierRef = useRef<Map<number, number>>(new Map());

  const { normalizedScale, centerXZ, scaledMinY } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
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

  useEffect(() => {
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;
        // Flamethrower's particle stream extends far beyond the turret's
        // bounding box. When the player zooms in and pans so the nozzle
        // sits off-screen, the model's per-mesh frustum test kills the
        // draw — and visually the flame stream + emissive nozzle vanish
        // with it. Disabling per-mesh culling on tower models is cheap
        // (6 kinds, low instance counts) and prevents the pop.
        m.frustumCulled = false;
      }
    });
  }, [scene]);

  useEffect(
    () => () => {
      const parent = groupRef.current;
      if (!parent) return;
      for (const [, item] of itemsRef.current) parent.remove(item);
      itemsRef.current.clear();
    },
    [],
  );

  useFrame(() => {
    const parent = groupRef.current;
    if (!parent) return;
    const { world } = useGame.getState();
    const rimBase = TOWER_RIM_BASE[kind];
    const rimTinted = biomeRimColor(rimBase, world.biome);
    const emissivePatterns = TOWER_EMISSIVE[kind] ?? [];

    const live = new Set<number>();
    for (const t of world.towers) {
      if (t.kind !== kind) continue;
      live.add(t.id);
      let item = itemsRef.current.get(t.id);
      if (!item) {
        item = scene.clone(true);
        item.scale.setScalar(normalizedScale);
        // Per-instance material clones — the GLTF cache hands every
        // tower the same material reference by default, so tinting one
        // would tint them all. Clone here so each tower's upgrade
        // colours are independent.
        item.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.frustumCulled = false;
          const m = mesh.material;
          if (Array.isArray(m)) mesh.material = m.map((sub) => sub.clone());
          else if (m) mesh.material = m.clone();
          // Rim + toon patch on every cloned material. Emissive accents
          // are applied below by matching material-name patterns from
          // the registry; matches set userData.bloom so the post-FX
          // selective-bloom pass can pick them up.
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          let anyEmissive = false;
          for (const mm of mats) {
            if (!mm) continue;
            applyToonRimPatch(mm, {
              rim: { color: rimTinted, intensity: RIM_INTENSITY_ALLY },
            });
            const nameLc = (mm.name || "").toLowerCase();
            for (const pat of emissivePatterns) {
              if (!pat.spec.intensity || !nameLc.includes(pat.match.toLowerCase())) continue;
              applyEmissiveSpec(mm, pat.spec);
              anyEmissive = true;
            }
          }
          if (anyEmissive) mesh.userData.bloom = true;
        });
        parent.add(item);
        itemsRef.current.set(t.id, item);
        tierRef.current.set(t.id, -1);
      }

      const key = tierKey(t.upgrades);
      if (tierRef.current.get(t.id) !== key) {
        applyTints(item, kind, t.upgrades);
        tierRef.current.set(t.id, key);
      }

      item.position.set(t.pos.x - centerXZ.x, yOffset - scaledMinY, -t.pos.y - centerXZ.z);

      let yaw = 0;
      if (idleSpin) {
        yaw = world.time * 1.2;
      } else if (t.targetingMode === "spot" && t.targetSpot) {
        const dx = t.targetSpot.x - t.pos.x;
        const dy = t.targetSpot.y - t.pos.y;
        yaw = Math.atan2(dx, -dy);
      } else if (t.targetId !== null) {
        const target = world.enemyById.get(t.targetId);
        if (target?.alive && !target.leak) {
          const dx = target.pos.x - t.pos.x;
          const dy = target.pos.y - t.pos.y;
          yaw = Math.atan2(dx, -dy);
        }
      }
      item.rotation.set(0, baseRotY + yaw, 0);
    }

    for (const [id, item] of itemsRef.current) {
      if (!live.has(id)) {
        parent.remove(item);
        itemsRef.current.delete(id);
        tierRef.current.delete(id);
      }
    }
  });

  return <group ref={groupRef} />;
};

useGLTF.preload("/models/tower_pulse.glb");
useGLTF.preload("/models/turrets/Lighting Turret.glb");
useGLTF.preload("/models/turrets/Missile Turret.glb");
useGLTF.preload("/models/turrets/Emp Turret.glb");
useGLTF.preload("/models/turrets/Flamethrower Turret.glb");
useGLTF.preload("/models/turrets/Hive Turret.glb");
