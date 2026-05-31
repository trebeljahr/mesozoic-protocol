import { useGLTF } from "@react-three/drei";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { classifyPropUrl, TARGET_SIZE_BY_ROLE } from "../biomes";
import type { EditorStore } from "../editor/editorCore";
import type { PlacedProp, River } from "../sim/types";
import { InstancedGroup } from "./InstancedGroup";
import { collectMeshSource, type MeshSource } from "./meshSource";

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

// Cast a ray through the supplied client-space pointer against an unbounded
// math plane and return the world-space XZ hit. Used while painting so a
// brush drag past the bounded mesh edge still hits ground — and so we
// don't rely on r3f's internal pointer state, which is undefined when the
// pointer is captured to the canvas but the cursor sits outside it.
// Returns null when the ray is parallel to (or above) the plane.
const _planeHit = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const raycastPlaneFromClient = (
  raycaster: THREE.Raycaster,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  plane: THREE.Plane,
): { x: number; z: number } | null => {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  _ndc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -(((clientY - rect.top) / rect.height) * 2 - 1),
  );
  raycaster.setFromCamera(_ndc, camera);
  const hit = raycaster.ray.intersectPlane(plane, _planeHit);
  if (!hit) return null;
  return { x: hit.x, z: hit.z };
};

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
  const brushEraser = store((s) => s.brush.eraser);
  const brushRadius = store((s) => s.brush.radius);
  // Either a scatter preset or the eraser counts as a paint-stroke mode —
  // both own pointerdown/move/up and need the cursor ring + click-plane gate.
  const brushMode = brushActive && (brushPresetId !== null || brushEraser);
  const riverTool = store((s) => s.riverTool);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const gl = useThree((s) => s.gl);
  // Stable canvas DOM ref. Used by child pointerdown handlers for
  // setPointerCapture(canvas, ...) so a brush/river drag that leaves the
  // bounded plane mesh still delivers pointermove/up to the canvas — and
  // never gets handed to OrbitControls' drag gate mid-stroke.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    canvasRef.current = gl.domElement as HTMLCanvasElement;
  }, [gl]);
  // Shared pointer-ownership flag both the canvas pointer handlers below and
  // the OrbitControls drag gate read. Kept in a ref (not state) so reads
  // inside synchronous pointer-event handlers see the current value without
  // a re-render dance.
  const toolOwnsPointerRef = useRef(false);
  void version;
  const { props, rivers } = store.getState().getCurrent();

  const toolOwnsPointer =
    active && (placingUrl !== null || moving || brushMode || riverTool.active);

  // Keep the ref synced before any pointer handler can read it. useEffect
  // runs after commit, but the ref read inside handlers fires on the next
  // user event so the order is safe.
  useEffect(() => {
    toolOwnsPointerRef.current = toolOwnsPointer;
  }, [toolOwnsPointer]);

  // Synchronous hard-set on controls.enabled. The drag gate also defers to
  // toolOwnsPointerRef so a re-enable from gate's microtask can't sneak in
  // under a tool gesture. On flip false the controls hard-reset to enabled.
  useEffect(() => {
    if (!controls) return;
    if (toolOwnsPointer) controls.enabled = false;
    else controls.enabled = true;
  }, [toolOwnsPointer, controls]);

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
          canvasRef={canvasRef}
        />
      )}
      {active && !placingUrl && !brushMode && !riverTool.active && (
        <PropHitTargets store={store} props={props} version={version} />
      )}

      {active && placingUrl && !moving && !brushMode && !riverTool.active && (
        <HoverPreview url={placingUrl} halfExtent={planeHalfExtent} />
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
          canvasRef={canvasRef}
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
  canvasRef,
}: {
  store: EditorStore;
  halfExtent: { x: number; z: number };
  brushMode: boolean;
  brushRadius: number;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
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
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const capturePointerIdRef = useRef<number | null>(null);
  // Unbounded math plane (y=0) for paint raycasting. Lets the brush keep
  // painting when the pointer drifts off the bounded mesh — without this
  // the stroke goes silent at the plane edge and an off-canvas pointer-up
  // reads as a never-released gesture.
  const paintPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const lastPaintHitRef = useRef<{ x: number; z: number } | null>(null);
  const raycaster = useThree((s) => s.raycaster);
  const camera = useThree((s) => s.camera);

  const ringGeom = useMemo(
    () => new THREE.RingGeometry(brushRadius - 0.06, brushRadius + 0.06, 64),
    [brushRadius],
  );
  useEffect(() => () => ringGeom.dispose(), [ringGeom]);

  // Window-level pointerup safety net: if the pointer is released over UI or
  // off-canvas, the plane's onPointerUp may not fire — close any open stroke
  // anyway so the next stroke starts clean. Also releases the canvas-level
  // pointer capture so further hover events go where they should.
  useEffect(() => {
    if (!brushMode) return;
    const onUp = () => {
      if (isDownRef.current) {
        store.getState().endStroke();
        isDownRef.current = false;
      }
      const canvas = captureCanvasRef.current;
      const pid = capturePointerIdRef.current;
      if (canvas && pid !== null) {
        try {
          canvas.releasePointerCapture(pid);
        } catch {
          // Capture may have already been released by the browser.
        }
      }
      captureCanvasRef.current = null;
      capturePointerIdRef.current = null;
      lastPaintHitRef.current = null;
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
    // Brush mode (scatter or eraser) owns pointerdown/move/up; suppress the
    // click action so a stroke that ends over the plane doesn't also deselect.
    if (ed.brush.active && (ed.brush.presetId !== null || ed.brush.eraser)) return;
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
    lastPaintHitRef.current = { x: e.point.x, z: e.point.z };
    // Capture on the canvas DOM (not e.target which is the r3f object); this
    // forwards every subsequent pointermove/up to the canvas even when the
    // pointer leaves the bounded plane mesh, so brush strokes don't go silent
    // mid-drag and the OrbitControls drag gate (canvas-level pointerdown
    // listener) can't claim the stream back.
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.setPointerCapture(e.pointerId);
        captureCanvasRef.current = canvas;
        capturePointerIdRef.current = e.pointerId;
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
        // Cast against an unbounded math plane so the stroke keeps going if
        // the pointer drifts past the bounded mesh edge. Falls back to the
        // last known hit if the ray is parallel to (or above) the plane.
        const canvas = canvasRef.current;
        const hit = canvas
          ? raycastPlaneFromClient(
              raycaster,
              canvas,
              e.nativeEvent.clientX,
              e.nativeEvent.clientY,
              camera,
              paintPlaneRef.current,
            )
          : null;
        const useHit = hit ?? lastPaintHitRef.current;
        if (useHit) {
          lastPaintHitRef.current = useHit;
          store.getState().paintAt(useHit.x, -useHit.z);
        }
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
    const canvas = captureCanvasRef.current;
    const pid = capturePointerIdRef.current;
    if (canvas && pid !== null) {
      try {
        canvas.releasePointerCapture(pid);
      } catch {
        // Capture may have already been released by the browser.
      }
    }
    captureCanvasRef.current = null;
    capturePointerIdRef.current = null;
    lastPaintHitRef.current = null;
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

// Ghost render of the armed asset at the cursor's ground hit. Clones the
// GLB scene's materials with transparent=true so the preview is visibly a
// preview (not a duplicate of an already-placed prop), and reuses the same
// world-frame geometry + grounding math the InstancedGroup placement path
// uses so where you see the ghost is exactly where the click would drop it.
// rotY is fixed at 0 because new props always place at rot=0 — the per-prop
// rotation handles (Q/R, UI buttons) take over once selected.
const _hoverPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hoverHit = new THREE.Vector3();

const HoverPreview = ({
  url,
  halfExtent,
}: {
  url: string;
  halfExtent: { x: number; z: number };
}): ReactElement | null => {
  const { scene } = useGLTF(url);
  const source = useMemo(() => collectMeshSource(scene), [scene]);
  const ghostMaterials = useMemo(() => {
    if (!source) return [] as THREE.Material[];
    return source.parts.map((part) => {
      const m = (part.material as THREE.Material).clone();
      m.transparent = true;
      m.opacity = 0.5;
      m.depthWrite = false;
      return m;
    });
  }, [source]);
  useEffect(
    () => () => {
      for (const m of ghostMaterials) m.dispose();
    },
    [ghostMaterials],
  );

  const groupRef = useRef<THREE.Group>(null);
  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    if (!source) {
      g.visible = false;
      return;
    }
    state.raycaster.setFromCamera(state.pointer, state.camera);
    const hit = state.raycaster.ray.intersectPlane(_hoverPlane, _hoverHit);
    if (!hit || Math.abs(hit.x) > halfExtent.x || Math.abs(hit.z) > halfExtent.z) {
      g.visible = false;
      return;
    }
    const s = TARGET_SIZE_BY_ROLE[classifyPropUrl(url)] / source.maxDim;
    g.position.set(hit.x - source.centerX * s, -source.minY * s, hit.z - source.centerZ * s);
    g.rotation.set(0, 0, 0);
    g.scale.setScalar(s);
    g.visible = true;
  });

  if (!source) return null;
  return (
    <group ref={groupRef} visible={false}>
      {source.parts.map((part, i) => (
        <mesh
          // biome-ignore lint/suspicious/noArrayIndexKey: parts array is stable per scene
          key={i}
          geometry={part.geom}
          material={ghostMaterials[i]}
          raycast={noRaycast}
          renderOrder={20}
        />
      ))}
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
  canvasRef,
}: {
  store: EditorStore;
  rivers: River[];
  editingRiverId: string | null;
  selectedRiverId: string | null;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
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
          canvasRef={canvasRef}
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
  canvasRef,
}: {
  store: EditorStore;
  river: River;
  isEditing: boolean;
  isSelected: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
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
          canvasRef={canvasRef}
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
  canvasRef,
}: {
  store: EditorStore;
  riverId: string;
  index: number;
  x: number;
  y: number;
  color: string;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) => {
  const dragging = useRef(false);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const capturePointerIdRef = useRef<number | null>(null);

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
    // Capture on the canvas DOM, mirroring the brush stroke path so drags
    // off the sphere mesh still deliver pointermove/up and OrbitControls
    // can't claim the stream.
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.setPointerCapture(e.pointerId);
        captureCanvasRef.current = canvas;
        capturePointerIdRef.current = e.pointerId;
      } catch {
        // Best-effort capture.
      }
    }
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
    const canvas = captureCanvasRef.current;
    const pid = capturePointerIdRef.current;
    if (canvas && pid !== null) {
      try {
        canvas.releasePointerCapture(pid);
      } catch {
        // Capture may have already been released.
      }
    }
    captureCanvasRef.current = null;
    capturePointerIdRef.current = null;
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
