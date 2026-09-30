import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Vec2 } from "../sim/types";
import { setGroundedTransform } from "./groundedTransform";
import { collectMeshSource, type MeshSource } from "./meshSource";
import { SceneryBatches } from "./SceneryBatches";

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
  tint?: [number, number, number];
  raycast?: THREE.Mesh["raycast"];
};

export const InstancedGroup = <T extends GroupItem>({
  url,
  items,
  baseScaleFor,
  castShadow = true,
  receiveShadow = true,
  raycast,
  tint,
}: Props<T>) => {
  const { scene } = useGLTF(url);
  const source = useMemo(() => collectMeshSource(scene), [scene]);
  const parts = useMemo(() => {
    if (!source || !tint) return source?.parts ?? [];
    const wash = new THREE.Color(...tint);
    return source.parts.map((part) => {
      const material = part.material.clone();
      const colored = material as THREE.MeshStandardMaterial;
      if (colored.color) colored.color.multiply(wash);
      return { ...part, material };
    });
  }, [source, tint]);
  useEffect(
    () => () => {
      if (tint) for (const part of parts) part.material.dispose();
    },
    [parts, tint],
  );
  const baseScale = source && baseScaleFor ? baseScaleFor(source, url) : 1;
  if (!source || items.length === 0) return null;
  return (
    <SceneryBatches
      parts={parts}
      items={items}
      position={itemPosition}
      transform={(dummy, it) =>
        setGroundedTransform(dummy, source, it.pos, it.rotY, baseScale * it.scale)
      }
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      raycast={raycast}
    />
  );
};

const itemPosition = (item: GroupItem) => item.pos;
