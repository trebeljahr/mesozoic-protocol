// Covers the brief gap between clicking a level on the world map and
// the play scene having all of its shaders compiled. Replaces the bare
// black canvas flash that used to be visible while drei's Suspense was
// blocked on tower/dino GLBs and the GPU was compiling their materials.
//
// Visibility logic:
//  - Shown from the moment a cold level click is registered (the store's
//    `levelLoadPending` flag) — set synchronously on click, before the
//    heavy buildWorldForLevel + PlayScene mount runs. This is what makes
//    the transition appear *immediately* instead of letting the world map
//    sit frozen on screen for ~1s while the load blocks the main thread.
//  - Stays up through `screen === "playing"` until assets finish warming.
//  - Hidden after assets are warm AND the last deferred scene group has
//    rendered. Warm assets alone do not prevent partial first frames.
//
// The progress bar reads from the global LoadingManager subscription
// in useLevelLoadProgress — it'll show network progress for any GLBs
// that weren't yet cached at click time. Pure decorative when those
// are all cache hits.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGame } from "../store";

const FADE_MS = 220;

export const LevelLoadOverlay = () => {
  const { t } = useTranslation();
  const screen = useGame((s) => s.screen);
  const ready = useGame((s) => s.assetsPrewarmed);
  const sceneReady = useGame((s) => s.levelSceneReady);
  const pending = useGame((s) => s.levelLoadPending);
  const progress = useGame((s) => s.levelLoadProgress);

  // Active from the click (pending) through the play scene mounting, until
  // assets and the scene are ready. `pending` covers the gap before `screen` flips to
  // "playing" so the overlay paints before the heavy build, not after.
  const active = pending || (screen === "playing" && (!ready || !sceneReady));

  const [mounted, setMounted] = useState(active);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (active) {
      setMounted(true);
      setExiting(false);
    }
  }, [active]);

  useEffect(() => {
    if (!mounted) return;
    if (!active) {
      setExiting(true);
      const t = window.setTimeout(() => setMounted(false), FADE_MS);
      return () => window.clearTimeout(t);
    }
  }, [active, mounted]);

  if (!mounted) return null;

  const pct = progress && progress.total > 0 ? (progress.loaded / progress.total) * 100 : null;

  return (
    <div className={`level-load-overlay ${exiting ? "level-load-overlay-exit" : ""}`}>
      {!ready && (
        <div className="level-load-card">
          <div className="level-load-eyebrow">{t("levelLoad.eyebrow")}</div>
          <div className="level-load-bar">
            <div
              className={`level-load-bar-fill ${pct === null ? "is-indeterminate" : ""}`}
              style={pct !== null ? { width: `${pct.toFixed(1)}%` } : undefined}
            />
          </div>
          <div className="level-load-status">
            {pct === null
              ? t("levelLoad.compiling")
              : t("levelLoad.loading", { pct: Math.round(pct) })}
          </div>
        </div>
      )}
    </div>
  );
};
