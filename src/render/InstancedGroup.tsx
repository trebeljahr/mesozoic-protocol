import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Vec2 } from "../sim/types";
import { collectMeshSource, type MeshSource } from "./meshSource";

// Shared renderer for the two outdoor cosmetic layers (BiomeCosmetics in
// the playable rectangle, OuterScenery in the band outside it). Both
// place a flat list of {pos, scale, rotY} instances of a single GLB URL,
// grounded so the model's lowest vertex sits at y=0. The differences are
// per-URL scale normalization, shadow casting, and raycast — exposed as
// props so the two layers stay small.

export type GroupItem = { pos: Vec2; scale: number; rotY: number };

type Props<T extends GroupItem> = {
  url: string;
  items: T[];
  // Multiplied into each item.scale. Lets the cosmetic-only renderers
  // normalize to TARGET_SIZE_BY_ROLE without baking that policy here.
  baseScaleFor?: (source: MeshSource, url: string) => number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  raycast?: THREE.Mesh["raycast"];
};

export const InstancedGroup = <T extends GroupItem>({
  url,
  items,
  baseScaleFor,
  castShadow = true,
  receiveShadow = true,
  raycast,
}: Props<T>) => {
  const { scene } = useGLTF(url);
  const source = useMemo(() => collectMeshSource(scene), [scene]);
  const baseScale = source && baseScaleFor ? baseScaleFor(source, url) : 1;
  const partRefs = useRef<(THREE.InstancedMesh | null)[]>([]);

  useEffect(() => {
    if (!source) return;
    const dummy = new THREE.Object3D();
    for (const im of partRefs.current) {
      if (!im) continue;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const s = baseScale * it.scale;
        const cos = Math.cos(it.rotY);
        const sin = Math.sin(it.rotY);
        const centerX = (source.centerX * cos - source.centerZ * sin) * s;
        const centerZ = (source.centerX * sin + source.centerZ * cos) * s;
        dummy.position.set(it.pos.x - centerX, -source.minY * s, -it.pos.y - centerZ);
        dummy.rotation.set(0, it.rotY, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      im.count = items.length;
      im.instanceMatrix.needsUpdate = true;
    }
  }, [items, source, baseScale]);

  if (!source || items.length === 0) return null;

  return (
    <group>
      {source.parts.map((part, pi) => (
        <instancedMesh
          // biome-ignore lint/suspicious/noArrayIndexKey: parts array is stable per scene
          key={pi}
          ref={(el: THREE.InstancedMesh | null) => {
            partRefs.current[pi] = el;
          }}
          args={[part.geom, part.material, items.length]}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          raycast={raycast}
          // Positions are baked into per-instance matrices, so the default
          // origin-centered bounding sphere fails the frustum test once the
          // player zooms in and pans away from origin — culling the whole
          // batch and making every prop vanish. Disable per-batch culling.
          frustumCulled={false}
        />
      ))}
    </group>
  );
};
