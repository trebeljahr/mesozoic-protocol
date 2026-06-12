import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditor } from "../editor/editorStore";
import { getLevelOrdinal } from "../levels";
import { effectiveTowerCost } from "../sim/metaSkills";
import type { TowerKind } from "../sim/types";
import { TOWER_BUILD_LIMIT, TOWER_LABEL, towerPillInfo } from "../sim/world";
import { useGame } from "../store";
import { BasePanel } from "./BasePanel";
import { BossBanner } from "./BossBanner";
import { DamageIcon } from "./DamageIcon";
import { DifficultyButton } from "./DifficultyButton";
import { DroneAssignNotice } from "./DroneAssignNotice";
import { prewarmEnemyIcons } from "./EnemyIcon.specs";
import { EnemyPanel } from "./EnemyPanel";
import { IconCog } from "./MenuIcons";
import { PauseMenu } from "./PauseMenu";
import { QuickSettings } from "./QuickSettings";
import { RobotPanel } from "./RobotPanel";
import { RobotSelectionPanel } from "./RobotSelectionPanel";
import { TowerPanel } from "./TowerPanel";
import { prewarmTowerIcons, TowerPreview } from "./TowerPreview";
import { TreePanel } from "./TreePanel";
import { useKeyboardHintsVisible } from "./useInputMode";
import { useIsMobile } from "./useMediaQuery";

const KINDS: TowerKind[] = ["pulse", "chain", "flame", "hive", "mortar", "cryo"];
// "1" is reserved for robot select — towers shift up by one so the row
// reads "1 = robot, 2..7 = towers" left-to-right.
const ROBOT_HOTKEY = "1";
const HOTKEYS: Record<TowerKind, string> = {
  pulse: "2",
  chain: "3",
  flame: "4",
  hive: "5",
  mortar: "6",
  cryo: "7",
};

export const HUD = () => {
  const { t } = useTranslation();
  // Atomic selectors so a single tick ticking down `nextWaveIn` doesn't
  // re-render the whole tower picker (and its 6 Canvas previews).
  const gold = useGame((s) => s.ui.gold);
  const lives = useGame((s) => s.ui.lives);
  const wave = useGame((s) => s.ui.wave);
  const totalWaves = useGame((s) => s.ui.totalWaves);
  const endless = useGame((s) => s.ui.endless);
  const endlessBestWave = useGame((s) => s.ui.endlessBestWave);
  const endlessMapName = useGame((s) => s.ui.endlessMapName);
  const endlessMapId = useGame((s) => s.ui.endlessMapId);
  const status = useGame((s) => s.ui.status);
  const waveActive = useGame((s) => s.ui.waveActive);
  const nextWaveIn = useGame((s) => s.ui.nextWaveIn);
  const canCallEarly = useGame((s) => s.ui.canCallEarly);
  const callEarlyBonus = useGame((s) => s.ui.callEarlyBonus);
  const callEarlyTimer = useGame((s) => s.ui.callEarlyTimer);
  const selectedKind = useGame((s) => s.selectedKind);
  const setSelectedKind = useGame((s) => s.setSelectedKind);
  const pendingTouchPlacement = useGame((s) => s.pendingTouchPlacement);
  const togglePause = useGame((s) => s.togglePause);
  const callWaveEarly = useGame((s) => s.callWaveEarly);
  const selectedLevelId = useGame((s) => s.selectedLevelId);
  const difficultyPickerOpen = useGame((s) => s.difficultyPickerOpen);
  const progress = useGame((s) => s.progress);
  const towerVersion = useGame((s) => s.towerVersion);
  // Mode chip + tower picker filtering both read the active mode.
  const runMode = useGame((s) => s.world.mode);
  const forbidden = useGame((s) => s.world.forbiddenTowers);
  const lockedLoadout = useGame((s) => s.world.lockedLoadout);

  // Endless drives the name off the snapshot (selectedLevelId is null on
  // endless runs so getLevel is never called with an arena id). Campaign
  // keeps the outpost name + ordinal.
  const levelName = endless
    ? endlessMapId
      ? t(`levels:endless.${endlessMapId}.name`)
      : endlessMapName
    : selectedLevelId
      ? t(`levels:names.${selectedLevelId}`)
      : "";
  const levelOrdinal = !endless && selectedLevelId ? getLevelOrdinal(selectedLevelId) : null;
  const levelOrdinalLabel = levelOrdinal ? `${levelOrdinal.current}` : "";
  const outpostLabel = endless
    ? t("hud.endless")
    : `${t("hud.outpost")}${levelOrdinalLabel ? ` ${levelOrdinalLabel}` : ""}`;
  const paused = status === "paused";
  // On the final wave the label embeds the n/m count, so the value
  // slot is free to show the wave state ("ACTIVE") rather than just
  // re-stating the same count. The non-final path keeps the original
  // ACTIVE/countdown semantics. Spawner clears waveActive once the
  // spawn queue empties even though stragglers may still be on the
  // field; on the final wave there is no next-wave countdown, so the
  // value would otherwise stick at "0s" until game-won fires. Keep
  // showing "ACTIVE" through that tail so the readout matches normal
  // waves.
  const waveStatus =
    waveActive || (!endless && wave >= totalWaves) ? t("hud.active") : `${nextWaveIn}s`;
  // During a campaign wave the status stat below carries the n/m count in
  // its label ("WAVE · n/m" while active, "FINAL · n/m" on the last wave),
  // so the standalone wave counter would just duplicate it — drop it then.
  // Wave 0, the call-early window, the between-wave "NEXT" countdown and
  // endless (no fixed total) keep the standalone counter as the only count.
  const countInWaveStatus =
    !endless && wave > 0 && !canCallEarly && (waveActive || wave >= totalWaves);
  const levelIntroVisible = useGame((s) => s.levelIntroVisible);
  const compendiumOpen = useGame((s) => s.compendiumOpen);
  // NewEnemyAlert auto-pauses the world but the pause-menu screen
  // should NOT render underneath it — the dossier is its own modal.
  const newEnemyAlertVisible = useGame((s) => s.newEnemyQueue.length > 0);
  // Editor pauses the world on activation, which would otherwise pop the
  // PauseMenu underneath the editor chrome — suppress it here.
  const editorActive = useEditor((s) => s.active);
  const selectedTowerId = useGame((s) => s.ui.selectedTowerId);
  const inspectedEnemyKind = useGame((s) => s.ui.inspectedEnemyKind);
  const selectedTreeId = useGame((s) => s.selectedTreeId);
  const selectedRockId = useGame((s) => s.selectedRockId);
  const isMobile = useIsMobile();
  const showKeyboardHints = useKeyboardHintsVisible();
  // On mobile the picker collapses to a small handle to free up the
  // canvas. Auto-closes on selection (one less tap to start placing)
  // and re-opens via the handle. On desktop the picker is always
  // visible — `pickerOpen` is ignored in that branch.
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    if (selectedKind !== null) setPickerOpen(false);
  }, [selectedKind]);
  const towers = useGame.getState().world.towers;
  void towerVersion;

  // Bake every tower + enemy thumbnail as soon as the HUD mounts so
  // the mobile build drawer, new-enemy popup, and compendium don't
  // flash empty placeholders on the first open. On slow mobile data
  // the GLB + DRACO fetch dominates the bake; warming the queue while
  // the player is still on the world map hides that latency.
  useEffect(() => {
    prewarmTowerIcons();
    prewarmEnemyIcons();
  }, []);

  useEffect(() => {
    if (
      selectedTowerId !== null ||
      inspectedEnemyKind !== null ||
      selectedTreeId !== null ||
      selectedRockId !== null
    ) {
      setPickerOpen(false);
    }
  }, [selectedTowerId, inspectedEnemyKind, selectedTreeId, selectedRockId]);

  useEffect(() => {
    const cls = "mobile-build-menu-open";
    if (isMobile && pickerOpen) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [isMobile, pickerOpen]);

  // Tap outside the open mobile picker → close it. Tower selection
  // already auto-closes via the selectedKind effect above; this covers
  // the "tap the canvas/HUD to dismiss" case so the drawer doesn't
  // strand itself open after a misfire. Desktop ignores pickerOpen so
  // skip the listener entirely there.
  useEffect(() => {
    if (!isMobile || !pickerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest(".tower-picker, .tower-picker-handle")) return;
      setPickerOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isMobile, pickerOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Level editor open → swallow gameplay hotkeys. Wave-spawn, hero
      // abilities, pause toggle and tower-kind digits are all gameplay
      // actions that have no meaning while the run is on hold. Esc still
      // routes through the editor's own listener (it owns close).
      if (useEditor.getState().active) return;
      if (e.code === "Space") {
        e.preventDefault();
        callWaveEarly();
        return;
      }
      if (e.code === "KeyP") {
        togglePause();
        return;
      }
      if (e.code === "Escape") {
        e.preventDefault();
        const s = useGame.getState();
        if (s.world.robot.dashAim) {
          s.cancelRobotDashAim();
          return;
        }
        if (
          s.selectedKind !== null ||
          s.world.selectedTowerId !== null ||
          s.inspectedEnemy.kind !== null ||
          s.selectedTreeId !== null ||
          s.selectedRockId !== null ||
          s.world.robot.selected ||
          s.robotPanelOpen
        ) {
          s.clearSelection();
          (document.activeElement as HTMLElement | null)?.blur();
          return;
        }
        if (s.world.status === "running" || s.world.status === "paused") togglePause();
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      if (e.code === "KeyQ") {
        e.preventDefault();
        useGame.getState().triggerRobotAbility(0);
        return;
      }
      if (e.code === "KeyW") {
        e.preventDefault();
        useGame.getState().triggerRobotAbility(1);
        return;
      }
      if (e.code === "KeyE") {
        e.preventDefault();
        useGame.getState().triggerRobotAbility(2);
        return;
      }
      if (e.code === "KeyR") {
        e.preventDefault();
        useGame.getState().triggerRobotAbility(3);
        return;
      }
      const digit = e.key;
      if (digit === ROBOT_HOTKEY) {
        const s = useGame.getState();
        s.selectRobotUnit(!s.world.robot.selected);
        return;
      }
      const kind = (Object.keys(HOTKEYS) as TowerKind[]).find((k) => HOTKEYS[k] === digit);
      if (kind) setSelectedKind(selectedKind === kind ? null : kind);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePause, setSelectedKind, selectedKind, callWaveEarly]);

  return (
    <div className="hud">
      <div className="hud-top">
        <Stat label={t("hud.gold")} value={gold} accentClass="text-gold" />
        <Stat label={t("hud.lives")} value={lives} accentClass="text-red" />
        {!countInWaveStatus && (
          <Stat
            label={t("hud.wave")}
            value={endless ? `${wave}` : `${wave} / ${totalWaves}`}
            accentClass="text-blue"
          />
        )}
        {endless && (
          <Stat
            label={t("hud.best")}
            value={endlessBestWave > 0 ? `${endlessBestWave}` : "—"}
            accentClass="text-gold"
          />
        )}
        {wave === 0 ? (
          <button
            type="button"
            className="stat call-wave-btn"
            onClick={callWaveEarly}
            title={showKeyboardHints ? t("hud.startWavesTitleKey") : t("hud.startWavesTitle")}
          >
            <div className="stat-label">
              ▶ {t("hud.startWavesBtn")} <span className="kbd-only">[Space]</span>
            </div>
            <div className="stat-value">{t("hud.clickToBegin")}</div>
          </button>
        ) : canCallEarly ? (
          <button
            type="button"
            className="stat call-wave-btn"
            onClick={callWaveEarly}
            title={showKeyboardHints ? t("hud.callWaveTitleKey") : t("hud.callWaveTitle")}
          >
            <div className="stat-label">
              ▶ {t("hud.callWaveBtn")} <span className="kbd-only">[Space]</span>
            </div>
            <div className="stat-value">
              +{callEarlyBonus}g<span className="call-wave-sub"> · {callEarlyTimer}s</span>
            </div>
          </button>
        ) : (
          <Stat
            label={
              endless
                ? waveActive
                  ? t("hud.wave")
                  : t("hud.next")
                : wave >= totalWaves
                  ? t("hud.final", { wave, total: totalWaves })
                  : waveActive
                    ? t("hud.waveCount", { wave, total: totalWaves })
                    : t("hud.next")
            }
            value={waveStatus}
            accentClass="text-mint"
          />
        )}
        {levelName && (
          <div className="outpost-pill">
            <div className="outpost-label">{outpostLabel}</div>
            <div className="outpost-name" title={`${levelOrdinalLabel} · ${levelName}`}>
              {levelName}
            </div>
          </div>
        )}
        <DifficultyButton
          className="bg-surface-1 border border-border rounded-md px-2.5 py-2 backdrop-blur-sm flex items-center gap-2 cursor-pointer font-[inherit] text-fg transition-colors hover:border-border-strong"
          label={t("hud.mode")}
          size="sm"
        />
        {runMode !== "normal" && (
          <div
            className={`rounded-md px-2.5 py-2 backdrop-blur-sm flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide border ${
              runMode === "breach"
                ? "border-orange text-orange bg-[rgba(255,178,102,0.10)]"
                : "border-red text-red bg-[rgba(255,90,122,0.10)]"
            }`}
            title={runMode === "breach" ? t("hud.breachMode") : t("hud.containmentMode")}
          >
            <span aria-hidden>{runMode === "breach" ? "✦" : "▣"}</span>
            <span>{t(`modes:mode.label.${runMode}`)}</span>
          </div>
        )}
      </div>

      <div className="hud-corner-cluster absolute top-4 right-4 flex items-center gap-1.5">
        <QuickSettings />
        <button
          type="button"
          className="hud-menu-btn"
          onClick={togglePause}
          aria-label={t("common.openMenu")}
          title={showKeyboardHints ? `${t("common.menu")} (Esc)` : t("common.menu")}
        >
          <IconCog size={18} />
          <span className="kbd-only text-[10px] font-bold tracking-wide px-1.5 py-0.5 border border-[rgba(159,216,255,0.35)] rounded-sm text-blue bg-tint-blue-soft uppercase">
            Esc
          </span>
        </button>
      </div>

      {isMobile && !pickerOpen && selectedKind === null && (
        <button
          type="button"
          className="tower-picker-handle"
          onClick={() => {
            // Treat opening the build drawer as "leave inspection mode"
            // first so tower/tree/enemy panels don't fight the picker.
            useGame.getState().clearSelection();
            setPickerOpen(true);
          }}
          aria-expanded={false}
          aria-label={t("hud.openBuildMenu")}
          title={t("hud.build")}
        >
          <span className="tower-picker-handle-icon" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          <span className="tower-picker-handle-label">{t("hud.build")}</span>
        </button>
      )}

      {isMobile && !pickerOpen && selectedKind !== null && (
        <button
          type="button"
          className="tower-picker-handle tower-picker-handle-cancel"
          onClick={() => useGame.getState().clearSelection()}
          aria-label={t("hud.cancelPlacingAria", { tower: TOWER_LABEL[selectedKind] })}
          title={t("hud.cancelPlacement")}
          data-ui-sound="close"
        >
          <span className="tower-picker-handle-cancel-icon" aria-hidden>
            ×
          </span>
          <span className="tower-picker-handle-label">{t("common.cancel")}</span>
          <span className="tower-picker-handle-active">{TOWER_LABEL[selectedKind]}</span>
        </button>
      )}

      {isMobile && !pickerOpen && selectedKind !== null && pendingTouchPlacement !== null && (
        <button
          type="button"
          className="tower-picker-handle tower-picker-handle-confirm"
          onClick={() => useGame.getState().confirmTouchPlacement()}
          aria-label={t("hud.confirmPlacingAria", { tower: TOWER_LABEL[selectedKind] })}
          title={t("hud.confirmPlacement")}
          data-ui-sound="select"
        >
          <span className="tower-picker-handle-confirm-icon" aria-hidden>
            ✓
          </span>
          <span className="tower-picker-handle-label">{t("hud.place")}</span>
        </button>
      )}

      {(!isMobile || pickerOpen) && (
        <div className={`tower-picker ${isMobile ? "tower-picker-mobile-open" : ""}`}>
          {isMobile && (
            <button
              type="button"
              className="tower-picker-close"
              onClick={() => setPickerOpen(false)}
              aria-label={t("hud.closeBuildMenu")}
              title={t("common.close")}
            >
              ×
            </button>
          )}
          {KINDS.filter(
            (kind) =>
              !forbidden.has(kind) && (lockedLoadout === null || lockedLoadout.includes(kind)),
          ).map((kind) => {
            const existingSameKind = towers.filter((t) => t.kind === kind).length;
            const atLimit = existingSameKind >= TOWER_BUILD_LIMIT;
            const cost = effectiveTowerCost(kind, progress.metaSkills);
            const affordable = !atLimit && gold >= cost;
            const active = selectedKind === kind;
            const pill = towerPillInfo(kind);
            return (
              <button
                type="button"
                key={kind}
                className={`tower-card ${active ? "active" : ""} ${affordable ? "" : "disabled"}`}
                data-ui-sound={active ? "close" : !affordable ? "error" : "select"}
                onClick={(e) => {
                  setSelectedKind(selectedKind === kind ? null : kind);
                  e.currentTarget.blur();
                }}
                title={`${TOWER_LABEL[kind]} · ${t(`damageTypes.${pill.type}`)} · ${atLimit ? `MAX (${TOWER_BUILD_LIMIT})` : `${cost}g`}${showKeyboardHints ? ` [${HOTKEYS[kind]}]` : ""}`}
              >
                {active && (
                  <span className="card-cancel" aria-hidden>
                    ×
                  </span>
                )}
                <div className="tower-preview-wrap">
                  <TowerPreview kind={kind} />
                  <span className="tower-hot kbd-only">{HOTKEYS[kind]}</span>
                </div>
                <div className="flex items-center justify-between gap-1 mt-1">
                  <span
                    className="inline-flex items-center"
                    style={{ color: pill.color }}
                    title={pill.label}
                  >
                    <DamageIcon type={pill.type} size={13} title={pill.label} />
                  </span>
                  <span className="tower-cost text-[11px] font-bold tabular-nums text-gold">
                    {atLimit ? "MAX" : `${cost}g`}
                  </span>
                </div>
                <div className="tower-name text-[10px] font-semibold leading-tight whitespace-nowrap overflow-hidden text-ellipsis text-center">
                  {TOWER_LABEL[kind]}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <TowerPanel />
      <BasePanel />
      <EnemyPanel />
      <TreePanel />
      <RobotSelectionPanel />
      <RobotPanel />
      <BossBanner />
      <DroneAssignNotice />

      {paused &&
        !compendiumOpen &&
        !levelIntroVisible &&
        !newEnemyAlertVisible &&
        !difficultyPickerOpen &&
        !editorActive && <PauseMenu onResume={togglePause} />}
    </div>
  );
};

const Stat = ({
  label,
  value,
  accentClass,
}: {
  label: string;
  value: string | number;
  accentClass: string;
}) => (
  <div className="stat">
    <div className={`stat-label ${accentClass}`}>{label}</div>
    <div className="stat-value">{value}</div>
  </div>
);
