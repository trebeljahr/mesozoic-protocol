import { useTranslation } from "react-i18next";
import { audio } from "../audio/AudioManager";
import {
  DIFFICULTIES,
  DIFFICULTY_ACCENT,
  DIFFICULTY_MULTIPLIERS,
  type Difficulty,
} from "../progress";
import { useGame } from "../store";
import { DifficultyModelIcon } from "./DifficultyModelIcon";
import { useModalFocus } from "./useModalFocus";

const GLOW: Record<Difficulty, string> = {
  easy: "shadow-[0_0_24px_rgba(180,255,201,0.18)]",
  medium: "shadow-[0_0_24px_rgba(159,216,255,0.18)]",
  hard: "shadow-[0_0_24px_rgba(255,178,102,0.22)]",
  extinction: "shadow-[0_0_28px_rgba(255,90,122,0.28)]",
};

const formatPercent = (mul: number, deltaOnly = true): string => {
  if (mul === 1) return "1.0×";
  if (deltaOnly) {
    const pct = Math.round((mul - 1) * 100);
    return `${pct > 0 ? "+" : ""}${pct}%`;
  }
  return `${mul.toFixed(2)}×`;
};

export const DifficultyPicker = () => {
  const { t } = useTranslation();
  const current = useGame((s) => s.progress.difficulty);
  const setDifficulty = useGame((s) => s.setDifficulty);
  const setOpen = useGame((s) => s.setDifficultyPickerOpen);

  const dialogRef = useModalFocus(() => setOpen(false));

  return (
    <div className="overlay difficulty-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("difficulty.title")}
        tabIndex={-1}
        className="difficulty-card"
      >
        <header className="difficulty-header">
          <div>
            <h1>{t("difficulty.title")}</h1>
            <div className="difficulty-subtitle">
              {t("difficulty.currently", { difficulty: t(`modes:difficulty.label.${current}`) })}
            </div>
          </div>
          <button
            type="button"
            className="btn-close"
            onClick={() => setOpen(false)}
            aria-label={t("difficulty.close")}
            title={t("difficulty.close")}
          >
            ×
          </button>
        </header>

        <div className="difficulty-grid">
          {DIFFICULTIES.map((d) => {
            const m = DIFFICULTY_MULTIPLIERS[d];
            const accent = DIFFICULTY_ACCENT[d];
            const active = d === current;
            return (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setDifficulty(d);
                  audio.ui("select");
                }}
                className={`difficulty-option ${
                  active
                    ? `${accent.border} ${GLOW[d]}`
                    : "border-border hover:border-border-strong"
                }`}
                aria-pressed={active}
              >
                {active && (
                  <span className={`difficulty-active-badge ${accent.text}`}>
                    {t("common.active")}
                  </span>
                )}
                <div className="difficulty-option-icon">
                  <DifficultyModelIcon difficulty={d} className="w-full h-full" />
                </div>
                <div className={`difficulty-option-label ${accent.text}`}>
                  {t(`modes:difficulty.label.${d}`)}
                </div>
                <div className="difficulty-option-tagline">
                  {t(`modes:difficulty.tagline.${d}`)}
                </div>
                <ul className="difficulty-option-stats">
                  <Stat label={t("difficulty.enemyHp")} value={formatPercent(m.hp)} />
                  <Stat label={t("difficulty.startGold")} value={formatPercent(m.startGold)} />
                  <Stat label={t("difficulty.goldKill")} value={formatPercent(m.goldKill)} />
                  <Stat label={t("difficulty.speed")} value={formatPercent(m.speed)} />
                </ul>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <li className="flex justify-between">
    <span>{label}</span>
    <span className="text-fg font-semibold">{value}</span>
  </li>
);
