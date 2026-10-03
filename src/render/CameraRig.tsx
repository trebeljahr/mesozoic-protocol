import { OrthographicCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { OrthographicCamera as OrthographicCameraImpl } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useEditor } from "../editor/editorStore";
import { usePresentation } from "../preferences";
import { useGame } from "../store";
import { useReducedMotion } from "../ui/useReducedMotion";
import {
  ABS_MAX_ZOOM,
  BATTLE_MAX_POLAR,
  BATTLE_MIN_POLAR,
  CAMERA_BASE_POSITION,
  computeFitZoom,
  computeMaxPathExtents,
  MAX_ZOOM_MULT,
  START_ZOOM_MULT,
  TILT_HALF_FACTOR,
} from "./cameraFraming";
import { PLAY_CAMERA_FRAME_PRIORITY, PLAY_PAN_CLAMP_FRAME_PRIORITY } from "./playFrameOrder";
import { MapOrbitControls } from "./useMapGestures";

export const CameraRig = () => {
  const cameraShake = usePresentation((s) => s.preferences.cameraShake);
  const reducedMotion = useReducedMotion();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const cameraRef = useRef<OrthographicCameraImpl>(null);

  const paths = useGame((s) => s.world.paths);
  const levelId = useGame((s) => s.world.levelId);
  const compound = useGame(
    (s) => s.world.levelId === 4 && !s.world.overrideActive && s.world.proceduralSeed === 0,
  );
  const selectedKind = useGame((s) => s.selectedKind);
  const status = useGame((s) => s.world.status);
  // While a robot dash aim is armed, single-finger touch is reserved for
  // dragging the dash direction (handled by the placement plane), so the
  // camera must not pan or rotate under the gesture.
  const robotDashAiming = useGame((s) => s.ui.robotDashAiming);
  const size = useThree((s) => s.size);

  // Dev-only: when the level editor's brush/river/place/move/marquee/stamp/
  // easter-egg tool is armed, the canvas pointer belongs to the editor. We
  // expose this as a ref to MapOrbitControls so the drag gate inside
  // useMapGestures can synchronously bail before touching controls.enabled
  // or replaying pointer events — without this the brush stroke leaks into
  // a camera pan when the pointer crosses the drag threshold.
  const editorToolActive = useEditor(
    (s) =>
      s.active &&
      (s.placingUrl !== null ||
        s.moving ||
        s.brush.active ||
        s.riverTool.active ||
        s.easterEggTool.active ||
        s.marqueeTool.active ||
        s.placingStampId !== null),
  );
  const toolOwnsPointerRef = useRef(editorToolActive);
  toolOwnsPointerRef.current = editorToolActive;

  // Local one-shot rumble triggered when the run flips to "lost". The
  // sim loop stops ticking on loss (so world.shake stops decaying), and
  // the per-tick shake never fires on loss anyway — handle it entirely
  // here. lossShakeStart is the wall-clock ms when the rumble began;
  // null means inactive. prevStatus tracks the transition into "lost".
  const lossShakeStartRef = useRef<number | null>(null);
  const prevStatusRef = useRef(useGame.getState().world.status);
  // Last applied shake offset (in world XZ). Re-applied each frame as a
  // delta to BOTH camera.position and controls.target so OrbitControls'
  // lookAt(target) keeps the same view direction — the shake reads as
  // pure screen translation. Wrapping the camera in a parent group
  // (the old approach) instead moved the camera in world space while
  // target stayed pinned at (0,0,0), so lookAt re-aimed every frame and
  // the loss rumble visibly rotated the whole map.
  const shakeOffsetRef = useRef({ x: 0, z: 0 });

  const pathHalfExtents = useMemo(() => computeMaxPathExtents(paths), [paths]);
  const fitZoom = useMemo(
    () => computeFitZoom(size.width, size.height, pathHalfExtents, compound),
    [size.width, size.height, pathHalfExtents, compound],
  );
  const maxZoom = Math.min(fitZoom * MAX_ZOOM_MULT, ABS_MAX_ZOOM);
  const startZoom = Math.min(fitZoom * (compound ? 1 : START_ZOOM_MULT), maxZoom);
  // At zoom z the visible half-extent is viewport / (2z) on X and
  // TILT * viewport / z on Z. Pan range is what was visible at fit zoom
  // minus what's visible now — zero at fit zoom, growing as the player
  // zooms in. Keeps the map locked-centred when fully zoomed out.
  const panLimitFor = useMemo(() => {
    const fitHalfX = size.width / (2 * fitZoom);
    const fitHalfZ = (TILT_HALF_FACTOR * size.height) / fitZoom;
    return (zoom: number) => {
      const halfX = size.width / (2 * zoom);
      const halfZ = (TILT_HALF_FACTOR * size.height) / zoom;
      return { x: Math.max(0, fitHalfX - halfX), z: Math.max(0, fitHalfZ - halfZ) };
    };
  }, [size.width, size.height, fitZoom]);

  // Reset slightly inside the fit baseline whenever the level changes or the
  // viewport resizes. Re-centre pan too; otherwise a prior level's
  // drag offset can carry into the new start and make mobile starts feel
  // cropped even though the zoom itself reset correctly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: levelId is intentional
  useEffect(() => {
    const cam = cameraRef.current;
    const ctrls = controlsRef.current;
    if (!cam) return;
    cam.position.set(...CAMERA_BASE_POSITION);
    cam.zoom = startZoom;
    cam.updateProjectionMatrix();
    if (ctrls) {
      ctrls.target.set(0, 0, 0);
      ctrls.update();
    }
  }, [levelId, startZoom]);

  useFrame(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    const ctrls = controlsRef.current;
    const { world } = useGame.getState();
    const curStatus = world.status;
    if (curStatus === "lost" && prevStatusRef.current !== "lost") {
      lossShakeStartRef.current = performance.now();
      // Snap the orbit back to the base pose so any yaw/pitch the player
      // dialed in during the run doesn't reappear under the death rumble.
      // Without this, the rumble's world-space XZ jitter on a rotated
      // camera reads as a spinning/tilting map. Also resets the shake
      // accumulator so the next delta computes off the clean base pose.
      cam.position.set(...CAMERA_BASE_POSITION);
      if (ctrls) {
        ctrls.target.set(0, 0, 0);
        ctrls.update();
      }
      shakeOffsetRef.current.x = 0;
      shakeOffsetRef.current.z = 0;
    }
    if (curStatus === "running") lossShakeStartRef.current = null;
    prevStatusRef.current = curStatus;

    let mag = curStatus === "running" ? world.shake.magnitude : 0;
    const lossStart = lossShakeStartRef.current;
    if (lossStart !== null) {
      // 600ms ease-out (cubic): magnitude 0.6 → 0.
      const t = Math.min(1, (performance.now() - lossStart) / 600);
      const ease = 1 - t;
      const lossMag = 0.6 * ease * ease * ease;
      if (lossMag > mag) mag = lossMag;
      if (t >= 1) lossShakeStartRef.current = null;
    }

    if (!cameraShake || reducedMotion) mag = 0;
    const desiredX = mag > 0.001 ? (Math.random() - 0.5) * mag : 0;
    const desiredZ = mag > 0.001 ? (Math.random() - 0.5) * mag : 0;
    const last = shakeOffsetRef.current;
    const dx = desiredX - last.x;
    const dz = desiredZ - last.z;
    if (dx !== 0 || dz !== 0) {
      cam.position.x += dx;
      cam.position.z += dz;
      if (ctrls) {
        ctrls.target.x += dx;
        ctrls.target.z += dz;
      }
      last.x = desiredX;
      last.z = desiredZ;
    }
  }, PLAY_CAMERA_FRAME_PRIORITY);

  return (
    <>
      <OrthographicCamera
        ref={cameraRef}
        makeDefault
        position={CAMERA_BASE_POSITION}
        rotation={[-Math.atan2(CAMERA_BASE_POSITION[1], CAMERA_BASE_POSITION[2]), 0, 0]}
        zoom={startZoom}
        near={0.1}
        far={200}
      />
      <MapOrbitControls
        framePriority={PLAY_PAN_CLAMP_FRAME_PRIORITY}
        ref={controlsRef}
        panLimitX={0}
        panLimitZ={0}
        panLimitFor={panLimitFor}
        minZoom={fitZoom}
        maxZoom={maxZoom}
        panSpeed={1.4}
        zoomSpeed={0.9}
        reserveLeftClick
        reserveTouchPlacement={selectedKind !== null || robotDashAiming}
        // Yaw + small pitch hint that the playfield is 3D. Disabled while
        // a tower is armed because the placement gesture maps one-finger
        // touch to ROTATE as a no-op — leaving rotate enabled there would
        // spin the camera mid-placement. Also disabled once the run is
        // lost so the HQ-death rumble doesn't get mistaken for a rotate
        // gesture and spin the whole map under the player. Right-mouse
        // drag on desktop only; touch remains pan + pinch/pan.
        enableRotate={selectedKind === null && status !== "lost" && !robotDashAiming}
        minPolarAngle={BATTLE_MIN_POLAR}
        maxPolarAngle={BATTLE_MAX_POLAR}
        rotateSpeed={0.6}
        toolOwnsPointerRef={toolOwnsPointerRef}
      />
    </>
  );
};
