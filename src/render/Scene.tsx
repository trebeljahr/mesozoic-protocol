import { Environment } from "@react-three/drei";
import { BIOME_STYLE } from "../biomes";
import { MAP_HEIGHT } from "../level";
import { BOSS_VARIANT_MODEL } from "../sim/world";
import { useGame } from "../store";
import { AmbientHaze } from "./AmbientHaze";
import { BiomeAmbientVfx } from "./BiomeAmbientVfx";
import { BiomeCosmetics } from "./BiomeCosmetics";
import { CameraRig } from "./CameraRig";
import { ChainArcsFx } from "./ChainArcsFx";
import { CloningVats } from "./CloningVats";
import { CoalTrail } from "./CoalTrail";
import { Defer } from "./Defer";
import { EasterEggs } from "./EasterEggs";
import { EditorProps } from "./EditorProps";
import { Effects } from "./Effects";
import { EnemyEyes } from "./EnemyEyes";
import { FlowFeatures } from "./FlowFeatures";
import { Ground } from "./Ground";
import { HealAuras } from "./HealAuras";
import { HealthBars } from "./HealthBars";
import { HiveDrones } from "./HiveDrones";
import { HQBase } from "./HQBase";
import { HQTurrets } from "./HQTurret";
import { ModelEnemyMesh } from "./ModelEnemyMesh";
import { ModelRobotMesh } from "./ModelRobotMesh";
import { ModelTowerMesh } from "./ModelTowerMesh";
import { OuterScenery } from "./OuterScenery";
import { SunProxy } from "./PaintedPostFx";
import { PathLine } from "./PathLine";
import { Placement } from "./Placement";
import { PlannerOverlay } from "./PlannerOverlay";
import { ProjectileMesh } from "./ProjectileMesh";
import { PulseTracerFx } from "./PulseTracerFx";
import { RegenBadges } from "./RegenBadges";
import { Rivers } from "./Rivers";
import { RobotHud } from "./RobotHud";
import { RobotSelectionVfx } from "./RobotSelectionVfx";
import { Rocks } from "./Rocks";
import { SelectionRing } from "./SelectionRing";
import { ShaderPrewarm } from "./ShaderPrewarm";
import { ShieldBubbles } from "./ShieldBubbles";
import { SimTicker } from "./SimTicker";
import { SmokePuffs } from "./SmokePuffs";
import { SpotTargetMarker } from "./SpotTargetMarker";
import { TowerVfx } from "./TowerVfx";
import { Trees } from "./Trees";
import { WorldOutposts } from "./WorldOutposts";

export const PlayScene = () => {
  const biome = useGame((s) => s.world.biome);
  const style = BIOME_STYLE[biome];
  return (
    <>
      <color attach="background" args={[style.sceneBg]} />
      <fog attach="fog" args={[style.fogColor, style.fogNear, style.fogFar]} />

      <CameraRig />

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
        shadow-camera-left={-MAP_HEIGHT}
        shadow-camera-right={MAP_HEIGHT}
        shadow-camera-top={MAP_HEIGHT}
        shadow-camera-bottom={-MAP_HEIGHT}
        shadow-bias={-0.0005}
      />
      <hemisphereLight args={[style.hemiTop, style.hemiBottom, 0.85]} />

      <SimTicker />
      <ShaderPrewarm />
      {/* Frame 0 — the minimum playable framing (ground, lights already in
          parent, HQ + path) so the first render compiles a small core. */}
      <Ground />
      <HQTurrets />
      <HQBase />
      <PathLine />
      <Placement />
      {/* Frame 1 — bulk of the static decor (trees, rocks, biome cosmetics
          live here so their material compiles don't pile onto the same
          frame as core scene programs). */}
      <Defer frames={1}>
        <Trees />
        <Rocks />
        <BiomeCosmetics />
        <OuterScenery />
        <FlowFeatures />
        <PlayRivers />
      </Defer>
      {/* Frame 2 — props introduced post-launch that pushed mount-time
          GPU work over the WebGL watchdog ceiling on busy levels (the
          cloning canisters each carry a skinned-mesh specimen + ~15
          sub-meshes; the world outposts add another batch of GLBs).
          Holding them back one extra frame lets the GPU command queue
          drain before they pile in. */}
      <Defer frames={2}>
        <CloningVats />
        <WorldOutposts />
        <EasterEggs />
        <PlannerOverlay />
      </Defer>
      {import.meta.env.DEV && <EditorProps />}

      <ModelEnemyMesh kind="raptor" url="/models/Velociraptor.glb" targetSize={1.6} />
      <ModelEnemyMesh kind="swarm" url="/models/Velociraptor.glb" targetSize={0.8} />
      <ModelEnemyMesh kind="para" url="/models/Parasaurolophus.glb" targetSize={1.7} />
      <ModelEnemyMesh kind="allosaur" url="/models/Trex.glb" targetSize={3.3} />
      <ModelEnemyMesh kind="stego" url="/models/Stegosaurus.glb" targetSize={2.85} />
      <ModelEnemyMesh kind="armored" url="/models/Triceratops.glb" targetSize={3.0} />
      <ModelEnemyMesh kind="titan" url="/models/Apatosaurus.glb" targetSize={11.0} clip="Walk" />
      {/* Biome-themed matriarchs — one mesh per variant so each loads
          its own GLB. The renderer dispatches by enemy.bossVariant, so a
          single "boss" kind powers six visually distinct queens. */}
      <ModelEnemyMesh
        kind="boss"
        bossVariant="apex"
        url="/models/Apatosaurus.glb"
        targetSize={27.0}
        clip="Walk"
        timeScale={BOSS_VARIANT_MODEL.apex.timeScale}
      />
      <ModelEnemyMesh
        kind="boss"
        bossVariant="raptor"
        url="/models/Velociraptor.glb"
        targetSize={9.6}
        timeScale={BOSS_VARIANT_MODEL.raptor.timeScale}
      />
      <ModelEnemyMesh
        kind="boss"
        bossVariant="stego"
        url="/models/Stegosaurus.glb"
        targetSize={7.5}
        clip="Walk"
        timeScale={BOSS_VARIANT_MODEL.stego.timeScale}
      />
      <ModelEnemyMesh
        kind="boss"
        bossVariant="para"
        url="/models/Parasaurolophus.glb"
        targetSize={6.9}
        timeScale={BOSS_VARIANT_MODEL.para.timeScale}
      />
      <ModelEnemyMesh
        kind="boss"
        bossVariant="allosaur"
        url="/models/Trex.glb"
        targetSize={8.25}
        timeScale={BOSS_VARIANT_MODEL.allosaur.timeScale}
      />
      <ModelEnemyMesh
        kind="boss"
        bossVariant="armored"
        url="/models/Triceratops.glb"
        targetSize={8.1}
        clip="Walk"
        timeScale={BOSS_VARIANT_MODEL.armored.timeScale}
      />

      <ModelTowerMesh kind="pulse" url="/models/tower_pulse.glb" targetSize={1.6} />
      <ModelTowerMesh kind="chain" url="/models/turrets/Lighting Turret.glb" targetSize={1.8} />
      <ModelTowerMesh kind="mortar" url="/models/turrets/Missile Turret.glb" targetSize={1.8} />
      <ModelTowerMesh kind="cryo" url="/models/turrets/Emp Turret.glb" targetSize={1.55} idleSpin />
      <ModelTowerMesh kind="flame" url="/models/turrets/Flamethrower Turret.glb" targetSize={1.7} />
      <ModelTowerMesh kind="hive" url="/models/turrets/Hive Turret.glb" targetSize={1.8} />
      <ModelRobotMesh />
      <RobotHud />
      {/* Frame 3 — the VFX / overlay pool components. Most pre-allocate
          large InstancedMesh / LineSegments buffers that the renderer
          uploads on first sight, plus their pool materials all compile
          shaders the first time they're drawn. Defer one more frame so
          this batch doesn't pile onto the same tick as the model hosts
          above. */}
      <Defer frames={3}>
        <HiveDrones />
        <ShieldBubbles />
        <HealAuras />
        <RegenBadges />
        <EnemyEyes />
        <CoalTrail />
        <TowerVfx />
        <HealthBars />
        <SelectionRing />
        <RobotSelectionVfx />
        <SpotTargetMarker />
        <ProjectileMesh />
        <PulseTracerFx />
        <ChainArcsFx />
        <Effects />
        <SmokePuffs />
        <BiomeAmbientVfx />
        <AmbientHaze />
      </Defer>
      <SunProxy biome={biome} />
    </>
  );
};

// Thin wrapper that pulls the level's rivers off the game store. Subscribes
// to ui.treeVersion so the bumpGeometry tick the editor fires on each river
// mutation also re-runs this selector — same invalidation pattern Trees /
// Rocks / EditorProps use.
const PlayRivers = () => {
  const version = useGame((s) => s.ui.treeVersion);
  void version;
  const rivers = useGame.getState().world.rivers;
  return <Rivers rivers={rivers} />;
};
