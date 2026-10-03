import { Environment, OrthographicCamera } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { OrthographicCamera as OrthographicCameraImpl } from "three";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { DEMO_MAX_LEVEL, IS_DEMO } from "../demo";
import { useWorldMapEditor } from "../editor/worldMapEditorStore";
import { LEVELS } from "../levels";
import { getStars, isLevelUnlocked, type ProgressData } from "../progress";
import { useGame } from "../store";
import { useIsMobile } from "../ui/useMediaQuery";
import { BiomeGround } from "./BiomeGround";
import { BiomeProps } from "./BiomeProps";
import { getGraphicsQuality } from "./effectsTunables";
import { LevelNode } from "./LevelNode";
import { MapRoute } from "./MapRoute";
import { MapOrbitControls } from "./useMapGestures";
import { WorldMapEditorProps } from "./WorldMapEditorProps";
import { WorldMapFog } from "./WorldMapFog";
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
import { isMapLevelDiscovered } from "./worldMapDiscovery";
import { mapLevelPosition } from "./worldMapLayout";

// Level node bounds span x: [-24, 22], y: [-14, 26] — content grew taller
// after the 6-biome-band layout (alien band tops out at y=26).
// CONTENT_*/GROUND_*/PAN_LIMIT_* live in worldMapBounds.ts so the dev-only
// world-map editor can re-use them without importing this whole module.

// A shallower atlas view shows tree crowns and facility faces. Keep the
// ground projection factor paired with the 30-high / 18-back camera offset.
const TILT_GROUND_FACTOR = Math.hypot(30, 18) / 30;

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
// Keep the current outpost slightly above center, leaving its label clear of
// the bottom navigation. Positive values move the node below the midline.
const MOBILE_Y_OFFSET_FRAC = -0.04;
// Camera-to-target Z offset baked into the OrthographicCamera position
// (0, 30, 18). Preserved when shifting target so the look angle stays
// fixed.
const CAMERA_Z_OFFSET = 18;
const CAMERA_Y = 30;
// Centre the complete campaign span, including the northern alien region.
const ATLAS_TARGET_Z = -5;

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
  // Once every level is cleared, re-center on the last real node. In the demo
  // that's the last playable outpost (L5), not the locked L30 far up the map.
  return IS_DEMO ? DEMO_MAX_LEVEL - 1 : LEVELS.length - 1;
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
    halfX = Math.max(halfX, Math.abs(mapLevelPosition(level.id).x - mapLevelPosition(n.id).x));
    halfZ = Math.max(halfZ, Math.abs(mapLevelPosition(level.id).y - mapLevelPosition(n.id).y));
  }
  const zoomX = viewportWidthPx / (2 * halfX * NEIGHBOR_FIT_PAD);
  const zoomZ = (viewportHeightPx * TILT_GROUND_FACTOR) / (2 * halfZ * NEIGHBOR_FIT_PAD);
  const zoom = THREE.MathUtils.clamp(Math.min(zoomX, zoomZ), fitZoom, maxZoom);
  const visibleHeightWorld = (viewportHeightPx / zoom) * TILT_GROUND_FACTOR;
  const nodeWorldZ = -mapLevelPosition(level.id).y;
  const rawTargetZ = nodeWorldZ - visibleHeightWorld * MOBILE_Y_OFFSET_FRAC;
  return {
    zoom,
    targetX: THREE.MathUtils.clamp(mapLevelPosition(level.id).x, -PAN_LIMIT_X, PAN_LIMIT_X),
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
    const targetZ = focus?.targetZ ?? ATLAS_TARGET_Z;
    cam.position.set(targetX, CAMERA_Y, targetZ + CAMERA_Z_OFFSET);
    cam.zoom = focus?.zoom ?? fitZoom;
    cam.updateProjectionMatrix();
  }, [fitZoom, focus]);
  return (
    <OrthographicCamera
      ref={cameraRef}
      makeDefault
      position={[
        focus?.targetX ?? 0,
        CAMERA_Y,
        (focus?.targetZ ?? ATLAS_TARGET_Z) + CAMERA_Z_OFFSET,
      ]}
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
    const targetZ = focus?.targetZ ?? ATLAS_TARGET_Z;
    controls.target.set(targetX, 0, targetZ);
    controls.update();
  }, [controls, focus]);
  return null;
};

export const WorldMapScene = () => {
  const size = useThree((s) => s.size);
  const progress = useGame((s) => s.progress);
  const activeSlot = useGame((s) => s.activeSlot);
  const editorActive = useWorldMapEditor((s) => s.active);
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
  // Dev-only: when the world-map editor has a brush/river/place/move/marquee
  // tool armed, the canvas pointer belongs to the editor. Mirror of CameraRig's
  // setup — see useMapGestures' drag gate for why this has to be a ref.
  const editorToolActive = useWorldMapEditor(
    (s) =>
      s.active &&
      (s.placingUrl !== null ||
        s.moving ||
        s.brush.active ||
        s.riverTool.active ||
        s.marqueeTool.active ||
        s.placingStampId !== null),
  );
  const toolOwnsPointerRef = useRef(editorToolActive);
  toolOwnsPointerRef.current = editorToolActive;
  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[FOG, 80, 160]} />

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
        toolOwnsPointerRef={toolOwnsPointerRef}
      />
      <MapFocusTarget focus={focus} />

      <Environment
        files="/hdri/rooitou_park_1k.hdr"
        background={false}
        environmentIntensity={0.25}
      />

      <ambientLight intensity={0.2} color="#eaf2ff" />
      <directionalLight
        position={[14, 26, 10]}
        intensity={2.8}
        color="#ffe8cf"
        castShadow
        shadow-mapSize-width={getGraphicsQuality() === "low" ? 1024 : 2048}
        shadow-mapSize-height={getGraphicsQuality() === "low" ? 1024 : 2048}
        shadow-camera-left={-CONTENT_H}
        shadow-camera-right={CONTENT_H}
        shadow-camera-top={CONTENT_H}
        shadow-camera-bottom={-CONTENT_H}
        shadow-bias={-0.00015}
        shadow-normalBias={0.025}
      />
      <hemisphereLight args={[HEMI_TOP, HEMI_BOTTOM, 0.5]} />

      <BiomeGround width={GROUND_W} height={GROUND_H} />
      <BiomeProps />
      <WorldMapOutposts />

      <MapRoute />

      <WorldMapRivers />

      {import.meta.env.DEV && <WorldMapEditorProps />}

      {LEVELS.filter((level) => editorActive || isMapLevelDiscovered(level.id, progress)).map(
        (level) => (
          <LevelNode key={level.id} level={level} />
        ),
      )}

      <WorldMapFog key={activeSlot ?? "no-slot"} />
      <WorldMapPrewarm />
    </>
  );
};
