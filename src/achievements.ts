import type { FC } from "react";
import { LEVELS } from "./levels";
import enAchievements from "./locales/en/achievements.json";
import type { ProgressData } from "./progress";
import { getStars, starsForLives } from "./progress";
import type { EnemyKind, GameEvent, TowerKind, World } from "./sim/types";
import { ACHIEVEMENT_ICONS, type AchievementIconProps } from "./ui/AchievementIcons";

export type AchievementId =
  | "first_blood"
  | "extermination"
  | "apex_hunter"
  | "veteran"
  | "scholar"
  | "full_arsenal"
  | "fully_armed"
  | "architect"
  | "flawless"
  | "triple_star"
  | "full_spectrum"
  | "master_engineer"
  | "campaign"
  | "perfect_run"
  | "full_service"
  | "tree_hugger"
  | "diamond_in_the_rough"
  | "whispering_skull"
  | "mushroom_puff"
  | "torch_lit"
  | "barrel_roll"
  | "cabin_smoke"
  | "crystal_shatter"
  | "cactus_bloom"
  | "ancient_glyph"
  | "rusted_radio"
  | "satellite_ping"
  | "fairy_ring"
  | "rocket_launch"
  | "tumbleweed"
  | "rover_roam"
  | "baby_raptor"
  | "buried_para"
  | "snowman"
  | "ghost_trike"
  | "haunted_ruins";

export type AchievementSecrecy = "visible" | "hint" | "hidden";

export type AchievementDef = {
  id: AchievementId;
  name: string;
  desc: string;
  hint: string;
  secrecy?: AchievementSecrecy;
  icon: FC<AchievementIconProps>;
};

type AchievementDefRaw = Omit<AchievementDef, "icon">;

type AchTextEntry = { name: string; desc: string; hint: string };

// English achievement copy lives in the en i18n catalog
// (src/locales/en/achievements.json); the localized AchievementsPanel reads
// the same keys via react-i18next. The non-localized toast still reads these
// English Records. The two ID lists below define display order + secrecy.
const ACH_TEXT = enAchievements as Record<AchievementId, AchTextEntry>;

const VISIBLE_IDS: AchievementId[] = [
  "first_blood",
  "extermination",
  "apex_hunter",
  "veteran",
  "scholar",
  "full_arsenal",
  "fully_armed",
  "architect",
  "flawless",
  "triple_star",
  "full_spectrum",
  "master_engineer",
  "campaign",
  "perfect_run",
  "full_service",
];

const HINT_IDS: AchievementId[] = [
  "tree_hugger",
  "diamond_in_the_rough",
  "whispering_skull",
  "mushroom_puff",
  "torch_lit",
  "barrel_roll",
  "cabin_smoke",
  "crystal_shatter",
  "cactus_bloom",
  "ancient_glyph",
  "rusted_radio",
  "satellite_ping",
  "fairy_ring",
  "rocket_launch",
  "tumbleweed",
  "rover_roam",
  "baby_raptor",
  "buried_para",
  "snowman",
  "ghost_trike",
  "haunted_ruins",
];

const rawAch = (id: AchievementId, secrecy?: AchievementSecrecy): AchievementDefRaw => ({
  id,
  name: ACH_TEXT[id].name,
  desc: ACH_TEXT[id].desc,
  hint: ACH_TEXT[id].hint,
  ...(secrecy ? { secrecy } : {}),
});

const ACHIEVEMENTS_RAW: AchievementDefRaw[] = [
  ...VISIBLE_IDS.map((id) => rawAch(id)),
  ...HINT_IDS.map((id) => rawAch(id, "hint")),
];

export const ACHIEVEMENTS: AchievementDef[] = ACHIEVEMENTS_RAW.map((a) => ({
  ...a,
  icon: ACHIEVEMENT_ICONS[a.id],
}));

export const ACHIEVEMENT_BY_ID: Record<AchievementId, AchievementDef> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
) as Record<AchievementId, AchievementDef>;

export const TOTAL_ENEMY_KINDS = 7;

const ALL_TOWER_KINDS: TowerKind[] = ["pulse", "chain", "cryo", "mortar", "flame", "hive"];
const ALL_ENEMY_KINDS: EnemyKind[] = [
  "raptor",
  "swarm",
  "para",
  "allosaur",
  "stego",
  "armored",
  "titan",
];

export const isAchievementUnlocked = (p: ProgressData, id: AchievementId): boolean =>
  p.unlocked[id] !== undefined;

export const totalUnlocked = (p: ProgressData): number =>
  ACHIEVEMENTS.reduce((n, a) => n + (isAchievementUnlocked(p, a.id) ? 1 : 0), 0);

const satisfies = (id: AchievementId, p: ProgressData, w: World, ev: GameEvent | null): boolean => {
  switch (id) {
    case "first_blood":
      return p.stats.killsTotal >= 1;
    case "extermination":
      return p.stats.killsTotal >= 500;
    case "apex_hunter":
      return p.stats.killsTotal >= 2500;
    case "veteran":
      return p.stats.winsTotal >= 10;
    case "scholar": {
      let seen = 0;
      for (const k in p.encountered) if (p.encountered[k as keyof typeof p.encountered]) seen++;
      return seen >= TOTAL_ENEMY_KINDS;
    }
    case "full_arsenal": {
      if (w.towers.length < ALL_TOWER_KINDS.length) return false;
      const kinds = new Set(w.towers.map((t) => t.kind));
      return ALL_TOWER_KINDS.every((k) => kinds.has(k));
    }
    case "fully_armed":
      return w.towers.some((t) => t.upgrades.a === 3 && t.upgrades.b === 3);
    case "architect":
      return w.towers.length >= 10;
    case "flawless":
      return ev !== null && ev.type === "game-over" && ev.won && w.lives >= w.startLives;
    case "triple_star":
      // Three-star wording assumes the normal-mode 0-3 grading. Heroic /
      // iron are binary (clear = 1 star), so the achievement only fires
      // for full-lives normal clears.
      return (
        ev !== null &&
        ev.type === "game-over" &&
        ev.won &&
        w.mode === "normal" &&
        starsForLives(w.lives) === 3
      );
    case "full_spectrum":
      return (
        ALL_ENEMY_KINDS.every((k) => w.runEnemyKinds[k]) &&
        ALL_TOWER_KINDS.every((k) => w.runTowerKinds[k])
      );
    case "master_engineer": {
      const maxed: Partial<Record<TowerKind, boolean>> = {};
      for (const t of w.towers) {
        if (t.upgrades.a === 3 && t.upgrades.b === 3) maxed[t.kind] = true;
      }
      return ALL_TOWER_KINDS.every((k) => maxed[k]);
    }
    case "campaign":
      return LEVELS.every((l) => getStars(p, l.id) >= 1);
    case "perfect_run":
      return LEVELS.every((l) => getStars(p, l.id) >= 3);
    case "full_service": {
      // Need at least one non-hive tower (otherwise the trivial empty
      // case would award immediately) AND every non-hive tower must
      // have at least one hive drone currently assigned to it.
      const nonHive = w.towers.filter((t) => t.kind !== "hive");
      if (nonHive.length === 0) return false;
      const serviced = new Set<number>();
      for (const h of w.towers) {
        if (h.kind !== "hive") continue;
        for (let i = 0; i < h.droneCount; i++) {
          const id = h.droneAssignments[i];
          if (id !== null && id !== undefined) serviced.add(id);
        }
      }
      return nonHive.every((t) => serviced.has(t.id));
    }
    case "tree_hugger":
    case "diamond_in_the_rough":
    case "whispering_skull":
    case "mushroom_puff":
    case "torch_lit":
    case "barrel_roll":
    case "cabin_smoke":
    case "crystal_shatter":
    case "cactus_bloom":
    case "ancient_glyph":
    case "rusted_radio":
    case "satellite_ping":
    case "fairy_ring":
    case "rocket_launch":
    case "tumbleweed":
    case "rover_roam":
    case "baby_raptor":
    case "buried_para":
    case "snowman":
    case "ghost_trike":
    case "haunted_ruins":
      return false;
  }
};

export const checkAchievements = (
  progress: ProgressData,
  world: World,
  ev: GameEvent | null,
): { progress: ProgressData; unlocked: AchievementId[] } => {
  let p = progress;
  const unlocked: AchievementId[] = [];
  for (const def of ACHIEVEMENTS) {
    if (isAchievementUnlocked(p, def.id)) continue;
    if (satisfies(def.id, p, world, ev)) {
      p = { ...p, unlocked: { ...p.unlocked, [def.id]: Date.now() } };
      unlocked.push(def.id);
    }
  }
  return { progress: p, unlocked };
};
