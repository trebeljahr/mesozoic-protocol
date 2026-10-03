import { Environment, OrthographicCamera } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { OrthographicCamera as OrthographicCameraImpl } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useWorldMapEditor } from "../editor/worldMapEditorStore";
import { LEVELS } from "../levels";
import { useGame } from "../store";
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
import { CONTENT_H, GROUND_H, GROUND_W, PAN_LIMIT_X, PAN_LIMIT_Z } from "./worldMapBounds";
import { isMapLevelDiscovered } from "./worldMapDiscovery";
import {
  ABS_MAX_ZOOM,
  ATLAS_TARGET_Z,
  CAMERA_Y,
  CAMERA_Z_OFFSET,
  type CameraFocus,
  computeFitZoom,
  computeOutpostFocus,
  findCurrentLevelIndex,
  MAX_ZOOM_MULT,
  restoreMapView,
  type SavedMapView,
} from "./worldMapFocus";

// Level node bounds span x: [-24, 22], y: [-14, 26] — content grew taller
// after the 6-biome-band layout (alien band tops out at y=26).
// CONTENT_*/GROUND_*/PAN_LIMIT_* live in worldMapBounds.ts so the dev-only
// world-map editor can re-use them without importing this whole module.

// Session views survive scene remounts while reference panels are open.
const savedViews = new Map<number | null, SavedMapView>();

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
  // (resize / orientation flip) or when the current-outpost target changes
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
const MapFocusTarget = ({
  focus,
  slot,
  frontier,
}: {
  focus: CameraFocus | null;
  slot: number | null;
  frontier: number;
}) => {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  useEffect(() => {
    if (!controls) return;
    const targetX = focus?.targetX ?? 0;
    const targetZ = focus?.targetZ ?? ATLAS_TARGET_Z;
    controls.target.set(targetX, 0, targetZ);
    controls.update();
    const save = () => {
      const camera = controls.object as OrthographicCameraImpl;
      savedViews.set(slot, {
        frontier,
        targetX: controls.target.x,
        targetZ: controls.target.z,
        zoom: camera.zoom,
      });
    };
    controls.addEventListener("change", save);
    return () => {
      save();
      controls.removeEventListener("change", save);
    };
  }, [controls, focus, slot, frontier]);
  return null;
};

export const WorldMapScene = () => {
  const size = useThree((s) => s.size);
  const progress = useGame((s) => s.progress);
  const activeSlot = useGame((s) => s.activeSlot);
  const editorActive = useWorldMapEditor((s) => s.active);
  const fitZoom = useMemo(() => computeFitZoom(size.width, size.height), [size.width, size.height]);
  const maxZoom = Math.min(fitZoom * MAX_ZOOM_MULT, ABS_MAX_ZOOM);
  const frontier = findCurrentLevelIndex(progress);
  // Progress metadata must not snap a user-panned camera back to the frontier.
  const focus = useMemo(
    () =>
      restoreMapView(savedViews.get(activeSlot), frontier, fitZoom, maxZoom) ??
      computeOutpostFocus(frontier, fitZoom, maxZoom, size.width, size.height),
    [activeSlot, frontier, fitZoom, maxZoom, size.width, size.height],
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
      <MapFocusTarget focus={focus} slot={activeSlot} frontier={frontier} />

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
