import type { FC, ReactNode } from "react";

export type MenuIconProps = {
  size?: number;
  className?: string;
};

type SvgProps = MenuIconProps & {
  label: string;
  children: ReactNode;
};

const Svg: FC<SvgProps> = ({ size = 18, className, label, children }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    role="img"
    aria-label={label}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <title>{label}</title>
    {children}
  </svg>
);

export const IconLab: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Lab">
    <path d="M9 3h6" />
    <path d="M10 3v6.2L5.4 17.5A2 2 0 0 0 7.1 20.5h9.8a2 2 0 0 0 1.7-3L14 9.2V3" />
    <path d="M7.6 14h8.8" />
    <circle cx="11" cy="16.5" r="0.7" fill="currentColor" stroke="none" />
    <circle cx="14" cy="17.5" r="0.5" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconBook: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Compendium">
    <path d="M4 4.5h6.5a2.5 2.5 0 0 1 2.5 2.5v13" />
    <path d="M20 4.5h-6.5A2.5 2.5 0 0 0 11 7v13" />
    <path d="M4 4.5v13.5h6.5A2.5 2.5 0 0 1 13 20.5" />
    <path d="M20 4.5v13.5h-6.5A2.5 2.5 0 0 0 11 20.5" />
  </Svg>
);

export const IconTrophy: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Achievements">
    <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" />
    <path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11" />
    <path d="M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11" />
    <path d="M9.5 13.5h5l-.5 3h-4l-.5-3Z" />
    <path d="M8 19.5h8" />
    <path d="M10 16.5v3M14 16.5v3" />
  </Svg>
);

export const IconCoin: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Credits">
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="5.5" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconCog: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Settings">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </Svg>
);

export const IconGlobe: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Language">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3c2.5 2.4 3.8 5.6 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.6-3.8-9s1.3-6.6 3.8-9Z" />
  </Svg>
);

export const IconSquad: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Pilot roster">
    <circle cx="12" cy="7.5" r="2.8" />
    <path d="M6 19.5a6 6 0 0 1 12 0" />
    <circle cx="5" cy="9.5" r="2" />
    <path d="M2 18a4.5 4.5 0 0 1 3.5-4.4" />
    <circle cx="19" cy="9.5" r="2" />
    <path d="M22 18a4.5 4.5 0 0 0-3.5-4.4" />
  </Svg>
);

export const IconShield: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Vitality">
    <path d="M12 3 4.5 6v6.5c0 4.4 3.1 7.4 7.5 8.5 4.4-1.1 7.5-4.1 7.5-8.5V6L12 3Z" />
    <path d="M9.2 12.5l2 2 3.6-4" />
  </Svg>
);

export const IconCrosshair: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Firepower">
    <circle cx="12" cy="12" r="7" />
    <path d="M12 3v3.5" />
    <path d="M12 17.5V21" />
    <path d="M3 12h3.5" />
    <path d="M17.5 12H21" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconBoot: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Mobility">
    <path d="M5 13l5-9 3 1.5-1 5h4l3 4.5v3.5a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 18.5V13Z" />
    <path d="M9 17h2M13 17h2" />
  </Svg>
);

export const IconCore: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Ultimate">
    <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />
  </Svg>
);

export const IconScroll: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Lore">
    <path d="M6 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6" />
    <path d="M6 4a2.5 2.5 0 0 0-2.5 2.5V8a2.5 2.5 0 0 0 2.5 2.5" />
    <path d="M9 9h6" />
    <path d="M9 12h6" />
    <path d="M9 15h4" />
  </Svg>
);

export const IconStar: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Star">
    <path
      d="M12 2.5 L14.9 8.9 L22 9.8 L16.7 14.6 L18.1 21.5 L12 17.9 L5.9 21.5 L7.3 14.6 L2 9.8 L9.1 8.9 Z"
      fill="currentColor"
      stroke="none"
    />
  </Svg>
);

export const IconLock: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Lock">
    <rect x="5.5" y="10" width="13" height="10" rx="2" />
    <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
    <path d="M12 14v2" />
  </Svg>
);

export const IconUnlock: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Unlocked">
    <rect x="5.5" y="10" width="13" height="10" rx="2" />
    <path d="M8.5 10V7.5a3.5 3.5 0 0 1 6.4-2" />
    <path d="M12 14v2" />
  </Svg>
);

export const IconBolt: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Bolts">
    <path d="M8 4.5h8l4 7-4 7H8l-4-7 4-7Z" />
    <circle cx="12" cy="11.5" r="2.8" />
    <path d="M5 11.5H2.8" />
    <path d="M21.2 11.5H19" />
    <path d="M6.9 6.6 5.5 5.2" />
    <path d="M18.5 17.8 17.1 16.4" />
  </Svg>
);

export const IconSpeakerMute: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Sound muted">
    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z" />
    <path d="M16 9.5l5 5" />
    <path d="M21 9.5l-5 5" />
  </Svg>
);

export const IconFullscreen: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Enter fullscreen">
    <path d="M4 9V4h5" />
    <path d="M15 4h5v5" />
    <path d="M20 15v5h-5" />
    <path d="M9 20H4v-5" />
  </Svg>
);

export const IconFullscreenExit: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Exit fullscreen">
    <path d="M9 4v5H4" />
    <path d="M20 9h-5V4" />
    <path d="M15 20v-5h5" />
    <path d="M4 15h5v5" />
  </Svg>
);

export const IconFloppy: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Save slot">
    <path d="M5 4.5h11.5L19.5 7.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5Z" />
    <path d="M8 4.5h7v4H8z" />
    <rect x="7.5" y="12.5" width="9" height="6.5" rx="0.5" />
    <path d="M9.5 14.5h5" />
    <path d="M9.5 16.5h5" />
  </Svg>
);

export const IconRefresh: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Restart">
    <path d="M4 12a8 8 0 0 1 13.7-5.6L20 9" />
    <path d="M20 4v5h-5" />
    <path d="M20 12a8 8 0 0 1-13.7 5.6L4 15" />
    <path d="M4 20v-5h5" />
  </Svg>
);

export const IconMap: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="World map">
    <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" />
    <path d="M9 4v14" />
    <path d="M15 6v14" />
  </Svg>
);

export const IconSpeaker: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Sound">
    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z" />
    <path d="M15 9a4 4 0 0 1 0 6" />
    <path d="M17.5 6.5a7 7 0 0 1 0 11" />
  </Svg>
);

export const IconBreach: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Breach">
    <path
      d="M12 2.5 L13.6 10.4 L21.5 12 L13.6 13.6 L12 21.5 L10.4 13.6 L2.5 12 L10.4 10.4 Z"
      fill="currentColor"
      stroke="currentColor"
      strokeLinejoin="round"
    />
  </Svg>
);

export const IconLockdown: FC<MenuIconProps> = (p) => (
  <Svg {...p} label="Lockdown">
    <path d="M12 3 L4.5 6 V12.5 c0 4.4 3.1 7.4 7.5 8.5 c4.4-1.1 7.5-4.1 7.5-8.5 V6 Z" />
    <rect x="9" y="11" width="6" height="6" rx="1" />
    <path d="M10.5 11 V9 a1.5 1.5 0 0 1 3 0 V11" />
  </Svg>
);
