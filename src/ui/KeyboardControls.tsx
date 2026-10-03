import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BINDING_ACTIONS,
  type BindingAction,
  keyLabel,
  useKeyBindings,
} from "../input/keyBindings";
import { TOWER_LABEL } from "../sim/world";

export const KeyboardControls = () => {
  const { t } = useTranslation();
  const { bindings, bind, reset, storageFailed } = useKeyBindings();
  const [listening, setListening] = useState<BindingAction | null>(null);
  const [error, setError] = useState<"invalid" | "conflict" | null>(null);
  return (
    <div className="keyboard-controls">
      <p>{t("keyboard.help")}</p>
      <fieldset>
        {BINDING_ACTIONS.map((action) => {
          const label =
            action in TOWER_LABEL
              ? TOWER_LABEL[action as keyof typeof TOWER_LABEL]
              : t(`keyboard.action.${action}`);
          return (
            <label key={action}>
              <span>{label}</span>
              <button
                type="button"
                className="btn btn-ghost btn--sm"
                aria-label={t("keyboard.change", {
                  action: label,
                  key: keyLabel(bindings[action]),
                })}
                aria-pressed={listening === action}
                onClick={() => {
                  setListening(listening === action ? null : action);
                  setError(null);
                }}
                onBlur={() => setListening(null)}
                onKeyDown={(event) => {
                  if (listening !== action || event.key === "Tab") return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;
                  const result = bind(action, event.code);
                  setError(result);
                  if (!result) setListening(null);
                }}
              >
                {listening === action ? t("keyboard.press") : keyLabel(bindings[action])}
              </button>
            </label>
          );
        })}
      </fieldset>
      {error && <p role="alert">{t(`keyboard.${error}`)}</p>}
      {storageFailed && <p role="status">{t("presentation.unsaved")}</p>}
      <button
        type="button"
        className="btn btn-secondary btn--sm"
        onClick={() => {
          reset();
          setListening(null);
          setError(null);
        }}
      >
        {t("keyboard.reset")}
      </button>
    </div>
  );
};
