import type { FC, ReactNode } from "react";
import type { AchievementId } from "../achievements";

export type AchievementIconProps = {
  size?: number;
  className?: string;
};

type SvgProps = AchievementIconProps & {
  label: string;
  children: ReactNode;
};

const Svg: FC<SvgProps> = ({ size = 40, className, label, children }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    role="img"
    aria-label={label}
  >
    <title>{label}</title>
    {children}
  </svg>
);

const HL = "#fff";

// ── Combat / progression ─────────────────────────────────────────────

export const IconFirstBlood: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="First Blood">
    <path
      d="M12 2.5 C 9.5 6, 6.5 11, 6.5 14.8 C 6.5 18.6, 9 21.5, 12 21.5 C 15 21.5, 17.5 18.6, 17.5 14.8 C 17.5 11, 14.5 6, 12 2.5 Z"
      fill="currentColor"
    />
    <ellipse cx="10.1" cy="14.6" rx="1.3" ry="2.1" fill={HL} opacity="0.45" />
  </Svg>
);

export const IconExtermination: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Extermination">
    {[5, 12, 19].map((cx) => (
      <g key={cx}>
        <ellipse cx={cx} cy="10.5" rx="2.7" ry="2.9" fill="currentColor" />
        <path
          d={`M${cx - 1.8} 12.5 L${cx + 1.8} 12.5 L${cx + 1.4} 14.6 L${cx + 0.6} 13.6 L${cx - 0.6} 13.6 L${cx - 1.4} 14.6 Z`}
          fill="currentColor"
        />
        <circle cx={cx - 0.9} cy="10.4" r="0.65" fill="#000" opacity="0.65" />
        <circle cx={cx + 0.9} cy="10.4" r="0.65" fill="#000" opacity="0.65" />
        <rect x={cx - 0.4} y="11.5" width="0.8" height="1" fill="#000" opacity="0.55" />
      </g>
    ))}
  </Svg>
);

export const IconApexHunter: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Apex Hunter">
    {/* Three curved claw slashes */}
    <path
      d="M5 4.5 C 8 8, 9 13, 8.5 19"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M11 3.5 C 14 7.5, 15 13, 14.5 19.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M17 4.5 C 19.5 8, 20.5 12.5, 20 18.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </Svg>
);

export const IconVeteran: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Veteran">
    {/* 3 chevron stripes */}
    {[0, 4.5, 9].map((dy) => (
      <path
        key={dy}
        d={`M4 ${8 + dy} L12 ${4 + dy} L20 ${8 + dy} L17.5 ${9.6 + dy} L12 ${6.4 + dy} L6.5 ${9.6 + dy} Z`}
        fill="currentColor"
      />
    ))}
  </Svg>
);

export const IconScholar: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Scholar">
    {/* Open book */}
    <path
      d="M3 6 L11 7.5 L11 20 L3 18.5 Z"
      fill="currentColor"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="0.6"
    />
    <path
      d="M21 6 L13 7.5 L13 20 L21 18.5 Z"
      fill="currentColor"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="0.6"
    />
    <line x1="5.5" y1="10" x2="9" y2="10.6" stroke={HL} strokeOpacity="0.55" strokeWidth="0.7" />
    <line x1="5.5" y1="12" x2="9" y2="12.6" stroke={HL} strokeOpacity="0.55" strokeWidth="0.7" />
    <line x1="5.5" y1="14" x2="9" y2="14.6" stroke={HL} strokeOpacity="0.55" strokeWidth="0.7" />
    <line x1="15" y1="10.6" x2="18.5" y2="10" stroke={HL} strokeOpacity="0.55" strokeWidth="0.7" />
    <line x1="15" y1="12.6" x2="18.5" y2="12" stroke={HL} strokeOpacity="0.55" strokeWidth="0.7" />
    <line x1="15" y1="14.6" x2="18.5" y2="14" stroke={HL} strokeOpacity="0.55" strokeWidth="0.7" />
  </Svg>
);

export const IconFullArsenal: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Full Arsenal">
    {/* Hex frame connecting six tower-glyph slots */}
    <polygon
      points="12,4.5 18.5,8.25 18.5,15.75 12,19.5 5.5,15.75 5.5,8.25"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.4"
      strokeOpacity="0.4"
      strokeDasharray="1.2 1.4"
    />
    {/* pulse — top: dot + concentric ring */}
    <g>
      <circle cx="12" cy="4.5" r="2" fill="none" stroke="currentColor" strokeWidth="0.55" />
      <circle cx="12" cy="4.5" r="0.9" fill="currentColor" />
    </g>
    {/* chain — top-right: linked rings */}
    <g>
      <ellipse
        cx="17.55"
        cy="8.25"
        rx="0.95"
        ry="1.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        transform="rotate(-25 17.55 8.25)"
      />
      <ellipse
        cx="19.4"
        cy="8.25"
        rx="0.95"
        ry="1.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        transform="rotate(25 19.4 8.25)"
      />
    </g>
    {/* cryo — bottom-right: snowflake */}
    <g transform="translate(18.5 15.75)">
      <line
        x1="0"
        y1="-2.1"
        x2="0"
        y2="2.1"
        stroke="currentColor"
        strokeWidth="0.65"
        strokeLinecap="round"
      />
      <line
        x1="-1.82"
        y1="-1.05"
        x2="1.82"
        y2="1.05"
        stroke="currentColor"
        strokeWidth="0.65"
        strokeLinecap="round"
      />
      <line
        x1="-1.82"
        y1="1.05"
        x2="1.82"
        y2="-1.05"
        stroke="currentColor"
        strokeWidth="0.65"
        strokeLinecap="round"
      />
      <circle cx="0" cy="0" r="0.55" fill={HL} opacity="0.85" />
    </g>
    {/* mortar — bottom: bomb with fuse */}
    <g>
      <circle cx="12" cy="20" r="1.55" fill="currentColor" />
      <line
        x1="12"
        y1="18.45"
        x2="12.4"
        y2="17.6"
        stroke="currentColor"
        strokeWidth="0.7"
        strokeLinecap="round"
      />
      <circle cx="12.55" cy="17.4" r="0.4" fill={HL} opacity="0.95" />
    </g>
    {/* flame — bottom-left: teardrop flame */}
    <path
      d="M 5.5 13.7 C 3.9 14.6, 3.6 16.2, 4.4 17.2 C 4.85 17.85, 5.5 17.95, 5.5 17.95 C 5.5 17.95, 6.15 17.85, 6.6 17.2 C 7.4 16.2, 7.1 14.6, 5.5 13.7 Z"
      fill="currentColor"
    />
    <path
      d="M 5.5 14.85 C 4.85 15.45, 4.7 16.25, 5 16.7 C 5.2 17, 5.5 17.05, 5.5 17.05 C 5.5 17.05, 5.8 17, 6 16.7 C 6.3 16.25, 6.15 15.45, 5.5 14.85 Z"
      fill={HL}
      opacity="0.55"
    />
    {/* hive — top-left: hexagon with grid dot */}
    <g>
      <polygon points="5.5,6.4 7.05,7.3 7.05,9.1 5.5,10 3.95,9.1 3.95,7.3" fill="currentColor" />
      <circle cx="5.5" cy="8.2" r="0.55" fill="#000" opacity="0.5" />
    </g>
    {/* central armory hub */}
    <circle cx="12" cy="12" r="0.9" fill={HL} opacity="0.55" />
  </Svg>
);

export const IconFullyArmed: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Fully Armed">
    {/* Two columns of 3 chevrons (T3 A + T3 B) */}
    {[6, 18].map((cx) => (
      <g key={cx}>
        {[6, 11, 16].map((cy) => (
          <path
            key={cy}
            d={`M${cx - 3.5} ${cy + 1.6} L${cx} ${cy - 1.6} L${cx + 3.5} ${cy + 1.6} L${cx + 2.2} ${cy + 2.4} L${cx} ${cy} L${cx - 2.2} ${cy + 2.4} Z`}
            fill="currentColor"
          />
        ))}
      </g>
    ))}
  </Svg>
);

export const IconArchitect: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Architect">
    {/* Drafting compass */}
    <circle cx="12" cy="5" r="1.6" fill="currentColor" />
    <line
      x1="12"
      y1="6.5"
      x2="6"
      y2="20"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <line
      x1="12"
      y1="6.5"
      x2="18"
      y2="20"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M7.4 17 Q 12 14, 16.6 17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <circle cx="6" cy="20.2" r="0.9" fill="currentColor" />
    <circle cx="18" cy="20.2" r="0.9" fill="currentColor" />
  </Svg>
);

export const IconFlawless: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Flawless">
    {/* Heart inside shield */}
    <path
      d="M12 2.5 L20 5 L20 11 C 20 16.5, 16.5 20.5, 12 22 C 7.5 20.5, 4 16.5, 4 11 L4 5 Z"
      fill="currentColor"
      opacity="0.85"
    />
    <path
      d="M12 17 C 8 14.5, 6.5 12.5, 6.5 10.5 C 6.5 9, 7.7 8, 9 8 C 10.2 8, 11.2 8.6, 12 9.6 C 12.8 8.6, 13.8 8, 15 8 C 16.3 8, 17.5 9, 17.5 10.5 C 17.5 12.5, 16 14.5, 12 17 Z"
      fill={HL}
      opacity="0.95"
    />
  </Svg>
);

export const IconTripleStar: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Triple Star">
    {[
      [5.5, 11, 3.5],
      [12, 8.5, 4.4],
      [18.5, 11, 3.5],
    ].map(([cx, cy, r]) => {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.42;
        pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}`);
      }
      return <polygon key={`${cx}-${cy}`} points={pts.join(" ")} fill="currentColor" />;
    })}
  </Svg>
);

export const IconFullSpectrum: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Full Spectrum">
    {/* Rainbow bands */}
    {[
      { r: 9.5, c: "currentColor", o: 1 },
      { r: 7.5, c: HL, o: 0.85 },
      { r: 5.5, c: "currentColor", o: 0.55 },
      { r: 3.5, c: HL, o: 0.55 },
    ].map((b) => (
      <path
        key={b.r}
        d={`M ${12 - b.r} 18 A ${b.r} ${b.r} 0 0 1 ${12 + b.r} 18`}
        fill="none"
        stroke={b.c}
        strokeOpacity={b.o}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    ))}
    <circle cx="12" cy="18" r="1.2" fill="currentColor" />
  </Svg>
);

export const IconMasterEngineer: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Master Engineer">
    {/* Cog */}
    {(() => {
      const teeth = 8;
      const outer = 10;
      const inner = 7.4;
      const root = 6.6;
      const pts: string[] = [];
      for (let i = 0; i < teeth * 4; i++) {
        const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2;
        const phase = i % 4;
        const r = phase === 0 || phase === 1 ? outer : phase === 2 ? inner : root;
        pts.push(`${(12 + Math.cos(a) * r).toFixed(2)},${(12 + Math.sin(a) * r).toFixed(2)}`);
      }
      return <polygon points={pts.join(" ")} fill="currentColor" />;
    })()}
    <circle cx="12" cy="12" r="3.2" fill="#000" opacity="0.45" />
    <circle cx="12" cy="12" r="1.6" fill={HL} opacity="0.7" />
  </Svg>
);

export const IconCampaign: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Campaign Complete">
    {/* Flag on hilltop */}
    <line
      x1="7"
      y1="3"
      x2="7"
      y2="21"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path d="M7 4 L18 5.5 L15 9 L18 12.5 L7 11 Z" fill="currentColor" />
    <path d="M3 21 Q 12 16, 21 21 Z" fill="currentColor" opacity="0.55" />
  </Svg>
);

export const IconPerfectRun: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Perfect Run">
    {/* Diamond body */}
    <path d="M 4 9 L 8 4 L 16 4 L 20 9 L 12 21 Z" fill="currentColor" />
    {/* Right pavilion highlight (lit side) */}
    <polygon points="12,9 20,9 12,21" fill={HL} opacity="0.18" />
    {/* Right crown highlight */}
    <polygon points="12,9 16,4 20,9" fill={HL} opacity="0.28" />
    {/* Crown center facet — animated flash */}
    <polygon points="8,4 12,9 16,4" fill={HL} opacity="0.45" className="ach-facet-flash" />
    {/* Static glint on left crown */}
    <line
      x1="6"
      y1="6.6"
      x2="7.5"
      y2="8.2"
      stroke={HL}
      strokeWidth="0.6"
      strokeOpacity="0.7"
      strokeLinecap="round"
    />
    {/* Animated traveling glint inside the gem */}
    <line
      x1="13.5"
      y1="11"
      x2="14.2"
      y2="14.5"
      stroke={HL}
      strokeWidth="0.6"
      strokeOpacity="0.95"
      strokeLinecap="round"
      className="ach-glint-a"
    />
    <line
      x1="9.5"
      y1="11.5"
      x2="9"
      y2="13"
      stroke={HL}
      strokeWidth="0.5"
      strokeOpacity="0.85"
      strokeLinecap="round"
      className="ach-glint-b"
    />
    {/* Internal facet lines */}
    <path d="M 4 9 L 20 9" fill="none" stroke={HL} strokeWidth="0.45" strokeOpacity="0.55" />
    <path d="M 8 4 L 12 9 L 16 4" fill="none" stroke={HL} strokeWidth="0.45" strokeOpacity="0.55" />
    <path d="M 12 9 L 12 21" fill="none" stroke={HL} strokeWidth="0.4" strokeOpacity="0.4" />
    {/* Outline */}
    <path
      d="M 4 9 L 8 4 L 16 4 L 20 9 L 12 21 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.7"
      strokeLinejoin="miter"
    />
    {/* Sparkles in the corners — twinkle in sequence */}
    <path
      className="ach-sparkle ach-sparkle-a"
      d="M 2.4 4.8 L 2.8 5.9 L 3.9 6.3 L 2.8 6.7 L 2.4 7.8 L 2 6.7 L 0.9 6.3 L 2 5.9 Z"
      fill={HL}
    />
    <path
      className="ach-sparkle ach-sparkle-b"
      d="M 21.6 4.8 L 22 5.9 L 23.1 6.3 L 22 6.7 L 21.6 7.8 L 21.2 6.7 L 20.1 6.3 L 21.2 5.9 Z"
      fill={HL}
    />
    <path
      className="ach-sparkle ach-sparkle-c"
      d="M 3.4 17.4 L 3.75 18.4 L 4.75 18.75 L 3.75 19.1 L 3.4 20.1 L 3.05 19.1 L 2.05 18.75 L 3.05 18.4 Z"
      fill={HL}
    />
    <path
      className="ach-sparkle ach-sparkle-d"
      d="M 20.6 16.8 L 20.95 17.75 L 21.9 18.1 L 20.95 18.45 L 20.6 19.4 L 20.25 18.45 L 19.3 18.1 L 20.25 17.75 Z"
      fill={HL}
    />
  </Svg>
);

export const IconFullService: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Full Service">
    {/* Hex hub + 4 drone dots with connecting lines */}
    <line x1="12" y1="12" x2="4" y2="4" stroke="currentColor" strokeWidth="1" strokeOpacity="0.7" />
    <line
      x1="12"
      y1="12"
      x2="20"
      y2="4"
      stroke="currentColor"
      strokeWidth="1"
      strokeOpacity="0.7"
    />
    <line
      x1="12"
      y1="12"
      x2="4"
      y2="20"
      stroke="currentColor"
      strokeWidth="1"
      strokeOpacity="0.7"
    />
    <line
      x1="12"
      y1="12"
      x2="20"
      y2="20"
      stroke="currentColor"
      strokeWidth="1"
      strokeOpacity="0.7"
    />
    <polygon points="12,7 16.3,9.5 16.3,14.5 12,17 7.7,14.5 7.7,9.5" fill="currentColor" />
    <circle cx="4" cy="4" r="1.8" fill="currentColor" />
    <circle cx="20" cy="4" r="1.8" fill="currentColor" />
    <circle cx="4" cy="20" r="1.8" fill="currentColor" />
    <circle cx="20" cy="20" r="1.8" fill="currentColor" />
    <circle cx="12" cy="12" r="1.4" fill={HL} opacity="0.85" />
  </Svg>
);

// ── Matriarch hunts ──────────────────────────────────────────────────

// Shared three-point crown that marks every matriarch-takedown icon, so
// the row reads as a set even though each variant gets its own accent.
const Crown: FC = () => (
  <path d="M4.5 9 L7.5 4.5 L12 7.5 L16.5 4.5 L19.5 9 L18 11 L6 11 Z" fill="currentColor" />
);

export const IconMatriarchRaptor: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Raptor Matriarch">
    <Crown />
    {/* sickle claw */}
    <path
      d="M7 13.5 C 9 20, 14 21.5, 18.5 18.5 C 14.5 19, 12 16.5, 11 12.8 Z"
      fill="currentColor"
    />
    <circle cx="8.6" cy="14.3" r="1" fill={HL} opacity="0.7" />
  </Svg>
);

export const IconMatriarchStego: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Stegosaur Matriarch">
    <Crown />
    {/* row of back plates */}
    {[6, 10.5, 15].map((x) => (
      <path key={x} d={`M${x} 20 L${x + 2.2} 13 L${x + 4.4} 20 Z`} fill="currentColor" />
    ))}
  </Svg>
);

export const IconMatriarchPara: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Parasaur Matriarch">
    <Crown />
    {/* swept-back crest */}
    <path
      d="M7 20 C 7 15, 12 12.5, 18.5 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
    <circle cx="7.2" cy="19" r="1.7" fill="currentColor" />
  </Svg>
);

export const IconMatriarchAllosaur: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="T-Rex Matriarch">
    <Crown />
    {/* toothy jaw */}
    <path d="M6 13 L18 13 L18 15 L6 15 Z" fill="currentColor" />
    <path d="M6 15 L8 18 L10 15 L12 18 L14 15 L16 18 L18 15 Z" fill="currentColor" />
  </Svg>
);

export const IconMatriarchArmored: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Triceratops Matriarch">
    <Crown />
    {/* three horns */}
    <path d="M6.5 20 L8 13.5 L9.5 20 Z" fill="currentColor" />
    <path d="M10.5 20.5 L12 12.5 L13.5 20.5 Z" fill="currentColor" />
    <path d="M14.5 20 L16 13.5 L17.5 20 Z" fill="currentColor" />
  </Svg>
);

export const IconMatriarchApex: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Apex Matriarch">
    <Crown />
    {/* apex star */}
    {(() => {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 5.2 : 2.1;
        pts.push(`${12 + r * Math.cos(a)},${16.5 + r * Math.sin(a)}`);
      }
      return <polygon points={pts.join(" ")} fill="currentColor" />;
    })()}
  </Svg>
);

// ── Robot & lab mastery ──────────────────────────────────────────────

// Compact robot head used across the roster/legion icons.
const RobotHead: FC<{ x: number; star?: boolean }> = ({ x, star }) => (
  <g>
    <rect x={x} y="9" width="5" height="6" rx="1" fill="currentColor" />
    <line x1={x + 2.5} y1="9" x2={x + 2.5} y2="6.5" stroke="currentColor" strokeWidth="1" />
    <circle cx={x + 2.5} cy="6" r="1" fill="currentColor" />
    {star ? (
      <circle cx={x + 2.5} cy="12" r="1.2" fill={HL} />
    ) : (
      <>
        <circle cx={x + 1.5} cy="12" r="0.8" fill="#000" opacity="0.6" />
        <circle cx={x + 3.5} cy="12" r="0.8" fill="#000" opacity="0.6" />
      </>
    )}
  </g>
);

export const IconRobotRoster: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Full Roster">
    <RobotHead x={1.5} />
    <RobotHead x={7} />
    <RobotHead x={12.5} />
    <RobotHead x={18} />
  </Svg>
);

export const IconRobotAscendant: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Ascendant Pilot">
    {/* single robot head, larger, with an up-chevron */}
    <rect x="7" y="10" width="10" height="9" rx="1.5" fill="currentColor" />
    <line x1="12" y1="10" x2="12" y2="6" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="12" cy="5" r="1.4" fill="currentColor" />
    <circle cx="9.8" cy="14" r="1.2" fill="#000" opacity="0.6" />
    <circle cx="14.2" cy="14" r="1.2" fill="#000" opacity="0.6" />
    <path
      d="M8.5 9 L12 6 L15.5 9"
      fill="none"
      stroke={HL}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const IconRobotLegion: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Robot Legion">
    <RobotHead x={1.5} star />
    <RobotHead x={7} star />
    <RobotHead x={12.5} star />
    <RobotHead x={18} star />
  </Svg>
);

export const IconLabSpecialist: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Lab Specialist">
    {/* beaker, filled to the top */}
    <path
      d="M9 3 L9 9 L5 19 C 4.5 20.5, 5.5 21.5, 7 21.5 L17 21.5 C 18.5 21.5, 19.5 20.5, 19 19 L15 9 L15 3 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <line
      x1="8"
      y1="3"
      x2="16"
      y2="3"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M7.2 12 L16.8 12 L18.4 16 C 18.8 17.5, 18 18.5, 16.5 18.5 L7.5 18.5 C 6 18.5, 5.2 17.5, 5.6 16 Z"
      fill="currentColor"
    />
  </Svg>
);

export const IconLabOverlord: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Lab Overlord">
    {/* filled beaker crowned */}
    <path
      d="M4.5 5 L6.5 2.5 L9.5 4.5 L12 2.5 L14.5 4.5 L17.5 2.5 L19.5 5 L18 6.5 L6 6.5 Z"
      fill="currentColor"
    />
    <path
      d="M9 7.5 L9 10 L5 19 C 4.5 20.5, 5.5 21.5, 7 21.5 L17 21.5 C 18.5 21.5, 19.5 20.5, 19 19 L15 10 L15 7.5 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M6.6 12.5 L17.4 12.5 L18.4 16 C 18.8 17.5, 18 18.5, 16.5 18.5 L7.5 18.5 C 6 18.5, 5.2 17.5, 5.6 16 Z"
      fill="currentColor"
    />
  </Svg>
);

// ── Modes & milestones ───────────────────────────────────────────────

export const IconEndlessSurvivor: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Endless Survivor">
    {/* infinity loop */}
    <path
      d="M8 12 C 8 9, 4.5 9, 4.5 12 C 4.5 15, 8 15, 9.5 12 C 11 9, 14.5 9, 14.5 12 C 14.5 15, 11 15, 9.5 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      transform="translate(4.5 0) scale(0.95 1.4) translate(-2 -4.8)"
    />
  </Svg>
);

export const IconHeroicEffort: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Heroic Effort">
    {/* shield with laurel notch */}
    <path
      d="M12 2.5 L20 5.5 L20 12 C 20 17, 16.5 20.5, 12 22 C 7.5 20.5, 4 17, 4 12 L4 5.5 Z"
      fill="currentColor"
    />
    <path
      d="M9 12 L11 15 L15.5 8.5"
      fill="none"
      stroke={HL}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const IconIronWill: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Iron Will">
    {/* anvil */}
    <path
      d="M3 8 L14 8 L14 10 C 14 11.5, 12 12, 10.5 12 L10.5 13 L19 13 C 19 15.5, 16.5 16.5, 13 16.5 L11 16.5 L11 18 L15 18 L15 20 L7 20 L7 18 L9 18 L9 12.5 C 6 12, 3 10.5, 3 8 Z"
      fill="currentColor"
    />
  </Svg>
);

export const IconMassProduction: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Mass Production">
    {/* three stacked identical towers */}
    {[
      [4, 14],
      [10, 11],
      [16, 8],
    ].map(([x, y]) => (
      <g key={x}>
        <rect x={x} y={y} width="4" height={21 - y} fill="currentColor" />
        <rect x={x - 0.7} y={y - 1.6} width="5.4" height="2" rx="0.4" fill="currentColor" />
        <circle cx={x + 2} cy={y + 1.4} r="0.8" fill={HL} opacity="0.75" />
      </g>
    ))}
  </Svg>
);

// ── Secret cosmetics: nature ─────────────────────────────────────────

export const IconTreeHugger: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Tree Hugger">
    {/* Pine tree */}
    <path
      d="M12 3 L6.5 11 L9 11 L5.5 16 L8.5 16 L4.5 21 L19.5 21 L15.5 16 L18.5 16 L15 11 L17.5 11 Z"
      fill="currentColor"
    />
    <rect x="10.5" y="20" width="3" height="2" fill="currentColor" opacity="0.6" />
    <circle cx="9" cy="8" r="0.6" fill={HL} opacity="0.6" />
    <circle cx="14" cy="13" r="0.6" fill={HL} opacity="0.6" />
  </Svg>
);

export const IconDiamondInTheRough: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Diamond in the Rough">
    {/* Cut gem */}
    <path d="M5 9 L9 4 L15 4 L19 9 L12 21 Z" fill="currentColor" />
    <path d="M9 4 L12 9 L15 4" fill="none" stroke={HL} strokeOpacity="0.7" strokeWidth="0.8" />
    <path d="M5 9 L12 9 L19 9" fill="none" stroke={HL} strokeOpacity="0.7" strokeWidth="0.8" />
    <path d="M12 9 L12 21" fill="none" stroke={HL} strokeOpacity="0.5" strokeWidth="0.6" />
    <path d="M9 4 L7 8 L8.5 8" fill={HL} opacity="0.5" />
  </Svg>
);

export const IconWhisperingSkull: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Whispering Skull">
    {/* Skull with sound waves */}
    <path
      d="M12 4 C 7.6 4, 4.5 7, 4.5 11 C 4.5 13.4, 5.5 15, 6.5 16 L 6.5 19 L 9 19 L 9 17.5 L 11 17.5 L 11 19 L 13 19 L 13 17.5 L 15 17.5 L 15 19 L 17.5 19 L 17.5 16 C 18.5 15, 19.5 13.4, 19.5 11 C 19.5 7, 16.4 4, 12 4 Z"
      fill="currentColor"
    />
    <circle cx="9.2" cy="11" r="1.4" fill="#000" opacity="0.65" />
    <circle cx="14.8" cy="11" r="1.4" fill="#000" opacity="0.65" />
    <path
      d="M11 14 L 12 15 L 13 14"
      fill="none"
      stroke="#000"
      strokeOpacity="0.5"
      strokeWidth="0.7"
    />
    {/* sound waves */}
    <path
      d="M19.5 6 Q 21.5 8, 19.5 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      opacity="0.7"
    />
    <path
      d="M21 4.5 Q 23.5 8, 21 11.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      opacity="0.5"
    />
  </Svg>
);

export const IconMushroomPuff: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Mushroom Puff">
    {/* Mushroom cap + stem + spore puffs */}
    <path d="M4 11 C 4 7, 7.5 4.5, 12 4.5 C 16.5 4.5, 20 7, 20 11 L 4 11 Z" fill="currentColor" />
    <rect x="9.5" y="11" width="5" height="6" fill="currentColor" opacity="0.7" />
    <ellipse cx="9" cy="8" r="1.1" fill={HL} opacity="0.75" />
    <ellipse cx="14" cy="9" r="0.8" fill={HL} opacity="0.75" />
    <ellipse cx="16.5" cy="7.5" r="0.6" fill={HL} opacity="0.75" />
    {/* puff dots */}
    <circle cx="3" cy="5" r="0.7" fill="currentColor" opacity="0.5" />
    <circle cx="2.5" cy="8" r="0.5" fill="currentColor" opacity="0.5" />
    <circle cx="21" cy="5" r="0.7" fill="currentColor" opacity="0.5" />
    <circle cx="21.5" cy="8" r="0.5" fill="currentColor" opacity="0.5" />
  </Svg>
);

export const IconTorchLit: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Light the Way">
    {/* Torch handle + flame */}
    <rect x="10.5" y="13" width="3" height="9" fill="currentColor" />
    <line x1="10.5" y1="15" x2="13.5" y2="15" stroke="#000" strokeOpacity="0.4" strokeWidth="0.8" />
    <line x1="10.5" y1="18" x2="13.5" y2="18" stroke="#000" strokeOpacity="0.4" strokeWidth="0.8" />
    <rect x="9.5" y="11.5" width="5" height="2" fill="currentColor" />
    <path
      d="M12 2.5 C 9.5 6, 7.5 8, 8.5 11 C 9 12.5, 10.5 13, 12 13 C 13.5 13, 15 12.5, 15.5 11 C 16.5 8, 14.5 6, 12 2.5 Z"
      fill="currentColor"
    />
    <path
      d="M12 5 C 11 7, 10 8, 10.5 10 C 11 11.5, 11.5 12, 12 12 C 12.5 12, 13 11.5, 13.5 10 C 14 8, 13 7, 12 5 Z"
      fill={HL}
      opacity="0.7"
    />
  </Svg>
);

export const IconBarrelRoll: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Barrel Roll">
    {/* Tipped barrel rolling */}
    <g transform="rotate(20 12 13)">
      <rect x="3" y="9" width="18" height="9" rx="1.5" fill="currentColor" />
      <ellipse cx="3" cy="13.5" rx="1" ry="4.5" fill="currentColor" />
      <ellipse cx="21" cy="13.5" rx="1" ry="4.5" fill={HL} opacity="0.4" />
      <line
        x1="3"
        y1="11.5"
        x2="21"
        y2="11.5"
        stroke="#000"
        strokeOpacity="0.5"
        strokeWidth="0.6"
      />
      <line
        x1="3"
        y1="15.5"
        x2="21"
        y2="15.5"
        stroke="#000"
        strokeOpacity="0.5"
        strokeWidth="0.6"
      />
    </g>
    {/* motion lines */}
    <path
      d="M2 22 L 6 22"
      stroke="currentColor"
      strokeWidth="0.8"
      strokeLinecap="round"
      opacity="0.7"
    />
    <path
      d="M8 21 L 11 21"
      stroke="currentColor"
      strokeWidth="0.8"
      strokeLinecap="round"
      opacity="0.5"
    />
  </Svg>
);

export const IconCabinSmoke: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Home Fires">
    {/* Cabin with smoke */}
    <path d="M4 12 L 12 6 L 20 12 L 20 21 L 4 21 Z" fill="currentColor" />
    <rect x="10" y="14" width="4" height="7" fill="#000" opacity="0.55" />
    <rect x="14.5" y="6.5" width="2.5" height="3" fill="currentColor" opacity="0.7" />
    {/* smoke curls */}
    <path
      d="M15.7 6 C 14 4, 17 3, 15.7 1.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      opacity="0.7"
    />
  </Svg>
);

export const IconCrystalShatter: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Crystal Shatter">
    {/* Crystal shards */}
    <path d="M9 3 L 13 4 L 12 14 L 6 13 Z" fill="currentColor" />
    <path d="M14 6 L 18 7.5 L 17.5 18 L 13 17 Z" fill="currentColor" opacity="0.85" />
    <path d="M6 14 L 11 14.6 L 9.5 21 L 5 19 Z" fill="currentColor" opacity="0.7" />
    <line x1="9" y1="3" x2="11" y2="13" stroke={HL} strokeOpacity="0.6" strokeWidth="0.7" />
    <line x1="14" y1="6" x2="16" y2="17" stroke={HL} strokeOpacity="0.6" strokeWidth="0.7" />
    {/* crack */}
    <path
      d="M19 5 L 21 9 L 19.5 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.8"
      strokeLinecap="round"
      opacity="0.6"
    />
  </Svg>
);

export const IconCactusBloom: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Cactus Bloom">
    {/* Saguaro cactus with bloom */}
    <rect x="10.5" y="6" width="3" height="15" rx="1.4" fill="currentColor" />
    <path d="M6 14 C 6 11, 7.5 10, 9 10 L 9 12 L 10.5 12 L 10.5 14 Z" fill="currentColor" />
    <path d="M18 14 C 18 11, 16.5 10, 15 10 L 15 12 L 13.5 12 L 13.5 14 Z" fill="currentColor" />
    {/* bloom — 5-petal flower on top */}
    {[0, 72, 144, 216, 288].map((deg) => (
      <ellipse
        key={deg}
        cx="12"
        cy="3.6"
        rx="1.1"
        ry="2.2"
        transform={`rotate(${deg} 12 5.5)`}
        fill={HL}
        opacity="0.95"
      />
    ))}
    <circle cx="12" cy="5.5" r="1" fill="currentColor" />
    {/* spines */}
    <line x1="11" y1="9" x2="11" y2="9.6" stroke={HL} strokeOpacity="0.7" strokeWidth="0.5" />
    <line x1="13" y1="11" x2="13" y2="11.6" stroke={HL} strokeOpacity="0.7" strokeWidth="0.5" />
    <line x1="11" y1="15" x2="11" y2="15.6" stroke={HL} strokeOpacity="0.7" strokeWidth="0.5" />
    <line x1="13" y1="17" x2="13" y2="17.6" stroke={HL} strokeOpacity="0.7" strokeWidth="0.5" />
  </Svg>
);

export const IconAncientGlyph: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Ancient Glyph">
    {/* Stylized eye glyph in stone tablet */}
    <rect x="3" y="5" width="18" height="14" rx="1.6" fill="currentColor" opacity="0.4" />
    <path
      d="M5 12 C 7 8, 10 6.5, 12 6.5 C 14 6.5, 17 8, 19 12 C 17 16, 14 17.5, 12 17.5 C 10 17.5, 7 16, 5 12 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="2.4" fill="currentColor" />
    <circle cx="12" cy="12" r="0.9" fill={HL} opacity="0.85" />
    <line
      x1="12"
      y1="17.5"
      x2="12"
      y2="20"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <line
      x1="9.5"
      y1="17.4"
      x2="8.5"
      y2="19.5"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
    />
  </Svg>
);

export const IconRustedRadio: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Static Response">
    {/* Boxy radio with antenna */}
    <line
      x1="5.5"
      y1="9"
      x2="3"
      y2="3"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <line
      x1="18.5"
      y1="9"
      x2="21"
      y2="3"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <rect x="3" y="9" width="18" height="11" rx="1.5" fill="currentColor" />
    <rect x="5" y="11" width="8" height="4" rx="0.6" fill="#000" opacity="0.55" />
    <line x1="5.5" y1="13" x2="12.5" y2="13" stroke={HL} strokeOpacity="0.65" strokeWidth="0.5" />
    <circle cx="16.5" cy="13" r="1.6" fill="#000" opacity="0.55" />
    <circle cx="16.5" cy="13" r="0.5" fill={HL} opacity="0.85" />
    <circle cx="6" cy="17.5" r="0.7" fill="#000" opacity="0.55" />
    <circle cx="9" cy="17.5" r="0.7" fill="#000" opacity="0.55" />
    <circle cx="12" cy="17.5" r="0.7" fill="#000" opacity="0.55" />
    <circle cx="15" cy="17.5" r="0.7" fill="#000" opacity="0.55" />
    <circle cx="18" cy="17.5" r="0.7" fill="#000" opacity="0.55" />
  </Svg>
);

export const IconSatellitePing: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Distant Signal">
    {/* Dish */}
    <path d="M3 18 L 21 6 L 21 8.5 L 5.5 19 Z" fill="currentColor" />
    <line
      x1="13"
      y1="13"
      x2="11"
      y2="20"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <line
      x1="9"
      y1="20"
      x2="13"
      y2="20"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    {/* signal arcs from upper-right */}
    <path
      d="M16 4 Q 19 5.5, 19.5 9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      opacity="0.85"
    />
    <path
      d="M14 2.5 Q 20 4, 21 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      opacity="0.55"
    />
  </Svg>
);

export const IconFairyRing: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Fairy Ring">
    {/* Ring of 6 small flowers */}
    <ellipse
      cx="12"
      cy="14"
      rx="9"
      ry="3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.6"
      strokeOpacity="0.4"
      strokeDasharray="1.5 1.5"
    />
    {[0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2;
      const cx = 12 + Math.cos(a) * 9;
      const cy = 14 + Math.sin(a) * 3.5;
      return (
        <g key={i}>
          {[0, 72, 144, 216, 288].map((deg) => (
            <circle
              key={deg}
              cx={cx + Math.cos(((deg - 90) * Math.PI) / 180) * 1.2}
              cy={cy + Math.sin(((deg - 90) * Math.PI) / 180) * 1.2}
              r="0.9"
              fill="currentColor"
            />
          ))}
          <circle cx={cx} cy={cy} r="0.8" fill={HL} opacity="0.85" />
        </g>
      );
    })}
  </Svg>
);

export const IconRocketLaunch: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Rocket Launch">
    {/* Rocket pointing up + flame trail */}
    <path
      d="M12 2 C 14 5, 15 8, 15 12 L 15 16 L 9 16 L 9 12 C 9 8, 10 5, 12 2 Z"
      fill="currentColor"
    />
    <circle cx="12" cy="9" r="1.4" fill={HL} opacity="0.85" />
    <path d="M9 14 L 6 17 L 9 16 Z" fill="currentColor" />
    <path d="M15 14 L 18 17 L 15 16 Z" fill="currentColor" />
    {/* flame */}
    <path
      d="M10 16 C 10.5 18, 9.5 20, 10.5 22 C 11 21, 11.5 21, 12 22 C 12.5 21, 13 21, 13.5 22 C 14.5 20, 13.5 18, 14 16 Z"
      fill="currentColor"
      opacity="0.75"
    />
    <path
      d="M11 17 C 11.2 18.5, 10.8 19.5, 11.5 21 C 12 20, 12 20, 12.5 21 C 13.2 19.5, 12.8 18.5, 13 17 Z"
      fill={HL}
      opacity="0.7"
    />
  </Svg>
);

export const IconTumbleweed: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Running Cactus">
    {/* Tangled bramble circle */}
    <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5 8 Q 12 10, 19 8" fill="none" stroke="currentColor" strokeWidth="0.9" />
    <path d="M5 16 Q 12 14, 19 16" fill="none" stroke="currentColor" strokeWidth="0.9" />
    <path d="M8 5 Q 10 12, 8 19" fill="none" stroke="currentColor" strokeWidth="0.9" />
    <path d="M16 5 Q 14 12, 16 19" fill="none" stroke="currentColor" strokeWidth="0.9" />
    <path d="M6 6 L 18 18" stroke="currentColor" strokeWidth="0.6" strokeOpacity="0.7" />
    <path d="M18 6 L 6 18" stroke="currentColor" strokeWidth="0.6" strokeOpacity="0.7" />
    {/* motion lines */}
    <path
      d="M1 12 L 3 12"
      stroke="currentColor"
      strokeWidth="0.9"
      strokeLinecap="round"
      opacity="0.7"
    />
    <path
      d="M1 9 L 2.5 9"
      stroke="currentColor"
      strokeWidth="0.9"
      strokeLinecap="round"
      opacity="0.5"
    />
  </Svg>
);

export const IconRoverRoam: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Rover Roam">
    {/* Rover body */}
    <rect x="4" y="11" width="16" height="6" rx="1.4" fill="currentColor" />
    <rect x="8" y="7" width="6" height="4" rx="0.6" fill="currentColor" opacity="0.85" />
    <rect x="9" y="8" width="4" height="2.5" fill="#000" opacity="0.55" />
    {/* antenna */}
    <line
      x1="14"
      y1="7"
      x2="16"
      y2="3"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <circle cx="16" cy="3" r="1" fill="currentColor" />
    {/* wheels */}
    <circle cx="8" cy="18" r="2.2" fill="currentColor" />
    <circle cx="8" cy="18" r="1" fill="#000" opacity="0.55" />
    <circle cx="16" cy="18" r="2.2" fill="currentColor" />
    <circle cx="16" cy="18" r="1" fill="#000" opacity="0.55" />
    {/* solar panel/grille */}
    <line x1="15" y1="13" x2="19" y2="13" stroke={HL} strokeOpacity="0.5" strokeWidth="0.6" />
    <line x1="15" y1="14.5" x2="19" y2="14.5" stroke={HL} strokeOpacity="0.5" strokeWidth="0.6" />
  </Svg>
);

export const IconBabyRaptor: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Baby Raptor">
    {/* Small raptor head silhouette facing right */}
    <path
      d="M3 14 C 3 11, 5 9, 8 9 C 9 7, 11 6, 13 6.5 C 15 7, 16 9, 16 11 L 21 11 L 19 12.5 L 21 13.5 L 18 14 L 19.5 16 L 16 15 L 15.5 17 L 14 16 C 13 18, 11 19, 9 19 C 6 19, 3 17, 3 14 Z"
      fill="currentColor"
    />
    <circle cx="6" cy="13" r="0.9" fill={HL} opacity="0.95" />
    <circle cx="6" cy="13" r="0.4" fill="#000" />
    {/* tooth */}
    <path d="M16 13.5 L 17 14.5 L 17.5 13.5 Z" fill={HL} opacity="0.8" />
  </Svg>
);

export const IconBuriedPara: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Dig Out">
    {/* Para head poking out of snow */}
    <path
      d="M5 18 L 7 17 L 9 18 L 11 17 L 13 18 L 15 17 L 17 18 L 19 17 L 21 18 L 21 22 L 3 22 L 3 18 Z"
      fill="currentColor"
      opacity="0.55"
    />
    {/* head */}
    <path
      d="M9 16 C 9 12, 11 9, 13 9 C 15 9, 16 11, 16 13 L 19 11 L 17.5 12.5 L 19 13.5 L 17 14 L 17 16 C 17 17, 15.5 18, 13.5 18 C 11 18, 9 17, 9 16 Z"
      fill="currentColor"
    />
    {/* crest */}
    <path d="M11.5 10 C 9 6, 7 5, 5.5 6 C 6 8, 8 10, 11 11 Z" fill="currentColor" />
    <circle cx="11.5" cy="14.5" r="0.7" fill={HL} opacity="0.95" />
    <circle cx="11.5" cy="14.5" r="0.3" fill="#000" />
    {/* snow sparkle */}
    <circle cx="20" cy="20" r="0.5" fill={HL} opacity="0.7" />
    <circle cx="4" cy="20" r="0.5" fill={HL} opacity="0.7" />
  </Svg>
);

export const IconSnowman: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Lone Snowman">
    {/* Three stacked snowballs */}
    <circle cx="12" cy="17.5" r="4.2" fill="currentColor" />
    <circle cx="12" cy="11" r="3.2" fill="currentColor" />
    <circle cx="12" cy="6" r="2.4" fill="currentColor" />
    {/* top hat */}
    <rect x="8.5" y="2.6" width="7" height="1.1" rx="0.3" fill="#000" opacity="0.65" />
    <rect x="9.8" y="0.4" width="4.4" height="2.6" rx="0.3" fill="#000" opacity="0.65" />
    {/* carrot nose */}
    <path d="M12 6 L 16 6.6 L 12 7 Z" fill={HL} opacity="0.95" />
    {/* eyes */}
    <circle cx="11" cy="5.2" r="0.5" fill="#000" opacity="0.7" />
    <circle cx="13" cy="5.2" r="0.5" fill="#000" opacity="0.7" />
    {/* coal buttons */}
    <circle cx="12" cy="10" r="0.55" fill="#000" opacity="0.55" />
    <circle cx="12" cy="12" r="0.55" fill="#000" opacity="0.55" />
    {/* stick arms */}
    <line
      x1="9"
      y1="10.5"
      x2="5.5"
      y2="8.5"
      stroke="currentColor"
      strokeWidth="0.9"
      strokeLinecap="round"
    />
    <line
      x1="15"
      y1="10.5"
      x2="18.5"
      y2="8.5"
      stroke="currentColor"
      strokeWidth="0.9"
      strokeLinecap="round"
    />
  </Svg>
);

export const IconGhostTrike: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Phantom Trike">
    {/* Translucent trike head, three horns */}
    <path
      d="M3 13 C 3 10, 6 8, 10 8 L 14 8 C 17 8, 20 10, 20 13 L 20 16 L 17 17 L 14 16 L 14 18 L 10 18 L 10 16 L 7 17 L 4 16 Z"
      fill="currentColor"
      opacity="0.55"
      stroke="currentColor"
      strokeWidth="1"
      strokeDasharray="2 1.5"
    />
    {/* frill bumps */}
    <path d="M2 11 L 4 12 L 4 14 L 2 15 Z" fill="currentColor" opacity="0.4" />
    <path d="M22 11 L 20 12 L 20 14 L 22 15 Z" fill="currentColor" opacity="0.4" />
    {/* horns */}
    <path d="M9 8 L 8 4 L 10 7 Z" fill="currentColor" opacity="0.85" />
    <path d="M14 8 L 15 4 L 13 7 Z" fill="currentColor" opacity="0.85" />
    <path d="M11.5 13 L 12 17 L 12.5 13 Z" fill="currentColor" opacity="0.85" />
    {/* eye */}
    <circle cx="9.5" cy="13" r="0.7" fill={HL} opacity="0.9" />
  </Svg>
);

export const IconHauntedRuins: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Haunted Ruins">
    {/* Broken column + arch fragment + ghost */}
    <rect x="4" y="11" width="3" height="10" fill="currentColor" />
    <rect x="3.5" y="9.5" width="4" height="1.5" fill="currentColor" />
    <path d="M4 9.5 L 4 7 L 5 8 L 6 6 L 7 8 L 7 9.5 Z" fill="currentColor" />
    <rect x="14" y="14" width="3" height="7" fill="currentColor" opacity="0.85" />
    <rect x="13.5" y="12.5" width="4" height="1.5" fill="currentColor" opacity="0.85" />
    <path
      d="M14 12.5 L 14 10 L 15 11 L 16 9.5 L 17 11 L 17 12.5 Z"
      fill="currentColor"
      opacity="0.85"
    />
    {/* arch/lintel between */}
    <path d="M7 9.5 Q 12 4, 17 9.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    {/* ghost wisp */}
    <path
      d="M10 16 C 9 17, 9 18.5, 10 20 C 10.5 19, 11 19, 11.5 20 C 12 19, 12.5 19, 13 20 C 14 18.5, 14 17, 13 16 C 12 15.5, 11 15.5, 10 16 Z"
      fill={HL}
      opacity="0.75"
    />
    <circle cx="10.6" cy="17.5" r="0.4" fill="#000" opacity="0.7" />
    <circle cx="12.4" cy="17.5" r="0.4" fill="#000" opacity="0.7" />
  </Svg>
);

// ── Locked / hidden placeholder ──────────────────────────────────────

export const IconHiddenAchievement: FC<AchievementIconProps> = (p) => (
  <Svg {...p} label="Hidden achievement">
    {/* Padlock with question mark */}
    <path
      d="M8 11 L 8 8 C 8 5.5, 9.8 4, 12 4 C 14.2 4, 16 5.5, 16 8 L 16 11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <rect x="5.5" y="11" width="13" height="9" rx="1.6" fill="currentColor" />
    <text
      x="12"
      y="17.5"
      fontFamily="ui-monospace, monospace"
      fontWeight="700"
      fontSize="6.5"
      textAnchor="middle"
      fill="#000"
      fillOpacity="0.7"
    >
      ?
    </text>
  </Svg>
);

// ── Registry ─────────────────────────────────────────────────────────

export const ACHIEVEMENT_ICONS: Record<AchievementId, FC<AchievementIconProps>> = {
  first_blood: IconFirstBlood,
  extermination: IconExtermination,
  apex_hunter: IconApexHunter,
  veteran: IconVeteran,
  scholar: IconScholar,
  full_arsenal: IconFullArsenal,
  fully_armed: IconFullyArmed,
  architect: IconArchitect,
  flawless: IconFlawless,
  triple_star: IconTripleStar,
  full_spectrum: IconFullSpectrum,
  master_engineer: IconMasterEngineer,
  campaign: IconCampaign,
  perfect_run: IconPerfectRun,
  full_service: IconFullService,
  matriarch_raptor: IconMatriarchRaptor,
  matriarch_stego: IconMatriarchStego,
  matriarch_para: IconMatriarchPara,
  matriarch_allosaur: IconMatriarchAllosaur,
  matriarch_armored: IconMatriarchArmored,
  matriarch_apex: IconMatriarchApex,
  robot_roster: IconRobotRoster,
  robot_ascendant: IconRobotAscendant,
  robot_legion: IconRobotLegion,
  lab_specialist: IconLabSpecialist,
  lab_overlord: IconLabOverlord,
  endless_survivor: IconEndlessSurvivor,
  heroic_effort: IconHeroicEffort,
  iron_will: IconIronWill,
  mass_production: IconMassProduction,
  tree_hugger: IconTreeHugger,
  diamond_in_the_rough: IconDiamondInTheRough,
  whispering_skull: IconWhisperingSkull,
  mushroom_puff: IconMushroomPuff,
  torch_lit: IconTorchLit,
  barrel_roll: IconBarrelRoll,
  cabin_smoke: IconCabinSmoke,
  crystal_shatter: IconCrystalShatter,
  cactus_bloom: IconCactusBloom,
  ancient_glyph: IconAncientGlyph,
  rusted_radio: IconRustedRadio,
  satellite_ping: IconSatellitePing,
  fairy_ring: IconFairyRing,
  rocket_launch: IconRocketLaunch,
  tumbleweed: IconTumbleweed,
  rover_roam: IconRoverRoam,
  baby_raptor: IconBabyRaptor,
  buried_para: IconBuriedPara,
  snowman: IconSnowman,
  ghost_trike: IconGhostTrike,
  haunted_ruins: IconHauntedRuins,
};
