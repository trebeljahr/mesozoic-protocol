import type React from "react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { isDebug } from "../debug";
import { getLevel } from "../levels";
import { useGame } from "../store";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { DebugMenuSection } from "./DebugMenuSection";
import { DebugProgressSettings } from "./DebugProgressSettings";
import { DifficultyButton } from "./DifficultyButton";
import { FullscreenToggle } from "./FullscreenToggle";
import { LanguageControls } from "./LanguageControls";
import { IconBook, IconMap, IconRefresh, IconTrophy } from "./MenuIcons";
import { MenuOverlay } from "./MenuOverlay";
import { SoundControls } from "./SoundControls";
import { useBackNavigation } from "./useBackNavigation";
import { useKeyboardHintsVisible } from "./useInputMode";

type Props = {
  onResume: () => void;
};

export const PauseMenu = ({ onResume }: Props) => {
  const { t } = useTranslation();
  const selectedLevelId = useGame((s) => s.selectedLevelId);
  const goToWorldMap = useGame((s) => s.goToWorldMap);
  const retry = useGame((s) => s.retryCurrentLevel);
  const setCompendiumOpen = useGame((s) => s.setCompendiumOpen);
  const setAchievementsOpen = useGame((s) => s.setAchievementsOpen);
  const [confirming, setConfirming] = useState<null | "worldMap" | "restart">(null);
  const showKeyboardHints = useKeyboardHintsVisible();
  // Confirmation dialog stacks on top of the pause overlay — back gesture
  // should cancel it (and stay paused), not slip through to resume.
  useBackNavigation(confirming !== null, () => setConfirming(null));

  const levelName = selectedLevelId
    ? t(`levels:names.${selectedLevelId}`, { defaultValue: getLevel(selectedLevelId).name })
    : "";

  if (confirming) {
    const isRestart = confirming === "restart";
    return (
      <ConfirmationDialog
        title={isRestart ? t("pause.restartTitle") : t("pause.returnTitle")}
        confirmLabel={isRestart ? t("pause.restart") : t("pause.return")}
        confirmClassName={isRestart ? "btn-warn" : "btn-danger"}
        onCancel={() => setConfirming(null)}
        onConfirm={isRestart ? retry : goToWorldMap}
      >
        <Trans
          i18nKey="pause.progressLost"
          values={{ level: levelName }}
          components={{ strong: <strong className="text-fg-secondary" /> }}
        />
      </ConfirmationDialog>
    );
  }

  return (
    <MenuOverlay
      title={t("pause.paused")}
      subtitle={levelName || null}
      onClose={onResume}
      closeLabel={t("pause.resume")}
      closeTitle={showKeyboardHints ? `${t("pause.resume")} (Esc)` : t("pause.resume")}
    >
      <div className="menu-panel-scroll">
        <DifficultyButton
          className="w-full min-h-11 mb-3 bg-surface-1 border border-border rounded-md px-3 py-2.5 flex items-center gap-3 cursor-pointer font-[inherit] text-fg-secondary transition-colors hover:border-border-strong hover:text-white"
          title={t("difficulty.change")}
          textStackClassName="flex-1"
          trailing={
            <span className="text-[10px] tracking-wide text-fg-faint uppercase">
              {t("common.change")}
            </span>
          }
        />
        <SoundControls />
        <FullscreenToggle />
        <LanguageControls />
        {isDebug && <DebugProgressSettings />}
        <ActionsCol>
          <button
            type="button"
            className="btn btn-ghost w-full flex items-center justify-center gap-2"
            onClick={() => setCompendiumOpen(true)}
          >
            <IconBook size={16} className="shrink-0" />
            {t("worldMap.compendium")}
          </button>
          <button
            type="button"
            className="btn btn-ghost w-full flex items-center justify-center gap-2"
            onClick={() => setAchievementsOpen(true)}
          >
            <IconTrophy size={16} className="shrink-0" />
            {t("worldMap.achievements")}
          </button>
          <button
            type="button"
            className="btn btn-warn w-full flex items-center justify-center gap-2"
            onClick={() => setConfirming("restart")}
          >
            <IconRefresh size={16} className="shrink-0" />
            {t("pause.restart")}
          </button>
          <button
            type="button"
            className="btn btn-danger w-full flex items-center justify-center gap-2"
            onClick={() => setConfirming("worldMap")}
          >
            <IconMap size={16} className="shrink-0" />
            {t("pause.returnToMap")}
          </button>
        </ActionsCol>
        {isDebug && (
          <div className="mt-5">
            <DebugMenuSection />
          </div>
        )}
      </div>
    </MenuOverlay>
  );
};

const ActionsCol = ({ children }: { children: React.ReactNode }) => (
  <div className="menu-panel-actions">{children}</div>
);
