import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { checkForUpdate, installUpdate, isTauriShell, type UpdateInfo } from "../updater";

// The check is a network round trip plus a signature parse, and it competes
// with shader compilation and model loading for the same main thread. So it
// waits: this component is mounted only once the player is past the splash and
// slot screens (see App.tsx), and then it still sits out a delay and asks for
// an idle callback on top. An update the player learns about twelve seconds
// late costs nothing; a hitched first frame is the thing people remember.
const CHECK_DELAY_MS = 12_000;
const IDLE_TIMEOUT_MS = 5_000;

// One check per app run, not per mount — returning to the splash screen
// unmounts this component and would otherwise re-ask on the way back.
let checkedThisSession = false;

type Phase = "hidden" | "available" | "installing" | "failed";

/**
 * Desktop-only "an update is ready" card. Renders nothing on the web build,
 * inside the Capacitor shells, in a Steam install, or in any Tauri build made
 * without the `updater` cargo feature — see src/updater.ts for how each of
 * those collapses into "no update".
 */
export const UpdateNotice = () => {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("hidden");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [pct, setPct] = useState<number | null>(null);

  useEffect(() => {
    if (!isTauriShell() || checkedThisSession) return;

    let cancelled = false;
    let idleHandle: number | null = null;

    const run = () => {
      checkedThisSession = true;
      void checkForUpdate().then((update) => {
        if (cancelled || !update) return;
        setInfo(update);
        setPhase("available");
      });
    };

    const delay = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        idleHandle = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
      } else {
        run();
      }
    }, CHECK_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(delay);
      if (idleHandle !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleHandle);
      }
    };
  }, []);

  if (phase === "hidden" || !info) return null;

  const install = () => {
    setPhase("installing");
    setPct(0);
    void installUpdate(({ downloaded, total }) => {
      setPct(total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null);
    }).then((ok) => {
      // Only reached when the install did not happen — on success the process
      // is already gone.
      if (!ok) setPhase("failed");
    });
  };

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[45] flex justify-end">
      <div
        className="overlay-card pointer-events-auto w-[min(100%,320px)] min-w-0 p-4 text-left"
        role="status"
        aria-live="polite"
      >
        <div className="text-[10px] font-bold tracking-[0.18em] text-cyan uppercase">
          {t("update.eyebrow")}
        </div>
        <div className="mt-1 text-[17px] font-bold">
          {t("update.title", { version: info.version })}
        </div>

        <div className="mt-1.5 text-[12px] text-fg-muted">
          {phase === "failed"
            ? t("update.failed")
            : phase === "installing"
              ? pct === null
                ? t("update.downloading")
                : t("update.downloadingPct", { pct })
              : t("update.body")}
        </div>

        {phase !== "installing" && (
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn-ghost btn--sm" onClick={() => setPhase("hidden")}>
              {t("update.later")}
            </button>
            <button type="button" className="btn btn--sm" onClick={install}>
              {phase === "failed" ? t("update.retry") : t("update.install")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
