import { useTranslation } from "react-i18next";
import { audio } from "../audio/AudioManager";
import { biomeForPos } from "../biomes";
import { ENDLESS_ARENAS } from "../levels/endless";
import { getEndlessBest } from "../progress";
import { useGame } from "../store";
import { useModalFocus } from "./useModalFocus";

// Endless arena selector. Reuses the achievements overlay/card visual
// language (X-close, header, responsive card grid) so it matches the
// rest of the world-map menus. Each card shows the player's best wave for
// the current difficulty; tapping one starts that arena.
export const EndlessPicker = () => {
  const { t } = useTranslation();
  const progress = useGame((s) => s.progress);
  const startEndless = useGame((s) => s.startEndless);
  const setOpen = useGame((s) => s.setEndlessPickerOpen);

  const dialogRef = useModalFocus(() => setOpen(false));

  return (
    <div className="overlay achievements-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("endlessPicker.title")}
        tabIndex={-1}
        className="achievements-card"
      >
        <header className="achievements-header">
          <div>
            <h1>{t("endlessPicker.title")}</h1>
            <div className="achievements-subtitle">
              {t("endlessPicker.subtitle", {
                difficulty: t(`modes:difficulty.label.${progress.difficulty}`),
              })}
            </div>
          </div>
          <button
            type="button"
            className="btn-close"
            onClick={() => setOpen(false)}
            aria-label={t("endlessPicker.close")}
            title={t("endlessPicker.close")}
          >
            ×
          </button>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-3 sm:gap-3 sm:p-5 overflow-y-auto">
          {ENDLESS_ARENAS.map((arena) => {
            const best = getEndlessBest(progress, arena.mapId, progress.difficulty);
            const biome = biomeForPos(arena.nodePos);
            return (
              <button
                key={arena.mapId}
                type="button"
                onClick={() => {
                  audio.ui("select");
                  startEndless(arena.mapId);
                }}
                className="relative flex flex-col items-stretch text-left gap-2 p-3 sm:p-4 rounded-lg border bg-surface-1 border-blue shadow-[0_0_24px_rgba(159,216,255,0.18)] cursor-pointer hover:brightness-110 transition-all"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-bold text-blue tracking-mid">
                    {t(`levels:endless.${arena.mapId}.name`)}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-fg-dim">
                    {t(`endlessPicker.biome.${biome}`)}
                  </span>
                </div>
                <div className="text-[11px] text-fg-muted leading-snug min-h-[36px]">
                  {t(`levels:endless.${arena.mapId}.blurb`)}
                </div>
                <ul className="flex flex-col gap-1 text-[11px] text-fg border-t border-border-faint pt-2 mt-1 tabular-nums">
                  <li className="flex justify-between">
                    <span className="text-fg-muted">{t("endlessPicker.bestWave")}</span>
                    <span className="text-gold font-semibold">{best > 0 ? best : "—"}</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-fg-muted">{t("endlessPicker.lanes")}</span>
                    <span className="text-fg font-semibold">{arena.paths.length}</span>
                  </li>
                </ul>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
