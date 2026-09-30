import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Biome } from "../biomes";
import type { Outpost } from "../sim/types";
import { CourtyardEquipment } from "./CourtyardEquipment";
import { baseSeed, courtyardBaseScale, modularBasePlan } from "./modularBasePlan";

const noRaycast: THREE.Mesh["raycast"] = () => {};

/** One instanced draw for all compound panels, equipment, and connecting decks. */
export function ModularBases({
  outposts,
  biome,
  seed: levelSeed = 0,
}: {
  outposts: Outpost[];
  biome: Biome;
  seed?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  // At most one landmark per map, using the largest existing reservation.
  const courtyard = useMemo(() => {
    const candidates = outposts.filter((o) => !o.interior && o.radius >= 3.2);
    return candidates.sort((a, b) => b.radius - a.radius || a.id - b.id)[0];
  }, [outposts]);
  const blocks = useMemo(
    () =>
      outposts
        .filter((o) => !o.interior)
        .flatMap((o) => {
          const seed = baseSeed(o) + levelSeed * 17;
          return modularBasePlan(biome, seed, o.radius, o.id === courtyard?.id).map((block) => ({
            ...block,
            outpost: o,
          }));
        }),
    [outposts, biome, courtyard, levelSeed],
  );
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    blocks.forEach(({ at, size, color: tint, outpost }, i) => {
      const yaw = outpost.yaw;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      dummy.position.set(
        outpost.pos.x + at[0] * cos + at[2] * sin,
        at[1],
        -outpost.pos.y - at[0] * sin + at[2] * cos,
      );
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(...size);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.set(tint));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [blocks]);
  if (!blocks.length) return null;
  return (
    <>
      <instancedMesh
        ref={ref}
        args={[undefined, undefined, blocks.length]}
        castShadow
        receiveShadow
        raycast={noRaycast}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.83} metalness={0.15} />
      </instancedMesh>
      {courtyard && (
        <group
          position={[courtyard.pos.x, 0, -courtyard.pos.y]}
          rotation={[0, courtyard.yaw, 0]}
          scale={courtyardBaseScale(courtyard.radius)}
        >
          <CourtyardEquipment biome={biome} seed={baseSeed(courtyard) + levelSeed * 17} />
        </group>
      )}
    </>
  );
}
