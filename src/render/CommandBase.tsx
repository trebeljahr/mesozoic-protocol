import { Suspense, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Biome } from "../biomes";
import type { Vec2 } from "../sim/types";
import { CANISTER_PALETTE } from "./biomeColors";
import { CloningCanister } from "./CloningCanister";
import { commandComplexPlan } from "./commandBaseLayout";
import { commandBuildingPlan } from "./commandBuildingPlan";
import { type CommandPanel, sharedCommandGeometry } from "./sharedCommandGeometry";

const noRaycast: THREE.Mesh["raycast"] = () => {};
type Panel = CommandPanel;

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
  const { panels, tanks } = useMemo(() => {
    const complex = commandComplexPlan(paths);
    const { poses } = complex;
    const result: Panel[] = [];
    for (const pose of poses) {
      const cos = Math.cos(pose.yaw),
        sin = Math.sin(pose.yaw);
      for (const panel of commandBuildingPlan(
        biome,
        seed + pose.index,
        poses.some((other) => other !== pose && other.group === pose.group),
      ))
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
    const shared = sharedCommandGeometry(complex, paths, biome, seed);
    return { panels: [...result, ...shared.panels], tanks: shared.tanks };
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
    <>
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
      <Suspense fallback={null}>
        {tanks.map((tank) => (
          <group
            key={`${tank.pos.x}:${tank.pos.y}`}
            position={[tank.pos.x, 0.4, -tank.pos.y]}
            scale={tank.scale}
          >
            <CloningCanister
              worldX={0}
              worldZ={0}
              yaw={0}
              palette={CANISTER_PALETTE[biome]}
              seed={seed + tank.seed}
            />
          </group>
        ))}
      </Suspense>
    </>
  );
};
