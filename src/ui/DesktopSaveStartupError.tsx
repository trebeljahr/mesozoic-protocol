import { useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  closeDesktopWithoutSaving,
  getDesktopSaveStatus,
  openDesktopSaveDirectory,
  subscribeDesktopSaveStatus,
} from "../desktopSaves";

// This screen must not import App, the game store, progress, or any component
// that reads campaign data before the desktop restore has succeeded.
export const DesktopSaveStartupError = ({ onRetry }: { onRetry: () => Promise<void> }) => {
  const { t } = useTranslation();
  const status = useSyncExternalStore(subscribeDesktopSaveStatus, getDesktopSaveStatus);
  const [action, setAction] = useState<"retry" | "open" | "quit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const run = async (next: "retry" | "open" | "quit") => {
    if (busy.current) return;
    busy.current = true;
    setAction(next);
    setError(null);
    try {
      if (next === "retry") await onRetry();
      else if (next === "open") await openDesktopSaveDirectory();
      else await closeDesktopWithoutSaving();
    } catch {
      setError(
        t(
          `desktopSaves.startup${next === "open" ? "Open" : next === "quit" ? "Quit" : "Retry"}Failed`,
        ),
      );
    } finally {
      busy.current = false;
      setAction(null);
    }
  };

  return (
    <main className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-surface-1 p-6 text-fg-primary">
      <section className="max-w-lg space-y-4" aria-labelledby="desktop-save-startup-title">
        <h1 id="desktop-save-startup-title" className="text-2xl">
          {t("desktopSaves.startupTitle")}
        </h1>
        <p>{t("desktopSaves.startupBody")}</p>
        {status.directory && (
          <p className="text-sm text-fg-secondary">
            {t("desktopSaves.folder")}{" "}
            <span className="select-text break-all text-fg-primary">{status.directory}</span>
          </p>
        )}
        <div className="flex flex-wrap gap-3" aria-busy={action !== null}>
          <button
            type="button"
            className="btn"
            disabled={action !== null}
            onClick={() => void run("retry")}
          >
            {t(action === "retry" ? "desktopSaves.retrying" : "desktopSaves.retry")}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={action !== null}
            onClick={() => void run("open")}
          >
            {t("desktopSaves.openFolder")}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={action !== null}
            onClick={() => void run("quit")}
          >
            {t("desktopSaves.quit")}
          </button>
        </div>
        {action !== null && (
          <p className="text-sm text-fg-secondary" role="status">
            {t(
              action === "retry"
                ? "desktopSaves.retrying"
                : action === "open"
                  ? "desktopSaves.opening"
                  : "desktopSaves.quitting",
            )}
          </p>
        )}
        {error && (
          <p className="text-sm text-red" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
};
