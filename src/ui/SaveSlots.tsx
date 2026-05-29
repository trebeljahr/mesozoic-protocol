import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LEVELS } from "../levels";
import { DIFFICULTY_ACCENT, listSlots, type SlotId, type SlotInfo } from "../progress";
import { ExpectedCanvasTeardown } from "../render/ExpectedCanvasTeardown";
import { SaveSlotsScene } from "../render/SaveSlotsScene";
import { useGame } from "../store";
import { DifficultyModelIcon } from "./DifficultyModelIcon";
import { SettingsMenu } from "./SettingsMenu";
import { useIsMobile } from "./useMediaQuery";

type MobileStage = "menu" | "slots";

export const SaveSlots = () => {
  const { t } = useTranslation();
  const selectSlot = useGame((s) => s.selectSlot);
  const deleteSlot = useGame((s) => s.deleteSlot);
  const isMobile = useIsMobile();

  // Mobile splits this screen into two stages: a clean main menu that
  // shows off the diorama, then a dedicated slot picker reached via a
  // big Start button. Desktop ignores `stage` and renders both at once.
  const [stage, setStage] = useState<MobileStage>("menu");

  // listSlots() reads localStorage directly — bumping `revision` forces
  // a re-render after delete since the store doesn't mirror slot
  // metadata into reactive state (only the active slot's progress
  // lives in the store). 3 localStorage reads per render is cheap.
  const [revision, setRevision] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<SlotId | null>(null);

  void revision;
  const slots = listSlots();

  const totalLevels = LEVELS.length;

  const beginDelete = (id: SlotId) => setConfirmDeleteId(id);

  useEffect(() => {
    if (confirmDeleteId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setConfirmDeleteId(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [confirmDeleteId]);

  // Back from slot picker to main menu on mobile.
  useEffect(() => {
    if (!isMobile || stage !== "slots") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmDeleteId !== null) return;
      e.preventDefault();
      setStage("menu");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobile, stage, confirmDeleteId]);

  const confirmDelete = () => {
    if (confirmDeleteId === null) return;
    deleteSlot(confirmDeleteId);
    setConfirmDeleteId(null);
    setRevision((n) => n + 1);
  };

  const showMenu = isMobile && stage === "menu";
  const showSlots = !isMobile || stage === "slots";

  return (
    <div
      className={`save-slots-screen ${showMenu ? "save-slots-screen--menu" : "save-slots-screen--slots"}`}
    >
      <div className="save-slots-bg">
        <Canvas
          shadows
          dpr={[1, 1.75]}
          camera={{ position: [0, 5.5, 17], fov: 40, near: 0.1, far: 200 }}
        >
          <ExpectedCanvasTeardown />
          <Suspense fallback={null}>
            <SaveSlotsScene />
          </Suspense>
        </Canvas>
      </div>

      <div className="save-slots-vignette" aria-hidden />

      {isMobile && stage === "slots" && (
        <button
          type="button"
          className="save-slots-back-btn"
          onClick={() => setStage("menu")}
          aria-label={t("saveSlots.backToMenu")}
          data-ui-sound="close"
        >
          <span aria-hidden>‹</span>
          <span>{t("saveSlots.back")}</span>
        </button>
      )}

      <SettingsMenu />

      <header className="save-slots-title">
        <h1>Mesozoic Protocol</h1>
        {!showMenu && <div className="save-slots-subtitle">{t("saveSlots.selectSave")}</div>}
      </header>

      {showMenu && (
        <div className="save-slots-menu-actions">
          <button
            type="button"
            className="btn save-slots-start-btn"
            onClick={() => setStage("slots")}
            data-ui-sound="open"
          >
            {t("saveSlots.start")}
          </button>
        </div>
      )}

      {showSlots && (
        <div className="save-slots-grid">
          {slots.map((slot) => (
            <SaveSlotTile
              key={slot.id}
              slot={slot}
              totalLevels={totalLevels}
              isConfirmingDelete={confirmDeleteId === slot.id}
              onSelect={() => selectSlot(slot.id)}
              onBeginDelete={() => beginDelete(slot.id)}
              onConfirmDelete={confirmDelete}
              onCancelDelete={() => setConfirmDeleteId(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

type TileProps = {
  slot: SlotInfo;
  totalLevels: number;
  isConfirmingDelete: boolean;
  onSelect: () => void;
  onBeginDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
};

const SaveSlotTile = ({
  slot,
  totalLevels,
  isConfirmingDelete,
  onSelect,
  onBeginDelete,
  onConfirmDelete,
  onCancelDelete,
}: TileProps) => {
  const { t } = useTranslation();
  const filled = slot.exists;
  return (
    <div className={`save-slot-tile ${filled ? "filled" : "empty"}`}>
      <div className="save-slot-tile-head">
        <div className="save-slot-id">{t("saveSlots.slot", { id: slot.id })}</div>
        {filled && (
          <div
            className={`save-slot-difficulty ${DIFFICULTY_ACCENT[slot.progress.difficulty].text}`}
          >
            <DifficultyModelIcon
              difficulty={slot.progress.difficulty}
              className="w-4 h-4 shrink-0"
            />
            {t(`modes:difficulty.label.${slot.progress.difficulty}`).toUpperCase()}
          </div>
        )}
      </div>

      {isConfirmingDelete ? (
        <div className="save-slot-confirm">
          <div className="save-slot-confirm-text">{t("saveSlots.confirmDelete")}</div>
          <div className="save-slot-row">
            <button type="button" className="btn btn-danger btn--sm" onClick={onConfirmDelete}>
              {t("saveSlots.delete")}
            </button>
            <button type="button" className="btn btn-ghost btn--sm" onClick={onCancelDelete}>
              {t("saveSlots.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="save-slot-name">{filled ? slot.meta.name : t("saveSlots.empty")}</div>
          {filled ? (
            <div className="save-slot-stats">
              <div>
                <span>{t("saveSlots.cleared")}</span>
                <strong>
                  {slot.levelsCleared} / {totalLevels}
                </strong>
              </div>
              <div>
                <span>{t("saveSlots.stars")}</span>
                <strong>{slot.totalStars}</strong>
              </div>
            </div>
          ) : (
            <div className="save-slot-empty-text">{t("saveSlots.emptyText")}</div>
          )}
          <div className="save-slot-actions">
            <button type="button" className="btn" onClick={onSelect}>
              {filled ? t("saveSlots.continue") : t("saveSlots.start")}
            </button>
            {filled && (
              <button type="button" className="btn btn-danger btn--sm" onClick={onBeginDelete}>
                {t("saveSlots.delete")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
