import { useId } from "react";
import { useTranslation } from "react-i18next";
import { type GraphicsPreference, type MotionPreference, usePresentation } from "../preferences";
import { KeyboardControls } from "./KeyboardControls";

const GRAPHICS: GraphicsPreference[] = ["auto", "low", "medium", "high"];
const MOTION: MotionPreference[] = ["system", "reduced", "full"];
const TEXT_SCALES = [1, 1.15, 1.3] as const;

export const PresentationControls = () => {
  const titleId = useId();
  const { t } = useTranslation();
  const { preferences, storageFailed, update } = usePresentation();

  return (
    <section className="settings-section presentation-controls" aria-labelledby={titleId}>
      <h2 id={titleId} className="presentation-title">
        {t("presentation.title")}
      </h2>

      <fieldset className="presentation-setting">
        <legend className="presentation-label">{t("presentation.graphics")}</legend>
        <div className="presentation-options">
          {GRAPHICS.map((value) => (
            <button
              key={value}
              type="button"
              className="presentation-option"
              aria-pressed={preferences.graphics === value}
              onClick={() => update({ graphics: value })}
            >
              {t(`presentation.quality.${value}`)}
            </button>
          ))}
        </div>
        <p className="presentation-help">{t(`presentation.qualityHelp.${preferences.graphics}`)}</p>
      </fieldset>

      <fieldset className="presentation-setting">
        <legend className="presentation-label">{t("presentation.textSize")}</legend>
        <div className="presentation-options">
          {TEXT_SCALES.map((value) => (
            <button
              key={value}
              type="button"
              className="presentation-option"
              aria-pressed={preferences.textScale === value}
              onClick={() => update({ textScale: value })}
            >
              {Math.round(value * 100)}%
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="presentation-setting">
        <legend className="presentation-label">{t("presentation.motion")}</legend>
        <div className="presentation-options">
          {MOTION.map((value) => (
            <button
              key={value}
              type="button"
              className="presentation-option"
              aria-pressed={preferences.motion === value}
              onClick={() => update({ motion: value })}
            >
              {t(`presentation.motionChoice.${value}`)}
            </button>
          ))}
        </div>
        <p className="presentation-help">{t("presentation.motionHelp")}</p>
      </fieldset>

      <div className="presentation-setting presentation-setting--switch">
        <span className="presentation-label" id={`${titleId}-shake`}>
          {t("presentation.shake")}
        </span>
        <button
          type="button"
          className="presentation-switch"
          role="switch"
          aria-checked={preferences.cameraShake}
          aria-labelledby={`${titleId}-shake`}
          onClick={() => update({ cameraShake: !preferences.cameraShake })}
        >
          <span className="presentation-switch-thumb" />
        </button>
      </div>

      <KeyboardControls />
      {storageFailed && (
        <p className="presentation-help" role="status">
          {t("presentation.unsaved")}
        </p>
      )}
    </section>
  );
};
