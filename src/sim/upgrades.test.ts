import { describe, expect, it } from "vitest";
import type { Base, Tower, TowerKind, World } from "./types";
import {
  applyUpgrade,
  BASE_STAT_LABEL,
  BASE_UPGRADES,
  nextBaseUpgrade,
  nextUpgrade,
  previewUpgrade,
  STAT_LABEL,
  sellRefund,
  UPGRADES,
} from "./upgrades";
import {
  BASE_DAMAGE,
  BASE_FIRE_RATE,
  BASE_RANGE,
  createTower,
  TOWER_COST,
  TOWER_STATS,
} from "./world";

const TOWER_KINDS = Object.keys(TOWER_STATS) as TowerKind[];
const BRANCHES = ["a", "b"] as const;

// createTower only touches these four fields; applyUpgrade additionally
// pushes onto `events` and spends `gold`. Anything more would be mocking
// the sim rather than exercising it.
const stubWorld = (gold = 100_000): World =>
  ({
    nextEntityId: 1,
    towers: [],
    towerById: new Map(),
    runTowerKinds: {},
    events: [],
    gold,
  }) as unknown as World;

const freshTower = (kind: TowerKind): Tower => createTower(stubWorld(), kind, { x: 0, y: 0 });

const freshBase = (): Base => ({
  damage: BASE_DAMAGE,
  fireRate: BASE_FIRE_RATE,
  range: BASE_RANGE,
  cooldowns: [0],
  targetIds: [null],
  upgrades: { a: 0, b: 0 },
  totalSpent: 0,
  kills: 0,
  damageDealt: 0,
});

describe("tower upgrade tree", () => {
  it("defines two three-tier branches for every tower kind", () => {
    expect(TOWER_KINDS.length).toBeGreaterThan(0);
    for (const kind of TOWER_KINDS) {
      const tree = UPGRADES[kind];
      expect(tree, kind).toBeDefined();
      for (const branch of BRANCHES) {
        expect(tree[branch].label.trim(), `${kind}.${branch}`).not.toBe("");
        expect(tree[branch].tiers, `${kind}.${branch}`).toHaveLength(3);
      }
    }
  });

  it("labels every tier and never repeats a name within a tower", () => {
    for (const kind of TOWER_KINDS) {
      const names: string[] = [];
      for (const branch of BRANCHES) {
        for (const [i, tier] of UPGRADES[kind][branch].tiers.entries()) {
          const label = `${kind}.${branch}[${i}]`;
          expect(tier.name.trim(), label).not.toBe("");
          expect(tier.desc.trim(), label).not.toBe("");
          names.push(tier.name);
        }
      }
      // Duplicate names make the upgrade panel ambiguous and usually mean a
      // copy-paste slip that also duplicated the effect.
      expect(new Set(names).size, kind).toBe(names.length);
    }
  });

  it("prices each branch as a strictly rising ladder", () => {
    for (const kind of TOWER_KINDS) {
      for (const branch of BRANCHES) {
        const costs = UPGRADES[kind][branch].tiers.map((t) => t.cost);
        for (const cost of costs) {
          expect(Number.isInteger(cost) && cost > 0, `${kind}.${branch}`).toBe(true);
        }
        expect(costs[1], `${kind}.${branch}`).toBeGreaterThan(costs[0]);
        expect(costs[2], `${kind}.${branch}`).toBeGreaterThan(costs[1]);
      }
    }
  });

  it("keeps stats finite and non-negative through a fully upgraded tower", () => {
    for (const kind of TOWER_KINDS) {
      const world = stubWorld();
      const tower = createTower(world, kind, { x: 0, y: 0 });
      for (const branch of BRANCHES) {
        for (let tier = 0; tier < 3; tier++) {
          expect(applyUpgrade(world, tower, branch), `${kind}.${branch}[${tier}]`).toBe(true);
        }
        // Tier 3 is the cap — the panel relies on null to hide the button.
        expect(nextUpgrade(tower, branch), `${kind}.${branch}`).toBeNull();
        expect(applyUpgrade(world, tower, branch), `${kind}.${branch}`).toBe(false);
      }
      expect(tower.upgrades).toEqual({ a: 3, b: 3 });
      for (const key of Object.keys(STAT_LABEL) as (keyof typeof STAT_LABEL)[]) {
        expect(Number.isFinite(tower[key]), `${kind}.${key}`).toBe(true);
        expect(tower[key], `${kind}.${key}`).toBeGreaterThanOrEqual(0);
      }
      // Damage may legitimately stay 0 for cryo (pure slow), but it must
      // never go backwards from its base value.
      expect(tower.damage, kind).toBeGreaterThanOrEqual(TOWER_STATS[kind].damage);
      expect(tower.totalSpent, kind).toBeGreaterThan(TOWER_COST[kind]);
    }
  });

  it("reports a non-empty stat delta for every upgrade preview", () => {
    for (const kind of TOWER_KINDS) {
      for (const branch of BRANCHES) {
        const tower = freshTower(kind);
        for (const tier of UPGRADES[kind][branch].tiers) {
          const deltas = previewUpgrade(tower, tier);
          for (const d of deltas) {
            expect(Number.isFinite(d.from) && Number.isFinite(d.to), `${kind}.${branch}`).toBe(
              true,
            );
          }
          tier.apply(tower);
        }
      }
    }
  });

  it("refunds a fraction of what was spent, never more", () => {
    const world = stubWorld();
    const tower = createTower(world, "pulse", { x: 0, y: 0 });
    expect(sellRefund(tower)).toBe(Math.floor(TOWER_COST.pulse * 0.65));
    applyUpgrade(world, tower, "a");
    expect(sellRefund(tower)).toBeLessThan(tower.totalSpent);
  });
});

describe("HQ base upgrade tree", () => {
  it("defines two three-tier branches with rising costs", () => {
    for (const branch of BRANCHES) {
      expect(BASE_UPGRADES[branch].tiers).toHaveLength(3);
      const costs = BASE_UPGRADES[branch].tiers.map((t) => t.cost);
      expect(costs[1]).toBeGreaterThan(costs[0]);
      expect(costs[2]).toBeGreaterThan(costs[1]);
      for (const tier of BASE_UPGRADES[branch].tiers) {
        expect(tier.name.trim()).not.toBe("");
        expect(tier.desc.trim()).not.toBe("");
      }
    }
  });

  it("keeps the HQ laser finite and monotonically stronger", () => {
    const base = freshBase();
    for (const branch of BRANCHES) {
      for (const tier of BASE_UPGRADES[branch].tiers) tier.apply(base);
    }
    for (const key of Object.keys(BASE_STAT_LABEL) as (keyof typeof BASE_STAT_LABEL)[]) {
      expect(Number.isFinite(base[key]), key).toBe(true);
    }
    expect(base.damage).toBeGreaterThan(BASE_DAMAGE);
    expect(base.fireRate).toBeGreaterThan(BASE_FIRE_RATE);
    expect(base.range).toBeGreaterThanOrEqual(BASE_RANGE);
  });

  it("stops offering upgrades past tier 3", () => {
    const base = freshBase();
    expect(nextBaseUpgrade(base, "a")).toBe(BASE_UPGRADES.a.tiers[0]);
    base.upgrades.a = 3;
    expect(nextBaseUpgrade(base, "a")).toBeNull();
  });
});
