import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { classifyPropUrl, TARGET_SIZE_BY_ROLE } from "../biomes";
import { useWorldMapEditor } from "../editor/worldMapEditorStore";
import type { PlacedProp } from "../sim/types";
import { InstancedGroup } from "./InstancedGroup";
import type { MeshSource } from "./meshSource";
import { PAN_LIMIT_X, PAN_LIMIT_Z } from "./worldMapBounds";

// Dev-only render + interaction layer for the world-map editor. Mirrors
// EditorProps.tsx but reads from useWorldMapEditor (own store, own version
// invalidation) and sizes the click plane to the pan-clamped content area
// rather than a per-level MAP_WIDTH × MAP_HEIGHT — placing props past the
// pan limit would orphan them off-screen forever.

const noRaycast: THREE.Mesh["raycast"] = () => {};

const propBaseScale = (source: MeshSource, url: string): number =>
  TARGET_SIZE_BY_ROLE[classifyPropUrl(url)] / source.maxDim;

const selectRadius = (url: string, scale: number): number =>
  Math.max(0.5, TARGET_SIZE_BY_ROLE[classifyPropUrl(url)] * scale * 0.6);

export const WorldMapEditorProps = () => {
  const version = useWorldMapEditor((s) => s.version);
  const active = useWorldMapEditor((s) => s.active);
  const placingUrl = useWorldMapEditor((s) => s.placingUrl);
  const selectedId = useWorldMapEditor((s) => s.selectedId);
  const props = useWorldMapEditor((s) => s.props);
  const brushActive = useWorldMapEditor((s) => s.brush.active);
  const brushPresetId = useWorldMapEditor((s) => s.brush.presetId);
  const brushRadius = useWorldMapEditor((s) => s.brush.radius);
  const brushMode = brushActive && brushPresetId !== null;
  void version;

  // biome-ignore lint/correctness/useExhaustiveDependencies: version drives the refresh
  const groups = useMemo(() => {
    const m = new Map<string, { pos: { x: number; y: number }; scale: number; rotY: number }[]>();
    for (const p of props) {
      const list = m.get(p.url) ?? [];
      list.push({ pos: p.pos, scale: p.scale, rotY: p.rot });
      m.set(p.url, list);
    }
    return Array.from(m.entries());
  }, [version, props]);

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

      {active && <EditorGroundPlane brushMode={brushMode} brushRadius={brushRadius} />}
      {active && !placingUrl && !brushMode && <PropHitTargets props={props} version={version} />}

      {active && !brushMode && selected && (
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

// Click plane sized to the pan-clamped content area (±PAN_LIMIT) plus a
// pad. Sits above the ground (y 0.05) so it wins the raycast over the
// BiomeProps / BiomeGround, and stops propagation so any level-node tap
// handlers below never fire while editing.
const PLANE_PAD = 12;

const PAINT_INTERVAL_MS = 80;

const EditorGroundPlane = ({
  brushMode,
  brushRadius,
}: {
  brushMode: boolean;
  brushRadius: number;
}) => {
  const geom = useMemo(
    () => new THREE.PlaneGeometry(PAN_LIMIT_X * 2 + PLANE_PAD * 2, PAN_LIMIT_Z * 2 + PLANE_PAD * 2),
    [],
  );
  useEffect(() => () => geom.dispose(), [geom]);

  const planeRef = useRef<THREE.Mesh | null>(null);
  const ringRef = useRef<THREE.Mesh | null>(null);
  const isDownRef = useRef(false);
  const lastPaintRef = useRef(0);

  const ringGeom = useMemo(
    () => new THREE.RingGeometry(brushRadius - 0.06, brushRadius + 0.06, 64),
    [brushRadius],
  );
  useEffect(() => () => ringGeom.dispose(), [ringGeom]);

  useEffect(() => {
    if (!brushMode) return;
    const onUp = () => {
      if (isDownRef.current) {
        useWorldMapEditor.getState().endStroke();
        isDownRef.current = false;
      }
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [brushMode]);

  useFrame((state) => {
    const ring = ringRef.current;
    const plane = planeRef.current;
    if (!ring) return;
    if (!brushMode || !plane) {
      ring.visible = false;
      return;
    }
    state.raycaster.setFromCamera(state.pointer, state.camera);
    const hits = state.raycaster.intersectObject(plane, false);
    if (hits.length === 0) {
      ring.visible = false;
      return;
    }
    const p = hits[0].point;
    ring.position.set(p.x, 0.11, p.z);
    ring.visible = true;
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const ed = useWorldMapEditor.getState();
    if (ed.brush.active && ed.brush.presetId) return;
    const x = e.point.x;
    const y = -e.point.z;
    if (ed.moving && ed.selectedId !== null) {
      ed.moveSelectedTo(x, y);
    } else if (ed.placingUrl) {
      ed.placeAt(x, y);
    } else {
      ed.select(null);
    }
  };

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!brushMode) return;
    const ed = useWorldMapEditor.getState();
    ed.beginStroke();
    ed.paintAt(e.point.x, -e.point.z);
    isDownRef.current = true;
    lastPaintRef.current = performance.now();
    const t = e.target as Element | null;
    if (t && "setPointerCapture" in t) {
      try {
        (t as Element & { setPointerCapture: (id: number) => void }).setPointerCapture(e.pointerId);
      } catch {
        // Best-effort capture; window-level pointerup still closes stroke.
      }
    }
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!brushMode || !isDownRef.current) return;
    const now = performance.now();
    if (now - lastPaintRef.current < PAINT_INTERVAL_MS) return;
    lastPaintRef.current = now;
    useWorldMapEditor.getState().paintAt(e.point.x, -e.point.z);
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!brushMode) return;
    if (isDownRef.current) {
      useWorldMapEditor.getState().endStroke();
      isDownRef.current = false;
    }
  };

  return (
    <group>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: r3f canvas mesh, not a DOM element */}
      <mesh
        ref={planeRef}
        geometry={geom}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.05, 0]}
        visible={false}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <mesh
        ref={ringRef}
        geometry={ringGeom}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
        renderOrder={21}
        raycast={noRaycast}
      >
        <meshBasicMaterial
          color="#6aa9ff"
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};

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
    useWorldMapEditor.getState().select(p.id);
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
