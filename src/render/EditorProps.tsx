import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { classifyPropUrl, TARGET_SIZE_BY_ROLE } from "../biomes";
import { useEditor } from "../editor/editorStore";
import { MAP_HEIGHT, MAP_WIDTH } from "../level";
import type { PlacedProp } from "../sim/types";
import { useGame } from "../store";
import { InstancedGroup } from "./InstancedGroup";
import type { MeshSource } from "./meshSource";

// Dev-only render + interaction layer for the level editor (src/editor).
// Renders the hand-placed world.props as grounded GLB instances, and — while
// the editor is active — overlays a click plane (place / move) plus per-prop
// hit discs (select) and a ring on the selection. Mounted in Scene.tsx behind
// import.meta.env.DEV; world.props is always empty in production.

const noRaycast: THREE.Mesh["raycast"] = () => {};

// Normalize any catalog GLB to its role's target max-dim, then apply the
// prop's user scale — matches the cosmetic/story renderer so placed props
// read at a sensible, predictable size regardless of the source mesh export.
const propBaseScale = (source: MeshSource, url: string): number =>
  TARGET_SIZE_BY_ROLE[classifyPropUrl(url)] / source.maxDim;

const selectRadius = (url: string, scale: number): number =>
  Math.max(0.5, TARGET_SIZE_BY_ROLE[classifyPropUrl(url)] * scale * 0.6);

export const EditorProps = () => {
  // Static-geometry invalidation key: bumped on every editor edit so the
  // in-place world.props mutation actually re-renders here.
  const treeVersion = useGame((s) => s.ui.treeVersion);
  const active = useEditor((s) => s.active);
  const placingUrl = useEditor((s) => s.placingUrl);
  const selectedId = useEditor((s) => s.selectedId);
  void treeVersion;
  const props = useGame.getState().world.props;

  // biome-ignore lint/correctness/useExhaustiveDependencies: treeVersion is the intended invalidation key
  const groups = useMemo(() => {
    const m = new Map<string, { pos: { x: number; y: number }; scale: number; rotY: number }[]>();
    for (const p of props) {
      const list = m.get(p.url) ?? [];
      list.push({ pos: p.pos, scale: p.scale, rotY: p.rot });
      m.set(p.url, list);
    }
    return Array.from(m.entries());
  }, [treeVersion]);

  const selected = selectedId !== null ? (props.find((p) => p.id === selectedId) ?? null) : null;

  return (
    <group>
      {groups.map(([url, items]) => (
        <InstancedGroup
          key={url}
          url={url}
          items={items}
          baseScaleFor={propBaseScale}
          raycast={noRaycast}
        />
      ))}

      {active && <EditorGroundPlane />}
      {active && !placingUrl && <PropHitTargets props={props} version={treeVersion} />}

      {active && selected && (
        <group position={[selected.pos.x, 0.1, -selected.pos.y]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={20}>
            <ringGeometry
              args={[
                selectRadius(selected.url, selected.scale) - 0.06,
                selectRadius(selected.url, selected.scale) + 0.12,
                40,
              ]}
            />
            <meshBasicMaterial
              color="#ffd66a"
              transparent
              opacity={0.95}
              side={THREE.DoubleSide}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}
    </group>
  );
};

// Full-map invisible plane that captures editor clicks. Sits above the
// gameplay placement plane (y 0.001) so it wins the raycast, and stops
// propagation so tower-placement / robot-move handlers never fire while
// editing. A small pad lets props be authored just outside the playfield.
const PLANE_PAD = 8;

const EditorGroundPlane = () => {
  const geom = useMemo(
    () => new THREE.PlaneGeometry(MAP_WIDTH + PLANE_PAD * 2, MAP_HEIGHT + PLANE_PAD * 2),
    [],
  );
  useEffect(() => () => geom.dispose(), [geom]);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const x = e.point.x;
    const y = -e.point.z;
    const ed = useEditor.getState();
    if (ed.moving && ed.selectedId !== null) {
      ed.moveSelectedTo(x, y);
    } else if (ed.placingUrl) {
      ed.placeAt(x, y);
    } else {
      ed.select(null);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f canvas mesh, not a DOM element
    <mesh
      geometry={geom}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.05, 0]}
      visible={false}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    />
  );
};

// Per-prop transparent discs for selection — same decoupled-hitbox pattern
// as Trees/Rocks. instanceId indexes the props array passed in.
const PropHitTargets = ({ props, version }: { props: PlacedProp[]; version: number }) => {
  const ref = useRef<THREE.InstancedMesh | null>(null);
  const geom = useMemo(() => new THREE.CircleGeometry(1, 24), []);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    [],
  );
  useEffect(
    () => () => {
      geom.dispose();
      material.dispose();
    },
    [geom, material],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the intended invalidation key
  useEffect(() => {
    const im = ref.current;
    if (!im) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      dummy.position.set(p.pos.x, 0.09, -p.pos.y);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(selectRadius(p.url, p.scale));
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.count = props.length;
    im.instanceMatrix.needsUpdate = true;
  }, [props, version]);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId == null) return;
    const p = props[e.instanceId];
    if (!p) return;
    e.stopPropagation();
    useEditor.getState().select(p.id);
  };

  if (props.length === 0) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f instanced mesh, not a DOM element
    <instancedMesh
      ref={ref}
      args={[geom, material, props.length]}
      renderOrder={19}
      onClick={onClick}
    />
  );
};
