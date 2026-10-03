import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { retryFailedSaves, useSaveIssues } from "../persistence/storageHealth";
import { exportSlot, importSlot, parseSaveImport, recoverSlot, type SlotInfo } from "../progress";

export const SaveHealthNotice = () => {
  const issues = useSaveIssues();
  const { t } = useTranslation();
  if (issues.length === 0) return null;
  return (
    <aside
      role="alert"
      data-modal-utility="save-health"
      className="fixed bottom-3 left-3 right-3 z-[250] rounded border border-red bg-surface-1 p-3 text-sm text-fg-primary pointer-events-auto"
    >
      <strong>{t("saveRecovery.warning")}</strong>{" "}
      <span>
        {t(
          issues.some((i) => i.reason === "native")
            ? "saveRecovery.nativeWarning"
            : "saveRecovery.warningDetail",
        )}
      </span>{" "}
      <button type="button" className="btn btn--sm" onClick={() => void retryFailedSaves()}>
        {t("saveRecovery.retry")}
      </button>
    </aside>
  );
};

export const SaveRecoveryControls = ({
  slot,
  onChange,
}: {
  slot: SlotInfo;
  onChange: () => void;
}) => {
  const { t } = useTranslation();
  const [pending, setPending] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const confirmImportButton = useRef<HTMLButtonElement>(null);
  const restoreImportFocus = useRef(false);

  useEffect(() => {
    const input = importInput.current;
    if (!input) return;
    const restoreFocus = () => importButton.current?.focus();
    input.addEventListener("cancel", restoreFocus);
    return () => input.removeEventListener("cancel", restoreFocus);
  }, []);

  useEffect(() => {
    if (pending) {
      restoreImportFocus.current = true;
      confirmImportButton.current?.focus();
    } else if (restoreImportFocus.current) {
      restoreImportFocus.current = false;
      importButton.current?.focus();
    }
  }, [pending]);

  const download = () => {
    try {
      const save = exportSlot(slot.id);
      const url = URL.createObjectURL(new Blob([save.text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = save.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setMessage(t("saveRecovery.failed"));
    }
  };
  const confirmImport = () => {
    if (!pending) return;
    try {
      if (!importSlot(slot.id, pending, slot.exists)) {
        setMessage(t("saveRecovery.failed"));
        return;
      }
      setPending(null);
      setMessage(t("saveRecovery.imported"));
      onChange();
    } catch {
      setMessage(t("saveRecovery.invalid"));
    }
  };
  return (
    <div className="mt-3 text-sm text-fg-secondary">
      <input
        ref={importInput}
        hidden
        className="hidden"
        tabIndex={-1}
        type="file"
        accept=".json,application/json"
        aria-label={t("saveRecovery.importTo", { id: slot.id })}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) {
            importButton.current?.focus();
            return;
          }
          try {
            if (file.size > 10_000_000) throw new Error("Save too large");
            const text = await file.text();
            parseSaveImport(text);
            setPending(text);
            setMessage(null);
          } catch {
            setMessage(t("saveRecovery.invalid"));
            importButton.current?.focus();
          }
        }}
      />
      {slot.health === "corrupt" && <p role="status">{t("saveRecovery.corrupt")}</p>}
      {slot.health === "unavailable" && <p role="status">{t("saveRecovery.unavailable")}</p>}
      {slot.checkpoint && <p>{t("saveRecovery.checkpoint")}</p>}
      {message && <p role="status">{message}</p>}
      {pending ? (
        <div>
          <p>
            {t(slot.exists ? "saveRecovery.overwrite" : "saveRecovery.destination", {
              id: slot.id,
            })}
          </p>
          <button
            ref={confirmImportButton}
            type="button"
            className="btn btn--sm"
            onClick={confirmImport}
          >
            {t("saveRecovery.confirmImport")}
          </button>{" "}
          <button type="button" className="btn btn-ghost btn--sm" onClick={() => setPending(null)}>
            {t("saveSlots.cancel")}
          </button>
        </div>
      ) : recovering ? (
        <div>
          <p>{t("saveRecovery.recoveryConfirm")}</p>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              if (recoverSlot(slot.id)) {
                setRecovering(false);
                onChange();
              } else setMessage(t("saveRecovery.failed"));
            }}
          >
            {t("saveRecovery.recover")}
          </button>{" "}
          <button
            type="button"
            className="btn btn-ghost btn--sm"
            onClick={() => setRecovering(false)}
          >
            {t("saveSlots.cancel")}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {slot.exists && slot.health !== "unavailable" && (
            <button type="button" className="btn btn-ghost btn--sm" onClick={download}>
              {t("saveRecovery.export")}
            </button>
          )}
          <button
            ref={importButton}
            type="button"
            className="btn btn-ghost btn--sm"
            aria-label={t("saveRecovery.importTo", { id: slot.id })}
            onClick={() => importInput.current?.click()}
          >
            {t("saveRecovery.import")}
          </button>
          {slot.health === "corrupt" && slot.recoverable && (
            <button type="button" className="btn btn--sm" onClick={() => setRecovering(true)}>
              {t("saveRecovery.recover")}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
