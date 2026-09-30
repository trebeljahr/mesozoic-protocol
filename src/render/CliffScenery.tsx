import { useMemo } from "react";
import type * as THREE from "three";
import type { Biome } from "../biomes";
import type { Vec2 } from "../sim/types";
import { buildCliffs } from "./cliffPlacement";
import { InstancedGroup } from "./InstancedGroup";
import type { MeshSource } from "./meshSource";

const normalizeRock = (source: MeshSource) => 1 / source.maxDim;
const noRaycast: THREE.Mesh["raycast"] = () => {};

export const CliffScenery = ({
  biome,
  levelId,
  paths,
  blockers,
}: {
  biome: Biome;
  levelId: number;
  paths: Vec2[][];
  blockers: { pos: Vec2; radius: number }[];
}) => {
  const groups = useMemo(() => {
    const groups = new Map<string, ReturnType<typeof buildCliffs>>();
    for (const rock of buildCliffs(biome, levelId, paths, blockers)) {
      const items = groups.get(rock.url) ?? [];
      items.push(rock);
      groups.set(rock.url, items);
    }
    return [...groups];
  }, [biome, levelId, paths, blockers]);
  return (
    <group>
      {groups.map(([url, items]) => (
        <InstancedGroup
          key={url}
          url={url}
          items={items}
          baseScaleFor={normalizeRock}
          castShadow={false}
          raycast={noRaycast}
        />
      ))}
    </group>
  );
};
