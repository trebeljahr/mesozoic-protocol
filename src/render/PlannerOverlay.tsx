// Debug-only overlay that renders the suggested "stupid-optimal" tower
// plan emitted by scripts/wave-optimal-path.ts (--emit-traces). The
// overlay reads a per-level JSON trace from /balancing-traces/ and
// projects each planned tower as a ghost mesh with an upgrade-tier
// label. Gated on `isDebug` so the trace fetch (and Drei Text mounts)
// dead-code out of production builds.
//
// Use case: load Threshold of Eschaton in dev with ?debug=true, follow
// the ghosts literally, validate whether the simulator's plan is
// actually buildable in the live sim. If the ghost overlay clears the
// level the model is calibrated; if it dies, the simulator is lying.

import { Text } from "@react-three/drei";
import { useEffect, useState } from "react";
import { showDebugOverlays } from "../debug";
import {
  fetchPlannerTrace,
  type PlannerPlannedTower,
  type PlannerTrace,
} from "../debugPlannerTrace";
import type { Tower } from "../sim/types";
import { UPGRADES } from "../sim/upgrades";
import { TOWER_FOOTPRINT, TOWER_LABEL } from "../sim/world";
import { useGame } from "../store";
import { GhostTower } from "./GhostTower";

type Vec2 = { x: number; y: number };
type RequiredTiers = { a: number; b: number };
type TowerMatch = { tower: Tower; complete: boolean; rightKind: boolean; missing: string[] };

const MATCH_RADIUS = TOWER_FOOTPRINT + 0.1;
const MATCH_RADIUS_SQ = MATCH_RADIUS * MATCH_RADIUS;

const distSq = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

const requiredTiersAtWave = (tower: PlannerPlannedTower, wave: number): RequiredTiers => {
  let a = 0;
  let b = 0;
  for (const upgrade of tower.upgrades) {
    if (upgrade.wave > wave) continue;
    if (upgrade.branch === "a") a = Math.max(a, upgrade.tier);
    else b = Math.max(b, upgrade.tier);
  }
  return { a, b };
};

const describeTier = (
  kind: PlannerPlannedTower["kind"],
  branch: "a" | "b",
  tier: number,
): string => {
  if (tier <= 0) return "base";
  const branchDef = UPGRADES[kind][branch];
  const upgradeName = branchDef.tiers[tier - 1]?.name;
  return upgradeName ? `${branchDef.label} T${tier} ${upgradeName}` : `${branchDef.label} T${tier}`;
};

const describeTiers = (kind: PlannerPlannedTower["kind"], tiers: RequiredTiers): string => {
  const parts = [
    tiers.a > 0 ? describeTier(kind, "a", tiers.a) : "",
    tiers.b > 0 ? describeTier(kind, "b", tiers.b) : "",
  ].filter(Boolean);
  return parts.join(" + ") || "base tower";
};

const missingUpgrades = (
  tower: PlannerPlannedTower,
  placed: Tower,
  required: RequiredTiers,
): string[] => {
  const missing: string[] = [];
  if (placed.upgrades.a < required.a) missing.push(describeTier(tower.kind, "a", required.a));
  if (placed.upgrades.b < required.b) missing.push(describeTier(tower.kind, "b", required.b));
  return missing;
};

const matchPlacedTower = (
  plan: PlannerPlannedTower,
  towers: Tower[],
  usedTowerIds: Set<number>,
  required: RequiredTiers,
): TowerMatch | null => {
  let best: Tower | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const tower of towers) {
    if (usedTowerIds.has(tower.id)) continue;
    const d = distSq(tower.pos, plan.anchor);
    if (d > MATCH_RADIUS_SQ || d >= bestD) continue;
    best = tower;
    bestD = d;
  }
  if (!best) return null;
  usedTowerIds.add(best.id);
  const rightKind = best.kind === plan.kind;
  const missing = rightKind ? missingUpgrades(plan, best, required) : [];
  return { tower: best, rightKind, missing, complete: rightKind && missing.length === 0 };
};

const formatPlanLabel = (
  plan: PlannerPlannedTower,
  wave: number,
  required: RequiredTiers,
  match: TowerMatch | null,
): { text: string; color: string; pos: Vec2 } | null => {
  if (match?.complete) return null;

  const final = `Final A${plan.finalTierA}/B${plan.finalTierB}`;
  const pos = match?.tower.pos ?? plan.anchor;

  if (match && !match.rightKind) {
    return {
      text: `${TOWER_LABEL[plan.kind]}\nSlot has ${TOWER_LABEL[match.tower.kind]}\nNeed W${wave}: ${describeTiers(plan.kind, required)}`,
      color: "#ff7a8c",
      pos,
    };
  }
  if (match && match.missing.length > 0) {
    return {
      text: `${TOWER_LABEL[plan.kind]} slot OK\nAdd: ${match.missing.join(" + ")}\nNeed W${wave}: ${describeTiers(plan.kind, required)}`,
      color: "#ffd66a",
      pos,
    };
  }
  return {
    text: `${TOWER_LABEL[plan.kind]}\nBuild W${plan.builtAtWave} - W${wave}: ${describeTiers(plan.kind, required)}\n${final}: ${describeTiers(plan.kind, { a: plan.finalTierA, b: plan.finalTierB })}`,
    color: "#ffd66a",
    pos,
  };
};

export const PlannerOverlay = () => {
  if (!showDebugOverlays) return null;
  return <PlannerOverlayInner />;
};

const PlannerOverlayInner = () => {
  const levelId = useGame((s) => s.world.levelId);
  const difficulty = useGame((s) => s.progress.difficulty);
  const status = useGame((s) => s.world.status);
  const wave = useGame((s) => s.ui.wave);
  const totalWaves = useGame((s) => s.ui.totalWaves);
  const waveActive = useGame((s) => s.ui.waveActive);
  const towerVersion = useGame((s) => s.towerVersion);
  const [trace, setTrace] = useState<PlannerTrace | null>(null);

  useEffect(() => {
    if (status === "won" || status === "lost") return;
    let cancelled = false;
    setTrace(null);
    fetchPlannerTrace(levelId, difficulty)
      .then((t) => {
        if (!cancelled) setTrace(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [levelId, difficulty, status]);

  if (!trace) return null;

  const planWave = waveActive ? wave : Math.min(totalWaves, wave + 1);
  const towers = useGame.getState().world.towers;
  const usedTowerIds = new Set<number>();
  void towerVersion;

  return (
    <>
      {trace.plannedTowers
        .filter((t) => t.builtAtWave <= planWave)
        .map((t) => {
          const required = requiredTiersAtWave(t, planWave);
          const match = matchPlacedTower(t, towers, usedTowerIds, required);
          const label = formatPlanLabel(t, planWave, required, match);
          if (!label) return null;
          return (
            <group key={t.id}>
              {!match && <GhostTower kind={t.kind} pos={t.anchor} ok={true} />}
              <Text
                position={[label.pos.x, 2.75, -label.pos.y]}
                fontSize={0.42}
                lineHeight={1.05}
                color={label.color}
                outlineColor="#000"
                outlineWidth={0.05}
                anchorX="center"
                anchorY="middle"
                maxWidth={9}
              >
                {label.text}
              </Text>
            </group>
          );
        })}
    </>
  );
};
