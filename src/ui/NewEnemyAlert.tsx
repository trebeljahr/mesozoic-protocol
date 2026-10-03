import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { audio } from "../audio/AudioManager";
import type { DamageType } from "../sim/types";
import {
  BOSS_VARIANT_LABEL,
  BOSS_VARIANT_RESIST,
  BOSS_VARIANT_STATS,
  ENEMY_LABEL,
  ENEMY_RESIST,
  ENEMY_STATS,
} from "../sim/world";
import { useGame } from "../store";
import { DamageIcon } from "./DamageIcon";
import { EnemyIcon } from "./EnemyIcon";
import { activeModal, isActivationKey, isModalUtilityTarget } from "./modalFocus";
import { useModalFocus } from "./useModalFocus";

const DAMAGE_TYPES: DamageType[] = ["kinetic", "electric", "cold", "explosive", "flame"];

export const NewEnemyAlert = () => {
  const { t } = useTranslation();
  const queue = useGame((s) => s.newEnemyQueue);
  const dismiss = useGame((s) => s.dismissNewEnemy);
  const sighting = queue[0];
  const dialogRef = useModalFocus(dismiss, !!sighting);

  useEffect(() => {
    if (!sighting) return;
    audio.play("new-enemy", "enemies", 0.7, 200, 2.5);
  }, [sighting]);

  useEffect(() => {
    if (!sighting) return;
    // Swallow every key while the alert is up — otherwise game hotkeys
    // (P, R, 1–4, Space) leak through and confuse state.
    const onKey = (e: KeyboardEvent) => {
      if (isModalUtilityTarget(e.target) || activeModal() !== dialogRef.current) return;
      if (isActivationKey(e)) {
        e.preventDefault();
        dismiss();
      }
      if (isActivationKey(e)) e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sighting, dismiss, dialogRef]);

  if (!sighting) return null;

  // Matriarch variants pull their data from BOSS_VARIANT_* so the popup
  // shows the queen's real HP / resists / 20-life leak damage, not the
  // base "boss" row.
  const isMatriarch = sighting.tag === "matriarch";
  const resist = isMatriarch
    ? BOSS_VARIANT_RESIST[sighting.variant]
    : ENEMY_RESIST[sighting.species];
  const stats = isMatriarch ? BOSS_VARIANT_STATS[sighting.variant] : ENEMY_STATS[sighting.species];
  const label = isMatriarch ? BOSS_VARIANT_LABEL[sighting.variant] : ENEMY_LABEL[sighting.species];
  const subtitle = isMatriarch
    ? t(`enemies:matriarch.${sighting.variant}.subtitle`)
    : t(`enemies:${sighting.species}.subtitle`);
  const description = isMatriarch
    ? t(`enemies:matriarch.${sighting.variant}.description`)
    : t(`enemies:${sighting.species}.description`);

  const weakest = DAMAGE_TYPES.reduce(
    (best, t) => (resist[t] > resist[best] ? t : best),
    DAMAGE_TYPES[0],
  );
  const weakestPct = Math.round((resist[weakest] - 1) * 100);
  const remaining = queue.length - 1;

  return (
    <div className="overlay new-enemy-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="new-enemy-card flex flex-col items-stretch gap-2 sm:gap-2.5 w-[360px] max-w-[calc(100vw-16px)] pt-3 px-4 pb-4 sm:pt-[22px] sm:px-[26px] sm:pb-6 rounded-2xl border border-[rgba(255,170,110,0.35)]"
      >
        <div className="new-enemy-body-top flex flex-col items-stretch gap-2 sm:gap-2.5">
          <div className="self-center text-[10px] tracking-uber text-orange font-bold px-2.5 py-1 rounded-sm border border-[rgba(255,178,102,0.45)] bg-[rgba(255,178,102,0.08)] uppercase">
            {isMatriarch ? t("newEnemy.matriarchDetected") : t("newEnemy.newHostile")}
          </div>
          <h1 className="mt-0.5 mb-0 text-center text-[20px] sm:text-[28px] font-bold tracking-[0.02em] text-white font-display leading-tight">
            {label}
          </h1>
          <div className="text-center text-fg-muted text-[10px] sm:text-xs tracking-[0.18em] uppercase -mt-0.5">
            {subtitle}
          </div>
        </div>
        <div className="new-enemy-image self-center shrink-0 w-[160px] h-[160px] sm:w-[260px] sm:h-[260px] rounded-xl overflow-hidden border border-border bg-[#1b2a22]">
          {isMatriarch ? (
            <EnemyIcon kind="boss" bossVariant={sighting.variant} />
          ) : (
            <EnemyIcon kind={sighting.species} />
          )}
        </div>
        <div className="new-enemy-body-bottom flex flex-col items-stretch gap-2 sm:gap-2.5">
          <p className="mt-0.5 mb-0 text-[12px] sm:text-[13px] leading-[1.45] sm:leading-[1.55] text-[#cfd8e3] text-center">
            {description}
          </p>
          <div className="grid grid-cols-4 gap-1 sm:gap-1.5 p-1.5 sm:p-2 bg-[rgba(6,10,14,0.5)] border border-[rgba(120,160,200,0.14)] rounded-lg">
            <NewEnemyStat label={t("compendium.stat.hp")} value={stats.hp} />
            <NewEnemyStat label={t("compendium.stat.speed")} value={stats.speed.toFixed(1)} />
            <NewEnemyStat
              label={t("compendium.stat.damage")}
              value={stats.damage}
              highlight={isMatriarch}
            />
            <NewEnemyStat label={t("compendium.stat.bounty")} value={`${stats.bounty}g`} />
          </div>
          {isMatriarch && (
            <div className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-[rgba(255,90,58,0.10)] border border-[rgba(255,90,58,0.45)]">
              <div className="text-[10px] tracking-[0.16em] text-[#ff8a6a] uppercase font-bold">
                {t("newEnemy.warning")}
              </div>
              <div className="ml-auto text-[#ffb39a] text-[12px] sm:text-[13px] font-semibold tabular-nums">
                {t("newEnemy.livesOnLeak", { damage: stats.damage })}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-[rgba(61,255,138,0.07)] border border-[rgba(61,255,138,0.28)]">
            <div className="text-[10px] tracking-[0.16em] text-[#8ad9a5] uppercase font-bold">
              {t("newEnemy.recommended")}
            </div>
            {weakestPct > 0 ? (
              <div className="flex items-center gap-1.5 sm:gap-2 ml-auto text-green text-[12px] sm:text-[13px] font-semibold">
                <DamageIcon type={weakest} size={16} />
                <span>{t(`damageTypes.${weakest}`)}</span>
                <span className="text-green tabular-nums">+{weakestPct}%</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 ml-auto text-fg-muted text-[12px] sm:text-[13px] font-medium">
                <span>{t("newEnemy.balanced")}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn mt-0.5 sm:mt-1 w-full text-sm px-5 py-2.5 sm:py-3"
            onClick={dismiss}
          >
            {remaining > 0
              ? t("newEnemy.continueMore", { count: remaining })
              : t("newEnemy.continue")}
          </button>
        </div>
      </div>
    </div>
  );
};

const NewEnemyStat = ({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) => (
  <div className="flex flex-col items-center gap-0.5">
    <span className="text-[9px] tracking-[0.16em] text-[#7a8594] uppercase">{label}</span>
    <span
      className={`text-[15px] font-bold tabular-nums ${highlight ? "text-[#ff8a6a]" : "text-[#eef2f8]"}`}
    >
      {value}
    </span>
  </div>
);
