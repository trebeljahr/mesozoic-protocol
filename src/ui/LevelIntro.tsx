import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { hasLevelInterstitial } from "../levels/briefings";
import { useGame } from "../store";
import { useInputMode } from "./useInputMode";

const FADE_MS = 220;

export const LevelIntro = () => {
  const { t } = useTranslation();
  const levelId = useGame((s) => s.selectedLevelId);
  const dismiss = useGame((s) => s.dismissLevelIntro);
  const [exiting, setExiting] = useState(false);
  const input = useInputMode();

  const exitingRef = useRef(false);
  const aliveRef = useRef(true);

  // One field report per level: the long-form text. Levels without a long
  // version fall back to the terse briefing (also used by the world-map tooltip).
  const hasLong = levelId !== null && hasLevelInterstitial(levelId);
  const briefing = levelId !== null ? t(`levels:briefings.${levelId}`, { defaultValue: "" }) : "";
  const report = hasLong ? t(`levels:interstitials.${levelId}`) : briefing;

  const beginDefense = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setExiting(true);
    setTimeout(() => {
      if (aliveRef.current) dismiss();
    }, FADE_MS);
  }, [dismiss]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Dismiss only on an explicit signal: any key (gamepad confirm arrives
  // as a synthetic keydown), or a tap on the backdrop outside the card.
  // Taps and scroll gestures *on* the card never dismiss — otherwise the
  // first touch a player makes to scroll a long briefing would skip it.
  // The "Begin defense" button starts the level from the card itself. A
  // scroll gesture does not fire `click`, so dragging to read is safe.
  useEffect(() => {
    if (!report) return;

    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
      beginDefense();
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest(".quick-settings")) return;
      if (target?.closest(".level-intro-card")) return;
      beginDefense();
    };

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("click", onClick, true);

    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("click", onClick, true);
    };
  }, [report, beginDefense]);

  if (!report) return null;

  const hint =
    input.mode === "gamepad"
      ? t("levelIntro.hintGamepad")
      : input.mode === "keyboard" && !input.touchPrimary
        ? t("levelIntro.hintKeyboard")
        : hasLong
          ? t("levelIntro.hintTouchScroll")
          : t("levelIntro.hintTouch");

  return (
    <div className={`level-intro-overlay ${exiting ? "level-intro-exit" : ""}`}>
      <div className="level-intro-card">
        <div className="level-intro-eyebrow">{t("levelIntro.eyebrow", { id: levelId })}</div>
        <p className="level-intro-text">{report}</p>
        <button
          type="button"
          className="level-intro-begin"
          onClick={(e) => {
            e.stopPropagation();
            beginDefense();
          }}
        >
          {t("levelIntro.beginDefense")}
        </button>
        <div className="level-intro-hint">{hint}</div>
      </div>
    </div>
  );
};
