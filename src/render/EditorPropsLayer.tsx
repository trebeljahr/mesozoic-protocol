import { useGLTF } from "@react-three/drei";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { classifyPropUrl, TARGET_SIZE_BY_ROLE } from "../biomes";
import {
  anchorRiverEnd,
  type EditorStore,
  findLakeMouth,
  isPlaceholderRiver,
  type ProceduralItem,
  RIVER_EDGE_HOVER_SNAP_THRESHOLD,
  snapIntoLake,
  snapToEdgeIfNear,
  wouldSelfIntersect,
} from "../editor/editorCore";
import type { AuthoredLake, PlacedProp, River, Vec2 } from "../sim/types";
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

// Cursor-ring colours: blue while scattering, orange while Alt-thinning.
const PAINT_RING_COLOR = 0x6aa9ff;
const THIN_RING_COLOR = 0xff8a5c;

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
  const placeScale = store((s) => s.placeScale);
  const placeRot = store((s) => s.placeRot);
  const selectedIds = store((s) => s.selectedIds);
  const moving = store((s) => s.moving);
  const brushActive = store((s) => s.brush.active);
  const brushPresetId = store((s) => s.brush.presetId);
  const brushEraser = store((s) => s.brush.eraser);
  const brushRadius = store((s) => s.brush.radius);
  // Either a scatter preset or the eraser counts as a paint-stroke mode —
  // both own pointerdown/move/up and need the cursor ring + click-plane gate.
  const brushMode = brushActive && (brushPresetId !== null || brushEraser);
  const riverTool = store((s) => s.riverTool);
  const lakeTool = store((s) => s.lakeTool);
  const easterEggTool = store((s) => s.easterEggTool);
  const marqueeActive = store((s) => s.marqueeTool.active);
  const marqueeRect = store((s) => s.marqueeTool.rect);
  const placingStampId = store((s) => s.placingStampId);
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
  const { props, rivers, lakes } = store.getState().getCurrent();

  const toolOwnsPointer =
    active &&
    (placingUrl !== null ||
      moving ||
      brushMode ||
      riverTool.active ||
      lakeTool.active ||
      easterEggTool.active ||
      marqueeActive ||
      placingStampId !== null);

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

  // Resolve every selected id to its live prop reference. Filter out misses
  // (id present in the set but no matching prop) so a same-frame mutation
  // that drops a prop doesn't crash the ring render.
  const selectedProps = selectedIds.size === 0 ? [] : props.filter((p) => selectedIds.has(p.id));

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
          marqueeActive={marqueeActive}
          canvasRef={canvasRef}
        />
      )}
      {active &&
        !placingUrl &&
        !brushMode &&
        !riverTool.active &&
        !lakeTool.active &&
        placingStampId === null && (
          <>
            <PropHitTargets store={store} props={props} version={version} />
            <ProceduralHitTargets store={store} version={version} />
          </>
        )}
      {active && marqueeActive && marqueeRect && <MarqueeRectOverlay rect={marqueeRect} />}

      {active &&
        placingUrl &&
        !moving &&
        !brushMode &&
        !riverTool.active &&
        !lakeTool.active &&
        placingStampId === null && (
          <HoverPreview
            url={placingUrl}
            halfExtent={planeHalfExtent}
            scale={placeScale}
            rotY={placeRot}
          />
        )}

      {active &&
        !brushMode &&
        selectedProps.map((sel) => (
          <group key={sel.id} position={[sel.pos.x, 0.1, -sel.pos.y]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={20}>
              <ringGeometry
                args={[
                  selectRadius(sel.url, sel.scale) - 0.06,
                  selectRadius(sel.url, sel.scale) + 0.12,
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
        ))}

      {active && riverTool.active && (
        <RiverEditOverlay
          store={store}
          rivers={rivers}
          editingRiverId={riverTool.editingRiverId}
          selectedRiverId={riverTool.selectedRiverId}
          canvasRef={canvasRef}
        />
      )}

      {/* Lakes stay visible (dimmed) while the river tool is armed so the
          author can aim a river at a lake mouth; handles are interactive
          only under the lake tool itself. */}
      {active && (lakeTool.active || riverTool.active) && (
        <LakeEditOverlay
          store={store}
          lakes={lakes}
          selectedLakeId={lakeTool.active ? lakeTool.selectedLakeId : null}
          interactive={lakeTool.active}
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
  marqueeActive,
  canvasRef,
}: {
  store: EditorStore;
  halfExtent: { x: number; z: number };
  brushMode: boolean;
  brushRadius: number;
  marqueeActive: boolean;
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
  // Mirror of isDownRef but for marquee gestures — keeps the brush isDownRef
  // semantics intact and lets the marquee pointerup safety net know whether
  // a gesture was in flight.
  const isMarqueeRef = useRef(false);
  // Last marquee move time, for throttling updateMarquee calls in pointermove.
  const lastMarqueeRef = useRef(0);
  const lastPaintRef = useRef(0);
  // Whether the in-flight stroke is a thinning (Alt) stroke. Latched at
  // pointerdown so the mode can't flip mid-drag.
  const thinStrokeRef = useRef(false);
  // Live Alt state, used only to preview the thinning mode on the cursor
  // ring before the stroke starts.
  const altHeldRef = useRef(false);
  const ringMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
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

  // Track Alt purely for the cursor-ring tint (orange = this stroke will
  // thin the patch out rather than add to it). Window-level and ref-based
  // so holding a modifier never triggers a React re-render mid-stroke.
  useEffect(() => {
    if (!brushMode) return;
    const sync = (e: KeyboardEvent) => {
      altHeldRef.current = e.altKey;
    };
    const clear = () => {
      altHeldRef.current = false;
    };
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
      altHeldRef.current = false;
    };
  }, [brushMode]);

  // Marquee-specific pointerup safety net. Mirrors the brush version above:
  // if the pointer is released off-canvas or over UI we still want endMarquee
  // to run so the rect overlay closes and the selection finalises. Read the
  // additive flag from the native event so shift-on-release keeps working
  // even when the release happens outside the editor plane.
  useEffect(() => {
    if (!marqueeActive) return;
    const onUp = (e: PointerEvent) => {
      if (isMarqueeRef.current) {
        store.getState().endMarquee(e.shiftKey);
        isMarqueeRef.current = false;
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
    };
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      // If marquee is disarmed mid-drag (toolbar toggle while pointer is
      // down), release any in-flight capture and reset the ref so the next
      // marquee gesture starts clean. Browser would eventually release on
      // pointerup, but we may never see that pointerup if our listener is
      // gone — explicit cleanup keeps the canvas pointer model honest.
      const canvas = captureCanvasRef.current;
      const pid = capturePointerIdRef.current;
      if (canvas && pid !== null) {
        try {
          canvas.releasePointerCapture(pid);
        } catch {
          // Best-effort release.
        }
      }
      captureCanvasRef.current = null;
      capturePointerIdRef.current = null;
      isMarqueeRef.current = false;
    };
  }, [marqueeActive, store]);

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
    const mat = ringMatRef.current;
    if (mat) {
      const thinning =
        !store.getState().brush.eraser &&
        (isDownRef.current ? thinStrokeRef.current : altHeldRef.current);
      const want = thinning ? THIN_RING_COLOR : PAINT_RING_COLOR;
      if (mat.color.getHex() !== want) mat.color.setHex(want);
    }
  });

  // Cursor tracking for the river-tool overlay. forceUpdate fires whenever
  // the tool is armed (pre-click start marker AND mid-stroke preview line),
  // so non-river hover movement stays free.
  const [, forceUpdate] = useState({});
  const cursorRef = useRef<{ x: number; y: number } | null>(null);

  // Apply the river-tool snap rules to a raw map-plane hit. A lake under
  // the cursor always wins — a river's ends belong either to a lake or to
  // the map edge. Pre-click, an unanchored start projects to the nearest
  // edge (rivers must originate off-map); mid-stroke, interior points snap
  // to the edge only within the hover threshold so they stay free of edge
  // attraction. Returns the raw point when the adapter defines no bounds
  // (world map editor) and no lake captures it.
  const computeRiverCursor = (raw: Vec2, ed: ReturnType<typeof store.getState>): Vec2 => {
    const { lakes: liveLakes } = ed.getCurrent();
    const mouth = findLakeMouth(liveLakes, raw.x, raw.y);
    if (mouth) return snapIntoLake(mouth, raw);
    const bounds = ed.getMapBounds();
    if (!bounds) return raw;
    if (ed.riverTool.editingRiverId === null) return anchorRiverEnd(raw, liveLakes, bounds);
    return snapToEdgeIfNear(raw, bounds, RIVER_EDGE_HOVER_SNAP_THRESHOLD);
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const ed = store.getState();
    // Brush mode (scatter or eraser) owns pointerdown/move/up; suppress the
    // click action so a stroke that ends over the plane doesn't also deselect.
    if (ed.brush.active && (ed.brush.presetId !== null || ed.brush.eraser)) return;
    // Marquee tool owns the drag — onClick still fires on bare clicks (no
    // movement). Skip the background-clear path so a marquee tap doesn't
    // wipe the selection that the just-finalised endMarquee produced.
    if (ed.marqueeTool.active) return;
    const x = e.point.x;
    const y = -e.point.z;
    if (ed.riverTool.active) {
      // Use the same projection the hover marker showed so the committed
      // point matches the preview exactly. Pre-click always edge-locks (rivers
      // policy); mid-stroke locks only when within hover threshold.
      const target = computeRiverCursor({ x, y }, ed);
      if (ed.riverTool.editingRiverId === null) ed.beginRiver(target.x, target.y);
      else ed.addRiverPoint(target.x, target.y);
      return;
    }
    if (ed.lakeTool.active) {
      // Clicking bare ground with the lake tool armed drops a new lake;
      // the per-lake handles (LakeEditOverlay) stop propagation so they
      // select/drag instead of stacking a lake on top of themselves.
      ed.placeLakeAt(x, y);
      return;
    }
    if (ed.easterEggTool.active) {
      // Direction-setting mode wins over placing — a click after "Set
      // direction" stamps the heading rather than dropping a new egg.
      if (ed.easterEggTool.settingDirection && ed.easterEggTool.selectedId !== null) {
        ed.setEasterEggDirectionAt(x, y);
      } else if (ed.easterEggTool.placingDefId !== null) {
        ed.placeEasterEggAt(x, y);
      } else {
        // Hit nothing meaningful — clear selection so the panel goes back to
        // its "pick an egg type to place" state.
        ed.selectEasterEgg(null);
      }
      return;
    }
    if (ed.placingStampId !== null) {
      // Stamp paste — drop the armed stamp's children around the cursor as
      // the target centroid. placeStampAt validates per-child + per-sibling
      // collisions; a single conflict aborts the whole drop. Auto-selects
      // the new group on success so the user can immediately tweak it.
      ed.placeStampAt(x, y);
      return;
    }
    if (ed.moving && ed.selectedIds.size > 0) {
      // Multi-select uses centroid-relocate so the cluster preserves
      // relative layout; single-select keeps the existing direct-target UX
      // (the centroid IS the prop's position, so they're equivalent — but
      // routing single-select through the dedicated action preserves the
      // exact same call site / debug surface as before).
      if (ed.selectedIds.size === 1) ed.moveSelectedTo(x, y);
      else ed.moveSelectionToCentroid(x, y);
    } else if (ed.placingUrl) {
      ed.placeAt(x, y);
    } else if (!e.nativeEvent.shiftKey) {
      // Background click without shift clears the selection. With shift held
      // we leave the selection intact so users can pick more props after
      // missing a target (and so a future shift-drag marquee can use the
      // background plane as its drag origin).
      ed.clearSelection();
    }
  };

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    // Marquee branch — open a drag rect, capture the canvas pointer so
    // pointermove/up keep flowing if the pointer drifts off the bounded mesh.
    if (marqueeActive) {
      const ed = store.getState();
      ed.beginMarquee(e.point.x, -e.point.z);
      isMarqueeRef.current = true;
      lastMarqueeRef.current = performance.now();
      const canvas = canvasRef.current;
      if (canvas) {
        try {
          canvas.setPointerCapture(e.pointerId);
          captureCanvasRef.current = canvas;
          capturePointerIdRef.current = e.pointerId;
        } catch {
          // Best-effort capture; window-level pointerup still closes the marquee.
        }
      }
      return;
    }
    if (!brushMode) return;
    const ed = store.getState();
    ed.beginStroke();
    // Alt = thin the patch instead of adding to it. Latched for the whole
    // stroke from the pointerdown modifier so releasing Alt mid-drag can't
    // flip a thinning drag into a scattering one halfway through.
    thinStrokeRef.current = e.nativeEvent.altKey;
    ed.paintAt(e.point.x, -e.point.z, { thin: thinStrokeRef.current });
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
    // Marquee drag-rect update. Throttled to PAINT_INTERVAL_MS so a rapid
    // drag doesn't thrash the store; the overlay still redraws every store
    // commit so the rectangle stays glued to the cursor.
    if (marqueeActive && isMarqueeRef.current) {
      e.stopPropagation();
      const now = performance.now();
      if (now - lastMarqueeRef.current >= PAINT_INTERVAL_MS) {
        lastMarqueeRef.current = now;
        // Cast against the unbounded math plane so a drag past the bounded
        // mesh edge keeps the rect anchored to the actual world cursor.
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
        if (hit) {
          store.getState().updateMarquee(hit.x, -hit.z);
        } else {
          // Fallback: use the bounded mesh hit point if the math plane misses
          // (camera near-parallel to ground). Better than dropping the frame.
          store.getState().updateMarquee(e.point.x, -e.point.z);
        }
      }
      return;
    }
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
          store.getState().paintAt(useHit.x, -useHit.z, { thin: thinStrokeRef.current });
        }
      }
      return;
    }
    // River-tool preview cursor — track whenever the tool is armed so the
    // pre-click start marker and the mid-stroke preview line both have an
    // up-to-date snap target.
    const ed = store.getState();
    if (ed.riverTool.active) {
      cursorRef.current = computeRiverCursor({ x: e.point.x, y: -e.point.z }, ed);
      forceUpdate({});
    }
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    // Marquee branch — close the rect, finalise the selection (additive when
    // shift is held at release time), and release the canvas pointer capture.
    if (marqueeActive && isMarqueeRef.current) {
      store.getState().endMarquee(e.nativeEvent.shiftKey);
      isMarqueeRef.current = false;
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
      return;
    }
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
          ref={ringMatRef}
          color="#6aa9ff"
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <RiverPreviewSegment store={store} cursorRef={cursorRef} />
      <RiverHoverMarker store={store} cursorRef={cursorRef} />
    </group>
  );
};

// Ghost render of the armed asset at the cursor's ground hit. Clones the
// GLB scene's materials with transparent=true so the preview is visibly a
// preview (not a duplicate of an already-placed prop), and reuses the same
// world-frame geometry + grounding math the InstancedGroup placement path
// uses so where you see the ghost is exactly where the click would drop it —
// including the authored placement scale + yaw, so what you see under the
// cursor is the silhouette placeAt will commit.
const _hoverPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hoverHit = new THREE.Vector3();

const HoverPreview = ({
  url,
  halfExtent,
  scale,
  rotY,
}: {
  url: string;
  halfExtent: { x: number; z: number };
  scale: number;
  rotY: number;
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
    // Mirrors InstancedGroup's matrix build: uniform scale, yaw about the
    // vertical axis, and a recentre offset that has to be rotated by the
    // same yaw so the model stays centred on the cursor as it spins.
    const s = (TARGET_SIZE_BY_ROLE[classifyPropUrl(url)] / source.maxDim) * scale;
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const centerX = (source.centerX * cos - source.centerZ * sin) * s;
    const centerZ = (source.centerX * sin + source.centerZ * cos) * s;
    g.position.set(hit.x - centerX, -source.minY * s, hit.z - centerZ);
    g.rotation.set(0, rotY, 0);
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

// Marquee drag-rect overlay. Renders a translucent yellow fill quad at
// y=0.07 with a brighter border loop at y=0.08 so the rectangle reads as a
// selection box on top of the ground plane without z-fighting other editor
// chrome (selection rings live at y=0.1, prop hit instances at y=0.09).
// The geometry rebuilds every render from the current rect — single mesh,
// small vertex count, cheap.
const MarqueeRectOverlay = ({
  rect,
}: {
  rect: { minX: number; minY: number; maxX: number; maxY: number };
}): ReactElement => {
  const width = Math.max(0.001, rect.maxX - rect.minX);
  const height = Math.max(0.001, rect.maxY - rect.minY);
  const centerX = (rect.minX + rect.maxX) / 2;
  const centerY = (rect.minY + rect.maxY) / 2;
  // World-space convention: editor stores y as world XZ "y" but renders at
  // -y → -z. The selection rings, hit targets, and river overlays all use
  // the same flip, so the rect overlay follows suit.
  const borderArr = new Float32Array([
    rect.minX,
    0.08,
    -rect.minY,
    rect.maxX,
    0.08,
    -rect.minY,
    rect.maxX,
    0.08,
    -rect.maxY,
    rect.minX,
    0.08,
    -rect.maxY,
    rect.minX,
    0.08,
    -rect.minY,
  ]);
  return (
    <group>
      <mesh
        position={[centerX, 0.07, -centerY]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={19}
        raycast={noRaycast}
      >
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          color="#ffd66a"
          transparent
          opacity={0.18}
          side={THREE.DoubleSide}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <line>
        <bufferGeometry
          attach="geometry"
          ref={(g) => {
            if (!g) return;
            g.setAttribute("position", new THREE.BufferAttribute(borderArr, 3));
          }}
        />
        <lineBasicMaterial color="#ffd66a" transparent opacity={0.95} depthTest={false} />
      </line>
    </group>
  );
};

// Snap-target indicator for the river tool. Pre-click it sits on the
// nearest edge (showing exactly where beginRiver will start). Mid-stroke
// it tracks the cursor, snapping to the edge when within the hover
// threshold so the user sees the catch before committing.
const RiverHoverMarker = ({
  store,
  cursorRef,
}: {
  store: EditorStore;
  cursorRef: React.MutableRefObject<{ x: number; y: number } | null>;
}) => {
  const riverTool = store((s) => s.riverTool);
  if (!riverTool.active) return null;
  const cursor = cursorRef.current;
  if (!cursor) return null;
  // Orange highlights an unconfirmed start (no editing river yet); blue
  // signals an in-progress next-point snap so it reads as "this is where
  // the next click lands" rather than a fresh origin.
  const color = riverTool.editingRiverId === null ? "#ffb347" : "#76d6ff";
  return (
    <mesh
      position={[cursor.x, 0.07, -cursor.y]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={22}
      raycast={noRaycast}
    >
      <ringGeometry args={[0.38, 0.58, 40]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.95}
        side={THREE.DoubleSide}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
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
  // Red preview = this click would make the river cross itself, and the
  // store will refuse it. Showing the refusal before the click is the point:
  // the author never gets a committed crossing to undo.
  const crosses = !isPlaceholderRiver(river.points) && wouldSelfIntersect(river.points, cursor);
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
      <lineBasicMaterial
        color={crosses ? "#ff5f56" : "#76d6ff"}
        transparent
        opacity={0.85}
        depthTest={false}
      />
    </line>
  );
};

// Per-lake overlay: a rim ring showing the ellipse the author is editing
// plus a centre handle to select and drag it. Under the river tool the same
// rings render non-interactive, so the author can see where a river will be
// captured by a lake mouth.
const LakeEditOverlay = ({
  store,
  lakes,
  selectedLakeId,
  interactive,
  canvasRef,
}: {
  store: EditorStore;
  lakes: AuthoredLake[];
  selectedLakeId: string | null;
  interactive: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) => {
  if (lakes.length === 0) return null;
  return (
    <group>
      {lakes.map((l) => (
        <LakeHandle
          key={l.id}
          store={store}
          lake={l}
          isSelected={l.id === selectedLakeId}
          interactive={interactive}
          canvasRef={canvasRef}
        />
      ))}
    </group>
  );
};

const LakeHandle = ({
  store,
  lake,
  isSelected,
  interactive,
  canvasRef,
}: {
  store: EditorStore;
  lake: AuthoredLake;
  isSelected: boolean;
  interactive: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) => {
  const dragging = useRef(false);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const capturePointerIdRef = useRef<number | null>(null);
  const color = isSelected ? "#ffd66a" : interactive ? "#76d6ff" : "#3aa8d8";

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!interactive) return;
    // Swallow the event so the ground plane's click handler doesn't also
    // drop a fresh lake under this one.
    e.stopPropagation();
    const ed = store.getState();
    if (e.shiftKey) {
      ed.deleteLake(lake.id);
      return;
    }
    ed.selectLake(lake.id);
    dragging.current = true;
    ed.dragLakeStart();
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
    store.getState().dragLake(lake.id, e.point.x, -e.point.z);
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    e.stopPropagation();
    dragging.current = false;
    store.getState().dragLakeEnd();
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
    <group position={[lake.pos.x, 0.16, -lake.pos.y]}>
      {/* Rim ring — scaled unit ring so the ellipse's rotation and half-axes
          read directly off the lake record. */}
      <mesh
        rotation={[-Math.PI / 2, 0, lake.rot]}
        scale={[lake.rx, lake.ry, 1]}
        renderOrder={21}
        raycast={noRaycast}
      >
        <ringGeometry args={[0.97, 1.0, 64]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={interactive ? 0.95 : 0.5}
          side={THREE.DoubleSide}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      {interactive && (
        <mesh
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          renderOrder={22}
        >
          <sphereGeometry args={[POINT_RADIUS, 16, 12]} />
          <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
        </mesh>
      )}
    </group>
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
    // Bounds-check against same-frame mutations — a delete or stroke during
    // the same tick can shrink `props` after the instancedMesh was
    // measured, leaving an out-of-range instanceId in the click event.
    if (e.instanceId >= props.length) return;
    const p = props[e.instanceId];
    if (!p) return;
    e.stopPropagation();
    // Shift-click toggles the id in/out of the selection without disturbing
    // other members; plain click replaces. Mode is wired straight to the
    // store's mode-aware `select`.
    const mode = e.nativeEvent.shiftKey ? "toggle" : "replace";
    store.getState().select(p.id, mode);
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

// Click targets for the adapter's SEEDED set-dressing (procedural trees /
// rocks / outposts in a level, the world map's per-node prop clusters).
// Those meshes are instanced with raycasting disabled and carry no
// PlacedProp id, so before this layer existed the only way to remove one
// was the eraser brush — a plain click did nothing, which read as "the
// generated stuff can't be deleted". Clicking a target here extends the
// erased-procedural mask instead of selecting, which is what persists the
// removal across a save/reload.
//
// Sits marginally below PropHitTargets (y 0.085 vs 0.09) so that where a
// hand-placed prop overlaps generated decor the hand-placed one is the
// nearer intersection and wins the click.
const PROCEDURAL_HIT_Y = 0.085;

const ProceduralHitTargets = ({ store, version }: { store: EditorStore; version: number }) => {
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
  const items = useMemo<ProceduralItem[]>(
    () => store.getState().proceduralItems(),
    [store, version],
  );

  useEffect(() => {
    const im = ref.current;
    if (!im) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      dummy.position.set(it.x, PROCEDURAL_HIT_Y, -it.y);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      // Footprint radii are tuned for collision, not for clicking — a small
      // rock's is well under a comfortable click target, so floor it.
      dummy.scale.setScalar(Math.max(0.5, it.r));
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.count = items.length;
    im.instanceMatrix.needsUpdate = true;
  }, [items]);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId == null) return;
    if (e.instanceId >= items.length) return;
    const it = items[e.instanceId];
    if (!it) return;
    e.stopPropagation();
    store.getState().eraseProcedural([it.key]);
  };

  if (items.length === 0) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f instanced mesh, not a DOM element
    <instancedMesh
      ref={ref}
      args={[geom, material, items.length]}
      renderOrder={18}
      onClick={onClick}
    />
  );
};
