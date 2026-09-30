import type React from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  title: string;
  subtitle?: string | null;
  onClose: () => void;
  closeLabel?: string;
  closeTitle?: string;
  headerLeading?: React.ReactNode;
  overlayClassName?: string;
  // Extra classes appended to the card. Use `!w-…` to override the
  // default 560px max-width when a wider modal is needed.
  cardClassName?: string;
  children: React.ReactNode;
};

export const MenuOverlay = ({
  title,
  subtitle,
  onClose,
  closeLabel,
  closeTitle,
  headerLeading,
  overlayClassName = "",
  cardClassName = "",
  children,
}: Props) => {
  const { t } = useTranslation();
  const resolvedCloseLabel = closeLabel ?? t("common.close");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      // Capture-phase + stopImmediatePropagation: the HUD also listens on
      // window for Escape→togglePause, which would fight this handler and
      // re-pause the game on the same key event. Eat the event here so
      // the modal owns Escape while it's open.
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: intentional —
       the backdrop is a click target for "click-outside-to-close". The
       card inside is the interactive region with focusable controls. */
    <div
      className={`overlay menu-overlay ${overlayClassName}`}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`overlay-card menu-overlay-card relative min-w-[440px] pt-7 px-8 pb-6 text-left ${cardClassName}`}
      >
        <div className={`menu-overlay-header ${headerLeading ? "has-leading" : ""}`}>
          <div className="menu-overlay-leading">{headerLeading}</div>
          <div className="menu-overlay-title-group">
            <h1 className="menu-overlay-title text-center mb-1">{title}</h1>
            {subtitle && (
              <div className="menu-overlay-subtitle text-center text-xs tracking-[0.22em] uppercase text-fg-dim mb-[18px]">
                {subtitle}
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn-close menu-overlay-close"
            onClick={onClose}
            title={closeTitle ?? resolvedCloseLabel}
            aria-label={resolvedCloseLabel}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};
