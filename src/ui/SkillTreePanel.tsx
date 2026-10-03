import { useTranslation } from "react-i18next";
import { totalStars } from "../progress";
import {
  BRANCH_IDS,
  type BranchId,
  branchSpent,
  effectiveTowerCost,
  getTier,
  MAX_TIER,
  META_SKILL_TREE,
  type MetaBranch,
  nextTierCost,
  spentForKind,
  spentMetaStars,
  TIER_COST,
} from "../sim/metaSkills";
import type { TowerKind } from "../sim/types";
import { DAMAGE_TYPE_COLOR, TOWER_DAMAGE_TYPE, TOWER_LABEL } from "../sim/world";
import { useGame } from "../store";
import { TutorialPanelPrompt } from "../tutorial/TutorialUI";
import { DamageIcon } from "./DamageIcon";
import { MenuOverlay } from "./MenuOverlay";
import { TowerPreview } from "./TowerPreview";

const KIND_ORDER: TowerKind[] = ["pulse", "chain", "flame", "hive", "mortar", "cryo"];

// A vertical ladder of four tier cards for one branch. Earlier tiers
// unlock to the right of "currentTier"; clicking an unlocked tile
// refunds back to that step (so the topmost click un-invests one), and
// clicking the next-up tile invests forward.
const BranchLadder = ({
  kind,
  branchId,
  branch,
  currentTier,
  available,
}: {
  kind: TowerKind;
  branchId: BranchId;
  branch: MetaBranch;
  currentTier: number;
  available: number;
}) => {
  const setTier = useGame((s) => s.setMetaSkillTier);
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="px-1 mb-0.5">
        <div className="text-[12px] font-bold text-fg uppercase tracking-wide leading-tight">
          {t(`skills:branch.${kind}.${branchId}.label`)}
        </div>
        <div className="text-[10px] text-fg-muted leading-snug">
          {t(`skills:branch.${kind}.${branchId}.blurb`)}
        </div>
      </div>
      {branch.tiers.map((_tier, idx) => {
        const tierNum = idx + 1;
        const cost = TIER_COST[idx];
        const unlocked = tierNum <= currentTier;
        const nextUp = tierNum === currentTier + 1;
        const affordable = nextUp && cost <= available;

        // Click semantics:
        // - unlocked + topmost: refund to (tierNum - 1), giving back `cost`
        // - next-up: invest if affordable
        // - locked deeper or refund mid-chain: disabled
        const isTopmost = unlocked && tierNum === currentTier;
        const onClick = () => {
          if (isTopmost) {
            setTier(kind, branchId, tierNum - 1);
          } else if (nextUp && affordable) {
            setTier(kind, branchId, tierNum);
          }
        };
        const disabled = !isTopmost && !(nextUp && affordable);

        const stateClass = unlocked
          ? "border-gold/70 bg-gold/15"
          : nextUp && affordable
            ? "border-cyan/50 bg-surface-2 hover:border-cyan hover:bg-cyan/10"
            : "border-border-faint bg-surface-2 opacity-50";

        const titleText = unlocked
          ? isTopmost
            ? t("skillTree.tierRefund", { tier: tierNum, cost })
            : t("skillTree.tierUnlocked", { tier: tierNum })
          : nextUp
            ? affordable
              ? t("skillTree.tierUnlock", { tier: tierNum, cost })
              : t("skillTree.tierNeed", { cost })
            : t("skillTree.tierLocked", { tier: tierNum - 1 });

        return (
          <button
            key={`${branchId}-t${tierNum}`}
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={titleText}
            aria-label={titleText}
            className={`text-left rounded-md border-2 px-2 py-1.5 transition-colors ${stateClass} ${
              disabled ? "cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            <div className="flex items-baseline gap-1.5">
              <span
                className={`text-[10px] font-bold tabular-nums ${unlocked ? "text-gold" : "text-fg-muted"}`}
              >
                T{tierNum}
              </span>
              <span
                className={`text-[12px] font-bold leading-tight truncate ${unlocked ? "text-fg" : "text-fg-secondary"}`}
              >
                {t(`skills:branch.${kind}.${branchId}.tier.${idx}.name`)}
              </span>
              <span
                className={`ml-auto text-[10px] tabular-nums shrink-0 ${unlocked ? "text-mint" : "text-gold/80"}`}
              >
                {unlocked ? "✓" : `${cost}★`}
              </span>
            </div>
            <div
              className={`text-[10.5px] leading-snug mt-0.5 ${unlocked ? "text-mint" : "text-fg-muted"}`}
            >
              {t(`skills:branch.${kind}.${branchId}.tier.${idx}.desc`)}
            </div>
          </button>
        );
      })}
    </div>
  );
};

const TowerCard = ({ kind, available }: { kind: TowerKind; available: number }) => {
  const tree = META_SKILL_TREE[kind];
  const metaSkills = useGame((s) => s.progress.metaSkills);
  const cost = effectiveTowerCost(kind, metaSkills);
  const dmgType = TOWER_DAMAGE_TYPE[kind];
  const resetKind = useGame((s) => s.resetMetaSkillsForKind);
  const invested = spentForKind(metaSkills, kind);
  const { t } = useTranslation();
  const dmgLabel = t(`damageTypes.${dmgType}`);

  return (
    <div className="bg-surface-1 border border-border rounded-lg p-3 flex flex-col">
      <div className="flex items-center gap-3 pb-2.5 border-b border-border-faint">
        <div className="w-14 h-14 shrink-0">
          <TowerPreview kind={kind} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-fg leading-tight">{TOWER_LABEL[kind]}</div>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="dmg-tag inline-flex items-center gap-1 text-[10px]"
              style={{ color: DAMAGE_TYPE_COLOR[dmgType], borderColor: DAMAGE_TYPE_COLOR[dmgType] }}
            >
              <DamageIcon type={dmgType} size={10} title={dmgLabel} />
              {dmgLabel}
            </span>
            <span className="text-[11px] text-gold tabular-nums">{cost}g</span>
          </div>
        </div>
        {invested > 0 && (
          <button
            type="button"
            className="text-[10px] text-fg-muted hover:text-red transition-colors px-2 py-1 rounded border border-border-faint hover:border-red"
            onClick={() => resetKind(kind)}
            title={t("skillTree.refundKind", { count: invested })}
          >
            ↺ {invested}★
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-2.5">
        {BRANCH_IDS.map((branchId) => {
          const branch = tree[branchId];
          const tier = getTier(metaSkills, kind, branchId);
          return (
            <BranchLadder
              key={branchId}
              kind={kind}
              branchId={branchId}
              branch={branch}
              currentTier={tier}
              available={available}
            />
          );
        })}
      </div>
      <div className="mt-2 pt-2 border-t border-border-faint flex items-center gap-3 text-[10px] text-fg-muted">
        {BRANCH_IDS.map((branchId) => {
          const tier = getTier(metaSkills, kind, branchId);
          const spent = branchSpent(tier);
          const next = nextTierCost(tier);
          return (
            <span key={`${branchId}-status`} className="flex-1 truncate">
              <span className="text-fg-secondary">
                {t(`skills:branch.${kind}.${branchId}.label`)}:
              </span>{" "}
              {tier > 0 ? (
                <span className="text-gold tabular-nums">
                  T{tier}/{MAX_TIER}
                </span>
              ) : (
                <span className="text-fg-faint">—</span>
              )}{" "}
              <span className="text-fg-faint tabular-nums">
                ({spent}★{next > 0 ? ` · +${next}` : ""})
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
};

export const SkillTreePanel = () => {
  const progress = useGame((s) => s.progress);
  const setOpen = useGame((s) => s.setSkillTreeOpen);
  const resetAll = useGame((s) => s.resetAllMetaSkills);
  const { t } = useTranslation();
  const earned = totalStars(progress);
  const spent = spentMetaStars(progress.metaSkills);
  const available = Math.max(0, earned - spent);

  return (
    <MenuOverlay
      title={t("skillTree.title")}
      subtitle={t("skillTree.subtitle", { available, spent, earned })}
      onClose={() => setOpen(false)}
      cardClassName="!w-[min(1280px,calc(100vw-48px))] !max-w-none"
    >
      <TutorialPanelPrompt />
      <div className="skill-tree-panel w-full">
        <div className="flex items-center justify-between gap-3 px-1 mb-3">
          <p className="text-[11px] text-fg-muted leading-snug flex-1 min-w-0">
            {t("skillTree.intro")}
          </p>
          {spent > 0 && (
            <button
              type="button"
              className="btn btn-ghost text-xs py-1.5 px-3 shrink-0 whitespace-nowrap"
              onClick={resetAll}
              title={t("skillTree.refundAllTitle")}
            >
              {t("skillTree.refundAll")}
            </button>
          )}
        </div>
        <div className="skill-tree-grid grid grid-cols-1 xl:grid-cols-2 gap-3">
          {KIND_ORDER.map((kind) => (
            <TowerCard key={kind} kind={kind} available={available} />
          ))}
        </div>
      </div>
    </MenuOverlay>
  );
};
