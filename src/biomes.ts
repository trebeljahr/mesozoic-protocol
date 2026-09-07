import { PATH_WIDTH } from "./level";

export type Biome = "forest" | "desert" | "snow" | "wasteland" | "lava" | "alien";

/**
 * Map-authoritative biome — purely y-banded so the level IDs align cleanly
 * with a single biome each (five levels per band). Reading bottom→top:
 *   band 1  y ≤ -9  : forest     (L1-L5)
 *   band 2  y ≤ -2  : snow       (L6-L10)
 *   band 3  y ≤  5  : desert     (L11-L15)
 *   band 4  y ≤ 12  : wasteland  (L16-L20)
 *   band 5  y ≤ 19  : lava       (L21-L25)
 *   band 6  y  > 19 : alien      (L26-L30)
 */
export const biomeForPos = ({ y }: { x: number; y: number }): Biome => {
  if (y <= -9) return "forest";
  if (y <= -2) return "snow";
  if (y <= 5) return "desert";
  if (y <= 12) return "wasteland";
  if (y <= 19) return "lava";
  return "alien";
};

export type BiomeLayer = {
  seed: number;
  urls: string[];
  count: number;
  clearance: number;
  minScale: number;
  maxScale: number;
  castShadow: boolean;
  blocks?: boolean;
  // Effective half-radius (world units) used by Ground.tsx for non-blocking
  // layer prop↔prop spacing. Multiplied by per-instance scale at placement
  // time. Defaults are set in Ground.tsx based on the URL pattern, so
  // existing layer defs don't need to be touched.
  footprint?: number;
  // When set, the layer uses clustered placement instead of uniform
  // scatter. Blocking layers become boulder fields or small dead-tree
  // stands; decor layers become tufts and thickets.
  cluster?: { seeds: number; sigma: number };
  // Ground-cover mode — small non-blocking decor (grass tufts, mushrooms,
  // pebbles, flowers) that should spread evenly across the entire map
  // rather than clump into a handful of Worley features. Ground.tsx
  // overrides the layer's feature count + spacing ratio when set so the
  // result reads as a sprinkle, not a few isolated patches. Cross-
  // groundCover-layer overlap uses a smaller slack so dense grass doesn't
  // shut out mushrooms/flowers placed afterward.
  groundCover?: boolean;
  // Optional per-layer colour multiply applied to the instanced material
  // (Ground.tsx clones the cached material first, so other biomes reusing
  // the same GLB are unaffected). Lets a biome reuse a neutral model with a
  // climate wash — e.g. the snowfield tints the grassland grass tufts blue.
  tint?: [number, number, number];
  // Per-variant size normalization, in world units. By default BIOME_LAYERS
  // render at raw GLTF scale, so a layer that bundles several models with
  // different authored max-dims (e.g. snow conifers span 2.7–5.1 units) gets
  // a 2x rendered-size spread from a single minScale/maxScale band. When set,
  // the renderers divide normalizeTo by each model's measured maxDim to get a
  // per-URL base scale, so every variant's largest dimension renders at
  // ~normalizeTo before the band is applied. minScale/maxScale then read as
  // relative multipliers around that target (e.g. 0.85–1.2 for natural
  // variation). Hit-disc + placement radii stay correct because the renderer
  // publishes the normalized radius into meshXZRadii.
  normalizeTo?: number;
};

export type BiomeStyle = {
  groundColor: string;
  pathColor: string;
  sceneBg: string;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  hemiTop: string;
  hemiBottom: string;
  startRing: string;
  endRing: string;
};

// Per-biome painted-look post-processing palette. Consumed by
// src/render/PaintedPostFx.tsx (color grade + god-rays + bloom bias) and
// src/render/AmbientHaze.tsx (dust / ember color + density). All entries are
// optional tuning knobs — the global baseline in effectsTunables.ts decides
// the shape of each pass; this just biases it per environment so a lava run
// reads ember-warm and an alien run reads cool / glowing.
export type BiomePainted = {
  // Multiplied into shadow tones during the color grade (≤1 darkens). Tuned
  // cool teal for forest/snow/alien, warm for desert/wasteland, deep red for
  // lava — pushes the split-tone away from grey toward the biome's mood.
  shadowTint: [number, number, number];
  // Multiplied into highlight tones (≥1 brightens). Warm orange/ember for
  // lava/wasteland; soft cyan-white for snow/alien; warm peach for forest.
  highlightTint: [number, number, number];
  // Ember / dust particle color in the AmbientHaze scene layer.
  dustColor: string;
  // 0..1 scalar on the haze pool. 0 hides the layer entirely (no fog of
  // particulates in clear biomes); 1 fills the budget for that quality tier.
  // Keep this LOW. The haze is scene geometry drifting 0.1–2.3 units above
  // the whole map, so every mote is a mark competing with the path, the
  // build slots, the towers and the enemies — and selective bloom makes the
  // bright-tinted biomes' motes the loudest thing on screen. Anything past
  // ~0.4 stops reading as atmosphere and starts reading as confetti.
  dustDensity: number;
  // Multiplier on the selective-bloom intensity. Volcanic / alien biomes
  // bias up so emissive surfaces (magma rivers, crystal veins) blow brighter
  // than in mundane biomes.
  bloomBias: number;
  // God-rays sun tint. Warm gold for forest/desert/wasteland, ember red for
  // lava, pale cyan for snow, sickly green for alien.
  godRaysColor: string;
};

export const BIOME_PAINTED: Record<Biome, BiomePainted> = {
  forest: {
    shadowTint: [0.82, 0.92, 1.0],
    highlightTint: [1.04, 0.98, 0.88],
    dustColor: "#cae7b5",
    dustDensity: 0.22,
    bloomBias: 0.85,
    godRaysColor: "#ffe2a8",
  },
  desert: {
    shadowTint: [0.92, 0.86, 0.78],
    highlightTint: [1.08, 0.98, 0.82],
    dustColor: "#e8c890",
    dustDensity: 0.3,
    bloomBias: 0.9,
    godRaysColor: "#ffd87a",
  },
  snow: {
    shadowTint: [0.78, 0.9, 1.04],
    highlightTint: [1.0, 1.0, 1.06],
    dustColor: "#dceaff",
    dustDensity: 0.25,
    bloomBias: 0.8,
    godRaysColor: "#cfe6ff",
  },
  wasteland: {
    shadowTint: [0.88, 0.82, 0.8],
    highlightTint: [1.12, 0.96, 0.78],
    dustColor: "#caa078",
    dustDensity: 0.32,
    bloomBias: 1.0,
    godRaysColor: "#ffb070",
  },
  lava: {
    shadowTint: [0.7, 0.55, 0.55],
    highlightTint: [1.2, 0.85, 0.6],
    dustColor: "#ff8a32",
    dustDensity: 0.35,
    bloomBias: 1.35,
    godRaysColor: "#ff9050",
  },
  alien: {
    shadowTint: [0.78, 0.78, 1.0],
    highlightTint: [1.02, 0.95, 1.1],
    dustColor: "#7effe0",
    dustDensity: 0.3,
    bloomBias: 1.2,
    godRaysColor: "#9fffe2",
  },
};

export const BIOME_STYLE: Record<Biome, BiomeStyle> = {
  forest: {
    groundColor: "#5c7848",
    pathColor: "#c9a876",
    sceneBg: "#a7cbe3",
    fogColor: "#c4dcec",
    fogNear: 48,
    fogFar: 110,
    hemiTop: "#bcd8ff",
    hemiBottom: "#5a4a2a",
    startRing: "#4aff88",
    endRing: "#ff4466",
  },
  desert: {
    groundColor: "#cba878",
    pathColor: "#8a6434",
    sceneBg: "#d9c194",
    fogColor: "#e6d0a2",
    fogNear: 48,
    fogFar: 110,
    hemiTop: "#ffe4b0",
    hemiBottom: "#7a5028",
    startRing: "#ffe08a",
    endRing: "#ff5a3a",
  },
  snow: {
    groundColor: "#a0b2c2",
    pathColor: "#6a7a88",
    sceneBg: "#8eaac0",
    fogColor: "#98b0c2",
    fogNear: 38,
    fogFar: 88,
    hemiTop: "#c0d0e0",
    hemiBottom: "#506070",
    startRing: "#a8ffe8",
    endRing: "#ff7a9a",
  },
  wasteland: {
    groundColor: "#7a6148",
    pathColor: "#6b4f36",
    sceneBg: "#caa688",
    fogColor: "#d8bc9a",
    fogNear: 44,
    fogFar: 96,
    hemiTop: "#e8c8a8",
    hemiBottom: "#5a4030",
    startRing: "#ffcf6a",
    endRing: "#ff5252",
  },
  // Scorched volcanic basin — dark cracked ground, dark scorched-stone
  // paths, bright magma reserved for rivers/lakes (FlowFeatures.tsx).
  // Hazy ember-tinted sky, tight fog for oppressive feel.
  lava: {
    groundColor: "#3a1c12",
    pathColor: "#5a3a24",
    sceneBg: "#4a1a18",
    fogColor: "#9a3420",
    fogNear: 36,
    fogFar: 82,
    hemiTop: "#ffb060",
    hemiBottom: "#5a1a10",
    startRing: "#ff9050",
    endRing: "#ffe060",
  },
  // Alien reaches — violet dust plains, cyan crystal veins, greenish haze.
  // Cool-toned and eerie, pushing into out-of-this-world territory.
  alien: {
    groundColor: "#3a2060",
    // Path is the walkable strip — kept a muted violet–stone tone so it reads
    // as ground, not as a neon-cyan ribbon. The "alien-ness" comes from goo
    // rivers/lakes (see flowGeometry generalised for alien biome) and the
    // Ultimate Space Kit vegetation, not from a glowing path.
    pathColor: "#5a4880",
    sceneBg: "#2a1545",
    fogColor: "#5a3a90",
    fogNear: 40,
    fogFar: 90,
    hemiTop: "#b0a0ff",
    hemiBottom: "#2a1550",
    // Subdued rings — same pale violet as the path, just slightly lifted to
    // mark spawn/objective without screaming.
    startRing: "#9a7fff",
    endRing: "#ffb0e8",
  },
};

type BiomeLayerSpec = BiomeLayer[];

const makeBiomeLayers = (spec: BiomeLayerSpec): BiomeLayer[] => spec;

// Path clearance for decorative ground cover (grass, pebbles, shards,
// tufts). Was PATH_WIDTH/2 + 0.2..0.3, which let the sprinkle run right up
// to the road edge — the lane the player actually reads (path silhouette,
// enemies walking it, the first ring of tower slots at ~2.6 from centre)
// was the busiest part of the frame. Pushing decor out to 2.5 from the
// centreline gives the road a clean halo, so path + towers + enemies own
// the eye and scenery stays background texture.
const GROUND_COVER_CLEARANCE = PATH_WIDTH / 2 + 1.1;

const FOREST_LAYERS: BiomeLayerSpec = [
  {
    seed: 1337,
    urls: ["/models/nature/Grass1.glb", "/models/nature/Grass2.glb", "/models/nature/Grass3.glb"],
    // Ground-cover mode — Ground.tsx tiles the map with many small Worley
    // features and a tight rMin/rMax ratio so grass reads as a near-
    // uniform sprinkle across the whole field, only thinning around path
    // clearance + blockers. Count is deliberately below "carpet" density:
    // the field should read as textured ground the eye skims over, not as
    // a mass of individual marks competing with towers and enemies.
    count: 130,
    clearance: GROUND_COVER_CLEARANCE,
    minScale: 0.5,
    maxScale: 0.9,
    castShadow: false,
    footprint: 0.26,
    groundCover: true,
  },
  {
    seed: 9001,
    urls: ["/models/nature/Bush1.glb", "/models/nature/Bush2.glb", "/models/nature/Bush3.glb"],
    // These read as build-slot blockers from above, so route them through
    // the clear/remove flow instead of leaving them as untouchable decor.
    // Bushes are a *blocking obstacle* in every biome that has them (forest,
    // desert, wasteland, alien); only small ground tufts stay decorative.
    // normalizeTo pins the 1.0–1.5-unit variants to a uniform shrub size.
    count: 8,
    clearance: PATH_WIDTH / 2 + 0.7,
    normalizeTo: 0.9,
    minScale: 0.7,
    maxScale: 1.05,
    castShadow: true,
    blocks: true,
    footprint: 0.52,
    cluster: { seeds: 5, sigma: 1.7 },
  },
  {
    seed: 4242,
    urls: ["/models/nature/Rock1.glb", "/models/nature/Rock2.glb", "/models/nature/Rock3.glb"],
    count: 16,
    clearance: PATH_WIDTH / 2 + 0.9,
    minScale: 0.55,
    maxScale: 1.2,
    castShadow: true,
    blocks: true,
    cluster: { seeds: 4, sigma: 2.1 },
  },
  {
    seed: 6464,
    // Mushroom.glb authored 0.78 max-dim; 0.65–1.25 → ~0.5–1.0 world units.
    urls: ["/models/landmarks/forest/Mushroom.glb"],
    count: 12,
    clearance: GROUND_COVER_CLEARANCE,
    minScale: 0.55,
    maxScale: 1.1,
    castShadow: true,
    footprint: 0.36,
    groundCover: true,
  },
  {
    seed: 7373,
    // BushFlowers authored 1.97 max-dim → scale 0.18–0.32 lands ~0.35–0.63
    // world units. Previously routed through BIOME_COSMETICS at a fixed 8/
    // level via a single Worley field; promoted to a ground-cover layer so
    // it spreads evenly across the forest floor instead of clumping into
    // three pockets.
    urls: ["/models/landmarks/forest/BushFlowers.glb"],
    count: 16,
    clearance: GROUND_COVER_CLEARANCE,
    minScale: 0.18,
    maxScale: 0.32,
    castShadow: false,
    footprint: 0.28,
    groundCover: true,
  },
];

// Dead-tree props read as "tree-sized" silhouettes; promoted from cosmetic
// to a blocking layer so the player can clear them and they don't sit in
// build slots permanently. Scale overrides exist because the desert
// DeadTree.glb is authored at ~16 units tall — 5–7x larger than other tree
// models. Defaults are tuned so the rendered size lands around 2–3.5 world
// units; callers can override for biomes that want them smaller.
const DEAD_TREE_LAYER = (
  url: string,
  count: number,
  seed: number,
  minScale = 0.12,
  maxScale = 0.21,
): BiomeLayer => ({
  seed,
  urls: [url],
  count,
  clearance: PATH_WIDTH / 2 + 1.3,
  minScale,
  maxScale,
  castShadow: true,
  blocks: true,
  footprint: 0.85,
});

const DESERT_LAYERS: BiomeLayerSpec = [
  {
    // Desert shrubs — blocking obstacle (cleared via the remove flow), same
    // role as the forest/alien bushes. Were decorative before, but the 0.9–
    // 1.9-unit variants read as build-slot blockers, not auto-cull ground
    // cover. normalizeTo unifies their size; count trimmed since blockers eat
    // build space (the loose pebble layer below carries ground detail).
    seed: 9001,
    urls: [
      "/models/biomes/desert/Bush1.glb",
      "/models/biomes/desert/Bush2.glb",
      "/models/biomes/desert/Bush3.glb",
    ],
    count: 10,
    clearance: PATH_WIDTH / 2 + 0.7,
    normalizeTo: 0.95,
    minScale: 0.75,
    maxScale: 1.1,
    castShadow: true,
    blocks: true,
    footprint: 0.45,
    cluster: { seeds: 4, sigma: 1.8 },
  },
  {
    seed: 4242,
    urls: [
      "/models/biomes/desert/Rock1.glb",
      "/models/biomes/desert/Rock2.glb",
      "/models/biomes/desert/Rock3.glb",
    ],
    count: 18,
    clearance: PATH_WIDTH / 2 + 0.9,
    minScale: 0.55,
    maxScale: 1.3,
    castShadow: true,
    blocks: true,
    cluster: { seeds: 4, sigma: 2.2 },
  },
  DEAD_TREE_LAYER("/models/landmarks/desert/DeadTree.glb", 3, 5151, 0.135, 0.225),
  {
    // Loose pebbles — tiny gritty stones dusting the sand so the dunes
    // read as weathered instead of empty. Authored small so they sit
    // under foot like real desert pavement, and sparse enough that the
    // path and tower slots stay the loudest things on screen.
    // Non-blocking; tower placement auto-culls.
    // Replaces the previous dwarf-scrub layer (small desert bushes) —
    // those bush meshes read as tiny cacti and were too small to be
    // clearable, so they got mistaken for stuck obstacles.
    seed: 5959,
    urls: [
      "/models/biomes/desert/Rock1.glb",
      "/models/biomes/desert/Rock2.glb",
      "/models/biomes/desert/Rock3.glb",
    ],
    count: 140,
    clearance: GROUND_COVER_CLEARANCE,
    minScale: 0.08,
    maxScale: 0.15,
    castShadow: false,
    footprint: 0.12,
    groundCover: true,
  },
];

const SNOW_LAYERS: BiomeLayerSpec = [
  {
    seed: 4242,
    // Rock2 + Rock3 pulled — both render as hollow/shelf half-domes you can
    // see into, which reads as a broken mesh (open interior). Rock1 is the
    // solid variant that stays.
    urls: ["/models/biomes/snow/Rock1.glb"],
    count: 8,
    clearance: PATH_WIDTH / 2 + 0.9,
    minScale: 0.7,
    maxScale: 1.4,
    castShadow: true,
    blocks: true,
    cluster: { seeds: 4, sigma: 2.0 },
  },
  // Background scenery — non-blocking, non-removable decoration. Listed
  // before the dense ground-cover so the sparse, larger props claim their
  // spots first and the grass/brush carpet fills in around them.
  //
  // Snowmen are no longer scattered here — a single one now appears as a
  // hidden easter egg (EASTER_EGG_DEFS "snowman" in easterEggs.ts) so it
  // reads as a rare find rather than set-dressing.
  {
    // Snow conifers — birch + pine snow variants. These read as tree-sized
    // silhouettes, so they're a *blocking* obstacle layer (clearable via the
    // remove flow) rather than untouchable decor that sits in build slots
    // permanently — same treatment as DEAD_TREE_LAYER. Authored max-dims span
    // 2.7–5.1 units across the 10 variants, so normalizeTo pins every one to a
    // consistent ~2.2-unit young-tree size; the relative band adds variation.
    // Kept a touch smaller than the clearable obstacle trees (BIOME_TREE_URLS).
    seed: 8181,
    urls: [
      "/models/biomes/snow/PineTreeSnow1.glb",
      "/models/biomes/snow/PineTreeSnow2.glb",
      "/models/biomes/snow/PineTreeSnow3.glb",
      "/models/biomes/snow/PineTreeSnow4.glb",
      "/models/biomes/snow/PineTreeSnow5.glb",
      "/models/biomes/snow/BirchTreeSnow1.glb",
      "/models/biomes/snow/BirchTreeSnow2.glb",
      "/models/biomes/snow/BirchTreeSnow3.glb",
      "/models/biomes/snow/BirchTreeSnow4.glb",
      "/models/biomes/snow/BirchTreeSnow5.glb",
    ],
    count: 12,
    clearance: PATH_WIDTH / 2 + 1.0,
    normalizeTo: 2.2,
    minScale: 0.85,
    maxScale: 1.2,
    castShadow: true,
    blocks: true,
    footprint: 0.6,
    cluster: { seeds: 4, sigma: 2.0 },
  },
  {
    // Fallen snow-dusted log — sparse ground feature.
    seed: 2626,
    urls: ["/models/biomes/snow/WoodlogSnow.glb"],
    count: 5,
    clearance: PATH_WIDTH / 2 + 0.5,
    minScale: 0.3,
    maxScale: 0.45,
    castShadow: true,
    footprint: 0.55,
  },
  {
    // Surface rocks — the full snow rock set scattered as non-interactive
    // ground stones (smaller than the clearable blocker boulders, larger than
    // the ice-shard pebbles below). The 7 variants span 0.7–1.25 authored
    // units, so normalizeTo pins them to a consistent stone size before the
    // band adds spread. Kept sparse and clearly under blocker size: at the
    // old count/scale these read as removable boulders the player couldn't
    // click, and three grey rock layers on grey ground turned the
    // snowfield into visual static.
    seed: 4848,
    urls: [
      "/models/biomes/snow/RockSnow1.glb",
      "/models/biomes/snow/RockSnow2.glb",
      "/models/biomes/snow/RockSnow3.glb",
      "/models/biomes/snow/RockSnow4.glb",
      "/models/biomes/snow/RockSnow5.glb",
      "/models/biomes/snow/RockSnow6.glb",
      "/models/biomes/snow/RockSnow7.glb",
    ],
    count: 14,
    clearance: PATH_WIDTH / 2 + 1.2,
    normalizeTo: 0.6,
    minScale: 0.55,
    maxScale: 0.9,
    castShadow: true,
    footprint: 0.4,
  },
  {
    // Blue crystals — the alien-biome crystal pack making a sparse early
    // cameo here, foreshadowing the later biomes. Very sparingly. The two
    // variants are authored at 5.26/6.87 units, so normalizeTo pins both to a
    // consistent ~0.5-unit shard instead of the raw-scale 0.3–0.65 spread.
    seed: 7878,
    urls: ["/models/biomes/alien/Crystal_Small_1.glb", "/models/biomes/alien/Crystal_Small_2.glb"],
    count: 4,
    clearance: PATH_WIDTH / 2 + 1.1,
    normalizeTo: 0.5,
    minScale: 0.7,
    maxScale: 1.1,
    castShadow: false,
    footprint: 0.22,
  },
  {
    // Snow-scrub patches — biome Bush meshes downscaled into low tufts so
    // the snowfield reads as windswept brush instead of bare. Non-blocking
    // ground-cover.
    seed: 3131,
    urls: ["/models/biomes/snow/Bush1.glb", "/models/biomes/snow/Bush2.glb"],
    count: 55,
    clearance: GROUND_COVER_CLEARANCE,
    minScale: 0.18,
    maxScale: 0.28,
    castShadow: false,
    footprint: 0.22,
    groundCover: true,
  },
  {
    // Ice shards — snow Rock1 at miniature scale dotted across the flats
    // as frosted pebbles. Same model as the chunky blocker layer so the
    // material reads as a family; size differential keeps the role clear.
    seed: 5959,
    urls: ["/models/biomes/snow/Rock1.glb"],
    count: 30,
    clearance: GROUND_COVER_CLEARANCE,
    minScale: 0.13,
    maxScale: 0.22,
    castShadow: false,
    footprint: 0.18,
    groundCover: true,
  },
  {
    // Frosted grass tufts — the grassland grass models reused with a cool
    // blue colour multiply (see BiomeLayer.tint) so the snowfield keeps the
    // soft sprinkle of the forest floor, tinted for the climate.
    seed: 1717,
    urls: ["/models/nature/Grass1.glb", "/models/nature/Grass2.glb", "/models/nature/Grass3.glb"],
    count: 70,
    clearance: GROUND_COVER_CLEARANCE,
    minScale: 0.5,
    maxScale: 0.9,
    castShadow: false,
    footprint: 0.26,
    groundCover: true,
    tint: [0.7, 0.85, 1.0],
  },
];

const WASTELAND_LAYERS: BiomeLayerSpec = [
  {
    // Charred remnant shrubs — blocking obstacle, matching forest/desert/alien
    // bushes. Reuses the desert bush meshes; the muted silhouette reads in
    // wasteland's brown ground. normalizeTo keeps a uniform shrub size (these
    // rendered up to ~2 units before, larger than any other biome's bushes).
    // The scrub-tuft groundcover layer below stays decorative.
    seed: 9001,
    urls: [
      "/models/biomes/desert/Bush1.glb",
      "/models/biomes/desert/Bush2.glb",
      "/models/biomes/desert/Bush3.glb",
    ],
    count: 9,
    clearance: PATH_WIDTH / 2 + 0.7,
    normalizeTo: 1.1,
    minScale: 0.72,
    maxScale: 1.05,
    castShadow: true,
    blocks: true,
    footprint: 0.5,
    cluster: { seeds: 3, sigma: 1.9 },
  },
  {
    seed: 4242,
    urls: [
      "/models/biomes/wasteland/Rock1.glb",
      "/models/biomes/wasteland/Rock2.glb",
      "/models/biomes/wasteland/Rock3.glb",
      "/models/biomes/wasteland/Rock4.glb",
      "/models/biomes/wasteland/Rock5.glb",
    ],
    count: 20,
    clearance: PATH_WIDTH / 2 + 0.8,
    minScale: 0.55,
    maxScale: 1.4,
    castShadow: true,
    blocks: true,
    cluster: { seeds: 5, sigma: 2.2 },
  },
  DEAD_TREE_LAYER("/models/landmarks/wasteland/DeadTree.glb", 3, 5151, 0.18, 0.315),
  {
    // Loose rubble — wasteland Rocks downscaled to pebble-grade clutter so
    // the cracked ground between the larger formations reads as littered
    // with debris instead of barren. Non-blocking.
    seed: 3131,
    urls: [
      "/models/biomes/wasteland/Rock1.glb",
      "/models/biomes/wasteland/Rock2.glb",
      "/models/biomes/wasteland/Rock3.glb",
      "/models/biomes/wasteland/Rock4.glb",
      "/models/biomes/wasteland/Rock5.glb",
    ],
    count: 80,
    clearance: GROUND_COVER_CLEARANCE,
    minScale: 0.13,
    maxScale: 0.23,
    castShadow: false,
    footprint: 0.18,
    groundCover: true,
  },
  {
    // Scrub tufts — desert bush mesh repurposed as charred remnant brush;
    // the muted silhouette reads correctly in wasteland's brown ground.
    seed: 5959,
    urls: ["/models/biomes/desert/Bush1.glb", "/models/biomes/desert/Bush2.glb"],
    count: 45,
    clearance: GROUND_COVER_CLEARANCE,
    minScale: 0.15,
    maxScale: 0.24,
    castShadow: false,
    footprint: 0.18,
    groundCover: true,
  },
];

const BLUE_CRYSTAL_BLOCKER_URLS = [
  "/models/biomes/alien/Crystal_Large_1.glb",
  "/models/biomes/alien/Crystal_Large_2.glb",
  "/models/biomes/alien/Crystal_Medium_1.glb",
  "/models/biomes/alien/Crystal_Medium_2.glb",
];

// Lava reuses the wasteland rock set (dark scorched stone), arranged as
// readable volcanic boulder fields rather than full-map rubble. Adds the
// same blue-crystal pack used by alien so every clearable obstacle has a
// readable silhouette without falling back to the sci-fi rock/crystal hybrid.
const LAVA_LAYERS: BiomeLayerSpec = [
  {
    seed: 4242,
    urls: [
      "/models/biomes/wasteland/Rock1.glb",
      "/models/biomes/wasteland/Rock2.glb",
      "/models/biomes/wasteland/Rock3.glb",
      "/models/biomes/wasteland/Rock4.glb",
      "/models/biomes/wasteland/Rock5.glb",
    ],
    count: 14,
    clearance: PATH_WIDTH / 2 + 0.8,
    minScale: 0.6,
    maxScale: 1.55,
    castShadow: true,
    blocks: true,
    cluster: { seeds: 5, sigma: 2.1 },
  },
  {
    seed: 7878,
    urls: BLUE_CRYSTAL_BLOCKER_URLS,
    count: 6,
    clearance: PATH_WIDTH / 2 + 0.8,
    minScale: 0.11,
    maxScale: 0.18,
    castShadow: true,
    blocks: true,
    footprint: 0.82,
    cluster: { seeds: 3, sigma: 1.5 },
  },
  DEAD_TREE_LAYER("/models/landmarks/wasteland/DeadTree.glb", 3, 5151),
  {
    // Ember chunks — wasteland Rocks at miniature scale read as cooled
    // basalt shards scattered across the scorched basin. Non-blocking so
    // they sprinkle around lava rivers without gating build slots. Sparse:
    // on the near-black basin every chunk is a high-contrast mark.
    seed: 3131,
    urls: [
      "/models/biomes/wasteland/Rock1.glb",
      "/models/biomes/wasteland/Rock2.glb",
      "/models/biomes/wasteland/Rock3.glb",
      "/models/biomes/wasteland/Rock4.glb",
      "/models/biomes/wasteland/Rock5.glb",
    ],
    count: 70,
    clearance: GROUND_COVER_CLEARANCE,
    minScale: 0.12,
    maxScale: 0.2,
    castShadow: false,
    footprint: 0.18,
    groundCover: true,
  },
  {
    // Crystal shards — the same small alien-pack crystals used in the
    // alien biome's ground cover; here they read as cooled glass slivers
    // ejected from the lava flows. Tiny, non-blocking, and much sparser
    // than the rubble layer: saturated blue is the loudest hue in a biome
    // built from browns and ember orange, so at any real density it reads
    // as scattered pickups rather than ground texture.
    seed: 5959,
    urls: ["/models/biomes/alien/Crystal_Small_1.glb", "/models/biomes/alien/Crystal_Small_2.glb"],
    count: 18,
    clearance: GROUND_COVER_CLEARANCE,
    minScale: 0.04,
    maxScale: 0.07,
    castShadow: false,
    footprint: 0.22,
    groundCover: true,
  },
];

// Alien uses Quaternius Crystal Pack blue crystals as the signature
// blocking element. Large + medium variants give readable silhouettes;
// small shards are promoted to a blocking layer so they're removable
// instead of non-interactive scenery. Bush/Plant layer is also blocking:
// previously they sat as 1–4 world-unit "ground cover" the player tried
// to click and couldn't — now they read as the obstacles they look like.
const ALIEN_LAYERS: BiomeLayerSpec = [
  {
    seed: 9001,
    urls: [
      "/models/biomes/alien/Bush_1.gltf",
      "/models/biomes/alien/Bush_2.gltf",
      "/models/biomes/alien/Bush_3.gltf",
      "/models/biomes/alien/Plant_1.gltf",
      "/models/biomes/alien/Plant_2.gltf",
      "/models/biomes/alien/Plant_3.gltf",
    ],
    // Authored 1.82–3.26 max-dim; 0.43–0.52 lands ~0.8–1.7 world units
    // (rock-sized) across the variants. Tight band — no mini variants —
    // so every plant reads uniformly as a big removable obstacle.
    count: 12,
    clearance: PATH_WIDTH / 2 + 0.8,
    minScale: 0.43,
    maxScale: 0.52,
    castShadow: true,
    blocks: true,
    footprint: 0.58,
    cluster: { seeds: 4, sigma: 1.7 },
  },
  {
    seed: 4242,
    urls: [
      "/models/biomes/wasteland/Rock1.glb",
      "/models/biomes/wasteland/Rock3.glb",
      "/models/biomes/wasteland/Rock5.glb",
    ],
    count: 22,
    clearance: PATH_WIDTH / 2 + 0.9,
    // Tight high band — no mini rocks; every boulder reads as a big obstacle.
    minScale: 1.1,
    maxScale: 1.35,
    castShadow: true,
    blocks: true,
    footprint: 0.72,
    cluster: { seeds: 4, sigma: 2.0 },
  },
  {
    seed: 7878,
    urls: BLUE_CRYSTAL_BLOCKER_URLS,
    count: 10,
    clearance: PATH_WIDTH / 2 + 0.8,
    // Tight high band — no mini crystals; uniform big-obstacle silhouette.
    minScale: 0.15,
    maxScale: 0.18,
    castShadow: true,
    blocks: true,
    footprint: 0.82,
    cluster: { seeds: 4, sigma: 1.6 },
  },
  {
    seed: 3434,
    urls: ["/models/biomes/alien/Crystal_Small_1.glb", "/models/biomes/alien/Crystal_Small_2.glb"],
    // Authored 5.26 and 6.87 max-dim; 0.13–0.16 lands ~0.7–1.1 world units.
    // Tight high band so these shards read as big obstacles too — no mini
    // variants — and get the same remove-flow as everything else.
    count: 3,
    clearance: PATH_WIDTH / 2 + 0.6,
    minScale: 0.13,
    maxScale: 0.16,
    castShadow: true,
    blocks: true,
    footprint: 0.52,
    cluster: { seeds: 4, sigma: 2.4 },
  },
  {
    seed: 6161,
    urls: ["/models/scifi/hangar_smallB.glb", "/models/scifi/structure_closed.glb"],
    count: 1,
    clearance: PATH_WIDTH / 2 + 2.5,
    minScale: 0.6,
    maxScale: 0.85,
    castShadow: true,
    blocks: true,
    footprint: 1.45,
  },
  DEAD_TREE_LAYER("/models/biomes/alien/Tree_Light_1.gltf", 3, 5151, 0.7, 0.85),
  {
    // Crystal dust — small alien-pack shards at miniature scale dotted
    // across the violet plains as luminous grit. Non-blocking; the same
    // mesh family as the chunky blocker crystals so the material reads
    // consistently while size differential separates the role. Kept very
    // sparse — cyan on violet is this biome's highest-contrast pairing,
    // so a dense sprinkle buries the path and the build slots under
    // glowing speckle.
    seed: 3131,
    urls: ["/models/biomes/alien/Crystal_Small_1.glb", "/models/biomes/alien/Crystal_Small_2.glb"],
    count: 40,
    clearance: GROUND_COVER_CLEARANCE,
    minScale: 0.035,
    maxScale: 0.065,
    castShadow: false,
    footprint: 0.2,
    groundCover: true,
  },
  {
    // Spore tufts — alien plants downscaled into low ground sprigs so the
    // bare violet ground reads as carpeted with strange flora. Tiny scale
    // keeps them readable as ground decor rather than a second blocker
    // layer.
    seed: 5959,
    urls: [
      "/models/biomes/alien/Plant_1.gltf",
      "/models/biomes/alien/Plant_2.gltf",
      "/models/biomes/alien/Plant_3.gltf",
    ],
    count: 50,
    clearance: GROUND_COVER_CLEARANCE,
    minScale: 0.08,
    maxScale: 0.15,
    castShadow: false,
    footprint: 0.2,
    groundCover: true,
  },
];

const BIOME_LAYER_SPECS: Record<Biome, BiomeLayerSpec> = {
  forest: FOREST_LAYERS,
  desert: DESERT_LAYERS,
  snow: SNOW_LAYERS,
  wasteland: WASTELAND_LAYERS,
  lava: LAVA_LAYERS,
  alien: ALIEN_LAYERS,
};

export const BIOME_LAYERS: Record<Biome, BiomeLayer[]> = {
  forest: makeBiomeLayers(BIOME_LAYER_SPECS.forest),
  desert: makeBiomeLayers(BIOME_LAYER_SPECS.desert),
  snow: makeBiomeLayers(BIOME_LAYER_SPECS.snow),
  wasteland: makeBiomeLayers(BIOME_LAYER_SPECS.wasteland),
  lava: makeBiomeLayers(BIOME_LAYER_SPECS.lava),
  alien: makeBiomeLayers(BIOME_LAYER_SPECS.alien),
};

// Clearable trees per biome (exactly 4 variants for compatibility with Tree.variant 0..3).
export const BIOME_TREE_URLS: Record<Biome, string[]> = {
  forest: [
    "/models/nature/Tree1.glb",
    "/models/nature/Tree2.glb",
    // Tree3 was the 'shiny cluster of polyhedra' variant that reads as
    // broken — swapped for another Tree1 so the slot still has 4 entries.
    "/models/nature/Tree1.glb",
    "/models/nature/Tree4.glb",
  ],
  desert: [
    "/models/biomes/desert/Tree1.glb",
    "/models/biomes/desert/Tree2.glb",
    "/models/biomes/desert/Tree3.glb",
    "/models/biomes/desert/Tree4.glb",
  ],
  snow: [
    "/models/biomes/snow/Tree1.glb",
    "/models/biomes/snow/Tree2.glb",
    // Tree3 pulled — it renders with a shiny material and holes punched
    // through the trunk; swapped the slot for Tree5 which is a clean
    // snow-capped pine.
    "/models/biomes/snow/Tree5.glb",
    "/models/biomes/snow/Tree4.glb",
  ],
  wasteland: [
    "/models/biomes/wasteland/Tree1.glb",
    "/models/biomes/wasteland/Tree2.glb",
    "/models/biomes/wasteland/Tree3.glb",
    "/models/biomes/wasteland/Tree4.glb",
  ],
  // Lava and alien both reuse the wasteland dead-tree set — no real
  // vegetation survives either environment, and the skeletal silhouettes
  // read correctly for volcanic ash fields and alien mesa.
  lava: [
    "/models/biomes/wasteland/Tree1.glb",
    "/models/biomes/wasteland/Tree2.glb",
    "/models/biomes/wasteland/Tree3.glb",
    "/models/biomes/wasteland/Tree4.glb",
  ],
  // Quaternius Ultimate Space Kit — actual alien vegetation, not the
  // wasteland skeletons we used as a stand-in. Picked four shapes that read
  // as silhouettes from above (Spikes, Swirl, Blob, Spiral).
  alien: [
    "/models/biomes/alien/Tree_Spikes_1.gltf",
    "/models/biomes/alien/Tree_Swirl_1.gltf",
    "/models/biomes/alien/Tree_Blob_1.gltf",
    "/models/biomes/alien/Tree_Spiral_1.gltf",
  ],
};

// Per-biome size nudge applied to clearable trees at world build time, on top
// of the per-instance variety. Trees.tsx now height-normalises every variant
// to TREE_TARGET_HEIGHT, so this no longer has to paper over packs that export
// small/large — it is purely an intentional "this biome's trees run a touch
// taller/shorter" knob. All 1.0 = every biome shares the same height band
// (wasteland used to bump 1.5x only to compensate the tiny native GLBs).
export const BIOME_TREE_SCALE_MUL: Record<Biome, number> = {
  forest: 1,
  desert: 1,
  snow: 1,
  wasteland: 1,
  lava: 1,
  alien: 1,
};

// Per-biome clearable-tree scale range override. Unlisted biomes use the
// global TREE_MIN_SCALE..TREE_MAX_SCALE spread (saplings → elders). Alien
// obstacles must all read as the same "big obstacle" with no mini variants
// (playtest note), so its clearable trees clamp to a tight high band.
export const BIOME_TREE_SCALE_RANGE: Partial<Record<Biome, { min: number; max: number }>> = {
  alien: { min: 0.9, max: 1.1 },
};

// Small cosmetic props scattered across levels via BiomeCosmetics.tsx. All
// biomes are now empty: forest's BushFlowers moved to BIOME_LAYERS as a
// ground-cover layer so it spreads evenly with the same Worley+Poisson
// pipeline as grass and mushrooms instead of clumping into the cosmetics
// pass's 8-per-level Worley pockets. The slot is kept so future
// per-biome cosmetic decals can plug in without resurrecting the type.
export const BIOME_COSMETICS: Record<Biome, string[]> = {
  forest: [],
  desert: [],
  snow: [],
  wasteland: [],
  lava: [],
  alien: [],
};

// Small environmental-story props. These are render-only details placed
// near paths/HQ pads (and sparsely on the world map) so they read as
// abandoned field work, broken equipment, or warning traces instead of
// build-slot blockers.
export const BIOME_STORY_PROPS: Record<Biome, string[]> = {
  forest: [
    "/models/landmarks/desert/Tent.glb",
    "/models/landmarks/forest/Barrel.glb",
    "/models/scifi/machine_barrel.glb",
    "/models/scifi/rover.glb",
  ],
  desert: [
    "/models/landmarks/desert/Tent.glb",
    "/models/landmarks/desert/Chest.glb",
    "/models/scifi/rover.glb",
    "/models/scifi/barrels.glb",
  ],
  snow: [
    "/models/landmarks/snow/Tent.glb",
    "/models/landmarks/snow/Torch.glb",
    "/models/scifi/machine_generator.glb",
    "/models/scifi/satelliteDish.glb",
  ],
  wasteland: [
    "/models/scifi/machine_barrelLarge.glb",
    "/models/scifi/meteor_detailed.glb",
    "/models/scifi/barrels.glb",
  ],
  lava: [
    "/models/scifi/meteor_detailed.glb",
    "/models/scifi/machine_generatorLarge.glb",
    "/models/scifi/barrels.glb",
    "/models/scifi/satelliteDish.glb",
  ],
  alien: [
    "/models/scifi/machine_wirelessCable.glb",
    "/models/scifi/rock_crystalsLargeA.glb",
    "/models/biomes/alien/Crystal_Small_1.glb",
    "/models/biomes/alien/Crystal_Small_2.glb",
  ],
};

// Visual-role classification + target sizes so props on the world map (and
// in levels) read with a sensible hierarchy:
//   buildings > trees > bushes ≈ rocks > cosmetics ≈ grass
// Each GLB gets normalized to `maxDim == TARGET_SIZE_BY_ROLE[role]` regardless
// of the authored mesh scale, so packs with inconsistent exports still line up.
export type PropRole = "building" | "tree" | "bush" | "rock" | "grass" | "cosmetic";

// Target visual max-dim (in world units) per role. Gaps are wide so the
// hierarchy reads from any camera distance: buildings and trees are
// roughly siblings (buildings slightly taller), rocks are ~1/3 of a tree,
// cosmetics are quiet dressing half the size of a rock.
export const TARGET_SIZE_BY_ROLE: Record<PropRole, number> = {
  building: 2.8,
  tree: 2.4,
  bush: 0.85,
  rock: 0.7,
  grass: 0.4,
  cosmetic: 0.5,
};

export const classifyPropUrl = (url: string): PropRole => {
  const f = url.toLowerCase();
  // Large sci-fi structures sit in the building slot so they anchor
  // bases the way houses/cabins anchor nature biomes. Modular pieces
  // (platforms, chimneys, crashed craft) also classify as buildings so
  // they render at the same robot scale next to a hangar/structure
  // rather than shrinking to cosmetic size.
  if (
    /hangar_|rocket_|structure_|gate_|platform_|chimney_|craft_|satellitedish_(?:large|detailed)/.test(
      f,
    )
  )
    return "building";
  if (/house|cabin|sawmill|tent|ruins|tower_/.test(f)) return "building";
  if (/tree|deadtree/.test(f)) return "tree";
  if (/bushflowers/.test(f)) return "cosmetic";
  if (/bush/.test(f)) return "bush";
  if (/grass/.test(f)) return "grass";
  if (/barrel|machine_|generator|wireless|rover|satellitedish|chest|skull|torch/.test(f))
    return "rock";
  // Meteors read as rocks — similar role in a scene.
  if (/rock|meteor/.test(f)) return "rock";
  if (/crystal_(?:large|medium)/.test(f)) return "rock";
  return "cosmetic";
};

// Fraction of a prop's half-extent that actually meets the floor. A tree is
// mostly crown — its trunk touches the ground over a tiny disc — while a
// house or boulder sits on roughly its whole silhouette. Used by the editor
// so "placing a model clears what's underneath it" means the ground contact
// patch, not the canopy and not the (much wider) selection circle.
export const GROUND_FOOTPRINT_RATIO_BY_ROLE: Record<PropRole, number> = {
  building: 0.8,
  tree: 0.18,
  bush: 0.45,
  rock: 0.75,
  grass: 0.5,
  cosmetic: 0.5,
};

// Ground-contact half-radius of a prop in world units: the silhouette
// half-extent scaled down to whatever part of it rests on the floor.
export const propGroundRadius = (url: string, scale: number): number => {
  const role = classifyPropUrl(url);
  return TARGET_SIZE_BY_ROLE[role] * scale * 0.5 * GROUND_FOOTPRINT_RATIO_BY_ROLE[role];
};

// Roles small and flat enough to be bulldozed implicitly when another prop
// lands on top of them: ground foliage and low set-dressing. Anything with
// real presence — buildings, trees, rocks, bushes — survives and has to be
// deleted deliberately, otherwise placing one tree eats its neighbours.
const CLEARED_ON_PLACE_ROLES: ReadonlySet<PropRole> = new Set<PropRole>(["grass", "cosmetic"]);

export const isClearedOnPlace = (url: string): boolean =>
  CLEARED_ON_PLACE_ROLES.has(classifyPropUrl(url));

export const ALL_BIOME_URLS = [
  ...Object.values(BIOME_LAYERS).flatMap((ls) => ls.flatMap((l) => l.urls)),
  ...Object.values(BIOME_TREE_URLS).flat(),
  ...Object.values(BIOME_COSMETICS).flat(),
  ...Object.values(BIOME_STORY_PROPS).flat(),
];

// All asset URLs that belong to a single biome — layers + trees + cosmetics +
// story props. Used by the dev editor to filter its asset palette + brush
// presets down to a single biome's roster so the user isn't scrolling past
// 5 biomes worth of irrelevant trees while authoring a forest level.
export const biomeAssetUrls = (biome: Biome): string[] => {
  const urls = new Set<string>();
  for (const layer of BIOME_LAYERS[biome]) for (const u of layer.urls) urls.add(u);
  for (const u of BIOME_TREE_URLS[biome]) urls.add(u);
  for (const u of BIOME_COSMETICS[biome]) urls.add(u);
  for (const u of BIOME_STORY_PROPS[biome]) urls.add(u);
  return Array.from(urls);
};
