import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { type GraphicsPreference, type MotionPreference, usePresentation } from "../preferences";
import { KeyboardControls } from "./KeyboardControls";

const GRAPHICS: GraphicsPreference[] = ["auto", "low", "medium", "high"];
const MOTION: MotionPreference[] = ["system", "reduced", "full"];
const TEXT_SCALES = [1, 1.15, 1.3] as const;

type Drawer = "display" | "keyboard" | null;

export const PresentationControls = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Drawer>(null);
  const displayId = useId();
  const keyboardId = useId();
  const shakeId = useId();
  const { preferences, storageFailed, update } = usePresentation();

  return (
    <div className="presentation-controls">
      <button
        type="button"
        className="settings-drawer-button"
        aria-expanded={open === "display"}
        aria-controls={displayId}
        onClick={() => setOpen(open === "display" ? null : "display")}
      >
        <span>{t("presentation.title")}</span>
        <span className="settings-drawer-chevron" aria-hidden="true" />
      </button>
      {open === "display" && (
        <section
          id={displayId}
          className="settings-drawer-panel"
          aria-label={t("presentation.title")}
        >
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
            <p className="presentation-help">
              {t(`presentation.qualityHelp.${preferences.graphics}`)}
            </p>
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
            <span className="presentation-label" id={shakeId}>
              {t("presentation.shake")}
            </span>
            <button
              type="button"
              className="presentation-switch"
              role="switch"
              aria-checked={preferences.cameraShake}
              aria-labelledby={shakeId}
              onClick={() => update({ cameraShake: !preferences.cameraShake })}
            >
              <span className="presentation-switch-thumb" />
            </button>
          </div>
          {storageFailed && (
            <p className="presentation-help" role="status">
              {t("presentation.unsaved")}
            </p>
          )}
        </section>
      )}

      <button
        type="button"
        className="settings-drawer-button"
        aria-expanded={open === "keyboard"}
        aria-controls={keyboardId}
        onClick={() => setOpen(open === "keyboard" ? null : "keyboard")}
      >
        <span>{t("keyboard.title")}</span>
        <span className="settings-drawer-chevron" aria-hidden="true" />
      </button>
      <section
        id={keyboardId}
        className="settings-drawer-panel"
        aria-label={t("keyboard.title")}
        hidden={open !== "keyboard"}
      >
        <KeyboardControls />
      </section>
    </div>
  );
};
