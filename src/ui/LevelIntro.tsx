import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { hasLevelInterstitial } from "../levels/briefings";
import { useGame } from "../store";
import { activeModal, isActivationKey } from "./modalFocus";
import { useInputMode } from "./useInputMode";
import { useModalFocus } from "./useModalFocus";

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

  const dialogRef = useModalFocus(undefined, !!report);
  useEffect(() => {
    if (!report) return;
    const onKey = (event: KeyboardEvent) => {
      if (activeModal() !== dialogRef.current || !isActivationKey(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      beginDefense();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [report, beginDefense, dialogRef]);

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
      <button
        type="button"
        className="absolute inset-0"
        tabIndex={-1}
        aria-label={t("levelIntro.beginDefense")}
        onClick={beginDefense}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("levelIntro.eyebrow", { id: levelId })}
        tabIndex={-1}
        className="level-intro-card relative"
      >
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
