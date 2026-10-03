import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  getDesktopSaveStatus,
  openDesktopSaveDirectory,
  subscribeDesktopSaveStatus,
} from "../desktopSaves";

export const DesktopSaveLocation = () => {
  const { t } = useTranslation();
  const status = useSyncExternalStore(subscribeDesktopSaveStatus, getDesktopSaveStatus);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!status.available) return null;

  const openFolder = async () => {
    setOpening(true);
    setFailed(false);
    try {
      await openDesktopSaveDirectory();
    } catch {
      setFailed(true);
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="pointer-events-auto col-span-full min-w-0 text-xs text-fg-secondary">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <div className="min-w-0 text-center">
          <span>{t("desktopSaves.folder")}</span>{" "}
          {status.directory ? (
            <span className="select-text break-all text-fg-primary">{status.directory}</span>
          ) : (
            <span>{t("desktopSaves.locating")}</span>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn--sm shrink-0"
          disabled={!status.ready || !status.directory || opening}
          onClick={() => void openFolder()}
        >
          {t("desktopSaves.openFolder")}
        </button>
      </div>
      {status.recovered && (
        <p className="mt-1 text-center" role="status">
          {t("desktopSaves.recovered")}
        </p>
      )}
      {failed && (
        <p className="mt-1 text-center text-red" role="alert">
          {t("desktopSaves.openFailed")}
        </p>
      )}
    </div>
  );
};
