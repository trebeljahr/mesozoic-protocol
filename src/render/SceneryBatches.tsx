import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { partitionScenery, updateSceneryBounds } from "./sceneryBounds";

type Part = { geom: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] };
type Props<T> = {
  parts: Part[];
  items: T[];
  position: (item: T) => { x: number; y: number };
  transform: (dummy: THREE.Object3D, item: T) => void;
  castShadow?: boolean;
  receiveShadow?: boolean;
  raycast?: THREE.Mesh["raycast"];
};

export function SceneryBatches<T>(props: Props<T>) {
  const { items, position } = props;
  const cells = useMemo(() => partitionScenery(items, position), [items, position]);
  return (
    <group>
      {cells.map((cell) => (
        <SceneryCell key={cell.key} {...props} items={cell.items} />
      ))}
    </group>
  );
}

function SceneryCell<T>({
  parts,
  items,
  transform,
  castShadow = true,
  receiveShadow = true,
  raycast,
}: Props<T>) {
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: new geometry reconstructs meshes and needs fresh matrices/bounds
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    for (const mesh of refs.current) {
      if (!mesh) continue;
      items.forEach((item, i) => {
        transform(dummy, item);
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.count = items.length;
      updateSceneryBounds(mesh);
    }
  }, [items, transform, parts]);
  // Each reconstructed mesh owns its instance buffers, but not the shared parts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these values reconstruct the meshes
  useLayoutEffect(() => {
    const meshes = refs.current.slice();
    return () => {
      for (const mesh of meshes) mesh?.dispose();
    };
  }, [parts, items.length]);
  return (
    <group>
      {parts.map((part, i) => (
        <instancedMesh
          key={part.geom.uuid}
          ref={(mesh) => {
            refs.current[i] = mesh;
          }}
          args={[part.geom, part.material, items.length]}
          // Parts are shared across cells; removing one cell must not dispose them.
          dispose={null}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          raycast={raycast}
        />
      ))}
    </group>
  );
}
