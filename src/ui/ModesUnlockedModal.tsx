import { useTranslation } from "react-i18next";
import { useGame } from "../store";
import { MenuOverlay } from "./MenuOverlay";

const MODE_ACCENT = {
  breach: { text: "text-orange", border: "border-orange", tint: "bg-[rgba(255,178,102,0.10)]" },
  containment: { text: "text-red", border: "border-red", tint: "bg-tint-red" },
} as const;

const MODE_ICON = { breach: "✦", containment: "▣" } as const;

const MODE_DETAIL_KEY: Record<"breach" | "containment", string> = {
  breach: "modesUnlocked.detailBreach",
  containment: "modesUnlocked.detailContainment",
};

export const ModesUnlockedModal = () => {
  const { t } = useTranslation();
  const dismiss = useGame((s) => s.dismissModesUnlockedExplainer);

  return (
    <MenuOverlay
      title={t("modesUnlocked.title")}
      subtitle={t("modesUnlocked.subtitle")}
      onClose={dismiss}
      closeLabel={t("modesUnlocked.close")}
      cardClassName="!max-w-[640px]"
    >
      <p className="text-[13px] leading-snug text-fg-muted mb-4">{t("modesUnlocked.body")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(["breach", "containment"] as const).map((mode) => {
          const accent = MODE_ACCENT[mode];
          return (
            <div
              key={mode}
              className={`relative flex flex-col gap-2 p-4 rounded-lg border bg-surface-1 ${accent.border} ${accent.tint}`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-2xl ${accent.text}`} aria-hidden>
                  {MODE_ICON[mode]}
                </span>
                <span className={`text-base font-bold ${accent.text} tracking-mid`}>
                  {t(`modes:mode.label.${mode}`)}
                </span>
              </div>
              <div className="text-[11px] text-fg-muted leading-snug italic">
                {t(`modes:mode.tagline.${mode}`)}
              </div>
              <p className="text-[12px] leading-snug text-fg">{t(MODE_DETAIL_KEY[mode])}</p>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end mt-5">
        <button type="button" className="btn btn-primary" onClick={dismiss}>
          {t("modesUnlocked.close")}
        </button>
      </div>
    </MenuOverlay>
  );
};
