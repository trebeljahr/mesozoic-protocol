import { useTranslation } from "react-i18next";
import type { ProgressData } from "../progress";
import { ROBOT_SPECS } from "../sim/robotVariants";
import type { RobotVariant } from "../sim/types";
import { DAMAGE_TYPE_COLOR } from "../sim/world";
import { useGame } from "../store";
import { IconBolt } from "./MenuIcons";
import { RobotDiorama } from "./RobotDiorama";

const ROSTER: RobotVariant[] = ["leela", "george", "mike", "stan"];

export const RobotCompendiumSection = ({ progress }: { progress: ProgressData }) => {
  const { t } = useTranslation();
  const robotLocks = useGame((s) => s.compendiumLocks.robots);
  return (
    <div className="robot-compendium-scroll">
      <div className="robot-compendium-grid">
        {ROSTER.map((variant) => {
          const spec = ROBOT_SPECS[variant];
          const lockedOverride = robotLocks[variant];
          const unlocked =
            lockedOverride === undefined ? !!progress.robotUnlocks[variant] : !lockedOverride;
          const xp = progress.robotXp[variant] ?? 0;
          return (
            <article
              key={variant}
              className="robot-compendium-card"
              data-variant={variant}
              data-locked={unlocked ? undefined : "true"}
            >
              <div className="robot-compendium-diorama">
                <RobotDiorama variant={variant} />
                {!unlocked && (
                  <div className="robot-compendium-locked">
                    <span className="robot-compendium-lock-price">
                      <IconBolt size={13} /> {spec.unlockBolts}
                    </span>
                    <span className="robot-compendium-locked-label">{t("robotShop.locked")}</span>
                  </div>
                )}
              </div>
              <div className="robot-compendium-body">
                <header className="robot-compendium-title">
                  <span className="robot-compendium-name">{spec.label}</span>
                  <span className="robot-compendium-callsign">{spec.callsign}</span>
                  <span
                    className="robot-compendium-dmg"
                    style={{ color: DAMAGE_TYPE_COLOR[spec.damageType] }}
                  >
                    {t(`damageTypes.${spec.damageType}`)}
                  </span>
                  <span className="robot-compendium-xp">{t("robotShop.xpAmount", { xp })}</span>
                </header>

                <p className="robot-compendium-blurb">{t(`robots:variants.${variant}.blurb`)}</p>

                <dl className="robot-compendium-report">
                  <div className="robot-compendium-report-row robot-compendium-strength">
                    <dt>{t("robotShop.strengths")}</dt>
                    <dd>{t(`robots:variants.${variant}.strengths`)}</dd>
                  </div>
                  <div className="robot-compendium-report-row robot-compendium-weakness">
                    <dt>{t("robotShop.weakness")}</dt>
                    <dd>{t(`robots:variants.${variant}.weakness`)}</dd>
                  </div>
                </dl>

                <div className="robot-compendium-stats">
                  <div>
                    <span>{t("robotShop.statHp")}</span> {spec.maxHp}
                  </div>
                  <div>
                    <span>{t("robotShop.statSpd")}</span> {spec.speed}
                  </div>
                  <div>
                    <span>{t("robotShop.statDmg")}</span> {spec.damage}
                  </div>
                  <div>
                    <span>{t("robotShop.statRng")}</span> {spec.range}
                  </div>
                  <div>
                    <span>{t("robotShop.statRof")}</span> {spec.fireRate}/s
                  </div>
                </div>

                <div className="robot-compendium-abilities">
                  {spec.abilityGlyphs.map((glyph, i) => (
                    <span key={glyph} className="robot-compendium-ability">
                      <span aria-hidden>{glyph}</span>{" "}
                      {t(`robots:variants.${variant}.abilityLabel.${i}`)}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};
