import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { classifyPropUrl, TARGET_SIZE_BY_ROLE } from "../biomes";
import { useEditor } from "../editor/editorStore";
import { MAP_HEIGHT, MAP_WIDTH } from "../level";
import type { PlacedProp, River } from "../sim/types";
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
  const brushActive = useEditor((s) => s.brush.active);
  const brushPresetId = useEditor((s) => s.brush.presetId);
  const brushRadius = useEditor((s) => s.brush.radius);
  const brushMode = brushActive && brushPresetId !== null;
  const riverTool = useEditor((s) => s.riverTool);
  void treeVersion;
  const props = useGame.getState().world.props;
  const rivers = useGame.getState().world.rivers;

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

      {active && <EditorGroundPlane brushMode={brushMode} brushRadius={brushRadius} />}
      {active && !placingUrl && !brushMode && !riverTool.active && (
        <PropHitTargets props={props} version={treeVersion} />
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

      {/* River edit overlay — control-point spheres on every river, plus a
          preview segment from the last in-progress point to the cursor. */}
      {active && riverTool.active && (
        <RiverEditOverlay
          rivers={rivers}
          editingRiverId={riverTool.editingRiverId}
          selectedRiverId={riverTool.selectedRiverId}
        />
      )}
    </group>
  );
};

// Full-map invisible plane that captures editor clicks. Sits above the
// gameplay placement plane (y 0.001) so it wins the raycast, and stops
// propagation so tower-placement / robot-move handlers never fire while
// editing. A small pad lets props be authored just outside the playfield.
const PLANE_PAD = 8;

// Throttle paintAt during a brush stroke: each call scatters several props,
// so 80 ms (~12.5 Hz) is plenty without overwhelming the scene.
const PAINT_INTERVAL_MS = 80;

const EditorGroundPlane = ({
  brushMode,
  brushRadius,
}: {
  brushMode: boolean;
  brushRadius: number;
}) => {
  const geom = useMemo(
    () => new THREE.PlaneGeometry(MAP_WIDTH + PLANE_PAD * 2, MAP_HEIGHT + PLANE_PAD * 2),
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

  // Window-level pointerup safety net: if the pointer is released over UI or
  // off-canvas, the plane's onPointerUp may not fire — close any open stroke
  // anyway so the next stroke starts clean.
  useEffect(() => {
    if (!brushMode) return;
    const onUp = () => {
      if (isDownRef.current) {
        useEditor.getState().endStroke();
        isDownRef.current = false;
      }
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [brushMode]);

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

  // While the river tool is armed, track the cursor so we can render the
  // "next segment" preview from the last in-progress point. Re-renders each
  // pointer move; the actual preview line lives in RiverPreviewSegment below.
  const [, forceUpdate] = useState({});
  const cursorRef = useRef<{ x: number; y: number } | null>(null);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const ed = useEditor.getState();
    // Brush mode owns the pointer flow via down/move/up below; suppress the
    // default place/move/select-clear click action so a stroke that ends
    // over the plane doesn't also deselect anything.
    if (ed.brush.active && ed.brush.presetId) return;
    const x = e.point.x;
    const y = -e.point.z;
    // River tool wins over prop placement/move/select while active.
    if (ed.riverTool.active) {
      if (ed.riverTool.editingRiverId === null) {
        ed.beginRiver(x, y);
      } else {
        ed.addRiverPoint(x, y);
      }
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
    const ed = useEditor.getState();
    ed.beginStroke();
    ed.paintAt(e.point.x, -e.point.z);
    isDownRef.current = true;
    lastPaintRef.current = performance.now();
    // Capture so pointermove/up follow the pointer even when it briefly
    // leaves the plane's raycast footprint (e.g. across panel/canvas edges).
    const t = e.target as Element | null;
    if (t && "setPointerCapture" in t) {
      try {
        (t as Element & { setPointerCapture: (id: number) => void }).setPointerCapture(e.pointerId);
      } catch {
        // Ignore — capture is best-effort; the window-level pointerup net
        // still closes the stroke if events stop reaching the plane.
      }
    }
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    // Brush takes the pointer while a stroke is open.
    if (brushMode && isDownRef.current) {
      const now = performance.now();
      if (now - lastPaintRef.current >= PAINT_INTERVAL_MS) {
        lastPaintRef.current = now;
        useEditor.getState().paintAt(e.point.x, -e.point.z);
      }
      return;
    }
    // River-tool preview cursor — only meaningful while mid-stroke.
    const ed = useEditor.getState();
    if (ed.riverTool.active && ed.riverTool.editingRiverId !== null) {
      cursorRef.current = { x: e.point.x, y: -e.point.z };
      forceUpdate({});
    }
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!brushMode) return;
    if (isDownRef.current) {
      useEditor.getState().endStroke();
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
      <RiverPreviewSegment cursorRef={cursorRef} />
    </group>
  );
};

// Dashed preview line from the last point of the in-progress river to the
// cursor — only visible while the river tool is editing. Re-derives on each
// cursor move via the parent's forceUpdate.
const RiverPreviewSegment = ({
  cursorRef,
}: {
  cursorRef: React.MutableRefObject<{ x: number; y: number } | null>;
}) => {
  const riverTool = useEditor((s) => s.riverTool);
  const version = useGame((s) => s.ui.treeVersion);
  void version;
  if (!riverTool.active || riverTool.editingRiverId === null) return null;
  const river = useGame.getState().world.rivers.find((r) => r.id === riverTool.editingRiverId);
  if (!river || river.points.length === 0) return null;
  const cursor = cursorRef.current;
  if (!cursor) return null;
  const last = river.points[river.points.length - 1];
  // Lifted slightly above the river ribbon so the preview is visible.
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
// undo entry (the snapshot was opened on drag start). Shift-click deletes
// a point (refuses if the river would drop below 2 points). Clicking a
// non-edited river's point selects that river for editing.
const POINT_RADIUS = 0.45;

const RiverEditOverlay = ({
  rivers,
  editingRiverId,
  selectedRiverId,
}: {
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
          river={r}
          isEditing={r.id === editingRiverId}
          isSelected={r.id === selectedRiverId}
        />
      ))}
    </group>
  );
};

const RiverPointGroup = ({
  river,
  isEditing,
  isSelected,
}: {
  river: River;
  isEditing: boolean;
  isSelected: boolean;
}) => {
  // Highlight color: in-progress > selected > idle. Idle points are the
  // soft cyan so they read as part of the river preview.
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
  riverId,
  index,
  x,
  y,
  color,
}: {
  riverId: string;
  index: number;
  x: number;
  y: number;
  color: string;
}) => {
  const dragging = useRef(false);

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const ed = useEditor.getState();
    // Shift-click deletes the point (or refuses for the last two).
    if (e.shiftKey) {
      ed.deleteRiverPoint(riverId, index);
      return;
    }
    // Clicking a point on a non-edited river selects that river (so its
    // controls light up in the panel). For the in-progress river this is a
    // no-op pre-drag — the user can still drag.
    if (ed.riverTool.selectedRiverId !== riverId && ed.riverTool.editingRiverId !== riverId) {
      ed.selectRiver(riverId);
    }
    dragging.current = true;
    // Snapshot once at drag start so the whole drag is one undo entry.
    ed.dragRiverPointStart();
    (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    e.stopPropagation();
    useEditor.getState().dragRiverPoint(riverId, index, e.point.x, -e.point.z);
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    e.stopPropagation();
    dragging.current = false;
    useEditor.getState().dragRiverPointEnd();
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
