import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGamepadInput } from "../input/gamepad";
import { useKeyBindings } from "../input/keyBindings";
import { isMenuFrameHandled, useGamepadMenuNavigation } from "../input/useGamepadMenuNavigation";
import { totalStars } from "../progress";
import { HIVE_BASE_SERVICE_BUFF, HIVE_MAX_DRONES_PER_TOWER } from "../sim/world";
import { useGame } from "../store";
import { MenuOverlay } from "../ui/MenuOverlay";
import { activeModal } from "../ui/modalFocus";
import { useInputMode } from "../ui/useInputMode";
import { tutorialKeyboardHints } from "./keyboardHints";
import { CHAPTERS, LESSONS, lessonFor } from "./lessons";
import "./tutorial.css";

const OFFER_KEY = "mesozoic-protocol:training-offer-seen";
const offerSeen = () => {
  try {
    return localStorage.getItem(OFFER_KEY) === "1";
  } catch {
    return false;
  }
};
const rememberOffer = () => {
  try {
    localStorage.setItem(OFFER_KEY, "1");
  } catch {
    /* optional device preference */
  }
};

export const TutorialEntry = () => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="btn btn-ghost pointer-events-auto"
      onClick={() => {
        rememberOffer();
        useGame.getState().startTutorial();
      }}
    >
      {t("tutorial.entry")}
    </button>
  );
};

export const TutorialWelcome = () => {
  const { t } = useTranslation();
  const progress = useGame((s) => s.progress);
  const [dismissed, setDismissed] = useState(offerSeen);
  const visible = !dismissed && totalStars(progress) === 0 && progress.stats.killsTotal === 0;
  const dismiss = () => {
    rememberOffer();
    setDismissed(true);
  };
  useGamepadMenuNavigation(visible);
  if (!visible) return null;
  return (
    <MenuOverlay title={t("tutorial.welcomeTitle")} onClose={dismiss}>
      <p>{t("tutorial.welcome")}</p>
      <div className="tutorial-actions">
        <TutorialEntry />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            rememberOffer();
            setDismissed(true);
          }}
        >
          {t("tutorial.skip")}
        </button>
      </div>
    </MenuOverlay>
  );
};

// Embedded in the real Lab / Robots panels so objectives stay readable and
// controller focus stays inside the active dialog.
export const TutorialPanelPrompt = () => {
  const { t } = useTranslation();
  const tutorial = useGame((s) => s.tutorial);
  if (!tutorial) return null;
  const id = lessonFor(tutorial).id;
  return (
    <div className="tutorial-panel-prompt" role="status">
      <strong>{t(`tutorial.lessons.${id}.objective`)}</strong>
      <span>
        {t(`tutorial.lessons.${id}.detail`, {
          buff: HIVE_BASE_SERVICE_BUFF * 100,
          cap: HIVE_MAX_DRONES_PER_TOWER,
        })}
      </span>
    </div>
  );
};

export const TutorialUI = () => {
  const { t } = useTranslation();
  const tutorial = useGame((s) => s.tutorial);
  const focused = useGame((s) => s.tutorialControlsFocused);
  const status = useGame((s) => s.ui.status);
  const labOpen = useGame((s) => s.skillTreeOpen);
  const shopOpen = useGame((s) => s.robotShopOpen);
  const otherModal = useGame(
    (s) => s.compendiumOpen || s.achievementsOpen || s.creditsOpen || s.difficultyPickerOpen,
  );
  const input = useInputMode();
  const bindings = useKeyBindings((s) => s.bindings);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const lesson = tutorial ? lessonFor(tutorial) : null;
  const modal = labOpen || shopOpen || otherModal;
  const running = !!tutorial && status === "running" && !modal;

  useGamepadInput((frame) => {
    if (activeModal() || isMenuFrameHandled(frame)) return;
    if (frame.buttonPressed("x"))
      useGame.setState({ tutorialControlsFocused: !useGame.getState().tutorialControlsFocused });
  }, running);
  useGamepadMenuNavigation(running && (focused || chaptersOpen));

  useEffect(() => {
    if (!lesson || !running) return;
    const highlight = () => {
      document.querySelectorAll(".tutorial-highlight").forEach((el) => {
        el.classList.remove("tutorial-highlight");
      });
      if (lesson.highlight)
        document.querySelectorAll(lesson.highlight).forEach((el) => {
          el.classList.add("tutorial-highlight");
        });
    };
    highlight();
    // Panels mount after selections without changing the current lesson.
    const observer = new MutationObserver(highlight);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.querySelectorAll(".tutorial-highlight").forEach((el) => {
        el.classList.remove("tutorial-highlight");
      });
    };
  }, [lesson, running]);

  if (!tutorial || !lesson || modal || status === "paused") return null;
  const id = lesson.id;
  const mode =
    input.mode === "gamepad"
      ? "gamepad"
      : input.touchPrimary || input.mode === "pointer"
        ? "touch"
        : "mouse";
  const openTarget = () => {
    const s = useGame.getState();
    const session = s.tutorial;
    if (!session) return;
    if (id === "enemy") {
      const e = s.world.enemyById.get(session.targetId!);
      if (e) s.inspectEnemy(e.id, e.kind, e.maxHp, null);
    } else if (id === "prop") {
      const tree = s.world.trees[0];
      if (tree) s.selectTree(tree.id);
    } else if (id === "base") s.selectBase(true);
    else if (id === "assign" || id === "reassign") {
      const hive = s.world.towers.find((tower) => tower.kind === "hive");
      if (hive) s.selectTower(hive.id);
    } else if (session.towerId !== null) s.selectTower(session.towerId);
  };
  const hasTarget = [
    "inspectTower",
    "upgrade",
    "target",
    "vulnerable",
    "assign",
    "reassign",
    "spot",
    "prop",
    "base",
    "sell",
    "enemy",
  ].includes(id);
  return (
    <aside className="tutorial-objective" aria-label={t("tutorial.entry")}>
      <div className="tutorial-heading">
        <span>{t("tutorial.practice")}</span>
        <span>
          {tutorial.step + 1} / {LESSONS.length}
        </span>
      </div>
      <div key={id} className="tutorial-step" role="status" aria-live="polite" aria-atomic="true">
        <h2>{t(`tutorial.lessons.${id}.objective`)}</h2>
        <p>
          {t(`tutorial.lessons.${id}.detail`, {
            buff: HIVE_BASE_SERVICE_BUFF * 100,
            cap: HIVE_MAX_DRONES_PER_TOWER,
          })}
        </p>
      </div>
      <p className="tutorial-input">
        {t(`tutorial.hints.${mode}`, tutorialKeyboardHints(bindings))}
      </p>
      {input.mode === "gamepad" && (
        <p className="tutorial-input">
          {t(focused ? "tutorial.controlsFocused" : "tutorial.fieldFocused")}
        </p>
      )}
      <div className="tutorial-actions">
        {hasTarget && (
          <button type="button" className="btn btn-ghost" onClick={openTarget}>
            {t("tutorial.inspectMarked")}
          </button>
        )}
        {id === "lab" && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => useGame.getState().setSkillTreeOpen(true)}
          >
            {t("worldMap.lab")}
          </button>
        )}
        {id === "robotSkill" && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => useGame.getState().setRobotShopOpen(true)}
          >
            {t("worldMap.robots")}
          </button>
        )}
        {id !== "complete" && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => useGame.getState().restartTutorialLesson()}
          >
            {t("tutorial.retry")}
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          aria-expanded={chaptersOpen}
          onClick={() => setChaptersOpen(!chaptersOpen)}
        >
          {t("tutorial.chapters")}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => useGame.getState().exitTutorial()}
        >
          {t("tutorial.exit")}
        </button>
      </div>
      {chaptersOpen && (
        <MenuOverlay title={t("tutorial.chapters")} onClose={() => setChaptersOpen(false)}>
          <nav aria-label={t("tutorial.chapters")} className="tutorial-chapters">
            {CHAPTERS.map((chapter) => (
              <button
                type="button"
                className="btn btn-ghost"
                key={chapter}
                onClick={() => {
                  setChaptersOpen(false);
                  useGame.getState().startTutorial(chapter);
                }}
              >
                {t(`tutorial.chapter.${chapter}`)}
              </button>
            ))}
          </nav>
        </MenuOverlay>
      )}
    </aside>
  );
};
