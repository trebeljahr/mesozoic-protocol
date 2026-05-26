import { Environment, OrthographicCamera } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { OrthographicCamera as OrthographicCameraImpl } from "three";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { LEVELS } from "../levels";
import { getStars, isLevelUnlocked, type ProgressData } from "../progress";
import { useGame } from "../store";
import { useIsMobile } from "../ui/useMediaQuery";
import { BiomeGround } from "./BiomeGround";
import { BiomeProps } from "./BiomeProps";
import { LevelNode } from "./LevelNode";
import { MapRoute } from "./MapRoute";
import { MapOrbitControls } from "./useMapGestures";
import { WorldMapEditorProps } from "./WorldMapEditorProps";
import { WorldMapOutposts } from "./WorldMapOutposts";
import { WorldMapPrewarm } from "./WorldMapPrewarm";
import { WorldMapRivers } from "./WorldMapRivers";
import {
  CONTENT_H,
  CONTENT_W,
  GROUND_H,
  GROUND_W,
  PAN_LIMIT_X,
  PAN_LIMIT_Z,
} from "./worldMapBounds";

// Level node bounds span x: [-24, 22], y: [-14, 26] — content grew taller
// after the 6-biome-band layout (alien band tops out at y=26).
// CONTENT_*/GROUND_*/PAN_LIMIT_* live in worldMapBounds.ts so the dev-only
// world-map editor can re-use them without importing this whole module.

// Camera tilt: forward = (0, -0.935, -0.354) → the screen-up axis
// projects onto the ground plane stretched by 1/0.935. So the visible
// Z extent on the ground at zoom Z is (height/Z) / 0.935.
const TILT_GROUND_FACTOR = 1 / 0.935;

// Hard ceiling on zoom-in. Past this, single nodes overflow the viewport
// and the labels become unreadable from oversampling.
const ABS_MAX_ZOOM = 42;
// How far past the fit zoom the player can manually zoom in.
const MAX_ZOOM_MULT = 2.5;

// Smallest zoom we'll ever pick. Keeps short/wide viewports from showing
// a tiny postage-stamp map while still letting normal phones land on a
// looser fit when the height-fit math comes out below this.
const MIN_FIT_ZOOM = 8;

// Padding factor around the focused level's neighbor span when fitting the
// mobile entry zoom — keeps the sibling nodes off the screen edge.
const NEIGHBOR_FIT_PAD = 1.5;
// Floors (world units) on the per-axis half-span used for the fit, so a
// level whose neighbors sit unusually close still doesn't zoom in past
// readability.
const MIN_FOCUS_HALF_X = 9;
const MIN_FOCUS_HALF_Z = 6;
// Fraction of the visible world-Z extent to drop the focused level below
// screen center. Positive = node sits below midline.
const MOBILE_Y_OFFSET_FRAC = 0.18;
// Camera-to-target Z offset baked into the OrthographicCamera position
// (0, 30, 11.36). Preserved when shifting target so the look angle stays
// fixed.
const CAMERA_Z_OFFSET = 11.36;
const CAMERA_Y = 30;

const computeFitZoom = (width: number, height: number): number => {
  const halfX = CONTENT_W / 2;
  const halfZ = CONTENT_H / 2;
  const fitX = width / (2 * halfX);
  const fitZ = (height * TILT_GROUND_FACTOR) / (2 * halfZ);
  return Math.max(MIN_FIT_ZOOM, Math.min(fitX, fitZ));
};

// Index (not id) of the first unlocked, not-yet-cleared level — the
// player's current frontier. Falls back to the last level once every level
// has 1+ stars so re-entries still center on a real node instead of (0,0).
// Returns the array index so the caller can read the immediate path
// neighbors for the focus-zoom fit.
const findCurrentLevelIndex = (progress: ProgressData): number => {
  for (let i = 0; i < LEVELS.length; i++) {
    const l = LEVELS[i];
    if (isLevelUnlocked(l.id, progress) && getStars(progress, l.id) === 0) return i;
  }
  return LEVELS.length - 1;
};

type CameraFocus = { zoom: number; targetX: number; targetZ: number };

const computeMobileFocus = (
  progress: ProgressData,
  fitZoom: number,
  maxZoom: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
): CameraFocus | null => {
  const idx = findCurrentLevelIndex(progress);
  const level = LEVELS[idx];
  if (!level) return null;
  // Per-axis half-span (world units) from the focused node to its immediate
  // path neighbors, one each side. Drives a zoom that frames ~1 level per
  // side with the next-out level peeking in. Decoupled from fitZoom: that
  // zoom is viewport-floored and doesn't map to a consistent world span, so
  // a flat multiplier over it over-zoomed siblings on phones.
  let halfX = MIN_FOCUS_HALF_X;
  let halfZ = MIN_FOCUS_HALF_Z;
  for (const j of [idx - 1, idx + 1]) {
    const n = LEVELS[j];
    if (!n) continue;
    halfX = Math.max(halfX, Math.abs(level.nodePos.x - n.nodePos.x));
    halfZ = Math.max(halfZ, Math.abs(level.nodePos.y - n.nodePos.y));
  }
  const zoomX = viewportWidthPx / (2 * halfX * NEIGHBOR_FIT_PAD);
  const zoomZ = (viewportHeightPx * TILT_GROUND_FACTOR) / (2 * halfZ * NEIGHBOR_FIT_PAD);
  const zoom = THREE.MathUtils.clamp(Math.min(zoomX, zoomZ), fitZoom, maxZoom);
  const visibleHeightWorld = (viewportHeightPx / zoom) * TILT_GROUND_FACTOR;
  const nodeWorldZ = -level.nodePos.y;
  const rawTargetZ = nodeWorldZ - visibleHeightWorld * MOBILE_Y_OFFSET_FRAC;
  return {
    zoom,
    targetX: THREE.MathUtils.clamp(level.nodePos.x, -PAN_LIMIT_X, PAN_LIMIT_X),
    targetZ: THREE.MathUtils.clamp(rawTargetZ, -PAN_LIMIT_Z, PAN_LIMIT_Z),
  };
};

// Sky/fog tone — kept dim enough that mipmap-bloom on the canvas edge
// can't push it past the bloom threshold. Was #b8d0e4 / #c7dae8, but
// those bloomed into a hard white halo when the camera revealed any
// portion of the BG (e.g. a portrait viewport with the south plane
// edge in view).
const BG = "#3a4858";
const FOG = "#4a5868";
const HEMI_TOP = "#d6e6f4";
const HEMI_BOTTOM = "#7a6848";

const MapCamera = ({ fitZoom, focus }: { fitZoom: number; focus: CameraFocus | null }) => {
  const cameraRef = useRef<OrthographicCameraImpl>(null);
  // Re-seat the camera whenever the viewport-derived fit zoom changes
  // (resize / orientation flip) or when the mobile-focus target changes
  // (progress update). Without this the map stays at the previous
  // zoom/position even after the viewport changes shape.
  useEffect(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    const targetX = focus?.targetX ?? 0;
    const targetZ = focus?.targetZ ?? 0;
    cam.position.set(targetX, CAMERA_Y, targetZ + CAMERA_Z_OFFSET);
    cam.zoom = focus?.zoom ?? fitZoom;
    cam.updateProjectionMatrix();
  }, [fitZoom, focus]);
  return (
    <OrthographicCamera
      ref={cameraRef}
      makeDefault
      position={[focus?.targetX ?? 0, CAMERA_Y, (focus?.targetZ ?? 0) + CAMERA_Z_OFFSET]}
      zoom={focus?.zoom ?? fitZoom}
      near={0.1}
      far={200}
    />
  );
};

// Sister to MapCamera — re-seats the OrbitControls target so the gestural
// pan/zoom origin matches the focused level. Lives as a child of the
// scene so it can read the controls instance r3f publishes via makeDefault.
const MapFocusTarget = ({ focus }: { focus: CameraFocus | null }) => {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  useEffect(() => {
    if (!controls) return;
    const targetX = focus?.targetX ?? 0;
    const targetZ = focus?.targetZ ?? 0;
    controls.target.set(targetX, 0, targetZ);
    controls.update();
  }, [controls, focus]);
  return null;
};

export const WorldMapScene = () => {
  const size = useThree((s) => s.size);
  const progress = useGame((s) => s.progress);
  // Match useIsMobile (not a bare width check) so landscape phones — wider
  // than 720px but coarse-pointer / short-viewport — also get the focused
  // entry view instead of the desktop whole-map fit.
  const isMobile = useIsMobile();
  const fitZoom = useMemo(() => computeFitZoom(size.width, size.height), [size.width, size.height]);
  const maxZoom = Math.min(fitZoom * MAX_ZOOM_MULT, ABS_MAX_ZOOM);
  // Mobile entry view focuses on the player's current level (first unlocked,
  // not-yet-cleared) and zooms so ~1-2 sibling levels show on each side.
  // Desktop keeps the whole-map fit view.
  const focus = useMemo(
    () =>
      isMobile ? computeMobileFocus(progress, fitZoom, maxZoom, size.width, size.height) : null,
    [isMobile, progress, fitZoom, maxZoom, size.width, size.height],
  );
  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[FOG, 80, 160]} />

      {/*
      Camera position determines the look angle once OrbitControls takes
      over (OrbitControls always re-orients the camera toward its target,
      which overrides the `rotation` prop). The target sits at (0,0,0) and
      the camera offset (0, 30, 11.36) gives forward = (0, -0.935, -0.354)
      — i.e. ~21° below vertical. A shallower angle (the previous z=22)
      caused the screen-space "up" vector to align too closely with world
      +Y, so the bottom rays of tall (portrait-ish) canvases started below
      the ground plane and revealed BG along the south horizon.

      Initial zoom is computed from the viewport so phones don't open
      half-cropped. Used as both the camera's starting zoom and the
      OrbitControls minZoom (zooming out further would expose BG). On
      mobile the camera additionally offsets to center on the player's
      current level — see computeMobileFocus.
    */}
      <MapCamera fitZoom={fitZoom} focus={focus} />

      <MapOrbitControls
        panLimitX={PAN_LIMIT_X}
        panLimitZ={PAN_LIMIT_Z}
        minZoom={fitZoom}
        maxZoom={maxZoom}
        panSpeed={1.6}
        zoomSpeed={0.8}
        // World map controls are pan + zoom only. The camera keeps its
        // authored fixed tilt, but player gestures must not orbit or
        // pitch it.
      />
      <MapFocusTarget focus={focus} />

      <Environment
        files="/hdri/rooitou_park_1k.hdr"
        background={false}
        environmentIntensity={0.6}
      />

      <ambientLight intensity={0.55} color="#eaf2ff" />
      <directionalLight
        position={[14, 26, 10]}
        intensity={2.2}
        color="#fff4dc"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-CONTENT_H}
        shadow-camera-right={CONTENT_H}
        shadow-camera-top={CONTENT_H}
        shadow-camera-bottom={-CONTENT_H}
        shadow-bias={-0.0005}
      />
      <hemisphereLight args={[HEMI_TOP, HEMI_BOTTOM, 0.85]} />

      <BiomeGround width={GROUND_W} height={GROUND_H} />
      <BiomeProps />
      <WorldMapOutposts />

      <MapRoute />

      <WorldMapRivers />

      {import.meta.env.DEV && <WorldMapEditorProps />}

      {LEVELS.map((level) => (
        <LevelNode key={level.id} level={level} />
      ))}

      <WorldMapPrewarm />
    </>
  );
};
