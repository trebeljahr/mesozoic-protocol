import { useRef } from "react";
import { activeModal, focusableElements } from "../ui/modalFocus";
import { dispatchGamepadKeyboard } from "../ui/useInputMode";
import { type GamepadInputFrame, snapGamepadDirection, useGamepadInput } from "./gamepad";
import { activateGamepadControl, adjustGamepadControl } from "./gamepadFormControls";

const handledFrames = new WeakSet<GamepadInputFrame>();
export const isMenuFrameHandled = (frame: GamepadInputFrame) => handledFrames.has(frame);

const GAMEPAD_FOCUS_CLASS = "gamepad-focus";
const MENU_INITIAL_REPEAT_MS = 320;
const MENU_REPEAT_MS = 120;

type MenuBridgeOptions = {
  confirmAsKeyboard?: boolean;
};

const visibleFocusableElements = () => focusableElements(activeModal() ?? document);

const clearGamepadFocus = () => {
  for (const el of document.querySelectorAll<HTMLElement>(`.${GAMEPAD_FOCUS_CLASS}`)) {
    el.classList.remove(GAMEPAD_FOCUS_CLASS);
  }
};

const focusWithGamepad = (el: HTMLElement) => {
  clearGamepadFocus();
  document.body.classList.add("using-gamepad");
  el.classList.add(GAMEPAD_FOCUS_CLASS);
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
};

const focusRelative = (direction: -1 | 1) => {
  const elements = visibleFocusableElements();
  if (elements.length === 0) return;
  const current = document.activeElement;
  const currentIndex = current instanceof HTMLElement ? elements.indexOf(current) : -1;
  const nextIndex =
    currentIndex === -1
      ? direction > 0
        ? 0
        : elements.length - 1
      : (currentIndex + direction + elements.length) % elements.length;
  focusWithGamepad(elements[nextIndex]);
};

const activateFocused = () => {
  const active = document.activeElement;
  if (visibleFocusableElements().includes(active as HTMLElement) && activateGamepadControl(active))
    return;
  if (
    visibleFocusableElements().includes(active as HTMLElement) &&
    (active instanceof HTMLButtonElement || active instanceof HTMLAnchorElement)
  ) {
    active.click();
    return;
  }

  const first = visibleFocusableElements()[0];
  if (first) {
    focusWithGamepad(first);
    return;
  }
  dispatchGamepadKeyboard("Enter");
};

const menuDirection = (
  frame: GamepadInputFrame,
): { direction: -1 | 0 | 1; horizontal: boolean } => {
  const dpadX = Number(frame.buttonDown("right")) - Number(frame.buttonDown("left"));
  const dpadY = Number(frame.buttonDown("down")) - Number(frame.buttonDown("up"));
  const stickX = snapGamepadDirection(frame.axis("leftX"));
  const stickY = snapGamepadDirection(frame.axis("leftY"));
  const x = dpadX || stickX;
  const y = dpadY || stickY;

  if (Math.abs(y) >= Math.abs(x) && y !== 0)
    return { direction: y > 0 ? 1 : -1, horizontal: false };
  if (x !== 0) return { direction: x > 0 ? 1 : -1, horizontal: true };
  return { direction: 0, horizontal: false };
};

export const useGamepadMenuNavigation = (enabled: boolean, options: MenuBridgeOptions = {}) => {
  const repeatRef = useRef<{ direction: -1 | 1 | 0; nextAt: number; horizontal: boolean }>({
    direction: 0,
    nextAt: 0,
    horizontal: false,
  });

  useGamepadInput((frame) => {
    if (handledFrames.has(frame)) return;
    handledFrames.add(frame);
    if (!frame.gamepad) {
      repeatRef.current = { direction: 0, nextAt: 0, horizontal: false };
      return;
    }

    const { direction, horizontal } = menuDirection(frame);
    if (direction === 0) {
      repeatRef.current = { direction: 0, nextAt: 0, horizontal: false };
    } else {
      const repeat = repeatRef.current;
      if (
        direction !== repeat.direction ||
        horizontal !== repeat.horizontal ||
        frame.timestamp >= repeat.nextAt
      ) {
        const active = document.activeElement;
        const adjusted =
          horizontal &&
          visibleFocusableElements().includes(active as HTMLElement) &&
          adjustGamepadControl(active, direction);
        if (!adjusted) focusRelative(direction);
        repeatRef.current = {
          direction,
          horizontal,
          nextAt:
            frame.timestamp +
            (direction === repeat.direction && horizontal === repeat.horizontal
              ? MENU_REPEAT_MS
              : MENU_INITIAL_REPEAT_MS),
        };
      }
    }

    if (frame.buttonPressed("a")) {
      if (options.confirmAsKeyboard && !activeModal()) dispatchGamepadKeyboard("Enter");
      else activateFocused();
    }
    if (frame.buttonPressed("b") || frame.buttonPressed("start")) {
      dispatchGamepadKeyboard("Escape");
    }
  }, enabled);
};
