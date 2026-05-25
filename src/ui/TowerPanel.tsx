import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { effectiveFireRate } from "../sim/towers";
import type { DamageType, EnemyKind, TargetingMode, Tower } from "../sim/types";
import {
  formatStat,
  nextUpgrade,
  previewUpgrade,
  STAT_LABEL,
  sellRefund,
  UPGRADES,
} from "../sim/upgrades";
import {
  ENEMY_LABEL,
  ENEMY_RESIST,
  HIVE_MAX_DRONES_PER_TOWER,
  SUPPORT_PILL_COLOR,
  TOWER_DAMAGE_TYPE,
  TOWER_LABEL,
  towerPillInfo,
} from "../sim/world";
import { useGame } from "../store";
import { DamageIcon } from "./DamageIcon";
import { fmtCompact } from "./format";
import { HiveDronePanel } from "./HiveDronePanel";
import { RightOverlay } from "./RightOverlay";
import { TowerPreview } from "./TowerPreview";
import { useIsMobile } from "./useMediaQuery";

const ENEMY_ORDER: EnemyKind[] = [
  "raptor",
  "swarm",
  "para",
  "allosaur",
  "stego",
  "armored",
  "titan",
  "boss",
];

// `key` indexes into ui.json towerPanel.targeting.<key> / <key>Title.
const TARGETING_MODES: { mode: TargetingMode; key: string }[] = [
  { mode: "tower", key: "near" },
  { mode: "start", key: "start" },
  { mode: "end", key: "end" },
  { mode: "strongest", key: "strong" },
  { mode: "weakest", key: "weak" },
  { mode: "vulnerable", key: "vuln" },
];

export const TowerPanel = () => {
  const { t } = useTranslation();
  const selectedId = useGame((s) => s.ui.selectedTowerId);
  useGame((s) => s.ui.towerVersion);
  const gold = useGame((s) => s.ui.gold);
  const status = useGame((s) => s.ui.status);
  const isMobile = useIsMobile();
  const [infoOpen, setInfoOpen] = useState(false);
  // Iron mode disables selling; we still render the panel so upgrades
  // and targeting modes are reachable. SellFooter hides itself when
  // sellDisabled is true.
  const sellDisabled = useGame((s) => s.world.sellingDisabled);

  if (selectedId === null || status !== "running") return null;
  const tower = useGame.getState().world.towerById.get(selectedId);
  if (!tower) return null;

  // Hive is pure support — its damage / damage-type / resist columns
  // are meaningless. Branch above and skip the offensive widgets so the
  // panel reads as "what does this tower do for the others."
  if (tower.kind === "hive") {
    return (
      <RightOverlay className="tower-panel">
        <div className="panel-header">
          <TowerPreview kind={tower.kind} />
          <div className="panel-title">
            <div className="panel-name">
              {TOWER_LABEL[tower.kind]}
              <span
                className="dmg-tag"
                style={{ color: SUPPORT_PILL_COLOR, borderColor: SUPPORT_PILL_COLOR }}
                title={t("towerPanel.supportTitle")}
              >
                <DamageIcon type="support" size={12} title={t("towerPanel.support")} />
                {t("towerPanel.support")}
              </span>
            </div>
            <div className="panel-stats">
              {t("towerPanel.dronesBuff", {
                drones: tower.droneCount,
                buff: Math.round(tower.serviceBuff * 100),
              })}
            </div>
          </div>
          <button
            type="button"
            className="btn-close"
            onClick={() => useGame.getState().selectTower(null)}
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>

        <div className="text-[11px] leading-snug text-fg-muted mb-3 px-2 py-2 rounded-[5px] border border-border-faint bg-surface-faint">
          <Trans
            i18nKey="towerPanel.hiveBlurb"
            values={{
              pct: Math.round(tower.serviceBuff * 100),
              max: HIVE_MAX_DRONES_PER_TOWER,
            }}
            components={{ hl: <span style={{ color: "#bbffc8" }} /> }}
          />
        </div>

        <HiveDronePanel hive={tower} />

        <div className="branches">
          <BranchView tower={tower} branchId="a" gold={gold} />
          <BranchView tower={tower} branchId="b" gold={gold} />
        </div>

        <SellFooter tower={tower} sellDisabled={sellDisabled} />
      </RightOverlay>
    );
  }

  const damageType = TOWER_DAMAGE_TYPE[tower.kind];
  const pill = towerPillInfo(tower.kind);
  const dmgLabel = t(`damageTypes.${pill.type}`);

  return (
    <RightOverlay className="tower-panel">
      <div className="panel-header">
        <TowerPreview kind={tower.kind} />
        <div className="panel-title">
          <div className="panel-name">
            {TOWER_LABEL[tower.kind]}
            <span className="dmg-tag" style={{ color: pill.color, borderColor: pill.color }}>
              <DamageIcon type={pill.type} size={12} title={dmgLabel} />
              {dmgLabel}
            </span>
          </div>
          <div className="panel-stats">
            <TowerStatsText tower={tower} />
          </div>
        </div>
        <button
          type="button"
          className="btn-close"
          onClick={() => useGame.getState().selectTower(null)}
          aria-label={t("common.close")}
        >
          ×
        </button>
      </div>

      {isMobile ? (
        <div className={`mobile-fold tower-info-fold ${infoOpen ? "open" : ""}`}>
          <button
            type="button"
            className="mobile-fold-summary"
            aria-expanded={infoOpen}
            onClick={() => setInfoOpen((open) => !open)}
          >
            <span>{t("towerPanel.matchups")}</span>
            <span className="mobile-fold-toggle" aria-hidden />
          </button>
          {infoOpen && (
            <div className="mobile-fold-body">
              <ResistRow damageType={damageType} />
            </div>
          )}
        </div>
      ) : (
        <ResistRow damageType={damageType} />
      )}

      {tower.kind !== "cryo" && <TargetingSection tower={tower} mobile={isMobile} />}

      <div className="branches">
        <BranchView tower={tower} branchId="a" gold={gold} />
        <BranchView tower={tower} branchId="b" gold={gold} />
      </div>

      <SellFooter tower={tower} sellDisabled={sellDisabled} />
    </RightOverlay>
  );
};

const TowerStatsText = ({ tower }: { tower: Tower }) => {
  const { t } = useTranslation();
  return (
    <>
      {t("towerPanel.stat.dmg")} {tower.damage.toFixed(1)} · {t("towerPanel.stat.rate")}{" "}
      {tower.fireRate.toFixed(2)}/s · {t("towerPanel.stat.rng")} {tower.range.toFixed(1)} ·{" "}
      {t("towerPanel.stat.dps")} {(tower.damage * effectiveFireRate(tower)).toFixed(1)} ·{" "}
      {t("towerPanel.stat.kills")} {tower.kills} · {t("towerPanel.stat.dealt")}{" "}
      {fmtCompact(tower.damageDealt)}
      {tower.splashRadius > 0 && ` · ${t("towerPanel.stat.spl")} ${tower.splashRadius.toFixed(1)}`}
      {tower.chainCount > 0 && ` · ${t("towerPanel.stat.chn")} ${tower.chainCount}`}
      {tower.slowFactor < 1 &&
        ` · ${t("towerPanel.stat.slow")} ${(1 - tower.slowFactor).toFixed(2)}`}
      {tower.serviceFireRateBonus > 0 && (
        <>
          {" "}
          ·{" "}
          <span style={{ color: "#bbffc8" }}>
            {t("towerPanel.stat.support")} +{Math.round(tower.serviceFireRateBonus * 100)}%
          </span>
        </>
      )}
    </>
  );
};

const ResistRow = ({ damageType }: { damageType: DamageType }) => {
  const { t } = useTranslation();
  return (
    <div className="resist-row">
      {ENEMY_ORDER.map((k) => {
        const mul = ENEMY_RESIST[k][damageType];
        const pct = Math.round((mul - 1) * 100);
        const cls = pct > 0 ? "good" : pct < 0 ? "bad" : "neutral";
        return (
          <div
            key={k}
            className={`resist-chip ${cls}`}
            title={t("towerPanel.vs", { enemy: ENEMY_LABEL[k], mul: mul.toFixed(2) })}
          >
            <span className="resist-name">{ENEMY_LABEL[k]}</span>
            <span className="resist-val">{pct > 0 ? `+${pct}%` : pct < 0 ? `${pct}%` : "·"}</span>
          </div>
        );
      })}
    </div>
  );
};

const TargetingSection = ({ tower, mobile }: { tower: Tower; mobile: boolean }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const spotSelecting = useGame((s) => s.spotSelecting);
  const currentMode =
    tower.targetingMode === "spot"
      ? t("towerPanel.targeting.spot")
      : t(
          `towerPanel.targeting.${
            TARGETING_MODES.find(({ mode }) => mode === tower.targetingMode)?.key ?? "near"
          }`,
        );
  // Only prompt for a click while the player has actually armed spot-pick
  // (via the Spot button). Just being in spot mode no longer arms it.
  const showSpotHint = tower.kind === "mortar" && tower.targetingMode === "spot" && spotSelecting;
  const controls = (
    <>
      <div className="targeting-row">
        <div className="targeting-label">{t("towerPanel.target")}</div>
        <div className="targeting-buttons">
          {TARGETING_MODES.map(({ mode, key }) => (
            <button
              type="button"
              key={mode}
              className={`targeting-btn ${tower.targetingMode === mode ? "active" : ""}`}
              onClick={() => useGame.getState().setTargetingMode(mode)}
              title={t(`towerPanel.targeting.${key}Title`)}
            >
              {t(`towerPanel.targeting.${key}`)}
            </button>
          ))}
          {tower.kind === "mortar" && (
            <button
              type="button"
              className={`targeting-btn ${tower.targetingMode === "spot" ? "active" : ""} ${
                spotSelecting ? "arming" : ""
              }`}
              onClick={() => useGame.getState().setTargetingMode("spot")}
              title={t("towerPanel.targeting.spotTitle")}
            >
              {t("towerPanel.targeting.spot")}
            </button>
          )}
        </div>
      </div>
      {showSpotHint && <div className="targeting-hint">{t("towerPanel.spotHint")}</div>}
    </>
  );

  if (!mobile) return controls;

  return (
    <div className={`mobile-fold targeting-fold ${open ? "open" : ""}`}>
      <button
        type="button"
        className="mobile-fold-summary"
        aria-expanded={open}
        onClick={() => setOpen((expanded) => !expanded)}
      >
        <span>{t("towerPanel.target")}</span>
        <span className="mobile-fold-status">{currentMode}</span>
        <span className="mobile-fold-toggle" aria-hidden />
      </button>
      {open && <div className="mobile-fold-body">{controls}</div>}
    </div>
  );
};

const SellFooter = ({ tower, sellDisabled }: { tower: Tower; sellDisabled: boolean }) => {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  // Reset the confirm state whenever the selected tower changes so
  // switching towers never leaves a stale "Confirm Sell" from a
  // different tower.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tower.id is the intended trigger; other tower fields can change without needing reset
  useEffect(() => {
    setConfirming(false);
  }, [tower.id]);
  const refund = sellRefund(tower);

  if (sellDisabled) {
    return (
      <div className="panel-footer">
        <div className="text-[11px] text-fg-dim italic text-center w-full">
          {t("towerPanel.sellDisabled")}
        </div>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="panel-footer panel-footer-confirm">
        <button type="button" className="btn-sell-cancel" onClick={() => setConfirming(false)}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="btn-sell btn-sell-confirm"
          onClick={() => {
            setConfirming(false);
            useGame.getState().sellSelected();
          }}
        >
          {t("towerPanel.confirmSell", { refund })}
        </button>
      </div>
    );
  }
  return (
    <div className="panel-footer">
      <button type="button" className="btn-sell" onClick={() => setConfirming(true)}>
        {t("towerPanel.sell", { refund })}
      </button>
    </div>
  );
};

const BranchView = ({
  tower,
  branchId,
  gold,
}: {
  tower: Tower;
  branchId: "a" | "b";
  gold: number;
}) => {
  // Aliased to `tr` so it doesn't shadow the `t` tier in the tiers map below.
  const { t: tr } = useTranslation();
  const branch = UPGRADES[tower.kind][branchId];
  const tier = tower.upgrades[branchId];
  const next = nextUpgrade(tower, branchId);
  const upgrade = useGame((s) => s.upgradeSelected);

  const deltas = next ? previewUpgrade(tower, next) : [];

  return (
    <div className="branch">
      <div className="branch-label">{tr(`upgrades:tower.${tower.kind}.${branchId}.label`)}</div>
      <div className="tiers">
        {branch.tiers.map((_tier, i) => (
          <div key={i} className={`tier ${i < tier ? "owned" : i === tier ? "next" : "locked"}`}>
            <div className="tier-name">
              {tr(`upgrades:tower.${tower.kind}.${branchId}.tier.${i}.name`)}
            </div>
            <div className="tier-desc">
              {tr(`upgrades:tower.${tower.kind}.${branchId}.tier.${i}.desc`)}
            </div>
          </div>
        ))}
      </div>
      {/*
        Reserve a fixed vertical slot so the Sell button in panel-footer
        doesn't jump up when a branch maxes out mid-click — rapid clicking
        the upgrade button right at the last tier used to land the next
        click on Sell.
      */}
      <div className="branch-upgrade-slot">
        {next && deltas.length > 0 && (
          <div className="tier-preview">
            {deltas.map((d) => {
              const better =
                // For slowFactor lower is better, everything else higher.
                d.key === "slowFactor" ? d.to < d.from : d.to > d.from;
              return (
                <div key={d.key} className="tier-preview-row">
                  <span className="tier-preview-label">{STAT_LABEL[d.key]}</span>
                  <span className="tier-preview-from">{formatStat(d.key, d.from)}</span>
                  <span className="tier-preview-arrow">→</span>
                  <span className={`tier-preview-to ${better ? "better" : "worse"}`}>
                    {formatStat(d.key, d.to)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {next ? (
          <button
            type="button"
            className="btn-upgrade"
            disabled={gold < next.cost}
            onClick={() => upgrade(branchId)}
          >
            {tr("towerPanel.upgrade", { cost: next.cost })}
          </button>
        ) : (
          <div className="branch-max">{tr("towerPanel.maxedOut")}</div>
        )}
      </div>
    </div>
  );
};
