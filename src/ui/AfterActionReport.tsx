import { useTranslation } from "react-i18next";
import { ROBOT_SPECS } from "../sim/robotVariants";
import type { RunReport } from "../sim/runReport";
import type { RobotVariant } from "../sim/types";
import { ENEMY_LABEL, TOWER_LABEL } from "../sim/world";
import { useGame } from "../store";

export const AfterActionReport = ({ report }: { report: RunReport }) => {
  const { t } = useTranslation();
  const topLeak = report.leaks[0];
  const topTower = report.towers.find((tower) => tower.damageDealt > 0);
  const elapsed = `${Math.floor(report.elapsedSeconds / 60)}:${String(report.elapsedSeconds % 60).padStart(2, "0")}`;
  const xp = Object.entries(report.robotXpEarned);
  return (
    <section
      aria-label={t("report.title")}
      className="text-left text-sm border-t border-border pt-3 mb-4"
    >
      <h2 className="text-gold text-sm font-bold mb-2">{t("report.title")}</h2>
      <p className="text-fg-secondary mb-2">
        {report.totalWaves === null
          ? t("report.endlessWave", { wave: report.waveReached })
          : t("report.wave", { wave: report.waveReached, total: report.totalWaves })}
        {" · "}
        {elapsed}
        {" · "}
        {t(`modes:difficulty.label.${report.difficulty}`)}
      </p>
      <p>
        {t("report.bolts", { count: report.boltsEarned })}
        {" · "}
        {t("report.xp", { count: xp.reduce((sum, [, earned]) => sum + (earned ?? 0), 0) })}
        {report.mode !== "endless" && (
          <> · {t("report.stars", { stars: report.starsEarned, newStars: report.newStars })}</>
        )}
      </p>
      {xp.length > 0 && (
        <p className="text-xs text-fg-muted">
          {xp
            .map(([variant, earned]) =>
              t("report.robotXp", {
                robot: ROBOT_SPECS[variant as RobotVariant].label,
                count: earned,
              }),
            )
            .join(" · ")}
        </p>
      )}
      <p className="text-xs text-fg-muted mt-1">{t("report.rewardUse")}</p>
      {report.mode !== "endless" && (
        <p className="text-cyan mt-2">
          {report.nextStar ? t("report.nextStar", report.nextStar) : t("report.allStars")}
        </p>
      )}
      {topLeak ? (
        <div className="mt-3">
          <p>
            {t("report.leakConclusion", {
              species: ENEMY_LABEL[topLeak.kind],
              count: topLeak.count,
              lives: topLeak.livesLost,
            })}
          </p>
          <button
            type="button"
            className="btn btn-secondary text-xs mt-2"
            onClick={() => useGame.getState().setCompendiumOpen(true, "enemy")}
          >
            {t("report.inspectLeaks")}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-fg-muted">{t("report.noLeaks")}</p>
      )}
      {topTower && (
        <p className="mt-2 text-fg-secondary">
          {t("report.topTower", {
            tower: TOWER_LABEL[topTower.kind],
            damage: Math.round(topTower.damageDealt),
            kills: topTower.kills,
          })}
          {topTower.sold ? ` ${t("report.sold")}` : ""}
        </p>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-cyan py-1">{t("report.details")}</summary>
        <dl className="space-y-1 mt-2">
          {report.leaks.map((leak) => (
            <div className="flex justify-between gap-3" key={leak.kind}>
              <dt>{ENEMY_LABEL[leak.kind]}</dt>
              <dd>{t("report.leakRow", { count: leak.count, lives: leak.livesLost })}</dd>
            </div>
          ))}
          {report.towers.map((tower) => (
            <div className="flex justify-between gap-3" key={tower.id}>
              <dt>
                {TOWER_LABEL[tower.kind]} #{tower.id} {tower.sold && t("report.sold")}
              </dt>
              <dd>
                {t("report.contribution", {
                  damage: Math.round(tower.damageDealt),
                  kills: tower.kills,
                })}
              </dd>
            </div>
          ))}
          <div className="flex justify-between gap-3">
            <dt>{t("report.robot")}</dt>
            <dd>
              {t("report.contribution", {
                damage: Math.round(report.robotContribution.damageDealt),
                kills: report.robotContribution.kills,
              })}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>{t("report.base")}</dt>
            <dd>
              {t("report.contribution", {
                damage: Math.round(report.baseContribution.damageDealt),
                kills: report.baseContribution.kills,
              })}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-fg-muted mt-2">{t("report.supportNote")}</p>
      </details>
    </section>
  );
};
