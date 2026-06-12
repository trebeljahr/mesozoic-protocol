import type { LevelMode } from "../progress";
import type {
  BossTrickleStream,
  BossVariant,
  DamageType,
  EnemyKind,
  EnemySpec,
  TowerKind,
  Vec2,
  WaveArchetype,
  WaveSpec,
} from "../sim/types";

// Per-mode override block. Breach + containment each get their own
// handcrafted wave script and starting gold, plus rule flags that the sim
// consumes at world creation. Normal mode reuses the top-level level fields.
export type ModeConfig = {
  startGold: number;
  waves: WaveSpec[];
  // Breach mode: tower kinds the player may not place this level. UI
  // hides them from the picker; runtime placement double-checks.
  forbiddenTowers?: TowerKind[];
  // Containment mode: only these tower kinds may be placed (everything
  // else is forbidden). Empty/undefined = no loadout restriction.
  lockedLoadout?: TowerKind[];
  // Containment mode: lives = 1. Any leak ends the run.
  singleLife?: boolean;
  // Containment mode: sell button disabled — no eco recovery, every
  // placement is committed for the run.
  noSelling?: boolean;
  // Optional short blurb shown on the level intro card under the mode
  // badge. One sentence; the picker shows LEVEL_MODE_TAGLINE generically.
  tagline?: string;
};

export type LevelConfig = {
  id: number;
  name: string;
  paths: Vec2[][];
  waves: WaveSpec[];
  startGold: number;
  nodePos: { x: number; y: number };
  hpScale?: number;
  // Per-level roster-density multiplier. Scales every non-boss spawn count
  // (boss matriarchs stay singleton). Lets the early campaign run denser
  // waves without re-authoring each builder call — a maxed player's single
  // upgraded tower can't cover the wider stream, and the higher total HP
  // raises the DPS bar so earned gold actually has to be spent. Baked at
  // world creation alongside hpScale; the feasibility scripts honor it too.
  countScale?: number;
  // Biome is inferred from nodePos via biomeForPos() — there is no per-level
  // override. See src/biomes.ts for zone definitions.
  breach?: ModeConfig;
  containment?: ModeConfig;
};

// Resolve which ModeConfig the sim should use for a given mode. Normal
// mode synthesizes a ModeConfig from the level's top-level fields so the
// rest of the engine can stay mode-agnostic — every world is built from
// the resolved ModeConfig + the level's path/nodePos.
export const resolveLevelMode = (level: LevelConfig, mode: LevelMode): ModeConfig => {
  if (mode === "breach" && level.breach) return level.breach;
  if (mode === "containment" && level.containment) return level.containment;
  return { startGold: level.startGold, waves: level.waves };
};

// Inflate roster density by scaling every non-boss spawn count by
// `countScale` (see LevelConfig.countScale). Boss spawns keep their count
// untouched — a matriarch is a singleton event and duplicating her would
// break the boss-wave banner/bonus/child-stream semantics. Rounds to a
// whole enemy with a floor of 1 so a chip never scales itself out of the
// wave. Returns the same array reference when countScale is 1 so the no-op
// path allocates nothing.
export const scaleWaveCounts = (waves: WaveSpec[], countScale: number): WaveSpec[] => {
  if (countScale === 1) return waves;
  return waves.map((w) => ({
    ...w,
    spawns: w.spawns.map((s) =>
      s.kind === "boss" ? s : { ...s, count: Math.max(1, Math.round(s.count * countScale)) },
    ),
  }));
};

// True if a given level actually defines content for the requested
// challenge mode. Normal is always defined; breach/containment must be
// authored per level. The mode picker uses this to grey out unfinished
// modes.
export const levelHasMode = (level: LevelConfig, mode: LevelMode): boolean => {
  if (mode === "normal") return true;
  if (mode === "breach") return !!level.breach;
  return !!level.containment;
};

const p = (...coords: number[]): Vec2[] => {
  const out: Vec2[] = [];
  for (let i = 0; i < coords.length; i += 2) out.push({ x: coords[i], y: coords[i + 1] });
  return out;
};

type EnemyCounts = {
  raptor?: number;
  swarm?: number;
  para?: number;
  allosaur?: number;
  stego?: number;
  armored?: number;
  titan?: number;
  boss?: number;
};

const SPAWN_ORDER: EnemyKind[] = [
  "raptor",
  "swarm",
  "para",
  "allosaur",
  "stego",
  "armored",
  "titan",
  "boss",
];

type SpawnFlags = {
  shielded?: boolean;
  healAura?: boolean;
  regen?: boolean;
  resists?: Partial<Record<DamageType, number>>;
};

const toSpawns = (c: EnemyCounts, pathIndex = 0, flags: SpawnFlags = {}): EnemySpec[] =>
  SPAWN_ORDER.filter((k) => (c[k] ?? 0) > 0).map((k) => ({
    kind: k,
    count: c[k]!,
    pathIndex,
    ...(flags.shielded ? { shielded: true } : {}),
    ...(flags.healAura ? { healAura: true } : {}),
    ...(flags.regen ? { regen: true } : {}),
    ...(flags.resists ? { resists: flags.resists } : {}),
  }));

const intro = (raptor: number, swarm = 0, pathIndex = 0): WaveSpec => ({
  archetype: "intro",
  spacing: 0.9,
  spawns: toSpawns({ raptor, swarm }, pathIndex),
});

const mixed = (c: EnemyCounts, spacing = 0.5, pathIndex = 0): WaveSpec => ({
  archetype: "mixed",
  spacing,
  spawns: toSpawns(c, pathIndex),
});

const rush = (swarm: number, raptor = 0, pathIndex = 0): WaveSpec => ({
  archetype: "swarm",
  spacing: 0.11,
  spawns: toSpawns({ swarm, raptor }, pathIndex),
});

const heavy = (c: EnemyCounts, spacing = 0.95, pathIndex = 0): WaveSpec => ({
  archetype: "heavy",
  spacing,
  spawns: toSpawns(c, pathIndex),
});

const chaos = (c: EnemyCounts, spacing = 0.32, pathIndex = 0): WaveSpec => ({
  archetype: "chaos",
  spacing,
  spawns: toSpawns(c, pathIndex),
});

const split = (
  archetype: WaveArchetype,
  spacing: number,
  ...groups: [pathIndex: number, counts: EnemyCounts][]
): WaveSpec => ({
  archetype,
  spacing,
  spawns: groups.flatMap(([pi, c]) => toSpawns(c, pi)),
});

const FLAME_ADAPTED_SWARM_RESISTS: Partial<Record<DamageType, number>> = { flame: 0.35 };

// Specialist resistance chips — each constant takes ~95% less damage from
// one tower's damage type. Paired with `withSpecialist` below to drop a
// small adapted minority into otherwise vanilla mid/late waves so a
// single-tower spam build stalls on the holdouts. Multiplier 0.05 stacks
// on top of the kind's base resist; T3 anti-modifiers still soften them,
// which keeps a fully-built portfolio honest.
//
// Adaptive-resistance design hook: keep the per-spawn `resists` chip
// dimension (`Partial<Record<DamageType, number>>`) general — wave authors
// pick the type today, item 14's adaptive system will pick it at runtime
// from the same field with no schema change.
export const SPECIALIST_RESIST_MUL = 0.05;
export const RESIST_KINETIC_95: Partial<Record<DamageType, number>> = {
  kinetic: SPECIALIST_RESIST_MUL,
};
export const RESIST_ELECTRIC_95: Partial<Record<DamageType, number>> = {
  electric: SPECIALIST_RESIST_MUL,
};
export const RESIST_COLD_95: Partial<Record<DamageType, number>> = {
  cold: SPECIALIST_RESIST_MUL,
};
export const RESIST_EXPLOSIVE_95: Partial<Record<DamageType, number>> = {
  explosive: SPECIALIST_RESIST_MUL,
};
export const RESIST_FLAME_95: Partial<Record<DamageType, number>> = {
  flame: SPECIALIST_RESIST_MUL,
};

// Append a small specialist sub-pack (kind + count tagged with a resist
// chip) onto an existing wave. Used to sprinkle damage-type holdouts into
// otherwise vanilla mid/late waves without restructuring the whole spec.
const withSpecialist = (
  base: WaveSpec,
  spec: {
    kind: EnemyKind;
    count: number;
    resists: Partial<Record<DamageType, number>>;
    pathIndex?: number;
    shielded?: boolean;
  },
): WaveSpec => ({
  ...base,
  spawns: [
    ...base.spawns,
    {
      kind: spec.kind,
      count: spec.count,
      pathIndex: spec.pathIndex ?? 0,
      resists: spec.resists,
      ...(spec.shielded ? { shielded: true } : {}),
    },
  ],
});

const flamebreakSpawns = (c: EnemyCounts, pathIndex: number): EnemySpec[] => {
  const spawns: EnemySpec[] = [];
  if ((c.swarm ?? 0) > 0) {
    spawns.push(
      ...toSpawns({ swarm: c.swarm }, pathIndex, { resists: FLAME_ADAPTED_SWARM_RESISTS }),
    );
  }
  spawns.push(...toSpawns({ ...c, swarm: 0 }, pathIndex));
  return spawns;
};

// Flamebreak waves keep swarm density high but adapt only the hatchlings
// against flame. Chain and mortar stay clean answers; pulse/flame stacks
// need support instead of deleting the whole stream alone.
const flamebreakSplit = (
  spacing: number,
  ...groups: [pathIndex: number, counts: EnemyCounts][]
): WaveSpec => ({
  archetype: "swarm",
  spacing,
  spawns: groups.flatMap(([pi, c]) => flamebreakSpawns(c, pi)),
});

// Echelon: tiered escalation in fixed order — pass tiers small→large. The
// roster is preserved so each tier hits the lane before the next arrives,
// pressuring the player to adapt targeting modes mid-wave.
const echelon = (tiers: EnemyCounts[], spacing = 0.45, pathIndex = 0): WaveSpec => ({
  archetype: "echelon",
  spacing,
  spawns: tiers.flatMap((c) => toSpawns(c, pathIndex)),
});

// Trickle: wide spacing, fewer-but-tougher singles. Tests sustained DPS
// efficiency rather than peak burst — long, slow, grinding.
const trickle = (c: EnemyCounts, spacing = 1.6, pathIndex = 0): WaveSpec => ({
  archetype: "trickle",
  spacing,
  spawns: toSpawns(c, pathIndex),
});

// Convoy: escorts → tank → escorts. The tank is sandwiched, so it's hard
// to focus without letting the trailing escorts through. Counts the
// escort split so half lead, half trail.
const convoy = (
  escortKind: EnemyKind,
  escortCount: number,
  tankKind: EnemyKind,
  tankCount = 1,
  spacing = 0.5,
  pathIndex = 0,
): WaveSpec => ({
  archetype: "convoy",
  spacing,
  spawns: [
    { kind: escortKind, count: Math.ceil(escortCount / 2), pathIndex },
    { kind: tankKind, count: tankCount, pathIndex },
    { kind: escortKind, count: Math.floor(escortCount / 2), pathIndex },
  ],
});

// Shielded variant of `mixed` — every enemy in the group spawns with
// its kind's shield pool. Good for teaching: shield breaks → kill.
const shielded = (
  c: EnemyCounts,
  spacing = 0.55,
  pathIndex = 0,
  archetype: WaveArchetype = "mixed",
): WaveSpec => ({
  archetype,
  spacing,
  spawns: toSpawns(c, pathIndex, { shielded: true }),
});

// Mixed wave with two groups: shielded and unshielded portions. Authored
// per-group so spec readers can see the intent rather than counting
// shielded flags individually.
const partShielded = (
  shielded: EnemyCounts,
  unshielded: EnemyCounts,
  spacing = 0.5,
  pathIndex = 0,
  archetype: WaveArchetype = "mixed",
): WaveSpec => ({
  archetype,
  spacing,
  spawns: [
    ...toSpawns(shielded, pathIndex, { shielded: true }),
    ...toSpawns(unshielded, pathIndex),
  ],
});

// EnemySpec shorthand for the biome-themed matriarch variants. Each
// boss-wave spawn must route through here so the runtime picks up the
// per-variant HP/resists/model and the child-spawn stream from
// BOSS_VARIANT_*. `count` defaults to 1; multi-lane boss waves call
// this once per lane with the same variant.
const bossSpawn = (variant: BossVariant, pathIndex = 0, count = 1): EnemySpec => ({
  kind: "boss",
  count,
  pathIndex,
  bossVariant: variant,
});

// Boss wave — escort entourage leads, then the boss. The bossWave flag
// triggers the on-screen banner, audio sting, and bonus gold on kill.
// Single-path; multi-path boss waves are authored inline so the boss
// placement per lane is explicit. `variant` picks the biome-themed
// matriarch — required so the boss wave reads as that biome's queen
// rather than a generic apatosaurus on every boss event.
const bossWave = (
  variant: BossVariant,
  entourage: EnemyCounts,
  bosses = 1,
  spacing = 0.55,
  pathIndex = 0,
  bossTrickle?: BossTrickleStream[],
): WaveSpec => ({
  archetype: "convoy",
  spacing,
  bossWave: true,
  spawns: [...toSpawns(entourage, pathIndex), bossSpawn(variant, pathIndex, bosses)],
  ...(bossTrickle ? { bossTrickle } : {}),
});

// Steady drip of small enemies during a boss wave so the player has gold
// targets while the matriarch lumbers across the field. Tuned so a
// reasonable defense can clear the trickle while still chipping the boss.
const trickleStream = (
  pathIndex: number,
  kinds: EnemyKind[] = ["swarm", "raptor"],
  minInterval = 1.8,
  maxInterval = 2.8,
  startDelay = 6,
  modifiers?: { shielded?: boolean },
): BossTrickleStream => ({ pathIndex, kinds, minInterval, maxInterval, startDelay, ...modifiers });

// Levels 1–14 carry deliberately high hpScale (2.0–4.6) plus a countScale
// density bump — higher than several mid-game levels whose larger authored
// rosters and tankier enemy kinds already supply the difficulty. The early
// maps shipped with tiny rosters that a fully-upgraded tower shredded (the
// feasibility script measured 26–58× headroom vs the game's own ~9× endgame
// band), so gold never had to be spent, especially on Extinction. These
// scales pull L1–14 down to ~10× — tight on Extinction, still clearable for
// a fresh save on Easy/Medium. See scripts/wave-feasibility.ts to re-check
// (pass --difficulty=extinction to model the hardest tier).
//
// Note: these per-level static scales are difficulty-agnostic. Extinction
// gets two further layers on top, in DIFFICULTY_MULTIPLIERS (src/progress.ts):
// a tighter gold economy that self-targets the gold-rich early levels, and a
// per-wave HP ramp (lateWaveHpFactor) that keeps the BACK half of every level
// threatening once the board is fully upgraded — the static hpScale alone is
// flat across a level, so accumulated gold used to make late waves trivial.
export const LEVELS: LevelConfig[] = [
  {
    id: 1,
    name: "Jungle Outpost",
    paths: [p(-20, 0, 20, 0)],
    startGold: 220,
    nodePos: { x: -24, y: -13 },
    hpScale: 2.8,
    countScale: 1.8,
    waves: [
      intro(5),
      intro(7),
      intro(9, 3),
      mixed({ raptor: 8, swarm: 5 }),
      rush(20),
      mixed({ raptor: 10, swarm: 6, allosaur: 1 }),
      mixed({ raptor: 12, swarm: 8, allosaur: 1 }),
      rush(28, 4),
      mixed({ raptor: 12, swarm: 10, allosaur: 2 }),
      mixed({ raptor: 14, swarm: 10, allosaur: 3 }),
    ],
    // Breach: no pulse rifle. The cheap kinetic spammer is the obvious
    // L1 opener; denying it forces chain (electric) as the primary
    // single-target answer, with flame for swarm cleanup. Extra gold
    // covers the higher per-tower cost. Waves trade one of the intro
    // beats for an armored introduction so the build choice matters by
    // mid-run.
    breach: {
      startGold: 340,
      forbiddenTowers: ["pulse"],
      tagline: "Pulse Rifle confiscated. Chain or burn.",
      waves: [
        intro(8),
        intro(10, 3),
        mixed({ raptor: 10, swarm: 6 }),
        rush(28),
        mixed({ raptor: 12, swarm: 8, allosaur: 2 }),
        heavy({ armored: 1, stego: 1, allosaur: 2 }),
        mixed({ raptor: 14, swarm: 10, allosaur: 3 }),
        rush(42, 6),
        mixed({ raptor: 16, swarm: 12, allosaur: 3, stego: 1 }),
        chaos({ raptor: 14, swarm: 18, allosaur: 4, stego: 2 }),
      ],
    },
    // Containment: one life, no selling, chain + flame only. Big gold bank to
    // place the opening defenses before the first wave commits — every
    // placement is permanent so wrong spots cost the run. The wave list
    // skips the gentle intros: the player committed to containment and the
    // map opens at "swarm cleanup matters" pressure.
    containment: {
      startGold: 820,
      lockedLoadout: ["chain", "flame"],
      singleLife: true,
      noSelling: true,
      tagline: "1 life. Chain + Flame. No sell.",
      waves: [
        mixed({ raptor: 10, swarm: 6 }),
        rush(25),
        heavy({ stego: 2, allosaur: 2 }),
        mixed({ raptor: 14, swarm: 12, allosaur: 2 }),
        chaos({ raptor: 14, swarm: 16, allosaur: 3, stego: 2 }),
        rush(40, 6),
        heavy({ armored: 3, stego: 2 }),
        chaos({ raptor: 18, swarm: 22, allosaur: 5, stego: 2, armored: 1 }),
      ],
    },
  },
  {
    id: 2,
    name: "Riverside Pass",
    paths: [p(-20, -6, 4, -6, 4, 6, 20, 6)],
    startGold: 200,
    nodePos: { x: -14, y: -11 },
    hpScale: 2.8,
    countScale: 1.8,
    waves: [
      intro(8, 4),
      mixed({ raptor: 10, swarm: 6, allosaur: 1 }),
      mixed({ raptor: 12, swarm: 8, allosaur: 2 }),
      rush(32),
      mixed({ raptor: 14, swarm: 10, allosaur: 2, stego: 1 }),
      rush(40, 4),
      mixed({ raptor: 14, swarm: 10, allosaur: 3, stego: 1 }),
      mixed({ raptor: 16, swarm: 10, allosaur: 3, stego: 1 }),
      mixed({ raptor: 16, swarm: 12, allosaur: 4, stego: 1 }),
      mixed({ raptor: 18, swarm: 12, allosaur: 4, stego: 2 }),
    ],
    breach: {
      tagline: "No flame. Hatchlings come in waves.",
      forbiddenTowers: ["flame"],
      startGold: 320,
      waves: [
        intro(10, 6),
        rush(40),
        mixed({ raptor: 14, swarm: 10, allosaur: 2 }),
        rush(55, 6),
        mixed({ raptor: 16, swarm: 14, allosaur: 3, stego: 1 }),
        rush(70, 10),
        mixed({ raptor: 18, swarm: 14, allosaur: 4, stego: 1 }),
        chaos({ raptor: 18, swarm: 22, allosaur: 4, stego: 2 }),
        mixed({ raptor: 20, swarm: 16, allosaur: 5, stego: 2 }),
        chaos({ raptor: 22, swarm: 26, allosaur: 5, stego: 2 }),
      ],
    },
    containment: {
      tagline: "Pulse and mortar only. One life.",
      lockedLoadout: ["pulse", "mortar"],
      singleLife: true,
      noSelling: true,
      startGold: 600,
      waves: [
        intro(10, 4),
        mixed({ raptor: 14, swarm: 8, allosaur: 2 }),
        rush(40, 4),
        mixed({ raptor: 16, swarm: 12, allosaur: 3, stego: 1 }),
        rush(50, 8),
        mixed({ raptor: 18, swarm: 14, allosaur: 4, stego: 1 }),
        chaos({ raptor: 20, swarm: 18, allosaur: 4, stego: 2 }),
      ],
    },
  },
  {
    id: 3,
    name: "Canyon Run",
    paths: [p(-20, 8, -6, 8, -6, -4, 6, -4, 6, 8, 20, 8)],
    startGold: 200,
    nodePos: { x: -3, y: -14 },
    hpScale: 3.5,
    countScale: 1.8,
    waves: [
      intro(10, 6),
      mixed({ raptor: 12, swarm: 8, allosaur: 2 }),
      mixed({ raptor: 14, swarm: 10, allosaur: 2, stego: 1 }),
      rush(40, 4),
      mixed({ raptor: 14, swarm: 10, allosaur: 3, stego: 1 }),
      heavy({ armored: 2, stego: 1, allosaur: 2 }),
      mixed({ raptor: 16, swarm: 12, allosaur: 4, stego: 2 }),
      rush(50, 8),
      mixed({ raptor: 18, swarm: 14, allosaur: 4, stego: 2 }),
      chaos({ raptor: 16, swarm: 18, allosaur: 4, stego: 2 }),
    ],
    breach: {
      tagline: "No mortar. The canyon fills with armor.",
      forbiddenTowers: ["mortar"],
      startGold: 350,
      waves: [
        intro(12, 8),
        mixed({ raptor: 14, swarm: 10, allosaur: 3 }),
        rush(50, 6),
        heavy({ armored: 3, stego: 2, allosaur: 2 }),
        mixed({ raptor: 16, swarm: 14, allosaur: 4, stego: 2 }),
        heavy({ armored: 5, stego: 2, allosaur: 3 }),
        rush(70, 12),
        mixed({ raptor: 18, swarm: 16, allosaur: 5, stego: 3, armored: 1 }),
        heavy({ armored: 7, stego: 3, allosaur: 3 }),
        chaos({ raptor: 22, swarm: 24, allosaur: 6, stego: 3, armored: 2 }),
      ],
    },
    containment: {
      tagline: "Chain and cryo only. No selling, one life.",
      lockedLoadout: ["chain", "cryo"],
      singleLife: true,
      noSelling: true,
      startGold: 500,
      waves: [
        intro(14, 8),
        mixed({ raptor: 16, swarm: 12, allosaur: 3 }),
        rush(55, 8),
        heavy({ armored: 3, stego: 2, allosaur: 2 }),
        mixed({ raptor: 18, swarm: 14, allosaur: 4, stego: 2 }),
        heavy({ armored: 5, stego: 3, allosaur: 2 }),
        chaos({ raptor: 22, swarm: 26, allosaur: 5, stego: 2, armored: 1 }),
      ],
    },
  },
  {
    id: 4,
    name: "Marsh Breach",
    paths: [p(-20, -8, -12, -8, -12, 8, 12, 8, 12, -8, 20, -8)],
    startGold: 190,
    nodePos: { x: 9, y: -10 },
    hpScale: 3.5,
    countScale: 1.8,
    waves: [
      intro(12, 6),
      mixed({ raptor: 14, swarm: 10, allosaur: 3 }),
      mixed({ raptor: 14, swarm: 10, allosaur: 3, stego: 1 }),
      rush(50, 8),
      heavy({ armored: 3, stego: 1, allosaur: 2 }),
      mixed({ raptor: 16, swarm: 12, allosaur: 4, stego: 2 }),
      rush(58, 10),
      heavy({ armored: 4, stego: 2, allosaur: 2 }),
      mixed({ raptor: 18, swarm: 14, allosaur: 4, stego: 2 }),
      chaos({ raptor: 18, swarm: 22, allosaur: 5, stego: 2 }),
    ],
    breach: {
      tagline: "No chain. Swarms close in from both sides.",
      forbiddenTowers: ["chain"],
      startGold: 360,
      waves: [
        intro(14, 8),
        mixed({ raptor: 16, swarm: 12, allosaur: 3 }),
        rush(55, 8),
        heavy({ armored: 4, stego: 2, allosaur: 2 }),
        mixed({ raptor: 18, swarm: 14, allosaur: 4, stego: 2 }),
        rush(70, 12),
        heavy({ armored: 6, stego: 3, allosaur: 3 }),
        mixed({ raptor: 20, swarm: 16, allosaur: 5, stego: 3 }),
        chaos({ raptor: 20, swarm: 28, allosaur: 6, stego: 3, armored: 1 }),
        chaos({ raptor: 24, swarm: 32, allosaur: 6, stego: 3, armored: 2 }),
      ],
    },
    containment: {
      tagline: "Cryo and flame only. No selling, one life.",
      lockedLoadout: ["cryo", "flame"],
      singleLife: true,
      noSelling: true,
      startGold: 550,
      waves: [
        intro(16, 10),
        mixed({ raptor: 18, swarm: 14, allosaur: 3 }),
        rush(70, 12),
        heavy({ armored: 4, stego: 2, allosaur: 2 }),
        mixed({ raptor: 20, swarm: 16, allosaur: 4, stego: 2 }),
        heavy({ armored: 6, stego: 3, allosaur: 3 }),
        chaos({ raptor: 22, swarm: 30, allosaur: 5, stego: 2, armored: 2 }),
      ],
    },
  },
  {
    id: 5,
    name: "Ashen Valley",
    paths: [p(-20, -10, -14, -10, -9, -4, -1, -3, 3, 2, 10, 3, 15, 8, 20, 8)],
    startGold: 180,
    nodePos: { x: 24, y: -12 },
    hpScale: 2.6,
    countScale: 1.8,
    waves: [
      intro(14, 8),
      mixed({ raptor: 14, swarm: 10, allosaur: 3 }),
      mixed({ raptor: 14, swarm: 12, para: 2, allosaur: 3, stego: 1 }),
      rush(55, 10),
      heavy({ armored: 3, stego: 2, allosaur: 2 }),
      mixed({ raptor: 18, swarm: 14, para: 3, allosaur: 4, stego: 2 }),
      rush(65, 12),
      heavy({ armored: 5, stego: 3, allosaur: 2 }),
      mixed({ raptor: 20, swarm: 14, para: 4, allosaur: 5, stego: 2 }),
      // Boss wave: the Raptor Matriarch's debut. She's fast and lighter
      // than later matriarchs but now sheds the swarm directly around
      // herself. No extra path-start trickle here: the player should read
      // the pack as coming from the queen, not from spawn zero.
      bossWave("raptor", { raptor: 6, allosaur: 2 }, 1, 0.55),
    ],
    breach: {
      tagline: "No pulse. The Matriarch brings her heavy kin.",
      forbiddenTowers: ["pulse"],
      startGold: 380,
      waves: [
        intro(16, 10),
        mixed({ raptor: 16, swarm: 12, allosaur: 3 }),
        rush(65, 12),
        heavy({ armored: 4, stego: 2, allosaur: 2 }),
        mixed({ raptor: 20, swarm: 16, para: 4, allosaur: 5, stego: 2 }),
        rush(80, 16),
        heavy({ armored: 6, stego: 3, allosaur: 3 }),
        chaos({ raptor: 22, swarm: 24, para: 4, allosaur: 6, stego: 3 }),
        {
          archetype: "swarm",
          spacing: 0.13,
          spawns: [...toSpawns({ raptor: 24, swarm: 18 }, 0)],
        },
        // Boss wave: same Raptor Matriarch debut, but flanked by a
        // heavy raptor pack and an extra escort. No pulse means chain
        // burst + flame DoT carry the kill.
        {
          archetype: "convoy",
          spacing: 0.55,
          bossWave: true,
          spawns: [
            ...toSpawns({ raptor: 8, allosaur: 3 }, 0),
            ...toSpawns({ raptor: 6 }, 0),
            bossSpawn("raptor", 0),
          ],
          bossTrickle: [trickleStream(0, ["swarm", "raptor"], 1.8, 2.6, 8)],
        },
      ],
    },
    containment: {
      tagline: "Mortar and hive only. The Matriarch is the test.",
      lockedLoadout: ["mortar", "hive"],
      singleLife: true,
      noSelling: true,
      startGold: 750,
      waves: [
        intro(16, 10),
        mixed({ raptor: 16, swarm: 12, allosaur: 3 }),
        rush(60, 10),
        heavy({ armored: 3, stego: 2, allosaur: 2 }),
        mixed({ raptor: 18, swarm: 14, para: 3, allosaur: 4, stego: 2 }),
        chaos({ raptor: 20, swarm: 22, allosaur: 5, stego: 2 }),
        // Boss wave: hive-buffed mortar must crack the Matriarch's
        // entourage and her child raptors. No selling means the player
        // commits to spot mode on a chokepoint up front.
        bossWave("raptor", { raptor: 6, allosaur: 2 }, 1, 0.55),
      ],
    },
  },
  {
    id: 6,
    name: "Fossil Ridge",
    paths: [p(-20, 8, -12, 8, -12, -6, -4, -6, -4, 8, 4, 8, 4, -6, 12, -6, 12, 8, 20, 8)],
    startGold: 180,
    nodePos: { x: 21, y: -5 },
    hpScale: 3.7,
    countScale: 1.8,
    waves: [
      intro(16, 10),
      mixed({ raptor: 14, swarm: 12, allosaur: 3 }),
      mixed({ raptor: 16, swarm: 14, allosaur: 4, stego: 1 }),
      rush(60, 10),
      heavy({ armored: 4, stego: 2, allosaur: 2 }),
      mixed({ raptor: 18, swarm: 14, allosaur: 5, stego: 2 }),
      rush(70, 14),
      heavy({ armored: 6, stego: 3, allosaur: 3 }),
      mixed({ raptor: 22, swarm: 16, allosaur: 5, stego: 3, armored: 1 }),
      chaos({ raptor: 20, swarm: 24, allosaur: 6, stego: 3, armored: 2 }),
    ],
    breach: {
      startGold: 300,
      tagline: "Flame is forbidden. The ridge bites back.",
      forbiddenTowers: ["flame"],
      waves: [
        intro(32, 28),
        mixed({ raptor: 32, swarm: 36, allosaur: 8 }),
        rush(260, 40),
        heavy({ armored: 12, stego: 7, allosaur: 6, titan: 1 }),
        mixed({ raptor: 36, swarm: 44, allosaur: 12, stego: 5 }),
        echelon([
          { raptor: 32, swarm: 56 },
          { allosaur: 14, stego: 7 },
          { armored: 14, titan: 2 },
        ]),
        rush(320, 60),
        heavy({ armored: 22, stego: 12, allosaur: 9, titan: 3 }),
        convoy("raptor", 48, "armored", 12, 0.4),
        chaos({ raptor: 48, swarm: 90, allosaur: 16, stego: 11, armored: 10, titan: 3 }),
      ],
    },
    containment: {
      startGold: 400,
      tagline: "Kinetic vow: pulse + chain only. One life. No sells.",
      lockedLoadout: ["pulse", "chain"],
      singleLife: true,
      noSelling: true,
      waves: [
        intro(30, 24),
        mixed({ raptor: 36, swarm: 36, allosaur: 9 }),
        rush(280, 48),
        mixed({ raptor: 44, swarm: 52, allosaur: 13, stego: 6 }),
        heavy({ armored: 20, stego: 12, allosaur: 9, titan: 2 }),
        rush(360, 64),
        chaos({ raptor: 56, swarm: 110, allosaur: 20, stego: 11, armored: 10, titan: 2 }),
        chaos({ raptor: 70, swarm: 140, allosaur: 26, stego: 16, armored: 14, titan: 4 }),
      ],
    },
  },
  {
    id: 7,
    name: "Sulfur Flats",
    paths: [p(-20, -8, -14, -8, -8, -4, -2, 0, 4, 4, 10, 6, 16, 8, 20, 8)],
    startGold: 170,
    nodePos: { x: 13, y: -3 },
    hpScale: 2.5,
    countScale: 1.8,
    waves: [
      intro(14, 10),
      mixed({ raptor: 12, swarm: 10, allosaur: 2 }),
      mixed({ raptor: 16, swarm: 12, allosaur: 3 }),
      rush(65, 10),
      heavy({ armored: 3, stego: 2, allosaur: 2 }),
      mixed({ raptor: 18, swarm: 14, allosaur: 4, stego: 1 }),
      chaos({ raptor: 16, swarm: 22, allosaur: 5, stego: 2 }),
      rush(75, 14),
      heavy({ armored: 6, stego: 4, allosaur: 3 }),
      chaos({ raptor: 22, swarm: 26, allosaur: 6, stego: 3, armored: 2 }),
    ],
    breach: {
      startGold: 340,
      tagline: "Pyre denied. Hold the flats with chain and steel.",
      forbiddenTowers: ["flame"],
      waves: [
        intro(20, 16),
        mixed({ raptor: 22, swarm: 22, allosaur: 5 }),
        rush(180, 28),
        mixed({ raptor: 28, swarm: 28, allosaur: 7, stego: 3 }),
        heavy({ armored: 7, stego: 5, allosaur: 5 }),
        chaos({ raptor: 26, swarm: 50, allosaur: 8, stego: 4 }),
        rush(220, 36),
        heavy({ armored: 12, stego: 8, allosaur: 6, titan: 1 }),
        echelon([
          { raptor: 26, swarm: 36 },
          { allosaur: 12, stego: 6 },
          { armored: 8, titan: 1 },
        ]),
        chaos({ raptor: 36, swarm: 60, allosaur: 14, stego: 8, armored: 6, titan: 2 }),
      ],
    },
    containment: {
      startGold: 520,
      tagline: "Cold + chain only. One life, no sells.",
      lockedLoadout: ["cryo", "chain"],
      singleLife: true,
      noSelling: true,
      waves: [
        intro(20, 14),
        mixed({ raptor: 24, swarm: 22, allosaur: 5 }),
        rush(150, 26),
        mixed({ raptor: 28, swarm: 28, allosaur: 7, stego: 3 }),
        heavy({ armored: 8, stego: 5, allosaur: 5 }),
        rush(200, 34),
        chaos({ raptor: 32, swarm: 52, allosaur: 10, stego: 6, armored: 4 }),
        chaos({ raptor: 40, swarm: 70, allosaur: 14, stego: 8, armored: 7, titan: 1 }),
      ],
    },
  },
  {
    id: 8,
    name: "Obsidian Pass",
    // Two parallel corridors — upper and lower
    paths: [
      p(-20, 7, -10, 7, -10, 4, 10, 4, 10, 7, 20, 7),
      p(-20, -7, -10, -7, -10, -4, 10, -4, 10, -7, 20, -7),
    ],
    startGold: 200,
    nodePos: { x: 2, y: -8 },
    hpScale: 4.6,
    countScale: 1.8,
    waves: [
      intro(12, 8, 0),
      split("intro", 0.85, [0, { raptor: 6, swarm: 2 }], [1, { raptor: 6, swarm: 2 }]),
      split(
        "mixed",
        0.6,
        [0, { raptor: 8, swarm: 4, para: 1 }],
        [1, { raptor: 8, swarm: 4, para: 1 }],
      ),
      split(
        "mixed",
        0.55,
        [0, { raptor: 10, swarm: 4, para: 1 }],
        [1, { raptor: 10, swarm: 4, para: 1 }],
      ),
      split("swarm", 0.11, [0, { swarm: 40 }], [1, { swarm: 40 }]),
      split("heavy", 0.95, [0, { armored: 3, stego: 2 }], [1, { allosaur: 4, stego: 1 }]),
      split(
        "mixed",
        0.5,
        [0, { raptor: 14, swarm: 8, para: 2, allosaur: 3 }],
        [1, { raptor: 14, swarm: 8, para: 2, allosaur: 3 }],
      ),
      split("swarm", 0.1, [0, { swarm: 45 }], [1, { swarm: 45, raptor: 6 }]),
      split("heavy", 0.9, [0, { armored: 5, stego: 2 }], [1, { armored: 5, allosaur: 3 }]),
      split(
        "chaos",
        0.3,
        [0, { raptor: 14, swarm: 14, para: 3, allosaur: 3, stego: 2 }],
        [1, { raptor: 14, swarm: 14, para: 3, allosaur: 3, armored: 2 }],
      ),
    ],
    breach: {
      startGold: 380,
      tagline: "Mortar's gone. Both lanes need precision.",
      forbiddenTowers: ["mortar"],
      waves: [
        split("intro", 0.8, [0, { raptor: 10, swarm: 4 }], [1, { raptor: 10, swarm: 4 }]),
        split(
          "mixed",
          0.55,
          [0, { raptor: 14, swarm: 8, para: 2 }],
          [1, { raptor: 14, swarm: 8, para: 2 }],
        ),
        split("swarm", 0.1, [0, { swarm: 70 }], [1, { swarm: 70 }]),
        split("heavy", 0.9, [0, { armored: 5, stego: 3 }], [1, { armored: 5, stego: 3 }]),
        split(
          "mixed",
          0.5,
          [0, { raptor: 20, swarm: 14, para: 3, allosaur: 5 }],
          [1, { raptor: 20, swarm: 14, para: 3, allosaur: 5 }],
        ),
        split("swarm", 0.09, [0, { swarm: 90, raptor: 12 }], [1, { swarm: 90, raptor: 12 }]),
        split(
          "heavy",
          0.85,
          [0, { armored: 9, stego: 5 }],
          [1, { armored: 9, stego: 5, titan: 1 }],
        ),
        split(
          "chaos",
          0.28,
          [0, { raptor: 22, swarm: 26, para: 5, allosaur: 7, stego: 4, armored: 3 }],
          [1, { raptor: 22, swarm: 26, para: 5, allosaur: 7, stego: 4, armored: 3 }],
        ),
        split(
          "chaos",
          0.25,
          [0, { raptor: 26, swarm: 34, para: 6, allosaur: 9, stego: 5, armored: 5, titan: 1 }],
          [1, { raptor: 26, swarm: 34, para: 6, allosaur: 9, stego: 5, armored: 5, titan: 1 }],
        ),
      ],
    },
    containment: {
      startGold: 620,
      tagline: "Drone & bounce: hive + chain. One life, no sells.",
      lockedLoadout: ["hive", "chain"],
      singleLife: true,
      noSelling: true,
      waves: [
        split("intro", 0.85, [0, { raptor: 10, swarm: 4 }], [1, { raptor: 10, swarm: 4 }]),
        split(
          "mixed",
          0.55,
          [0, { raptor: 14, swarm: 10, para: 2 }],
          [1, { raptor: 14, swarm: 10, para: 2 }],
        ),
        split("swarm", 0.1, [0, { swarm: 60 }], [1, { swarm: 60 }]),
        split("heavy", 0.95, [0, { armored: 5, stego: 3 }], [1, { armored: 5, stego: 3 }]),
        split("swarm", 0.09, [0, { swarm: 80, raptor: 10 }], [1, { swarm: 80, raptor: 10 }]),
        split(
          "mixed",
          0.5,
          [0, { raptor: 20, swarm: 16, allosaur: 5, stego: 2 }],
          [1, { raptor: 20, swarm: 16, allosaur: 5, stego: 2 }],
        ),
        split(
          "chaos",
          0.28,
          [0, { raptor: 24, swarm: 30, para: 4, allosaur: 8, stego: 4, armored: 3 }],
          [1, { raptor: 24, swarm: 30, para: 4, allosaur: 8, stego: 4, armored: 3 }],
        ),
      ],
    },
  },
  {
    id: 9,
    name: "Tarpit Gorge",
    paths: [p(-20, 8, -10, 8, -2, 0, 0, -6, 8, -8, 14, -4, 20, 2)],
    startGold: 160,
    nodePos: { x: -10, y: -2 },
    hpScale: 2.9,
    countScale: 1.8,
    waves: [
      intro(14, 8),
      mixed({ raptor: 14, swarm: 10, allosaur: 3 }),
      rush(70, 12),
      mixed({ raptor: 18, swarm: 14, allosaur: 4, stego: 2 }),
      heavy({ armored: 5, stego: 3, allosaur: 2 }),
      chaos({ raptor: 16, swarm: 24, allosaur: 5, stego: 3 }),
      rush(85, 16),
      heavy({ armored: 8, stego: 4, allosaur: 4 }),
      mixed({ raptor: 24, swarm: 18, allosaur: 7, stego: 4 }),
      chaos({ raptor: 26, swarm: 30, allosaur: 8, stego: 5, armored: 3 }),
    ],
    breach: {
      startGold: 360,
      tagline: "Pulse rifles seized. Crack the heavies cold.",
      forbiddenTowers: ["pulse"],
      waves: [
        intro(20, 14),
        mixed({ raptor: 22, swarm: 18, allosaur: 5 }),
        rush(140, 24),
        mixed({ raptor: 28, swarm: 26, allosaur: 7, stego: 3 }),
        heavy({ armored: 8, stego: 5, allosaur: 4 }),
        chaos({ raptor: 24, swarm: 50, allosaur: 8, stego: 5 }),
        rush(200, 36),
        heavy({ armored: 14, stego: 8, allosaur: 6, titan: 1 }),
        echelon([
          { raptor: 30, swarm: 36 },
          { allosaur: 14, stego: 7 },
          { armored: 8, titan: 2 },
        ]),
        chaos({ raptor: 38, swarm: 64, allosaur: 13, stego: 8, armored: 6, titan: 2 }),
      ],
    },
    containment: {
      startGold: 560,
      tagline: "Pyre & frost: flame + cryo. One life, no sells.",
      lockedLoadout: ["flame", "cryo"],
      singleLife: true,
      noSelling: true,
      waves: [
        intro(20, 14),
        mixed({ raptor: 22, swarm: 20, allosaur: 5 }),
        rush(140, 24),
        mixed({ raptor: 28, swarm: 28, allosaur: 7, stego: 3 }),
        heavy({ armored: 8, stego: 5, allosaur: 5 }),
        rush(180, 32),
        chaos({ raptor: 32, swarm: 52, allosaur: 10, stego: 6, armored: 4 }),
        chaos({ raptor: 40, swarm: 70, allosaur: 14, stego: 8, armored: 7, titan: 1 }),
      ],
    },
  },
  {
    id: 10,
    name: "Bonefield Plateau",
    paths: [p(-20, 10, -16, 10, -16, -10, 14, -10, 14, 6, -10, 6, -10, -4, 8, -4, 8, 2, 20, 2)],
    startGold: 160,
    nodePos: { x: -20, y: -6 },
    hpScale: 4.4,
    countScale: 1.8,
    waves: [
      intro(16, 10),
      mixed({ raptor: 14, swarm: 10, allosaur: 3 }),
      mixed({ raptor: 16, swarm: 12, allosaur: 4, stego: 2 }),
      rush(80, 14),
      heavy({ armored: 8, stego: 4, allosaur: 4 }),
      chaos({ raptor: 18, swarm: 26, allosaur: 8, stego: 4, armored: 2 }),
      rush(120, 26),
      heavy({ armored: 11, stego: 6, allosaur: 5 }),
      mixed({ raptor: 26, swarm: 20, allosaur: 10, stego: 6, armored: 3 }),
      // Boss wave: the Stegosaur Matriarch. Heaviest plates yet, slow
      // crawl, and she calves a fresh stego every six seconds. No titan
      // here — the apatosaurus debut is held back to the next level so
      // this wave reads as the stego's solo spotlight. Entourage leans
      // on allosaur + armored pressure while her child drip handles the
      // trickle; electric is the only real lever (plates eat kinetic/blast).
      bossWave("stego", { allosaur: 5, armored: 3 }, 1, 0.7, 0, [
        trickleStream(0, ["swarm", "raptor"], 1.6, 2.2, 6),
        trickleStream(0, ["swarm", "raptor", "allosaur"], 1.0, 1.6, 18),
      ]),
    ],
    breach: {
      startGold: 460,
      tagline: "No mortar against the plated queen",
      // Mortar's the easy answer to plated stegos — yank it. Chain is
      // the matriarch's only soft spot; pulse handles trickle.
      forbiddenTowers: ["mortar"],
      waves: [
        intro(20, 14),
        mixed({ raptor: 18, swarm: 14, allosaur: 4 }),
        // Shielded raptor pack early — denies easy chain-clears.
        shielded({ raptor: 14, swarm: 6 }, 0.5),
        rush(100, 18),
        // soft-counter the plates.
        {
          archetype: "heavy",
          spacing: 0.85,
          spawns: [...toSpawns({ armored: 5 }, 0), ...toSpawns({ stego: 4, allosaur: 4 })],
        },
        chaos({ raptor: 22, swarm: 30, allosaur: 10, stego: 5, armored: 3 }),
        rush(140, 30),
        // a serious chain-only puzzle.
        {
          archetype: "vanguard",
          spacing: 0.6,
          spawns: [...toSpawns({ stego: 2 }, 0), ...toSpawns({ armored: 8, allosaur: 4 })],
        },
        mixed({ raptor: 28, swarm: 22, allosaur: 12, stego: 7, armored: 4 }),
        // Boss wave: Stegosaur Matriarch with a denser entourage and a
        // denser child trickle. No mortar means the trickle pressure has
        // to be cleared by pulse/chain/flame while the matriarch eats
        // chain bolts.
        {
          archetype: "convoy",
          spacing: 0.65,
          bossWave: true,
          spawns: [
            ...toSpawns({ armored: 2 }, 0),
            ...toSpawns({ allosaur: 5, titan: 1 }),
            ...toSpawns({ stego: 1 }, 0),
            bossSpawn("stego", 0),
          ],
          bossTrickle: [
            trickleStream(0, ["swarm", "raptor"], 1.3, 1.9, 5),
            trickleStream(0, ["raptor", "allosaur"], 0.9, 1.4, 18),
          ],
        },
      ],
    },
    containment: {
      startGold: 480,
      tagline: "One life. Pulse, chain, cryo, hive. Crack the queen.",
      // Anti-plate loadout: chain shreds matriarch + shielded packs,
      // cryo controls boss tempo, pulse handles raptor trickle, hive
      // tops up rate-of-fire. No mortar, no flame — pure burst + control.
      lockedLoadout: ["pulse", "chain", "cryo", "hive"],
      singleLife: true,
      noSelling: true,
      waves: [
        mixed({ raptor: 16, swarm: 12, allosaur: 3 }),
        shielded({ raptor: 12, swarm: 6 }, 0.5),
        rush(90, 18),
        heavy({ armored: 7, stego: 4, allosaur: 4 }),
        chaos({ raptor: 22, swarm: 28, allosaur: 8, stego: 4, armored: 3 }),
        mixed({ raptor: 26, swarm: 20, allosaur: 10, stego: 6, armored: 3 }),
        // Containment's boss is the same Stegosaur Matriarch, slightly leaner
        // entourage to compensate for the locked loadout — chain still
        // does the work, hive amps it, cryo buys time, pulse mops trickle.
        bossWave("stego", { allosaur: 4, armored: 2, titan: 1 }, 1, 0.7, 0, [
          trickleStream(0, ["swarm", "raptor"], 1.6, 2.2, 6),
          trickleStream(0, ["swarm", "raptor", "allosaur"], 1.0, 1.6, 18),
        ]),
      ],
    },
  },
  {
    id: 11,
    name: "Scorched Gulch",
    paths: [p(-20, -10, -12, -10, -12, 0, -4, 0, -4, 8, 6, 8, 6, -8, 14, -8, 14, 10, 20, 10)],
    startGold: 150,
    nodePos: { x: -23, y: 2 },
    hpScale: 2.9,
    countScale: 1.5,
    waves: [
      intro(20, 14),
      // First taste of shields: denser raptor pack — the bubble breaks
      // fast, the lesson is "shield first, body second."
      shielded({ raptor: 14 }, 0.5),
      // Shielded raptors mixed into a regular pack so the player has to
      // notice mid-wave which targets are still buffered.
      partShielded({ raptor: 10 }, { raptor: 18, swarm: 22, allosaur: 7 }, 0.45),
      heavy({ armored: 9, stego: 5, allosaur: 4 }),
      rush(150, 30),
      // Apatosaurus debut: titans slipped into a dense heavy push so the
      // player meets them alongside familiar armored/stego pressure
      // before the finale doubles up.
      heavy({ armored: 14, stego: 8, allosaur: 6, titan: 2 }),
      // Specialist finale: a small block of kinetic-resistant armored
      // ("Ironplate" hide) ride the chaos so pulse-only spam stalls on
      // the holdouts. Chain/cryo/mortar still cut through cleanly.
      withSpecialist(
        chaos({ raptor: 32, swarm: 44, allosaur: 14, stego: 9, armored: 7, titan: 3 }),
        {
          kind: "armored",
          count: 4,
          resists: RESIST_KINETIC_95,
        },
      ),
    ],
    breach: {
      startGold: 450,
      tagline: "No chain — pop shields the hard way",
      // Chain trivializes shielded packs; deny it and force pulse focus
      // or flame DoT to crack the bubbles.
      forbiddenTowers: ["chain"],
      waves: [
        intro(20, 14),
        mixed({ raptor: 20, swarm: 16, allosaur: 6, stego: 2 }),
        // Heavier shielded raptor opener — without chain, this stings.
        shielded({ raptor: 18 }, 0.5),
        rush(100, 18),
        // Shielded raptors blended with shielded swarm — twice the
        // bubble-pop cost.
        partShielded({ raptor: 12, swarm: 10 }, { raptor: 14, swarm: 12, allosaur: 6 }, 0.5),
        heavy({ armored: 8, stego: 5, allosaur: 4 }),
        rush(140, 28),
        // Shielded armored + plain stego push — pulse focus + flame DoT
        // is the answer.
        {
          archetype: "heavy",
          spacing: 0.85,
          spawns: [
            ...toSpawns({ armored: 5 }, 0, { shielded: true }),
            ...toSpawns({ stego: 5, allosaur: 4 }),
          ],
        },
        heavy({ armored: 14, stego: 8, allosaur: 6 }),
        // Finale: shielded chaos. Without chain, you're paying full
        // bubble cost on every raptor.
        {
          archetype: "chaos",
          spacing: 0.28,
          spawns: [
            ...toSpawns({ raptor: 18, swarm: 18 }, 0, { shielded: true }),
            ...toSpawns({ allosaur: 12, stego: 7, armored: 6, titan: 2 }),
          ],
        },
      ],
    },
    containment: {
      startGold: 420,
      tagline: "One life. Pulse, cryo, mortar, hive. No chain.",
      // Force a focus-burst comp — pulse cracks shields, mortar splashes
      // packs after bubbles drop, cryo controls tempo, hive buffs rate.
      lockedLoadout: ["pulse", "cryo", "mortar", "hive"],
      singleLife: true,
      noSelling: true,
      waves: [
        mixed({ raptor: 16, swarm: 12, allosaur: 4 }),
        shielded({ raptor: 12 }, 0.55),
        rush(80, 14),
        partShielded({ raptor: 8 }, { raptor: 14, swarm: 14, allosaur: 5 }, 0.5),
        heavy({ armored: 7, stego: 4, allosaur: 3 }),
        mixed({ raptor: 20, swarm: 16, allosaur: 8, stego: 4, armored: 2 }),
        heavy({ armored: 12, stego: 7, allosaur: 5 }),
        chaos({ raptor: 26, swarm: 32, allosaur: 12, stego: 7, armored: 6, titan: 2 }),
      ],
    },
  },
  {
    id: 12,
    name: "Sunken Hollow",
    // Two separate entries (left & right) merging toward each other's exits
    paths: [
      p(-20, -9, -10, -9, -4, -3, 4, 3, 10, 9, 20, 9),
      p(20, -9, 10, -9, 4, -3, -4, 3, -10, 9, -20, 9),
    ],
    startGold: 210,
    nodePos: { x: -13, y: 5 },
    hpScale: 2.35,
    countScale: 1.5,
    waves: [
      split("intro", 0.85, [0, { raptor: 12 }], [1, { raptor: 12 }]),
      split(
        "mixed",
        0.5,
        [0, { raptor: 14, swarm: 10, allosaur: 4 }],
        [1, { raptor: 14, swarm: 10, allosaur: 4 }],
      ),
      split("swarm", 0.09, [0, { swarm: 70 }], [1, { swarm: 70 }]),
      // First armored shields: focus-fire pressure on a tank that
      // already eats kinetic only. Splash bounces off the bubble — the
      // wave teaches that DoT and chip damage are the answer.
      {
        archetype: "heavy",
        spacing: 0.85,
        spawns: [
          ...toSpawns({ armored: 4, stego: 2 }, 0, { shielded: true }),
          ...toSpawns({ armored: 4, stego: 2 }, 1, { shielded: true }),
        ],
      },
      // Shielded armored convoy on both lanes — the punctuation wave for
      // L12. Each shielded armored is effectively a 420hp brick.
      {
        archetype: "heavy",
        spacing: 0.8,
        spawns: [
          ...toSpawns({ armored: 5, stego: 3 }, 0, { shielded: true }),
          ...toSpawns({ allosaur: 4 }, 0),
          ...toSpawns({ armored: 5, stego: 3 }, 1, { shielded: true }),
          ...toSpawns({ allosaur: 4 }, 1),
        ],
      },
      split(
        "chaos",
        0.27,
        [0, { raptor: 20, swarm: 26, allosaur: 8, stego: 5, armored: 4, titan: 1 }],
        [1, { raptor: 20, swarm: 26, allosaur: 8, stego: 5, armored: 4, titan: 1 }],
      ),
      split(
        "chaos",
        0.23,
        [0, { raptor: 24, swarm: 32, allosaur: 12, stego: 10, armored: 8, titan: 3 }],
        [1, { raptor: 24, swarm: 32, allosaur: 12, stego: 10, armored: 8, titan: 3 }],
      ),
    ],
    breach: {
      startGold: 500,
      tagline: "No pulse — crack shielded bricks the slow way",
      // Pulse is the obvious shield-cracker. Take it away and the
      // shielded armored bricks become a chain-chip + flame-DoT problem
      // across two lanes.
      forbiddenTowers: ["pulse"],
      waves: [
        split("intro", 0.85, [0, { raptor: 12 }], [1, { raptor: 12 }]),
        split(
          "mixed",
          0.55,
          [0, { raptor: 14, swarm: 10, allosaur: 4 }],
          [1, { raptor: 14, swarm: 10, allosaur: 4 }],
        ),
        split("swarm", 0.1, [0, { swarm: 60 }], [1, { swarm: 60 }]),
        // Heavier shielded armored opener — no pulse, so each brick
        // takes serious flame ticks to crack.
        {
          archetype: "heavy",
          spacing: 0.9,
          spawns: [
            ...toSpawns({ armored: 4, stego: 2 }, 0, { shielded: true }),
            ...toSpawns({ armored: 4, stego: 2 }, 1, { shielded: true }),
          ],
        },
        split(
          "mixed",
          0.5,
          [0, { raptor: 16, swarm: 12, allosaur: 5, stego: 2 }],
          [1, { raptor: 16, swarm: 12, allosaur: 5, stego: 2 }],
        ),
        split(
          "chaos",
          0.3,
          [0, { raptor: 14, swarm: 16, allosaur: 5, stego: 3, armored: 2 }],
          [1, { raptor: 14, swarm: 16, allosaur: 5, stego: 3, armored: 2 }],
        ),
        // Heavy swarm rush across both lanes — leaks bite hard.
        {
          archetype: "swarm",
          spacing: 0.09,
          spawns: [...toSpawns({ swarm: 55 }, 0), ...toSpawns({ swarm: 55, raptor: 10 }, 1)],
        },
        // Shielded armored convoy on both lanes, denser escort.
        {
          archetype: "heavy",
          spacing: 0.8,
          spawns: [
            ...toSpawns({ armored: 5, stego: 3 }, 0, { shielded: true }),
            ...toSpawns({ allosaur: 4 }, 0),
            ...toSpawns({ armored: 5, stego: 3 }, 1, { shielded: true }),
            ...toSpawns({ allosaur: 4 }, 1),
          ],
        },
        split(
          "chaos",
          0.28,
          [0, { raptor: 16, swarm: 20, allosaur: 6, stego: 4, armored: 3 }],
          [1, { raptor: 16, swarm: 20, allosaur: 6, stego: 4, armored: 3 }],
        ),
        // Finale: heavy-armored on each lane, plain mass behind.
        {
          archetype: "chaos",
          spacing: 0.25,
          spawns: [
            ...toSpawns({ armored: 2 }, 0),
            ...toSpawns({ raptor: 18, swarm: 22, allosaur: 8, stego: 5, titan: 1 }, 0),
            ...toSpawns({ armored: 2 }, 1),
            ...toSpawns({ raptor: 18, swarm: 22, allosaur: 8, stego: 5, titan: 1 }, 1),
          ],
        },
      ],
    },
    containment: {
      startGold: 500,
      tagline: "One life. Chain, cryo, mortar, hive across both lanes.",
      // Two-path discipline: chain bounces between lanes when paths
      // converge, cryo controls swarm tempo, mortar splashes packs
      // after bubbles drop, hive amps it all. No pulse, no flame.
      lockedLoadout: ["chain", "cryo", "mortar", "hive"],
      singleLife: true,
      noSelling: true,
      waves: [
        split(
          "mixed",
          0.55,
          [0, { raptor: 12, swarm: 8, allosaur: 3 }],
          [1, { raptor: 12, swarm: 8, allosaur: 3 }],
        ),
        split("swarm", 0.1, [0, { swarm: 50 }], [1, { swarm: 50 }]),
        {
          archetype: "heavy",
          spacing: 0.9,
          spawns: [
            ...toSpawns({ armored: 3, stego: 2 }, 0, { shielded: true }),
            ...toSpawns({ armored: 3, stego: 2 }, 1, { shielded: true }),
          ],
        },
        split(
          "mixed",
          0.5,
          [0, { raptor: 14, swarm: 10, allosaur: 4, stego: 2 }],
          [1, { raptor: 14, swarm: 10, allosaur: 4, stego: 2 }],
        ),
        split("swarm", 0.09, [0, { swarm: 55 }], [1, { swarm: 55, raptor: 10 }]),
        {
          archetype: "heavy",
          spacing: 0.85,
          spawns: [
            ...toSpawns({ armored: 4, stego: 2 }, 0, { shielded: true }),
            ...toSpawns({ allosaur: 3 }, 0),
            ...toSpawns({ armored: 4, stego: 2 }, 1, { shielded: true }),
            ...toSpawns({ allosaur: 3 }, 1),
          ],
        },
        split(
          "chaos",
          0.25,
          [0, { raptor: 18, swarm: 22, allosaur: 7, stego: 4, armored: 3 }],
          [1, { raptor: 18, swarm: 22, allosaur: 7, stego: 4, armored: 3 }],
        ),
      ],
    },
  },
  {
    id: 13,
    name: "Ironwood Thicket",
    paths: [
      p(
        -20,
        10,
        -16,
        10,
        -16,
        -10,
        -8,
        -10,
        -8,
        10,
        0,
        10,
        0,
        -10,
        8,
        -10,
        8,
        10,
        16,
        10,
        16,
        -10,
        20,
        -10,
      ),
    ],
    startGold: 150,
    nodePos: { x: -3, y: 0 },
    hpScale: 2.4,
    countScale: 1.5,
    waves: [
      mixed({ raptor: 22, swarm: 18, allosaur: 7, stego: 2 }),
      rush(115, 24),
      // First healing encounter: paras with the healAura chip, escorted
      // by raptors. Paras are fast — sentinel-mode hive or strong
      // single-target burst is the answer. Convoy archetype keeps the
      // healers sandwiched.
      {
        archetype: "convoy",
        spacing: 0.5,
        spawns: [
          { kind: "raptor", count: 8, pathIndex: 0 },
          ...toSpawns({ para: 4 }, 0, { healAura: true }),
          { kind: "raptor", count: 8, pathIndex: 0 },
        ],
      },
      // Healing-supported armored push — the aura turns the armored core
      // into a chip war if the healers aren't picked off.
      {
        archetype: "heavy",
        spacing: 0.85,
        spawns: [
          ...toSpawns({ armored: 6, stego: 4, allosaur: 4 }),
          ...toSpawns({ para: 3 }, 0, { healAura: true }),
        ],
      },
      // Electric-resistant ("Insulated") para minority — paras normally
      // ring through chain at 1.7×, this batch flips the script so chain
      // spam can't melt them. The vanilla chaos still teaches the regular
      // mid-wave; the holdouts demand a second damage type to finish.
      withSpecialist(chaos({ raptor: 22, swarm: 30, allosaur: 10, stego: 6, armored: 3 }), {
        kind: "para",
        count: 5,
        resists: RESIST_ELECTRIC_95,
      }),
      heavy({ armored: 18, stego: 10, allosaur: 8, titan: 2 }),
      // Healing paras mixed into a chaos pack — the heal trickle keeps
      // swarm stragglers alive long enough to break through.
      {
        archetype: "chaos",
        spacing: 0.27,
        spawns: [
          ...toSpawns({ raptor: 26, swarm: 30, allosaur: 11, stego: 7, armored: 5, titan: 1 }),
          ...toSpawns({ para: 4 }, 0, { healAura: true }),
        ],
      },
      chaos({ raptor: 32, swarm: 44, allosaur: 14, stego: 10, armored: 9, titan: 3 }),
    ],
    breach: {
      startGold: 450,
      tagline: "No mortar — pick off healers by hand",
      // Mortar splash trivializes clustered healing paras. Take it
      // away and the player has to focus-fire each healer with pulse
      // or burn them down with flame DoT before the aura cycles.
      forbiddenTowers: ["mortar"],
      waves: [
        mixed({ raptor: 20, swarm: 16, allosaur: 6 }),
        rush(90, 18),
        // Heavier healing convoy — five paras instead of three, the
        // raptor escort doubled, no mortar to splash through.
        {
          archetype: "convoy",
          spacing: 0.5,
          spawns: [
            { kind: "raptor", count: 10, pathIndex: 0 },
            ...toSpawns({ para: 5 }, 0, { healAura: true }),
            { kind: "raptor", count: 10, pathIndex: 0 },
          ],
        },
        heavy({ armored: 8, stego: 5, allosaur: 4 }),
        // Healing-buffed armored push — 5 armored fed by 3 healers,
        // no AoE to clear the healer cluster.
        {
          archetype: "heavy",
          spacing: 0.9,
          spawns: [
            ...toSpawns({ armored: 5, stego: 3, allosaur: 4 }),
            ...toSpawns({ para: 3 }, 0, { healAura: true }),
          ],
        },
        chaos({ raptor: 22, swarm: 28, allosaur: 10, stego: 5, armored: 3 }),
        rush(140, 30),
        // Healing + regen stack: paras keeping the regen stegos topped
        // off. Without mortar, picking off healers is a precision burst job.
        {
          archetype: "heavy",
          spacing: 0.95,
          spawns: [
            ...toSpawns({ stego: 4 }, 0, { regen: true }),
            ...toSpawns({ armored: 8, titan: 1 }),
            ...toSpawns({ para: 3 }, 0, { healAura: true }),
          ],
        },
        // Chaos with shielded healers — bubbles delay the focus-burst
        // that's supposed to kill the healers.
        {
          archetype: "chaos",
          spacing: 0.28,
          spawns: [
            ...toSpawns({ raptor: 24, swarm: 28, allosaur: 10, stego: 6, armored: 3 }),
            ...toSpawns({ para: 4 }, 0, { shielded: true, healAura: true }),
          ],
        },
        heavy({ armored: 18, stego: 9, allosaur: 7, titan: 2 }),
        chaos({ raptor: 30, swarm: 40, allosaur: 13, stego: 8, armored: 7, titan: 3 }),
      ],
    },
    containment: {
      startGold: 460,
      tagline: "One life. Pulse, chain, flame, hive. Stop the healers.",
      // Anti-heal precision comp: pulse for burst-killing healers,
      // chain for shield chip, flame DoT to outpace regen, hive to
      // amp the rate-of-fire. No cryo, no mortar.
      lockedLoadout: ["pulse", "chain", "flame", "hive"],
      singleLife: true,
      noSelling: true,
      waves: [
        mixed({ raptor: 18, swarm: 14, allosaur: 5 }),
        rush(75, 14),
        {
          archetype: "convoy",
          spacing: 0.55,
          spawns: [
            { kind: "raptor", count: 6, pathIndex: 0 },
            ...toSpawns({ para: 3 }, 0, { healAura: true }),
            { kind: "raptor", count: 6, pathIndex: 0 },
          ],
        },
        heavy({ armored: 7, stego: 4, allosaur: 3 }),
        {
          archetype: "heavy",
          spacing: 0.9,
          spawns: [
            ...toSpawns({ armored: 4, stego: 3, allosaur: 3 }),
            ...toSpawns({ para: 2 }, 0, { healAura: true }),
          ],
        },
        chaos({ raptor: 18, swarm: 24, allosaur: 8, stego: 4, armored: 2 }),
        heavy({ armored: 13, stego: 7, allosaur: 5, titan: 1 }),
        chaos({ raptor: 26, swarm: 32, allosaur: 11, stego: 7, armored: 6, titan: 2 }),
      ],
    },
  },
  {
    id: 14,
    name: "Shardspike Peak",
    paths: [p(-20, 0, -14, 6, -10, 2, -6, 8, -2, 2, 2, 8, 6, 2, 10, -4, 14, 2, 18, -4, 20, 0)],
    startGold: 140,
    nodePos: { x: 9, y: 4 },
    hpScale: 2.1,
    countScale: 1.5,
    waves: [
      intro(22, 18),
      mixed({ raptor: 24, swarm: 18, allosaur: 8, stego: 3 }),
      rush(125, 26),
      // Regen debut: a small group of regen stegos. Slow self-heal so
      // chip-damage towers (cryo cold tick, hive drones, flame DoT)
      // can't whittle from a distance — sustained burst is required.
      // Pause-on-damage means a bursty pulse rifle wins; a slow mortar
      // gives them time to recover between shots.
      {
        archetype: "trickle",
        spacing: 1.5,
        spawns: [...toSpawns({ stego: 5 }, 0, { regen: true })],
      },
      echelon([{ raptor: 26, swarm: 22 }, { allosaur: 10, stego: 5 }, { armored: 5 }]),
      // Shielded healing paras behind raptor cover — both chips on the
      // same enemy. Shield blunts focus fire, aura props the cover up.
      // Hive's sentinel upgrade carves through this; nothing else
      // really does.
      {
        archetype: "convoy",
        spacing: 0.45,
        spawns: [
          { kind: "raptor", count: 10, pathIndex: 0 },
          ...toSpawns({ para: 4 }, 0, { shielded: true, healAura: true }),
          { kind: "raptor", count: 10, pathIndex: 0 },
        ],
      },
      // Regen armored — the brick-that-heals. Anything not bursting
      // hard enough to keep regen paused gives them HP back. Ideal
      // place to teach "burst > sustain on this target."
      {
        archetype: "heavy",
        spacing: 0.95,
        spawns: [
          ...toSpawns({ armored: 5 }, 0, { regen: true }),
          ...toSpawns({ stego: 6, allosaur: 6, titan: 2 }),
        ],
      },
      // Shielded armored escort plus shielded healing paras — break an
      // armored shield, watch a healer top it right back up.
      {
        archetype: "heavy",
        spacing: 0.8,
        spawns: [
          ...toSpawns({ armored: 6, stego: 4 }, 0, { shielded: true }),
          ...toSpawns({ para: 3 }, 0, { shielded: true, healAura: true }),
          ...toSpawns({ allosaur: 6 }),
        ],
      },
      heavy({ armored: 20, stego: 11, allosaur: 8, titan: 3 }),
      // Flame-resistant ("Asbestos") allosaur minority — DoT pyre spam
      // slides off them, so the player needs kinetic/explosive burst to
      // finish or watches them barrel through with full HP.
      withSpecialist(
        chaos({ raptor: 34, swarm: 48, allosaur: 11, stego: 9, armored: 8, titan: 3 }),
        {
          kind: "allosaur",
          count: 4,
          resists: RESIST_FLAME_95,
        },
      ),
    ],
    // Breach — no mortar, no flame. The lesson level for regen + shielded
    // healers becomes a precision-DPS exam: no AoE chip, no DoT crutch.
    // Cryo's slow + hive sentinel + chain bounces have to carry the
    // regen-armored bricks; pulse focus fire is the burst answer. Modest
    // gold bump because losing two whole tower kinds bites hard on its own.
    breach: {
      startGold: 280,
      forbiddenTowers: ["mortar", "flame"],
      tagline: "Precision only — no splash, no burn.",
      waves: [
        intro(22, 18),
        mixed({ raptor: 24, swarm: 20, allosaur: 9, stego: 4 }),
        rush(120, 26),
        heavy({ armored: 12, stego: 7, allosaur: 5 }),
        // Breach regen group — double the introduction count and stack a
        // regen allosaur on top, so chain bounces don't quite outpace the
        // self-heal.
        {
          archetype: "trickle",
          spacing: 1.4,
          spawns: [
            ...toSpawns({ stego: 6 }, 0, { regen: true }),
            ...toSpawns({ allosaur: 4 }, 0, { regen: true }),
          ],
        },
        echelon([{ raptor: 28, swarm: 24 }, { allosaur: 11, stego: 6 }, { armored: 7 }]),
        // Double the shielded healing-para convoy — two healer pods, more
        // raptor cover. Sentinel-mode hive or chain anti-shield required.
        {
          archetype: "convoy",
          spacing: 0.4,
          spawns: [
            { kind: "raptor", count: 12, pathIndex: 0 },
            ...toSpawns({ para: 4 }, 0, { shielded: true, healAura: true }),
            { kind: "raptor", count: 12, pathIndex: 0 },
            ...toSpawns({ para: 3 }, 0, { shielded: true, healAura: true }),
            { kind: "allosaur", count: 5, pathIndex: 0 },
          ],
        },
        chaos({ raptor: 28, swarm: 36, allosaur: 13, stego: 7, armored: 5, titan: 2 }),
        rush(170, 38),
        // Regen-armored wall — eight bricks that all heal between hits.
        // Without mortar splash or flame DoT, only sustained focus fire
        // (chain into the lead, pulse on follow-up) keeps them paused.
        {
          archetype: "heavy",
          spacing: 0.9,
          spawns: [
            ...toSpawns({ armored: 8 }, 0, { regen: true }),
            ...toSpawns({ stego: 8, allosaur: 8, titan: 3 }),
          ],
        },
        // Shielded armored + shielded healing paras + a regen stego sprinkled
        // in — the level's signature combo cranked up.
        {
          archetype: "heavy",
          spacing: 0.75,
          spawns: [
            ...toSpawns({ armored: 9, stego: 5 }, 0, { shielded: true }),
            ...toSpawns({ para: 4 }, 0, { shielded: true, healAura: true }),
            ...toSpawns({ stego: 3 }, 0, { regen: true }),
            ...toSpawns({ allosaur: 8 }),
          ],
        },
        heavy({ armored: 24, stego: 13, allosaur: 10, titan: 4 }),
        chaos({ raptor: 42, swarm: 58, allosaur: 17, stego: 11, armored: 10, titan: 4 }),
      ],
    },
    // Containment — pulse + chain + cryo. No AoE, no DoT, no support drones.
    // Single life, no selling. You pick three turret kinds, you live or
    // die with them. Generous starting gold for the opening commitment.
    containment: {
      startGold: 420,
      lockedLoadout: ["pulse", "chain", "cryo"],
      singleLife: true,
      noSelling: true,
      tagline: "Three turrets, one life.",
      waves: [
        intro(18, 14),
        mixed({ raptor: 20, swarm: 14, allosaur: 6, stego: 2 }),
        rush(80, 16),
        heavy({ armored: 8, stego: 4, allosaur: 4 }),
        {
          archetype: "trickle",
          spacing: 1.6,
          spawns: [...toSpawns({ stego: 4 }, 0, { regen: true })],
        },
        echelon([{ raptor: 22, swarm: 18 }, { allosaur: 8, stego: 4 }, { armored: 4 }]),
        {
          archetype: "convoy",
          spacing: 0.5,
          spawns: [
            { kind: "raptor", count: 8, pathIndex: 0 },
            ...toSpawns({ para: 3 }, 0, { shielded: true, healAura: true }),
            { kind: "raptor", count: 8, pathIndex: 0 },
          ],
        },
        chaos({ raptor: 20, swarm: 26, allosaur: 9, stego: 5, armored: 3, titan: 1 }),
        rush(125, 26),
        {
          archetype: "heavy",
          spacing: 1.0,
          spawns: [
            ...toSpawns({ armored: 4 }, 0, { regen: true }),
            ...toSpawns({ stego: 5, allosaur: 5, titan: 1 }),
          ],
        },
        {
          archetype: "heavy",
          spacing: 0.85,
          spawns: [
            ...toSpawns({ armored: 5, stego: 3 }, 0, { shielded: true }),
            ...toSpawns({ para: 2 }, 0, { shielded: true, healAura: true }),
            ...toSpawns({ allosaur: 5 }),
          ],
        },
        heavy({ armored: 16, stego: 9, allosaur: 6, titan: 2 }),
        chaos({ raptor: 30, swarm: 40, allosaur: 12, stego: 7, armored: 6, titan: 2 }),
      ],
    },
  },
  {
    id: 15,
    name: "Broken Spire",
    paths: [p(-20, 10, -14, 10, -10, 4, -4, 4, -2, -4, 4, -4, 6, 2, 12, 2, 14, -8, 20, -8)],
    startGold: 140,
    nodePos: { x: 20, y: 1 },
    hpScale: 1.45,
    waves: [
      mixed({ raptor: 20, swarm: 16, para: 5, allosaur: 6, stego: 2 }),
      heavy({ armored: 10, stego: 6, allosaur: 5 }),
      chaos({ raptor: 24, swarm: 32, para: 7, allosaur: 10, stego: 6, armored: 4 }),
      rush(155, 32),
      // Heavy debut: armored plate leads, plain pack trails.
      {
        archetype: "vanguard",
        spacing: 0.5,
        spawns: [...toSpawns({ stego: 2 }, 0), ...toSpawns({ raptor: 22, allosaur: 8, stego: 5 })],
      },
      // Dense raptor swarm tests leak coverage.
      {
        archetype: "swarm",
        spacing: 0.12,
        spawns: [...toSpawns({ raptor: 36, swarm: 28 }, 0)],
      },
      // Heavy armored breach riding a dense tank pack.
      {
        archetype: "heavy",
        spacing: 0.85,
        spawns: [...toSpawns({ armored: 3 }, 0), ...toSpawns({ stego: 7, allosaur: 7, titan: 2 })],
      },
      heavy({ armored: 20, stego: 11, allosaur: 8, titan: 3 }),
      // Mixed-defense penultimate: shielded healing paras + plain push +
      // a small explosive-resistant ("Bunker") stego pocket. Mortar spam
      // bounces off the bunker stegos, so the wave demands a second hard
      // counter alongside the anti-shield/anti-heal answers.
      {
        archetype: "chaos",
        spacing: 0.27,
        spawns: [
          ...toSpawns({ para: 4 }, 0, { shielded: true, healAura: true }),
          ...toSpawns({ raptor: 28, swarm: 36, allosaur: 12, stego: 5, armored: 5, titan: 2 }),
          ...toSpawns({ stego: 4 }, 0, { resists: RESIST_EXPLOSIVE_95 }),
        ],
      },
      // Boss wave: the Parasaur Matriarch. Crested resonator — chain
      // damage rings through her at 1.7× but her sprint is fast enough
      // that the player has to commit slow + AoE early. Para children
      // pile up every 2.2 seconds; bring shield-busters or watch the
      // lane drown in support targets.
      {
        archetype: "convoy",
        spacing: 0.55,
        bossWave: true,
        spawns: [
          ...toSpawns({ armored: 2 }, 0),
          ...toSpawns({ allosaur: 3, stego: 2, armored: 2 }),
          ...toSpawns({ stego: 1 }, 0, { regen: true }),
          bossSpawn("para", 0),
        ],
        bossTrickle: [
          trickleStream(0, ["swarm", "raptor", "allosaur"], 1.4, 2.0, 6),
          trickleStream(0, ["raptor", "allosaur", "para"], 0.9, 1.5, 22),
        ],
      },
    ],
    // Breach: no mortar. The explosive splash answer to the para
    // matriarch's child stream is gone, so the player must rely on
    // chain-bounce + flame DoT for AoE. Extra gold + a leaner wave
    // count keeps it tractable; the boss still appears at the end with
    // a denser child trickle to keep the pressure honest.
    breach: {
      startGold: 540,
      forbiddenTowers: ["mortar"],
      tagline: "No Mortar. The matriarch's brood floods the lane.",
      waves: [
        mixed({ raptor: 18, swarm: 14, para: 5, allosaur: 5, stego: 2 }),
        rush(100, 20),
        heavy({ armored: 9, stego: 6, allosaur: 5 }),
        chaos({ raptor: 22, swarm: 28, para: 6, allosaur: 9, stego: 6, armored: 4 }),
        {
          archetype: "vanguard",
          spacing: 0.5,
          spawns: [
            ...toSpawns({ stego: 2 }, 0),
            ...toSpawns({ raptor: 20, allosaur: 7, stego: 4 }),
          ],
        },
        {
          archetype: "swarm",
          spacing: 0.12,
          spawns: [...toSpawns({ raptor: 34, swarm: 26 }, 0)],
        },
        {
          archetype: "heavy",
          spacing: 0.85,
          spawns: [
            ...toSpawns({ armored: 3 }, 0),
            ...toSpawns({ stego: 6, allosaur: 7, titan: 1 }),
          ],
        },
        heavy({ armored: 18, stego: 10, allosaur: 7, titan: 2 }),
        {
          archetype: "chaos",
          spacing: 0.28,
          spawns: [
            ...toSpawns({ para: 4 }, 0, { shielded: true, healAura: true }),
            ...toSpawns({ raptor: 26, swarm: 32, allosaur: 11, stego: 7, armored: 5, titan: 1 }),
          ],
        },
        // Breach boss: same matriarch, denser entourage, faster child
        // trickle. Without mortar splash the player needs chain bounce
        // tuned for boss + escort focus, plus flame DoT to clip the
        // shield-stripped paras coming out of her.
        {
          archetype: "convoy",
          spacing: 0.5,
          bossWave: true,
          spawns: [
            ...toSpawns({ armored: 3 }, 0),
            ...toSpawns({ allosaur: 4, stego: 3, armored: 3 }),
            ...toSpawns({ stego: 2 }, 0, { regen: true }),
            bossSpawn("para", 0),
          ],
          bossTrickle: [
            trickleStream(0, ["swarm", "raptor", "allosaur"], 1.2, 1.8, 5),
            trickleStream(0, ["raptor", "allosaur", "para"], 0.8, 1.3, 18),
          ],
        },
      ],
    },
    // Containment: one life, locked to Chain + Cryo + Hive — no kinetic, no
    // explosive, no flame. Pure crowd-control: cryo slows the para
    // matriarch to a crawl while chain bounces clear her brood and
    // hive drones extend chain coverage to the second corridor. Big
    // gold pool because the whole defense must commit before wave 1
    // and never sell.
    containment: {
      startGold: 1100,
      lockedLoadout: ["chain", "cryo", "hive"],
      singleLife: true,
      noSelling: true,
      tagline: "1 life. Chain · Cryo · Hive. Slow the matriarch.",
      waves: [
        mixed({ raptor: 18, swarm: 14, para: 5, allosaur: 5, stego: 2 }),
        rush(95, 18),
        heavy({ armored: 8, stego: 5, allosaur: 4 }),
        chaos({ raptor: 22, swarm: 26, para: 6, allosaur: 8, stego: 5, armored: 3 }),
        {
          archetype: "swarm",
          spacing: 0.13,
          spawns: [...toSpawns({ raptor: 30, swarm: 24 }, 0)],
        },
        heavy({ armored: 14, stego: 8, allosaur: 6, titan: 1 }),
        {
          archetype: "convoy",
          spacing: 0.5,
          bossWave: true,
          spawns: [
            ...toSpawns({ armored: 3 }, 0),
            ...toSpawns({ allosaur: 4, stego: 3, armored: 3 }),
            bossSpawn("para", 0),
          ],
          bossTrickle: [
            trickleStream(0, ["swarm", "raptor", "allosaur"], 1.4, 2.0, 6),
            trickleStream(0, ["raptor", "allosaur", "para"], 0.9, 1.5, 20),
          ],
        },
      ],
    },
  },
  {
    id: 16,
    name: "Crimson Basin",
    // X-crossing: two paths that visually cross
    paths: [
      p(-20, -9, -10, -6, -2, -2, 0, 2, 6, 6, 14, 9, 20, 9),
      p(-20, 9, -10, 6, -2, 2, 0, -2, 6, -6, 14, -9, 20, -9),
    ],
    startGold: 170,
    nodePos: { x: 23, y: 9 },
    hpScale: 1.55,
    waves: [
      split("intro", 0.85, [0, { raptor: 14 }], [1, { raptor: 14 }]),
      split("swarm", 0.09, [0, { swarm: 70 }], [1, { swarm: 70 }]),
      split("heavy", 0.85, [0, { armored: 8, stego: 3 }], [1, { armored: 8, stego: 3 }]),
      split(
        "chaos",
        0.28,
        [0, { raptor: 18, swarm: 22, allosaur: 7, stego: 4, armored: 3 }],
        [1, { raptor: 18, swarm: 22, allosaur: 7, stego: 4, armored: 3 }],
      ),
      split("swarm", 0.07, [0, { swarm: 110, raptor: 14 }], [1, { swarm: 110, raptor: 14 }]),
      split(
        "heavy",
        0.8,
        [0, { armored: 14, stego: 8, allosaur: 6, titan: 2 }],
        [1, { armored: 14, stego: 8, allosaur: 6, titan: 2 }],
      ),
      split(
        "chaos",
        0.26,
        [0, { raptor: 22, swarm: 28, allosaur: 10, stego: 6, armored: 5, titan: 2 }],
        [1, { raptor: 22, swarm: 28, allosaur: 10, stego: 6, armored: 5, titan: 2 }],
      ),
      split(
        "chaos",
        0.22,
        [0, { raptor: 26, swarm: 32, allosaur: 12, stego: 10, armored: 9, titan: 4 }],
        [1, { raptor: 26, swarm: 32, allosaur: 12, stego: 10, armored: 9, titan: 4 }],
      ),
    ],
    // Breach — no cryo, no hive. Lose the slow + the support drones,
    // both crucial for an X-crossing where one stuck pack feeds the
    // other lane. Mortar splash + chain bounces have to clear before
    // the crossover floods. Heavies are uplifted, shielded armor lands
    // on both lanes, and the closer waves squeeze spacing.
    breach: {
      startGold: 320,
      forbiddenTowers: ["cryo", "hive"],
      tagline: "Full-speed two-front war. No slow, no drones.",
      waves: [
        split("intro", 0.85, [0, { raptor: 14 }], [1, { raptor: 14 }]),
        split(
          "mixed",
          0.5,
          [0, { raptor: 16, swarm: 12, allosaur: 2 }],
          [1, { raptor: 16, swarm: 12, allosaur: 2 }],
        ),
        split("swarm", 0.08, [0, { swarm: 70 }], [1, { swarm: 70 }]),
        // Shielded armored on both lanes — no slow means break the
        // bubble fast or watch the bricks barrel through the crossover.
        {
          archetype: "heavy",
          spacing: 0.85,
          spawns: [
            ...toSpawns({ armored: 7, stego: 3 }, 0, { shielded: true }),
            ...toSpawns({ armored: 7, stego: 3 }, 1, { shielded: true }),
          ],
        },
        split(
          "mixed",
          0.45,
          [0, { raptor: 18, swarm: 14, allosaur: 6, stego: 3 }],
          [1, { raptor: 18, swarm: 14, allosaur: 6, stego: 3 }],
        ),
        split(
          "chaos",
          0.28,
          [0, { raptor: 18, swarm: 22, allosaur: 6, stego: 4, armored: 3 }],
          [1, { raptor: 18, swarm: 22, allosaur: 6, stego: 4, armored: 3 }],
        ),
        split("swarm", 0.07, [0, { swarm: 110, raptor: 14 }], [1, { swarm: 110, raptor: 14 }]),
        split(
          "heavy",
          0.8,
          [0, { armored: 11, stego: 5, allosaur: 5, titan: 2 }],
          [1, { armored: 11, stego: 5, allosaur: 5, titan: 1 }],
        ),
        // Mixed asymmetric: top lane heavier on armor, bottom heavier on
        // swarm + allosaur. Forces split-attention placements with no
        // hive drones to relocate the support.
        split(
          "mixed",
          0.42,
          [0, { raptor: 20, swarm: 14, allosaur: 10, stego: 6, armored: 3 }],
          [1, { raptor: 22, swarm: 18, allosaur: 10, stego: 6, armored: 3 }],
        ),
        split(
          "heavy",
          0.75,
          [0, { armored: 14, stego: 8, allosaur: 6, titan: 2 }],
          [1, { armored: 14, stego: 8, allosaur: 6, titan: 2 }],
        ),
        split(
          "chaos",
          0.25,
          [0, { raptor: 22, swarm: 28, allosaur: 10, stego: 6, armored: 5, titan: 2 }],
          [1, { raptor: 22, swarm: 28, allosaur: 10, stego: 6, armored: 5, titan: 2 }],
        ),
        // Final crescendo — titans on both lanes, more armor than normal.
        split(
          "chaos",
          0.22,
          [0, { raptor: 26, swarm: 32, allosaur: 12, stego: 10, armored: 9, titan: 4 }],
          [1, { raptor: 26, swarm: 32, allosaur: 12, stego: 10, armored: 9, titan: 4 }],
        ),
      ],
    },
    // Containment — pulse + chain + mortar. Kinetic precision, chain bounces
    // for swarms, mortar for armor. No slow to buy time, no flame for
    // DoT, no hive for buffs. Single life, no selling.
    containment: {
      startGold: 460,
      lockedLoadout: ["pulse", "chain", "mortar"],
      singleLife: true,
      noSelling: true,
      tagline: "Kinetic, electric, explosive — no margin.",
      waves: [
        split("intro", 0.9, [0, { raptor: 12 }], [1, { raptor: 12 }]),
        split("mixed", 0.55, [0, { raptor: 14, swarm: 10 }], [1, { raptor: 14, swarm: 10 }]),
        split("swarm", 0.1, [0, { swarm: 55 }], [1, { swarm: 55 }]),
        split("heavy", 0.9, [0, { armored: 6, stego: 2 }], [1, { armored: 6, stego: 2 }]),
        split(
          "mixed",
          0.5,
          [0, { raptor: 16, swarm: 12, allosaur: 5, stego: 2 }],
          [1, { raptor: 16, swarm: 12, allosaur: 5, stego: 2 }],
        ),
        split(
          "chaos",
          0.3,
          [0, { raptor: 14, swarm: 18, allosaur: 5, stego: 3, armored: 2 }],
          [1, { raptor: 14, swarm: 18, allosaur: 5, stego: 3, armored: 2 }],
        ),
        split("swarm", 0.08, [0, { swarm: 90, raptor: 10 }], [1, { swarm: 90, raptor: 10 }]),
        split(
          "heavy",
          0.85,
          [0, { armored: 9, stego: 4, allosaur: 4, titan: 1 }],
          [1, { armored: 9, stego: 4, allosaur: 4 }],
        ),
        split(
          "mixed",
          0.45,
          [0, { raptor: 18, swarm: 14, allosaur: 8, stego: 5, armored: 2 }],
          [1, { raptor: 18, swarm: 14, allosaur: 8, stego: 5, armored: 2 }],
        ),
        split(
          "heavy",
          0.8,
          [0, { armored: 12, stego: 7, allosaur: 5, titan: 1 }],
          [1, { armored: 12, stego: 7, allosaur: 5, titan: 1 }],
        ),
        split(
          "chaos",
          0.28,
          [0, { raptor: 18, swarm: 22, allosaur: 8, stego: 5, armored: 4, titan: 1 }],
          [1, { raptor: 18, swarm: 22, allosaur: 8, stego: 5, armored: 4, titan: 1 }],
        ),
        split(
          "chaos",
          0.25,
          [0, { raptor: 22, swarm: 26, allosaur: 10, stego: 8, armored: 7, titan: 3 }],
          [1, { raptor: 22, swarm: 26, allosaur: 10, stego: 8, armored: 7, titan: 3 }],
        ),
      ],
    },
  },
  {
    id: 17,
    name: "Drakespine Ridge",
    paths: [
      p(
        -20,
        8,
        -16,
        8,
        -16,
        2,
        -12,
        2,
        -12,
        8,
        -6,
        8,
        -6,
        2,
        0,
        2,
        0,
        8,
        6,
        8,
        6,
        2,
        12,
        2,
        12,
        8,
        18,
        8,
        18,
        0,
        20,
        0,
      ),
    ],
    startGold: 140,
    nodePos: { x: 12, y: 12 },
    hpScale: 1.7,
    waves: [
      mixed({ raptor: 24, swarm: 20, allosaur: 8, stego: 3 }),
      rush(120, 25),
      heavy({ armored: 12, stego: 7, allosaur: 5 }),
      chaos({ raptor: 26, swarm: 34, allosaur: 10, stego: 5, armored: 3 }),
      heavy({ armored: 18, stego: 10, allosaur: 8, titan: 2 }),
      trickle({ stego: 6, armored: 5, allosaur: 8 }),
      rush(155, 36),
      // Cold-resistant ("Thermal") swarm minority — cryo spam can no
      // longer freeze-and-melt the whole hatchling stream. Player needs
      // chain or flame to mop up the thermal swarm specifically.
      withSpecialist(
        chaos({ raptor: 36, swarm: 38, allosaur: 16, stego: 11, armored: 9, titan: 3 }),
        {
          kind: "swarm",
          count: 14,
          resists: RESIST_COLD_95,
        },
      ),
      chaos({ raptor: 44, swarm: 56, allosaur: 18, stego: 14, armored: 12, titan: 5 }),
    ],
    // Breach — no pulse, no hive. The kinetic workhorse and the drone
    // support both gone. Chain handles swarm waves, cryo + mortar must
    // anchor the armored push, flame chews the regen brick later.
    // Adds a heavy leader to several waves to sand off the resist
    // crutch, plus a regen-stego trickle that previously didn't exist.
    breach: {
      startGold: 320,
      forbiddenTowers: ["pulse", "hive"],
      tagline: "No kinetic, no drones. Chain, cold, splash, burn.",
      waves: [
        mixed({ raptor: 22, swarm: 18, allosaur: 8, stego: 3 }),
        rush(110, 22),
        mixed({ raptor: 28, swarm: 24, allosaur: 10, stego: 5 }),
        {
          archetype: "vanguard",
          spacing: 0.55,
          spawns: [
            ...toSpawns({ armored: 2 }, 0),
            ...toSpawns({ armored: 11, stego: 7, allosaur: 5 }),
          ],
        },
        chaos({ raptor: 26, swarm: 34, allosaur: 10, stego: 6, armored: 3 }),
        rush(140, 28),
        heavy({ armored: 17, stego: 9, allosaur: 7, titan: 1 }),
        // Regen-stego trickle — slow, fat, self-healing. Flame DoT or
        // chained focus fire is the only way to keep regen paused.
        {
          archetype: "trickle",
          spacing: 1.5,
          spawns: [
            ...toSpawns({ stego: 8 }, 0, { regen: true }),
            ...toSpawns({ armored: 5, allosaur: 8 }),
          ],
        },
        chaos({ raptor: 28, swarm: 38, allosaur: 12, stego: 7, armored: 5, titan: 2 }),
        // Shielded armored + heavy stego — chain's anti-shield bounce
        // wins this if placed early in the corkscrew.
        {
          archetype: "heavy",
          spacing: 0.85,
          spawns: [
            ...toSpawns({ armored: 10 }, 0, { shielded: true }),
            ...toSpawns({ stego: 2 }, 0),
            ...toSpawns({ stego: 7, allosaur: 7, titan: 2 }),
          ],
        },
        rush(155, 36),
        chaos({ raptor: 40, swarm: 56, allosaur: 17, stego: 11, armored: 9, titan: 4 }),
        chaos({ raptor: 46, swarm: 60, allosaur: 20, stego: 15, armored: 13, titan: 5 }),
      ],
    },
    // Containment — chain + cryo + flame. No kinetic, no splash, no drones.
    // Chain bounces for swarm, cryo slows, flame chews regen and dense
    // packs. Single life, no selling.
    containment: {
      startGold: 420,
      lockedLoadout: ["chain", "cryo", "flame"],
      singleLife: true,
      noSelling: true,
      tagline: "Electric, cold, burn. No bullets.",
      waves: [
        mixed({ raptor: 20, swarm: 14, allosaur: 6, stego: 2 }),
        rush(90, 18),
        mixed({ raptor: 24, swarm: 20, allosaur: 8, stego: 4 }),
        heavy({ armored: 10, stego: 6, allosaur: 4 }),
        chaos({ raptor: 22, swarm: 28, allosaur: 8, stego: 4, armored: 2 }),
        rush(105, 22),
        heavy({ armored: 14, stego: 7, allosaur: 6, titan: 1 }),
        trickle({ stego: 6, armored: 4, allosaur: 8 }),
        chaos({ raptor: 24, swarm: 32, allosaur: 10, stego: 6, armored: 4, titan: 1 }),
        heavy({ armored: 18, stego: 9, allosaur: 7, titan: 2 }),
        rush(120, 28),
        chaos({ raptor: 34, swarm: 44, allosaur: 14, stego: 9, armored: 7, titan: 3 }),
        chaos({ raptor: 38, swarm: 48, allosaur: 16, stego: 12, armored: 10, titan: 4 }),
      ],
    },
  },
  {
    id: 18,
    name: "Shatterreef",
    paths: [
      p(-20, -10, -12, -10, -12, 10, -4, 10, -4, -10, 4, -10, 4, 10, 12, 10, 12, -10, 20, -10),
    ],
    startGold: 130,
    nodePos: { x: 1, y: 7 },
    hpScale: 1.9,
    waves: [
      intro(26, 22),
      rush(130, 28),
      convoy("allosaur", 14, "armored", 6),
      chaos({ raptor: 28, swarm: 36, allosaur: 12, stego: 7, armored: 5, titan: 2 }),
      rush(150, 34),
      heavy({ armored: 18, stego: 10, allosaur: 8, titan: 2 }),
      heavy({ armored: 22, stego: 12, allosaur: 10, titan: 3 }),
      chaos({ raptor: 40, swarm: 52, allosaur: 18, stego: 13, armored: 10, titan: 4 }),
      chaos({ raptor: 48, swarm: 60, allosaur: 20, stego: 16, armored: 13, titan: 6 }),
    ],
    // Breach — no chain, no flame. The crowd-clear staples are gone:
    // no electric bounce against swarms or shields, no DoT for regen
    // or dense packs. Pulse must headshot the leaders, mortar splash
    // chops the line, cryo buys cycle time, hive amplifies. Adds
    // heavy raptors and a shielded armored convoy to spike pressure.
    breach: {
      startGold: 400,
      forbiddenTowers: ["chain", "flame"],
      tagline: "No bounce, no burn. Pulse, splash, slow.",
      waves: [
        intro(26, 22),
        mixed({ raptor: 28, swarm: 22, allosaur: 9, stego: 4 }),
        rush(130, 30),
        // Shielded armored convoy — without chain there's no shield-shred
        // shortcut, mortar/pulse have to grind through bubble + body.
        {
          archetype: "convoy",
          spacing: 0.55,
          spawns: [
            { kind: "allosaur", count: 8, pathIndex: 0 },
            ...toSpawns({ armored: 7 }, 0, { shielded: true }),
            { kind: "allosaur", count: 8, pathIndex: 0 },
          ],
        },
        mixed({ raptor: 32, swarm: 28, allosaur: 12, stego: 7 }),
        chaos({ raptor: 28, swarm: 38, allosaur: 12, stego: 7, armored: 5, titan: 2 }),
        // Heavy raptor + swarm wall — leak math is brutal without
        // flame DoT to lock the lane down.
        {
          archetype: "swarm",
          spacing: 0.09,
          spawns: [...toSpawns({ raptor: 50, swarm: 90 }, 0)],
        },
        heavy({ armored: 20, stego: 10, allosaur: 8, titan: 2 }),
        mixed({ raptor: 36, swarm: 32, allosaur: 14, stego: 9 }),
        // Heavy-armored vanguard with regen tag — pulse focus fire only
        // way to keep regen paused.
        {
          archetype: "heavy",
          spacing: 0.9,
          spawns: [
            ...toSpawns({ armored: 3 }, 0, { regen: true }),
            ...toSpawns({ armored: 18, stego: 11, allosaur: 9, titan: 3 }),
          ],
        },
        chaos({ raptor: 40, swarm: 54, allosaur: 17, stego: 11, armored: 9, titan: 3 }),
        chaos({ raptor: 44, swarm: 58, allosaur: 20, stego: 14, armored: 11, titan: 4 }),
        chaos({ raptor: 50, swarm: 64, allosaur: 22, stego: 17, armored: 14, titan: 6 }),
      ],
    },
    // Containment — pulse + mortar + cryo. Kinetic + splash + slow, the
    // classic anti-everything loadout. No support, no DoT, no electric.
    // Single life, no selling — the late-tier serpentine is unforgiving.
    containment: {
      startGold: 400,
      lockedLoadout: ["pulse", "mortar", "cryo"],
      singleLife: true,
      noSelling: true,
      tagline: "Kinetic, splash, slow. One try.",
      waves: [
        intro(22, 18),
        mixed({ raptor: 24, swarm: 18, allosaur: 7, stego: 3 }),
        rush(100, 22),
        convoy("allosaur", 14, "armored", 6),
        mixed({ raptor: 28, swarm: 24, allosaur: 10, stego: 6 }),
        chaos({ raptor: 24, swarm: 32, allosaur: 10, stego: 6, armored: 4, titan: 1 }),
        rush(120, 28),
        heavy({ armored: 16, stego: 8, allosaur: 7, titan: 1 }),
        mixed({ raptor: 32, swarm: 28, allosaur: 12, stego: 8 }),
        heavy({ armored: 20, stego: 10, allosaur: 8, titan: 2 }),
        chaos({ raptor: 34, swarm: 46, allosaur: 14, stego: 9, armored: 7, titan: 2 }),
        chaos({ raptor: 38, swarm: 50, allosaur: 16, stego: 12, armored: 9, titan: 3 }),
        chaos({ raptor: 42, swarm: 54, allosaur: 18, stego: 14, armored: 11, titan: 5 }),
      ],
    },
  },
  {
    id: 19,
    name: "Threshold of Eschaton",
    // THREE paths: top-left entry, bottom-left entry, right-side entry, all converging toward center-exits
    paths: [
      p(-20, 9, -12, 9, -6, 4, 0, 0, 8, -4, 14, -4, 20, -4),
      p(-20, -9, -12, -9, -6, -4, 0, 0, 8, 4, 14, 4, 20, 4),
      p(20, 10, 14, 10, 6, 8, -2, 6, -8, 2, -14, 0, -20, 0),
    ],
    startGold: 220,
    nodePos: { x: -10, y: 11 },
    hpScale: 2.1,
    waves: [
      split(
        "mixed",
        0.55,
        [0, { raptor: 12, swarm: 8, allosaur: 2 }],
        [1, { raptor: 12, swarm: 8, allosaur: 2 }],
        [2, { raptor: 12, swarm: 8, allosaur: 2 }],
      ),
      split(
        "heavy",
        0.9,
        [0, { armored: 5, stego: 3 }],
        [1, { armored: 5, stego: 3 }],
        [2, { armored: 5, stego: 3 }],
      ),
      split(
        "chaos",
        0.28,
        [0, { raptor: 14, swarm: 18, allosaur: 5, stego: 3, armored: 2 }],
        [1, { raptor: 14, swarm: 18, allosaur: 5, stego: 3, armored: 2 }],
        [2, { raptor: 14, swarm: 18, allosaur: 5, stego: 3, armored: 2 }],
      ),
      split(
        "heavy",
        0.85,
        [0, { armored: 9, stego: 4, allosaur: 4, titan: 1 }],
        [1, { armored: 9, stego: 4, allosaur: 4, titan: 1 }],
        [2, { armored: 9, stego: 4, allosaur: 4, titan: 1 }],
      ),
      split(
        "chaos",
        0.26,
        [0, { raptor: 18, swarm: 22, allosaur: 7, stego: 5, armored: 4, titan: 1 }],
        [1, { raptor: 18, swarm: 22, allosaur: 7, stego: 5, armored: 4, titan: 1 }],
        [2, { raptor: 18, swarm: 22, allosaur: 7, stego: 5, armored: 4, titan: 1 }],
      ),
      split(
        "heavy",
        0.78,
        [0, { armored: 13, stego: 7, allosaur: 5, titan: 1 }],
        [1, { armored: 13, stego: 7, allosaur: 5, titan: 1 }],
        [2, { armored: 13, stego: 7, allosaur: 5, titan: 2 }],
      ),
      split("swarm", 0.07, [0, { swarm: 80 }], [1, { swarm: 80 }], [2, { swarm: 80 }]),
      split(
        "chaos",
        0.24,
        [0, { raptor: 22, swarm: 28, allosaur: 10, stego: 7, armored: 6, titan: 2 }],
        [1, { raptor: 22, swarm: 28, allosaur: 10, stego: 7, armored: 6, titan: 2 }],
        [2, { raptor: 22, swarm: 28, allosaur: 10, stego: 7, armored: 6, titan: 2 }],
      ),
      split(
        "chaos",
        0.21,
        [0, { raptor: 28, swarm: 34, allosaur: 12, stego: 10, armored: 9, titan: 4 }],
        [1, { raptor: 28, swarm: 34, allosaur: 12, stego: 10, armored: 9, titan: 4 }],
        [2, { raptor: 28, swarm: 34, allosaur: 12, stego: 10, armored: 9, titan: 4 }],
      ),
    ],
    // Breach: no mortar. Three converging lanes already make splash
    // king — yanking it forces pulse-DPS + chain-coverage to do the
    // tank work the splash circle was eating for free. Heavy waves
    // gain a shielded armored core and the chaos waves swap in a
    // heavy-raptor pack so single-leak coverage hurts more.
    breach: {
      startGold: 600,
      tagline: "No mortar. Triple-front armor breach.",
      forbiddenTowers: ["mortar"],
      waves: [
        split(
          "mixed",
          0.55,
          [0, { raptor: 12, swarm: 7 }],
          [1, { raptor: 12, swarm: 7 }],
          [2, { raptor: 12, swarm: 7 }],
        ),
        split("swarm", 0.1, [0, { swarm: 55 }], [1, { swarm: 55 }], [2, { swarm: 55 }]),
        // Shielded armored on every lane — first real test of "chain
        // cracks the bubble, pulse cleans up". With no mortar, the only
        // sustained answer is electric.
        {
          archetype: "heavy",
          spacing: 0.9,
          spawns: [
            ...toSpawns({ armored: 4, stego: 2 }, 0, { shielded: true }),
            ...toSpawns({ armored: 4, stego: 2 }, 1, { shielded: true }),
            ...toSpawns({ armored: 4, stego: 2 }, 2, { shielded: true }),
          ],
        },
        split(
          "mixed",
          0.45,
          [0, { raptor: 16, swarm: 12, allosaur: 4 }],
          [1, { raptor: 16, swarm: 12, allosaur: 4 }],
          [2, { raptor: 16, swarm: 12, allosaur: 4 }],
        ),
        // life-pool, so the "miss a couple" room of normal mode is gone.
        {
          archetype: "chaos",
          spacing: 0.28,
          spawns: [
            ...toSpawns({ raptor: 14, swarm: 16 }, 0),
            ...toSpawns({ allosaur: 4, stego: 2 }, 0),
            ...toSpawns({ raptor: 14, swarm: 16 }, 1),
            ...toSpawns({ allosaur: 4, stego: 2 }, 1),
            ...toSpawns({ raptor: 14, swarm: 16 }, 2),
            ...toSpawns({ allosaur: 4, stego: 2 }, 2),
          ],
        },
        split("swarm", 0.09, [0, { swarm: 70 }], [1, { swarm: 70 }], [2, { swarm: 70 }]),
        split(
          "heavy",
          0.88,
          [0, { armored: 9, stego: 4, allosaur: 4 }],
          [1, { armored: 9, stego: 4, allosaur: 4 }],
          [2, { armored: 9, stego: 4, allosaur: 4, titan: 1 }],
        ),
        split(
          "mixed",
          0.45,
          [0, { raptor: 18, swarm: 14, allosaur: 6, stego: 3 }],
          [1, { raptor: 18, swarm: 14, allosaur: 6, stego: 3 }],
          [2, { raptor: 18, swarm: 14, allosaur: 6, stego: 3 }],
        ),
        // Shielded armored + heavy stego punctuation — without mortar to
        // crack groups, chain is the only path through the bubble screen.
        {
          archetype: "heavy",
          spacing: 0.82,
          spawns: [
            ...toSpawns({ armored: 5 }, 0, { shielded: true }),
            ...toSpawns({ stego: 2 }, 0),
            ...toSpawns({ allosaur: 4 }, 0),
            ...toSpawns({ armored: 5 }, 1, { shielded: true }),
            ...toSpawns({ stego: 2 }, 1),
            ...toSpawns({ allosaur: 4 }, 1),
            ...toSpawns({ armored: 5 }, 2, { shielded: true }),
            ...toSpawns({ stego: 2 }, 2),
            ...toSpawns({ allosaur: 4 }, 2),
          ],
        },
        split("swarm", 0.08, [0, { swarm: 75 }], [1, { swarm: 75 }], [2, { swarm: 75 }]),
        split(
          "chaos",
          0.24,
          [0, { raptor: 20, swarm: 24, allosaur: 8, stego: 6, armored: 5, titan: 1 }],
          [1, { raptor: 20, swarm: 24, allosaur: 8, stego: 6, armored: 5, titan: 1 }],
          [2, { raptor: 20, swarm: 24, allosaur: 8, stego: 6, armored: 5, titan: 1 }],
        ),
        split(
          "heavy",
          0.78,
          [0, { armored: 14, stego: 7, allosaur: 5, titan: 2 }],
          [1, { armored: 14, stego: 7, allosaur: 5, titan: 2 }],
          [2, { armored: 14, stego: 7, allosaur: 5, titan: 2 }],
        ),
        // Breach finale: same chaos backbone, but with a stacked
        // titan per lane. Electric chain is the only single-tower answer
        // and it still has to be saturated across all three converging
        // entrances at once.
        {
          archetype: "chaos",
          spacing: 0.2,
          spawns: [
            ...toSpawns({ titan: 1 }, 0),
            ...toSpawns({ raptor: 24, swarm: 28, allosaur: 10, stego: 8, armored: 7, titan: 3 }, 0),
            ...toSpawns({ titan: 1 }, 1),
            ...toSpawns({ raptor: 24, swarm: 28, allosaur: 10, stego: 8, armored: 7, titan: 3 }, 1),
            ...toSpawns({ titan: 1 }, 2),
            ...toSpawns({ raptor: 24, swarm: 28, allosaur: 10, stego: 8, armored: 7, titan: 3 }, 2),
          ],
        },
      ],
    },
    // Containment: single life, no selling, locked to pulse / chain / cryo —
    // three towers that together cover three lanes (one per path is
    // the obvious play). No mortar means no easy heavy clear and no
    // flame means swarms can't be deleted at a chokepoint. Big start
    // bank funds the opening tri-lane committment.
    containment: {
      startGold: 700,
      tagline: "Locked: pulse / chain / cryo. One life, no selling.",
      lockedLoadout: ["pulse", "chain", "cryo"],
      singleLife: true,
      noSelling: true,
      waves: [
        split(
          "mixed",
          0.6,
          [0, { raptor: 10, swarm: 5 }],
          [1, { raptor: 10, swarm: 5 }],
          [2, { raptor: 10, swarm: 5 }],
        ),
        split("swarm", 0.12, [0, { swarm: 40 }], [1, { swarm: 40 }], [2, { swarm: 40 }]),
        split(
          "heavy",
          0.95,
          [0, { armored: 4, stego: 2 }],
          [1, { armored: 4, stego: 2 }],
          [2, { armored: 4, stego: 2 }],
        ),
        split(
          "mixed",
          0.5,
          [0, { raptor: 14, swarm: 10, allosaur: 3 }],
          [1, { raptor: 14, swarm: 10, allosaur: 3 }],
          [2, { raptor: 14, swarm: 10, allosaur: 3 }],
        ),
        split(
          "chaos",
          0.3,
          [0, { raptor: 12, swarm: 14, allosaur: 4, stego: 2 }],
          [1, { raptor: 12, swarm: 14, allosaur: 4, stego: 2 }],
          [2, { raptor: 12, swarm: 14, allosaur: 4, stego: 2 }],
        ),
        split("swarm", 0.1, [0, { swarm: 50 }], [1, { swarm: 50 }], [2, { swarm: 50 }]),
        split(
          "heavy",
          0.9,
          [0, { armored: 7, stego: 3, allosaur: 3 }],
          [1, { armored: 7, stego: 3, allosaur: 3 }],
          [2, { armored: 7, stego: 3, allosaur: 3 }],
        ),
        split(
          "mixed",
          0.48,
          [0, { raptor: 16, swarm: 12, allosaur: 5, stego: 3 }],
          [1, { raptor: 16, swarm: 12, allosaur: 5, stego: 3 }],
          [2, { raptor: 16, swarm: 12, allosaur: 5, stego: 3 }],
        ),
        split(
          "chaos",
          0.28,
          [0, { raptor: 14, swarm: 18, allosaur: 5, stego: 3, armored: 2 }],
          [1, { raptor: 14, swarm: 18, allosaur: 5, stego: 3, armored: 2 }],
          [2, { raptor: 14, swarm: 18, allosaur: 5, stego: 3, armored: 2 }],
        ),
        split(
          "heavy",
          0.85,
          [0, { armored: 10, stego: 5, allosaur: 4 }],
          [1, { armored: 10, stego: 5, allosaur: 4 }],
          [2, { armored: 10, stego: 5, allosaur: 4, titan: 1 }],
        ),
        split("swarm", 0.08, [0, { swarm: 60 }], [1, { swarm: 60 }], [2, { swarm: 60 }]),
        split(
          "chaos",
          0.26,
          [0, { raptor: 18, swarm: 22, allosaur: 7, stego: 5, armored: 4, titan: 1 }],
          [1, { raptor: 18, swarm: 22, allosaur: 7, stego: 5, armored: 4, titan: 1 }],
          [2, { raptor: 18, swarm: 22, allosaur: 7, stego: 5, armored: 4, titan: 1 }],
        ),
        split(
          "chaos",
          0.24,
          [0, { raptor: 20, swarm: 24, allosaur: 8, stego: 6, armored: 5, titan: 2 }],
          [1, { raptor: 20, swarm: 24, allosaur: 8, stego: 6, armored: 5, titan: 2 }],
          [2, { raptor: 20, swarm: 24, allosaur: 8, stego: 6, armored: 5, titan: 2 }],
        ),
        split(
          "chaos",
          0.22,
          [0, { raptor: 24, swarm: 28, allosaur: 10, stego: 8, armored: 7, titan: 3 }],
          [1, { raptor: 24, swarm: 28, allosaur: 10, stego: 8, armored: 7, titan: 3 }],
          [2, { raptor: 24, swarm: 28, allosaur: 10, stego: 8, armored: 7, titan: 3 }],
        ),
      ],
    },
  },
  {
    id: 20,
    name: "Extinction Point",
    // Two serpentines: upper weaving and lower weaving
    paths: [
      p(-20, 10, -14, 10, -14, 2, -8, 2, -8, 10, 0, 10, 0, 2, 8, 2, 8, 10, 14, 10, 14, 4, 20, 4),
      p(
        -20,
        -4,
        -14,
        -4,
        -14,
        -10,
        -6,
        -10,
        -6,
        -2,
        2,
        -2,
        2,
        -10,
        10,
        -10,
        10,
        -4,
        16,
        -4,
        16,
        -10,
        20,
        -10,
      ),
    ],
    startGold: 170,
    nodePos: { x: -24, y: 8 },
    hpScale: 2.5,
    waves: [
      split(
        "intro",
        0.8,
        [0, { raptor: 14, swarm: 8, para: 3 }],
        [1, { raptor: 14, swarm: 8, para: 3 }],
      ),
      split("swarm", 0.09, [0, { swarm: 75 }], [1, { swarm: 75 }]),
      split(
        "heavy",
        0.85,
        [0, { armored: 9, stego: 4, titan: 1 }],
        [1, { armored: 9, stego: 4, titan: 1 }],
      ),
      split(
        "chaos",
        0.27,
        [0, { raptor: 18, swarm: 24, para: 6, allosaur: 7, stego: 4, armored: 3, titan: 1 }],
        [1, { raptor: 18, swarm: 24, para: 6, allosaur: 7, stego: 4, armored: 3, titan: 1 }],
      ),
      split(
        "heavy",
        0.8,
        [0, { armored: 13, stego: 7, allosaur: 6, titan: 2 }],
        [1, { armored: 13, stego: 7, allosaur: 6, titan: 2 }],
      ),
      split(
        "chaos",
        0.25,
        [0, { raptor: 22, swarm: 28, para: 8, allosaur: 10, stego: 6, armored: 4, titan: 2 }],
        [1, { raptor: 22, swarm: 28, para: 8, allosaur: 10, stego: 6, armored: 4, titan: 2 }],
      ),
      split(
        "heavy",
        0.75,
        [0, { armored: 16, stego: 9, allosaur: 6, titan: 3 }],
        [1, { armored: 16, stego: 9, allosaur: 6, titan: 3 }],
      ),
      flamebreakSplit(0.06, [0, { swarm: 100 }], [1, { swarm: 100, raptor: 22 }]),
      split(
        "chaos",
        0.24,
        [0, { raptor: 24, swarm: 32, para: 10, allosaur: 12, stego: 9, armored: 7, titan: 3 }],
        [1, { raptor: 24, swarm: 32, para: 10, allosaur: 12, stego: 9, armored: 7, titan: 3 }],
      ),
      split(
        "chaos",
        0.22,
        [0, { raptor: 28, swarm: 38, para: 12, allosaur: 14, stego: 11, armored: 9, titan: 4 }],
        [1, { raptor: 28, swarm: 38, para: 12, allosaur: 14, stego: 11, armored: 9, titan: 4 }],
      ),
      // Penultimate: vanilla chaos plus a brace of kinetic-resistant
      // titans per lane ("Ironplate" titans). Pulse spam barely scrapes
      // them — the player needs chain or explosive to crack the lead
      // titans before the matriarchs land next wave.
      {
        archetype: "chaos",
        spacing: 0.2,
        spawns: [
          ...toSpawns(
            { raptor: 32, swarm: 42, para: 14, allosaur: 16, stego: 13, armored: 11, titan: 4 },
            0,
          ),
          ...toSpawns(
            { raptor: 32, swarm: 42, para: 14, allosaur: 16, stego: 13, armored: 11, titan: 4 },
            1,
          ),
          ...toSpawns({ titan: 1 }, 0, { resists: RESIST_KINETIC_95 }),
          ...toSpawns({ titan: 1 }, 1, { resists: RESIST_KINETIC_95 }),
        ],
      },
      // Boss wave: twin T-Rex Matriarchs, one per lane, flanked by
      // titan+armored entourages. The two-path map means the player
      // can't focus-fire one boss without leaving the other unchecked.
      // Each matriarch drops an allosaur every 3.8s — split coverage
      // becomes critical fast. Trickle is trimmed to one stream per
      // lane because the apex-predator child stream is doing the work.
      {
        archetype: "convoy",
        spacing: 0.5,
        bossWave: true,
        spawns: [
          ...toSpawns({ stego: 4, armored: 5, titan: 2 }, 0),
          ...toSpawns({ stego: 4, armored: 5, titan: 2 }, 1),
          bossSpawn("allosaur", 0),
          bossSpawn("allosaur", 1),
        ],
        bossTrickle: [
          trickleStream(0, ["swarm", "raptor", "allosaur"], 1.1, 1.7, 6),
          trickleStream(0, ["raptor", "allosaur", "para", "stego"], 0.8, 1.3, 22),
          trickleStream(1, ["swarm", "raptor", "allosaur"], 1.1, 1.7, 7),
          trickleStream(1, ["raptor", "allosaur", "para", "stego"], 0.8, 1.3, 23),
        ],
      },
    ],
    // Breach: no pulse. Pulse rifles are the apex-killer single-target
    // sustain — yank them and the two matriarchs become a real chase
    // problem. Chain still rings through the entourage, mortar
    // shreds the titan walls, cryo keeps the bosses honest. Heavy
    // waves arrive shielded; the matriarch wave brings a second
    // child-spawn cadence to keep the lanes busy.
    breach: {
      startGold: 500,
      tagline: "No pulse. Twin matriarchs, no single-target king.",
      forbiddenTowers: ["pulse"],
      waves: [
        split(
          "intro",
          0.8,
          [0, { raptor: 14, swarm: 8, para: 3 }],
          [1, { raptor: 14, swarm: 8, para: 3 }],
        ),
        split(
          "mixed",
          0.48,
          [0, { raptor: 16, swarm: 14, para: 4, allosaur: 5 }],
          [1, { raptor: 16, swarm: 14, para: 4, allosaur: 5 }],
        ),
        split("swarm", 0.09, [0, { swarm: 70 }], [1, { swarm: 70 }]),
        // Shielded armored heavy — first taste of "pop the bubble, then
        // the body" without pulse to hand-feed the body.
        {
          archetype: "heavy",
          spacing: 0.88,
          spawns: [
            ...toSpawns({ armored: 6, stego: 3, titan: 1 }, 0, { shielded: true }),
            ...toSpawns({ armored: 6, stego: 3 }, 1, { shielded: true }),
          ],
        },
        split(
          "mixed",
          0.45,
          [0, { raptor: 18, swarm: 16, para: 6, allosaur: 6, stego: 3 }],
          [1, { raptor: 18, swarm: 16, para: 6, allosaur: 6, stego: 3 }],
        ),
        split(
          "chaos",
          0.28,
          [0, { raptor: 16, swarm: 20, para: 5, allosaur: 6, stego: 4, armored: 2 }],
          [1, { raptor: 16, swarm: 20, para: 5, allosaur: 6, stego: 4, armored: 2 }],
        ),
        split("swarm", 0.07, [0, { swarm: 90 }], [1, { swarm: 90, raptor: 18 }]),
        // Convoy: shielded armored sandwich around a heavy stego — even
        // efficient. Chain is the budget answer; cryo keeps the brick slow.
        {
          archetype: "convoy",
          spacing: 0.8,
          spawns: [
            ...toSpawns({ armored: 5 }, 0, { shielded: true }),
            ...toSpawns({ stego: 2 }, 0),
            ...toSpawns({ allosaur: 4, titan: 1 }, 0),
            ...toSpawns({ armored: 5 }, 1, { shielded: true }),
            ...toSpawns({ stego: 2 }, 1),
            ...toSpawns({ allosaur: 4, titan: 1 }, 1),
          ],
        },
        split(
          "mixed",
          0.42,
          [0, { raptor: 20, swarm: 18, para: 7, allosaur: 8, stego: 5 }],
          [1, { raptor: 20, swarm: 18, para: 7, allosaur: 8, stego: 5 }],
        ),
        split(
          "chaos",
          0.26,
          [0, { raptor: 18, swarm: 24, para: 6, allosaur: 8, stego: 5, armored: 4, titan: 1 }],
          [1, { raptor: 18, swarm: 24, para: 6, allosaur: 8, stego: 5, armored: 4, titan: 1 }],
        ),
        split(
          "heavy",
          0.78,
          [0, { armored: 15, stego: 9, allosaur: 6, titan: 3 }],
          [1, { armored: 15, stego: 9, allosaur: 6, titan: 3 }],
        ),
        flamebreakSplit(0.06, [0, { swarm: 100, raptor: 20 }], [1, { swarm: 100, raptor: 20 }]),
        split(
          "chaos",
          0.24,
          [0, { raptor: 22, swarm: 30, para: 9, allosaur: 11, stego: 8, armored: 6, titan: 3 }],
          [1, { raptor: 22, swarm: 30, para: 9, allosaur: 11, stego: 8, armored: 6, titan: 3 }],
        ),
        split(
          "chaos",
          0.22,
          [0, { raptor: 26, swarm: 34, para: 11, allosaur: 13, stego: 10, armored: 8, titan: 4 }],
          [1, { raptor: 26, swarm: 34, para: 11, allosaur: 13, stego: 10, armored: 8, titan: 4 }],
        ),
        split(
          "chaos",
          0.2,
          [0, { raptor: 30, swarm: 38, para: 13, allosaur: 15, stego: 13, armored: 10, titan: 5 }],
          [1, { raptor: 30, swarm: 38, para: 13, allosaur: 15, stego: 13, armored: 10, titan: 5 }],
        ),
        // Boss wave: twin T-Rex Matriarchs again, but now with a heavy
        // titan riding each lane and a third trickle stream of shielded
        // raptors. No pulse means the player can't focus-fire a queen
        // down — the answer is chain saturation + cryo lockdown + mortar
        // splash to chew the brood.
        {
          archetype: "convoy",
          spacing: 0.48,
          bossWave: true,
          spawns: [
            ...toSpawns({ titan: 1 }, 0),
            ...toSpawns({ stego: 4, armored: 6, titan: 2 }, 0),
            ...toSpawns({ titan: 1 }, 1),
            ...toSpawns({ stego: 4, armored: 6, titan: 2 }, 1),
            bossSpawn("allosaur", 0),
            bossSpawn("allosaur", 1),
          ],
          bossTrickle: [
            trickleStream(0, ["swarm", "raptor", "allosaur"], 1.0, 1.5, 6),
            trickleStream(0, ["raptor", "allosaur", "para", "stego"], 0.7, 1.2, 22),
            trickleStream(0, ["raptor", "allosaur", "armored"], 0.8, 1.4, 36, { shielded: true }),
            trickleStream(1, ["swarm", "raptor", "allosaur"], 1.0, 1.5, 7),
            trickleStream(1, ["raptor", "allosaur", "para", "stego"], 0.7, 1.2, 23),
            trickleStream(1, ["raptor", "allosaur", "armored"], 0.8, 1.4, 37, { shielded: true }),
          ],
        },
      ],
    },
    // Containment: locked to chain / mortar / cryo. No pulse, no flame, no
    // hive support — the toolkit is "ring damage, splash damage,
    // slows". Single life means the apex matriarch wave is the
    // payoff for surviving 16 waves; the loadout is built for it.
    containment: {
      startGold: 550,
      tagline: "Locked: chain / mortar / cryo. One life, no selling.",
      lockedLoadout: ["chain", "mortar", "cryo"],
      singleLife: true,
      noSelling: true,
      waves: [
        split(
          "intro",
          0.85,
          [0, { raptor: 12, swarm: 6, para: 2 }],
          [1, { raptor: 12, swarm: 6, para: 2 }],
        ),
        split(
          "mixed",
          0.5,
          [0, { raptor: 14, swarm: 12, para: 3, allosaur: 4 }],
          [1, { raptor: 14, swarm: 12, para: 3, allosaur: 4 }],
        ),
        split("swarm", 0.1, [0, { swarm: 60 }], [1, { swarm: 60 }]),
        split("heavy", 0.9, [0, { armored: 7, stego: 3, titan: 1 }], [1, { armored: 7, stego: 3 }]),
        split(
          "mixed",
          0.48,
          [0, { raptor: 16, swarm: 14, para: 5, allosaur: 5, stego: 3 }],
          [1, { raptor: 16, swarm: 14, para: 5, allosaur: 5, stego: 3 }],
        ),
        split(
          "chaos",
          0.3,
          [0, { raptor: 14, swarm: 18, para: 4, allosaur: 5, stego: 3, armored: 2 }],
          [1, { raptor: 14, swarm: 18, para: 4, allosaur: 5, stego: 3, armored: 2 }],
        ),
        split("swarm", 0.08, [0, { swarm: 75 }], [1, { swarm: 75, raptor: 14 }]),
        split(
          "heavy",
          0.85,
          [0, { armored: 10, stego: 5, allosaur: 4, titan: 1 }],
          [1, { armored: 10, stego: 5, allosaur: 4, titan: 1 }],
        ),
        split(
          "mixed",
          0.45,
          [0, { raptor: 18, swarm: 16, para: 6, allosaur: 7, stego: 4 }],
          [1, { raptor: 18, swarm: 16, para: 6, allosaur: 7, stego: 4 }],
        ),
        split(
          "chaos",
          0.28,
          [0, { raptor: 16, swarm: 22, para: 5, allosaur: 7, stego: 4, armored: 3, titan: 1 }],
          [1, { raptor: 16, swarm: 22, para: 5, allosaur: 7, stego: 4, armored: 3, titan: 1 }],
        ),
        split(
          "heavy",
          0.8,
          [0, { armored: 14, stego: 8, allosaur: 5, titan: 2 }],
          [1, { armored: 14, stego: 8, allosaur: 5, titan: 2 }],
        ),
        flamebreakSplit(0.07, [0, { swarm: 85 }], [1, { swarm: 85, raptor: 18 }]),
        split(
          "chaos",
          0.26,
          [0, { raptor: 20, swarm: 28, para: 8, allosaur: 10, stego: 7, armored: 5, titan: 2 }],
          [1, { raptor: 20, swarm: 28, para: 8, allosaur: 10, stego: 7, armored: 5, titan: 2 }],
        ),
        split(
          "chaos",
          0.24,
          [0, { raptor: 24, swarm: 32, para: 10, allosaur: 12, stego: 9, armored: 7, titan: 3 }],
          [1, { raptor: 24, swarm: 32, para: 10, allosaur: 12, stego: 9, armored: 7, titan: 3 }],
        ),
        split(
          "chaos",
          0.22,
          [0, { raptor: 28, swarm: 36, para: 12, allosaur: 14, stego: 12, armored: 9, titan: 4 }],
          [1, { raptor: 28, swarm: 36, para: 12, allosaur: 14, stego: 12, armored: 9, titan: 4 }],
        ),
        // Containment boss wave: twin matriarchs as the normal mode, but
        // entourage trimmed so the locked chain/mortar/cryo loadout
        // can actually field enough coverage on two lanes.
        {
          archetype: "convoy",
          spacing: 0.5,
          bossWave: true,
          spawns: [
            ...toSpawns({ stego: 3, armored: 4, titan: 2 }, 0),
            ...toSpawns({ stego: 3, armored: 4, titan: 2 }, 1),
            bossSpawn("allosaur", 0),
            bossSpawn("allosaur", 1),
          ],
          bossTrickle: [
            trickleStream(0, ["swarm", "raptor", "allosaur"], 1.2, 1.8, 6),
            trickleStream(0, ["raptor", "allosaur", "para", "stego"], 0.9, 1.4, 22),
            trickleStream(1, ["swarm", "raptor", "allosaur"], 1.2, 1.8, 7),
            trickleStream(1, ["raptor", "allosaur", "para", "stego"], 0.9, 1.4, 23),
          ],
        },
      ],
    },
  },
  {
    id: 21,
    name: "Shattered Arc",
    // Three parallel lanes with a 16-unit separation — no placement covers
    // all three at once, so the player has to commit to breadth early.
    paths: [p(-20, 8, 20, 8), p(-20, 0, 20, 0), p(-20, -8, 20, -8)],
    startGold: 220,
    nodePos: { x: -21, y: 14 },
    hpScale: 2.35,
    waves: [
      split(
        "intro",
        0.85,
        [0, { raptor: 12, swarm: 4 }],
        [1, { raptor: 12, swarm: 4 }],
        [2, { raptor: 12, swarm: 4 }],
      ),
      split(
        "mixed",
        0.5,
        [0, { raptor: 14, swarm: 10, allosaur: 2 }],
        [1, { raptor: 14, swarm: 10, allosaur: 2 }],
        [2, { raptor: 14, swarm: 10, allosaur: 2 }],
      ),
      split("swarm", 0.1, [0, { swarm: 50 }], [1, { swarm: 50 }], [2, { swarm: 50 }]),
      split(
        "heavy",
        0.9,
        [0, { armored: 4, stego: 2 }],
        [1, { armored: 4, stego: 2 }],
        [2, { armored: 4, stego: 2 }],
      ),
      split(
        "mixed",
        0.48,
        [0, { raptor: 16, swarm: 12, allosaur: 5 }],
        [1, { raptor: 16, swarm: 12, allosaur: 5 }],
        [2, { raptor: 16, swarm: 12, allosaur: 5 }],
      ),
      split(
        "chaos",
        0.3,
        [0, { raptor: 14, swarm: 16, allosaur: 5, stego: 3 }],
        [1, { raptor: 14, swarm: 16, allosaur: 5, stego: 3 }],
        [2, { raptor: 14, swarm: 16, allosaur: 5, stego: 3 }],
      ),
      split("swarm", 0.09, [0, { swarm: 65 }], [1, { swarm: 65 }], [2, { swarm: 65 }]),
      split(
        "heavy",
        0.85,
        [0, { armored: 10, stego: 5, titan: 1 }],
        [1, { armored: 10, stego: 5, titan: 1 }],
        [2, { armored: 10, stego: 5 }],
      ),
      split(
        "mixed",
        0.45,
        [0, { raptor: 18, swarm: 14, para: 4, allosaur: 6 }],
        [1, { raptor: 18, swarm: 14, para: 4, allosaur: 6 }],
        [2, { raptor: 18, swarm: 14, para: 4, allosaur: 6 }],
      ),
      split(
        "chaos",
        0.28,
        [0, { raptor: 16, swarm: 22, allosaur: 6, stego: 4, armored: 2 }],
        [1, { raptor: 16, swarm: 22, allosaur: 6, stego: 4, armored: 2 }],
        [2, { raptor: 16, swarm: 22, allosaur: 6, stego: 4, armored: 2 }],
      ),
      split(
        "heavy",
        0.8,
        [0, { armored: 14, stego: 8, titan: 2 }],
        [1, { armored: 14, stego: 8, titan: 2 }],
        [2, { armored: 14, stego: 8, titan: 2 }],
      ),
      split(
        "chaos",
        0.25,
        [0, { raptor: 22, swarm: 30, allosaur: 10, stego: 6, armored: 5, titan: 2 }],
        [1, { raptor: 22, swarm: 30, allosaur: 10, stego: 6, armored: 5, titan: 2 }],
        [2, { raptor: 22, swarm: 30, allosaur: 10, stego: 6, armored: 5, titan: 2 }],
      ),
      split(
        "chaos",
        0.22,
        [0, { raptor: 26, swarm: 36, allosaur: 12, stego: 8, armored: 7, titan: 3 }],
        [1, { raptor: 26, swarm: 36, allosaur: 12, stego: 8, armored: 7, titan: 3 }],
        [2, { raptor: 26, swarm: 36, allosaur: 12, stego: 8, armored: 7, titan: 3 }],
      ),
    ],
    // Breach: no chain. Three parallel lanes with 16-unit separation
    // mean chain's bounce was buying free coverage between paths —
    // yank it and every lane needs its own dedicated coverage. Heavy
    // waves bring shielded armored that pulse can crack; the late
    // chaos waves swap in heavy-raptor batches to punish a single
    // dropped lane.
    breach: {
      startGold: 700,
      tagline: "No chain. Three lanes, three coverage commits.",
      forbiddenTowers: ["chain"],
      waves: [
        split(
          "intro",
          0.8,
          [0, { raptor: 14, swarm: 6 }],
          [1, { raptor: 14, swarm: 6 }],
          [2, { raptor: 14, swarm: 6 }],
        ),
        split(
          "mixed",
          0.48,
          [0, { raptor: 16, swarm: 12, allosaur: 3 }],
          [1, { raptor: 16, swarm: 12, allosaur: 3 }],
          [2, { raptor: 16, swarm: 12, allosaur: 3 }],
        ),
        split("swarm", 0.09, [0, { swarm: 65 }], [1, { swarm: 65 }], [2, { swarm: 65 }]),
        // Shielded armored heavy on every lane — without chain to crack
        // bubbles three-at-a-time, pulse focus-fire is the answer and
        // it has to be replicated per lane.
        {
          archetype: "heavy",
          spacing: 0.88,
          spawns: [
            ...toSpawns({ armored: 5, stego: 2 }, 0, { shielded: true }),
            ...toSpawns({ armored: 5, stego: 2 }, 1, { shielded: true }),
            ...toSpawns({ armored: 5, stego: 2 }, 2, { shielded: true }),
          ],
        },
        split(
          "mixed",
          0.45,
          [0, { raptor: 18, swarm: 14, allosaur: 6 }],
          [1, { raptor: 18, swarm: 14, allosaur: 6 }],
          [2, { raptor: 18, swarm: 14, allosaur: 6 }],
        ),
        // Heavy raptor chaos on every lane — leaking one is much more
        // expensive now.
        {
          archetype: "chaos",
          spacing: 0.28,
          spawns: [
            ...toSpawns({ raptor: 16, swarm: 18 }, 0),
            ...toSpawns({ allosaur: 6, stego: 3 }, 0),
            ...toSpawns({ raptor: 16, swarm: 18 }, 1),
            ...toSpawns({ allosaur: 6, stego: 3 }, 1),
            ...toSpawns({ raptor: 16, swarm: 18 }, 2),
            ...toSpawns({ allosaur: 6, stego: 3 }, 2),
          ],
        },
        split("swarm", 0.08, [0, { swarm: 80 }], [1, { swarm: 80 }], [2, { swarm: 80 }]),
        split(
          "heavy",
          0.82,
          [0, { armored: 12, stego: 6, titan: 1 }],
          [1, { armored: 12, stego: 6, titan: 1 }],
          [2, { armored: 12, stego: 6, titan: 1 }],
        ),
        split(
          "mixed",
          0.42,
          [0, { raptor: 20, swarm: 16, para: 5, allosaur: 7 }],
          [1, { raptor: 20, swarm: 16, para: 5, allosaur: 7 }],
          [2, { raptor: 20, swarm: 16, para: 5, allosaur: 7 }],
        ),
        split(
          "chaos",
          0.26,
          [0, { raptor: 18, swarm: 24, allosaur: 7, stego: 5, armored: 3 }],
          [1, { raptor: 18, swarm: 24, allosaur: 7, stego: 5, armored: 3 }],
          [2, { raptor: 18, swarm: 24, allosaur: 7, stego: 5, armored: 3 }],
        ),
        // Heavy-stego titan-armored stack on every lane — without chain
        // ring-through, pulse-T3 or mortar-splash sustained per lane is
        // the only stable lever.
        {
          archetype: "heavy",
          spacing: 0.76,
          spawns: [
            ...toSpawns({ stego: 2 }, 0),
            ...toSpawns({ armored: 16, titan: 2 }, 0),
            ...toSpawns({ stego: 2 }, 1),
            ...toSpawns({ armored: 16, titan: 2 }, 1),
            ...toSpawns({ stego: 2 }, 2),
            ...toSpawns({ armored: 16, titan: 2 }, 2),
          ],
        },
        split(
          "chaos",
          0.23,
          [0, { raptor: 24, swarm: 32, allosaur: 11, stego: 7, armored: 6, titan: 2 }],
          [1, { raptor: 24, swarm: 32, allosaur: 11, stego: 7, armored: 6, titan: 2 }],
          [2, { raptor: 24, swarm: 32, allosaur: 11, stego: 7, armored: 6, titan: 2 }],
        ),
        // Breach finale: heavy titans per lane, three lanes wide.
        // Without chain, the player must field per-lane towers that can
        // burst the heavy titan before it walks the field.
        {
          archetype: "chaos",
          spacing: 0.2,
          spawns: [
            ...toSpawns({ titan: 1 }, 0),
            ...toSpawns({ raptor: 28, swarm: 38, allosaur: 13, stego: 9, armored: 8, titan: 3 }, 0),
            ...toSpawns({ titan: 1 }, 1),
            ...toSpawns({ raptor: 28, swarm: 38, allosaur: 13, stego: 9, armored: 8, titan: 3 }, 1),
            ...toSpawns({ titan: 1 }, 2),
            ...toSpawns({ raptor: 28, swarm: 38, allosaur: 13, stego: 9, armored: 8, titan: 3 }, 2),
          ],
        },
      ],
    },
    // Containment: locked to pulse / mortar / hive. Three lanes, three
    // schools of tower. Pulse is the per-lane DPS anchor, mortar is
    // the chokepoint splash, hive provides drone uplift. No cryo
    // means tanks can't be held off — the player has to actually
    // out-DPS the wave. Big start bank because building three lanes
    // simultaneously eats gold.
    containment: {
      startGold: 750,
      tagline: "Locked: pulse / mortar / hive. One life, no selling.",
      lockedLoadout: ["pulse", "mortar", "hive"],
      singleLife: true,
      noSelling: true,
      waves: [
        split(
          "intro",
          0.85,
          [0, { raptor: 12, swarm: 4 }],
          [1, { raptor: 12, swarm: 4 }],
          [2, { raptor: 12, swarm: 4 }],
        ),
        split(
          "mixed",
          0.5,
          [0, { raptor: 14, swarm: 10, allosaur: 2 }],
          [1, { raptor: 14, swarm: 10, allosaur: 2 }],
          [2, { raptor: 14, swarm: 10, allosaur: 2 }],
        ),
        split("swarm", 0.1, [0, { swarm: 50 }], [1, { swarm: 50 }], [2, { swarm: 50 }]),
        split(
          "heavy",
          0.9,
          [0, { armored: 4, stego: 2 }],
          [1, { armored: 4, stego: 2 }],
          [2, { armored: 4, stego: 2 }],
        ),
        split(
          "mixed",
          0.48,
          [0, { raptor: 16, swarm: 12, allosaur: 5 }],
          [1, { raptor: 16, swarm: 12, allosaur: 5 }],
          [2, { raptor: 16, swarm: 12, allosaur: 5 }],
        ),
        split(
          "chaos",
          0.3,
          [0, { raptor: 14, swarm: 16, allosaur: 5, stego: 3 }],
          [1, { raptor: 14, swarm: 16, allosaur: 5, stego: 3 }],
          [2, { raptor: 14, swarm: 16, allosaur: 5, stego: 3 }],
        ),
        split("swarm", 0.09, [0, { swarm: 65 }], [1, { swarm: 65 }], [2, { swarm: 65 }]),
        split(
          "heavy",
          0.85,
          [0, { armored: 10, stego: 5, titan: 1 }],
          [1, { armored: 10, stego: 5, titan: 1 }],
          [2, { armored: 10, stego: 5 }],
        ),
        split(
          "mixed",
          0.45,
          [0, { raptor: 18, swarm: 14, para: 4, allosaur: 6 }],
          [1, { raptor: 18, swarm: 14, para: 4, allosaur: 6 }],
          [2, { raptor: 18, swarm: 14, para: 4, allosaur: 6 }],
        ),
        split(
          "chaos",
          0.28,
          [0, { raptor: 16, swarm: 22, allosaur: 6, stego: 4, armored: 2 }],
          [1, { raptor: 16, swarm: 22, allosaur: 6, stego: 4, armored: 2 }],
          [2, { raptor: 16, swarm: 22, allosaur: 6, stego: 4, armored: 2 }],
        ),
        split(
          "heavy",
          0.8,
          [0, { armored: 14, stego: 8, titan: 2 }],
          [1, { armored: 14, stego: 8, titan: 2 }],
          [2, { armored: 14, stego: 8, titan: 2 }],
        ),
        split(
          "chaos",
          0.25,
          [0, { raptor: 22, swarm: 30, allosaur: 10, stego: 6, armored: 5, titan: 2 }],
          [1, { raptor: 22, swarm: 30, allosaur: 10, stego: 6, armored: 5, titan: 2 }],
          [2, { raptor: 22, swarm: 30, allosaur: 10, stego: 6, armored: 5, titan: 2 }],
        ),
        split(
          "chaos",
          0.22,
          [0, { raptor: 26, swarm: 36, allosaur: 12, stego: 8, armored: 7, titan: 3 }],
          [1, { raptor: 26, swarm: 36, allosaur: 12, stego: 8, armored: 7, titan: 3 }],
          [2, { raptor: 26, swarm: 36, allosaur: 12, stego: 8, armored: 7, titan: 3 }],
        ),
      ],
    },
  },
  {
    id: 22,
    name: "Maelstrom",
    // Four paths in a + pattern, all crossing at center — tight tempo,
    // enemies pour from every direction at once.
    paths: [
      p(-20, 0, 0, 0, 20, 0),
      p(0, -12, 0, 0, 0, 12),
      p(-20, -8, -6, -2, 6, 2, 20, 8),
      p(-20, 8, -6, 2, 6, -2, 20, -8),
    ],
    startGold: 200,
    nodePos: { x: -11, y: 19 },
    hpScale: 2.7,
    waves: [
      split(
        "intro",
        0.8,
        [0, { raptor: 10 }],
        [1, { raptor: 10 }],
        [2, { raptor: 10 }],
        [3, { raptor: 10 }],
      ),
      split(
        "mixed",
        0.5,
        [0, { raptor: 12, swarm: 8 }],
        [1, { raptor: 12, swarm: 8 }],
        [2, { raptor: 12, swarm: 8 }],
        [3, { raptor: 12, swarm: 8 }],
      ),
      split(
        "swarm",
        0.1,
        [0, { swarm: 40 }],
        [1, { swarm: 40 }],
        [2, { swarm: 40 }],
        [3, { swarm: 40 }],
      ),
      split(
        "heavy",
        0.9,
        [0, { armored: 3, stego: 1 }],
        [1, { armored: 3, stego: 1 }],
        [2, { armored: 3, stego: 1 }],
        [3, { armored: 3, stego: 1 }],
      ),
      split(
        "mixed",
        0.45,
        [0, { raptor: 14, swarm: 10, allosaur: 4 }],
        [1, { raptor: 14, swarm: 10, allosaur: 4 }],
        [2, { raptor: 14, swarm: 10, allosaur: 4 }],
        [3, { raptor: 14, swarm: 10, allosaur: 4 }],
      ),
      split(
        "chaos",
        0.3,
        [0, { raptor: 12, swarm: 14, allosaur: 4, stego: 2 }],
        [1, { raptor: 12, swarm: 14, allosaur: 4, stego: 2 }],
        [2, { raptor: 12, swarm: 14, allosaur: 4, stego: 2 }],
        [3, { raptor: 12, swarm: 14, allosaur: 4, stego: 2 }],
      ),
      split(
        "swarm",
        0.09,
        [0, { swarm: 55 }],
        [1, { swarm: 55 }],
        [2, { swarm: 55 }],
        [3, { swarm: 55 }],
      ),
      split(
        "heavy",
        0.85,
        [0, { armored: 8, stego: 4, titan: 1 }],
        [1, { armored: 8, stego: 4 }],
        [2, { armored: 8, stego: 4, titan: 1 }],
        [3, { armored: 8, stego: 4 }],
      ),
      split(
        "mixed",
        0.4,
        [0, { raptor: 16, swarm: 14, allosaur: 5, stego: 3 }],
        [1, { raptor: 16, swarm: 14, allosaur: 5, stego: 3 }],
        [2, { raptor: 16, swarm: 14, allosaur: 5, stego: 3 }],
        [3, { raptor: 16, swarm: 14, allosaur: 5, stego: 3 }],
      ),
      split(
        "chaos",
        0.25,
        [0, { raptor: 14, swarm: 18, allosaur: 6, stego: 4, armored: 3 }],
        [1, { raptor: 14, swarm: 18, allosaur: 6, stego: 4, armored: 3 }],
        [2, { raptor: 14, swarm: 18, allosaur: 6, stego: 4, armored: 3 }],
        [3, { raptor: 14, swarm: 18, allosaur: 6, stego: 4, armored: 3 }],
      ),
      split(
        "heavy",
        0.75,
        [0, { armored: 12, stego: 6, titan: 2 }],
        [1, { armored: 12, stego: 6, titan: 2 }],
        [2, { armored: 12, stego: 6, titan: 2 }],
        [3, { armored: 12, stego: 6, titan: 2 }],
      ),
      split(
        "swarm",
        0.07,
        [0, { swarm: 80, raptor: 18, allosaur: 3 }],
        [1, { swarm: 80, raptor: 18, allosaur: 3 }],
        [2, { swarm: 80, raptor: 18, allosaur: 3 }],
        [3, { swarm: 80, raptor: 18, allosaur: 3 }],
      ),
      split(
        "chaos",
        0.22,
        [0, { raptor: 20, swarm: 26, allosaur: 8, stego: 5, armored: 4, titan: 2 }],
        [1, { raptor: 20, swarm: 26, allosaur: 8, stego: 5, armored: 4, titan: 2 }],
        [2, { raptor: 20, swarm: 26, allosaur: 8, stego: 5, armored: 4, titan: 2 }],
        [3, { raptor: 20, swarm: 26, allosaur: 8, stego: 5, armored: 4, titan: 2 }],
      ),
      split(
        "chaos",
        0.2,
        [0, { raptor: 24, swarm: 30, allosaur: 10, stego: 7, armored: 6, titan: 3 }],
        [1, { raptor: 24, swarm: 30, allosaur: 10, stego: 7, armored: 6, titan: 3 }],
        [2, { raptor: 24, swarm: 30, allosaur: 10, stego: 7, armored: 6, titan: 3 }],
        [3, { raptor: 24, swarm: 30, allosaur: 10, stego: 7, armored: 6, titan: 3 }],
      ),
    ],
    // Breach: no mortar. Four cross-paths already over-reward splash
    // because the center is a free choke — yank mortar and the center
    // becomes a chain coil + pulse focus battle. Heavy waves bring
    // shielded armored on every lane; the swarm wave is flame-adapted
    // so the player can't sit on a flamethrower for free.
    breach: {
      startGold: 600,
      tagline: "No mortar. Four-front siege without the splash crutch.",
      forbiddenTowers: ["mortar"],
      waves: [
        split(
          "intro",
          0.78,
          [0, { raptor: 12, swarm: 3 }],
          [1, { raptor: 12, swarm: 3 }],
          [2, { raptor: 12, swarm: 3 }],
          [3, { raptor: 12, swarm: 3 }],
        ),
        split(
          "mixed",
          0.48,
          [0, { raptor: 14, swarm: 10, allosaur: 2 }],
          [1, { raptor: 14, swarm: 10, allosaur: 2 }],
          [2, { raptor: 14, swarm: 10, allosaur: 2 }],
          [3, { raptor: 14, swarm: 10, allosaur: 2 }],
        ),
        flamebreakSplit(
          0.08,
          [0, { swarm: 50 }],
          [1, { swarm: 50 }],
          [2, { swarm: 50 }],
          [3, { swarm: 50 }],
        ),
        // Shielded armored on all four lanes — no mortar means chain
        // bounce + pulse focus is the only stable bubble-cracker.
        {
          archetype: "heavy",
          spacing: 0.86,
          spawns: [
            ...toSpawns({ armored: 4, stego: 2 }, 0, { shielded: true }),
            ...toSpawns({ armored: 4, stego: 2 }, 1, { shielded: true }),
            ...toSpawns({ armored: 4, stego: 2 }, 2, { shielded: true }),
            ...toSpawns({ armored: 4, stego: 2 }, 3, { shielded: true }),
          ],
        },
        split(
          "mixed",
          0.42,
          [0, { raptor: 16, swarm: 12, allosaur: 5 }],
          [1, { raptor: 16, swarm: 12, allosaur: 5 }],
          [2, { raptor: 16, swarm: 12, allosaur: 5 }],
          [3, { raptor: 16, swarm: 12, allosaur: 5 }],
        ),
        split(
          "chaos",
          0.28,
          [0, { raptor: 14, swarm: 16, allosaur: 5, stego: 3 }],
          [1, { raptor: 14, swarm: 16, allosaur: 5, stego: 3 }],
          [2, { raptor: 14, swarm: 16, allosaur: 5, stego: 3 }],
          [3, { raptor: 14, swarm: 16, allosaur: 5, stego: 3 }],
        ),
        flamebreakSplit(
          0.07,
          [0, { swarm: 70 }],
          [1, { swarm: 70 }],
          [2, { swarm: 70 }],
          [3, { swarm: 70 }],
        ),
        split(
          "heavy",
          0.82,
          [0, { armored: 10, stego: 5, titan: 1 }],
          [1, { armored: 10, stego: 5, titan: 1 }],
          [2, { armored: 10, stego: 5, titan: 1 }],
          [3, { armored: 10, stego: 5, titan: 1 }],
        ),
        // Heavy raptor mix on every lane — leaking one corridor of
        {
          archetype: "mixed",
          spacing: 0.38,
          spawns: [
            ...toSpawns({ raptor: 18, swarm: 14 }, 0),
            ...toSpawns({ allosaur: 6, stego: 3 }, 0),
            ...toSpawns({ raptor: 18, swarm: 14 }, 1),
            ...toSpawns({ allosaur: 6, stego: 3 }, 1),
            ...toSpawns({ raptor: 18, swarm: 14 }, 2),
            ...toSpawns({ allosaur: 6, stego: 3 }, 2),
            ...toSpawns({ raptor: 18, swarm: 14 }, 3),
            ...toSpawns({ allosaur: 6, stego: 3 }, 3),
          ],
        },
        split(
          "chaos",
          0.24,
          [0, { raptor: 16, swarm: 20, allosaur: 7, stego: 5, armored: 4 }],
          [1, { raptor: 16, swarm: 20, allosaur: 7, stego: 5, armored: 4 }],
          [2, { raptor: 16, swarm: 20, allosaur: 7, stego: 5, armored: 4 }],
          [3, { raptor: 16, swarm: 20, allosaur: 7, stego: 5, armored: 4 }],
        ),
        // electric chain is the cleanest answer.
        {
          archetype: "heavy",
          spacing: 0.72,
          spawns: [
            ...toSpawns({ stego: 2 }, 0),
            ...toSpawns({ armored: 14, titan: 2 }, 0),
            ...toSpawns({ stego: 2 }, 1),
            ...toSpawns({ armored: 14, titan: 2 }, 1),
            ...toSpawns({ stego: 2 }, 2),
            ...toSpawns({ armored: 14, titan: 2 }, 2),
            ...toSpawns({ stego: 2 }, 3),
            ...toSpawns({ armored: 14, titan: 2 }, 3),
          ],
        },
        flamebreakSplit(
          0.06,
          [0, { swarm: 95, raptor: 18, allosaur: 3 }],
          [1, { swarm: 95, raptor: 18, allosaur: 3 }],
          [2, { swarm: 95, raptor: 18, allosaur: 3 }],
          [3, { swarm: 95, raptor: 18, allosaur: 3 }],
        ),
        split(
          "chaos",
          0.2,
          [0, { raptor: 22, swarm: 28, allosaur: 9, stego: 6, armored: 5, titan: 2 }],
          [1, { raptor: 22, swarm: 28, allosaur: 9, stego: 6, armored: 5, titan: 2 }],
          [2, { raptor: 22, swarm: 28, allosaur: 9, stego: 6, armored: 5, titan: 2 }],
          [3, { raptor: 22, swarm: 28, allosaur: 9, stego: 6, armored: 5, titan: 2 }],
        ),
        // Breach finale: heavy titans on every lane plus the regular
        // chaos backbone.
        {
          archetype: "chaos",
          spacing: 0.18,
          spawns: [
            ...toSpawns({ titan: 1 }, 0),
            ...toSpawns({ raptor: 26, swarm: 32, allosaur: 11, stego: 8, armored: 7, titan: 3 }, 0),
            ...toSpawns({ titan: 1 }, 1),
            ...toSpawns({ raptor: 26, swarm: 32, allosaur: 11, stego: 8, armored: 7, titan: 3 }, 1),
            ...toSpawns({ titan: 1 }, 2),
            ...toSpawns({ raptor: 26, swarm: 32, allosaur: 11, stego: 8, armored: 7, titan: 3 }, 2),
            ...toSpawns({ titan: 1 }, 3),
            ...toSpawns({ raptor: 26, swarm: 32, allosaur: 11, stego: 8, armored: 7, titan: 3 }, 3),
          ],
        },
      ],
    },
    // Containment: locked to chain / cryo / flame. Chain rings through the
    // center cross, cryo holds tanks at the chokepoint, flame chews
    // the persistent swarm pressure. No pulse means no single-target
    // king to clean up titans — they have to be slowed and stripped.
    containment: {
      startGold: 800,
      tagline: "Locked: chain / cryo / flame. One life, no selling.",
      lockedLoadout: ["chain", "cryo", "flame"],
      singleLife: true,
      noSelling: true,
      waves: [
        split(
          "intro",
          0.8,
          [0, { raptor: 10 }],
          [1, { raptor: 10 }],
          [2, { raptor: 10 }],
          [3, { raptor: 10 }],
        ),
        split(
          "mixed",
          0.5,
          [0, { raptor: 12, swarm: 8 }],
          [1, { raptor: 12, swarm: 8 }],
          [2, { raptor: 12, swarm: 8 }],
          [3, { raptor: 12, swarm: 8 }],
        ),
        split(
          "swarm",
          0.1,
          [0, { swarm: 40 }],
          [1, { swarm: 40 }],
          [2, { swarm: 40 }],
          [3, { swarm: 40 }],
        ),
        split(
          "heavy",
          0.9,
          [0, { armored: 3, stego: 1 }],
          [1, { armored: 3, stego: 1 }],
          [2, { armored: 3, stego: 1 }],
          [3, { armored: 3, stego: 1 }],
        ),
        split(
          "mixed",
          0.45,
          [0, { raptor: 14, swarm: 10, allosaur: 4 }],
          [1, { raptor: 14, swarm: 10, allosaur: 4 }],
          [2, { raptor: 14, swarm: 10, allosaur: 4 }],
          [3, { raptor: 14, swarm: 10, allosaur: 4 }],
        ),
        split(
          "chaos",
          0.3,
          [0, { raptor: 12, swarm: 14, allosaur: 4, stego: 2 }],
          [1, { raptor: 12, swarm: 14, allosaur: 4, stego: 2 }],
          [2, { raptor: 12, swarm: 14, allosaur: 4, stego: 2 }],
          [3, { raptor: 12, swarm: 14, allosaur: 4, stego: 2 }],
        ),
        split(
          "swarm",
          0.09,
          [0, { swarm: 55 }],
          [1, { swarm: 55 }],
          [2, { swarm: 55 }],
          [3, { swarm: 55 }],
        ),
        split(
          "heavy",
          0.85,
          [0, { armored: 8, stego: 4, titan: 1 }],
          [1, { armored: 8, stego: 4 }],
          [2, { armored: 8, stego: 4, titan: 1 }],
          [3, { armored: 8, stego: 4 }],
        ),
        split(
          "mixed",
          0.4,
          [0, { raptor: 16, swarm: 14, allosaur: 5, stego: 3 }],
          [1, { raptor: 16, swarm: 14, allosaur: 5, stego: 3 }],
          [2, { raptor: 16, swarm: 14, allosaur: 5, stego: 3 }],
          [3, { raptor: 16, swarm: 14, allosaur: 5, stego: 3 }],
        ),
        split(
          "chaos",
          0.25,
          [0, { raptor: 14, swarm: 18, allosaur: 6, stego: 4, armored: 3 }],
          [1, { raptor: 14, swarm: 18, allosaur: 6, stego: 4, armored: 3 }],
          [2, { raptor: 14, swarm: 18, allosaur: 6, stego: 4, armored: 3 }],
          [3, { raptor: 14, swarm: 18, allosaur: 6, stego: 4, armored: 3 }],
        ),
        split(
          "heavy",
          0.75,
          [0, { armored: 12, stego: 6, titan: 2 }],
          [1, { armored: 12, stego: 6, titan: 2 }],
          [2, { armored: 12, stego: 6, titan: 2 }],
          [3, { armored: 12, stego: 6, titan: 2 }],
        ),
        split(
          "swarm",
          0.07,
          [0, { swarm: 80, raptor: 18, allosaur: 3 }],
          [1, { swarm: 80, raptor: 18, allosaur: 3 }],
          [2, { swarm: 80, raptor: 18, allosaur: 3 }],
          [3, { swarm: 80, raptor: 18, allosaur: 3 }],
        ),
        split(
          "chaos",
          0.22,
          [0, { raptor: 20, swarm: 26, allosaur: 8, stego: 5, armored: 4, titan: 2 }],
          [1, { raptor: 20, swarm: 26, allosaur: 8, stego: 5, armored: 4, titan: 2 }],
          [2, { raptor: 20, swarm: 26, allosaur: 8, stego: 5, armored: 4, titan: 2 }],
          [3, { raptor: 20, swarm: 26, allosaur: 8, stego: 5, armored: 4, titan: 2 }],
        ),
        split(
          "chaos",
          0.2,
          [0, { raptor: 24, swarm: 30, allosaur: 10, stego: 7, armored: 6, titan: 3 }],
          [1, { raptor: 24, swarm: 30, allosaur: 10, stego: 7, armored: 6, titan: 3 }],
          [2, { raptor: 24, swarm: 30, allosaur: 10, stego: 7, armored: 6, titan: 3 }],
          [3, { raptor: 24, swarm: 30, allosaur: 10, stego: 7, armored: 6, titan: 3 }],
        ),
      ],
    },
  },
  {
    id: 23,
    name: "Behemoth Walk",
    // Titan parade — a single long serpentine, every heavy wave has titans.
    // Single-path means coverage is easy, but DPS-vs-HP is everything.
    paths: [
      p(-20, -8, -14, -8, -14, 8, -6, 8, -6, -8, 2, -8, 2, 8, 10, 8, 10, -8, 18, -8, 18, 6, 20, 6),
    ],
    startGold: 190,
    nodePos: { x: 1, y: 13 },
    hpScale: 2.85,
    waves: [
      intro(18, 10),
      mixed({ raptor: 22, swarm: 16, allosaur: 6 }),
      rush(90, 16),
      heavy({ armored: 6, stego: 3, titan: 1 }),
      mixed({ raptor: 26, swarm: 20, allosaur: 8, stego: 3 }),
      heavy({ armored: 8, stego: 4, titan: 2 }),
      chaos({ raptor: 20, swarm: 28, allosaur: 8, stego: 5, armored: 3, titan: 2 }),
      heavy({ stego: 6, armored: 10, titan: 3 }),
      mixed({ raptor: 30, swarm: 24, allosaur: 14, stego: 8, armored: 3 }),
      heavy({ stego: 8, armored: 12, titan: 4 }),
      chaos({ raptor: 28, swarm: 34, allosaur: 12, stego: 8, armored: 6, titan: 3 }),
      heavy({ stego: 10, armored: 14, titan: 5 }),
      chaos({ raptor: 32, swarm: 38, allosaur: 14, stego: 10, armored: 9, titan: 5 }),
      heavy({ stego: 12, armored: 18, titan: 7 }),
    ],
    // Breach: no pulse. Single serpentine map with a titan in nearly
    // every heavy wave — pulse-T3 was deleting them for kinetic-loss
    // change. Yank pulse and the player has to lean on chain ring-
    // through (electric 1.6× on stego, 0.9× on titan) plus splash for
    // the mid-tier brick clear. Most heavies now include a heavy
    // titan, and the final wave is a regen-armored brick wall.
    breach: {
      startGold: 550,
      tagline: "No pulse. Titans march without their kinetic king.",
      forbiddenTowers: ["pulse"],
      waves: [
        intro(20, 12),
        mixed({ raptor: 24, swarm: 18, allosaur: 7 }),
        rush(100, 18),
        {
          archetype: "heavy",
          spacing: 0.92,
          spawns: [...toSpawns({ armored: 6, stego: 3 }), ...toSpawns({ titan: 1 }, 0)],
        },
        mixed({ raptor: 28, swarm: 22, allosaur: 10, stego: 4 }),
        heavy({ armored: 9, stego: 5, titan: 2 }),
        chaos({ raptor: 22, swarm: 30, allosaur: 9, stego: 6, armored: 3, titan: 2 }),
        // Heavy stego wedge in front of an armored block — without pulse,
        // electric chain ring-through is the cleanest pop.
        {
          archetype: "heavy",
          spacing: 0.88,
          spawns: [...toSpawns({ stego: 3 }, 0), ...toSpawns({ armored: 11, titan: 3 })],
        },
        mixed({ raptor: 32, swarm: 26, allosaur: 15, stego: 9, armored: 4 }),
        // Shielded armored convoy + titan trio — bubbles plus tank HP.
        // Chain cracks the shields, cryo slows the titans.
        {
          archetype: "heavy",
          spacing: 0.85,
          spawns: [
            ...toSpawns({ armored: 9 }, 0, { shielded: true }),
            ...toSpawns({ stego: 4, titan: 4 }),
          ],
        },
        chaos({ raptor: 30, swarm: 36, allosaur: 13, stego: 9, armored: 7, titan: 4 }),
        heavy({ stego: 11, armored: 16, titan: 6 }),
        // Heavy titan in the chaos backbone — leak it and the run
        // basically ends.
        {
          archetype: "chaos",
          spacing: 0.18,
          spawns: [
            ...toSpawns({ titan: 1 }, 0),
            ...toSpawns({ raptor: 34, swarm: 42, allosaur: 16, stego: 11, armored: 10, titan: 5 }),
          ],
        },
        // Regen-armored brick wall finale — chip damage gives HP back,
        // sustained burst (chain T3, mortar T3) is the only fix.
        {
          archetype: "heavy",
          spacing: 0.78,
          spawns: [
            ...toSpawns({ armored: 6 }, 0, { regen: true }),
            ...toSpawns({ stego: 14, armored: 14, titan: 8 }),
          ],
        },
      ],
    },
    // Containment: locked to chain / mortar / cryo. No pulse means no single-
    // target king for the titans; no flame means swarm waves take real
    // time to clear. Chain rings through electric-vulnerable stego,
    // mortar shreds armored, cryo holds the brick walls. Single path
    // means coverage is trivial — the entire run is a DPS budget test.
    containment: {
      startGold: 550,
      tagline: "Locked: chain / mortar / cryo. One life, no selling.",
      lockedLoadout: ["chain", "mortar", "cryo"],
      singleLife: true,
      noSelling: true,
      waves: [
        intro(18, 10),
        mixed({ raptor: 22, swarm: 16, allosaur: 6 }),
        rush(90, 16),
        heavy({ armored: 6, stego: 3, titan: 1 }),
        mixed({ raptor: 26, swarm: 20, allosaur: 8, stego: 3 }),
        heavy({ armored: 8, stego: 4, titan: 2 }),
        chaos({ raptor: 20, swarm: 28, allosaur: 8, stego: 5, armored: 3, titan: 2 }),
        heavy({ stego: 6, armored: 10, titan: 3 }),
        mixed({ raptor: 30, swarm: 24, allosaur: 14, stego: 8, armored: 3 }),
        heavy({ stego: 8, armored: 12, titan: 4 }),
        chaos({ raptor: 28, swarm: 34, allosaur: 12, stego: 8, armored: 6, titan: 3 }),
        heavy({ stego: 10, armored: 14, titan: 5 }),
        chaos({ raptor: 32, swarm: 38, allosaur: 14, stego: 10, armored: 9, titan: 5 }),
        heavy({ stego: 12, armored: 18, titan: 7 }),
      ],
    },
  },
  {
    id: 24,
    name: "Cascade",
    // Two paths that weave back and forth around each other.
    paths: [
      p(-20, 6, -14, -6, -6, 6, 2, -6, 10, 6, 20, -4),
      p(-20, -6, -14, 6, -6, -6, 2, 6, 10, -6, 20, 4),
    ],
    startGold: 180,
    nodePos: { x: 12, y: 18 },
    hpScale: 3.0,
    breach: {
      // Pulse + Hive banned: no rifle precision against armored/titans,
      // no drone uplinks. Chain/cryo/mortar/flame have to carry every
      // role themselves. Weaves keep enemies in range for splashes.
      startGold: 650,
      forbiddenTowers: ["pulse", "hive"],
      tagline: "Rifle silent, drones grounded.",
      waves: [
        split("intro", 0.8, [0, { raptor: 16, swarm: 4 }], [1, { raptor: 16, swarm: 4 }]),
        split(
          "mixed",
          0.45,
          [0, { raptor: 18, swarm: 14, allosaur: 4 }],
          [1, { raptor: 18, swarm: 14, allosaur: 4 }],
        ),
        split("swarm", 0.08, [0, { swarm: 75 }], [1, { swarm: 75 }]),
        split("heavy", 0.85, [0, { armored: 8, stego: 4 }], [1, { armored: 8, stego: 4 }]),
        split(
          "mixed",
          0.42,
          [0, { raptor: 20, swarm: 16, allosaur: 6, stego: 3 }],
          [1, { raptor: 20, swarm: 16, allosaur: 6, stego: 3 }],
        ),
        split(
          "chaos",
          0.28,
          [0, { raptor: 18, swarm: 22, allosaur: 7, stego: 4, armored: 3 }],
          [1, { raptor: 18, swarm: 22, allosaur: 7, stego: 4, armored: 3 }],
        ),
        split("swarm", 0.07, [0, { swarm: 100 }], [1, { swarm: 100 }]),
        // Shielded armored convoy — shields blunt mortar splash, chain
        // pops the shields then arcs through. No pulse to brute-force.
        {
          archetype: "heavy",
          spacing: 0.8,
          spawns: [
            ...toSpawns({ armored: 6, stego: 4 }, 0, { shielded: true }),
            ...toSpawns({ titan: 1 }, 0),
            ...toSpawns({ armored: 6, stego: 4 }, 1, { shielded: true }),
            ...toSpawns({ titan: 2 }, 1),
          ],
        },
        split(
          "mixed",
          0.38,
          [0, { raptor: 22, swarm: 18, para: 6, allosaur: 8, stego: 5 }],
          [1, { raptor: 22, swarm: 18, para: 6, allosaur: 8, stego: 5 }],
        ),
        split(
          "chaos",
          0.24,
          [0, { raptor: 20, swarm: 24, allosaur: 9, stego: 6, armored: 4, titan: 1 }],
          [1, { raptor: 20, swarm: 24, allosaur: 9, stego: 6, armored: 4, titan: 1 }],
        ),
        // Heavy armored + regen stegos — burst-vs-regen on a kind that
        // already eats kinetic-less defenses.
        {
          archetype: "heavy",
          spacing: 0.72,
          spawns: [
            ...toSpawns({ armored: 2 }, 0),
            ...toSpawns({ stego: 3 }, 0, { regen: true }),
            ...toSpawns({ armored: 12, titan: 3 }, 0),
            ...toSpawns({ armored: 2 }, 1),
            ...toSpawns({ stego: 3 }, 1, { regen: true }),
            ...toSpawns({ armored: 12, titan: 3 }, 1),
          ],
        },
        flamebreakSplit(
          0.06,
          [0, { swarm: 130, raptor: 22, allosaur: 4 }],
          [1, { swarm: 130, raptor: 22, allosaur: 4 }],
        ),
        split(
          "chaos",
          0.2,
          [0, { raptor: 26, swarm: 32, allosaur: 11, stego: 8, armored: 6, titan: 3 }],
          [1, { raptor: 26, swarm: 32, allosaur: 11, stego: 8, armored: 6, titan: 3 }],
        ),
        split(
          "heavy",
          0.68,
          [0, { armored: 20, stego: 12, titan: 5 }],
          [1, { armored: 20, stego: 12, titan: 5 }],
        ),
        split(
          "chaos",
          0.18,
          [0, { raptor: 30, swarm: 38, para: 10, allosaur: 14, stego: 10, armored: 8, titan: 5 }],
          [1, { raptor: 30, swarm: 38, para: 10, allosaur: 14, stego: 10, armored: 8, titan: 5 }],
        ),
        {
          archetype: "chaos",
          spacing: 0.16,
          spawns: [
            ...toSpawns({ armored: 4, stego: 3 }, 0),
            ...toSpawns(
              { raptor: 34, swarm: 44, para: 12, allosaur: 16, stego: 8, armored: 6, titan: 5 },
              0,
            ),
            ...toSpawns({ armored: 4, stego: 3 }, 1),
            ...toSpawns(
              { raptor: 34, swarm: 44, para: 12, allosaur: 16, stego: 8, armored: 6, titan: 5 },
              1,
            ),
          ],
        },
      ],
    },
    containment: {
      // Locked: chain (swarm + shields), mortar (armored splash), cryo
      // (slow the lane). No pulse rifle for clean burst, no sells.
      startGold: 480,
      lockedLoadout: ["chain", "mortar", "cryo"],
      singleLife: true,
      noSelling: true,
      tagline: "One life. Coil, shell, freeze.",
      waves: [
        split("intro", 0.85, [0, { raptor: 14 }], [1, { raptor: 14 }]),
        split(
          "mixed",
          0.5,
          [0, { raptor: 16, swarm: 10, allosaur: 3 }],
          [1, { raptor: 16, swarm: 10, allosaur: 3 }],
        ),
        split("swarm", 0.09, [0, { swarm: 60 }], [1, { swarm: 60 }]),
        split("heavy", 0.9, [0, { armored: 7, stego: 3 }], [1, { armored: 7, stego: 3 }]),
        split(
          "mixed",
          0.45,
          [0, { raptor: 18, swarm: 14, allosaur: 5, stego: 3 }],
          [1, { raptor: 18, swarm: 14, allosaur: 5, stego: 3 }],
        ),
        split(
          "chaos",
          0.3,
          [0, { raptor: 16, swarm: 20, allosaur: 6, stego: 3, armored: 2 }],
          [1, { raptor: 16, swarm: 20, allosaur: 6, stego: 3, armored: 2 }],
        ),
        split("swarm", 0.08, [0, { swarm: 80 }], [1, { swarm: 80 }]),
        split(
          "heavy",
          0.85,
          [0, { armored: 10, stego: 5, titan: 1 }],
          [1, { armored: 10, stego: 5, titan: 2 }],
        ),
        split(
          "mixed",
          0.4,
          [0, { raptor: 20, swarm: 16, para: 5, allosaur: 7, stego: 4 }],
          [1, { raptor: 20, swarm: 16, para: 5, allosaur: 7, stego: 4 }],
        ),
        split(
          "chaos",
          0.25,
          [0, { raptor: 18, swarm: 22, allosaur: 8, stego: 5, armored: 3, titan: 1 }],
          [1, { raptor: 18, swarm: 22, allosaur: 8, stego: 5, armored: 3, titan: 1 }],
        ),
        split(
          "heavy",
          0.75,
          [0, { armored: 14, stego: 8, titan: 3 }],
          [1, { armored: 14, stego: 8, titan: 3 }],
        ),
        flamebreakSplit(
          0.07,
          [0, { swarm: 110, raptor: 20, allosaur: 4 }],
          [1, { swarm: 110, raptor: 20, allosaur: 4 }],
        ),
        split(
          "chaos",
          0.22,
          [0, { raptor: 24, swarm: 30, allosaur: 10, stego: 7, armored: 5, titan: 2 }],
          [1, { raptor: 24, swarm: 30, allosaur: 10, stego: 7, armored: 5, titan: 2 }],
        ),
        split(
          "heavy",
          0.7,
          [0, { armored: 18, stego: 10, titan: 4 }],
          [1, { armored: 18, stego: 10, titan: 4 }],
        ),
        split(
          "chaos",
          0.2,
          [0, { raptor: 28, swarm: 36, para: 8, allosaur: 12, stego: 8, armored: 7, titan: 4 }],
          [1, { raptor: 28, swarm: 36, para: 8, allosaur: 12, stego: 8, armored: 7, titan: 4 }],
        ),
        split(
          "chaos",
          0.18,
          [0, { raptor: 32, swarm: 42, para: 10, allosaur: 14, stego: 10, armored: 9, titan: 5 }],
          [1, { raptor: 32, swarm: 42, para: 10, allosaur: 14, stego: 10, armored: 9, titan: 5 }],
        ),
      ],
    },
    waves: [
      split("intro", 0.85, [0, { raptor: 14 }], [1, { raptor: 14 }]),
      split(
        "mixed",
        0.5,
        [0, { raptor: 16, swarm: 10, allosaur: 3 }],
        [1, { raptor: 16, swarm: 10, allosaur: 3 }],
      ),
      split("swarm", 0.09, [0, { swarm: 60 }], [1, { swarm: 60 }]),
      split("heavy", 0.9, [0, { armored: 7, stego: 3 }], [1, { armored: 7, stego: 3 }]),
      split(
        "mixed",
        0.45,
        [0, { raptor: 18, swarm: 14, allosaur: 5, stego: 3 }],
        [1, { raptor: 18, swarm: 14, allosaur: 5, stego: 3 }],
      ),
      split(
        "chaos",
        0.3,
        [0, { raptor: 16, swarm: 20, allosaur: 6, stego: 3, armored: 2 }],
        [1, { raptor: 16, swarm: 20, allosaur: 6, stego: 3, armored: 2 }],
      ),
      split("swarm", 0.08, [0, { swarm: 80 }], [1, { swarm: 80 }]),
      split(
        "heavy",
        0.85,
        [0, { armored: 10, stego: 5, titan: 1 }],
        [1, { armored: 10, stego: 5, titan: 2 }],
      ),
      split(
        "mixed",
        0.4,
        [0, { raptor: 20, swarm: 16, para: 5, allosaur: 7, stego: 4 }],
        [1, { raptor: 20, swarm: 16, para: 5, allosaur: 7, stego: 4 }],
      ),
      split(
        "chaos",
        0.25,
        [0, { raptor: 18, swarm: 22, allosaur: 8, stego: 5, armored: 3, titan: 1 }],
        [1, { raptor: 18, swarm: 22, allosaur: 8, stego: 5, armored: 3, titan: 1 }],
      ),
      split(
        "heavy",
        0.75,
        [0, { armored: 14, stego: 8, titan: 3 }],
        [1, { armored: 14, stego: 8, titan: 3 }],
      ),
      flamebreakSplit(
        0.07,
        [0, { swarm: 110, raptor: 20, allosaur: 4 }],
        [1, { swarm: 110, raptor: 20, allosaur: 4 }],
      ),
      split(
        "chaos",
        0.22,
        [0, { raptor: 24, swarm: 30, allosaur: 10, stego: 7, armored: 5, titan: 2 }],
        [1, { raptor: 24, swarm: 30, allosaur: 10, stego: 7, armored: 5, titan: 2 }],
      ),
      split(
        "heavy",
        0.7,
        [0, { armored: 18, stego: 10, titan: 4 }],
        [1, { armored: 18, stego: 10, titan: 4 }],
      ),
      split(
        "chaos",
        0.2,
        [0, { raptor: 28, swarm: 36, para: 8, allosaur: 12, stego: 8, armored: 7, titan: 4 }],
        [1, { raptor: 28, swarm: 36, para: 8, allosaur: 12, stego: 8, armored: 7, titan: 4 }],
      ),
      split(
        "chaos",
        0.18,
        [0, { raptor: 32, swarm: 42, para: 10, allosaur: 14, stego: 10, armored: 9, titan: 5 }],
        [1, { raptor: 32, swarm: 42, para: 10, allosaur: 14, stego: 10, armored: 9, titan: 5 }],
      ),
    ],
  },
  {
    id: 25,
    name: "Widowmaker",
    // Five parallel lanes — pure coverage-breadth test.
    paths: [
      p(-20, 10, 20, 10),
      p(-20, 5, 20, 5),
      p(-20, 0, 20, 0),
      p(-20, -5, 20, -5),
      p(-20, -10, 20, -10),
    ],
    startGold: 250,
    nodePos: { x: 24, y: 15 },
    hpScale: 2.65,
    breach: {
      // Mortar + Hive banned: no splash for the inner lanes, no drone
      // amplification. Each lane fights its own war. Triceratops
      // Matriarchs on the outer lanes still answer to pulse + cryo —
      // the deny is on breadth, not on the boss counter.
      startGold: 850,
      forbiddenTowers: ["mortar", "hive"],
      tagline: "Five lanes, no splash, no drones.",
      waves: [
        split(
          "intro",
          0.85,
          [0, { raptor: 10 }],
          [1, { raptor: 10 }],
          [2, { raptor: 10 }],
          [3, { raptor: 10 }],
          [4, { raptor: 10 }],
        ),
        split(
          "mixed",
          0.5,
          [0, { raptor: 12, swarm: 8 }],
          [1, { raptor: 12, swarm: 8 }],
          [2, { raptor: 12, swarm: 8 }],
          [3, { raptor: 12, swarm: 8 }],
          [4, { raptor: 12, swarm: 8 }],
        ),
        split(
          "swarm",
          0.1,
          [0, { swarm: 40 }],
          [1, { swarm: 40 }],
          [2, { swarm: 40 }],
          [3, { swarm: 40 }],
          [4, { swarm: 40 }],
        ),
        split(
          "heavy",
          0.9,
          [0, { armored: 3, stego: 2 }],
          [1, { armored: 3, stego: 2 }],
          [2, { armored: 3, stego: 2 }],
          [3, { armored: 3, stego: 2 }],
          [4, { armored: 3, stego: 2 }],
        ),
        split(
          "mixed",
          0.45,
          [0, { raptor: 14, swarm: 12, allosaur: 4 }],
          [1, { raptor: 14, swarm: 12, allosaur: 4 }],
          [2, { raptor: 14, swarm: 12, allosaur: 4 }],
          [3, { raptor: 14, swarm: 12, allosaur: 4 }],
          [4, { raptor: 14, swarm: 12, allosaur: 4 }],
        ),
        // First shielded test — every lane carries a shielded pack.
        // Chain pops the shields, but allocating across 5 lanes hurts.
        {
          archetype: "mixed",
          spacing: 0.4,
          spawns: [
            ...toSpawns({ raptor: 6 }, 0, { shielded: true }),
            ...toSpawns({ raptor: 14, swarm: 18, allosaur: 5, stego: 3 }, 0),
            ...toSpawns({ raptor: 6 }, 1, { shielded: true }),
            ...toSpawns({ raptor: 14, swarm: 18, allosaur: 5, stego: 3 }, 1),
            ...toSpawns({ raptor: 6 }, 2, { shielded: true }),
            ...toSpawns({ raptor: 14, swarm: 18, allosaur: 5, stego: 3 }, 2),
            ...toSpawns({ raptor: 6 }, 3, { shielded: true }),
            ...toSpawns({ raptor: 14, swarm: 18, allosaur: 5, stego: 3 }, 3),
            ...toSpawns({ raptor: 6 }, 4, { shielded: true }),
            ...toSpawns({ raptor: 14, swarm: 18, allosaur: 5, stego: 3 }, 4),
          ],
        },
        split(
          "swarm",
          0.08,
          [0, { swarm: 55 }],
          [1, { swarm: 55 }],
          [2, { swarm: 55 }],
          [3, { swarm: 55 }],
          [4, { swarm: 55 }],
        ),
        split(
          "heavy",
          0.8,
          [0, { armored: 8, stego: 5, titan: 1 }],
          [1, { armored: 8, stego: 5, titan: 1 }],
          [2, { armored: 8, stego: 5, titan: 1 }],
          [3, { armored: 8, stego: 5, titan: 1 }],
          [4, { armored: 8, stego: 5, titan: 1 }],
        ),
        split(
          "mixed",
          0.42,
          [0, { raptor: 16, swarm: 14, allosaur: 6, stego: 3 }],
          [1, { raptor: 16, swarm: 14, allosaur: 6, stego: 3 }],
          [2, { raptor: 16, swarm: 14, allosaur: 6, stego: 3 }],
          [3, { raptor: 16, swarm: 14, allosaur: 6, stego: 3 }],
          [4, { raptor: 16, swarm: 14, allosaur: 6, stego: 3 }],
        ),
        split(
          "chaos",
          0.24,
          [0, { raptor: 14, swarm: 20, allosaur: 7, stego: 5, armored: 4 }],
          [1, { raptor: 14, swarm: 20, allosaur: 7, stego: 5, armored: 4 }],
          [2, { raptor: 14, swarm: 20, allosaur: 7, stego: 5, armored: 4 }],
          [3, { raptor: 14, swarm: 20, allosaur: 7, stego: 5, armored: 4 }],
          [4, { raptor: 14, swarm: 20, allosaur: 7, stego: 5, armored: 4 }],
        ),
        split(
          "heavy",
          0.75,
          [0, { armored: 12, stego: 7, titan: 2 }],
          [1, { armored: 12, stego: 7, titan: 2 }],
          [2, { armored: 12, stego: 7, titan: 2 }],
          [3, { armored: 12, stego: 7, titan: 2 }],
          [4, { armored: 12, stego: 7, titan: 2 }],
        ),
        split(
          "chaos",
          0.21,
          [0, { raptor: 18, swarm: 26, allosaur: 8, stego: 6, armored: 5, titan: 3 }],
          [1, { raptor: 18, swarm: 26, allosaur: 8, stego: 6, armored: 5, titan: 3 }],
          [2, { raptor: 18, swarm: 26, allosaur: 8, stego: 6, armored: 5, titan: 3 }],
          [3, { raptor: 18, swarm: 26, allosaur: 8, stego: 6, armored: 5, titan: 3 }],
          [4, { raptor: 18, swarm: 26, allosaur: 8, stego: 6, armored: 5, titan: 3 }],
        ),
        // Boss wave: dual Triceratops Matriarchs on outer + center lane.
        // Three matriarchs now (was 2) and the trickle on every lane
        // intensifies. Without mortar splash to mop up inner-lane
        // entourages or hive to multiply chain DPS, every lane has to
        // pull its own weight.
        {
          archetype: "convoy",
          spacing: 0.4,
          bossWave: true,
          spawns: [
            ...toSpawns({ stego: 6, armored: 5, titan: 2 }, 0),
            ...toSpawns({ stego: 7, armored: 6, titan: 3 }, 1),
            ...toSpawns({ stego: 7, armored: 6, titan: 3 }, 2),
            ...toSpawns({ stego: 7, armored: 6, titan: 3 }, 3),
            ...toSpawns({ stego: 6, armored: 5, titan: 2 }, 4),
            bossSpawn("armored", 0),
            bossSpawn("armored", 2),
            bossSpawn("armored", 4),
          ],
          bossTrickle: [
            trickleStream(0, ["swarm", "raptor"], 1.4, 2.0, 7),
            trickleStream(2, ["swarm", "raptor"], 1.4, 2.0, 8),
            trickleStream(4, ["swarm", "raptor"], 1.4, 2.0, 9),
            trickleStream(1, ["raptor", "allosaur", "stego"], 0.9, 1.5, 14),
            trickleStream(3, ["raptor", "allosaur", "stego"], 0.9, 1.5, 15),
          ],
        },
      ],
    },
    containment: {
      // Locked: pulse (only good boss counter), cryo (slow + body), chain
      // (swarm + lane width via bounces). No flame DoT, no mortar splash,
      // no drone uplinks — the loadout has to read 5 lanes by itself.
      startGold: 700,
      lockedLoadout: ["pulse", "cryo", "chain"],
      singleLife: true,
      noSelling: true,
      tagline: "One life. Five lanes. Rifle, ice, coil.",
      waves: [
        split(
          "intro",
          0.9,
          [0, { raptor: 8 }],
          [1, { raptor: 8 }],
          [2, { raptor: 8 }],
          [3, { raptor: 8 }],
          [4, { raptor: 8 }],
        ),
        split(
          "mixed",
          0.55,
          [0, { raptor: 10, swarm: 6 }],
          [1, { raptor: 10, swarm: 6 }],
          [2, { raptor: 10, swarm: 6 }],
          [3, { raptor: 10, swarm: 6 }],
          [4, { raptor: 10, swarm: 6 }],
        ),
        split(
          "swarm",
          0.11,
          [0, { swarm: 30 }],
          [1, { swarm: 30 }],
          [2, { swarm: 30 }],
          [3, { swarm: 30 }],
          [4, { swarm: 30 }],
        ),
        split(
          "heavy",
          0.95,
          [0, { armored: 2, stego: 1 }],
          [1, { armored: 2, stego: 1 }],
          [2, { armored: 2, stego: 1 }],
          [3, { armored: 2, stego: 1 }],
          [4, { armored: 2, stego: 1 }],
        ),
        split(
          "mixed",
          0.5,
          [0, { raptor: 12, swarm: 10, allosaur: 3 }],
          [1, { raptor: 12, swarm: 10, allosaur: 3 }],
          [2, { raptor: 12, swarm: 10, allosaur: 3 }],
          [3, { raptor: 12, swarm: 10, allosaur: 3 }],
          [4, { raptor: 12, swarm: 10, allosaur: 3 }],
        ),
        split(
          "chaos",
          0.3,
          [0, { raptor: 10, swarm: 14, allosaur: 4, stego: 2 }],
          [1, { raptor: 10, swarm: 14, allosaur: 4, stego: 2 }],
          [2, { raptor: 10, swarm: 14, allosaur: 4, stego: 2 }],
          [3, { raptor: 10, swarm: 14, allosaur: 4, stego: 2 }],
          [4, { raptor: 10, swarm: 14, allosaur: 4, stego: 2 }],
        ),
        split(
          "swarm",
          0.09,
          [0, { swarm: 45 }],
          [1, { swarm: 45 }],
          [2, { swarm: 45 }],
          [3, { swarm: 45 }],
          [4, { swarm: 45 }],
        ),
        split(
          "heavy",
          0.85,
          [0, { armored: 7, stego: 4, titan: 1 }],
          [1, { armored: 7, stego: 4 }],
          [2, { armored: 7, stego: 4, titan: 1 }],
          [3, { armored: 7, stego: 4 }],
          [4, { armored: 7, stego: 4, titan: 1 }],
        ),
        split(
          "mixed",
          0.45,
          [0, { raptor: 14, swarm: 12, allosaur: 5, stego: 3 }],
          [1, { raptor: 14, swarm: 12, allosaur: 5, stego: 3 }],
          [2, { raptor: 14, swarm: 12, allosaur: 5, stego: 3 }],
          [3, { raptor: 14, swarm: 12, allosaur: 5, stego: 3 }],
          [4, { raptor: 14, swarm: 12, allosaur: 5, stego: 3 }],
        ),
        split(
          "chaos",
          0.26,
          [0, { raptor: 12, swarm: 16, allosaur: 6, stego: 4, armored: 3 }],
          [1, { raptor: 12, swarm: 16, allosaur: 6, stego: 4, armored: 3 }],
          [2, { raptor: 12, swarm: 16, allosaur: 6, stego: 4, armored: 3 }],
          [3, { raptor: 12, swarm: 16, allosaur: 6, stego: 4, armored: 3 }],
          [4, { raptor: 12, swarm: 16, allosaur: 6, stego: 4, armored: 3 }],
        ),
        split(
          "heavy",
          0.8,
          [0, { armored: 10, stego: 6, titan: 2 }],
          [1, { armored: 10, stego: 6, titan: 2 }],
          [2, { armored: 10, stego: 6, titan: 2 }],
          [3, { armored: 10, stego: 6, titan: 2 }],
          [4, { armored: 10, stego: 6, titan: 2 }],
        ),
        split(
          "chaos",
          0.23,
          [0, { raptor: 16, swarm: 22, allosaur: 7, stego: 5, armored: 4, titan: 2 }],
          [1, { raptor: 16, swarm: 22, allosaur: 7, stego: 5, armored: 4, titan: 2 }],
          [2, { raptor: 16, swarm: 22, allosaur: 7, stego: 5, armored: 4, titan: 2 }],
          [3, { raptor: 16, swarm: 22, allosaur: 7, stego: 5, armored: 4, titan: 2 }],
          [4, { raptor: 16, swarm: 22, allosaur: 7, stego: 5, armored: 4, titan: 2 }],
        ),
        // Boss wave: same twin-matriarch convoy, slightly trimmed
        // trickle so pulse-only DPS reaches her in time without selling.
        {
          archetype: "convoy",
          spacing: 0.45,
          bossWave: true,
          spawns: [
            ...toSpawns({ stego: 5, armored: 4, titan: 2 }, 0),
            ...toSpawns({ stego: 6, armored: 5, titan: 2 }, 1),
            ...toSpawns({ stego: 6, armored: 5, titan: 2 }, 2),
            ...toSpawns({ stego: 6, armored: 5, titan: 2 }, 3),
            ...toSpawns({ stego: 5, armored: 4, titan: 2 }, 4),
            bossSpawn("armored", 0),
            bossSpawn("armored", 4),
          ],
          bossTrickle: [
            trickleStream(0, ["swarm", "raptor"], 1.8, 2.6, 9),
            trickleStream(4, ["swarm", "raptor"], 1.8, 2.6, 10),
            trickleStream(1, ["swarm", "raptor", "allosaur"], 1.4, 2.0, 6),
            trickleStream(2, ["raptor", "allosaur", "para"], 1.0, 1.5, 16),
            trickleStream(3, ["swarm", "raptor", "allosaur"], 1.4, 2.0, 8),
          ],
        },
      ],
    },
    waves: [
      split(
        "intro",
        0.9,
        [0, { raptor: 8 }],
        [1, { raptor: 8 }],
        [2, { raptor: 8 }],
        [3, { raptor: 8 }],
        [4, { raptor: 8 }],
      ),
      split(
        "mixed",
        0.55,
        [0, { raptor: 10, swarm: 6 }],
        [1, { raptor: 10, swarm: 6 }],
        [2, { raptor: 10, swarm: 6 }],
        [3, { raptor: 10, swarm: 6 }],
        [4, { raptor: 10, swarm: 6 }],
      ),
      split(
        "swarm",
        0.11,
        [0, { swarm: 30 }],
        [1, { swarm: 30 }],
        [2, { swarm: 30 }],
        [3, { swarm: 30 }],
        [4, { swarm: 30 }],
      ),
      split(
        "heavy",
        0.95,
        [0, { armored: 2, stego: 1 }],
        [1, { armored: 2, stego: 1 }],
        [2, { armored: 2, stego: 1 }],
        [3, { armored: 2, stego: 1 }],
        [4, { armored: 2, stego: 1 }],
      ),
      split(
        "mixed",
        0.5,
        [0, { raptor: 12, swarm: 10, allosaur: 3 }],
        [1, { raptor: 12, swarm: 10, allosaur: 3 }],
        [2, { raptor: 12, swarm: 10, allosaur: 3 }],
        [3, { raptor: 12, swarm: 10, allosaur: 3 }],
        [4, { raptor: 12, swarm: 10, allosaur: 3 }],
      ),
      split(
        "chaos",
        0.3,
        [0, { raptor: 10, swarm: 14, allosaur: 4, stego: 2 }],
        [1, { raptor: 10, swarm: 14, allosaur: 4, stego: 2 }],
        [2, { raptor: 10, swarm: 14, allosaur: 4, stego: 2 }],
        [3, { raptor: 10, swarm: 14, allosaur: 4, stego: 2 }],
        [4, { raptor: 10, swarm: 14, allosaur: 4, stego: 2 }],
      ),
      split(
        "swarm",
        0.09,
        [0, { swarm: 45 }],
        [1, { swarm: 45 }],
        [2, { swarm: 45 }],
        [3, { swarm: 45 }],
        [4, { swarm: 45 }],
      ),
      split(
        "heavy",
        0.85,
        [0, { armored: 7, stego: 4, titan: 1 }],
        [1, { armored: 7, stego: 4 }],
        [2, { armored: 7, stego: 4, titan: 1 }],
        [3, { armored: 7, stego: 4 }],
        [4, { armored: 7, stego: 4, titan: 1 }],
      ),
      split(
        "mixed",
        0.45,
        [0, { raptor: 14, swarm: 12, allosaur: 5, stego: 3 }],
        [1, { raptor: 14, swarm: 12, allosaur: 5, stego: 3 }],
        [2, { raptor: 14, swarm: 12, allosaur: 5, stego: 3 }],
        [3, { raptor: 14, swarm: 12, allosaur: 5, stego: 3 }],
        [4, { raptor: 14, swarm: 12, allosaur: 5, stego: 3 }],
      ),
      split(
        "chaos",
        0.26,
        [0, { raptor: 12, swarm: 16, allosaur: 6, stego: 4, armored: 3 }],
        [1, { raptor: 12, swarm: 16, allosaur: 6, stego: 4, armored: 3 }],
        [2, { raptor: 12, swarm: 16, allosaur: 6, stego: 4, armored: 3 }],
        [3, { raptor: 12, swarm: 16, allosaur: 6, stego: 4, armored: 3 }],
        [4, { raptor: 12, swarm: 16, allosaur: 6, stego: 4, armored: 3 }],
      ),
      split(
        "heavy",
        0.8,
        [0, { armored: 10, stego: 6, titan: 2 }],
        [1, { armored: 10, stego: 6, titan: 2 }],
        [2, { armored: 10, stego: 6, titan: 2 }],
        [3, { armored: 10, stego: 6, titan: 2 }],
        [4, { armored: 10, stego: 6, titan: 2 }],
      ),
      // Five-lane chaos with two specialist holdouts per outer lane: a
      // flame-resistant "Asbestos" armored pair (DoT pyre spam slides off
      // their plates) and an explosive-resistant "Bunker" titan (mortar
      // splash hardly scratches). Inner lanes stay vanilla so the player
      // still gets gold flow; the outer holdouts force a real second
      // damage type even when most kills are coming from one tower.
      {
        archetype: "chaos",
        spacing: 0.23,
        spawns: [
          ...toSpawns({ raptor: 16, swarm: 22, allosaur: 7, stego: 5, armored: 2, titan: 1 }, 0),
          ...toSpawns({ raptor: 16, swarm: 22, allosaur: 7, stego: 5, armored: 4, titan: 2 }, 1),
          ...toSpawns({ raptor: 16, swarm: 22, allosaur: 7, stego: 5, armored: 4, titan: 2 }, 2),
          ...toSpawns({ raptor: 16, swarm: 22, allosaur: 7, stego: 5, armored: 4, titan: 2 }, 3),
          ...toSpawns({ raptor: 16, swarm: 22, allosaur: 7, stego: 5, armored: 2, titan: 1 }, 4),
          ...toSpawns({ armored: 2 }, 0, { resists: RESIST_FLAME_95 }),
          ...toSpawns({ titan: 1 }, 0, { resists: RESIST_EXPLOSIVE_95 }),
          ...toSpawns({ armored: 2 }, 4, { resists: RESIST_FLAME_95 }),
          ...toSpawns({ titan: 1 }, 4, { resists: RESIST_EXPLOSIVE_95 }),
        ],
      },
      // Boss wave: twin Triceratops Matriarchs on the outer lanes,
      // heavy titan+armored entourages on the inner three. Their child
      // drip is the slowest of any variant (7.5s) because each armored
      // child is 300 HP — bring electric coverage on the outer lanes or
      // their pack stacks up. Inner-lane trickle is preserved so all
      // five lanes pressure the player simultaneously.
      {
        archetype: "convoy",
        spacing: 0.45,
        bossWave: true,
        spawns: [
          ...toSpawns({ stego: 5, armored: 4, titan: 2 }, 0),
          ...toSpawns({ stego: 6, armored: 5, titan: 2 }, 1),
          ...toSpawns({ stego: 6, armored: 5, titan: 2 }, 2),
          ...toSpawns({ stego: 6, armored: 5, titan: 2 }, 3),
          ...toSpawns({ stego: 5, armored: 4, titan: 2 }, 4),
          bossSpawn("armored", 0),
          bossSpawn("armored", 4),
        ],
        bossTrickle: [
          trickleStream(0, ["swarm", "raptor"], 1.6, 2.3, 8),
          trickleStream(4, ["swarm", "raptor"], 1.6, 2.3, 9),
          trickleStream(1, ["swarm", "raptor", "allosaur"], 1.2, 1.8, 5),
          trickleStream(1, ["raptor", "allosaur", "para", "stego"], 0.7, 1.2, 17),
          trickleStream(2, ["swarm", "raptor", "allosaur"], 1.2, 1.8, 6),
          trickleStream(2, ["raptor", "allosaur", "para", "armored"], 0.7, 1.2, 18),
          trickleStream(3, ["swarm", "raptor", "allosaur"], 1.2, 1.8, 7),
          trickleStream(3, ["raptor", "allosaur", "stego", "para"], 0.7, 1.2, 19),
        ],
      },
    ],
  },
  {
    id: 26,
    name: "Split Horizon",
    // Two paths on opposite edges — the map center can't cover either.
    paths: [p(-20, 10, -10, 10, -10, -10, 20, -10), p(20, 10, 10, 10, 10, -10, -20, -10)],
    startGold: 190,
    nodePos: { x: 21, y: 20 },
    hpScale: 3.1,
    breach: {
      // Pulse + Cryo banned: no precision rifle for tanks, no slow to
      // buy time. Forces chain/mortar/flame/hive to carry both halves
      // of the split. Armored bodies become a DoT-and-splash problem.
      startGold: 720,
      forbiddenTowers: ["pulse", "cryo"],
      tagline: "No rifle. No freeze. Bring fire.",
      waves: [
        split("intro", 0.75, [0, { raptor: 14, swarm: 6 }], [1, { raptor: 14, swarm: 6 }]),
        split(
          "mixed",
          0.45,
          [0, { raptor: 18, swarm: 14, allosaur: 5 }],
          [1, { raptor: 18, swarm: 14, allosaur: 5 }],
        ),
        split("swarm", 0.08, [0, { swarm: 85 }], [1, { swarm: 85 }]),
        split("heavy", 0.85, [0, { armored: 6, stego: 4 }], [1, { armored: 6, stego: 4 }]),
        split(
          "mixed",
          0.42,
          [0, { raptor: 20, swarm: 16, para: 5, allosaur: 7 }],
          [1, { raptor: 20, swarm: 16, para: 5, allosaur: 7 }],
        ),
        // Shielded mixed — chain has to open before flame/mortar bite.
        {
          archetype: "chaos",
          spacing: 0.26,
          spawns: [
            ...toSpawns({ allosaur: 4, stego: 2 }, 0, { shielded: true }),
            ...toSpawns({ raptor: 16, swarm: 22, allosaur: 4, armored: 2 }, 0),
            ...toSpawns({ allosaur: 4, stego: 2 }, 1, { shielded: true }),
            ...toSpawns({ raptor: 16, swarm: 22, allosaur: 4, armored: 2 }, 1),
          ],
        },
        split("swarm", 0.07, [0, { swarm: 110 }], [1, { swarm: 110 }]),
        split(
          "heavy",
          0.8,
          [0, { armored: 14, stego: 7, titan: 2 }],
          [1, { armored: 14, stego: 7, titan: 2 }],
        ),
        split(
          "mixed",
          0.38,
          [0, { raptor: 22, swarm: 18, para: 7, allosaur: 9, stego: 5 }],
          [1, { raptor: 22, swarm: 18, para: 7, allosaur: 9, stego: 5 }],
        ),
        split(
          "chaos",
          0.22,
          [0, { raptor: 20, swarm: 26, allosaur: 9, stego: 7, armored: 5, titan: 2 }],
          [1, { raptor: 20, swarm: 26, allosaur: 9, stego: 7, armored: 5, titan: 2 }],
        ),
        // Regen armored — burst kills regen pause; chip damage hands HP
        // back. Hard without pulse.
        {
          archetype: "heavy",
          spacing: 0.7,
          spawns: [
            ...toSpawns({ armored: 5 }, 0, { regen: true }),
            ...toSpawns({ stego: 8, titan: 3 }, 0),
            ...toSpawns({ armored: 5 }, 1, { regen: true }),
            ...toSpawns({ stego: 8, titan: 3 }, 1),
          ],
        },
        split(
          "swarm",
          0.06,
          [0, { swarm: 150, raptor: 28, allosaur: 6 }],
          [1, { swarm: 150, raptor: 28, allosaur: 6 }],
        ),
        split(
          "chaos",
          0.2,
          [0, { raptor: 26, swarm: 36, allosaur: 11, stego: 8, armored: 7, titan: 3 }],
          [1, { raptor: 26, swarm: 36, allosaur: 11, stego: 8, armored: 7, titan: 3 }],
        ),
        split(
          "heavy",
          0.65,
          [0, { armored: 22, stego: 14, titan: 5 }],
          [1, { armored: 22, stego: 14, titan: 5 }],
        ),
        {
          archetype: "chaos",
          spacing: 0.18,
          spawns: [
            ...toSpawns({ armored: 3, titan: 1 }, 0),
            ...toSpawns(
              { raptor: 30, swarm: 42, para: 12, allosaur: 16, stego: 10, armored: 8, titan: 4 },
              0,
            ),
            ...toSpawns({ armored: 3, titan: 1 }, 1),
            ...toSpawns(
              { raptor: 30, swarm: 42, para: 12, allosaur: 16, stego: 10, armored: 8, titan: 4 },
              1,
            ),
          ],
        },
        split(
          "chaos",
          0.16,
          [0, { raptor: 34, swarm: 48, para: 14, allosaur: 18, stego: 13, armored: 11, titan: 6 }],
          [1, { raptor: 34, swarm: 48, para: 14, allosaur: 18, stego: 13, armored: 11, titan: 6 }],
        ),
      ],
    },
    containment: {
      // Locked: mortar (armored splash), chain (swarm + shields), hive
      // (drone uplinks to amplify chain across the split). No cryo to
      // buy time, no pulse precision — the map's edges are unforgiving.
      startGold: 550,
      lockedLoadout: ["mortar", "chain", "hive"],
      singleLife: true,
      noSelling: true,
      tagline: "One life. Shell, coil, drone.",
      waves: [
        split("intro", 0.8, [0, { raptor: 12, swarm: 4 }], [1, { raptor: 12, swarm: 4 }]),
        split(
          "mixed",
          0.5,
          [0, { raptor: 16, swarm: 12, allosaur: 4 }],
          [1, { raptor: 16, swarm: 12, allosaur: 4 }],
        ),
        split("swarm", 0.09, [0, { swarm: 70 }], [1, { swarm: 70 }]),
        split("heavy", 0.9, [0, { armored: 5, stego: 3 }], [1, { armored: 5, stego: 3 }]),
        split(
          "mixed",
          0.45,
          [0, { raptor: 18, swarm: 14, para: 4, allosaur: 6 }],
          [1, { raptor: 18, swarm: 14, para: 4, allosaur: 6 }],
        ),
        split(
          "chaos",
          0.28,
          [0, { raptor: 16, swarm: 20, allosaur: 6, stego: 4, armored: 2 }],
          [1, { raptor: 16, swarm: 20, allosaur: 6, stego: 4, armored: 2 }],
        ),
        split("swarm", 0.08, [0, { swarm: 90 }], [1, { swarm: 90 }]),
        split(
          "heavy",
          0.85,
          [0, { armored: 12, stego: 6, titan: 2 }],
          [1, { armored: 12, stego: 6, titan: 2 }],
        ),
        split(
          "mixed",
          0.42,
          [0, { raptor: 20, swarm: 16, para: 6, allosaur: 8, stego: 4 }],
          [1, { raptor: 20, swarm: 16, para: 6, allosaur: 8, stego: 4 }],
        ),
        split(
          "chaos",
          0.24,
          [0, { raptor: 18, swarm: 24, allosaur: 8, stego: 6, armored: 4, titan: 2 }],
          [1, { raptor: 18, swarm: 24, allosaur: 8, stego: 6, armored: 4, titan: 2 }],
        ),
        split(
          "heavy",
          0.75,
          [0, { armored: 16, stego: 9, titan: 3 }],
          [1, { armored: 16, stego: 9, titan: 3 }],
        ),
        split(
          "swarm",
          0.07,
          [0, { swarm: 120, raptor: 24, allosaur: 5 }],
          [1, { swarm: 120, raptor: 24, allosaur: 5 }],
        ),
        split(
          "chaos",
          0.22,
          [0, { raptor: 24, swarm: 32, allosaur: 10, stego: 7, armored: 6, titan: 3 }],
          [1, { raptor: 24, swarm: 32, allosaur: 10, stego: 7, armored: 6, titan: 3 }],
        ),
        split(
          "heavy",
          0.7,
          [0, { armored: 20, stego: 12, titan: 5 }],
          [1, { armored: 20, stego: 12, titan: 5 }],
        ),
        split(
          "chaos",
          0.2,
          [0, { raptor: 28, swarm: 38, para: 10, allosaur: 14, stego: 10, armored: 8, titan: 4 }],
          [1, { raptor: 28, swarm: 38, para: 10, allosaur: 14, stego: 10, armored: 8, titan: 4 }],
        ),
        split(
          "chaos",
          0.18,
          [0, { raptor: 32, swarm: 44, para: 12, allosaur: 16, stego: 12, armored: 10, titan: 5 }],
          [1, { raptor: 32, swarm: 44, para: 12, allosaur: 16, stego: 12, armored: 10, titan: 5 }],
        ),
      ],
    },
    waves: [
      split("intro", 0.8, [0, { raptor: 12, swarm: 4 }], [1, { raptor: 12, swarm: 4 }]),
      split(
        "mixed",
        0.5,
        [0, { raptor: 16, swarm: 12, allosaur: 4 }],
        [1, { raptor: 16, swarm: 12, allosaur: 4 }],
      ),
      split("swarm", 0.09, [0, { swarm: 70 }], [1, { swarm: 70 }]),
      split("heavy", 0.9, [0, { armored: 5, stego: 3 }], [1, { armored: 5, stego: 3 }]),
      split(
        "mixed",
        0.45,
        [0, { raptor: 18, swarm: 14, para: 4, allosaur: 6 }],
        [1, { raptor: 18, swarm: 14, para: 4, allosaur: 6 }],
      ),
      split(
        "chaos",
        0.28,
        [0, { raptor: 16, swarm: 20, allosaur: 6, stego: 4, armored: 2 }],
        [1, { raptor: 16, swarm: 20, allosaur: 6, stego: 4, armored: 2 }],
      ),
      split("swarm", 0.08, [0, { swarm: 90 }], [1, { swarm: 90 }]),
      split(
        "heavy",
        0.85,
        [0, { armored: 12, stego: 6, titan: 2 }],
        [1, { armored: 12, stego: 6, titan: 2 }],
      ),
      split(
        "mixed",
        0.42,
        [0, { raptor: 20, swarm: 16, para: 6, allosaur: 8, stego: 4 }],
        [1, { raptor: 20, swarm: 16, para: 6, allosaur: 8, stego: 4 }],
      ),
      split(
        "chaos",
        0.24,
        [0, { raptor: 18, swarm: 24, allosaur: 8, stego: 6, armored: 4, titan: 2 }],
        [1, { raptor: 18, swarm: 24, allosaur: 8, stego: 6, armored: 4, titan: 2 }],
      ),
      split(
        "heavy",
        0.75,
        [0, { armored: 16, stego: 9, titan: 3 }],
        [1, { armored: 16, stego: 9, titan: 3 }],
      ),
      split(
        "swarm",
        0.07,
        [0, { swarm: 120, raptor: 24, allosaur: 5 }],
        [1, { swarm: 120, raptor: 24, allosaur: 5 }],
      ),
      split(
        "chaos",
        0.22,
        [0, { raptor: 24, swarm: 32, allosaur: 10, stego: 7, armored: 6, titan: 3 }],
        [1, { raptor: 24, swarm: 32, allosaur: 10, stego: 7, armored: 6, titan: 3 }],
      ),
      split(
        "heavy",
        0.7,
        [0, { armored: 20, stego: 12, titan: 5 }],
        [1, { armored: 20, stego: 12, titan: 5 }],
      ),
      split(
        "chaos",
        0.2,
        [0, { raptor: 28, swarm: 38, para: 10, allosaur: 14, stego: 10, armored: 8, titan: 4 }],
        [1, { raptor: 28, swarm: 38, para: 10, allosaur: 14, stego: 10, armored: 8, titan: 4 }],
      ),
      split(
        "chaos",
        0.18,
        [0, { raptor: 32, swarm: 44, para: 12, allosaur: 16, stego: 12, armored: 10, titan: 5 }],
        [1, { raptor: 32, swarm: 44, para: 12, allosaur: 16, stego: 12, armored: 10, titan: 5 }],
      ),
    ],
  },
  {
    id: 27,
    name: "Blood Tide",
    // Swarm-emphasis. Massive waves, tight spacing — AoE towers earn their keep.
    paths: [
      p(-20, 6, -10, 6, -4, 0, 4, -6, 14, -6, 20, 0),
      p(-20, -6, -10, -6, -4, 0, 4, 6, 14, 6, 20, 0),
    ],
    startGold: 240,
    nodePos: { x: 11, y: 25 },
    hpScale: 2.3,
    breach: {
      // Flame + Mortar banned: every AoE-vs-swarm staple is gone. Chain
      // bounces and pulse target priority have to clean each tide. The
      // map's two paths converge at the center, so a chain tower there
      // hits both — that's the only real lever.
      startGold: 750,
      forbiddenTowers: ["flame", "mortar"],
      tagline: "No fire, no shells. Volts only.",
      waves: [
        split("intro", 0.75, [0, { raptor: 16 }], [1, { raptor: 16 }]),
        split("swarm", 0.09, [0, { swarm: 85 }], [1, { swarm: 85 }]),
        split(
          "mixed",
          0.4,
          [0, { raptor: 20, swarm: 20, allosaur: 5 }],
          [1, { raptor: 20, swarm: 20, allosaur: 5 }],
        ),
        split("swarm", 0.07, [0, { swarm: 120 }], [1, { swarm: 120 }]),
        split("heavy", 0.85, [0, { armored: 6, stego: 3 }], [1, { armored: 6, stego: 3 }]),
        split("swarm", 0.06, [0, { swarm: 160, raptor: 14 }], [1, { swarm: 160, raptor: 14 }]),
        split(
          "mixed",
          0.36,
          [0, { raptor: 24, swarm: 36, allosaur: 7, stego: 4 }],
          [1, { raptor: 24, swarm: 36, allosaur: 7, stego: 4 }],
        ),
        // Shielded swarm — chain has to break the bubble before it can
        // arc. The first real check on chain efficiency.
        {
          archetype: "chaos",
          spacing: 0.24,
          spawns: [
            ...toSpawns({ raptor: 8, allosaur: 2 }, 0, { shielded: true }),
            ...toSpawns({ raptor: 18, swarm: 44, stego: 4, armored: 2 }, 0),
            ...toSpawns({ raptor: 8, allosaur: 2 }, 1, { shielded: true }),
            ...toSpawns({ raptor: 18, swarm: 44, stego: 4, armored: 2 }, 1),
          ],
        },
        split("swarm", 0.05, [0, { swarm: 200, raptor: 18 }], [1, { swarm: 200, raptor: 18 }]),
        split(
          "heavy",
          0.78,
          [0, { armored: 11, stego: 6, titan: 2 }],
          [1, { armored: 11, stego: 6, titan: 2 }],
        ),
        flamebreakSplit(0.045, [0, { swarm: 280, raptor: 24 }], [1, { swarm: 280, raptor: 24 }]),
        split(
          "mixed",
          0.32,
          [0, { raptor: 28, swarm: 48, para: 10, allosaur: 12, stego: 5 }],
          [1, { raptor: 28, swarm: 48, para: 10, allosaur: 12, stego: 5 }],
        ),
        split(
          "chaos",
          0.2,
          [0, { raptor: 24, swarm: 60, allosaur: 12, stego: 7, armored: 5, titan: 2 }],
          [1, { raptor: 24, swarm: 60, allosaur: 12, stego: 7, armored: 5, titan: 2 }],
        ),
        // on leak, and the flame-resist makes the few flame-DoT lookalikes
        // (none here, but the chip-resistance lesson persists) moot.
        {
          archetype: "swarm",
          spacing: 0.045,
          spawns: [
            ...flamebreakSpawns({ swarm: 320, raptor: 32 }, 0),
            ...flamebreakSpawns({ swarm: 320, raptor: 32 }, 1),
          ],
        },
        split(
          "heavy",
          0.72,
          [0, { armored: 20, stego: 12, titan: 5 }],
          [1, { armored: 20, stego: 12, titan: 5 }],
        ),
        split(
          "chaos",
          0.18,
          [0, { raptor: 32, swarm: 72, allosaur: 14, stego: 9, armored: 7, titan: 3 }],
          [1, { raptor: 32, swarm: 72, allosaur: 14, stego: 9, armored: 7, titan: 3 }],
        ),
        flamebreakSplit(0.035, [0, { swarm: 380, raptor: 38 }], [1, { swarm: 380, raptor: 38 }]),
        split(
          "chaos",
          0.16,
          [0, { raptor: 38, swarm: 84, para: 14, allosaur: 18, stego: 11, armored: 10, titan: 5 }],
          [1, { raptor: 38, swarm: 84, para: 14, allosaur: 18, stego: 11, armored: 10, titan: 5 }],
        ),
      ],
    },
    containment: {
      // Locked: chain (electric vs swarm), pulse (anti-stego/anti-titan
      // burst), hive (drone uplinks to multiply chain). No cryo to slow,
      // no flame DoT, no mortar splash — sustain DPS from coverage alone.
      startGold: 650,
      lockedLoadout: ["chain", "pulse", "hive"],
      singleLife: true,
      noSelling: true,
      tagline: "One life. Coil, rifle, drone.",
      waves: [
        split("intro", 0.8, [0, { raptor: 14 }], [1, { raptor: 14 }]),
        split("swarm", 0.1, [0, { swarm: 70 }], [1, { swarm: 70 }]),
        split(
          "mixed",
          0.45,
          [0, { raptor: 18, swarm: 16, allosaur: 4 }],
          [1, { raptor: 18, swarm: 16, allosaur: 4 }],
        ),
        split("swarm", 0.08, [0, { swarm: 100 }], [1, { swarm: 100 }]),
        split("heavy", 0.9, [0, { armored: 5, stego: 2 }], [1, { armored: 5, stego: 2 }]),
        split("swarm", 0.07, [0, { swarm: 130, raptor: 10 }], [1, { swarm: 130, raptor: 10 }]),
        split(
          "mixed",
          0.4,
          [0, { raptor: 22, swarm: 30, allosaur: 6, stego: 3 }],
          [1, { raptor: 22, swarm: 30, allosaur: 6, stego: 3 }],
        ),
        split(
          "chaos",
          0.26,
          [0, { raptor: 18, swarm: 40, allosaur: 6, stego: 4, armored: 2 }],
          [1, { raptor: 18, swarm: 40, allosaur: 6, stego: 4, armored: 2 }],
        ),
        split("swarm", 0.06, [0, { swarm: 160, raptor: 14 }], [1, { swarm: 160, raptor: 14 }]),
        split(
          "heavy",
          0.8,
          [0, { armored: 9, stego: 5, titan: 1 }],
          [1, { armored: 9, stego: 5, titan: 1 }],
        ),
        flamebreakSplit(0.05, [0, { swarm: 220, raptor: 20 }], [1, { swarm: 220, raptor: 20 }]),
        split(
          "mixed",
          0.36,
          [0, { raptor: 26, swarm: 40, para: 8, allosaur: 10, stego: 4 }],
          [1, { raptor: 26, swarm: 40, para: 8, allosaur: 10, stego: 4 }],
        ),
        split(
          "chaos",
          0.22,
          [0, { raptor: 22, swarm: 50, allosaur: 10, stego: 6, armored: 4, titan: 2 }],
          [1, { raptor: 22, swarm: 50, allosaur: 10, stego: 6, armored: 4, titan: 2 }],
        ),
        flamebreakSplit(0.05, [0, { swarm: 260, raptor: 26 }], [1, { swarm: 260, raptor: 26 }]),
        split(
          "heavy",
          0.75,
          [0, { armored: 18, stego: 10, titan: 4 }],
          [1, { armored: 18, stego: 10, titan: 4 }],
        ),
        split(
          "chaos",
          0.2,
          [0, { raptor: 28, swarm: 60, allosaur: 12, stego: 8, armored: 6, titan: 3 }],
          [1, { raptor: 28, swarm: 60, allosaur: 12, stego: 8, armored: 6, titan: 3 }],
        ),
        flamebreakSplit(0.04, [0, { swarm: 320, raptor: 32 }], [1, { swarm: 320, raptor: 32 }]),
        split(
          "chaos",
          0.18,
          [0, { raptor: 34, swarm: 70, para: 12, allosaur: 16, stego: 10, armored: 9, titan: 5 }],
          [1, { raptor: 34, swarm: 70, para: 12, allosaur: 16, stego: 10, armored: 9, titan: 5 }],
        ),
      ],
    },
    waves: [
      split("intro", 0.8, [0, { raptor: 14 }], [1, { raptor: 14 }]),
      split("swarm", 0.1, [0, { swarm: 70 }], [1, { swarm: 70 }]),
      split(
        "mixed",
        0.45,
        [0, { raptor: 18, swarm: 16, allosaur: 4 }],
        [1, { raptor: 18, swarm: 16, allosaur: 4 }],
      ),
      split("swarm", 0.08, [0, { swarm: 100 }], [1, { swarm: 100 }]),
      split("heavy", 0.9, [0, { armored: 5, stego: 2 }], [1, { armored: 5, stego: 2 }]),
      split("swarm", 0.07, [0, { swarm: 130, raptor: 10 }], [1, { swarm: 130, raptor: 10 }]),
      split(
        "mixed",
        0.4,
        [0, { raptor: 22, swarm: 30, allosaur: 6, stego: 3 }],
        [1, { raptor: 22, swarm: 30, allosaur: 6, stego: 3 }],
      ),
      split(
        "chaos",
        0.26,
        [0, { raptor: 18, swarm: 40, allosaur: 6, stego: 4, armored: 2 }],
        [1, { raptor: 18, swarm: 40, allosaur: 6, stego: 4, armored: 2 }],
      ),
      split("swarm", 0.06, [0, { swarm: 160, raptor: 14 }], [1, { swarm: 160, raptor: 14 }]),
      split(
        "heavy",
        0.8,
        [0, { armored: 9, stego: 5, titan: 1 }],
        [1, { armored: 9, stego: 5, titan: 1 }],
      ),
      flamebreakSplit(0.05, [0, { swarm: 220, raptor: 20 }], [1, { swarm: 220, raptor: 20 }]),
      split(
        "mixed",
        0.36,
        [0, { raptor: 26, swarm: 40, para: 8, allosaur: 10, stego: 4 }],
        [1, { raptor: 26, swarm: 40, para: 8, allosaur: 10, stego: 4 }],
      ),
      split(
        "chaos",
        0.22,
        [0, { raptor: 22, swarm: 50, allosaur: 10, stego: 6, armored: 4, titan: 2 }],
        [1, { raptor: 22, swarm: 50, allosaur: 10, stego: 6, armored: 4, titan: 2 }],
      ),
      flamebreakSplit(0.05, [0, { swarm: 260, raptor: 26 }], [1, { swarm: 260, raptor: 26 }]),
      split(
        "heavy",
        0.75,
        [0, { armored: 18, stego: 10, titan: 4 }],
        [1, { armored: 18, stego: 10, titan: 4 }],
      ),
      split(
        "chaos",
        0.2,
        [0, { raptor: 28, swarm: 60, allosaur: 12, stego: 8, armored: 6, titan: 3 }],
        [1, { raptor: 28, swarm: 60, allosaur: 12, stego: 8, armored: 6, titan: 3 }],
      ),
      flamebreakSplit(0.04, [0, { swarm: 320, raptor: 32 }], [1, { swarm: 320, raptor: 32 }]),
      split(
        "chaos",
        0.18,
        [0, { raptor: 34, swarm: 70, para: 12, allosaur: 16, stego: 10, armored: 9, titan: 5 }],
        [1, { raptor: 34, swarm: 70, para: 12, allosaur: 16, stego: 10, armored: 9, titan: 5 }],
      ),
    ],
  },
  {
    id: 28,
    name: "Onslaught",
    // Every wave is a chaos mix — no recovery time between threat types.
    paths: [
      p(-20, 8, -12, 8, -12, -4, -4, -4, -4, 8, 4, 8, 4, -8, 12, -8, 12, 4, 20, 4),
      p(20, -8, 12, -8, 12, 0, 4, 0, 4, -8, -4, -8, -4, 4, -12, 4, -12, -4, -20, -4),
    ],
    startGold: 200,
    nodePos: { x: -1, y: 22 },
    hpScale: 3.5,
    breach: {
      // Cryo + Hive banned: no slows to buy time, no drone uplinks to
      // amplify chain. Pure DPS-vs-DPS race. Onslaught's chaos waves
      // mean no archetype rest — every wave needs answers for armored,
      // titans, swarm, and paras simultaneously.
      startGold: 700,
      forbiddenTowers: ["cryo", "hive"],
      tagline: "No tempo. No support. Race the wave.",
      waves: [
        split(
          "chaos",
          0.38,
          [0, { raptor: 18, swarm: 16, allosaur: 4 }],
          [1, { raptor: 18, swarm: 16, allosaur: 4 }],
        ),
        split(
          "chaos",
          0.33,
          [0, { raptor: 20, swarm: 20, allosaur: 5, stego: 2 }],
          [1, { raptor: 20, swarm: 20, allosaur: 5, stego: 2 }],
        ),
        split(
          "chaos",
          0.3,
          [0, { raptor: 18, swarm: 24, allosaur: 6, stego: 3, armored: 2 }],
          [1, { raptor: 18, swarm: 24, allosaur: 6, stego: 3, armored: 2 }],
        ),
        split(
          "chaos",
          0.28,
          [0, { raptor: 20, swarm: 26, allosaur: 7, stego: 4, armored: 3 }],
          [1, { raptor: 20, swarm: 26, allosaur: 7, stego: 4, armored: 3 }],
        ),
        // Shielded vanguard kicks the chaos staircase up — every wave
        // from here has at least one chip overlap.
        {
          archetype: "chaos",
          spacing: 0.26,
          spawns: [
            ...toSpawns({ stego: 3, allosaur: 2 }, 0, { shielded: true }),
            ...toSpawns({ raptor: 22, swarm: 28, allosaur: 6, armored: 3 }, 0),
            ...toSpawns({ stego: 3, allosaur: 2 }, 1, { shielded: true }),
            ...toSpawns({ raptor: 22, swarm: 28, allosaur: 6, armored: 3 }, 1),
          ],
        },
        split(
          "chaos",
          0.24,
          [0, { raptor: 20, swarm: 34, para: 6, allosaur: 9, stego: 6, armored: 4, titan: 1 }],
          [1, { raptor: 20, swarm: 34, para: 6, allosaur: 9, stego: 6, armored: 4, titan: 1 }],
        ),
        split(
          "chaos",
          0.22,
          [0, { raptor: 24, swarm: 36, para: 7, allosaur: 10, stego: 7, armored: 5, titan: 2 }],
          [1, { raptor: 24, swarm: 36, para: 7, allosaur: 10, stego: 7, armored: 5, titan: 2 }],
        ),
        // Regen stegos + heavy raptor swarm — sustained burst vs
        // regen, but you can't even slow them.
        {
          archetype: "chaos",
          spacing: 0.2,
          spawns: [
            ...toSpawns({ stego: 4 }, 0, { regen: true }),
            ...toSpawns({ raptor: 24 }, 0),
            ...toSpawns({ swarm: 38, allosaur: 11, armored: 6, titan: 2 }, 0),
            ...toSpawns({ stego: 4 }, 1, { regen: true }),
            ...toSpawns({ raptor: 24 }, 1),
            ...toSpawns({ swarm: 38, allosaur: 11, armored: 6, titan: 2 }, 1),
          ],
        },
        split(
          "chaos",
          0.18,
          [0, { raptor: 26, swarm: 42, para: 10, allosaur: 13, stego: 9, armored: 7, titan: 3 }],
          [1, { raptor: 26, swarm: 42, para: 10, allosaur: 13, stego: 9, armored: 7, titan: 3 }],
        ),
        split(
          "chaos",
          0.17,
          [0, { raptor: 28, swarm: 46, para: 11, allosaur: 14, stego: 10, armored: 8, titan: 3 }],
          [1, { raptor: 28, swarm: 46, para: 11, allosaur: 14, stego: 10, armored: 8, titan: 3 }],
        ),
        split(
          "chaos",
          0.16,
          [0, { raptor: 26, swarm: 50, para: 12, allosaur: 15, stego: 11, armored: 9, titan: 4 }],
          [1, { raptor: 26, swarm: 50, para: 12, allosaur: 15, stego: 11, armored: 9, titan: 4 }],
        ),
        {
          archetype: "chaos",
          spacing: 0.15,
          spawns: [
            ...toSpawns({ armored: 4, stego: 2 }, 0, { shielded: true }),
            ...toSpawns(
              { raptor: 30, swarm: 50, para: 13, allosaur: 16, stego: 10, armored: 8, titan: 4 },
              0,
            ),
            ...toSpawns({ armored: 4, stego: 2 }, 1, { shielded: true }),
            ...toSpawns(
              { raptor: 30, swarm: 50, para: 13, allosaur: 16, stego: 10, armored: 8, titan: 4 },
              1,
            ),
          ],
        },
        split(
          "chaos",
          0.14,
          [0, { raptor: 32, swarm: 58, para: 15, allosaur: 20, stego: 14, armored: 12, titan: 5 }],
          [1, { raptor: 32, swarm: 58, para: 15, allosaur: 20, stego: 14, armored: 12, titan: 5 }],
        ),
        split(
          "chaos",
          0.13,
          [0, { raptor: 34, swarm: 62, para: 16, allosaur: 22, stego: 16, armored: 13, titan: 6 }],
          [1, { raptor: 34, swarm: 62, para: 16, allosaur: 22, stego: 16, armored: 13, titan: 6 }],
        ),
        // is flatter on resists.
        {
          archetype: "chaos",
          spacing: 0.12,
          spawns: [
            ...toSpawns({ armored: 4, titan: 2 }, 0),
            ...toSpawns(
              { raptor: 38, swarm: 68, para: 16, allosaur: 22, stego: 16, armored: 11, titan: 5 },
              0,
            ),
            ...toSpawns({ armored: 4, titan: 2 }, 1),
            ...toSpawns(
              { raptor: 38, swarm: 68, para: 16, allosaur: 22, stego: 16, armored: 11, titan: 5 },
              1,
            ),
          ],
        },
      ],
    },
    containment: {
      // Locked: pulse (high single-target precision), mortar (armored
      // splash on chaos packs), chain (swarm + electric on para/swarm).
      // No flame DoT, no cryo slow, no hive uplinks.
      startGold: 600,
      lockedLoadout: ["pulse", "mortar", "chain"],
      singleLife: true,
      noSelling: true,
      tagline: "One life. Rifle, shell, coil.",
      waves: [
        split(
          "chaos",
          0.4,
          [0, { raptor: 16, swarm: 12, allosaur: 3 }],
          [1, { raptor: 16, swarm: 12, allosaur: 3 }],
        ),
        split(
          "chaos",
          0.35,
          [0, { raptor: 18, swarm: 16, allosaur: 4, stego: 1 }],
          [1, { raptor: 18, swarm: 16, allosaur: 4, stego: 1 }],
        ),
        split(
          "chaos",
          0.32,
          [0, { raptor: 16, swarm: 20, allosaur: 5, stego: 2, armored: 1 }],
          [1, { raptor: 16, swarm: 20, allosaur: 5, stego: 2, armored: 1 }],
        ),
        split(
          "chaos",
          0.3,
          [0, { raptor: 18, swarm: 22, allosaur: 6, stego: 3, armored: 2 }],
          [1, { raptor: 18, swarm: 22, allosaur: 6, stego: 3, armored: 2 }],
        ),
        split(
          "chaos",
          0.28,
          [0, { raptor: 20, swarm: 26, allosaur: 7, stego: 4, armored: 3 }],
          [1, { raptor: 20, swarm: 26, allosaur: 7, stego: 4, armored: 3 }],
        ),
        split(
          "chaos",
          0.26,
          [0, { raptor: 18, swarm: 30, para: 5, allosaur: 8, stego: 5, armored: 3, titan: 1 }],
          [1, { raptor: 18, swarm: 30, para: 5, allosaur: 8, stego: 5, armored: 3, titan: 1 }],
        ),
        split(
          "chaos",
          0.24,
          [0, { raptor: 22, swarm: 32, para: 6, allosaur: 9, stego: 6, armored: 4, titan: 1 }],
          [1, { raptor: 22, swarm: 32, para: 6, allosaur: 9, stego: 6, armored: 4, titan: 1 }],
        ),
        split(
          "chaos",
          0.22,
          [0, { raptor: 20, swarm: 36, para: 8, allosaur: 10, stego: 7, armored: 5, titan: 2 }],
          [1, { raptor: 20, swarm: 36, para: 8, allosaur: 10, stego: 7, armored: 5, titan: 2 }],
        ),
        split(
          "chaos",
          0.2,
          [0, { raptor: 24, swarm: 38, para: 9, allosaur: 12, stego: 8, armored: 6, titan: 2 }],
          [1, { raptor: 24, swarm: 38, para: 9, allosaur: 12, stego: 8, armored: 6, titan: 2 }],
        ),
        split(
          "chaos",
          0.19,
          [0, { raptor: 22, swarm: 42, para: 10, allosaur: 13, stego: 9, armored: 7, titan: 3 }],
          [1, { raptor: 22, swarm: 42, para: 10, allosaur: 13, stego: 9, armored: 7, titan: 3 }],
        ),
        split(
          "chaos",
          0.18,
          [0, { raptor: 26, swarm: 44, para: 11, allosaur: 14, stego: 10, armored: 8, titan: 3 }],
          [1, { raptor: 26, swarm: 44, para: 11, allosaur: 14, stego: 10, armored: 8, titan: 3 }],
        ),
        split(
          "chaos",
          0.17,
          [0, { raptor: 24, swarm: 48, para: 12, allosaur: 15, stego: 11, armored: 9, titan: 4 }],
          [1, { raptor: 24, swarm: 48, para: 12, allosaur: 15, stego: 11, armored: 9, titan: 4 }],
        ),
        split(
          "chaos",
          0.16,
          [0, { raptor: 28, swarm: 50, para: 13, allosaur: 16, stego: 12, armored: 10, titan: 4 }],
          [1, { raptor: 28, swarm: 50, para: 13, allosaur: 16, stego: 12, armored: 10, titan: 4 }],
        ),
        split(
          "chaos",
          0.15,
          [0, { raptor: 30, swarm: 54, para: 14, allosaur: 18, stego: 13, armored: 11, titan: 5 }],
          [1, { raptor: 30, swarm: 54, para: 14, allosaur: 18, stego: 13, armored: 11, titan: 5 }],
        ),
        split(
          "chaos",
          0.14,
          [0, { raptor: 32, swarm: 58, para: 15, allosaur: 20, stego: 15, armored: 12, titan: 5 }],
          [1, { raptor: 32, swarm: 58, para: 15, allosaur: 20, stego: 15, armored: 12, titan: 5 }],
        ),
        split(
          "chaos",
          0.13,
          [0, { raptor: 36, swarm: 64, para: 16, allosaur: 22, stego: 17, armored: 14, titan: 6 }],
          [1, { raptor: 36, swarm: 64, para: 16, allosaur: 22, stego: 17, armored: 14, titan: 6 }],
        ),
      ],
    },
    waves: [
      split(
        "chaos",
        0.4,
        [0, { raptor: 16, swarm: 12, allosaur: 3 }],
        [1, { raptor: 16, swarm: 12, allosaur: 3 }],
      ),
      split(
        "chaos",
        0.35,
        [0, { raptor: 18, swarm: 16, allosaur: 4, stego: 1 }],
        [1, { raptor: 18, swarm: 16, allosaur: 4, stego: 1 }],
      ),
      split(
        "chaos",
        0.32,
        [0, { raptor: 16, swarm: 20, allosaur: 5, stego: 2, armored: 1 }],
        [1, { raptor: 16, swarm: 20, allosaur: 5, stego: 2, armored: 1 }],
      ),
      split(
        "chaos",
        0.3,
        [0, { raptor: 18, swarm: 22, allosaur: 6, stego: 3, armored: 2 }],
        [1, { raptor: 18, swarm: 22, allosaur: 6, stego: 3, armored: 2 }],
      ),
      split(
        "chaos",
        0.28,
        [0, { raptor: 20, swarm: 26, allosaur: 7, stego: 4, armored: 3 }],
        [1, { raptor: 20, swarm: 26, allosaur: 7, stego: 4, armored: 3 }],
      ),
      split(
        "chaos",
        0.26,
        [0, { raptor: 18, swarm: 30, para: 5, allosaur: 8, stego: 5, armored: 3, titan: 1 }],
        [1, { raptor: 18, swarm: 30, para: 5, allosaur: 8, stego: 5, armored: 3, titan: 1 }],
      ),
      split(
        "chaos",
        0.24,
        [0, { raptor: 22, swarm: 32, para: 6, allosaur: 9, stego: 6, armored: 4, titan: 1 }],
        [1, { raptor: 22, swarm: 32, para: 6, allosaur: 9, stego: 6, armored: 4, titan: 1 }],
      ),
      split(
        "chaos",
        0.22,
        [0, { raptor: 20, swarm: 36, para: 8, allosaur: 10, stego: 7, armored: 5, titan: 2 }],
        [1, { raptor: 20, swarm: 36, para: 8, allosaur: 10, stego: 7, armored: 5, titan: 2 }],
      ),
      split(
        "chaos",
        0.2,
        [0, { raptor: 24, swarm: 38, para: 9, allosaur: 12, stego: 8, armored: 6, titan: 2 }],
        [1, { raptor: 24, swarm: 38, para: 9, allosaur: 12, stego: 8, armored: 6, titan: 2 }],
      ),
      split(
        "chaos",
        0.19,
        [0, { raptor: 22, swarm: 42, para: 10, allosaur: 13, stego: 9, armored: 7, titan: 3 }],
        [1, { raptor: 22, swarm: 42, para: 10, allosaur: 13, stego: 9, armored: 7, titan: 3 }],
      ),
      split(
        "chaos",
        0.18,
        [0, { raptor: 26, swarm: 44, para: 11, allosaur: 14, stego: 10, armored: 8, titan: 3 }],
        [1, { raptor: 26, swarm: 44, para: 11, allosaur: 14, stego: 10, armored: 8, titan: 3 }],
      ),
      split(
        "chaos",
        0.17,
        [0, { raptor: 24, swarm: 48, para: 12, allosaur: 15, stego: 11, armored: 9, titan: 4 }],
        [1, { raptor: 24, swarm: 48, para: 12, allosaur: 15, stego: 11, armored: 9, titan: 4 }],
      ),
      split(
        "chaos",
        0.16,
        [0, { raptor: 28, swarm: 50, para: 13, allosaur: 16, stego: 12, armored: 10, titan: 4 }],
        [1, { raptor: 28, swarm: 50, para: 13, allosaur: 16, stego: 12, armored: 10, titan: 4 }],
      ),
      split(
        "chaos",
        0.15,
        [0, { raptor: 30, swarm: 54, para: 14, allosaur: 18, stego: 13, armored: 11, titan: 5 }],
        [1, { raptor: 30, swarm: 54, para: 14, allosaur: 18, stego: 13, armored: 11, titan: 5 }],
      ),
      split(
        "chaos",
        0.14,
        [0, { raptor: 32, swarm: 58, para: 15, allosaur: 20, stego: 15, armored: 12, titan: 5 }],
        [1, { raptor: 32, swarm: 58, para: 15, allosaur: 20, stego: 15, armored: 12, titan: 5 }],
      ),
      split(
        "chaos",
        0.13,
        [0, { raptor: 36, swarm: 64, para: 16, allosaur: 22, stego: 17, armored: 14, titan: 6 }],
        [1, { raptor: 36, swarm: 64, para: 16, allosaur: 22, stego: 17, armored: 14, titan: 6 }],
      ),
    ],
  },
  {
    id: 29,
    name: "Eye of the Storm",
    // Four paths — three converging on the center, one perpendicular
    // cross-cutter that pulls attention away from the obvious choke.
    paths: [
      p(-20, 10, -10, 6, -2, 2, 4, -2, 12, -6, 20, -8),
      p(-20, -10, -10, -6, -2, -2, 4, 2, 12, 6, 20, 8),
      p(0, -14, 0, -6, 0, 6, 0, 14),
      p(-20, 0, -10, 0, 0, 0, 10, 0, 20, 0),
    ],
    startGold: 210,
    nodePos: { x: -12, y: 26 },
    hpScale: 3.8,
    breach: {
      // Pulse + Mortar banned: no rifle, no shells. The four-path map
      // already breaks coverage — losing two AoE staples forces tight
      // chain bounces and hive uplinks across the convergence point.
      // Cryo + flame are your only direct DPS levers.
      startGold: 780,
      forbiddenTowers: ["pulse", "mortar"],
      tagline: "Four winds. No rifle. No shells.",
      waves: [
        split(
          "intro",
          0.75,
          [0, { raptor: 12 }],
          [1, { raptor: 12 }],
          [2, { raptor: 12 }],
          [3, { raptor: 12 }],
        ),
        split(
          "mixed",
          0.45,
          [0, { raptor: 14, swarm: 12 }],
          [1, { raptor: 14, swarm: 12 }],
          [2, { raptor: 14, swarm: 12 }],
          [3, { raptor: 14, swarm: 12 }],
        ),
        split(
          "swarm",
          0.09,
          [0, { swarm: 55 }],
          [1, { swarm: 55 }],
          [2, { swarm: 55 }],
          [3, { swarm: 55 }],
        ),
        split(
          "heavy",
          0.85,
          [0, { armored: 3, stego: 2 }],
          [1, { armored: 3, stego: 2 }],
          [2, { armored: 3, stego: 2 }],
          [3, { armored: 3, stego: 2 }],
        ),
        split(
          "mixed",
          0.42,
          [0, { raptor: 16, swarm: 14, allosaur: 5 }],
          [1, { raptor: 16, swarm: 14, allosaur: 5 }],
          [2, { raptor: 16, swarm: 14, allosaur: 5 }],
          [3, { raptor: 16, swarm: 14, allosaur: 5 }],
        ),
        // Shielded chaos across all four lanes — chain has to pop the
        // shields before it can arc. Hive uplinks help breakeven.
        {
          archetype: "chaos",
          spacing: 0.26,
          spawns: [
            ...toSpawns({ raptor: 4, stego: 2 }, 0, { shielded: true }),
            ...toSpawns({ raptor: 12, swarm: 18, allosaur: 5, stego: 2 }, 0),
            ...toSpawns({ raptor: 4, stego: 2 }, 1, { shielded: true }),
            ...toSpawns({ raptor: 12, swarm: 18, allosaur: 5, stego: 2 }, 1),
            ...toSpawns({ raptor: 4, stego: 2 }, 2, { shielded: true }),
            ...toSpawns({ raptor: 12, swarm: 18, allosaur: 5, stego: 2 }, 2),
            ...toSpawns({ raptor: 4, stego: 2 }, 3, { shielded: true }),
            ...toSpawns({ raptor: 12, swarm: 18, allosaur: 5, stego: 2 }, 3),
          ],
        },
        split(
          "swarm",
          0.07,
          [0, { swarm: 75 }],
          [1, { swarm: 75 }],
          [2, { swarm: 75 }],
          [3, { swarm: 75 }],
        ),
        split(
          "heavy",
          0.8,
          [0, { armored: 9, stego: 5, titan: 1 }],
          [1, { armored: 9, stego: 5 }],
          [2, { armored: 9, stego: 5, titan: 1 }],
          [3, { armored: 9, stego: 5 }],
        ),
        split(
          "mixed",
          0.38,
          [0, { raptor: 18, swarm: 16, allosaur: 6, stego: 4 }],
          [1, { raptor: 18, swarm: 16, allosaur: 6, stego: 4 }],
          [2, { raptor: 18, swarm: 16, allosaur: 6, stego: 4 }],
          [3, { raptor: 18, swarm: 16, allosaur: 6, stego: 4 }],
        ),
        split(
          "chaos",
          0.22,
          [0, { raptor: 16, swarm: 24, allosaur: 7, stego: 5, armored: 4 }],
          [1, { raptor: 16, swarm: 24, allosaur: 7, stego: 5, armored: 4 }],
          [2, { raptor: 16, swarm: 24, allosaur: 7, stego: 5, armored: 4 }],
          [3, { raptor: 16, swarm: 24, allosaur: 7, stego: 5, armored: 4 }],
        ),
        split(
          "heavy",
          0.7,
          [0, { armored: 13, stego: 7, titan: 2 }],
          [1, { armored: 13, stego: 7, titan: 2 }],
          [2, { armored: 13, stego: 7, titan: 2 }],
          [3, { armored: 13, stego: 7, titan: 2 }],
        ),
        split(
          "swarm",
          0.055,
          [0, { swarm: 100 }],
          [1, { swarm: 100 }],
          [2, { swarm: 100 }],
          [3, { swarm: 100 }],
        ),
        // Regen stego + healing para on every lane — chain has to push
        // through both chips while flame DoT dribbles damage.
        {
          archetype: "mixed",
          spacing: 0.32,
          spawns: [
            ...toSpawns({ stego: 2 }, 0, { regen: true }),
            ...toSpawns({ para: 2 }, 0, { healAura: true }),
            ...toSpawns({ raptor: 20, swarm: 18, allosaur: 8, stego: 4 }, 0),
            ...toSpawns({ stego: 2 }, 1, { regen: true }),
            ...toSpawns({ para: 2 }, 1, { healAura: true }),
            ...toSpawns({ raptor: 20, swarm: 18, allosaur: 8, stego: 4 }, 1),
            ...toSpawns({ stego: 2 }, 2, { regen: true }),
            ...toSpawns({ para: 2 }, 2, { healAura: true }),
            ...toSpawns({ raptor: 20, swarm: 18, allosaur: 8, stego: 4 }, 2),
            ...toSpawns({ stego: 2 }, 3, { regen: true }),
            ...toSpawns({ para: 2 }, 3, { healAura: true }),
            ...toSpawns({ raptor: 20, swarm: 18, allosaur: 8, stego: 4 }, 3),
          ],
        },
        split(
          "chaos",
          0.2,
          [0, { raptor: 20, swarm: 28, allosaur: 8, stego: 6, armored: 5, titan: 2 }],
          [1, { raptor: 20, swarm: 28, allosaur: 8, stego: 6, armored: 5, titan: 2 }],
          [2, { raptor: 20, swarm: 28, allosaur: 8, stego: 6, armored: 5, titan: 2 }],
          [3, { raptor: 20, swarm: 28, allosaur: 8, stego: 6, armored: 5, titan: 2 }],
        ),
        split(
          "heavy",
          0.65,
          [0, { armored: 17, stego: 10, titan: 3 }],
          [1, { armored: 17, stego: 10, titan: 3 }],
          [2, { armored: 17, stego: 10, titan: 3 }],
          [3, { armored: 17, stego: 10, titan: 3 }],
        ),
        split(
          "chaos",
          0.18,
          [0, { raptor: 24, swarm: 32, para: 9, allosaur: 13, stego: 9, armored: 7, titan: 3 }],
          [1, { raptor: 24, swarm: 32, para: 9, allosaur: 13, stego: 9, armored: 7, titan: 3 }],
          [2, { raptor: 24, swarm: 32, para: 9, allosaur: 13, stego: 9, armored: 7, titan: 3 }],
          [3, { raptor: 24, swarm: 32, para: 9, allosaur: 13, stego: 9, armored: 7, titan: 3 }],
        ),
        {
          archetype: "chaos",
          spacing: 0.16,
          spawns: [
            ...toSpawns({ armored: 2, titan: 1 }, 0),
            ...toSpawns(
              { raptor: 28, swarm: 38, para: 11, allosaur: 15, stego: 11, armored: 9, titan: 4 },
              0,
            ),
            ...toSpawns({ armored: 2, titan: 1 }, 1),
            ...toSpawns(
              { raptor: 28, swarm: 38, para: 11, allosaur: 15, stego: 11, armored: 9, titan: 4 },
              1,
            ),
            ...toSpawns({ armored: 2, titan: 1 }, 2),
            ...toSpawns(
              { raptor: 28, swarm: 38, para: 11, allosaur: 15, stego: 11, armored: 9, titan: 4 },
              2,
            ),
            ...toSpawns({ armored: 2, titan: 1 }, 3),
            ...toSpawns(
              { raptor: 28, swarm: 38, para: 11, allosaur: 15, stego: 11, armored: 9, titan: 4 },
              3,
            ),
          ],
        },
      ],
    },
    containment: {
      // Locked: chain (swarm + electric on para), cryo (slow the
      // armored stampedes), hive (drone uplinks amplify chain across
      // the convergence). No pulse rifle, no mortar splash, no flame.
      startGold: 700,
      lockedLoadout: ["chain", "cryo", "hive"],
      singleLife: true,
      noSelling: true,
      tagline: "One life. Coil, freeze, drone.",
      waves: [
        split(
          "intro",
          0.8,
          [0, { raptor: 10 }],
          [1, { raptor: 10 }],
          [2, { raptor: 10 }],
          [3, { raptor: 10 }],
        ),
        split(
          "mixed",
          0.5,
          [0, { raptor: 12, swarm: 8 }],
          [1, { raptor: 12, swarm: 8 }],
          [2, { raptor: 12, swarm: 8 }],
          [3, { raptor: 12, swarm: 8 }],
        ),
        split(
          "swarm",
          0.1,
          [0, { swarm: 45 }],
          [1, { swarm: 45 }],
          [2, { swarm: 45 }],
          [3, { swarm: 45 }],
        ),
        split(
          "heavy",
          0.9,
          [0, { armored: 2, stego: 2 }],
          [1, { armored: 2, stego: 2 }],
          [2, { armored: 2, stego: 2 }],
          [3, { armored: 2, stego: 2 }],
        ),
        split(
          "mixed",
          0.45,
          [0, { raptor: 14, swarm: 12, allosaur: 4 }],
          [1, { raptor: 14, swarm: 12, allosaur: 4 }],
          [2, { raptor: 14, swarm: 12, allosaur: 4 }],
          [3, { raptor: 14, swarm: 12, allosaur: 4 }],
        ),
        split(
          "chaos",
          0.3,
          [0, { raptor: 12, swarm: 16, allosaur: 5, stego: 3 }],
          [1, { raptor: 12, swarm: 16, allosaur: 5, stego: 3 }],
          [2, { raptor: 12, swarm: 16, allosaur: 5, stego: 3 }],
          [3, { raptor: 12, swarm: 16, allosaur: 5, stego: 3 }],
        ),
        split(
          "swarm",
          0.08,
          [0, { swarm: 60 }],
          [1, { swarm: 60 }],
          [2, { swarm: 60 }],
          [3, { swarm: 60 }],
        ),
        split(
          "heavy",
          0.85,
          [0, { armored: 8, stego: 4, titan: 1 }],
          [1, { armored: 8, stego: 4 }],
          [2, { armored: 8, stego: 4, titan: 1 }],
          [3, { armored: 8, stego: 4 }],
        ),
        split(
          "mixed",
          0.42,
          [0, { raptor: 16, swarm: 14, allosaur: 5, stego: 3 }],
          [1, { raptor: 16, swarm: 14, allosaur: 5, stego: 3 }],
          [2, { raptor: 16, swarm: 14, allosaur: 5, stego: 3 }],
          [3, { raptor: 16, swarm: 14, allosaur: 5, stego: 3 }],
        ),
        split(
          "chaos",
          0.25,
          [0, { raptor: 14, swarm: 20, allosaur: 6, stego: 4, armored: 3 }],
          [1, { raptor: 14, swarm: 20, allosaur: 6, stego: 4, armored: 3 }],
          [2, { raptor: 14, swarm: 20, allosaur: 6, stego: 4, armored: 3 }],
          [3, { raptor: 14, swarm: 20, allosaur: 6, stego: 4, armored: 3 }],
        ),
        split(
          "heavy",
          0.75,
          [0, { armored: 12, stego: 6, titan: 2 }],
          [1, { armored: 12, stego: 6, titan: 2 }],
          [2, { armored: 12, stego: 6, titan: 2 }],
          [3, { armored: 12, stego: 6, titan: 2 }],
        ),
        split(
          "swarm",
          0.06,
          [0, { swarm: 85 }],
          [1, { swarm: 85 }],
          [2, { swarm: 85 }],
          [3, { swarm: 85 }],
        ),
        split(
          "mixed",
          0.38,
          [0, { raptor: 18, swarm: 18, para: 5, allosaur: 8, stego: 5 }],
          [1, { raptor: 18, swarm: 18, para: 5, allosaur: 8, stego: 5 }],
          [2, { raptor: 18, swarm: 18, para: 5, allosaur: 8, stego: 5 }],
          [3, { raptor: 18, swarm: 18, para: 5, allosaur: 8, stego: 5 }],
        ),
        split(
          "chaos",
          0.22,
          [0, { raptor: 18, swarm: 26, allosaur: 8, stego: 6, armored: 4, titan: 2 }],
          [1, { raptor: 18, swarm: 26, allosaur: 8, stego: 6, armored: 4, titan: 2 }],
          [2, { raptor: 18, swarm: 26, allosaur: 8, stego: 6, armored: 4, titan: 2 }],
          [3, { raptor: 18, swarm: 26, allosaur: 8, stego: 6, armored: 4, titan: 2 }],
        ),
        split(
          "heavy",
          0.7,
          [0, { armored: 16, stego: 9, titan: 3 }],
          [1, { armored: 16, stego: 9, titan: 3 }],
          [2, { armored: 16, stego: 9, titan: 3 }],
          [3, { armored: 16, stego: 9, titan: 3 }],
        ),
        split(
          "chaos",
          0.2,
          [0, { raptor: 22, swarm: 30, para: 8, allosaur: 12, stego: 8, armored: 6, titan: 3 }],
          [1, { raptor: 22, swarm: 30, para: 8, allosaur: 12, stego: 8, armored: 6, titan: 3 }],
          [2, { raptor: 22, swarm: 30, para: 8, allosaur: 12, stego: 8, armored: 6, titan: 3 }],
          [3, { raptor: 22, swarm: 30, para: 8, allosaur: 12, stego: 8, armored: 6, titan: 3 }],
        ),
        split(
          "chaos",
          0.18,
          [0, { raptor: 26, swarm: 34, para: 10, allosaur: 14, stego: 10, armored: 8, titan: 4 }],
          [1, { raptor: 26, swarm: 34, para: 10, allosaur: 14, stego: 10, armored: 8, titan: 4 }],
          [2, { raptor: 26, swarm: 34, para: 10, allosaur: 14, stego: 10, armored: 8, titan: 4 }],
          [3, { raptor: 26, swarm: 34, para: 10, allosaur: 14, stego: 10, armored: 8, titan: 4 }],
        ),
        split(
          "chaos",
          0.16,
          [0, { raptor: 30, swarm: 40, para: 12, allosaur: 16, stego: 12, armored: 10, titan: 5 }],
          [1, { raptor: 30, swarm: 40, para: 12, allosaur: 16, stego: 12, armored: 10, titan: 5 }],
          [2, { raptor: 30, swarm: 40, para: 12, allosaur: 16, stego: 12, armored: 10, titan: 5 }],
          [3, { raptor: 30, swarm: 40, para: 12, allosaur: 16, stego: 12, armored: 10, titan: 5 }],
        ),
      ],
    },
    waves: [
      split(
        "intro",
        0.8,
        [0, { raptor: 10 }],
        [1, { raptor: 10 }],
        [2, { raptor: 10 }],
        [3, { raptor: 10 }],
      ),
      split(
        "mixed",
        0.5,
        [0, { raptor: 12, swarm: 8 }],
        [1, { raptor: 12, swarm: 8 }],
        [2, { raptor: 12, swarm: 8 }],
        [3, { raptor: 12, swarm: 8 }],
      ),
      split(
        "swarm",
        0.1,
        [0, { swarm: 45 }],
        [1, { swarm: 45 }],
        [2, { swarm: 45 }],
        [3, { swarm: 45 }],
      ),
      split(
        "heavy",
        0.9,
        [0, { armored: 2, stego: 2 }],
        [1, { armored: 2, stego: 2 }],
        [2, { armored: 2, stego: 2 }],
        [3, { armored: 2, stego: 2 }],
      ),
      split(
        "mixed",
        0.45,
        [0, { raptor: 14, swarm: 12, allosaur: 4 }],
        [1, { raptor: 14, swarm: 12, allosaur: 4 }],
        [2, { raptor: 14, swarm: 12, allosaur: 4 }],
        [3, { raptor: 14, swarm: 12, allosaur: 4 }],
      ),
      split(
        "chaos",
        0.3,
        [0, { raptor: 12, swarm: 16, allosaur: 5, stego: 3 }],
        [1, { raptor: 12, swarm: 16, allosaur: 5, stego: 3 }],
        [2, { raptor: 12, swarm: 16, allosaur: 5, stego: 3 }],
        [3, { raptor: 12, swarm: 16, allosaur: 5, stego: 3 }],
      ),
      split(
        "swarm",
        0.08,
        [0, { swarm: 60 }],
        [1, { swarm: 60 }],
        [2, { swarm: 60 }],
        [3, { swarm: 60 }],
      ),
      split(
        "heavy",
        0.85,
        [0, { armored: 8, stego: 4, titan: 1 }],
        [1, { armored: 8, stego: 4 }],
        [2, { armored: 8, stego: 4, titan: 1 }],
        [3, { armored: 8, stego: 4 }],
      ),
      split(
        "mixed",
        0.42,
        [0, { raptor: 16, swarm: 14, allosaur: 5, stego: 3 }],
        [1, { raptor: 16, swarm: 14, allosaur: 5, stego: 3 }],
        [2, { raptor: 16, swarm: 14, allosaur: 5, stego: 3 }],
        [3, { raptor: 16, swarm: 14, allosaur: 5, stego: 3 }],
      ),
      split(
        "chaos",
        0.25,
        [0, { raptor: 14, swarm: 20, allosaur: 6, stego: 4, armored: 3 }],
        [1, { raptor: 14, swarm: 20, allosaur: 6, stego: 4, armored: 3 }],
        [2, { raptor: 14, swarm: 20, allosaur: 6, stego: 4, armored: 3 }],
        [3, { raptor: 14, swarm: 20, allosaur: 6, stego: 4, armored: 3 }],
      ),
      split(
        "heavy",
        0.75,
        [0, { armored: 12, stego: 6, titan: 2 }],
        [1, { armored: 12, stego: 6, titan: 2 }],
        [2, { armored: 12, stego: 6, titan: 2 }],
        [3, { armored: 12, stego: 6, titan: 2 }],
      ),
      split(
        "swarm",
        0.06,
        [0, { swarm: 85 }],
        [1, { swarm: 85 }],
        [2, { swarm: 85 }],
        [3, { swarm: 85 }],
      ),
      split(
        "mixed",
        0.38,
        [0, { raptor: 18, swarm: 18, para: 5, allosaur: 8, stego: 5 }],
        [1, { raptor: 18, swarm: 18, para: 5, allosaur: 8, stego: 5 }],
        [2, { raptor: 18, swarm: 18, para: 5, allosaur: 8, stego: 5 }],
        [3, { raptor: 18, swarm: 18, para: 5, allosaur: 8, stego: 5 }],
      ),
      split(
        "chaos",
        0.22,
        [0, { raptor: 18, swarm: 26, allosaur: 8, stego: 6, armored: 4, titan: 2 }],
        [1, { raptor: 18, swarm: 26, allosaur: 8, stego: 6, armored: 4, titan: 2 }],
        [2, { raptor: 18, swarm: 26, allosaur: 8, stego: 6, armored: 4, titan: 2 }],
        [3, { raptor: 18, swarm: 26, allosaur: 8, stego: 6, armored: 4, titan: 2 }],
      ),
      split(
        "heavy",
        0.7,
        [0, { armored: 16, stego: 9, titan: 3 }],
        [1, { armored: 16, stego: 9, titan: 3 }],
        [2, { armored: 16, stego: 9, titan: 3 }],
        [3, { armored: 16, stego: 9, titan: 3 }],
      ),
      split(
        "chaos",
        0.2,
        [0, { raptor: 22, swarm: 30, para: 8, allosaur: 12, stego: 8, armored: 6, titan: 3 }],
        [1, { raptor: 22, swarm: 30, para: 8, allosaur: 12, stego: 8, armored: 6, titan: 3 }],
        [2, { raptor: 22, swarm: 30, para: 8, allosaur: 12, stego: 8, armored: 6, titan: 3 }],
        [3, { raptor: 22, swarm: 30, para: 8, allosaur: 12, stego: 8, armored: 6, titan: 3 }],
      ),
      split(
        "chaos",
        0.18,
        [0, { raptor: 26, swarm: 34, para: 10, allosaur: 14, stego: 10, armored: 8, titan: 4 }],
        [1, { raptor: 26, swarm: 34, para: 10, allosaur: 14, stego: 10, armored: 8, titan: 4 }],
        [2, { raptor: 26, swarm: 34, para: 10, allosaur: 14, stego: 10, armored: 8, titan: 4 }],
        [3, { raptor: 26, swarm: 34, para: 10, allosaur: 14, stego: 10, armored: 8, titan: 4 }],
      ),
      split(
        "chaos",
        0.16,
        [0, { raptor: 30, swarm: 40, para: 12, allosaur: 16, stego: 12, armored: 10, titan: 5 }],
        [1, { raptor: 30, swarm: 40, para: 12, allosaur: 16, stego: 12, armored: 10, titan: 5 }],
        [2, { raptor: 30, swarm: 40, para: 12, allosaur: 16, stego: 12, armored: 10, titan: 5 }],
        [3, { raptor: 30, swarm: 40, para: 12, allosaur: 16, stego: 12, armored: 10, titan: 5 }],
      ),
    ],
  },
  {
    id: 30,
    name: "Final Extinction",
    // The real ending. Three converging paths, 20 waves, everything the
    // game has. hpScale 4.0× makes one-of-each stacks melt — you need
    // the full portfolio, fully upgraded, thoughtfully placed.
    paths: [
      p(-20, 10, -12, 6, -4, 2, 0, 0, 6, -2, 14, -4, 20, -6),
      p(-20, -10, -12, -6, -4, -2, 0, 0, 6, 2, 14, 4, 20, 6),
      p(-20, 0, -12, 0, -4, 0, 0, 0, 6, 0, 14, 0, 20, 0),
    ],
    startGold: 250,
    nodePos: { x: -20, y: 22 },
    hpScale: 4.0,
    waves: [
      split(
        "intro",
        0.85,
        [0, { raptor: 14, swarm: 6 }],
        [1, { raptor: 14, swarm: 6 }],
        [2, { raptor: 14, swarm: 6 }],
      ),
      split(
        "mixed",
        0.5,
        [0, { raptor: 16, swarm: 14, para: 4, allosaur: 4 }],
        [1, { raptor: 16, swarm: 14, para: 4, allosaur: 4 }],
        [2, { raptor: 16, swarm: 14, para: 4, allosaur: 4 }],
      ),
      split("swarm", 0.09, [0, { swarm: 70 }], [1, { swarm: 70 }], [2, { swarm: 70 }]),
      split(
        "heavy",
        0.9,
        [0, { armored: 4, stego: 2 }],
        [1, { armored: 4, stego: 2 }],
        [2, { armored: 4, stego: 2 }],
      ),
      split(
        "mixed",
        0.45,
        [0, { raptor: 18, swarm: 16, para: 5, allosaur: 6, stego: 3 }],
        [1, { raptor: 18, swarm: 16, para: 5, allosaur: 6, stego: 3 }],
        [2, { raptor: 18, swarm: 16, para: 5, allosaur: 6, stego: 3 }],
      ),
      split(
        "chaos",
        0.3,
        [0, { raptor: 16, swarm: 22, para: 4, allosaur: 7, stego: 4, armored: 2 }],
        [1, { raptor: 16, swarm: 22, para: 4, allosaur: 7, stego: 4, armored: 2 }],
        [2, { raptor: 16, swarm: 22, para: 4, allosaur: 7, stego: 4, armored: 2 }],
      ),
      split("swarm", 0.07, [0, { swarm: 95 }], [1, { swarm: 95 }], [2, { swarm: 95 }]),
      split(
        "heavy",
        0.85,
        [0, { armored: 12, stego: 6, titan: 2 }],
        [1, { armored: 12, stego: 6, titan: 2 }],
        [2, { armored: 12, stego: 6, titan: 2 }],
      ),
      split(
        "mixed",
        0.4,
        [0, { raptor: 20, swarm: 18, para: 6, allosaur: 9, stego: 5 }],
        [1, { raptor: 20, swarm: 18, para: 6, allosaur: 9, stego: 5 }],
        [2, { raptor: 20, swarm: 18, para: 6, allosaur: 9, stego: 5 }],
      ),
      split(
        "chaos",
        0.26,
        [0, { raptor: 18, swarm: 26, para: 6, allosaur: 10, stego: 6, armored: 4, titan: 1 }],
        [1, { raptor: 18, swarm: 26, para: 6, allosaur: 10, stego: 6, armored: 4, titan: 1 }],
        [2, { raptor: 18, swarm: 26, para: 6, allosaur: 10, stego: 6, armored: 4, titan: 1 }],
      ),
      split(
        "heavy",
        0.78,
        [0, { armored: 16, stego: 9, titan: 3 }],
        [1, { armored: 16, stego: 9, titan: 3 }],
        [2, { armored: 16, stego: 9, titan: 3 }],
      ),
      flamebreakSplit(
        0.06,
        [0, { swarm: 150, raptor: 25, allosaur: 4 }],
        [1, { swarm: 150, raptor: 25, allosaur: 4 }],
        [2, { swarm: 150, raptor: 25, allosaur: 4 }],
      ),
      split(
        "mixed",
        0.36,
        [0, { raptor: 22, swarm: 22, para: 8, allosaur: 14, stego: 8, armored: 3 }],
        [1, { raptor: 22, swarm: 22, para: 8, allosaur: 14, stego: 8, armored: 3 }],
        [2, { raptor: 22, swarm: 22, para: 8, allosaur: 14, stego: 8, armored: 3 }],
      ),
      split(
        "chaos",
        0.23,
        [0, { raptor: 22, swarm: 30, para: 8, allosaur: 12, stego: 8, armored: 5, titan: 2 }],
        [1, { raptor: 22, swarm: 30, para: 8, allosaur: 12, stego: 8, armored: 5, titan: 2 }],
        [2, { raptor: 22, swarm: 30, para: 8, allosaur: 12, stego: 8, armored: 5, titan: 2 }],
      ),
      split(
        "heavy",
        0.72,
        [0, { armored: 20, stego: 12, titan: 4 }],
        [1, { armored: 20, stego: 12, titan: 4 }],
        [2, { armored: 20, stego: 12, titan: 4 }],
      ),
      flamebreakSplit(
        0.05,
        [0, { swarm: 190, raptor: 35, allosaur: 6 }],
        [1, { swarm: 190, raptor: 35, allosaur: 6 }],
        [2, { swarm: 190, raptor: 35, allosaur: 6 }],
      ),
      split(
        "chaos",
        0.2,
        [0, { raptor: 26, swarm: 36, para: 10, allosaur: 14, stego: 10, armored: 7, titan: 3 }],
        [1, { raptor: 26, swarm: 36, para: 10, allosaur: 14, stego: 10, armored: 7, titan: 3 }],
        [2, { raptor: 26, swarm: 36, para: 10, allosaur: 14, stego: 10, armored: 7, titan: 3 }],
      ),
      split(
        "heavy",
        0.65,
        [0, { armored: 24, stego: 14, titan: 6 }],
        [1, { armored: 24, stego: 14, titan: 6 }],
        [2, { armored: 24, stego: 14, titan: 6 }],
      ),
      // Pre-finale: every damage type meets its specialist. Pulse can't
      // close on the Ironplate armored, chain can't fry the Insulated
      // para, cryo can't lock the Thermal swarm, mortar can't crack the
      // Bunker titan, pyre can't ignite the Asbestos allosaur. The
      // single-tower-spam route hits a wall here — the apex finale that
      // follows assumes a full portfolio is in play.
      {
        archetype: "chaos",
        spacing: 0.17,
        spawns: [
          ...toSpawns(
            { raptor: 32, swarm: 36, para: 12, allosaur: 16, stego: 13, armored: 8, titan: 4 },
            0,
          ),
          ...toSpawns(
            { raptor: 32, swarm: 36, para: 12, allosaur: 16, stego: 13, armored: 8, titan: 4 },
            1,
          ),
          ...toSpawns(
            { raptor: 32, swarm: 36, para: 12, allosaur: 16, stego: 13, armored: 8, titan: 4 },
            2,
          ),
          ...toSpawns({ armored: 2 }, 0, { resists: RESIST_KINETIC_95 }),
          ...toSpawns({ para: 2 }, 1, { resists: RESIST_ELECTRIC_95 }),
          ...toSpawns({ swarm: 8 }, 2, { resists: RESIST_COLD_95 }),
          ...toSpawns({ titan: 1 }, 0, { resists: RESIST_EXPLOSIVE_95 }),
          ...toSpawns({ allosaur: 2 }, 2, { resists: RESIST_FLAME_95 }),
        ],
      },
      // Final Extinction: a triumvirate of Apex Matriarchs, one per
      // lane, riding in on a wall of titans and armored. The apex
      // variant deliberately has no child-spawn stream — the campaign
      // finale leans on entourage + the multi-stream trickle below, so
      // adding a fourth pressure source would tip it past feasibility.
      {
        archetype: "convoy",
        spacing: 0.45,
        bossWave: true,
        spawns: [
          ...toSpawns({ stego: 10, armored: 12, titan: 5 }, 0),
          ...toSpawns({ stego: 10, armored: 12, titan: 5 }, 1),
          ...toSpawns({ stego: 10, armored: 12, titan: 5 }, 2),
          bossSpawn("apex", 0),
          bossSpawn("apex", 1),
          bossSpawn("apex", 2),
        ],
        bossTrickle: [
          trickleStream(0, ["swarm", "raptor", "allosaur"], 1.1, 1.7, 5),
          trickleStream(1, ["swarm", "raptor", "allosaur"], 1.1, 1.7, 6),
          trickleStream(2, ["swarm", "raptor", "allosaur"], 1.1, 1.7, 7),
          trickleStream(0, ["raptor", "allosaur", "para", "stego"], 0.7, 1.2, 16),
          trickleStream(1, ["raptor", "allosaur", "para", "stego"], 0.7, 1.2, 17),
          trickleStream(2, ["raptor", "allosaur", "para", "stego"], 0.7, 1.2, 18),
          trickleStream(0, ["raptor", "allosaur", "armored", "stego"], 0.5, 0.9, 27, {
            shielded: true,
          }),
          trickleStream(1, ["raptor", "allosaur", "armored", "stego"], 0.5, 0.9, 28, {
            shielded: true,
          }),
          trickleStream(2, ["raptor", "allosaur", "armored", "stego"], 0.5, 0.9, 29, {
            shielded: true,
          }),
        ],
      },
    ],
    // Breach finale: no Hive. The drone-support meta that carries most
    // L30 builds is denied; the player must spread coverage across all
    // three lanes with the remaining five tower types. Bigger gold
    // pool to compensate for the loss of fire-rate amplification, and
    // a leaner 14-wave script that hits the apex finale faster.
    breach: {
      startGold: 850,
      forbiddenTowers: ["hive"],
      tagline: "No Hive. Cover three lanes alone.",
      waves: [
        split(
          "mixed",
          0.45,
          [0, { raptor: 18, swarm: 16, para: 5, allosaur: 6, stego: 3 }],
          [1, { raptor: 18, swarm: 16, para: 5, allosaur: 6, stego: 3 }],
          [2, { raptor: 18, swarm: 16, para: 5, allosaur: 6, stego: 3 }],
        ),
        split("swarm", 0.07, [0, { swarm: 110 }], [1, { swarm: 110 }], [2, { swarm: 110 }]),
        split(
          "heavy",
          0.8,
          [0, { armored: 10, stego: 5, titan: 1 }],
          [1, { armored: 10, stego: 5, titan: 1 }],
          [2, { armored: 10, stego: 5, titan: 1 }],
        ),
        split(
          "chaos",
          0.26,
          [0, { raptor: 18, swarm: 26, allosaur: 8, stego: 6, armored: 4, titan: 2 }],
          [1, { raptor: 18, swarm: 26, allosaur: 8, stego: 6, armored: 4, titan: 2 }],
          [2, { raptor: 18, swarm: 26, allosaur: 8, stego: 6, armored: 4, titan: 2 }],
        ),
        flamebreakSplit(
          0.06,
          [0, { swarm: 170, raptor: 30, allosaur: 5 }],
          [1, { swarm: 170, raptor: 30, allosaur: 5 }],
          [2, { swarm: 170, raptor: 30, allosaur: 5 }],
        ),
        split(
          "mixed",
          0.38,
          [0, { raptor: 22, swarm: 22, para: 8, allosaur: 14, stego: 8, armored: 3 }],
          [1, { raptor: 22, swarm: 22, para: 8, allosaur: 14, stego: 8, armored: 3 }],
          [2, { raptor: 22, swarm: 22, para: 8, allosaur: 14, stego: 8, armored: 3 }],
        ),
        split(
          "heavy",
          0.72,
          [0, { armored: 18, stego: 10, titan: 3 }],
          [1, { armored: 18, stego: 10, titan: 3 }],
          [2, { armored: 18, stego: 10, titan: 3 }],
        ),
        split(
          "chaos",
          0.22,
          [0, { raptor: 22, swarm: 30, para: 8, allosaur: 12, stego: 8, armored: 5, titan: 2 }],
          [1, { raptor: 22, swarm: 30, para: 8, allosaur: 12, stego: 8, armored: 5, titan: 2 }],
          [2, { raptor: 22, swarm: 30, para: 8, allosaur: 12, stego: 8, armored: 5, titan: 2 }],
        ),
        split(
          "heavy",
          0.65,
          [0, { armored: 22, stego: 12, titan: 5 }],
          [1, { armored: 22, stego: 12, titan: 5 }],
          [2, { armored: 22, stego: 12, titan: 5 }],
        ),
        split(
          "chaos",
          0.18,
          [0, { raptor: 30, swarm: 38, para: 12, allosaur: 16, stego: 12, armored: 9, titan: 4 }],
          [1, { raptor: 30, swarm: 38, para: 12, allosaur: 16, stego: 12, armored: 9, titan: 4 }],
          [2, { raptor: 30, swarm: 38, para: 12, allosaur: 16, stego: 12, armored: 9, titan: 4 }],
        ),
        // Breach finale matches the normal apex wave 1-for-1 — same
        // three matriarchs, same trickle streams. The mode "challenge"
        // already comes from denying Hive across the whole map; making
        // the finale even harder on top would tip the run past the
        // 2.0× feasibility wall.
        {
          archetype: "convoy",
          spacing: 0.4,
          bossWave: true,
          spawns: [
            ...toSpawns({ stego: 10, armored: 12, titan: 5 }, 0),
            ...toSpawns({ stego: 10, armored: 12, titan: 5 }, 1),
            ...toSpawns({ stego: 10, armored: 12, titan: 5 }, 2),
            bossSpawn("apex", 0),
            bossSpawn("apex", 1),
            bossSpawn("apex", 2),
          ],
          bossTrickle: [
            trickleStream(0, ["swarm", "raptor", "allosaur"], 1.1, 1.7, 5),
            trickleStream(1, ["swarm", "raptor", "allosaur"], 1.1, 1.7, 6),
            trickleStream(2, ["swarm", "raptor", "allosaur"], 1.1, 1.7, 7),
            trickleStream(0, ["raptor", "allosaur", "para", "stego"], 0.7, 1.2, 16),
            trickleStream(1, ["raptor", "allosaur", "para", "stego"], 0.7, 1.2, 17),
            trickleStream(2, ["raptor", "allosaur", "para", "stego"], 0.7, 1.2, 18),
          ],
        },
      ],
    },
    // Containment finale: one life, locked to the offensive trio — Pulse,
    // Chain, Mortar. No DoT (flame), no slowdown (cryo), no support
    // (hive). Pure damage management across three converging lanes
    // with an apex finale. Huge gold pool because the entire defense
    // commits at world creation and never sells.
    containment: {
      startGold: 2400,
      lockedLoadout: ["pulse", "chain", "mortar"],
      singleLife: true,
      noSelling: true,
      tagline: "1 life. Pulse · Chain · Mortar. Three apex queens.",
      waves: [
        split(
          "mixed",
          0.5,
          [0, { raptor: 16, swarm: 14, para: 4, allosaur: 4 }],
          [1, { raptor: 16, swarm: 14, para: 4, allosaur: 4 }],
          [2, { raptor: 16, swarm: 14, para: 4, allosaur: 4 }],
        ),
        split("swarm", 0.08, [0, { swarm: 90 }], [1, { swarm: 90 }], [2, { swarm: 90 }]),
        split(
          "heavy",
          0.85,
          [0, { armored: 8, stego: 4, titan: 1 }],
          [1, { armored: 8, stego: 4, titan: 1 }],
          [2, { armored: 8, stego: 4, titan: 1 }],
        ),
        split(
          "chaos",
          0.24,
          [0, { raptor: 18, swarm: 24, allosaur: 8, stego: 6, armored: 4 }],
          [1, { raptor: 18, swarm: 24, allosaur: 8, stego: 6, armored: 4 }],
          [2, { raptor: 18, swarm: 24, allosaur: 8, stego: 6, armored: 4 }],
        ),
        split(
          "heavy",
          0.7,
          [0, { armored: 16, stego: 9, titan: 3 }],
          [1, { armored: 16, stego: 9, titan: 3 }],
          [2, { armored: 16, stego: 9, titan: 3 }],
        ),
        split(
          "chaos",
          0.2,
          [0, { raptor: 24, swarm: 30, para: 8, allosaur: 12, stego: 8, armored: 6, titan: 2 }],
          [1, { raptor: 24, swarm: 30, para: 8, allosaur: 12, stego: 8, armored: 6, titan: 2 }],
          [2, { raptor: 24, swarm: 30, para: 8, allosaur: 12, stego: 8, armored: 6, titan: 2 }],
        ),
        // Containment finale: only two apex queens (one less than normal) so
        // the no-sell, single-life constraint stays survivable. Trickle
        // streams trimmed to two passes per lane.
        {
          archetype: "convoy",
          spacing: 0.45,
          bossWave: true,
          spawns: [
            ...toSpawns({ stego: 8, armored: 10, titan: 4 }, 0),
            ...toSpawns({ stego: 8, armored: 10, titan: 4 }, 1),
            ...toSpawns({ stego: 8, armored: 10, titan: 4 }, 2),
            bossSpawn("apex", 0),
            bossSpawn("apex", 2),
          ],
          bossTrickle: [
            trickleStream(0, ["swarm", "raptor", "allosaur"], 1.3, 1.9, 6),
            trickleStream(2, ["swarm", "raptor", "allosaur"], 1.3, 1.9, 7),
            trickleStream(1, ["raptor", "allosaur", "para"], 0.9, 1.4, 16),
          ],
        },
      ],
    },
  },
];

export const getLevel = (id: number): LevelConfig => {
  const level = LEVELS.find((l) => l.id === id);
  if (!level) throw new Error(`Level ${id} not found`);
  return level;
};

export const getLevelOrdinal = (id: number): { current: number; total: number } => {
  const index = LEVELS.findIndex((l) => l.id === id);
  if (index === -1) throw new Error(`Level ${id} not found`);
  return { current: index + 1, total: LEVELS.length };
};
