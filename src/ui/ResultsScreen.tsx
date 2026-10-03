import type React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { audio } from "../audio/AudioManager";
import { DEMO_MAX_LEVEL, IS_DEMO, STEAM_STORE_READY, STEAM_STORE_URL } from "../demo";
import { LEVELS } from "../levels";
import { isLevelUnlocked } from "../progress";
import { mvpTowerOnField } from "../sim/runReport";
import { TOWER_LABEL } from "../sim/world";
import { useGame } from "../store";
import { AfterActionReport } from "./AfterActionReport";
import { CampaignEpilogue } from "./CampaignEpilogue";
import { activeModal } from "./modalFocus";
import { STAR_STAGGER_MS, StarDisplay } from "./StarDisplay";

// The result-cue stinger must fire exactly once per game-end. This component
// remounts whenever a scene-blocking modal is toggled over the results screen
// (App gates it on `!sceneBlockingModalOpen`) and StrictMode double-invokes
// effects — both re-run the play effect. AudioManager's per-key cooldown only
// collapses replays within 1s, so a remount seconds later double-plays the
// horn. `lastResult` is a stable reference for one end-screen (engine.step
// freezes on win, so it's set once and never re-spread), so tracking the
// reference we last cued — at module scope, surviving remounts — guarantees a
// single play per run.
let cuedResult: unknown = null;
const dismissedEpilogues = new WeakSet<object>();

export const ResultsScreen = () => {
  const { t } = useTranslation();
  const result = useGame((s) => s.lastResult);
  const progress = useGame((s) => s.progress);
  const retry = useGame((s) => s.retryCurrentLevel);
  const goToMap = useGame((s) => s.goToWorldMap);
  const startLevel = useGame((s) => s.startLevel);

  const [dismissedEpilogue, setDismissedEpilogue] = useState<typeof result>(() =>
    result && dismissedEpilogues.has(result) ? result : null,
  );
  const showEpilogue = !!result?.campaignCompleted && dismissedEpilogue !== result;

  const nextLevel = result ? LEVELS.find((l) => l.id === result.levelId + 1) : undefined;
  // Breach/containment don't gate next-level unlock (normal 3-star already did), so
  // surfacing "Unlocked: X" + a Next Level button after a challenge run reads
  // as nonsense. Only normal mode advances along the campaign spine.
  const showNext =
    !!result &&
    result.won &&
    result.mode === "normal" &&
    nextLevel !== undefined &&
    isLevelUnlocked(nextLevel.id, progress);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (activeModal() || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      if (
        (e.code === "Enter" || e.code === "NumpadEnter") &&
        (e.target as HTMLElement)?.closest("button, a, summary")
      )
        return;
      if (e.code === "KeyR") {
        e.preventDefault();
        retry();
      } else if (e.code === "Escape") {
        e.preventDefault();
        goToMap();
      } else if (showNext && (e.code === "Enter" || e.code === "NumpadEnter")) {
        e.preventDefault();
        startLevel(nextLevel!.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [retry, goToMap, startLevel, showNext, nextLevel]);

  const stars = result?.stars ?? 0;
  const won = result?.won ?? false;
  // Demo build: clearing the final playable outpost (L5) is the end of the
  // slice — swap the missing "next level" path for a Steam wishlist CTA.
  // Folds away in the full build (IS_DEMO === false).
  const showDemoCta =
    IS_DEMO && !!result && !result.endless && result.won && result.levelId === DEMO_MAX_LEVEL;
  useEffect(() => {
    if (!result) return;
    if (cuedResult === result) return;
    cuedResult = result;
    const timers: ReturnType<typeof setTimeout>[] = [];
    // Stinger first; stars chime in on top so the moment lands as a single
    // beat rather than the per-star spray reading as the entire result cue.
    audio.play(won ? "victory" : "defeat", "notifications", won ? 0.48 : 0.85, 1000, 2.8);
    if (stars > 0) {
      const starOffset = 450;
      for (let i = 0; i < stars; i++) {
        timers.push(
          setTimeout(
            () => audio.play("star", "notifications", 0.8, 30, 1.8),
            starOffset + i * STAR_STAGGER_MS,
          ),
        );
      }
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [result, stars, won]);

  if (!result) return null;

  const mvpTower = mvpTowerOnField(result.report, useGame.getState().world);
  if (mvpTower) {
    return (
      <div className="results-mvp-overlay">
        <header className="results-mvp-header">
          <div className="flex items-center justify-center gap-3">
            <h1>
              {result.endless
                ? t("results.endless.overrun")
                : result.won
                  ? t("results.won")
                  : t("results.lost")}
            </h1>
            {!result.endless &&
              (result.mode === "normal" ? (
                <StarDisplay count={result.stars as 0 | 1 | 2 | 3} size={24} animate />
              ) : (
                <ModeBadge mode={result.mode} earned={result.stars >= 1} />
              ))}
          </div>
          <p>{result.endless ? result.endless.mapName : result.levelName}</p>
        </header>

        <div className="results-mvp-spacer" aria-hidden="true" />

        <div className="results-mvp-footer">
          <div className="results-mvp-stats">
            <div>
              <div className="results-mvp-label">{t("results.mvpTower")}</div>
              <div className="results-mvp-name">{TOWER_LABEL[mvpTower.kind]}</div>
              <div className="results-mvp-damage">
                <strong>{Math.round(mvpTower.damageDealt).toLocaleString()}</strong>
                <span>{t("results.damageDealt")}</span>
              </div>
            </div>
            <AfterActionReport report={result.report} />
          </div>
          {showDemoCta && (
            <div className="results-mvp-demo">
              <span>{t("demo.resultsTitle")}</span>
              {STEAM_STORE_READY ? (
                <a
                  href={STEAM_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-blue"
                >
                  {t("demo.wishlist")}
                </a>
              ) : (
                <span>{t("demo.storeSoon")}</span>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2.5 justify-center">
            {showNext && (
              <button type="button" onClick={() => startLevel(nextLevel!.id)} className="btn">
                {t("results.nextLevel")}
                <span className="kbd-only"> (Enter)</span>
              </button>
            )}
            <button
              type="button"
              onClick={goToMap}
              className={showNext ? "btn btn-secondary" : "btn"}
            >
              {t("results.worldMap")}
              <span className="kbd-only"> (Esc)</span>
            </button>
            <button type="button" onClick={retry} className="btn btn-secondary">
              {t(result.endless ? "results.endless.playAgain" : "results.retry")}
              <span className="kbd-only"> (R)</span>
            </button>
            {result.campaignCompleted && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDismissedEpilogue(null)}
              >
                {t("epilogue.replay")}
              </button>
            )}
          </div>
        </div>
        {showEpilogue && (
          <CampaignEpilogue
            onClose={() => {
              dismissedEpilogues.add(result);
              setDismissedEpilogue(result);
            }}
          />
        )}
      </div>
    );
  }

  // Endless runs have no stars and no "next level" — just the wave reached,
  // the running best, and a new-best flag.
  if (result.endless) {
    const en = result.endless;
    return (
      <div className="overlay">
        <div className="overlay-card !min-w-0 !w-[min(600px,calc(100vw-24px))] !max-h-[calc(100dvh-24px)] overflow-y-auto px-5 py-4 sm:px-8 sm:py-6">
          <div className="flex items-center justify-center gap-3 mb-1">
            <h1 className="!mb-0">{t("results.endless.overrun")}</h1>
            {en.newBest && (
              <span className="inline-flex items-center rounded border border-gold text-gold font-bold text-[11px] uppercase tracking-wide px-2 py-0.5">
                {t("results.endless.newBest")}
              </span>
            )}
          </div>
          <div className="text-[13px] tracking-uber uppercase text-fg-dim mb-5">
            <span className="text-cyan mr-2">{t("endlessPicker.title")} ∞ ·</span>
            {en.mapName}
          </div>

          <div className="bg-[rgba(8,12,18,0.45)] border border-[rgba(120,160,200,0.14)] rounded-lg px-4 py-3.5 mb-5">
            <div className="flex flex-col items-center gap-0.5 mb-3">
              <div className="text-[11px] uppercase tracking-uber text-fg-muted">
                {t("results.endless.waveReached")}
              </div>
              <div className="text-5xl font-bold text-blue tabular-nums leading-none">
                {en.waveReached}
              </div>
            </div>
            <ResultRow label={t("results.endless.bestWave")} value={`${en.bestWave}`} />
            <ResultRow label={t("results.endless.enemiesKilled")} value={`${en.enemiesKilled}`} />
          </div>

          <AfterActionReport report={result.report} />
          <div className="flex flex-wrap gap-2.5 justify-center">
            <button type="button" onClick={retry} className="btn">
              {t("results.endless.playAgain")}
              <span className="kbd-only"> (R)</span>
            </button>
            <button type="button" onClick={goToMap} className="btn btn-secondary">
              {t("results.worldMap")}
              <span className="kbd-only"> (Esc)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay">
      <div className="overlay-card !min-w-0 !w-[min(600px,calc(100vw-24px))] !max-h-[calc(100dvh-24px)] overflow-y-auto px-5 py-4 sm:px-8 sm:py-6">
        <div className="flex items-center justify-center gap-4 mb-1">
          <h1 className="!mb-0">{result.won ? t("results.won") : t("results.lost")}</h1>
          {result.mode === "normal" ? (
            <StarDisplay count={result.stars as 0 | 1 | 2 | 3} size={28} animate />
          ) : (
            <ModeBadge mode={result.mode} earned={result.stars >= 1} />
          )}
        </div>
        <div className="text-[13px] tracking-uber uppercase text-fg-dim mb-5">
          {result.mode !== "normal" && (
            <span className={result.mode === "breach" ? "text-orange mr-2" : "text-red mr-2"}>
              {t(`modes:mode.label.${result.mode}`)} ·
            </span>
          )}
          {result.levelName}
        </div>

        <div className="bg-[rgba(8,12,18,0.45)] border border-[rgba(120,160,200,0.14)] rounded-lg px-4 py-3.5 mb-5">
          <ResultRow
            label={t("results.livesRemaining")}
            value={`${result.livesRemaining} / ${result.startingLives}`}
          />
          <ResultRow
            label={t("common.best")}
            value={
              result.mode === "normal" ? (
                <StarDisplay count={result.bestStars as 0 | 1 | 2 | 3} size={14} />
              ) : (
                <ModeBadge mode={result.mode} earned={result.bestStars >= 1} compact />
              )
            }
          />
          {showNext && (
            <div className="mt-1.5 text-center text-xs text-cyan tracking-[0.06em]">
              {t("results.unlocked", { level: t(`levels:names.${nextLevel!.id}`) })}
            </div>
          )}
        </div>

        <AfterActionReport report={result.report} />
        {result.campaignCompleted && (
          <button
            type="button"
            className="btn btn-secondary mb-4"
            onClick={() => setDismissedEpilogue(null)}
          >
            {t("epilogue.replay")}
          </button>
        )}

        {showDemoCta && (
          <div className="bg-[rgba(10,40,60,0.55)] border border-blue/50 rounded-lg px-4 py-3.5 mb-5 text-center">
            <div className="text-sm font-bold text-cyan mb-1">{t("demo.resultsTitle")}</div>
            <p className="text-[12px] leading-snug text-fg-muted mb-3">{t("demo.resultsBody")}</p>
            {STEAM_STORE_READY ? (
              <a
                href={STEAM_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-blue text-sm py-2 px-4 no-underline inline-flex"
              >
                {t("demo.wishlist")}
              </a>
            ) : (
              <p className="text-sm text-fg-muted">{t("demo.storeSoon")}</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2.5 justify-center">
          {showNext && (
            <button type="button" onClick={() => startLevel(nextLevel!.id)} className="btn">
              {t("results.nextLevel")}
              <span className="kbd-only"> (Enter)</span>
            </button>
          )}
          <button
            type="button"
            onClick={goToMap}
            className={showNext ? "btn btn-secondary" : "btn"}
          >
            {t("results.worldMap")}
            <span className="kbd-only"> (Esc)</span>
          </button>
          <button type="button" onClick={retry} className="btn btn-secondary">
            {t("results.retry")}
            <span className="kbd-only"> (R)</span>
          </button>
        </div>
      </div>
      {showEpilogue && (
        <CampaignEpilogue
          onClose={() => {
            dismissedEpilogues.add(result);
            setDismissedEpilogue(result);
          }}
        />
      )}
    </div>
  );
};

const ResultRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex justify-between items-center text-[13px] my-1.5">
    <span className="text-fg-muted tracking-tight">{label}</span>
    <span className="text-fg font-bold inline-flex items-center">{value}</span>
  </div>
);

// Single-icon badge used in place of the 3-star row for breach/containment
// runs. Earned = bright + glowing, unearned = dim outline so the player
// sees what they still owe on this map.
const ModeBadge = ({
  mode,
  earned,
  compact = false,
}: {
  mode: "breach" | "containment";
  earned: boolean;
  compact?: boolean;
}) => {
  const { t } = useTranslation();
  const icon = mode === "breach" ? "✦" : "▣";
  const colorClass = mode === "breach" ? "text-orange" : "text-red";
  const borderClass = mode === "breach" ? "border-orange" : "border-red";
  const size = compact ? "text-sm px-1.5 py-0.5" : "text-2xl px-3 py-1";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border ${borderClass} ${size} ${
        earned ? `${colorClass} font-bold` : "text-fg-dim opacity-50"
      }`}
    >
      <span aria-hidden>{icon}</span>
      <span className="text-[10px] uppercase tracking-wide">{t(`modes:mode.label.${mode}`)}</span>
    </span>
  );
};
