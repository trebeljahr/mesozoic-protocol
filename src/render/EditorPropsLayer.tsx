import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { classifyPropUrl, TARGET_SIZE_BY_ROLE } from "../biomes";
import type { EditorStore } from "../editor/editorCore";
import type { PlacedProp, River } from "../sim/types";
import { InstancedGroup } from "./InstancedGroup";
import type { MeshSource } from "./meshSource";

// Shared dev-only render + interaction layer for both editors. Renders the
// hand-placed props as grounded GLB instances; while the editor is active,
// overlays a content-area click plane that drives place / move / select +
// brush-stroke pointer flow (pointerdown → paintAt → pointermove throttled
// paint → pointerup endStroke) + brush-cursor ring, plus the river-tool
// overlay (control-point spheres + dashed preview segment). The two
// wrappers (EditorProps for the level editor, WorldMapEditorProps for the
// world map) supply the store + plane half-extents + an invalidation key.

const noRaycast: THREE.Mesh["raycast"] = () => {};

const propBaseScale = (source: MeshSource, url: string): number =>
  TARGET_SIZE_BY_ROLE[classifyPropUrl(url)] / source.maxDim;

const selectRadius = (url: string, scale: number): number =>
  Math.max(0.5, TARGET_SIZE_BY_ROLE[classifyPropUrl(url)] * scale * 0.6);

const PAINT_INTERVAL_MS = 80;

export type EditorPropsLayerProps = {
  store: EditorStore;
  planeHalfExtent: { x: number; z: number };
  // Invalidation key — level uses useGame.ui.treeVersion (bumped by world
  // rebuilds too), world map uses store.version. Passed explicitly so each
  // editor picks its own source.
  version: number;
};

export const EditorPropsLayer = ({
  store,
  planeHalfExtent,
  version,
}: EditorPropsLayerProps): ReactElement => {
  const active = store((s) => s.active);
  const placingUrl = store((s) => s.placingUrl);
  const selectedId = store((s) => s.selectedId);
  const moving = store((s) => s.moving);
  const brushActive = store((s) => s.brush.active);
  const brushPresetId = store((s) => s.brush.presetId);
  const brushRadius = store((s) => s.brush.radius);
  const brushMode = brushActive && brushPresetId !== null;
  const riverTool = store((s) => s.riverTool);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  void version;
  const { props, rivers } = store.getState().getCurrent();

  useEffect(() => {
    const toolOwnsPointer =
      active && (placingUrl !== null || moving || brushMode || riverTool.active);
    if (!controls || !toolOwnsPointer) return;
    const previous = controls.enabled;
    controls.enabled = false;
    return () => {
      controls.enabled = previous;
    };
  }, [active, placingUrl, moving, brushMode, riverTool.active, controls]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the intended invalidation key
  const groups = useMemo(() => {
    const m = new Map<string, { pos: { x: number; y: number }; scale: number; rotY: number }[]>();
    for (const p of props) {
      const list = m.get(p.url) ?? [];
      list.push({ pos: p.pos, scale: p.scale, rotY: p.rot });
      m.set(p.url, list);
    }
    return Array.from(m.entries());
  }, [version]);

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

      {active && (
        <EditorGroundPlane
          store={store}
          halfExtent={planeHalfExtent}
          brushMode={brushMode}
          brushRadius={brushRadius}
        />
      )}
      {active && !placingUrl && !brushMode && !riverTool.active && (
        <PropHitTargets store={store} props={props} version={version} />
      )}

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

      {active && riverTool.active && (
        <RiverEditOverlay
          store={store}
          rivers={rivers}
          editingRiverId={riverTool.editingRiverId}
          selectedRiverId={riverTool.selectedRiverId}
        />
      )}
    </group>
  );
};

const EditorGroundPlane = ({
  store,
  halfExtent,
  brushMode,
  brushRadius,
}: {
  store: EditorStore;
  halfExtent: { x: number; z: number };
  brushMode: boolean;
  brushRadius: number;
}) => {
  const geom = useMemo(
    () => new THREE.PlaneGeometry(halfExtent.x * 2, halfExtent.z * 2),
    [halfExtent.x, halfExtent.z],
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

  // Window-level pointerup safety net: if the pointer is released over UI or
  // off-canvas, the plane's onPointerUp may not fire — close any open stroke
  // anyway so the next stroke starts clean.
  useEffect(() => {
    if (!brushMode) return;
    const onUp = () => {
      if (isDownRef.current) {
        store.getState().endStroke();
        isDownRef.current = false;
      }
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [brushMode, store]);

  // Track the pointer over the editor plane each frame so the brush cursor
  // ring follows the mouse. Hidden when the pointer is offscreen or not
  // hovering a plane intersection.
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

  // Cursor tracking for the "next segment" preview while painting a river.
  // forceUpdate fires only while a river is being drawn, so non-river hover
  // movement stays free.
  const [, forceUpdate] = useState({});
  const cursorRef = useRef<{ x: number; y: number } | null>(null);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const ed = store.getState();
    // Brush mode owns pointerdown/move/up; suppress the click action so a
    // stroke that ends over the plane doesn't also deselect.
    if (ed.brush.active && ed.brush.presetId) return;
    const x = e.point.x;
    const y = -e.point.z;
    if (ed.riverTool.active) {
      if (ed.riverTool.editingRiverId === null) ed.beginRiver(x, y);
      else ed.addRiverPoint(x, y);
      return;
    }
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
    const ed = store.getState();
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
    if (brushMode && isDownRef.current) {
      e.stopPropagation();
      const now = performance.now();
      if (now - lastPaintRef.current >= PAINT_INTERVAL_MS) {
        lastPaintRef.current = now;
        store.getState().paintAt(e.point.x, -e.point.z);
      }
      return;
    }
    // River-tool preview cursor — only meaningful while mid-stroke.
    const ed = store.getState();
    if (ed.riverTool.active && ed.riverTool.editingRiverId !== null) {
      cursorRef.current = { x: e.point.x, y: -e.point.z };
      forceUpdate({});
    }
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!brushMode) return;
    if (isDownRef.current) {
      store.getState().endStroke();
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
      <RiverPreviewSegment store={store} cursorRef={cursorRef} />
    </group>
  );
};

// Dashed preview line from the last point of the in-progress river to the
// cursor — only visible while the river tool is editing. Re-derives on each
// cursor move via the parent's forceUpdate.
const RiverPreviewSegment = ({
  store,
  cursorRef,
}: {
  store: EditorStore;
  cursorRef: React.MutableRefObject<{ x: number; y: number } | null>;
}) => {
  const riverTool = store((s) => s.riverTool);
  if (!riverTool.active || riverTool.editingRiverId === null) return null;
  const river = store
    .getState()
    .getCurrent()
    .rivers.find((r) => r.id === riverTool.editingRiverId);
  if (!river || river.points.length === 0) return null;
  const cursor = cursorRef.current;
  if (!cursor) return null;
  const last = river.points[river.points.length - 1];
  const a: [number, number, number] = [last.x, 0.06, -last.y];
  const b: [number, number, number] = [cursor.x, 0.06, -cursor.y];
  return (
    <line>
      <bufferGeometry
        attach="geometry"
        ref={(g) => {
          if (!g) return;
          const arr = new Float32Array([...a, ...b]);
          g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
        }}
      />
      <lineBasicMaterial color="#76d6ff" transparent opacity={0.85} depthTest={false} />
    </line>
  );
};

// Per-river control-point overlay. Renders a small draggable sphere at each
// point of each river. Drag updates the point live; release commits a single
// undo entry (snapshot opened on drag start). Shift-click deletes a point
// (refuses if the river would drop below 2 points). Clicking a non-edited
// river's point selects that river for editing.
const POINT_RADIUS = 0.45;

const RiverEditOverlay = ({
  store,
  rivers,
  editingRiverId,
  selectedRiverId,
}: {
  store: EditorStore;
  rivers: River[];
  editingRiverId: string | null;
  selectedRiverId: string | null;
}) => {
  if (rivers.length === 0) return null;
  return (
    <group>
      {rivers.map((r) => (
        <RiverPointGroup
          key={r.id}
          store={store}
          river={r}
          isEditing={r.id === editingRiverId}
          isSelected={r.id === selectedRiverId}
        />
      ))}
    </group>
  );
};

const RiverPointGroup = ({
  store,
  river,
  isEditing,
  isSelected,
}: {
  store: EditorStore;
  river: River;
  isEditing: boolean;
  isSelected: boolean;
}) => {
  // Highlight color: in-progress > selected > idle.
  const color = isEditing ? "#ffd66a" : isSelected ? "#76d6ff" : "#3aa8d8";
  return (
    <group>
      {river.points.map((p, i) => (
        <RiverPoint
          // Points have no stable id of their own — index-keyed is fine because
          // adds/removes happen at the tail or via explicit delete that
          // unmounts the whole group on a different react cycle.
          // biome-ignore lint/suspicious/noArrayIndexKey: control points have no stable id
          key={`${river.id}:${i}`}
          store={store}
          riverId={river.id}
          index={i}
          x={p.x}
          y={p.y}
          color={color}
        />
      ))}
    </group>
  );
};

const RiverPoint = ({
  store,
  riverId,
  index,
  x,
  y,
  color,
}: {
  store: EditorStore;
  riverId: string;
  index: number;
  x: number;
  y: number;
  color: string;
}) => {
  const dragging = useRef(false);

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const ed = store.getState();
    if (e.shiftKey) {
      ed.deleteRiverPoint(riverId, index);
      return;
    }
    if (ed.riverTool.selectedRiverId !== riverId && ed.riverTool.editingRiverId !== riverId) {
      ed.selectRiver(riverId);
    }
    dragging.current = true;
    ed.dragRiverPointStart();
    (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    e.stopPropagation();
    store.getState().dragRiverPoint(riverId, index, e.point.x, -e.point.z);
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    e.stopPropagation();
    dragging.current = false;
    store.getState().dragRiverPointEnd();
    (e.target as Element | null)?.releasePointerCapture?.(e.pointerId);
  };

  return (
    <mesh
      position={[x, 0.18, -y]}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      renderOrder={21}
    >
      <sphereGeometry args={[POINT_RADIUS, 16, 12]} />
      <meshBasicMaterial color={color} transparent opacity={0.95} depthTest={false} />
    </mesh>
  );
};

const PropHitTargets = ({
  store,
  props,
  version,
}: {
  store: EditorStore;
  props: PlacedProp[];
  version: number;
}) => {
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
    store.getState().select(p.id);
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
