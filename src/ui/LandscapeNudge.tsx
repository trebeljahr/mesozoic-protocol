import { useTranslation } from "react-i18next";
import { useIsMobile, useIsPortrait } from "./useMediaQuery";
import { useModalFocus } from "./useModalFocus";

// The rotate prompt owns input above every other dialog. Session interruption
// tracking uses these same media queries and requires explicit resume on return.
export const LandscapeNudge = () => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const isPortrait = useIsPortrait();
  const dialogRef = useModalFocus(undefined, isMobile && isPortrait, 100);
  if (!isMobile || !isPortrait) return null;
  return (
    <div>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("landscape.title")}
        tabIndex={-1}
        className="fixed inset-0 z-[100] bg-[rgba(8,12,18,0.94)] flex flex-col items-center justify-center text-center px-8 backdrop-blur-md"
      >
        <div className="text-[64px] mb-6 animate-[rotateNudge_2.4s_ease-in-out_infinite]">
          <RotateGlyph />
        </div>
        <div className="font-display text-[22px] font-bold tracking-[0.04em] text-white mb-2">
          {t("landscape.title")}
        </div>
        <div className="text-[13px] text-fg-muted leading-[1.5] max-w-[280px]">
          {t("landscape.body")}
        </div>
      </div>
    </div>
  );
};

const RotateGlyph = () => {
  const { t } = useTranslation();
  return (
    // Inline SVG so we don't ship an extra asset for a single icon.
    // Stylized phone with a rotation arc — keeps tone consistent with
    // the sci-fi UI (no emoji, no emoji-flavored color).
    <svg
      width="84"
      height="84"
      viewBox="0 0 84 84"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <title>{t("landscape.glyphTitle")}</title>
      <rect
        x="22"
        y="6"
        width="32"
        height="56"
        rx="5"
        stroke="#9fd8ff"
        strokeWidth="2.5"
        transform="rotate(-30 38 34)"
      />
      <path
        d="M14 64 Q 42 80 70 64"
        stroke="#ffd66a"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M70 64 L 64 60 M 70 64 L 66 70"
        stroke="#ffd66a"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
};
