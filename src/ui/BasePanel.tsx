import { useTranslation } from "react-i18next";
import { baseDps } from "../sim/base";
import { canUseBattlefield } from "../sim/playControl";
import {
  BASE_STAT_LABEL,
  BASE_UPGRADES,
  type BaseStatDelta,
  type BaseUpgrade,
  formatBaseStat,
  nextBaseUpgrade,
  previewBaseUpgrade,
} from "../sim/upgrades";
import { useGame } from "../store";
import { fmtCompact } from "./format";
import { RightOverlay } from "./RightOverlay";

export const BasePanel = () => {
  const { t } = useTranslation();
  const selectedBase = useGame((s) => s.ui.selectedBase);
  useGame((s) => s.ui.towerVersion);
  const gold = useGame((s) => s.ui.gold);
  const battlefieldUsable = useGame(canUseBattlefield);

  if (!selectedBase || !battlefieldUsable) return null;
  const state = useGame.getState();
  const base = state.world.base;
  const hqCount = state.world.paths.length;

  return (
    <RightOverlay className="tower-panel">
      <div className="panel-header">
        <div className="panel-title">
          <div className="panel-name">
            {t("base.title")}
            <span
              className="dmg-tag"
              style={{ color: "#ff8a5a", borderColor: "#ff8a5a" }}
              title={t("base.laserTitle")}
            >
              {t("damageTypes.kinetic")}
            </span>
          </div>
          <div className="panel-stats">
            {t("towerPanel.stat.dmg")} {base.damage.toFixed(1)} · {t("towerPanel.stat.rate")}{" "}
            {base.fireRate.toFixed(2)}/s · {t("towerPanel.stat.rng")} {base.range.toFixed(1)} ·{" "}
            {t("towerPanel.stat.dps")} {baseDps(base, hqCount).toFixed(1)}
            {hqCount > 1 && ` (×${hqCount} HQ)`} · {t("towerPanel.stat.kills")} {base.kills} ·{" "}
            {t("towerPanel.stat.dealt")} {fmtCompact(base.damageDealt)}
          </div>
        </div>
        <button
          type="button"
          className="btn-close"
          onClick={() => state.selectBase(false)}
          aria-label={t("common.close")}
        >
          ×
        </button>
      </div>

      <div className="text-[11px] leading-snug text-fg-muted mb-3 px-2 py-2 rounded-[5px] border border-border-faint bg-surface-faint">
        {t("base.blurb", {
          where: hqCount > 1 ? t("base.eachHq", { count: hqCount }) : t("base.theHq"),
        })}
      </div>

      <div className="branches">
        <BaseBranchView branchId="a" gold={gold} />
        <BaseBranchView branchId="b" gold={gold} />
      </div>
    </RightOverlay>
  );
};

const BaseBranchView = ({ branchId, gold }: { branchId: "a" | "b"; gold: number }) => {
  const { t } = useTranslation();
  const state = useGame.getState();
  const base = state.world.base;
  const branch = BASE_UPGRADES[branchId];
  const tier = base.upgrades[branchId];
  const next: BaseUpgrade | null = nextBaseUpgrade(base, branchId);
  const upgrade = useGame((s) => s.upgradeBase);
  const deltas: BaseStatDelta[] = next ? previewBaseUpgrade(base, next) : [];

  return (
    <div className="branch">
      <div className="branch-label">{t(`upgrades:base.${branchId}.label`)}</div>
      <div className="tiers">
        {branch.tiers.map((_tier, i) => (
          <div key={i} className={`tier ${i < tier ? "owned" : i === tier ? "next" : "locked"}`}>
            <div className="tier-name">{t(`upgrades:base.${branchId}.tier.${i}.name`)}</div>
            <div className="tier-desc">{t(`upgrades:base.${branchId}.tier.${i}.desc`)}</div>
          </div>
        ))}
      </div>
      <div className="branch-upgrade-slot">
        {next && deltas.length > 0 && (
          <div className="tier-preview">
            {deltas.map((d) => (
              <div key={d.key} className="tier-preview-row">
                <span className="tier-preview-label">{BASE_STAT_LABEL[d.key]}</span>
                <span className="tier-preview-from">{formatBaseStat(d.key, d.from)}</span>
                <span className="tier-preview-arrow">→</span>
                <span className="tier-preview-to better">{formatBaseStat(d.key, d.to)}</span>
              </div>
            ))}
          </div>
        )}
        {next ? (
          <button
            type="button"
            className="btn-upgrade"
            disabled={gold < next.cost}
            onClick={() => upgrade(branchId)}
          >
            {t("towerPanel.upgrade", { cost: next.cost })}
          </button>
        ) : (
          <div className="branch-max">{t("towerPanel.maxedOut")}</div>
        )}
      </div>
    </div>
  );
};
