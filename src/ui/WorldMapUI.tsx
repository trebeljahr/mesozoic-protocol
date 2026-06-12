import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { audio } from "../audio/AudioManager";
import { isDebug } from "../debug";
import { useWorldMapEditor } from "../editor/worldMapEditorStore";
import { type GamepadInputFrame, snapGamepadDirection, useGamepadInput } from "../input/gamepad";
import { useGamepadMenuNavigation } from "../input/useGamepadMenuNavigation";
import { LEVELS } from "../levels";
import { hasLevelBriefing } from "../levels/briefings";
import {
  getStars,
  hasUnlockedChallengeModes,
  hasUnlockedEndless,
  isLevelUnlocked,
  totalStars,
} from "../progress";
import { spentMetaStars } from "../sim/metaSkills";
import { useGame } from "../store";
import { DebugProgressSettings } from "./DebugProgressSettings";
import { DifficultyButton } from "./DifficultyButton";
import { EndlessUnlockedModal } from "./EndlessUnlockedModal";
import { prewarmEnemyIcons } from "./EnemyIcon.specs";
import { FullscreenToggle } from "./FullscreenToggle";
import { LanguageControls } from "./LanguageControls";
import {
  IconBolt,
  IconBook,
  IconCog,
  IconCoin,
  IconFloppy,
  IconLab,
  IconScroll,
  IconSquad,
  IconStar,
  IconTrophy,
} from "./MenuIcons";
import { MenuOverlay } from "./MenuOverlay";
import { ModesUnlockedModal } from "./ModesUnlockedModal";
import { QuickSettings } from "./QuickSettings";
import { SoundControls } from "./SoundControls";
import { StarDisplay } from "./StarDisplay";

const WORLD_MAP_NAV_INITIAL_REPEAT_MS = 320;
const WORLD_MAP_NAV_REPEAT_MS = 140;

const gamepadMenuDirection = (frame: GamepadInputFrame): -1 | 0 | 1 => {
  const dpadX = Number(frame.buttonDown("right")) - Number(frame.buttonDown("left"));
  const dpadY = Number(frame.buttonDown("down")) - Number(frame.buttonDown("up"));
  const stickX = snapGamepadDirection(frame.axis("leftX"));
  const stickY = snapGamepadDirection(frame.axis("leftY"));
  const x = dpadX || stickX;
  const y = dpadY || stickY;

  if (Math.abs(x) >= Math.abs(y) && x !== 0) return x > 0 ? 1 : -1;
  if (y !== 0) return y > 0 ? 1 : -1;
  return 0;
};

export const WorldMapUI = () => {
  const { t } = useTranslation();
  const progress = useGame((s) => s.progress);
  const hoveredLevelId = useGame((s) => s.hoveredLevelId);
  const startLevel = useGame((s) => s.startLevel);
  const setHoveredLevel = useGame((s) => s.setHoveredLevel);
  const setCompendiumOpen = useGame((s) => s.setCompendiumOpen);
  const setAchievementsOpen = useGame((s) => s.setAchievementsOpen);
  const setCreditsOpen = useGame((s) => s.setCreditsOpen);
  const setSkillTreeOpen = useGame((s) => s.setSkillTreeOpen);
  const setRobotShopOpen = useGame((s) => s.setRobotShopOpen);
  const setEndlessPickerOpen = useGame((s) => s.setEndlessPickerOpen);
  const goToSlots = useGame((s) => s.goToSlots);
  const [menuOpen, setMenuOpen] = useState(false);
  // One-shot explainer for Breach + Containment once the player has earned
  // 3 stars on any level. Skipped if the slot has already dismissed it.
  const showModesUnlocked =
    !progress.seenModesUnlockExplainer && hasUnlockedChallengeModes(progress);
  const endlessUnlocked = hasUnlockedEndless(progress);
  // One-shot Endless reveal after the final outpost falls. Held back while
  // the modes explainer is still pending so two dialogs never stack.
  const showEndlessUnlocked =
    !progress.seenEndlessUnlockExplainer && endlessUnlocked && !showModesUnlocked;
  const navRepeatRef = useRef<{ direction: -1 | 1 | 0; nextAt: number }>({
    direction: 0,
    nextAt: 0,
  });

  // Prewarm enemy thumbnails so opening the compendium from the world
  // map doesn't show empty bordered boxes while six GLB models bake
  // sequentially. The HUD does the same on the playing screen; this
  // covers the more common "browse compendium between levels" path.
  useEffect(() => {
    prewarmEnemyIcons();
  }, []);

  const hovered = LEVELS.find((l) => l.id === hoveredLevelId) ?? null;
  const hoveredUnlocked = hovered ? isLevelUnlocked(hovered.id, progress) : false;
  const hoveredStars = hovered ? getStars(progress, hovered.id) : 0;

  const total = totalStars(progress);
  // Each level caps at 5 stars: 3 normal + 1 breach + 1 containment. The
  // mode-totals are gated behind clearing normal first, so this max is
  // the theoretical ceiling once every level has been three-starred
  // and both challenge modes completed.
  const maxTotal = LEVELS.length * 5;
  const completed = LEVELS.filter((l) => getStars(progress, l.id) > 0).length;
  const availableStars = Math.max(0, total - spentMetaStars(progress.metaSkills));
  const bolts = progress.bolts;

  useGamepadMenuNavigation(menuOpen);

  useGamepadInput((frame) => {
    if (!frame.gamepad || menuOpen) return;
    if (useWorldMapEditor.getState().active) return;

    const unlocked = LEVELS.filter((level) => isLevelUnlocked(level.id, progress));
    const fallback = unlocked[0];

    const direction = gamepadMenuDirection(frame);
    if (direction === 0) {
      navRepeatRef.current = { direction: 0, nextAt: 0 };
    } else if (unlocked.length > 0) {
      const repeat = navRepeatRef.current;
      if (direction !== repeat.direction || frame.timestamp >= repeat.nextAt) {
        const currentIndex = unlocked.findIndex((level) => level.id === hoveredLevelId);
        const nextIndex =
          currentIndex === -1 ? 0 : (currentIndex + direction + unlocked.length) % unlocked.length;
        setHoveredLevel(unlocked[nextIndex].id);
        navRepeatRef.current = {
          direction,
          nextAt:
            frame.timestamp +
            (direction === repeat.direction
              ? WORLD_MAP_NAV_REPEAT_MS
              : WORLD_MAP_NAV_INITIAL_REPEAT_MS),
        };
      }
    }

    if (frame.buttonPressed("a")) {
      const target = LEVELS.find((level) => level.id === hoveredLevelId) ?? fallback;
      if (!target || !isLevelUnlocked(target.id, progress)) return;
      audio.ensureResumed();
      audio.play("level-select", "ui", 0.7, 80);
      startLevel(target.id);
      return;
    }

    if (frame.buttonPressed("b") || frame.buttonPressed("start")) setMenuOpen(true);
  });

  return (
    <div className="hud">
      <div className="world-map-stats absolute top-6 left-6 flex flex-col gap-2 pointer-events-none">
        <MetaChip label={t("worldMap.totalStars")} value={total} max={maxTotal} />
        <MetaChip label={t("worldMap.outposts")} value={completed} max={LEVELS.length} />
      </div>

      <div className="world-map-actions absolute top-6 right-6 pointer-events-none flex items-center gap-1.5">
        <QuickSettings />
        <button
          type="button"
          className="world-map-utility-btn bg-surface-1 border border-border rounded-md w-9 h-9 flex items-center justify-center backdrop-blur-sm pointer-events-auto cursor-pointer font-[inherit] text-fg-secondary transition-colors hover:border-blue hover:text-white"
          onClick={() => setMenuOpen(true)}
          aria-label={t("common.openMenu")}
          title={t("common.menu")}
        >
          <IconCog size={18} />
        </button>
      </div>

      <div className="world-map-difficulty absolute bottom-6 left-6 pointer-events-none">
        <DifficultyButton
          className="world-map-utility-btn bg-surface-1 border border-border rounded-md px-3 py-1.5 backdrop-blur-sm flex items-center gap-2 pointer-events-auto cursor-pointer font-[inherit] text-fg-secondary transition-colors hover:border-border-strong hover:text-white"
          title={t("difficulty.change")}
        />
      </div>

      <div className="world-map-rd absolute bottom-6 right-6 pointer-events-none flex flex-col items-end gap-2">
        {endlessUnlocked && (
          <button
            type="button"
            className="world-map-utility-btn bg-surface-1 border border-blue/50 rounded-md px-3.5 py-2 backdrop-blur-sm flex items-center gap-2 pointer-events-auto cursor-pointer font-[inherit] text-fg-secondary transition-colors hover:border-blue hover:text-white"
            onClick={() => setEndlessPickerOpen(true)}
            aria-label="Open endless mode"
            title="Endless — survive infinite escalating waves"
          >
            <span className="text-base leading-none font-bold text-cyan shrink-0" aria-hidden>
              ∞
            </span>
            <span className="text-sm font-bold tracking-wide uppercase">Endless</span>
          </button>
        )}
        <button
          type="button"
          className="world-map-utility-btn bg-surface-1 border border-border rounded-md px-3.5 py-2 backdrop-blur-sm flex items-center gap-2 pointer-events-auto cursor-pointer font-[inherit] text-fg-secondary transition-colors hover:border-blue hover:text-white"
          onClick={() => setCompendiumOpen(true, "lore")}
          aria-label={t("worldMap.loreAria")}
          title={t("worldMap.loreTitle")}
        >
          <IconScroll size={16} className="shrink-0" />
          <span className="text-sm font-bold tracking-wide uppercase">{t("worldMap.lore")}</span>
        </button>
        <button
          type="button"
          className="world-map-utility-btn bg-surface-1 border border-border rounded-md px-3.5 py-2 backdrop-blur-sm flex items-center gap-2 pointer-events-auto cursor-pointer font-[inherit] text-fg-secondary transition-colors hover:border-blue hover:text-white"
          onClick={() => setCompendiumOpen(true)}
          aria-label={t("worldMap.compendiumAria")}
          title={t("worldMap.compendium")}
        >
          <IconBook size={16} className="shrink-0" />
          <span className="text-sm font-bold tracking-wide uppercase">
            {t("worldMap.compendium")}
          </span>
        </button>
        <button
          type="button"
          className="world-map-utility-btn bg-surface-1 border border-border rounded-md px-3.5 py-2 backdrop-blur-sm flex items-center gap-2 pointer-events-auto cursor-pointer font-[inherit] text-fg-secondary transition-colors hover:border-blue hover:text-white"
          onClick={() => setAchievementsOpen(true)}
          aria-label={t("worldMap.achievementsAria")}
          title={t("worldMap.achievements")}
        >
          <IconTrophy size={16} className="shrink-0" />
          <span className="text-sm font-bold tracking-wide uppercase">
            {t("worldMap.achievements")}
          </span>
        </button>
        <button
          type="button"
          className="world-map-utility-btn bg-surface-1 border border-blue/40 rounded-md px-3.5 py-2 backdrop-blur-sm flex items-center gap-2 pointer-events-auto cursor-pointer font-[inherit] text-fg-secondary transition-colors hover:border-blue hover:text-white"
          onClick={() => setRobotShopOpen(true)}
          aria-label={t("worldMap.robotsAria")}
          title={t("worldMap.robotsTitle", { count: bolts })}
        >
          <IconSquad size={16} className="shrink-0" />
          <span className="text-sm font-bold tracking-wide uppercase">{t("worldMap.robots")}</span>
          <span
            className={`ml-1 inline-flex items-center gap-1.5 text-[13px] font-bold tabular-nums ${bolts > 0 ? "text-[#d7bf82]" : "text-fg-muted"}`}
          >
            <IconBolt size={15} className="shrink-0" />
            {bolts}
          </span>
        </button>
        <button
          type="button"
          className="world-map-utility-btn bg-surface-1 border border-gold/40 rounded-md px-3.5 py-2 backdrop-blur-sm flex items-center gap-2 pointer-events-auto cursor-pointer font-[inherit] text-fg-secondary transition-colors hover:border-gold hover:text-white"
          onClick={() => setSkillTreeOpen(true)}
          aria-label={t("worldMap.labAria")}
          title={
            availableStars > 0
              ? t("worldMap.labTitleUnspent", { count: availableStars })
              : t("worldMap.labTitle")
          }
        >
          <IconLab size={16} className="shrink-0" />
          <span className="text-sm font-bold tracking-wide uppercase">{t("worldMap.lab")}</span>
          <span
            className={`ml-1 inline-flex items-center justify-center gap-0.5 min-w-[28px] h-5 px-1.5 rounded-full ${availableStars > 0 ? "bg-gold text-black" : "bg-surface-2 text-fg-muted border border-border"} text-[11px] font-bold tabular-nums`}
          >
            <IconStar size={10} className="shrink-0" />
            {availableStars}
          </span>
        </button>
      </div>

      {menuOpen && (
        <MenuOverlay title={t("common.menu")} onClose={() => setMenuOpen(false)}>
          <div className="menu-panel-scroll">
            <SoundControls />
            <FullscreenToggle />
            <LanguageControls />
            {isDebug && <DebugProgressSettings />}
            <div className="menu-panel-actions">
              <DifficultyButton
                className="btn btn-ghost w-full flex items-center justify-center gap-2"
                label={t("difficulty.label")}
                size="sm"
                onBeforeOpen={() => setMenuOpen(false)}
              />
              <button
                type="button"
                className="btn btn-ghost w-full flex items-center justify-center gap-2"
                onClick={() => {
                  setMenuOpen(false);
                  setCreditsOpen(true);
                }}
              >
                <IconCoin size={16} className="shrink-0" />
                {t("menu.credits")}
              </button>
              <button
                type="button"
                className="btn btn-ghost w-full flex items-center justify-center gap-2"
                onClick={() => {
                  setMenuOpen(false);
                  goToSlots();
                }}
              >
                <IconFloppy size={16} className="shrink-0" />
                {t("menu.changeSaveSlot")}
              </button>
            </div>
          </div>
        </MenuOverlay>
      )}

      {hovered && (
        <div className="world-map-hover-card absolute left-6 bottom-24 min-w-[280px] max-w-[340px] bg-surface-2 border border-border-strong rounded-xl px-4 py-3.5 backdrop-blur-md pointer-events-none">
          <div className="flex flex-col gap-0.5 mb-2.5 pb-2.5 border-b border-[rgba(120,160,200,0.14)]">
            <span className="text-[10px] font-bold text-gold tracking-mid uppercase">
              {t("worldMap.outpost", { id: hovered.id })}
            </span>
            <span className="text-[15px] font-bold text-fg leading-tight">
              {t(`levels:names.${hovered.id}`)}
            </span>
          </div>
          {hoveredUnlocked && hasLevelBriefing(hovered.id) && (
            <p className="text-[11px] leading-snug text-fg-muted italic mb-2.5 pb-2.5 border-b border-[rgba(120,160,200,0.14)]">
              {t(`levels:briefings.${hovered.id}`)}
            </p>
          )}
          <TipRow label={t("common.waves")} value={hovered.waves.length} />
          <TipRow label={t("worldMap.startingGold")} value={`${hovered.startGold}g`} />
          <TipRow
            label={t("common.best")}
            value={
              hoveredUnlocked ? (
                <StarDisplay count={hoveredStars} size={14} />
              ) : (
                `\u{1F512} ${t("worldMap.locked")}`
              )
            }
          />
          {hoveredUnlocked && (
            <div className="mt-2.5 pt-2.5 border-t border-[rgba(120,160,200,0.14)] text-[11px] text-cyan tracking-wide uppercase text-center">
              {t("worldMap.deploy")}
            </div>
          )}
        </div>
      )}

      {showModesUnlocked && <ModesUnlockedModal />}
      {showEndlessUnlocked && <EndlessUnlockedModal />}
    </div>
  );
};

const MetaChip = ({ label, value, max }: { label: string; value: number; max: number }) => (
  <div className="world-map-meta bg-surface-1 border border-border rounded-md px-3.5 py-2 min-w-[110px] backdrop-blur-sm">
    <div className="text-[10px] font-bold tracking-wide text-gold">{label}</div>
    <div className="text-xl font-bold mt-0.5 tabular-nums">
      {value} <span className="text-fg-faint text-sm font-medium">/ {max}</span>
    </div>
  </div>
);

const TipRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex justify-between items-center text-xs text-fg-muted my-1.5">
    <span>{label}</span>
    <span className="text-fg font-semibold inline-flex items-center">{value}</span>
  </div>
);
