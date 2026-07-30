import { describe, expect, it } from "vitest";
import {
  type AllMetaSkills,
  applyMetaSkillsToTower,
  BRANCH_IDS,
  branchSpent,
  effectiveTowerCost,
  getTier,
  isMetaSkillsEmpty,
  MAX_TIER,
  META_SKILL_TREE,
  migrateLegacyMetaSkills,
  nextTierCost,
  resetKindRanks,
  setTier,
  spentForKind,
  spentMetaStars,
  TIER_COST,
} from "./metaSkills";
import type { TowerKind, World } from "./types";
import { createTower, TOWER_COST, TOWER_STATS } from "./world";

const TOWER_KINDS = Object.keys(TOWER_STATS) as TowerKind[];
const MAX_PER_BRANCH = TIER_COST.reduce((a, b) => a + b, 0);

const stubWorld = (): World =>
  ({
    nextEntityId: 1,
    towers: [],
    towerById: new Map(),
    runTowerKinds: {},
    events: [],
    gold: 0,
  }) as unknown as World;

const maxedMeta = (): AllMetaSkills =>
  Object.fromEntries(
    TOWER_KINDS.map((kind) => [kind, { a: MAX_TIER, b: MAX_TIER, c: MAX_TIER }]),
  ) as AllMetaSkills;

describe("meta-skill tree shape", () => {
  it("gives every tower kind three branches of exactly four tiers", () => {
    for (const kind of TOWER_KINDS) {
      const tree = META_SKILL_TREE[kind];
      expect(tree, kind).toBeDefined();
      expect(Object.keys(tree).sort()).toEqual([...BRANCH_IDS].sort());
      for (const branch of BRANCH_IDS) {
        expect(tree[branch].tiers, `${kind}.${branch}`).toHaveLength(MAX_TIER);
        expect(tree[branch].label.trim(), `${kind}.${branch}`).not.toBe("");
        expect(tree[branch].blurb.trim(), `${kind}.${branch}`).not.toBe("");
      }
    }
  });

  it("labels every tier uniquely within a tower and prices it cumulatively", () => {
    for (const kind of TOWER_KINDS) {
      const names: string[] = [];
      for (const branch of BRANCH_IDS) {
        let cumulative = 0;
        for (const [i, tier] of META_SKILL_TREE[kind][branch].tiers.entries()) {
          const label = `${kind}.${branch}[${i}]`;
          expect(tier.name.trim(), label).not.toBe("");
          expect(tier.desc.trim(), label).not.toBe("");
          names.push(tier.name);
          cumulative += TIER_COST[i];
          // costThis is the panel's "N★ to reach here" badge — it must stay
          // in sync with TIER_COST or the star budget UI lies.
          expect(tier.costThis, label).toBe(cumulative);
        }
      }
      expect(new Set(names).size, kind).toBe(names.length);
    }
  });

  it("keeps a fully-invested tower's stats finite and non-negative", () => {
    const meta = maxedMeta();
    for (const kind of TOWER_KINDS) {
      const tower = createTower(stubWorld(), kind, { x: 0, y: 0 });
      applyMetaSkillsToTower(tower, meta);
      for (const key of ["damage", "fireRate", "range", "splashRadius"] as const) {
        expect(Number.isFinite(tower[key]), `${kind}.${key}`).toBe(true);
        expect(tower[key], `${kind}.${key}`).toBeGreaterThanOrEqual(0);
      }
      expect(tower.critChance, kind).toBeGreaterThanOrEqual(0);
      expect(tower.damage, kind).toBeGreaterThanOrEqual(TOWER_STATS[kind].damage);
    }
  });
});

describe("star accounting", () => {
  it("charges the documented ladder per branch", () => {
    expect(branchSpent(0)).toBe(0);
    let running = 0;
    for (let tier = 0; tier < MAX_TIER; tier++) {
      expect(nextTierCost(tier)).toBe(TIER_COST[tier]);
      running += TIER_COST[tier];
      expect(branchSpent(tier + 1)).toBe(running);
    }
    expect(nextTierCost(MAX_TIER)).toBe(0);
  });

  it("sums a fully-maxed tree to the per-branch ladder times every branch", () => {
    const meta = maxedMeta();
    expect(spentMetaStars(meta)).toBe(MAX_PER_BRANCH * BRANCH_IDS.length * TOWER_KINDS.length);
    for (const kind of TOWER_KINDS) {
      expect(spentForKind(meta, kind), kind).toBe(MAX_PER_BRANCH * BRANCH_IDS.length);
    }
    expect(isMetaSkillsEmpty(meta)).toBe(false);
    expect(isMetaSkillsEmpty({})).toBe(true);
  });

  it("clamps setTier and prunes zeroed branches", () => {
    let meta: AllMetaSkills = {};
    meta = setTier(meta, "pulse", "a", 99);
    expect(getTier(meta, "pulse", "a")).toBe(MAX_TIER);
    meta = setTier(meta, "pulse", "b", -5);
    expect(getTier(meta, "pulse", "b")).toBe(0);
    // A no-op write returns the same reference so React/Zustand can bail.
    expect(setTier(meta, "pulse", "a", MAX_TIER)).toBe(meta);
    meta = setTier(meta, "pulse", "a", 0);
    expect(spentMetaStars(meta)).toBe(0);
    expect(resetKindRanks(setTier({}, "cryo", "c", 2), "cryo")).toEqual({});
  });

  it("discounts placement cost without dropping below the floor", () => {
    for (const kind of TOWER_KINDS) {
      const base = TOWER_COST[kind];
      expect(effectiveTowerCost(kind, {}), kind).toBe(base);
      let previous = base;
      for (let tier = 1; tier <= MAX_TIER; tier++) {
        const cost = effectiveTowerCost(kind, { [kind]: { c: tier } });
        expect(cost, `${kind} c${tier}`).toBeLessThanOrEqual(previous);
        // Floor is 70% of base so reinforcing beats spamming new towers.
        expect(cost, `${kind} c${tier}`).toBeGreaterThanOrEqual(Math.ceil(base * 0.7));
        previous = cost;
      }
    }
  });
});

describe("migrateLegacyMetaSkills", () => {
  it("keeps branch ranks and drops pre-branch node ids", () => {
    expect(
      migrateLegacyMetaSkills({
        pulse: { "pulse.barrel": 3, a: 2, c: 1 },
        mortar: { "mortar.shell": 2 },
      }),
    ).toEqual({ pulse: { a: 2, c: 1 } });
  });

  it("drops unknown tower kinds, junk values and zero ranks", () => {
    expect(migrateLegacyMetaSkills(null)).toEqual({});
    expect(migrateLegacyMetaSkills("nonsense")).toEqual({});
    expect(migrateLegacyMetaSkills({ notATower: { a: 3 } })).toEqual({});
    expect(migrateLegacyMetaSkills({ chain: { a: 0, b: "x" } })).toEqual({});
    expect(migrateLegacyMetaSkills({ chain: { a: 99 } })).toEqual({ chain: { a: MAX_TIER } });
  });

  it("round-trips a legitimate save unchanged", () => {
    const saved: AllMetaSkills = { pulse: { a: 1, b: 4 }, hive: { c: 2 } };
    expect(migrateLegacyMetaSkills(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });
});
