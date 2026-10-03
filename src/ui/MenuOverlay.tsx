import type React from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useModalFocus } from "./useModalFocus";

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
  const titleId = useId();
  const dialogRef = useModalFocus(onClose);

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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`overlay-card menu-overlay-card relative min-w-[440px] pt-7 px-8 pb-6 text-left ${cardClassName}`}
      >
        <div className={`menu-overlay-header ${headerLeading ? "has-leading" : ""}`}>
          <div className="menu-overlay-leading">{headerLeading}</div>
          <div className="menu-overlay-title-group">
            <h1 id={titleId} className="menu-overlay-title text-center mb-1">
              {title}
            </h1>
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
