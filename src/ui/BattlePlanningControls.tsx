import { useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { useEditor } from "../editor/editorStore";
import { actionForKey, keyLabel, useKeyBindings } from "../input/keyBindings";
import { canUseBattlefield, isTrainingSession } from "../sim/playControl";
import { PREVIEW_DAMAGE_TYPES, type PreviewGroup } from "../sim/wavePreview";
import { ENEMY_LABEL } from "../sim/world";
import { useGame } from "../store";
import { useBattleView } from "./battleView";
import { activeModal } from "./modalFocus";
import { useIncomingWave } from "./useIncomingWave";
import "./battlePlanning.css";

export function BattlePlanningControls() {
  const { t } = useTranslation();
  const panelId = useId();
  const bindings = useKeyBindings((s) => s.bindings);
  const world = useGame((s) => s.world);
  const usable = useGame(canUseBattlefield);
  const planning = useGame((s) => s.planningPaused);
  const speed = useGame((s) => s.simulationSpeed);
  const screen = useGame((s) => s.screen);
  const training = isTrainingSession(world);
  const preview = useIncomingWave();
  const open = useBattleView((s) => s.previewOpen);
  const lane = useBattleView((s) => s.previewLane);
  const setOpen = useBattleView((s) => s.setPreviewOpen);
  const setLane = useBattleView((s) => s.setPreviewLane);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new world invalidates transient preview state
  useEffect(() => {
    setOpen(false);
  }, [world, setOpen]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new wave invalidates the selected lane
  useEffect(() => {
    setLane(null);
  }, [preview?.number, setLane]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || activeModal() || useEditor.getState().active) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
        )
      )
        return;
      const action = actionForKey(event, bindings);
      const state = useGame.getState();
      if (!canUseBattlefield(state)) return;
      if (action === "planning") {
        event.preventDefault();
        state.togglePlanningPause();
      }
      if (action === "speed") {
        event.preventDefault();
        state.setSimulationSpeed(state.simulationSpeed === 1 ? 2 : 1);
      }
      if (action === "preview") {
        event.preventDefault();
        const view = useBattleView.getState();
        view.setPreviewOpen(!view.previewOpen);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [bindings]);
  if (screen !== "playing") return null;
  return (
    <section className="battle-planning" aria-label={t("planning.controls")}>
      <div className="battle-planning-row">
        <button
          type="button"
          className="battle-control"
          aria-pressed={planning}
          disabled={!usable || training}
          title={
            training
              ? t("planning.training")
              : t("planning.shortcut", {
                  planning: keyLabel(bindings.planning),
                  menu: keyLabel(bindings.menu),
                })
          }
          onClick={() => useGame.getState().togglePlanningPause()}
        >
          {planning ? t("planning.resume") : t("planning.pause")}
        </button>
        <button
          type="button"
          className="battle-control"
          aria-label={t("planning.speedLabel", { speed })}
          disabled={!usable || training}
          title={
            training
              ? t("planning.training")
              : t("planning.speedHint", { key: keyLabel(bindings.speed) })
          }
          onClick={() => useGame.getState().setSimulationSpeed(speed === 1 ? 2 : 1)}
        >
          {speed}×
        </button>
        <button
          type="button"
          className="battle-control"
          aria-expanded={open}
          aria-controls={panelId}
          title={t("wavePreview.shortcut", { key: keyLabel(bindings.preview) })}
          disabled={!usable}
          onClick={() => setOpen(!open)}
        >
          {t("wavePreview.button", { wave: preview?.number ?? "—" })}
        </button>
      </div>
      {planning && (
        <p className="planning-notice" role="status">
          {t("planning.active")}
        </p>
      )}
      {open && usable && (
        <div className="incoming-wave-panel" id={panelId}>
          <div className="incoming-wave-heading">
            <strong>
              {preview
                ? t("wavePreview.heading", { wave: preview.number, count: preview.count })
                : t("wavePreview.none")}
            </strong>
            <button
              type="button"
              className="battle-control"
              aria-label={t("common.close")}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          {preview?.boss && <p className="wave-boss-warning">{t("wavePreview.bossWarning")}</p>}
          {preview && preview.lanes.length === 0 && <p>{t("wavePreview.empty")}</p>}
          {preview && <p className="wave-preview-help">{t("wavePreview.laneHint")}</p>}
          {preview?.lanes.map((entry) => (
            <section className="incoming-lane" key={entry.index}>
              <button
                type="button"
                className="incoming-lane-button"
                aria-pressed={lane === entry.index}
                onClick={() => setLane(lane === entry.index ? null : entry.index)}
              >
                {t("wavePreview.lane", { lane: entry.index + 1, count: entry.count })}
              </button>
              {entry.groups.map((group) => (
                <WaveGroup key={group.key} group={group} />
              ))}
              {/* Streams have stable authored order within this one wave. */}
              {entry.streams.map((stream, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: streams never reorder within a wave
                <p className="wave-preview-help" key={`${entry.index}-${index}`}>
                  {t("wavePreview.stream", {
                    kinds: stream.kinds.map((kind) => ENEMY_LABEL[kind]).join(", "),
                    min: stream.minInterval.toFixed(1),
                    max: stream.maxInterval.toFixed(1),
                  })}
                  {stream.shielded && ` · ${t("wavePreview.shielded")}`}
                </p>
              ))}
            </section>
          ))}
          {preview?.adaptivePossible && (
            <p className="wave-preview-help">{t("wavePreview.adaptive")}</p>
          )}
          {preview && <p className="wave-preview-help">{t("wavePreview.countHint")}</p>}
        </div>
      )}
    </section>
  );
}

function WaveGroup({ group }: { group: PreviewGroup }) {
  const { t } = useTranslation();
  const seen = useGame((s) =>
    group.bossVariant
      ? !!s.progress.matriarchsEncountered[group.bossVariant]
      : !!s.progress.encountered[group.kind],
  );
  const defenses = PREVIEW_DAMAGE_TYPES.filter((type) => group.resists[type] < 1);
  const counter = group.counters.map((type) => t(`damageTypes.${type}`)).join(", ");
  return (
    <div className="incoming-group">
      <div>
        <strong>
          {group.count} × {group.kind === "boss" ? t("wavePreview.boss") : ENEMY_LABEL[group.kind]}
        </strong>
        {!seen && <span className="incoming-new">{t("wavePreview.new")}</span>}
      </div>
      <p>
        {t("wavePreview.hp", { hp: group.hp })}
        {group.shield > 0 && ` · ${t("wavePreview.shield", { hp: group.shield })}`}
        {group.healAura && ` · ${t("wavePreview.healer")}`}
        {group.regen && ` · ${t("wavePreview.regen")}`}
      </p>
      {defenses.length > 0 && (
        <p>
          {t("wavePreview.defenses", {
            values: defenses
              .map(
                (type) => `${t(`damageTypes.${type}`)} ${Math.round(group.resists[type] * 100)}%`,
              )
              .join(", "),
          })}
        </p>
      )}
      <p>{counter ? t("wavePreview.counter", { types: counter }) : t("wavePreview.noCounter")}</p>
      {group.reinforcements && <p>{t("wavePreview.reinforcements")}</p>}
    </div>
  );
}
