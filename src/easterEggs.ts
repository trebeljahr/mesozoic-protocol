import type { AchievementId } from "./achievements";
import type { Biome } from "./biomes";

export type EasterEggEffect = {
  particleColor: string;
  particleCount: number;
  particleSpeed?: [number, number];
  particleLife?: number;
  // Secondary burst rendered after the primary (for sparkle/flame layering).
  secondary?: { color: string; count: number; speed?: [number, number]; life?: number };
};

// Moving eggs roll or drive in a straight line across the map. Spawned by
// the engine at a scheduled time rather than pre-placed in createWorld.
export type EasterEggMotion = {
  kind: "traverse";
  speed: number; // world units per second
  lifetime: number; // seconds until auto-despawn
  spinRate?: number; // radians/sec around Y (tumbleweeds spin visually)
};

// Static placement that becomes mobile only after the player triggers it.
// Used by the barrel — it sits in the level until clicked, then topples
// onto its side and rolls in the direction it was facing until off-screen.
// The renderer reads `tumble: true` to tip the barrel onto its side and
// spin it about the cylinder's long axis, which reads as a barrel rolling
// across the ground.
export type EasterEggClickRoll = {
  speed: number;
  lifetime: number;
  spinRate: number;
  tumble?: boolean;
};

// When set, this egg spawns at a random moment during gameplay rather
// than at level start. Paired with motion to produce a moving cameo.
export type EasterEggSchedule = {
  earliestSec: number;
  latestSec: number;
};

// Override how a model renders. Used by dino cameos that reuse the regular
// enemy GLBs but want a ghost-like look or a baby-pink tint.
export type EasterEggVisual = {
  tint?: string; // hex color — multiplied into materials
  opacity?: number; // 0..1 → transparent=true, opacity=value
  clip?: string; // animation clip name; falls back to first clip
  // Animation clip to switch to once the egg has been triggered into
  // motion (egg.vel != null). Used by the buried parasaur to swap from
  // Idle to Run when it claws free and bolts off the map.
  triggeredClip?: string;
  yOffset?: number; // extra world-units on Y (negative = buried)
  skinned?: boolean; // true for animated skinned meshes (dinosaurs)
};

// Per-click visual reaction tuning. The renderer always plays a small
// damped scale-pop on click so the model visibly squashes — these knobs
// adjust intensity or layer extra reactions on top.
export type EasterEggReaction = {
  // Scale-pop amplitude (0..1). 0 disables the squash; 0.25 is a snappy
  // tap; ~0.4 is springy. Defaults to 0.25 when omitted.
  popIntensity?: number;
  // When true, the model briefly arcs to face the camera and returns to
  // its home rotation. Only meaningful for skinned meshes (dinos) — on
  // static props the rotation flick reads as a clipping glitch.
  faceCamera?: boolean;
};

// Position in raw model space (before scale-to-targetSize) where a smoke
// column should rise from once the egg has been clicked. Used by the
// snow-biome cabin so smoke streams out of its chimney rather than puffing
// out around the whole mesh; presence of this field also tells the click
// handler to suppress the default ground-level puff.
export type ChimneyOffset = { x: number; y: number; z: number };

// Position in raw model space where a fire + smoke + ember column should
// burn from once the egg has been lit (clicked). `y` is the raw model
// height of the flame source; `x`/`z` are extra horizontal nudges off the
// model's recentered axis (default 0, since props that carry a flame are
// authored with the head over their vertical centerline). Used by the snow
// torch so its flame sits on the tinder head rather than the whole mesh.
export type FlameOffset = { x?: number; y: number; z?: number };

export type EasterEggDef = {
  id: string;
  achievement: AchievementId;
  biomes: Biome[];
  model: string;
  targetSize: number;
  // Override the auto-derived click sphere radius. Defaults to
  // max(targetSize*0.7, 0.9). Bump for small fast-moving eggs whose
  // model is otherwise hard to hit (tumbleweed sprints across the
  // desert at speed 6).
  hitRadius?: number;
  clickThreshold: number;
  effect: EasterEggEffect;
  motion?: EasterEggMotion;
  scheduled?: EasterEggSchedule;
  visual?: EasterEggVisual;
  clickRoll?: EasterEggClickRoll;
  reaction?: EasterEggReaction;
  chimneyOffset?: ChimneyOffset;
  // When set, a persistent fire + smoke + ember flame ignites on the model
  // (at this raw-model-space height) the first time the egg is clicked.
  flameOffset?: FlameOffset;
  goldReward?: number;
  // Relative pick weight when multiple eggs match a biome. Default 1.
  // Set <1 to make an egg rarer (skull is intentionally rare).
  spawnWeight?: number;
  // Optional sfx override emitted via easter-egg-click. Falls back to the
  // generic egg click sample when omitted.
  sfx?: { sample: string; volume?: number; duration?: number };
};

const puff = (
  color: string,
  count: number,
  speed: [number, number],
  life: number,
): EasterEggEffect => ({
  particleColor: color,
  particleCount: count,
  particleSpeed: speed,
  particleLife: life,
});

const burst = (
  primary: { color: string; count: number; speed: [number, number]; life: number },
  secondary: { color: string; count: number; speed: [number, number]; life: number },
): EasterEggEffect => ({
  particleColor: primary.color,
  particleCount: primary.count,
  particleSpeed: primary.speed,
  particleLife: primary.life,
  secondary,
});

export const EASTER_EGG_DEFS: EasterEggDef[] = [
  {
    id: "skull",
    achievement: "whispering_skull",
    biomes: ["desert", "wasteland"],
    model: "/models/landmarks/wasteland/Skull.glb",
    targetSize: 1.0,
    clickThreshold: 1,
    // Heavy bone-fragment burst — three layers so the click reads as a
    // shatter (white shards + dust + gold reward sparkle).
    effect: burst(
      { color: "#f4ecdc", count: 32, speed: [3.2, 6.4], life: 0.7 },
      { color: "#9a8060", count: 18, speed: [1.6, 3.2], life: 0.55 },
    ),
    goldReward: 20,
    // Springy snap-pop so the skull visibly breaks apart on the click.
    reaction: { popIntensity: 0.6 },
    // Picked far less than its biome-mates so desert maps don't read as
    // a bone yard — skull lands as a rare find, not standard decor.
    spawnWeight: 0.25,
    // Dual-layer crack: impact sample carries the bone-snap, then the
    // generic click sample tags the gold pickup below in the bridge.
    sfx: { sample: "impact", volume: 0.9, duration: 0.9 },
  },
  {
    id: "mushroom",
    achievement: "mushroom_puff",
    biomes: ["forest"],
    model: "/models/landmarks/forest/Mushroom.glb",
    targetSize: 1.0,
    clickThreshold: 1,
    effect: puff("#c8f2a4", 14, [1.5, 3.5], 0.45),
  },
  {
    id: "torch",
    achievement: "torch_lit",
    // Quaternius survival-pack wooden torch: dark-wood handle, grey ferrule,
    // tan tinder head — an unlit firebrand with no baked flame, so the
    // fire/smoke/ember particle column (lit on first click via flameOffset)
    // becomes the actual flame on the tinder head.
    model: "/models/landmarks/snow/Torch.glb",
    biomes: ["snow"],
    targetSize: 1.2,
    clickThreshold: 1,
    effect: burst(
      { color: "#ffb266", count: 18, speed: [2, 4.5], life: 0.55 },
      { color: "#fff2c8", count: 10, speed: [1.5, 3], life: 0.35 },
    ),
    // Torch flares — bigger pop reads as the flame whooshing up.
    reaction: { popIntensity: 0.45 },
    // Tinder head sits near the model top (raw bbox y 1.7–2.1); ignite the
    // flame just inside it.
    flameOffset: { y: 1.85 },
  },
  {
    id: "barrel",
    achievement: "barrel_roll",
    biomes: ["forest"],
    model: "/models/landmarks/forest/Barrel.glb",
    targetSize: 1.0,
    clickThreshold: 1,
    effect: puff("#a07046", 14, [2, 4], 0.5),
    // Click sends the barrel rolling in a random horizontal direction
    // until it leaves the playfield. spinRate is high so the barrel
    // visibly rolls across the ground rather than coasting upright.
    goldReward: 15,
    clickRoll: { speed: 7, lifetime: 4, spinRate: 14, tumble: true },
  },
  {
    id: "cabin",
    achievement: "cabin_smoke",
    biomes: ["snow"],
    // Quaternius medieval-village House_1: stone-and-timber cottage with a
    // visible stone chimney at the back-left of the roof. The earlier
    // kenney/hexagon-kit log cabin sat on a stone-tile hex base that read
    // poorly against the snow ground; this cottage carries its own
    // foundation and reads as a wilderness dwelling.
    //
    // chimneyOffset is the chimney top in raw model space (model bbox is
    // 2.14 × 3.39 × 2.66, so the offset lands on the very top of the
    // back-left stone column). EasterEggs.tsx anchors a particle column
    // there once the egg has been clicked; presence of the field also
    // tells the click handler in store.ts to skip the default
    // around-the-mesh puff in favor of that column.
    model: "/models/landmarks/snow/Cabin.glb",
    targetSize: 2.6,
    clickThreshold: 1,
    effect: puff("#e2e8ee", 20, [1, 2.5], 0.9),
    // Buildings shouldn't squash like rubber — small settle is enough.
    reaction: { popIntensity: 0.08 },
    chimneyOffset: { x: -0.29, y: 3.39, z: -0.86 },
  },
  {
    id: "crystal",
    achievement: "crystal_shatter",
    biomes: ["snow", "wasteland"],
    model: "/models/landmarks/snow/Crystal1.glb",
    targetSize: 1.1,
    clickThreshold: 5,
    effect: burst(
      { color: "#aaf0ff", count: 24, speed: [3, 6], life: 0.7 },
      { color: "#e8faff", count: 14, speed: [1.5, 3.5], life: 0.5 },
    ),
  },
  {
    id: "cactus",
    achievement: "cactus_bloom",
    biomes: ["desert"],
    model: "/models/biomes/desert/Tree5.glb",
    targetSize: 1.5,
    clickThreshold: 1,
    effect: burst(
      { color: "#ff88ba", count: 18, speed: [1.5, 3.5], life: 0.7 },
      { color: "#ffd0e4", count: 10, speed: [1, 2.5], life: 0.5 },
    ),
  },
  {
    id: "glyph",
    achievement: "ancient_glyph",
    biomes: ["desert"],
    model: "/models/scifi/rock_crystalsLargeA.glb",
    targetSize: 1.3,
    clickThreshold: 3,
    effect: burst(
      { color: "#7ff0d0", count: 20, speed: [2, 4.5], life: 0.7 },
      { color: "#aaf0ff", count: 12, speed: [1, 2.5], life: 0.5 },
    ),
  },
  {
    id: "radio",
    achievement: "rusted_radio",
    biomes: ["wasteland"],
    model: "/models/scifi/machine_wirelessCable.glb",
    targetSize: 1.5,
    clickThreshold: 1,
    effect: burst(
      { color: "#9ff08c", count: 16, speed: [2, 4], life: 0.6 },
      { color: "#ff9966", count: 10, speed: [1.5, 3], life: 0.4 },
    ),
  },
  {
    id: "satellite",
    achievement: "satellite_ping",
    biomes: ["desert", "wasteland"],
    model: "/models/scifi/satelliteDish_large.glb",
    targetSize: 1.8,
    clickThreshold: 1,
    effect: burst(
      { color: "#9fd8ff", count: 20, speed: [2.5, 5], life: 0.8 },
      { color: "#e8faff", count: 12, speed: [1.5, 3], life: 0.5 },
    ),
  },
  {
    id: "fairy",
    achievement: "fairy_ring",
    biomes: ["forest"],
    model: "/models/landmarks/forest/BushFlowers.glb",
    targetSize: 1.2,
    clickThreshold: 3,
    effect: burst(
      { color: "#ffd66a", count: 18, speed: [2, 4.5], life: 0.7 },
      { color: "#ff88ba", count: 12, speed: [1.5, 3.5], life: 0.5 },
    ),
  },
  {
    id: "rocket",
    achievement: "rocket_launch",
    biomes: ["desert", "wasteland"],
    model: "/models/scifi/rocket_baseA.glb",
    targetSize: 2.2,
    clickThreshold: 3,
    effect: burst(
      { color: "#ff9966", count: 28, speed: [3, 7], life: 0.9 },
      { color: "#fff2c8", count: 18, speed: [2, 5], life: 0.6 },
    ),
    // Each tap of the rocket gives a vertical kick — bigger pop reads as
    // the booster pulsing before launch.
    reaction: { popIntensity: 0.35 },
  },
  {
    id: "tumbleweed",
    achievement: "tumbleweed",
    biomes: ["desert"],
    model: "/models/biomes/desert/Bush3.glb",
    targetSize: 1.4,
    // Sprints across the desert at speed 6 — generous click sphere
    // keeps it catchable on the first pass.
    hitRadius: 1.8,
    clickThreshold: 1,
    effect: burst(
      { color: "#c8a264", count: 20, speed: [2, 4.5], life: 0.6 },
      { color: "#e8d2a0", count: 12, speed: [1.5, 3], life: 0.4 },
    ),
    motion: { kind: "traverse", speed: 6, lifetime: 13, spinRate: 6 },
    scheduled: { earliestSec: 25, latestSec: 90 },
  },
  {
    id: "rover",
    achievement: "rover_roam",
    biomes: ["wasteland"],
    model: "/models/scifi/rover.glb",
    targetSize: 1.8,
    clickThreshold: 1,
    goldReward: 10,
    effect: burst(
      { color: "#9fd8ff", count: 20, speed: [2, 4.5], life: 0.6 },
      { color: "#a08060", count: 14, speed: [1.5, 3.5], life: 0.55 },
    ),
    motion: { kind: "traverse", speed: 4, lifetime: 20 },
    scheduled: { earliestSec: 30, latestSec: 120 },
  },
  {
    id: "baby_raptor",
    achievement: "baby_raptor",
    biomes: ["forest"],
    model: "/models/Velociraptor.glb",
    targetSize: 0.8,
    clickThreshold: 1,
    effect: burst(
      { color: "#ff88ba", count: 16, speed: [1.5, 3.5], life: 0.5 },
      { color: "#ffd0e4", count: 10, speed: [1, 2.5], life: 0.4 },
    ),
    visual: { tint: "#ffc8dc", skinned: true, clip: "Idle" },
    // Springy startle pop + the raptor briefly turns to look at the camera.
    reaction: { popIntensity: 0.4, faceCamera: true },
  },
  {
    id: "buried_para",
    achievement: "buried_para",
    biomes: ["snow"],
    model: "/models/Parasaurolophus.glb",
    targetSize: 1.6,
    clickThreshold: 5,
    effect: burst(
      { color: "#e8faff", count: 22, speed: [2.5, 5], life: 0.7 },
      { color: "#aaf0ff", count: 14, speed: [1.5, 3.5], life: 0.5 },
    ),
    // Buried under the snow with just the head and dorsal ridge poking
    // out. Five frantic clicks free it; clickRoll then hurls it toward
    // the nearest map edge at full sprint with the Run animation.
    visual: { yOffset: -0.5, skinned: true, clip: "Idle", triggeredClip: "Run" },
    clickRoll: { speed: 14, lifetime: 4, spinRate: 0 },
  },
  {
    id: "snowman",
    achievement: "snowman",
    biomes: ["snow"],
    // The lone snowman. Snow maps no longer scatter these (the decoration
    // layer was pulled from biomes.ts), so this single easter-egg instance
    // is the only snowman in the game — a rare find. Clicking bursts it
    // into a snow puff.
    model: "/models/biomes/snow/SnowmanA.glb",
    targetSize: 1.5,
    clickThreshold: 1,
    goldReward: 10,
    effect: burst(
      { color: "#eaf4ff", count: 24, speed: [2, 4.5], life: 0.7 },
      { color: "#c8e0f4", count: 14, speed: [1.5, 3], life: 0.5 },
    ),
    // Snappy pop so the snowman visibly bursts apart into snow.
    reaction: { popIntensity: 0.45 },
  },
  {
    id: "ghost_trike",
    achievement: "ghost_trike",
    biomes: ["wasteland"],
    model: "/models/Triceratops.glb",
    targetSize: 1.6,
    clickThreshold: 1,
    goldReward: 20,
    effect: burst(
      { color: "#b8e8ff", count: 18, speed: [2, 4.5], life: 0.7 },
      { color: "#7f9fff", count: 12, speed: [1.5, 3.5], life: 0.5 },
    ),
    visual: { opacity: 0.45, tint: "#c8e8ff", skinned: true, clip: "Walk" },
    motion: { kind: "traverse", speed: 2.5, lifetime: 30 },
    scheduled: { earliestSec: 35, latestSec: 130 },
  },
  {
    id: "haunted_ruins",
    achievement: "haunted_ruins",
    biomes: ["wasteland"],
    model: "/models/landmarks/wasteland/Ruins.glb",
    targetSize: 2.2,
    clickThreshold: 3,
    effect: burst(
      { color: "#b48cff", count: 24, speed: [2.5, 5], life: 0.8 },
      { color: "#7f4fff", count: 14, speed: [1.5, 3.5], life: 0.6 },
    ),
  },
];

export const EASTER_EGG_BY_ID: Record<string, EasterEggDef> = Object.fromEntries(
  EASTER_EGG_DEFS.map((d) => [d.id, d]),
);

export const PRELOAD_URLS: string[] = Array.from(new Set(EASTER_EGG_DEFS.map((d) => d.model)));
