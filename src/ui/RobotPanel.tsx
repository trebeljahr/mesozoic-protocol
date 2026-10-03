import { useTranslation } from "react-i18next";
import { type BindingAction, keyLabel, useKeyBindings } from "../input/keyBindings";
import type { RobotAbilitySlot } from "../sim/types";
import { clamp01 } from "../sim/vec2";
import { useGame } from "../store";
import { fmtCompact } from "./format";
import { useKeyboardHintsVisible } from "./useInputMode";

const ABILITY_SLOTS: RobotAbilitySlot[] = [0, 1, 2, 3];

// In-game HUD strip: HP/XP bar plus the four ability buttons. Clicking
// the portrait area (name / HP / XP / combat stats) selects the robot as
// the active unit (next ground tap is a move order) and the whole strip
// gets a selected outline to mirror the field-mesh selection ring. The
// small "i" badge opens the read-only robot overview overlay. Clicking an
// ability triggers it the same way the hotkey would.
export const RobotPanel = () => {
  const { t } = useTranslation();
  const bindings = useKeyBindings((s) => s.bindings);
  const showKeyboardHints = useKeyboardHintsVisible();
  const label = useGame((s) => s.ui.robotLabel);
  const variant = useGame((s) => s.ui.robotVariant);
  const hp = useGame((s) => s.ui.robotHp);
  const maxHp = useGame((s) => s.ui.robotMaxHp);
  const alive = useGame((s) => s.ui.robotAlive);
  const respawnRemaining = useGame((s) => s.ui.robotRespawnRemaining);
  const level = useGame((s) => s.ui.robotLevel);
  const xpInto = useGame((s) => s.ui.robotXpInto);
  const xpNeed = useGame((s) => s.ui.robotXpNeed);
  const cooldowns = useGame((s) => s.ui.robotAbilityCooldowns);
  const activeRemaining = useGame((s) => s.ui.robotAbilityActiveRemaining);
  const maxCooldowns = useGame((s) => s.ui.robotAbilityMaxCooldowns);
  const glyphs = useGame((s) => s.ui.robotAbilityGlyphs);
  const kills = useGame((s) => s.ui.robotKills);
  const dps = useGame((s) => s.ui.robotDps);
  const damageDealt = useGame((s) => s.ui.robotDamageDealt);
  const trigger = useGame((s) => s.triggerRobotAbility);
  const panelOpen = useGame((s) => s.robotPanelOpen);
  const setRobotPanelOpen = useGame((s) => s.setRobotPanelOpen);
  const selectRobotUnit = useGame((s) => s.selectRobotUnit);
  const selected = useGame((s) => s.ui.robotSelected);

  const hpPct = maxHp > 0 ? clamp01(hp / maxHp) : 0;
  const xpPct = xpNeed > 0 ? clamp01(xpInto / xpNeed) : 0;

  return (
    <div className={`robot-panel ${selected ? "selected" : ""}`}>
      <button
        type="button"
        className={`robot-info-btn ${panelOpen ? "active" : ""}`}
        onClick={() => setRobotPanelOpen(!panelOpen)}
        aria-pressed={panelOpen}
        aria-label={t("robotShop.toggleOverview")}
        title={t("robotShop.robotOverview")}
      >
        i
      </button>
      <button
        type="button"
        className={`robot-portrait ${selected ? "active" : ""}`}
        onClick={() => selectRobotUnit(!selected)}
        aria-pressed={selected}
        aria-label={t("robotShop.selectRobot")}
        title={
          showKeyboardHints
            ? `${t("robotShop.selectRobot")} [${keyLabel(bindings.robot)}]`
            : t("robotShop.selectRobot")
        }
      >
        <div className="robot-name">
          {t("robotShop.mecha")} · {label.toUpperCase()}
          <span className="robot-level">{t("robotShop.levelShort", { level })}</span>
        </div>
        <div className="robot-xp-row">
          <div className="robot-xp-bar">
            <div className="robot-xp-fill" style={{ width: `${xpPct * 100}%` }} />
          </div>
          <span className="robot-xp-value">
            {t("robotShop.xpValue", { into: xpInto, need: xpNeed })}
          </span>
        </div>
        <div className="robot-hp-row">
          <span className="robot-hp-label">{t("robotShop.statHp")}</span>
          <div className="robot-hp-bar">
            <div className="robot-hp-fill" style={{ width: `${hpPct * 100}%` }} />
          </div>
          <span className="robot-hp-value">
            {alive
              ? `${hp}/${maxHp}`
              : respawnRemaining > 0
                ? t("robotShop.respawn", { seconds: respawnRemaining })
                : "—"}
          </span>
        </div>
        <div className="robot-combat-row">
          {t("robotShop.combatRow", {
            dps: dps.toFixed(1),
            kills,
            dealt: fmtCompact(damageDealt),
          })}
        </div>
      </button>
      <div className="robot-abilities">
        {ABILITY_SLOTS.map((slot) => {
          const key = keyLabel(bindings[`ability${slot + 1}` as BindingAction]);
          const cd = cooldowns[slot];
          const active = activeRemaining[slot] > 0;
          const max = maxCooldowns[slot];
          const ready = cd === 0 && alive;
          const fillPct = max > 0 ? clamp01(1 - cd / max) : 1;
          const hint = showKeyboardHints ? ` [${key}]` : "";
          const abilityLabel = t(`robots:variants.${variant}.abilityLabel.${slot}`);
          const title = active
            ? t("robotShop.abilityActiveTitle", {
                label: abilityLabel,
                hint,
                seconds: activeRemaining[slot].toFixed(1),
              })
            : `${abilityLabel}${hint}`;
          return (
            <button
              key={slot}
              type="button"
              className={`robot-ability ${active ? "active" : ""} ${ready ? "ready" : "cooling"}`}
              onClick={() => trigger(slot)}
              disabled={!ready}
              aria-label={title}
              aria-pressed={active}
              title={title}
            >
              <span className="robot-ability-glyph">{glyphs[slot]}</span>
              <span className="robot-ability-key kbd-only">{key}</span>
              <div className="robot-ability-fill" style={{ width: `${fillPct * 100}%` }} />
              {active && <span className="robot-ability-active">{t("robotShop.on")}</span>}
              {cd > 0 && <span className="robot-ability-cd">{cd.toFixed(1)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
};
