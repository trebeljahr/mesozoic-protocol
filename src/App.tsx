import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { KernelSize } from "postprocessing";
import { lazy, Suspense, useEffect } from "react";
import { useAudioBridge } from "./audio/useAudioBridge";
import { LevelEditorPanel } from "./editor/LevelEditorPanel";
import { WorldMapEditorPanel } from "./editor/WorldMapEditorPanel";
import { useGamepadMenuNavigation } from "./input/useGamepadMenuNavigation";
import { ExpectedCanvasTeardown } from "./render/ExpectedCanvasTeardown";
import { PaintedPostFx } from "./render/PaintedPostFx";
import { PlayScene } from "./render/Scene";
import { useGame } from "./store";
import { AchievementToast } from "./ui/AchievementToast";
import { CanvasFailure } from "./ui/CanvasFailure";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { HUD } from "./ui/HUD";
import { LandscapeNudge } from "./ui/LandscapeNudge";
import { LevelIntro } from "./ui/LevelIntro";
import { LevelLoadOverlay } from "./ui/LevelLoadOverlay";
import { NewEnemyAlert } from "./ui/NewEnemyAlert";
import { PlannerHud } from "./ui/PlannerHud";
import { ResultsScreen } from "./ui/ResultsScreen";
import { SaveSlots } from "./ui/SaveSlots";
import { Splash } from "./ui/Splash";
import { useBackNavigation } from "./ui/useBackNavigation";
import { enterFullscreen, isFullscreen, loadFullscreenPref } from "./ui/useFullscreen";
import { useInputModeSignal } from "./ui/useInputMode";
import { useLevelLoadProgress } from "./ui/useLevelLoadProgress";
import { useIsMobile } from "./ui/useMediaQuery";
import { WorldMapUI } from "./ui/WorldMapUI";

const worldSceneKeys = new WeakMap<object, number>();
let nextWorldSceneKey = 1;

const keyForWorld = (world: object): number => {
  let key = worldSceneKeys.get(world);
  if (key === undefined) {
    key = nextWorldSceneKey++;
    worldSceneKeys.set(world, key);
  }
  return key;
};

// Heavy panels and the world-map scene only load when the user actually
// opens them. WorldMapScene pulls all biome models; Compendium and
// AchievementsPanel each carry their own art and copy. Splitting them
// drops the initial JS payload by hundreds of KB.
const WorldMapScene = lazy(() =>
  import("./render/WorldMap").then((m) => ({ default: m.WorldMapScene })),
);
const Compendium = lazy(() => import("./ui/Compendium").then((m) => ({ default: m.Compendium })));
const AchievementsPanel = lazy(() =>
  import("./ui/AchievementsPanel").then((m) => ({ default: m.AchievementsPanel })),
);
const CreditsPanel = lazy(() =>
  import("./ui/CreditsPanel").then((m) => ({ default: m.CreditsPanel })),
);
const DifficultyPicker = lazy(() =>
  import("./ui/DifficultyPicker").then((m) => ({ default: m.DifficultyPicker })),
);
const ModePicker = lazy(() => import("./ui/ModePicker").then((m) => ({ default: m.ModePicker })));
const EndlessPicker = lazy(() =>
  import("./ui/EndlessPicker").then((m) => ({ default: m.EndlessPicker })),
);
const SkillTreePanel = lazy(() =>
  import("./ui/SkillTreePanel").then((m) => ({ default: m.SkillTreePanel })),
);
const RobotShop = lazy(() => import("./ui/RobotShop").then((m) => ({ default: m.RobotShop })));

const SceneRoot = () => {
  const screen = useGame((s) => s.screen);
  const world = useGame((s) => s.world);
  // Suspense fallback is null — Canvas already renders nothing on first
  // frame anyway, and the world-map only shows up post-load.
  return screen === "worldMap" ? (
    <Suspense fallback={null}>
      <WorldMapScene />
    </Suspense>
  ) : (
    <PlayScene key={keyForWorld(world)} />
  );
};

// Lightweight device tier check used to scale bloom kernel and DPR cap.
// `low` = mobile-ish (<=4 logical cores or coarse pointer / mobile UA);
// other devices keep the higher-quality MEDIUM kernel.
const isLowEndDevice = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const cores = navigator.hardwareConcurrency ?? 8;
  if (cores <= 4) return true;
  if (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches) return true;
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
};

const lowEnd = isLowEndDevice();
const bloomKernel = lowEnd ? KernelSize.SMALL : KernelSize.MEDIUM;
// Bumped low-end ceiling from 1.75 → 2 so retina phones don't sub-sample
// the framebuffer. Sub-2× on a 3× device produces stair-step edges along
// dinosaur silhouettes that no MSAA pass can fully hide.
const dprCap: [number, number] = lowEnd ? [1, 2] : [1, 2];
// MSAA in the postprocessing composer. The Canvas-level antialias prop
// is bypassed once EffectComposer renders into its own multisample-less
// render target, so silhouettes go jagged. 4x is the sweet-spot —
// 2x leaves thin animated silhouettes (dino legs, antennae) flickering
// frame-to-frame on retina mobile.
const composerMultisampling = 4;

export const App = () => {
  const screen = useGame((s) => s.screen);
  const glContextEpoch = useGame((s) => s.glContextEpoch);
  const levelIntroVisible = useGame((s) => s.levelIntroVisible);
  const compendiumOpen = useGame((s) => s.compendiumOpen);
  const achievementsOpen = useGame((s) => s.achievementsOpen);
  const creditsOpen = useGame((s) => s.creditsOpen);
  const difficultyPickerOpen = useGame((s) => s.difficultyPickerOpen);
  const modePickerOpen = useGame((s) => s.modePickerLevelId !== null);
  const endlessPickerOpen = useGame((s) => s.endlessPickerOpen);
  const skillTreeOpen = useGame((s) => s.skillTreeOpen);
  const robotShopOpen = useGame((s) => s.robotShopOpen);
  const robotPanelOpen = useGame((s) => s.robotPanelOpen);
  const selectedKind = useGame((s) => s.selectedKind);
  const paused = useGame((s) => s.ui.status === "paused");
  const newEnemyAlertVisible = useGame((s) => s.newEnemyQueue.length > 0);
  const modalOpen =
    compendiumOpen ||
    achievementsOpen ||
    creditsOpen ||
    difficultyPickerOpen ||
    modePickerOpen ||
    endlessPickerOpen ||
    skillTreeOpen ||
    robotShopOpen;
  const sceneBlockingModalOpen =
    compendiumOpen ||
    achievementsOpen ||
    creditsOpen ||
    modePickerOpen ||
    endlessPickerOpen ||
    skillTreeOpen ||
    robotShopOpen;
  const isMobile = useIsMobile();
  useInputModeSignal();
  useAudioBridge();
  useLevelLoadProgress();
  useGamepadMenuNavigation(
    (screen !== "playing" && screen !== "worldMap") ||
      modalOpen ||
      (screen === "playing" && paused) ||
      levelIntroVisible ||
      newEnemyAlertVisible,
    { confirmAsKeyboard: levelIntroVisible || newEnemyAlertVisible },
  );

  // Browser/OS back routing. Stack order matches React useEffect order —
  // later hooks push later → land on top of the stack → pop first. Screen-
  // level transitions sit at the base; modals layer above. Each handler
  // does the same thing the UI close path does, so the back gesture stays
  // consistent with the explicit close button.
  useBackNavigation(screen === "worldMap", () => useGame.getState().goToSlots());
  useBackNavigation(screen === "results", () => useGame.getState().goToWorldMap());
  // Two separate hooks so each is single-fire: back while running pauses;
  // back while paused resumes. One combined hook would leave the stack
  // out of sync after firing because `active` would stay true.
  useBackNavigation(screen === "playing" && !paused, () => useGame.getState().togglePause());
  useBackNavigation(screen === "playing" && paused, () => useGame.getState().togglePause());
  // Modals — usually mutually exclusive at the visible layer, so stack
  // ordering between them rarely matters. Listed roughly bottom-to-top by
  // typical depth (pickers under reference panels under compendium).
  useBackNavigation(difficultyPickerOpen, () => useGame.getState().setDifficultyPickerOpen(false));
  useBackNavigation(modePickerOpen, () => useGame.getState().closeModePicker());
  useBackNavigation(endlessPickerOpen, () => useGame.getState().setEndlessPickerOpen(false));
  useBackNavigation(skillTreeOpen, () => useGame.getState().setSkillTreeOpen(false));
  useBackNavigation(robotShopOpen, () => useGame.getState().setRobotShopOpen(false));
  useBackNavigation(robotPanelOpen, () => useGame.getState().setRobotPanelOpen(false));
  useBackNavigation(achievementsOpen, () => useGame.getState().setAchievementsOpen(false));
  useBackNavigation(creditsOpen, () => useGame.getState().setCreditsOpen(false));
  useBackNavigation(compendiumOpen, () => useGame.getState().setCompendiumOpen(false));

  // Drive the cursor from gameplay state. Crosshair on the canvas
  // while a tower kind is selected, default everywhere else. Buttons
  // keep `cursor: pointer` because their rules win on specificity.
  useEffect(() => {
    const cls = "is-placing";
    if (selectedKind !== null) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [selectedKind]);

  // Body class so CSS @media-style mobile overrides can also key off
  // pointer/runtime detection, not just viewport width — covers narrow
  // desktop windows being styled mobile by mistake.
  useEffect(() => {
    const cls = "is-mobile";
    if (isMobile) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [isMobile]);

  // Default-fullscreen on mobile. Triggered the moment the player
  // enters a level, so the gesture (the level-node tap on the world
  // map) still counts as user-activation for the fullscreen API.
  // Honors the user's saved preference: "off" never auto-enters; "on"
  // tries even on desktop; "auto" opts into mobile only.
  useEffect(() => {
    if (screen !== "playing") return;
    if (isFullscreen()) return;
    const pref = loadFullscreenPref();
    if (pref === "off") return;
    if (pref === "auto" && !isMobile) return;
    void enterFullscreen();
  }, [screen, isMobile]);

  // World-map ground can push past the play-scene bloom threshold under
  // the strong directional light (lit snow albedo ~1.0-1.2 in linear after
  // palette darkening). Lift the threshold for the world map so the ground
  // sits below the bloom range — only HDR effects (additive VFX,
  // toneMapped:false particles) ever exceed 2.5 in linear.
  const bloomThreshold = screen === "worldMap" ? 2.5 : 0.82;
  const bloomSmoothing = screen === "worldMap" ? 0.05 : 0.18;

  // Entry-flow screens render standalone — no canvas, no HUD. They
  // sit above everything else and gate access to the gameplay canvas.
  // LandscapeNudge rides along so the rotate prompt appears from the
  // very first menu screen, not only once gameplay starts.
  if (screen === "splash")
    return (
      <>
        <Splash />
        <LandscapeNudge />
      </>
    );
  if (screen === "slots")
    return (
      <>
        <SaveSlots />
        <LandscapeNudge />
      </>
    );

  return (
    <>
      {!sceneBlockingModalOpen && (
        <ErrorBoundary fallback={(error, reset) => <CanvasFailure error={error} reset={reset} />}>
          <Canvas
            shadows
            dpr={dprCap}
            gl={{ antialias: true, powerPreference: "high-performance" }}
            onCreated={({ gl }) => {
              // WebGL context-loss safety net. preventDefault on the lost
              // event tells the browser we're willing to receive a restore;
              // without it the canvas stays permanently black. We do NOT
              // bump the scene epoch on lost — three.js + R3F can't render
              // against a dead context anyway, so remounting at that point
              // just thrashes React. Wait for restore, then bump the epoch
              // so SceneRoot + EffectComposer rebuild all their GPU-side
              // resources against the freshly-restored context.
              const canvas = gl.domElement;
              const dumpInfo = (tag: string) => {
                const info = gl.info;
                console.warn(
                  `[gl] ${tag} — programs=${info.programs?.length ?? "?"} ` +
                    `geometries=${info.memory.geometries} textures=${info.memory.textures} ` +
                    `calls=${info.render.calls} triangles=${info.render.triangles}`,
                );
              };
              const onLost = (e: Event) => {
                e.preventDefault();
                console.warn("[gl] context lost — preventing default so it can be restored");
                dumpInfo("at-lost");
              };
              const onRestored = () => {
                console.warn("[gl] context restored — bumping scene epoch to rebuild");
                useGame.setState({ glContextEpoch: useGame.getState().glContextEpoch + 1 });
              };
              canvas.addEventListener("webglcontextlost", onLost as EventListener, false);
              canvas.addEventListener("webglcontextrestored", onRestored, false);
            }}
          >
            <ExpectedCanvasTeardown />
            <SceneRoot key={`scene-${glContextEpoch}`} />
            <EffectComposer key={`fx-${glContextEpoch}`} multisampling={composerMultisampling}>
              {screen === "playing" ? (
                <PaintedPostFx />
              ) : (
                <Bloom
                  intensity={0.28}
                  luminanceThreshold={bloomThreshold}
                  luminanceSmoothing={bloomSmoothing}
                  mipmapBlur
                  kernelSize={bloomKernel}
                />
              )}
            </EffectComposer>
          </Canvas>
        </ErrorBoundary>
      )}

      {screen === "worldMap" && !sceneBlockingModalOpen && <WorldMapUI />}
      {screen !== "worldMap" && !sceneBlockingModalOpen && <HUD />}
      {screen === "playing" && !sceneBlockingModalOpen && <PlannerHud />}
      {screen === "results" && !sceneBlockingModalOpen && <ResultsScreen />}
      {compendiumOpen && (
        <Suspense fallback={null}>
          <Compendium />
        </Suspense>
      )}
      {achievementsOpen && (
        <Suspense fallback={null}>
          <AchievementsPanel />
        </Suspense>
      )}
      {creditsOpen && (
        <Suspense fallback={null}>
          <CreditsPanel />
        </Suspense>
      )}
      {difficultyPickerOpen && (
        <Suspense fallback={null}>
          <DifficultyPicker />
        </Suspense>
      )}
      {modePickerOpen && (
        <Suspense fallback={null}>
          <ModePicker />
        </Suspense>
      )}
      {endlessPickerOpen && (
        <Suspense fallback={null}>
          <EndlessPicker />
        </Suspense>
      )}
      {skillTreeOpen && (
        <Suspense fallback={null}>
          <SkillTreePanel />
        </Suspense>
      )}
      {robotShopOpen && (
        <Suspense fallback={null}>
          <RobotShop />
        </Suspense>
      )}
      <LevelLoadOverlay />
      {screen === "playing" && levelIntroVisible && <LevelIntro />}
      {screen === "playing" && !modalOpen && <NewEnemyAlert />}
      <AchievementToast />
      <LandscapeNudge />
      {import.meta.env.DEV && screen === "playing" && !modalOpen && <LevelEditorPanel />}
      {import.meta.env.DEV && screen === "worldMap" && !sceneBlockingModalOpen && (
        <WorldMapEditorPanel />
      )}
    </>
  );
};
