import { useId } from "react";
import { useTranslation } from "react-i18next";
import { type GraphicsPreference, type MotionPreference, usePresentation } from "../preferences";
import { KeyboardControls } from "./KeyboardControls";

export const PresentationControls = () => {
  const titleId = useId();
  const { t } = useTranslation();
  const { preferences, storageFailed, update } = usePresentation();
  return (
    <section className="settings-section presentation-controls" aria-labelledby={titleId}>
      <h2 id={titleId}>{t("presentation.title")}</h2>
      <label>
        <span>{t("presentation.graphics")}</span>
        <select
          value={preferences.graphics}
          onChange={(e) => update({ graphics: e.target.value as GraphicsPreference })}
        >
          {(["auto", "low", "medium", "high"] as const).map((value) => (
            <option key={value} value={value}>
              {t(`presentation.quality.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <p>{t(`presentation.qualityHelp.${preferences.graphics}`)}</p>
      <label>
        <span>{t("presentation.textSize")}</span>
        <select
          value={preferences.textScale}
          onChange={(e) => update({ textScale: Number(e.target.value) as 1 | 1.15 | 1.3 })}
        >
          <option value={1}>100%</option>
          <option value={1.15}>115%</option>
          <option value={1.3}>130%</option>
        </select>
      </label>
      <label>
        <span>{t("presentation.motion")}</span>
        <select
          value={preferences.motion}
          onChange={(e) => update({ motion: e.target.value as MotionPreference })}
        >
          {(["system", "reduced", "full"] as const).map((value) => (
            <option key={value} value={value}>
              {t(`presentation.motionChoice.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t("presentation.shake")}</span>
        <input
          type="checkbox"
          checked={preferences.cameraShake}
          onChange={(e) => update({ cameraShake: e.target.checked })}
        />
      </label>
      <p>{t("presentation.motionHelp")}</p>
      <KeyboardControls />
      {storageFailed && <p role="status">{t("presentation.unsaved")}</p>}
    </section>
  );
};
