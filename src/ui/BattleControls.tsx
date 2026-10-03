import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
import "./battleControls.css";

export function BattleControls() {
  const { t } = useTranslation();
  const panelId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const [availableHeight, setAvailableHeight] = useState<number>();
  const bindings = useKeyBindings((s) => s.bindings);
  const world = useGame((s) => s.world);
  const usable = useGame(canUseBattlefield);
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
      if (!canUseBattlefield(state) || isTrainingSession(state.world)) return;
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
  useLayoutEffect(() => {
    if (screen !== "playing" || training) return;
    const section = sectionRef.current;
    if (!section) return;
    const robot = document.querySelector(".robot-panel");
    const measure = () => {
      const top = section.getBoundingClientRect().top;
      const bottom = robot?.getBoundingClientRect().top ?? window.innerHeight;
      setAvailableHeight(Math.max(0, bottom - top - 8));
    };
    measure();
    // Text scaling and translated HUD content can resize the robot strip even
    // when the viewport does not change. Observe both ends of the free space.
    const observer = new ResizeObserver(measure);
    if (robot) observer.observe(robot);
    observer.observe(section);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [screen, training]);
  if (screen !== "playing" || training) return null;
  return (
    <section
      ref={sectionRef}
      className="battle-controls"
      style={{ maxHeight: availableHeight }}
      aria-label={t("battleControls.controls")}
    >
      <div className="battle-controls-row">
        <button
          type="button"
          className="battle-control"
          aria-label={t("battleControls.speedLabel", { speed })}
          disabled={!usable || training}
          title={
            training
              ? t("battleControls.training")
              : t("battleControls.speedHint", { key: keyLabel(bindings.speed) })
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
