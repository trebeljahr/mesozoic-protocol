import { useTranslation } from "react-i18next";
import { campaignSummary } from "../campaignSummary";
import { useGamepadMenuNavigation } from "../input/useGamepadMenuNavigation";
import { useGame } from "../store";
import { MenuOverlay } from "./MenuOverlay";

export const CampaignEpilogue = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation();
  const progress = useGame((state) => state.progress);
  const summary = campaignSummary(progress);
  useGamepadMenuNavigation(true);
  return (
    <MenuOverlay
      title={t("epilogue.title")}
      subtitle={t("epilogue.subtitle")}
      onClose={onClose}
      overlayClassName="!place-items-center"
      cardClassName="!min-h-0 !min-w-0 !w-[min(640px,calc(100vw-24px))] !max-h-[calc(100dvh-24px)]"
    >
      <div className="menu-panel-scroll text-sm leading-relaxed">
        <div className="border-l-2 border-cyan pl-4 my-3 space-y-3 text-fg-secondary">
          <p>{t("epilogue.body1")}</p>
          <p>{t("epilogue.body2")}</p>
          <p className="text-cyan">{t("epilogue.signoff")}</p>
        </div>
        <h2 className="text-gold font-bold mt-5 mb-2">{t("epilogue.summary")}</h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
          <dt>{t("epilogue.outposts")}</dt>
          <dd>{summary.cleared} / 30</dd>
          <dt>{t("epilogue.normalStars")}</dt>
          <dd>{summary.normalStars} / 90</dd>
          <dt>{t("modes:mode.label.breach")}</dt>
          <dd>{summary.breach} / 30</dd>
          <dt>{t("modes:mode.label.containment")}</dt>
          <dd>{summary.containment} / 30</dd>
        </dl>
        <h2 className="text-gold font-bold mt-5 mb-2">{t("epilogue.replayGoals")}</h2>
        <p>
          {summary.normalStars < 90
            ? t("epilogue.starGoal", { count: 90 - summary.normalStars })
            : t("epilogue.starsComplete")}
        </p>
        <p className="mt-2">
          {summary.breach + summary.containment < 60
            ? t("epilogue.challengeGoal", { count: 60 - summary.breach - summary.containment })
            : t("epilogue.challengesComplete")}
        </p>
        <p className="text-xs text-fg-muted mt-3">{t("epilogue.revisit")}</p>
        <button type="button" className="btn w-full mt-4" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    </MenuOverlay>
  );
};
