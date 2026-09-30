import { type FC, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { isDebug } from "../debug";
import { DEMO_TEASER_ROBOT, DEMO_TEASER_ROBOT_BOLTS, IS_DEMO, STEAM_STORE_URL } from "../demo";
import { robotSkillBoltDelta } from "../sim/robotBolts";
import {
  levelForXp,
  ROBOT_MAX_LEVEL,
  ROBOT_POINTS_PER_LEVEL,
  ROBOT_SKILL_MAX_RANK,
  ROBOT_SKILL_TREE,
  ROBOT_TREE_TOTAL_POINTS,
  type RobotSkillId,
  type RobotSkillNode,
  robotSkillPointsAvailable,
  xpProgressInLevel,
} from "../sim/robotSkills";
import { ROBOT_SPECS, type RobotVariantSpec, robotAbilityDamageType } from "../sim/robotVariants";
import type { RobotVariant } from "../sim/types";
import { DAMAGE_TYPE_COLOR } from "../sim/world";
import { useGame } from "../store";
import { DamageIcon } from "./DamageIcon";
import {
  IconBolt,
  IconBoot,
  IconCore,
  IconCrosshair,
  IconShield,
  type MenuIconProps,
} from "./MenuIcons";
import { MenuOverlay } from "./MenuOverlay";
import { RobotDiorama } from "./RobotDiorama";
import { RobotPreview } from "./RobotPreview";
import { type AbilitySlot, formatAbilityStats } from "./robotAbilityStats";

const ROSTER: RobotVariant[] = ["leela", "george", "mike", "stan"];

// Demo roster: Leela is playable; George shows up as a locked full-game
// teaser once the player has banked enough bolts to have bought him. Mike and
// Stan stay out of the demo entirely. Full build always shows the whole ROSTER.
const demoRoster = (bolts: number): RobotVariant[] =>
  bolts >= DEMO_TEASER_ROBOT_BOLTS ? ["leela", DEMO_TEASER_ROBOT] : ["leela"];

const SKILL_ICONS: Record<RobotSkillId, FC<MenuIconProps>> = {
  vitality: IconShield,
  firepower: IconCrosshair,
  mobility: IconBoot,
  ultimate: IconCore,
};

const BoltPrice = ({ amount, className = "" }: { amount: number; className?: string }) => (
  <span className={`robot-bolt-price ${className}`}>
    <IconBolt size={12} className="shrink-0" />
    {isDebug ? "FREE" : amount}
  </span>
);

const RankPips = ({
  rank,
  available,
  availableBolts,
  onClick,
}: {
  rank: number;
  available: number;
  availableBolts: number;
  onClick: (target: number) => void;
}) => {
  const { t } = useTranslation();
  return (
    <div className="robot-skill-pips">
      {Array.from({ length: ROBOT_SKILL_MAX_RANK }).map((_, i) => {
        const tier = i + 1;
        const filled = tier <= rank;
        const target = filled && tier === rank ? rank - 1 : tier;
        const wouldSpend = Math.max(0, tier - rank);
        const boltCost = robotSkillBoltDelta(rank, tier);
        const hasPoints = wouldSpend <= available;
        const hasBolts = isDebug || boltCost <= availableBolts;
        const affordable = hasPoints && hasBolts;
        const disabled = !filled && !affordable;
        const needBolts = Math.max(0, boltCost - availableBolts);
        const priceLabel = isDebug
          ? t("robotShop.free")
          : t("robotShop.bolts", { count: boltCost });
        const label = filled
          ? t("robotShop.rankRefund", { tier })
          : affordable
            ? t("robotShop.upgradeToRank", { tier, price: priceLabel })
            : !hasPoints
              ? t("robotShop.needSkillPoints", { count: wouldSpend })
              : t("robotShop.needMoreBolts", { count: needBolts });
        return (
          <button
            key={`pip-${tier}`}
            type="button"
            className={`robot-skill-pip ${filled ? "filled" : affordable ? "affordable" : "locked"}`}
            onClick={() => !disabled && onClick(target)}
            disabled={disabled}
            aria-label={label}
            title={label}
          />
        );
      })}
    </div>
  );
};

const SkillRow = ({
  variant,
  node,
  rank,
  available,
  availableBolts,
}: {
  variant: RobotVariant;
  node: RobotSkillNode;
  rank: number;
  available: number;
  availableBolts: number;
}) => {
  const { t } = useTranslation();
  const setRank = useGame((s) => s.setRobotSkillRank);
  const Icon = SKILL_ICONS[node.id];
  const nextDesc =
    rank < ROBOT_SKILL_MAX_RANK ? t(`robots:skills.${node.id}.rankDesc.${rank}`) : null;
  const currentDesc = rank > 0 ? t(`robots:skills.${node.id}.rankDesc.${rank - 1}`) : null;
  const nextCost = nextDesc ? robotSkillBoltDelta(rank, rank + 1) : 0;
  const canAffordNext = isDebug || availableBolts >= nextCost;
  return (
    <div className={`robot-skill-card ${rank > 0 ? "invested" : ""}`}>
      <div className="robot-skill-icon">
        <Icon size={22} />
      </div>
      <div className="robot-skill-body">
        <div className="robot-skill-head">
          <span className="robot-skill-name">{t(`robots:skills.${node.id}.name`)}</span>
          <RankPips
            rank={rank}
            available={available}
            availableBolts={availableBolts}
            onClick={(target) => setRank(variant, node.id, target)}
          />
        </div>
        <div className="robot-skill-desc">
          {currentDesc ? (
            <span className="robot-skill-current">{currentDesc}</span>
          ) : (
            <span className="robot-skill-current dim">{t(`robots:skills.${node.id}.blurb`)}</span>
          )}
          {nextDesc && (
            <>
              <span className="robot-skill-arrow">→</span>
              <span className="robot-skill-next">{nextDesc}</span>
              <BoltPrice
                amount={nextCost}
                className={`robot-skill-cost ${canAffordNext ? "" : "locked"}`}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const RosterCard = ({
  variant,
  activeRobot,
  unlocked,
  onSelect,
}: {
  variant: RobotVariant;
  activeRobot: RobotVariant;
  unlocked: boolean;
  onSelect: (v: RobotVariant) => void;
}) => {
  const { t } = useTranslation();
  const spec = ROBOT_SPECS[variant];
  const progress = useGame((s) => s.progress);
  const xp = progress.robotXp[variant] ?? 0;
  const level = levelForXp(xp);
  const active = activeRobot === variant;
  return (
    <button
      type="button"
      className={`robot-roster-card ${active ? "active" : ""} ${unlocked ? "" : "locked"}`}
      data-variant={variant}
      onClick={() => onSelect(variant)}
      aria-label={t("robotShop.viewRobot", { name: spec.label })}
    >
      <div className="robot-roster-portrait">
        <RobotPreview variant={variant} />
        {active && <span className="robot-roster-active-tag">{t("robotShop.active")}</span>}
        {!unlocked &&
          (IS_DEMO ? (
            <span className="robot-roster-lock">
              <span className="robot-roster-lock-label">{t("demo.teaserTag")}</span>
            </span>
          ) : (
            <span className="robot-roster-lock">
              <BoltPrice amount={spec.unlockBolts} className="robot-roster-lock-cost" />
              <span className="robot-roster-lock-label">{t("robotShop.locked")}</span>
            </span>
          ))}
      </div>
      <div className="robot-roster-meta">
        <div className="robot-roster-name">{spec.label}</div>
        <div className="robot-roster-callsign">{spec.callsign}</div>
        <div className="robot-roster-row">
          <span
            className="dmg-tag inline-flex items-center gap-1 text-[10px]"
            style={{
              color: DAMAGE_TYPE_COLOR[spec.damageType],
              borderColor: DAMAGE_TYPE_COLOR[spec.damageType],
            }}
          >
            {t(`damageTypes.${spec.damageType}`)}
          </span>
          {unlocked && (
            <span className="robot-roster-level">
              {t("robotShop.levelShort", { level })}
              <span className="robot-roster-level-max">/{ROBOT_MAX_LEVEL}</span>
            </span>
          )}
        </div>
      </div>
    </button>
  );
};

const formatAutoAttack = (
  spec: RobotVariantSpec,
  t: ReturnType<typeof useTranslation>["t"],
): string[] => {
  const lines = [
    t("robotShop.autoAttackLine", {
      damage: spec.damage,
      rate: spec.fireRate.toFixed(1),
      range: spec.range.toFixed(1),
    }),
  ];
  if (spec.attackSplashRadius > 0) {
    lines.push(t("robotShop.splashPerShot", { radius: spec.attackSplashRadius.toFixed(1) }));
  } else if (spec.attackTracer) {
    lines.push(t("robotShop.hitscanTracer"));
  } else {
    lines.push(t("robotShop.singleTarget"));
  }
  if (spec.attackChain) {
    lines.push(
      t("robotShop.chainsTo", {
        hops: spec.attackChain.hops,
        bonus: spec.attackChain.damagePerHop,
      }),
    );
  }
  return lines;
};

const AttackDetail = ({
  id,
  expanded,
  blurb,
  stats,
}: {
  id: string;
  expanded: boolean;
  blurb: string;
  stats: string[];
}) => (
  <div id={id} className="robot-ability-detail-wrap" aria-hidden={!expanded}>
    <div className="robot-ability-detail">
      <div className="robot-ability-detail-inner">
        <p className="robot-ability-blurb">{blurb}</p>
        <ul className="robot-ability-stats">
          {stats.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  </div>
);

const AbilityCard = ({
  spec,
  slot,
  expanded,
  onToggle,
}: {
  spec: RobotVariantSpec;
  slot: AbilitySlot;
  expanded: boolean;
  onToggle: () => void;
}) => {
  const { t } = useTranslation();
  const label = t(`robots:variants.${spec.variant}.abilityLabel.${slot}`);
  const glyph = spec.abilityGlyphs[slot];
  const blurb = t(`robots:variants.${spec.variant}.abilityBlurb.${slot + 1}`);
  const damageType = robotAbilityDamageType(spec, slot);
  const detailId = useId();
  return (
    <div className={`robot-ability-card ${expanded ? "expanded" : ""}`}>
      <button
        type="button"
        className="robot-ability-summary"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={detailId}
      >
        <span className="robot-ability-glyph" aria-hidden>
          {glyph}
        </span>
        <span className="robot-ability-name">{label}</span>
        <span
          className="robot-ability-type dmg-tag"
          style={{
            color: DAMAGE_TYPE_COLOR[damageType],
            borderColor: DAMAGE_TYPE_COLOR[damageType],
          }}
        >
          <DamageIcon type={damageType} size={10} title={t(`damageTypes.${damageType}`)} />
          {t(`damageTypes.${damageType}`)}
        </span>
        <span className="robot-ability-toggle" aria-hidden>
          {expanded ? "−" : "+"}
        </span>
      </button>
      <AttackDetail
        id={detailId}
        expanded={expanded}
        blurb={blurb}
        stats={formatAbilityStats(spec, slot, t)}
      />
    </div>
  );
};

const AutoAttackCard = ({
  spec,
  expanded,
  onToggle,
}: {
  spec: RobotVariantSpec;
  expanded: boolean;
  onToggle: () => void;
}) => {
  const { t } = useTranslation();
  const detailId = useId();
  return (
    <div className={`robot-ability-card ${expanded ? "expanded" : ""}`}>
      <button
        type="button"
        className="robot-ability-summary"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={detailId}
      >
        <span className="robot-ability-glyph" aria-hidden>
          ◉
        </span>
        <span className="robot-ability-name">{t("robotShop.basicAttack")}</span>
        <span
          className="robot-ability-type dmg-tag"
          style={{
            color: DAMAGE_TYPE_COLOR[spec.damageType],
            borderColor: DAMAGE_TYPE_COLOR[spec.damageType],
          }}
        >
          <DamageIcon
            type={spec.damageType}
            size={10}
            title={t(`damageTypes.${spec.damageType}`)}
          />
          {t(`damageTypes.${spec.damageType}`)}
        </span>
        <span className="robot-ability-toggle" aria-hidden>
          {expanded ? "−" : "+"}
        </span>
      </button>
      <AttackDetail
        id={detailId}
        expanded={expanded}
        blurb={t(`robots:variants.${spec.variant}.abilityBlurb.0`)}
        stats={formatAutoAttack(spec, t)}
      />
    </div>
  );
};

const RobotDetail = ({
  variant,
  availableBolts,
  activeRobot,
  unlocked,
}: {
  variant: RobotVariant;
  availableBolts: number;
  activeRobot: RobotVariant;
  unlocked: boolean;
}) => {
  const { t } = useTranslation();
  const spec = ROBOT_SPECS[variant];
  const progress = useGame((s) => s.progress);
  const unlockRobot = useGame((s) => s.unlockRobot);
  const setActiveRobot = useGame((s) => s.setActiveRobot);
  const resetSkills = useGame((s) => s.resetRobotSkills);
  // `auto` = the basic-attack card; 0..3 = QWER ability cards.
  const [openAbility, setOpenAbility] = useState<"auto" | AbilitySlot | null>(null);

  const xp = progress.robotXp[variant] ?? 0;
  const ranks = progress.robotSkills[variant];
  const level = levelForXp(xp);
  const { into, need, maxed } = xpProgressInLevel(xp);
  const pts = robotSkillPointsAvailable(xp, ranks);
  const active = activeRobot === variant;
  const canUnlock = !unlocked && (isDebug || availableBolts >= spec.unlockBolts);
  const xpPct = maxed ? 1 : need > 0 ? into / need : 0;
  const investedTotal = pts.spent;

  return (
    <div className="robot-detail">
      <div className="robot-detail-grid">
        <div className="robot-detail-preview">
          <RobotDiorama variant={variant} />
        </div>
        <div className="robot-detail-info">
          <div className="robot-detail-head">
            <div className="robot-detail-tag-row">
              <span className="robot-detail-callsign">{spec.callsign}</span>
              <span
                className="dmg-tag inline-flex items-center gap-1 text-[11px]"
                style={{
                  color: DAMAGE_TYPE_COLOR[spec.damageType],
                  borderColor: DAMAGE_TYPE_COLOR[spec.damageType],
                }}
              >
                {t(`damageTypes.${spec.damageType}`)}
              </span>
              {active && <span className="robot-detail-active">{t("robotShop.active")}</span>}
            </div>
            <p className="robot-detail-blurb">{t(`robots:variants.${variant}.blurb`)}</p>
          </div>

          <div className="robot-detail-stats">
            <div>
              <span>{t("robotShop.statHp")}</span> {spec.maxHp}
            </div>
            <div>
              <span>{t("robotShop.statSpd")}</span> {spec.speed}
            </div>
            <div>
              <span>{t("robotShop.statDmg")}</span> {spec.damage}
            </div>
            <div>
              <span>{t("robotShop.statRng")}</span> {spec.range}
            </div>
          </div>

          <div className="robot-ability-list">
            <AutoAttackCard
              spec={spec}
              expanded={openAbility === "auto"}
              onToggle={() => setOpenAbility(openAbility === "auto" ? null : "auto")}
            />
            {([0, 1, 2, 3] as const).map((slot) => (
              <AbilityCard
                key={slot}
                spec={spec}
                slot={slot}
                expanded={openAbility === slot}
                onToggle={() => setOpenAbility(openAbility === slot ? null : slot)}
              />
            ))}
          </div>

          {unlocked ? (
            <>
              <div className="robot-level-block">
                <div className="robot-level-head">
                  <span className="robot-level-lvl">
                    {t("robotShop.levelShort", { level })}
                    <span className="robot-level-max">/ {ROBOT_MAX_LEVEL}</span>
                  </span>
                  <span className="robot-level-xp">
                    {maxed ? t("robotShop.max") : t("robotShop.xpProgress", { into, need })}
                  </span>
                </div>
                <div className="robot-level-bar">
                  <div
                    className={`robot-level-fill ${maxed ? "maxed" : ""}`}
                    style={{ width: `${xpPct * 100}%` }}
                  />
                </div>
                <div className="robot-level-foot">
                  <span>
                    {t("robotShop.xpGrants", {
                      points: ROBOT_POINTS_PER_LEVEL,
                      earned: pts.earned,
                    })}
                    {pts.earned >= ROBOT_TREE_TOTAL_POINTS ? ` ${t("robotShop.treeMax")}` : ""}
                  </span>
                  <span className="robot-level-points">
                    {t("robotShop.pointsToSpend", { count: pts.available })}
                  </span>
                </div>
              </div>

              <div className="robot-skill-tree">
                {ROBOT_SKILL_TREE.map((node) => (
                  <SkillRow
                    key={node.id}
                    variant={variant}
                    node={node as RobotSkillNode}
                    rank={(ranks?.[node.id as RobotSkillId] ?? 0) as number}
                    available={pts.available}
                    availableBolts={availableBolts}
                  />
                ))}
                {investedTotal > 0 && (
                  <button
                    type="button"
                    className="robot-skill-refund"
                    onClick={() => resetSkills(variant)}
                    title={t("robotShop.refundAllCount", { count: investedTotal })}
                  >
                    ↺ {t("robotShop.refund", { count: investedTotal })}
                  </button>
                )}
              </div>

              {!active && (
                <button
                  type="button"
                  className="btn btn-blue text-sm py-2"
                  onClick={() => setActiveRobot(variant)}
                >
                  {t("robotShop.setActive")}
                </button>
              )}
            </>
          ) : IS_DEMO ? (
            <div className="border-t border-border-faint pt-3 flex flex-col items-start gap-2">
              <span className="text-[12px] text-fg-muted">
                {t("demo.teaserBody", { name: spec.label })}
              </span>
              <a
                href={STEAM_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-blue text-sm py-2 px-4 no-underline"
              >
                {t("demo.wishlist")}
              </a>
            </div>
          ) : (
            <div className="border-t border-border-faint pt-3 flex items-center gap-3">
              <span className="text-[12px] text-fg-muted">{t("robotShop.unlockCost")}</span>
              <BoltPrice amount={spec.unlockBolts} className="text-base" />
              <button
                type="button"
                className={`ml-auto btn ${canUnlock ? "btn-blue" : "btn-ghost"} text-sm py-2 px-4`}
                disabled={!canUnlock}
                onClick={() => unlockRobot(variant)}
                title={
                  canUnlock
                    ? isDebug
                      ? t("robotShop.unlockFreeDebug")
                      : t("robotShop.unlock")
                    : t("robotShop.needMoreBolts", { count: spec.unlockBolts - availableBolts })
                }
              >
                {canUnlock ? t("robotShop.unlock") : t("robotShop.lockedBtn")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const RobotShop = () => {
  const { t } = useTranslation();
  const open = useGame((s) => s.robotShopOpen);
  const setOpen = useGame((s) => s.setRobotShopOpen);
  const progress = useGame((s) => s.progress);
  const resetAll = useGame((s) => s.resetAllRobotSkills);
  const [selected, setSelected] = useState<RobotVariant | null>(null);
  if (!open) return null;
  const availableBolts = progress.bolts;
  const anyInvested = Object.values(progress.robotSkills).some(
    (r) => r && Object.keys(r).length > 0,
  );

  const handleClose = () => {
    setSelected(null);
    setOpen(false);
  };

  return (
    <MenuOverlay
      title={selected ? ROBOT_SPECS[selected].label : t("robotShop.pilotRoster")}
      subtitle={selected ? ROBOT_SPECS[selected].callsign : null}
      onClose={handleClose}
      headerLeading={
        selected ? (
          <button
            type="button"
            className="robot-detail-back"
            onClick={() => setSelected(null)}
            aria-label={t("robotShop.backToRoster")}
          >
            ← {t("robotShop.roster")}
          </button>
        ) : null
      }
      cardClassName={`robot-shop-card ${selected ? "robot-shop-card--detail" : ""} !w-[min(1100px,calc(100vw-24px))] !max-w-none !min-w-0 !px-4 sm:!px-6 md:!px-8`}
    >
      <div className="robot-shop-panel w-full">
        {selected ? (
          <RobotDetail
            variant={selected}
            availableBolts={availableBolts}
            activeRobot={progress.activeRobot}
            unlocked={!!progress.robotUnlocks[selected]}
          />
        ) : (
          <div className="robot-roster-grid">
            {(IS_DEMO ? demoRoster(availableBolts) : ROSTER).map((variant) => (
              <RosterCard
                key={variant}
                variant={variant}
                activeRobot={progress.activeRobot}
                unlocked={!!progress.robotUnlocks[variant]}
                onSelect={setSelected}
              />
            ))}
          </div>
        )}
      </div>
      <RobotShopToolbar
        bolts={availableBolts}
        canRefundAll={!selected && anyInvested}
        onRefundAll={resetAll}
      />
    </MenuOverlay>
  );
};

const RobotShopToolbar = ({
  bolts,
  canRefundAll,
  onRefundAll,
}: {
  bolts: number;
  canRefundAll: boolean;
  onRefundAll: () => void;
}) => {
  const { t } = useTranslation();
  return (
    <div className="lab-stars-toolbar">
      <span className="lab-stars-chip" title={t("robotShop.boltsGathered", { count: bolts })}>
        <IconBolt size={15} className="shrink-0" />
        <span className="lab-stars-num tabular-nums">{bolts}</span>
        <span className="lab-stars-lbl">{t("robotShop.boltsLabel")}</span>
      </span>
      {canRefundAll && (
        <button type="button" className="lab-stars-refund" onClick={onRefundAll}>
          ↺ {t("robotShop.refundAll")}
        </button>
      )}
    </div>
  );
};
