import type { TFunction } from "i18next";
import { useEffect, useLayoutEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { audio } from "../audio/AudioManager";
import { getLevel, levelHasMode, resolveLevelMode } from "../levels";
import { getModeStars, isModeUnlocked, LEVEL_MODES, type LevelMode } from "../progress";
import { TOWER_LABEL } from "../sim/world";
import { useGame } from "../store";

const MODE_ACCENT: Record<LevelMode, { text: string; border: string; tint: string }> = {
  normal: { text: "text-blue", border: "border-blue", tint: "bg-tint-blue" },
  breach: { text: "text-orange", border: "border-orange", tint: "bg-[rgba(255,178,102,0.12)]" },
  containment: { text: "text-red", border: "border-red", tint: "bg-tint-red" },
};

const MODE_GLOW: Record<LevelMode, string> = {
  normal: "shadow-[0_0_24px_rgba(159,216,255,0.22)]",
  breach: "shadow-[0_0_24px_rgba(255,178,102,0.26)]",
  containment: "shadow-[0_0_28px_rgba(255,90,122,0.30)]",
};

const MODE_ICON: Record<LevelMode, string> = {
  normal: "◆",
  breach: "✦",
  containment: "▣",
};

export const ModePicker = () => {
  const { t } = useTranslation();
  const levelId = useGame((s) => s.modePickerLevelId);
  const progress = useGame((s) => s.progress);
  const startLevel = useGame((s) => s.startLevel);
  const close = useGame((s) => s.closeModePicker);

  // The tap/click that OPENS this picker (a level node uses onPointerDown)
  // emits a trailing synthetic `click` after the overlay has already
  // mounted. On touch — and on desktop when the node sat under the cursor —
  // that click lands on whichever mode button is now beneath the pointer and
  // launches the level instantly, skipping the choice. Swallow exactly that
  // ghost click: it is the only `click` that can fire before any pointerdown/
  // keydown reaches the freshly-mounted overlay. A real activation always
  // starts with one of those, which disarms the guard. Layout effect so the
  // listeners attach during the same discrete-event flush, before the browser
  // dispatches the trailing click.
  useLayoutEffect(() => {
    let armed = true;
    const disarm = () => {
      armed = false;
    };
    const swallowGhostClick = (e: MouseEvent) => {
      if (!armed) return;
      armed = false;
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("pointerdown", disarm, true);
    window.addEventListener("keydown", disarm, true);
    window.addEventListener("click", swallowGhostClick, true);
    return () => {
      window.removeEventListener("pointerdown", disarm, true);
      window.removeEventListener("keydown", disarm, true);
      window.removeEventListener("click", swallowGhostClick, true);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  const level = useMemo(() => (levelId !== null ? getLevel(levelId) : null), [levelId]);
  if (!level) return null;

  const modeStars = getModeStars(progress, level.id);

  return (
    <div className="overlay achievements-overlay">
      <div className="achievements-card">
        <header className="achievements-header">
          <div>
            <h1>{t(`levels:names.${level.id}`)}</h1>
            <div className="achievements-subtitle">{t("modePicker.subtitle")}</div>
          </div>
          <button
            type="button"
            className="btn-close"
            onClick={close}
            aria-label={t("modePicker.close")}
            title={t("modePicker.close")}
          >
            ×
          </button>
        </header>

        <div className="grid grid-cols-3 gap-2 p-3 sm:gap-3 sm:p-5 overflow-y-auto">
          {LEVEL_MODES.map((mode) => {
            const defined = levelHasMode(level, mode);
            const unlocked = isModeUnlocked(progress, level.id, mode);
            const available = defined && unlocked;
            const cleared =
              mode === "normal" ? modeStars.normal === 3 : (modeStars[mode] as number) >= 1;
            // Status pill: Standard only flags a full 3-star clear; the
            // challenge modes surface all three states so the player can
            // tell locked from open from beaten without reading the hint.
            const status: "cleared" | "unlocked" | "locked" | null =
              mode === "normal"
                ? cleared
                  ? "cleared"
                  : null
                : !defined
                  ? null
                  : cleared
                    ? "cleared"
                    : unlocked
                      ? "unlocked"
                      : "locked";
            const accent = MODE_ACCENT[mode];
            const cfg = resolveLevelMode(level, mode);
            const restrictions = describeMode(mode, level, cfg, t);
            return (
              <button
                key={mode}
                type="button"
                disabled={!available}
                onClick={() => {
                  if (!available) return;
                  audio.ui("select");
                  startLevel(level.id, mode);
                }}
                className={`relative flex flex-col items-stretch text-left gap-2 p-3 sm:p-4 rounded-lg border bg-surface-1 transition-all ${
                  available
                    ? `${accent.border} ${MODE_GLOW[mode]} cursor-pointer hover:brightness-110`
                    : "border-border-faint opacity-50 cursor-not-allowed"
                }`}
                aria-disabled={!available}
              >
                {status && (
                  <span
                    className={`absolute top-1 right-1 sm:top-2 sm:right-2 text-[9px] font-bold tracking-wide uppercase ${
                      status === "locked" ? "text-fg-dim" : accent.text
                    }`}
                  >
                    {status === "cleared"
                      ? `✓ ${t("modePicker.cleared")}`
                      : t(`modePicker.${status}`)}
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <span className={`text-2xl ${accent.text}`} aria-hidden>
                    {MODE_ICON[mode]}
                  </span>
                  <span className={`text-base font-bold ${accent.text} tracking-mid`}>
                    {t(`modes:mode.label.${mode}`)}
                  </span>
                </div>
                <div className="text-[11px] text-fg-muted leading-snug min-h-[28px]">
                  {t(`modes:mode.tagline.${mode}`)}
                </div>
                <ul className="flex flex-col gap-1 text-[11px] text-fg border-t border-border-faint pt-2 mt-1 tabular-nums">
                  <Row label={t("modePicker.startGold")} value={`${cfg.startGold}g`} />
                  <Row label={t("common.waves")} value={String(cfg.waves.length)} />
                  {restrictions.map((r) => (
                    <Row key={r.label} label={r.label} value={r.value} />
                  ))}
                </ul>
                {!defined && (
                  <div className="text-[10px] text-fg-dim italic">{t("modePicker.comingSoon")}</div>
                )}
                {defined && !unlocked && (
                  <div className="text-[10px] text-fg-dim italic">{t("modePicker.unlockHint")}</div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <li className="flex justify-between">
    <span className="text-fg-muted">{label}</span>
    <span className="text-fg font-semibold">{value}</span>
  </li>
);

// Human-readable summary of the mode's rules. Reads the resolved
// ModeConfig directly so it stays accurate even if levels override
// defaults in unusual ways (e.g. containment with a 2-tower locked loadout).
const describeMode = (
  mode: LevelMode,
  _level: { id: number; name: string },
  cfg: {
    forbiddenTowers?: readonly string[];
    lockedLoadout?: readonly string[];
    singleLife?: boolean;
    noSelling?: boolean;
  },
  t: TFunction,
): { label: string; value: string }[] => {
  const rows: { label: string; value: string }[] = [];
  if (mode === "containment") {
    rows.push({ label: t("modePicker.lives"), value: cfg.singleLife ? "1" : "20" });
    if (cfg.noSelling)
      rows.push({ label: t("modePicker.selling"), value: t("modePicker.disabled") });
  }
  if (cfg.lockedLoadout && cfg.lockedLoadout.length > 0) {
    rows.push({
      label: t("modePicker.loadout"),
      value: cfg.lockedLoadout
        .map((k) => TOWER_LABEL[k as keyof typeof TOWER_LABEL] ?? k)
        .join(", "),
    });
  }
  if (cfg.forbiddenTowers && cfg.forbiddenTowers.length > 0) {
    rows.push({
      label: t("modePicker.denied"),
      value: cfg.forbiddenTowers
        .map((k) => TOWER_LABEL[k as keyof typeof TOWER_LABEL] ?? k)
        .join(", "),
    });
  }
  return rows;
};
