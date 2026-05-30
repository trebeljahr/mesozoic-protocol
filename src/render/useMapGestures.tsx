import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

export type MapGestureConfig = {
  panLimitX: number;
  panLimitZ: number;
  // Optional dynamic limits keyed off current camera zoom. When provided,
  // overrides the static panLimitX/Z each frame — used by the battle camera
  // so pan range collapses to 0 at fit zoom (the whole map fits the screen,
  // panning would just slide off the map).
  panLimitFor?: (zoom: number) => { x: number; z: number };
  minZoom: number;
  maxZoom: number;
  panSpeed?: number;
  zoomSpeed?: number;
  reserveLeftClick?: boolean;
  reserveTouchPlacement?: boolean;
  // Orbit-around-target controls. Off by default so callers keep their
  // authored camera angle unless they explicitly opt into orbit gestures.
  enableRotate?: boolean;
  // Polar angle clamps (radians from world +Y). 0 = straight down,
  // π/2 = horizon. Defaults keep the camera above the ground plane.
  minPolarAngle?: number;
  maxPolarAngle?: number;
  rotateSpeed?: number;
  // When current=true the editor tool owns the pointer — the drag gate must
  // not flip controls.enabled or replay synthetic events. Lets us bail out
  // synchronously inside onDown before the gate timer can re-enable the
  // controls under an in-flight brush/river stroke.
  toolOwnsPointerRef?: React.RefObject<boolean>;
};

export const MapOrbitControls = forwardRef<OrbitControlsImpl | null, MapGestureConfig>(
  function MapOrbitControls(
    {
      panLimitX,
      panLimitZ,
      panLimitFor,
      minZoom,
      maxZoom,
      panSpeed = 1.4,
      zoomSpeed = 0.9,
      reserveLeftClick = false,
      reserveTouchPlacement = false,
      enableRotate = false,
      minPolarAngle = 0,
      maxPolarAngle = Math.PI,
      rotateSpeed = 0.7,
      toolOwnsPointerRef,
    },
    ref,
  ) {
    const controlsRef = useRef<OrbitControlsImpl | null>(null);
    const gl = useThree((s) => s.gl);
    useImperativeHandle<OrbitControlsImpl | null, OrbitControlsImpl | null>(
      ref,
      () => controlsRef.current,
    );

    useFrame(() => {
      const c = controlsRef.current;
      if (!c) return;
      const t = c.target;
      const dyn = panLimitFor ? panLimitFor((c.object as THREE.OrthographicCamera).zoom) : null;
      const limX = dyn ? dyn.x : panLimitX;
      const limZ = dyn ? dyn.z : panLimitZ;
      const cx = THREE.MathUtils.clamp(t.x, -limX, limX);
      const cz = THREE.MathUtils.clamp(t.z, -limZ, limZ);
      const dx = cx - t.x;
      const dy = -t.y;
      const dz = cz - t.z;
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        t.x = cx;
        t.y = 0;
        t.z = cz;
        c.object.position.x += dx;
        c.object.position.y += dy;
        c.object.position.z += dz;
      }
    });

    useDragGate(controlsRef, reserveLeftClick, gl, toolOwnsPointerRef);

    // Touch stays pan + pinch/pan only. Mobile orbit gestures made camera
    // rotation/tilt feel accidental, so desktop keeps right-mouse orbit
    // while touch keeps camera adjustment predictable.
    const touches = useMemo(
      () => ({
        ONE: reserveTouchPlacement ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN,
        TWO: THREE.TOUCH.DOLLY_PAN,
      }),
      [reserveTouchPlacement],
    );

    return (
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableRotate={enableRotate}
        enablePan
        enableZoom
        mouseButtons={{
          // Right-mouse on desktop is the orbit gesture when rotate is
          // enabled (OrbitControls default mapping); explicitly listed so
          // the role is obvious here. Off when enableRotate=false.
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.ROTATE,
        }}
        touches={touches}
        panSpeed={panSpeed}
        zoomSpeed={zoomSpeed}
        rotateSpeed={rotateSpeed}
        minPolarAngle={minPolarAngle}
        maxPolarAngle={maxPolarAngle}
        minZoom={minZoom}
        maxZoom={maxZoom}
        screenSpacePanning={false}
      />
    );
  },
);

const DRAG_THRESHOLD_SQ = 25; // 5 px²
const DRAG_GATE = Symbol("dragGate");

function useDragGate(
  controlsRef: React.RefObject<OrbitControlsImpl | null>,
  active: boolean,
  gl: THREE.WebGLRenderer,
  toolOwnsPointerRef?: React.RefObject<boolean>,
) {
  useEffect(() => {
    if (!active) return;

    const canvas = gl.domElement;
    const ownerDocument = canvas.ownerDocument;
    let startX = 0;
    let startY = 0;
    let pointerId = -1;
    let gated = false;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (DRAG_GATE in e) return;
      // Editor tool owns the pointer for this gesture — don't gate, don't
      // touch controls.enabled. The synchronous controls.enabled = false in
      // EditorPropsLayer keeps OrbitControls inert; if we re-enabled here
      // the brush/river stroke would leak into a camera pan mid-drag.
      if (toolOwnsPointerRef?.current === true) return;

      startX = e.clientX;
      startY = e.clientY;
      pointerId = e.pointerId;
      gated = true;

      const c = controlsRef.current;
      if (c) {
        c.enabled = false;
        queueMicrotask(() => {
          // Tool may have armed in the same microtask window — re-check
          // before flipping enabled back on so the gate doesn't undo the
          // synchronous controls.enabled = false from EditorPropsLayer.
          if (toolOwnsPointerRef?.current === true) return;
          if (c) c.enabled = true;
        });
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!gated || e.pointerId !== pointerId) return;
      if (toolOwnsPointerRef?.current === true) {
        gated = false;
        pointerId = -1;
        return;
      }

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_SQ) return;

      gated = false;

      const synthDown = new PointerEvent("pointerdown", {
        clientX: startX,
        clientY: startY,
        button: 0,
        buttons: 1,
        pointerId: e.pointerId,
        pointerType: "mouse",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(synthDown, DRAG_GATE, { value: true });
      canvas.dispatchEvent(synthDown);

      // Replay the threshold-crossing move too. Without this, pan only
      // begins on the *next* move event, which makes short drags feel
      // sticky or get misread as taps.
      ownerDocument.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: e.clientX,
          clientY: e.clientY,
          button: -1,
          buttons: 1,
          pointerId: e.pointerId,
          pointerType: "mouse",
          bubbles: true,
          cancelable: true,
        }),
      );
    };

    const clearGate = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      gated = false;
      pointerId = -1;
    };

    canvas.addEventListener("pointerdown", onDown, { capture: true });
    ownerDocument.addEventListener("pointermove", onMove);
    ownerDocument.addEventListener("pointerup", clearGate);
    ownerDocument.addEventListener("pointercancel", clearGate);

    return () => {
      canvas.removeEventListener("pointerdown", onDown, { capture: true });
      ownerDocument.removeEventListener("pointermove", onMove);
      ownerDocument.removeEventListener("pointerup", clearGate);
      ownerDocument.removeEventListener("pointercancel", clearGate);
    };
  }, [gl, controlsRef, active, toolOwnsPointerRef]);
}
