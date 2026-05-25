import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HIVE_MAX_DRONES_PER_TOWER } from "../sim/world";
import { useGame } from "../store";

const SHOW_SEC = 2.8;

// Transient reason banner for rejected hive-drone assignments. Listens
// for drone-assign-failed events (the error sound is handled separately
// by the audio bridge) and explains why the pick didn't take, so the
// rejection isn't a silent no-op. Self-clears after a few seconds.
export const DroneAssignNotice = () => {
  const { t } = useTranslation();
  const onEvent = useGame((s) => s.onEvent);
  // key bumps on every event so re-clicking an invalid tower restarts
  // the timer + entry animation instead of sitting stale.
  const [notice, setNotice] = useState<{ text: string; key: number } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let seq = 0;
    const unsub = onEvent((e) => {
      if (e.type !== "drone-assign-failed") return;
      const text =
        e.reason === "full"
          ? t("hiveDrone.failFull", { max: HIVE_MAX_DRONES_PER_TOWER })
          : t("hiveDrone.failUnsupported");
      setNotice({ text, key: ++seq });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setNotice(null), SHOW_SEC * 1000);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [onEvent, t]);

  if (!notice) return null;
  return (
    <div className="drone-assign-notice-overlay" aria-live="polite">
      <div key={notice.key} className="drone-assign-notice-card">
        {notice.text}
      </div>
    </div>
  );
};
