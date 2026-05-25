// Meta-progression "skill tree". Stars earned from clearing waves get
// invested between runs from the world map. Each tower kind owns three
// independent branches; each branch is a linear ladder of four tiers
// the player unlocks in order. Tier costs ramp [1, 1, 2, 3] = 7 stars
// to max one branch, 21 to max one tower, 126 to max every tower —
// the total exceeds the campaign's max-star ceiling on purpose so the
// player commits to specialisation.
//
// Effects bake into the tower at placement time (see applyMetaSkillsToTower
// below). In-game UPGRADES continue to scale on top — meta is the
// permanent floor, upgrades are the per-run climb.
//
// Refunds are free: stars aren't consumed, only allocated, so re-spec
// is one click in the panel.

import type { Tower, TowerKind } from "./types";
import { HIVE_MAX_DRONES, TOWER_COST } from "./world";

export type BranchId = "a" | "b" | "c";
export const BRANCH_IDS: readonly BranchId[] = ["a", "b", "c"];

// Tiers per branch (1..4). 0 = nothing invested.
export const MAX_TIER = 4;

// Per-tier star cost. Index 0 = unlock tier 1, index 3 = unlock tier 4.
// Ramped so the capstone is the expensive node and entry into a branch
// is cheap.
export const TIER_COST: readonly number[] = [1, 1, 2, 3];

export type MetaTier = {
  // Short noun (3-4 words) for the tier card header.
  name: string;
  // One-line description shown beneath the name. Reads as the effect
  // delta, not a sentence: "+12% damage", "15% crit · 2× dmg".
  desc: string;
  // Cumulative cost to reach this tier (sum of TIER_COST up to and
  // including this index). Precomputed in the runtime for the panel.
  costThis: number;
  // Mutates the tower in place to reflect this tier's effect. Branches
  // bake left-to-right (tier 1 first) so each apply only needs to add
  // its own delta; resets are handled by reapplying from base stats.
  apply: (tower: Tower) => void;
};

export type MetaBranch = {
  // Short label for the column header in the panel.
  label: string;
  // One-line subtitle clarifying the branch theme. Shown smaller than
  // the label.
  blurb: string;
  // Exactly four tiers per branch.
  tiers: [MetaTier, MetaTier, MetaTier, MetaTier];
};

export type MetaTowerTree = Record<BranchId, MetaBranch>;

// Helper to compute cumulative tier cost ([1,2,4,7] for [1,1,2,3]).
const cumCost = (tierIdx: number): number => {
  let s = 0;
  for (let i = 0; i <= tierIdx; i++) s += TIER_COST[i];
  return s;
};

const tier = (name: string, desc: string, idx: number, apply: (t: Tower) => void): MetaTier => ({
  name,
  desc,
  costThis: cumCost(idx),
  apply,
});

// --- Pulse ---------------------------------------------------------------

const PULSE: MetaTowerTree = {
  a: {
    label: "Ballistics",
    blurb: "Heavier rounds, then crits.",
    tiers: [
      tier("Bore Rifling", "+6% damage", 0, (t) => {
        t.damage *= 1.06;
      }),
      tier("Sabot Round", "+12% damage", 1, (t) => {
        t.damage *= 1.12;
      }),
      tier("Critical Hit", "15% crit · 2× damage", 2, (t) => {
        t.critChance = Math.max(t.critChance, 0.15);
        t.critMul = Math.max(t.critMul, 2);
      }),
      tier("Annihilator", "+18% damage, +15% crit", 3, (t) => {
        t.damage *= 1.18;
        t.critChance += 0.15;
      }),
    ],
  },
  b: {
    label: "Autoloader",
    blurb: "Faster cycling, extra reach.",
    tiers: [
      tier("Quick Spool", "+6% fire rate", 0, (t) => {
        t.fireRate *= 1.06;
      }),
      tier("Hot Receiver", "+12% fire rate", 1, (t) => {
        t.fireRate *= 1.12;
      }),
      tier("Overclock", "+20% fire rate", 2, (t) => {
        t.fireRate *= 1.2;
      }),
      tier("Hyperfire", "+15% fire rate, +0.5 range", 3, (t) => {
        t.fireRate *= 1.15;
        t.range += 0.5;
      }),
    ],
  },
  c: {
    label: "Logistics",
    blurb: "Cheaper rifles, longer scopes.",
    tiers: [
      tier("Surplus Stockpile", "-2g build cost", 0, () => {}),
      tier("Bulk Order", "-2g build cost (-4g total)", 1, () => {}),
      tier("Long Scope", "+0.6 range", 2, (t) => {
        t.range += 0.6;
      }),
      tier("Munitions Depot", "-3g (-7g total), +0.4 range", 3, (t) => {
        t.range += 0.4;
      }),
    ],
  },
};

// --- Chain ---------------------------------------------------------------

const CHAIN: MetaTowerTree = {
  a: {
    label: "Voltage",
    blurb: "Higher base voltage per arc.",
    tiers: [
      tier("Stepped Coils", "+6% damage", 0, (t) => {
        t.damage *= 1.06;
      }),
      tier("High Tension", "+12% damage", 1, (t) => {
        t.damage *= 1.12;
      }),
      tier("Resonance", "+1 chain target", 2, (t) => {
        t.chainCount += 1;
      }),
      tier("Arc Furnace", "+15% damage, +1 chain target", 3, (t) => {
        t.damage *= 1.15;
        t.chainCount += 1;
      }),
    ],
  },
  b: {
    label: "Conductor",
    blurb: "Wider arcs, shock slow.",
    tiers: [
      tier("Capacitor Bank", "+0.5 range", 0, (t) => {
        t.range += 0.5;
      }),
      tier("Quick Discharge", "+8% fire rate", 1, (t) => {
        t.fireRate *= 1.08;
      }),
      tier("Static Field", "Chain hits slow 20% · 0.5s", 2, (t) => {
        t.chainSlowFactor = Math.min(t.chainSlowFactor, 0.8);
        t.chainSlowDuration = Math.max(t.chainSlowDuration, 0.5);
      }),
      tier("Overcharge", "+12% rate, slow 30% · 0.7s", 3, (t) => {
        t.fireRate *= 1.12;
        t.chainSlowFactor = 0.7;
        t.chainSlowDuration = 0.7;
      }),
    ],
  },
  c: {
    label: "Coilworks",
    blurb: "Cheaper coils, longer reach.",
    tiers: [
      tier("Surplus Coils", "-2g build cost", 0, () => {}),
      tier("Bulk Order", "-2g build cost (-4g total)", 1, () => {}),
      tier("Lensed Antenna", "+0.5 range", 2, (t) => {
        t.range += 0.5;
      }),
      tier("Reclamation", "-3g (-7g total), +0.1 falloff", 3, (t) => {
        t.chainFalloff = Math.min(1, t.chainFalloff + 0.1);
      }),
    ],
  },
};

// --- Cryo ---------------------------------------------------------------

const CRYO: MetaTowerTree = {
  a: {
    label: "Subzero",
    blurb: "Pushes the chill to a full stop.",
    tiers: [
      tier("Cryogen Mix", "Slow factor 0.37", 0, (t) => {
        t.slowFactor = Math.min(t.slowFactor, 0.37);
      }),
      tier("Deep Chill", "Slow factor 0.34", 1, (t) => {
        t.slowFactor = Math.min(t.slowFactor, 0.34);
      }),
      tier("Flash Freeze", "12% freeze chance · 0.5s", 2, (t) => {
        t.freezeChance = Math.max(t.freezeChance, 0.12);
        t.freezeDuration = Math.max(t.freezeDuration, 0.5);
      }),
      tier("Absolute Zero", "Slow 0.30, +8% freeze (20%)", 3, (t) => {
        t.slowFactor = Math.min(t.slowFactor, 0.3);
        t.freezeChance += 0.08;
      }),
    ],
  },
  b: {
    label: "Resonator",
    blurb: "Longer reach, lingering frost.",
    tiers: [
      tier("Shard Array", "+0.4 range", 0, (t) => {
        t.range += 0.4;
      }),
      tier("Crystal Lens", "+0.4 range (+0.8 total)", 1, (t) => {
        t.range += 0.4;
      }),
      tier("Lingering Frost", "+0.7s chill duration", 2, (t) => {
        t.slowDuration += 0.7;
      }),
      tier("Frost Cone", "+0.4 range, +0.5s chill", 3, (t) => {
        t.range += 0.4;
        t.slowDuration += 0.5;
      }),
    ],
  },
  c: {
    label: "Cryoworks",
    blurb: "Cheaper coolant, sharper chill.",
    tiers: [
      tier("Surplus Cryo", "-3g build cost", 0, () => {}),
      tier("Bulk Coolant", "-3g build cost (-6g total)", 1, () => {}),
      tier("Insulated Cores", "+0.3 range", 2, (t) => {
        t.range += 0.3;
      }),
      tier("Industrial Chill", "-4g (-10g total), slow -0.02", 3, (t) => {
        t.slowFactor = Math.max(0, t.slowFactor - 0.02);
      }),
    ],
  },
};

// --- Mortar -------------------------------------------------------------

const MORTAR: MetaTowerTree = {
  a: {
    label: "Heavy Shells",
    blurb: "Denser payloads, fatter splash.",
    tiers: [
      tier("Dense Packing", "+6% damage", 0, (t) => {
        t.damage *= 1.06;
      }),
      tier("Thermobaric", "+12% damage", 1, (t) => {
        t.damage *= 1.12;
      }),
      tier("Cluster Shells", "+20% splash radius", 2, (t) => {
        t.splashRadius *= 1.2;
      }),
      tier("Annihilator", "+15% damage, +15% splash", 3, (t) => {
        t.damage *= 1.15;
        t.splashRadius *= 1.15;
      }),
    ],
  },
  b: {
    label: "Targeting",
    blurb: "Faster, smarter shells.",
    tiers: [
      tier("Spotter", "+0.4 range", 0, (t) => {
        t.range += 0.4;
      }),
      tier("Fire Control", "+8% fire rate", 1, (t) => {
        t.fireRate *= 1.08;
      }),
      tier("Smart Munitions", "+25% dmg vs clusters (3+)", 2, (t) => {
        t.clusterDamageBonus = Math.max(t.clusterDamageBonus, 0.25);
      }),
      tier("Saturation", "+10% rate, cluster bonus → 40%", 3, (t) => {
        t.fireRate *= 1.1;
        t.clusterDamageBonus = 0.4;
      }),
    ],
  },
  c: {
    label: "Depot",
    blurb: "Cheaper shells, bigger boom.",
    tiers: [
      tier("Surplus Shells", "-5g build cost", 0, () => {}),
      tier("Bulk Order", "-5g build cost (-10g total)", 1, () => {}),
      tier("Spotting Rig", "+0.4 range", 2, (t) => {
        t.range += 0.4;
      }),
      tier("Munitions Reserve", "-8g (-18g total), +6% splash", 3, (t) => {
        t.splashRadius *= 1.06;
      }),
    ],
  },
};

// --- Flame (Pyre) -------------------------------------------------------

const FLAME: MetaTowerTree = {
  a: {
    label: "Combustion",
    blurb: "Hotter mix, lingering burn.",
    tiers: [
      tier("Hot Mix", "+8% damage", 0, (t) => {
        t.damage *= 1.08;
      }),
      tier("Accelerant", "+14% damage", 1, (t) => {
        t.damage *= 1.14;
      }),
      tier("Ignite", "Burn 2s after range · 4 dps", 2, (t) => {
        t.flameIgniteDuration = Math.max(t.flameIgniteDuration, 2);
        t.flameIgniteDps = Math.max(t.flameIgniteDps, 4);
      }),
      tier("Napalm", "+15% damage, burn 3s · 7 dps", 3, (t) => {
        t.damage *= 1.15;
        t.flameIgniteDuration = 3;
        t.flameIgniteDps = 7;
      }),
    ],
  },
  b: {
    label: "Pressure",
    blurb: "Longer nozzle, hotter stream.",
    tiers: [
      tier("Nozzle Tuning", "+0.3 range", 0, (t) => {
        t.range += 0.3;
      }),
      tier("Twin Burner", "+10% fire rate", 1, (t) => {
        t.fireRate *= 1.1;
      }),
      tier("Long Burn", "+0.4 range, +5% rate", 2, (t) => {
        t.range += 0.4;
        t.fireRate *= 1.05;
      }),
      tier("Sunflare", "+0.5 range, +10% rate", 3, (t) => {
        t.range += 0.5;
        t.fireRate *= 1.1;
      }),
    ],
  },
  c: {
    label: "Refinery",
    blurb: "Cheaper fuel, longer reach.",
    tiers: [
      tier("Surplus Fuel", "-3g build cost", 0, () => {}),
      tier("Bulk Mix", "-3g build cost (-6g total)", 1, () => {}),
      tier("Pre-Heater", "+0.3 range", 2, (t) => {
        t.range += 0.3;
      }),
      tier("Pyrolytic Stills", "-6g (-12g total), +5% damage", 3, (t) => {
        t.damage *= 1.05;
      }),
    ],
  },
};

// --- Hive ---------------------------------------------------------------

const HIVE: MetaTowerTree = {
  a: {
    label: "Drone Bay",
    blurb: "More drones, sharper buffs.",
    tiers: [
      tier("Spare Drone", "+1 drone (4 total)", 0, (t) => {
        if (t.kind === "hive") t.droneCount = Math.min(HIVE_MAX_DRONES, t.droneCount + 1);
      }),
      tier("Twin Bay", "+1 drone (5 total)", 1, (t) => {
        if (t.kind === "hive") t.droneCount = Math.min(HIVE_MAX_DRONES, t.droneCount + 1);
      }),
      tier("Reinforced Drones", "Drones grant +5% damage", 2, (t) => {
        if (t.kind === "hive") t.serviceDamageBonus = Math.max(t.serviceDamageBonus, 0.05);
      }),
      tier("Full Squadron", "+1 drone (6), +5% damage buff", 3, (t) => {
        if (t.kind === "hive") {
          t.droneCount = Math.min(HIVE_MAX_DRONES, t.droneCount + 1);
          t.serviceDamageBonus += 0.05;
        }
      }),
    ],
  },
  b: {
    label: "Service Link",
    blurb: "Stronger fire-rate buffs.",
    tiers: [
      tier("Tuned Coils", "+3% buff per drone", 0, (t) => {
        if (t.kind === "hive") t.serviceBuff += 0.03;
      }),
      tier("Boosted Link", "+5% buff per drone", 1, (t) => {
        if (t.kind === "hive") t.serviceBuff += 0.05;
      }),
      tier("Harmonic Resonance", "+8% buff per drone", 2, (t) => {
        if (t.kind === "hive") t.serviceBuff += 0.08;
      }),
      tier("Overdrive", "+10% buff per drone", 3, (t) => {
        if (t.kind === "hive") t.serviceBuff += 0.1;
      }),
    ],
  },
  c: {
    label: "Workshop",
    blurb: "Cheaper hives, extra polish.",
    tiers: [
      tier("Surplus", "-6g build cost", 0, () => {}),
      tier("Bulk Order", "-6g build cost (-12g total)", 1, () => {}),
      tier("Refit Crew", "+3% buff per drone", 2, (t) => {
        if (t.kind === "hive") t.serviceBuff += 0.03;
      }),
      tier("Industrial Hive", "-10g (-22g total), +5% buff", 3, (t) => {
        if (t.kind === "hive") t.serviceBuff += 0.05;
      }),
    ],
  },
};

// Per-branch cumulative discount for the c-line "Surplus" tiers. The
// tier apply functions deliberately don't touch t.totalSpent — the
// discount is reflected at placement time via effectiveTowerCost so
// the player sees the cheaper price before clicking build.
//
// Discounts capped so meta-spam never beats upgrading. Pre-trim values
// were [3,7,7,12] on pulse/chain which yielded 38g base towers — wide
// spam of T0 chain dominated every wave except dense-HP heavies. Trim
// brings max discount down to ~14% of base cost; c-branch keeps its
// perk slots (range, falloff) untouched so investment still pays off.
const COST_DISCOUNT: Record<TowerKind, readonly number[]> = {
  pulse: [2, 4, 4, 7],
  chain: [2, 4, 4, 7],
  cryo: [3, 6, 6, 10],
  mortar: [5, 10, 10, 18],
  flame: [3, 6, 6, 12],
  hive: [6, 12, 12, 22],
};

// Minimum fraction of base cost the player still pays after every c-branch
// tier is bought. Keeps upgrade-gold competitive even at max meta — a
// fully-discounted tower never undercuts its own first in-game upgrade.
// Pulse/chain base is 50g; 0.7 floor lands at 35g which sits above the
// 30g first-upgrade so reinforcing an existing tower stays the cheaper
// per-DPS move than buying another T0.
const COST_FLOOR_FRACTION = 0.7;

export const META_SKILL_TREE: Record<TowerKind, MetaTowerTree> = {
  pulse: PULSE,
  chain: CHAIN,
  cryo: CRYO,
  mortar: MORTAR,
  flame: FLAME,
  hive: HIVE,
};

// Save shape. Per-tower, per-branch tier index (0..MAX_TIER). Storing
// the *tier* (not the cumulative star count) keeps the save compact and
// the runtime free to retune TIER_COST without invalidating saves.
export type MetaBranchTiers = Partial<Record<BranchId, number>>;
export type AllMetaSkills = Partial<Record<TowerKind, MetaBranchTiers>>;

const clampTier = (raw: unknown): number => {
  if (typeof raw !== "number") return 0;
  if (!Number.isFinite(raw)) return 0;
  if (raw < 0) return 0;
  if (raw > MAX_TIER) return MAX_TIER;
  return Math.floor(raw);
};

export const getTier = (meta: AllMetaSkills, kind: TowerKind, branch: BranchId): number =>
  clampTier(meta[kind]?.[branch]);

// Star cost to unlock the next-up tier on this branch. Returns 0 when
// the branch is fully maxed.
export const nextTierCost = (currentTier: number): number => {
  if (currentTier >= MAX_TIER) return 0;
  return TIER_COST[currentTier];
};

// Cumulative stars currently invested in this branch (sum of TIER_COST
// for unlocked tiers). Mirror in the panel for "X invested" badges.
export const branchSpent = (currentTier: number): number => {
  let s = 0;
  for (let i = 0; i < currentTier && i < TIER_COST.length; i++) s += TIER_COST[i];
  return s;
};

// Apply every unlocked tier on every branch to a freshly-created tower.
// Order: branch-by-branch, tier 1 → tier 4. Branches don't interact, so
// any traversal would work; we fix one for determinism / debugability.
export const applyMetaSkillsToTower = (tower: Tower, meta: AllMetaSkills): void => {
  const tree = META_SKILL_TREE[tower.kind];
  const tiers = meta[tower.kind];
  if (!tiers) return;
  for (const branch of BRANCH_IDS) {
    const t = clampTier(tiers[branch]);
    if (t === 0) continue;
    const tierList = tree[branch].tiers;
    for (let i = 0; i < t; i++) tierList[i].apply(tower);
  }
};

// Effective placement cost after the c-branch Surplus discount. Every
// copy of a kind costs the same — same-kind stacking is bounded by the
// flat TOWER_BUILD_LIMIT instead of an escalating price.
export const effectiveTowerCost = (kind: TowerKind, meta: AllMetaSkills): number => {
  const base = TOWER_COST[kind];
  const cTier = clampTier(meta[kind]?.c);
  const discount = cTier > 0 ? COST_DISCOUNT[kind][cTier - 1] : 0;
  const floor = Math.ceil(base * COST_FLOOR_FRACTION);
  return Math.max(floor, base - discount);
};

// Total stars allocated across the whole tree. Used by the panel header
// (X invested / Y earned) and to gate further investment.
export const spentMetaStars = (meta: AllMetaSkills): number => {
  let total = 0;
  for (const kind in meta) {
    const tiers = meta[kind as TowerKind];
    if (!tiers) continue;
    for (const branch of BRANCH_IDS) {
      total += branchSpent(clampTier(tiers[branch]));
    }
  }
  return total;
};

// Stars currently invested in one tower (sum across its three branches).
// Powers the per-tower "↺ N★" refund button in the panel.
export const spentForKind = (meta: AllMetaSkills, kind: TowerKind): number => {
  const tiers = meta[kind];
  if (!tiers) return 0;
  let s = 0;
  for (const branch of BRANCH_IDS) s += branchSpent(clampTier(tiers[branch]));
  return s;
};

// Validate and write a new tier value for one branch. Clamps to [0, MAX_TIER]
// and returns a new AllMetaSkills (immutable update so React/Zustand
// picks up the change). The store layer is the place that verifies the
// player has enough free stars before calling this — keep it pure.
export const setTier = (
  meta: AllMetaSkills,
  kind: TowerKind,
  branch: BranchId,
  tierValue: number,
): AllMetaSkills => {
  const clamped = clampTier(tierValue);
  const prev = meta[kind] ?? {};
  if (clampTier(prev[branch]) === clamped) return meta;
  const nextBranches: MetaBranchTiers = { ...prev, [branch]: clamped };
  if (clamped === 0) delete nextBranches[branch];
  return { ...meta, [kind]: nextBranches };
};

export const resetKindRanks = (meta: AllMetaSkills, kind: TowerKind): AllMetaSkills => {
  if (!meta[kind] || Object.keys(meta[kind] ?? {}).length === 0) return meta;
  const next = { ...meta };
  delete next[kind];
  return next;
};

export const resetAllRanks = (): AllMetaSkills => ({});

export const isMetaSkillsEmpty = (meta: AllMetaSkills): boolean => {
  for (const kind in meta) {
    const tiers = meta[kind as TowerKind];
    if (!tiers) continue;
    for (const b of BRANCH_IDS) if (clampTier(tiers[b]) > 0) return false;
  }
  return true;
};

// Migration: pre-branch saves stored per-node-id ranks (keys like
// "pulse.barrel"). Detect and drop those entries so the player gets all
// their stars back to allocate fresh in the new system.
export const migrateLegacyMetaSkills = (raw: unknown): AllMetaSkills => {
  if (!raw || typeof raw !== "object") return {};
  const out: AllMetaSkills = {};
  for (const [kind, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(kind in META_SKILL_TREE)) continue;
    if (!value || typeof value !== "object") continue;
    const branches: MetaBranchTiers = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "a" || k === "b" || k === "c") {
        const t = clampTier(v);
        if (t > 0) branches[k] = t;
      }
      // Legacy keys like "pulse.barrel" silently dropped.
    }
    if (Object.keys(branches).length > 0) out[kind as TowerKind] = branches;
  }
  return out;
};
