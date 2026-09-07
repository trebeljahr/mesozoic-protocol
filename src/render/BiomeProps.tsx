import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { classifyPropUrl, TARGET_SIZE_BY_ROLE } from "../biomes";
import { useWorldMapEditor } from "../editor/worldMapEditorStore";
import { useGame } from "../store";
import { DeadDinoInstancer, isDeadDinoUrl } from "./DeadDinos";
import { collectMeshSource } from "./meshSource";
import { type PropInstance, propPlan } from "./worldMapPropPlan";

// Renders the world map's generated set-dressing. The layout itself lives
// in worldMapPropPlan.ts; this module instances it, and in DEV applies the
// world-map editor's suppress / erase mask on top.

const noRaycast: THREE.Mesh["raycast"] = () => {};

const PropInstancer = ({ url, items }: { url: string; items: PropInstance[] }) => {
  const { scene } = useGLTF(url);
  // One InstancedMesh per GLB sub-part instead of a cloned scene graph per
  // item. Each clone was its own draw call (×2 with the shadow pass); on the
  // world map that ran into the hundreds across every level cluster and made
  // panning stutter. Instancing collapses each (url, part) to a single draw.
  const source = useMemo(() => collectMeshSource(scene), [scene]);

  // Same normalization + recenter math the per-clone path used, so instanced
  // placement is pixel-identical: the GLB is normalized to its role's target
  // size, grounded at minY, and yaw orbits the VISIBLE center (centerX/Z) of
  // the silhouette rather than the GLB's authored origin.
  const { normalizedScale, centerX, centerZ, minY } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const target = TARGET_SIZE_BY_ROLE[classifyPropUrl(url)];
    return {
      normalizedScale: target / maxDim,
      centerX: center.x,
      centerZ: center.z,
      minY: box.min.y,
    };
  }, [scene, url]);

  const partRefs = useRef<(THREE.InstancedMesh | null)[]>([]);

  useEffect(() => {
    if (!source) return;
    const dummy = new THREE.Object3D();
    // Pre-translation that recenters the geometry on its visible center
    // before scale/rotate. Composing M = T(pos) · R(rotY) · S(s) · T(-center)
    // reproduces the old wrapper-group + offset-child transform exactly.
    const recenter = new THREE.Matrix4().makeTranslation(-centerX, 0, -centerZ);
    for (const im of partRefs.current) {
      if (!im) continue;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const s = normalizedScale * it.scale;
        dummy.position.set(it.pos.x, -minY * s, it.pos.z);
        dummy.rotation.set(0, it.rotY, it.tiltZ ?? 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        dummy.matrix.multiply(recenter);
        im.setMatrixAt(i, dummy.matrix);
      }
      im.count = items.length;
      im.instanceMatrix.needsUpdate = true;
    }
  }, [items, source, normalizedScale, centerX, centerZ, minY]);

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
          castShadow
          receiveShadow
          raycast={noRaycast}
          // Per-instance matrices bake in world positions, so the default
          // origin-centered bounding sphere frustum-culls the whole batch
          // once the camera pans away from origin. Disable per-batch culling
          // (matches OutpostClusters / InstancedGroup).
          frustumCulled={false}
        />
      ))}
    </group>
  );
};

const NO_ERASED: ReadonlySet<string> = new Set();

// In DEV the world-map editor can suppress the whole generated layer
// (`override`, set by Clear all) or knock out individual clusters' props
// (`erased`, extended by clicking one or by the eraser brush). Those live
// in the editor store / its localStorage blob and are dev-only, exactly
// like the per-level edits src/sim/world.ts reads — so prod always renders
// the full seeded plan.
export const BiomeProps = () => {
  if (import.meta.env.DEV) return <DevBiomeProps />;
  return <BiomePropsView override={false} erased={NO_ERASED} />;
};

const DevBiomeProps = () => {
  const version = useWorldMapEditor((s) => s.version);
  const { override, erasedProcedural } = useWorldMapEditor.getState().getCurrent();
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the intended invalidation key
  const erased = useMemo(() => new Set(erasedProcedural ?? []), [version]);
  return <BiomePropsView override={override} erased={erased} />;
};

const BiomePropsView = ({
  override,
  erased,
}: {
  override: boolean;
  erased: ReadonlySet<string>;
}) => {
  const progress = useGame((s) => s.progress);
  const plan = useMemo(() => propPlan(progress), [progress]);
  const entries = useMemo(() => {
    if (override) return [];
    if (erased.size === 0) return Object.entries(plan);
    return Object.entries(plan)
      .map(([url, items]): [string, PropInstance[]] => [
        url,
        items.filter((it) => !erased.has(it.key)),
      ])
      .filter(([, items]) => items.length > 0);
  }, [plan, override, erased]);

  return (
    <>
      {entries.map(([url, items]) =>
        isDeadDinoUrl(url) ? (
          <DeadDinoInstancer key={url} url={url} items={items} />
        ) : (
          <PropInstancer key={url} url={url} items={items} />
        ),
      )}
    </>
  );
};
