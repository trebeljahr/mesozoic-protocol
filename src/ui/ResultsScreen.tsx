import type React from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { audio } from "../audio/AudioManager";
import { LEVELS } from "../levels";
import { isLevelUnlocked } from "../progress";
import { useGame } from "../store";
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

export const ResultsScreen = () => {
  const { t } = useTranslation();
  const result = useGame((s) => s.lastResult);
  const progress = useGame((s) => s.progress);
  const retry = useGame((s) => s.retryCurrentLevel);
  const goToMap = useGame((s) => s.goToWorldMap);
  const startLevel = useGame((s) => s.startLevel);

  const nextLevel = result ? LEVELS.find((l) => l.id === result.levelId + 1) : undefined;
  // Heroic/iron don't gate next-level unlock (normal 3-star already did), so
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

  // Endless runs have no stars and no "next level" — just the wave reached,
  // the running best, and a new-best flag.
  if (result.endless) {
    const en = result.endless;
    return (
      <div className="overlay">
        <div className="overlay-card min-w-[420px] px-10 py-8">
          <div className="flex items-center justify-center gap-3 mb-1">
            <h1 className="!mb-0">Overrun.</h1>
            {en.newBest && (
              <span className="inline-flex items-center rounded border border-gold text-gold font-bold text-[11px] uppercase tracking-wide px-2 py-0.5">
                New Best
              </span>
            )}
          </div>
          <div className="text-[13px] tracking-uber uppercase text-fg-dim mb-5">
            <span className="text-cyan mr-2">Endless ∞ ·</span>
            {en.mapName}
          </div>

          <div className="bg-[rgba(8,12,18,0.45)] border border-[rgba(120,160,200,0.14)] rounded-lg px-4 py-3.5 mb-5">
            <div className="flex flex-col items-center gap-0.5 mb-3">
              <div className="text-[11px] uppercase tracking-uber text-fg-muted">Reached wave</div>
              <div className="text-5xl font-bold text-blue tabular-nums leading-none">
                {en.waveReached}
              </div>
            </div>
            <ResultRow label="Best wave" value={`${en.bestWave}`} />
            <ResultRow label="Enemies killed" value={`${en.enemiesKilled}`} />
          </div>

          <div className="flex gap-2.5 justify-center">
            <button type="button" onClick={retry} className="btn">
              Play Again<span className="kbd-only"> (R)</span>
            </button>
            <button type="button" onClick={goToMap} className="btn btn-secondary">
              World Map<span className="kbd-only"> (Esc)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay">
      <div className="overlay-card min-w-[420px] px-10 py-8">
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
            <span className={result.mode === "heroic" ? "text-orange mr-2" : "text-red mr-2"}>
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

        <div className="flex gap-2.5 justify-center">
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
    </div>
  );
};

const ResultRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex justify-between items-center text-[13px] my-1.5">
    <span className="text-fg-muted tracking-tight">{label}</span>
    <span className="text-fg font-bold inline-flex items-center">{value}</span>
  </div>
);

// Single-icon badge used in place of the 3-star row for heroic/iron
// runs. Earned = bright + glowing, unearned = dim outline so the player
// sees what they still owe on this map.
const ModeBadge = ({
  mode,
  earned,
  compact = false,
}: {
  mode: "heroic" | "iron";
  earned: boolean;
  compact?: boolean;
}) => {
  const { t } = useTranslation();
  const icon = mode === "heroic" ? "✦" : "▣";
  const colorClass = mode === "heroic" ? "text-orange" : "text-red";
  const borderClass = mode === "heroic" ? "border-orange" : "border-red";
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
