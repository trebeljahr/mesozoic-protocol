import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Biome } from "../biomes";
import type { Vec2 } from "../sim/types";
import { commandComplexPlan, HQ_CONNECTOR_WIDTH } from "./commandBaseLayout";
import { COMMAND_PALETTES, commandBuildingPlan } from "./commandBuildingPlan";
import type { BaseBlock } from "./modularBasePlan";

const noRaycast: THREE.Mesh["raycast"] = () => {};
type Panel = BaseBlock & { yaw: number };

/** Command wings and rear service galleries share one instanced draw call. */
export const CommandBase = ({
  paths,
  biome = "forest",
  seed = 0,
}: {
  paths: Vec2[][];
  biome?: Biome;
  seed?: number;
}) => {
  const ref = useRef<THREE.InstancedMesh>(null);
  const panels = useMemo(() => {
    const { poses, links } = commandComplexPlan(paths);
    const result: Panel[] = [];
    for (const pose of poses) {
      const cos = Math.cos(pose.yaw),
        sin = Math.sin(pose.yaw);
      for (const panel of commandBuildingPlan(biome, seed + pose.index))
        result.push({
          ...panel,
          at: [
            pose.end.x + panel.at[0] * cos + panel.at[2] * sin,
            panel.at[1],
            -pose.end.y - panel.at[0] * sin + panel.at[2] * cos,
          ],
          yaw: pose.yaw,
        });
    }
    const [, trim, steel, lamp] = COMMAND_PALETTES[biome];
    for (const link of links) {
      const length = Math.hypot(link.b.x - link.a.x, link.b.y - link.a.y);
      const yaw = Math.atan2(link.b.x - link.a.x, -(link.b.y - link.a.y));
      const add = (y: number, height: number, width: number, color: string) =>
        result.push({
          at: [(link.a.x + link.b.x) / 2, y, -(link.a.y + link.b.y) / 2],
          size: [width, height, length],
          color,
          yaw,
        });
      add(0.16, 0.24, HQ_CONNECTOR_WIDTH, steel);
      add(0.92, 1.28, HQ_CONNECTOR_WIDTH * 0.72, steel);
      add(1.72, 0.14, HQ_CONNECTOR_WIDTH, trim);
      // Inset illuminated roof guide: a single continuous service spine.
      add(1.8, 0.025, HQ_CONNECTOR_WIDTH * 0.28, lamp);
    }
    return result;
  }, [paths, biome, seed]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D(),
      color = new THREE.Color();
    panels.forEach((panel, i) => {
      dummy.position.set(...panel.at);
      dummy.rotation.set(0, panel.yaw, 0);
      dummy.scale.set(...panel.size);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.set(panel.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [panels]);
  if (!panels.length) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, panels.length]}
      castShadow
      receiveShadow
      raycast={noRaycast}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.78} metalness={0.18} />
    </instancedMesh>
  );
};
