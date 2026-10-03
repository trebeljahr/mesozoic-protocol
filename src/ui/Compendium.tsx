import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGamepadInput } from "../input/gamepad";
import { LEVELS } from "../levels";
import { LORE_FRAGMENT_KIND, LORE_FRAGMENT_ORDER } from "../levels/lore";
import { getStars, hasEncountered, hasMatriarchEncountered } from "../progress";
import { MECHANIC_ORDER, type MechanicId } from "../sim/mechanicsText";
import type { BossVariant, DamageType, EnemyKind, TowerKind } from "../sim/types";
import {
  ADAPT_TRIGGER_LEVEL,
  ADAPTIVE_TINT_BY_TYPE,
  BOSS_VARIANT_LABEL,
  BOSS_VARIANT_RESIST,
  BOSS_VARIANT_SLOW_RESIST,
  BOSS_VARIANT_STATS,
  ENEMY_LABEL,
  ENEMY_RESIST,
  ENEMY_SLOW_RESIST,
  ENEMY_STATS,
  HIVE_BASE_DRONES,
  HIVE_BASE_SERVICE_BUFF,
  TOWER_COST,
  TOWER_LABEL,
  TOWER_STATS,
  towerPillInfo,
} from "../sim/world";
import type { CompendiumSection } from "../store";
import { useGame } from "../store";
import { DamageIcon } from "./DamageIcon";
import { EnemyIcon } from "./EnemyIcon";
import { EnemyPreview } from "./EnemyPreview";
import { MechanicIcon } from "./MechanicIcon";
import { MechanicPreview } from "./MechanicPreview";
import { activeModal } from "./modalFocus";
import { RobotCompendiumSection } from "./RobotCompendiumSection";
import { TowerDiorama } from "./TowerDiorama";
import { TowerPreview } from "./TowerPreview";
import { useModalFocus } from "./useModalFocus";

type Section = CompendiumSection;

// Compendium enemy entries — either a base species or a biome-themed
// matriarch variant. The list is rendered in one row so the player
// reads the dossier as a single bestiary, but stats/labels dispatch on
// `kind` since the variant data lives in BOSS_VARIANT_* tables.
type EnemyEntry = { kind: "species"; id: EnemyKind } | { kind: "matriarch"; variant: BossVariant };
type CompendiumLocks = ReturnType<typeof useGame.getState>["compendiumLocks"];

const ENEMY_SPECIES_ORDER: EnemyKind[] = [
  "raptor",
  "swarm",
  "para",
  "allosaur",
  "stego",
  "armored",
  "titan",
];

// Matriarchs are ordered by the wave they first appear on so the
// compendium reads in the same order the player encounters them.
const MATRIARCH_ORDER: BossVariant[] = ["raptor", "stego", "para", "allosaur", "armored", "apex"];

const ENEMY_ENTRIES: EnemyEntry[] = [
  ...ENEMY_SPECIES_ORDER.map<EnemyEntry>((id) => ({ kind: "species", id })),
  ...MATRIARCH_ORDER.map<EnemyEntry>((variant) => ({ kind: "matriarch", variant })),
];

const entryKey = (e: EnemyEntry): string =>
  e.kind === "species" ? `species:${e.id}` : `matriarch:${e.variant}`;

const entrySeen = (
  e: EnemyEntry,
  p: ReturnType<typeof useGame.getState>["progress"],
  locks?: CompendiumLocks,
): boolean => {
  const lockedOverride = e.kind === "species" ? locks?.enemies[e.id] : locks?.matriarchs[e.variant];
  if (lockedOverride !== undefined) return !lockedOverride;
  return e.kind === "species" ? hasEncountered(p, e.id) : hasMatriarchEncountered(p, e.variant);
};

const entryLabel = (e: EnemyEntry): string =>
  e.kind === "species" ? ENEMY_LABEL[e.id] : BOSS_VARIANT_LABEL[e.variant];

// i18n catalog keys — enemy/matriarch prose lives in the `enemies`
// namespace, read via react-i18next so the compendium localizes.
const entrySubtitleKey = (e: EnemyEntry): string =>
  e.kind === "species" ? `enemies:${e.id}.subtitle` : `enemies:matriarch.${e.variant}.subtitle`;

const entryDescriptionKey = (e: EnemyEntry): string =>
  e.kind === "species"
    ? `enemies:${e.id}.description`
    : `enemies:matriarch.${e.variant}.description`;

const TOWER_ORDER: TowerKind[] = ["pulse", "chain", "cryo", "mortar", "flame", "hive"];
const DAMAGE_TYPES: DamageType[] = ["kinetic", "electric", "cold", "explosive", "flame"];

const SECTION_ORDER: Section[] = ["enemy", "tower", "mechanic", "robot", "lore"];

export const Compendium = () => {
  const { t } = useTranslation();
  const progress = useGame((s) => s.progress);
  const compendiumLocks = useGame((s) => s.compendiumLocks);
  const setCompendiumOpen = useGame((s) => s.setCompendiumOpen);
  const initialSection = useGame((s) => s.compendiumInitialSection);
  const clearInitialSection = useGame((s) => s.clearCompendiumInitialSection);

  const [section, setSection] = useState<Section>(initialSection ?? "enemy");

  // The world-map "Lore" shortcut sets compendiumInitialSection so the
  // panel opens directly to the lore tab. Consume it here on mount so
  // subsequent opens (via the regular Compendium button) revert to the
  // default enemy view.
  useEffect(() => {
    if (initialSection) clearInitialSection();
    // Only on mount — re-firing on prop change would steal focus while
    // the user is already navigating tabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const firstEncountered = useMemo(
    () => ENEMY_ENTRIES.find((e) => entrySeen(e, progress, compendiumLocks)) ?? ENEMY_ENTRIES[0],
    [progress, compendiumLocks],
  );
  const [selectedEnemy, setSelectedEnemy] = useState<EnemyEntry>(firstEncountered);
  const [selectedTower, setSelectedTower] = useState<TowerKind>(TOWER_ORDER[0]);
  const [selectedMech, setSelectedMech] = useState<MechanicId>(MECHANIC_ORDER[0]);

  const dialogRef = useModalFocus(() => setCompendiumOpen(false));

  // The global menu-nav hook (App.tsx) already wires dpad focus, A
  // activate, and B/Start escape for every modal. Compendium adds
  // LB/RB to jump between sections so a gamepad user doesn't have to
  // step focus through dozens of item tabs just to switch tab strips.
  // No conflict with Placement's LB/RB tower cycling — that handler
  // early-returns while compendiumOpen is true.
  const sectionRef = useRef(section);
  sectionRef.current = section;
  useGamepadInput((frame) => {
    if (!frame.gamepad || activeModal() !== dialogRef.current) return;
    const cycle = (direction: -1 | 1) => {
      const idx = SECTION_ORDER.indexOf(sectionRef.current);
      const next = (idx + direction + SECTION_ORDER.length) % SECTION_ORDER.length;
      setSection(SECTION_ORDER[next]);
    };
    if (frame.buttonPressed("lb")) cycle(-1);
    if (frame.buttonPressed("rb")) cycle(1);
  });

  return (
    <div className="overlay compendium-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("compendium.title")}
        tabIndex={-1}
        className="compendium-card"
      >
        <header className="compendium-header">
          <div>
            <h1>{t("compendium.title")}</h1>
          </div>
          <button
            type="button"
            className="btn-close compendium-close"
            onClick={() => setCompendiumOpen(false)}
            aria-label={t("compendium.close")}
            title={t("compendium.close")}
          >
            ×
          </button>
        </header>

        <div className="compendium-sections">
          {SECTION_ORDER.map((s) => (
            <button
              type="button"
              key={s}
              className={`compendium-section ${section === s ? "active" : ""}`}
              onClick={() => setSection(s)}
              aria-pressed={section === s}
            >
              {t(`compendium.section.${s}`)}
            </button>
          ))}
        </div>

        {section === "enemy" && (
          <EnemySectionView
            selected={selectedEnemy}
            setSelected={setSelectedEnemy}
            progress={progress}
            compendiumLocks={compendiumLocks}
          />
        )}
        {section === "tower" && (
          <TowerSectionView selected={selectedTower} setSelected={setSelectedTower} />
        )}
        {section === "mechanic" && (
          <MechanicSectionView selected={selectedMech} setSelected={setSelectedMech} />
        )}
        {section === "robot" && <RobotCompendiumSection progress={progress} />}
        {section === "lore" && <LoreSectionView progress={progress} />}
      </div>
    </div>
  );
};

// --- Enemy section ---------------------------------------------------------

const EnemySectionView = ({
  selected,
  setSelected,
  progress,
  compendiumLocks,
}: {
  selected: EnemyEntry;
  setSelected: (e: EnemyEntry) => void;
  progress: ReturnType<typeof useGame.getState>["progress"];
  compendiumLocks: CompendiumLocks;
}) => {
  const { t } = useTranslation();
  const selectedSeen = entrySeen(selected, progress, compendiumLocks);
  const selectedKey = entryKey(selected);
  return (
    <div className="compendium-browser">
      <div className="compendium-selector">
        {ENEMY_ENTRIES.map((entry) => {
          const seen = entrySeen(entry, progress, compendiumLocks);
          const key = entryKey(entry);
          const isMatriarch = entry.kind === "matriarch";
          return (
            <button
              type="button"
              key={key}
              className={`compendium-tab ${selectedKey === key ? "active" : ""} ${seen ? "" : "locked"} ${isMatriarch ? "matriarch" : ""}`}
              onClick={() => setSelected(entry)}
              disabled={!seen}
              aria-pressed={selectedKey === key}
              title={seen ? entryLabel(entry) : t("compendium.notEncountered")}
            >
              <span className="compendium-tab-icon" aria-hidden>
                {seen ? (
                  entry.kind === "species" ? (
                    <EnemyIcon kind={entry.id} />
                  ) : (
                    <EnemyIcon kind="boss" bossVariant={entry.variant} />
                  )
                ) : (
                  <span className="compendium-tab-locked-glyph">?</span>
                )}
              </span>
              <span className="compendium-tab-name">{seen ? entryLabel(entry) : "???"}</span>
            </button>
          );
        })}
      </div>

      <div className="compendium-detail">
        <div className="compendium-detail-preview">
          {selectedSeen ? (
            selected.kind === "species" ? (
              <EnemyPreview kind={selected.id} size={360} />
            ) : (
              <EnemyPreview kind="boss" bossVariant={selected.variant} size={360} />
            )
          ) : (
            <div className="compendium-detail-locked">?</div>
          )}
        </div>
        <div className="compendium-detail-info">
          {selectedSeen ? (
            <>
              <div className="compendium-detail-head">
                <div className="compendium-detail-name">{entryLabel(selected)}</div>
                <div className="compendium-detail-subtitle">{t(entrySubtitleKey(selected))}</div>
              </div>
              <p className="compendium-detail-desc">{t(entryDescriptionKey(selected))}</p>
              {selected.kind === "matriarch" && (
                <div className="flex items-center gap-2.5 px-3 py-2 mb-2 rounded-lg bg-[rgba(255,90,58,0.10)] border border-[rgba(255,90,58,0.45)]">
                  <span className="text-[10px] tracking-[0.16em] text-[#ff8a6a] uppercase font-bold">
                    {t("enemyPanel.leakDamage")}
                  </span>
                  <span className="ml-auto text-[#ffb39a] text-[13px] font-semibold tabular-nums">
                    {t("enemyPanel.leakLives", {
                      damage: BOSS_VARIANT_STATS[selected.variant].damage,
                    })}
                  </span>
                </div>
              )}
              <EnemyStatRow entry={selected} />
              <EnemyResistRow entry={selected} />
            </>
          ) : (
            <div className="compendium-detail-locked-text">
              <div className="compendium-detail-name">{t("compendium.unknownSpecies")}</div>
              <p className="compendium-detail-desc">{t("compendium.unknownSpeciesDesc")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const statsFor = (entry: EnemyEntry) =>
  entry.kind === "species" ? ENEMY_STATS[entry.id] : BOSS_VARIANT_STATS[entry.variant];

const resistFor = (entry: EnemyEntry, dt: DamageType) =>
  entry.kind === "species" ? ENEMY_RESIST[entry.id][dt] : BOSS_VARIANT_RESIST[entry.variant][dt];

const slowResistFor = (entry: EnemyEntry) =>
  entry.kind === "species" ? ENEMY_SLOW_RESIST[entry.id] : BOSS_VARIANT_SLOW_RESIST[entry.variant];

const EnemyStatRow = ({ entry }: { entry: EnemyEntry }) => {
  const { t } = useTranslation();
  const s = statsFor(entry);
  return (
    <dl className="compendium-stats">
      <div>
        <dt>{t("compendium.stat.hp")}</dt>
        <dd>{s.hp}</dd>
      </div>
      <div>
        <dt>{t("compendium.stat.speed")}</dt>
        <dd>{s.speed.toFixed(1)}</dd>
      </div>
      <div>
        <dt>{t("compendium.stat.damage")}</dt>
        <dd>{s.damage}</dd>
      </div>
      <div>
        <dt>{t("compendium.stat.bounty")}</dt>
        <dd>{s.bounty}g</dd>
      </div>
    </dl>
  );
};

const EnemyResistRow = ({ entry }: { entry: EnemyEntry }) => {
  const { t } = useTranslation();
  const slowResist = slowResistFor(entry);
  return (
    <div className="compendium-resist">
      <div className="compendium-resist-label">{t("compendium.vsDamage")}</div>
      <div className="compendium-resist-chips">
        {DAMAGE_TYPES.map((dt) => {
          const mul = resistFor(entry, dt);
          const pct = Math.round((mul - 1) * 100);
          const tone = pct > 0 ? "weak" : pct < 0 ? "resist" : "neutral";
          const dtLabel = t(`damageTypes.${dt}`);
          return (
            <div
              key={dt}
              className={`compendium-chip ${tone}`}
              title={`${dtLabel}: ${mul.toFixed(2)}×`}
            >
              <DamageIcon type={dt} size={20} />
              <span className="compendium-chip-label">{dtLabel}</span>
              <span className="compendium-chip-val">
                {pct > 0 ? `+${pct}%` : pct < 0 ? `${pct}%` : "·"}
              </span>
            </div>
          );
        })}
        {slowResist > 0 && (
          <div
            className="compendium-chip resist"
            title={t("compendium.slowResistTitle", { pct: Math.round(slowResist * 100) })}
          >
            <span className="compendium-chip-glyph" aria-hidden>
              S
            </span>
            <span className="compendium-chip-label">{t("compendium.slow")}</span>
            <span className="compendium-chip-val">-{Math.round(slowResist * 100)}%</span>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Tower section ---------------------------------------------------------

const TowerSectionView = ({
  selected,
  setSelected,
}: {
  selected: TowerKind;
  setSelected: (k: TowerKind) => void;
}) => {
  const { t } = useTranslation();
  const stats = TOWER_STATS[selected];
  const cost = TOWER_COST[selected];
  const pill = towerPillInfo(selected);
  const isHive = selected === "hive";
  const isCryo = selected === "cryo";
  const isChain = selected === "chain";
  const isMortar = selected === "mortar";
  // Debug-only override — production never sets entries here so all towers
  // render as unlocked. The debug menu lets a tester flip them so the
  // compendium's locked layout can be inspected.
  const towerLocks = useGame((s) => s.compendiumLocks.towers);
  const selectedLocked = towerLocks[selected] === true;

  return (
    <div className="compendium-browser">
      <div className="compendium-selector">
        {TOWER_ORDER.map((kind) => {
          const locked = towerLocks[kind] === true;
          return (
            <button
              type="button"
              key={kind}
              className={`compendium-tab ${selected === kind ? "active" : ""} ${locked ? "locked" : ""}`}
              onClick={() => setSelected(kind)}
              disabled={locked}
              aria-pressed={selected === kind}
              title={locked ? t("worldMap.locked") : TOWER_LABEL[kind]}
            >
              <span className="compendium-tab-icon" aria-hidden>
                {locked ? (
                  <span className="compendium-tab-locked-glyph">?</span>
                ) : (
                  <TowerPreview kind={kind} />
                )}
              </span>
              <span className="compendium-tab-name">{locked ? "???" : TOWER_LABEL[kind]}</span>
            </button>
          );
        })}
      </div>

      {selectedLocked ? (
        <div className="compendium-detail">
          <div className="compendium-detail-preview">
            <div className="compendium-detail-locked">?</div>
          </div>
          <div className="compendium-detail-info">
            <div className="compendium-detail-locked-text">
              <div className="compendium-detail-name">{t("compendium.unknownDefense")}</div>
              <p className="compendium-detail-desc">{t("compendium.unknownDefenseDesc")}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="compendium-detail">
          <div className="compendium-detail-preview">
            <TowerDiorama kind={selected} size={360} />
          </div>
          <div className="compendium-detail-info">
            <div className="compendium-detail-head">
              <div className="compendium-detail-name">{TOWER_LABEL[selected]}</div>
              <div className="compendium-detail-subtitle">
                <span className="compendium-detail-damage-type" style={{ color: pill.color }}>
                  <DamageIcon type={pill.type} size={14} />
                  {pill.type === "support"
                    ? t("towerPanel.support")
                    : t(`damageTypes.${pill.type}`)}
                </span>
                <span className="compendium-detail-divider">·</span>
                <span>{t(`towers:${selected}.subtitle`)}</span>
                <span className="compendium-detail-divider">·</span>
                <span>{cost}g</span>
              </div>
            </div>
            <p className="compendium-detail-desc">{t(`towers:${selected}.description`)}</p>

            <dl className="compendium-stats">
              {isHive ? (
                <>
                  <div>
                    <dt>{t("compendium.stat.drones")}</dt>
                    <dd>{HIVE_BASE_DRONES}</dd>
                  </div>
                  <div>
                    <dt>{t("compendium.stat.buff")}</dt>
                    <dd>+{Math.round(HIVE_BASE_SERVICE_BUFF * 100)}%</dd>
                  </div>
                  <div>
                    <dt>{t("compendium.stat.cost")}</dt>
                    <dd>{cost}g</dd>
                  </div>
                  <div>
                    <dt>{t("compendium.stat.role")}</dt>
                    <dd>{t("towerPanel.support")}</dd>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <dt>{isCryo ? t("compendium.stat.slow") : t("compendium.stat.dmg")}</dt>
                    <dd>
                      {isCryo ? `${Math.round((1 - stats.slowFactor) * 100)}%` : stats.damage}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("compendium.stat.rate")}</dt>
                    <dd>{stats.fireRate.toFixed(1)}/s</dd>
                  </div>
                  <div>
                    <dt>{t("compendium.stat.range")}</dt>
                    <dd>{stats.range.toFixed(1)}</dd>
                  </div>
                  <div>
                    <dt>
                      {isMortar
                        ? t("compendium.stat.splash")
                        : isChain
                          ? t("compendium.stat.chain")
                          : isCryo
                            ? t("compendium.stat.chill")
                            : t("compendium.stat.cost")}
                    </dt>
                    <dd>
                      {isMortar
                        ? stats.splashRadius.toFixed(1)
                        : isChain
                          ? `${stats.chainCount}`
                          : isCryo
                            ? `${stats.slowDuration.toFixed(1)}s`
                            : `${cost}g`}
                    </dd>
                  </div>
                </>
              )}
            </dl>

            <div className="compendium-section-block">
              <div className="compendium-resist-label">{t("compendium.behavior")}</div>
              <p className="compendium-detail-desc">{t(`towers:${selected}.behavior`)}</p>
            </div>

            <div className="compendium-section-block">
              <div className="compendium-resist-label">{t("compendium.upgradeTree")}</div>
              <div className="compendium-upgrades">
                {(["a", "b"] as const).map((branchId) => (
                  <div key={branchId} className="compendium-branch">
                    <div className="compendium-branch-label">
                      {t("compendium.path", { id: branchId.toUpperCase() })} ·{" "}
                      {t(`upgrades:tower.${selected}.${branchId}.label`)}
                    </div>
                    <ol className="compendium-branch-tiers">
                      {[0, 1, 2].map((i) => (
                        <li key={`${branchId}-${i}`}>
                          <span className="compendium-tier-name">
                            {t(`upgrades:tower.${selected}.${branchId}.tier.${i}.name`)}
                          </span>
                          <span className="compendium-tier-desc">
                            {t(`upgrades:tower.${selected}.${branchId}.tier.${i}.desc`)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </div>

            <div className="compendium-section-block">
              <div className="compendium-resist-label">{t("compendium.matchups")}</div>
              <p className="compendium-detail-desc">{t(`towers:${selected}.matchups`)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Mechanics section -----------------------------------------------------

const MechanicSectionView = ({
  selected,
  setSelected,
}: {
  selected: MechanicId;
  setSelected: (id: MechanicId) => void;
}) => {
  const { t } = useTranslation();
  // Same debug-only override pattern as towers — production never sets
  // entries here so mechanics always render unlocked under normal play.
  const mechLocks = useGame((s) => s.compendiumLocks.mechanics);
  const selectedLocked = mechLocks[selected] === true;
  return (
    <div className="compendium-browser">
      <div className="compendium-selector">
        {MECHANIC_ORDER.map((id) => {
          const locked = mechLocks[id] === true;
          return (
            <button
              type="button"
              key={id}
              className={`compendium-tab ${selected === id ? "active" : ""} ${locked ? "locked" : ""}`}
              onClick={() => setSelected(id)}
              disabled={locked}
              aria-pressed={selected === id}
              title={locked ? t("worldMap.locked") : t(`mechanics:${id}.label`)}
            >
              <span className="compendium-tab-icon" aria-hidden>
                {locked ? (
                  <span className="compendium-tab-locked-glyph">?</span>
                ) : (
                  <MechanicIcon id={id} />
                )}
              </span>
              <span className="compendium-tab-name">
                {locked ? "???" : t(`mechanics:${id}.label`)}
              </span>
            </button>
          );
        })}
      </div>

      {selectedLocked ? (
        <div className="compendium-detail">
          <div className="compendium-detail-preview">
            <div className="compendium-detail-locked">?</div>
          </div>
          <div className="compendium-detail-info">
            <div className="compendium-detail-locked-text">
              <div className="compendium-detail-name">{t("compendium.unknownMechanic")}</div>
              <p className="compendium-detail-desc">{t("compendium.unknownMechanicDesc")}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="compendium-detail">
          <div className="compendium-detail-preview">
            <MechanicPreview id={selected} size={360} />
          </div>
          <div className="compendium-detail-info">
            <div className="compendium-detail-head compendium-mech-head">
              <span className="compendium-mech-badge" aria-hidden>
                <MechanicIcon id={selected} size={56} />
              </span>
              <div>
                <div className="compendium-detail-name">{t(`mechanics:${selected}.label`)}</div>
                <div className="compendium-detail-subtitle">
                  {t(`mechanics:${selected}.subtitle`)}
                </div>
              </div>
            </div>
            <p className="compendium-detail-desc">{t(`mechanics:${selected}.description`)}</p>
            <dl className="compendium-stats compendium-mech-stats">
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <dt>{t(`mechanics:${selected}.stats.${i}.label`)}</dt>
                  <dd>{t(`mechanics:${selected}.stats.${i}.val`)}</dd>
                </div>
              ))}
            </dl>
            {selected === "adaptation" && <AdaptationTintRow />}
          </div>
        </div>
      )}
    </div>
  );
};

// Per-damage-type discoloration legend shown beneath the adaptation
// mechanic dossier. Reads the same ADAPTIVE_TINT_BY_TYPE the renderer
// uses so a tuning change to a hue updates here automatically.
const AdaptationTintRow = () => {
  const { t } = useTranslation();
  return (
    <div className="compendium-section-block">
      <div className="compendium-resist-label">{t("compendium.discoloration")}</div>
      <div className="compendium-resist-chips">
        {DAMAGE_TYPES.map((dt) => {
          const swatch = ADAPTIVE_TINT_BY_TYPE[dt];
          return (
            <div
              key={dt}
              className="compendium-chip"
              title={t("compendium.discolorationTitle", {
                type: t(`damageTypes.${dt}`),
                swatch,
                level: ADAPT_TRIGGER_LEVEL,
              })}
            >
              <span
                aria-hidden
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  background: swatch,
                  border: "1px solid rgba(255,255,255,0.18)",
                  display: "inline-block",
                }}
              />
              <span className="compendium-chip-label">{t(`damageTypes.${dt}`)}</span>
              <span className="compendium-chip-val">≤95%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// --- Lore section ----------------------------------------------------------

// Found-document fragments unlock as the player clears the corresponding
// level on any mode. We treat normal-mode stars as the gate since the
// fragment voice is the on-station operator's view of that outpost,
// which the player only has after holding it once.
const LoreSectionView = ({
  progress,
}: {
  progress: ReturnType<typeof useGame.getState>["progress"];
}) => {
  const { t } = useTranslation();
  const loreLocks = useGame((s) => s.compendiumLocks.lore);
  const loreUnlocked = (id: number): boolean => {
    const lockedOverride = loreLocks[id];
    return lockedOverride === undefined ? getStars(progress, id) > 0 : !lockedOverride;
  };
  // Default selection: the most recently unlocked fragment so the panel
  // opens to "what the player just learned" rather than the very first
  // memo every time. Falls back to id 1 if nothing's unlocked yet.
  const unlockedIds = useMemo(
    () => LORE_FRAGMENT_ORDER.filter((id) => loreUnlocked(id)),
    [progress, loreLocks],
  );
  const initialId = unlockedIds.length > 0 ? unlockedIds[unlockedIds.length - 1] : 1;
  const [selectedId, setSelectedId] = useState<number>(initialId);
  const selectedUnlocked = loreUnlocked(selectedId);
  const hasLevelName = LEVELS.some((l) => l.id === selectedId);

  return (
    <div className="compendium-browser compendium-lore-browser">
      <div className="compendium-selector compendium-lore-selector">
        {LORE_FRAGMENT_ORDER.map((id) => {
          const unlocked = loreUnlocked(id);
          return (
            <button
              type="button"
              key={id}
              className={`compendium-tab compendium-lore-tab ${selectedId === id ? "active" : ""} ${unlocked ? "" : "locked"}`}
              onClick={() => setSelectedId(id)}
              disabled={!unlocked}
              aria-pressed={selectedId === id}
              title={
                unlocked ? t(`lore:fragments.${id}.title`) : t("compendium.outpostNotHeld", { id })
              }
            >
              <span className="compendium-lore-tab-num">#{id}</span>
              <span className="compendium-tab-name compendium-lore-tab-name">
                {unlocked ? t(`lore:fragments.${id}.title`) : t("compendium.sealed")}
              </span>
              <span className="compendium-lore-tab-kind">
                {unlocked ? t(`lore:kind.${LORE_FRAGMENT_KIND[id]}`) : "—"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="compendium-detail compendium-lore-detail">
        {selectedUnlocked ? (
          <div className="compendium-lore-document">
            <div className="compendium-lore-kind-chip">
              {t(`lore:kind.${LORE_FRAGMENT_KIND[selectedId]}`)}
            </div>
            <h2 className="compendium-lore-title">{t(`lore:fragments.${selectedId}.title`)}</h2>
            <div className="compendium-lore-meta">
              <div>
                <span className="compendium-lore-meta-label">{t("compendium.loreFrom")}</span>
                <span className="compendium-lore-meta-value">
                  {t(`lore:fragments.${selectedId}.author`)}
                </span>
              </div>
              <div>
                <span className="compendium-lore-meta-label">{t("compendium.loreSource")}</span>
                <span className="compendium-lore-meta-value">
                  {t(`lore:fragments.${selectedId}.source`)}
                </span>
              </div>
              {hasLevelName && (
                <div>
                  <span className="compendium-lore-meta-label">{t("compendium.loreOutpost")}</span>
                  <span className="compendium-lore-meta-value">
                    #{selectedId} · {t(`levels:names.${selectedId}`)}
                  </span>
                </div>
              )}
            </div>
            <p className="compendium-lore-body">{t(`lore:fragments.${selectedId}.body`)}</p>
          </div>
        ) : (
          <div className="compendium-lore-document compendium-lore-document-locked">
            <h2 className="compendium-lore-title">{t("compendium.sealedFragment")}</h2>
            <p className="compendium-lore-body">
              {t("compendium.holdOutpost", { id: selectedId })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
