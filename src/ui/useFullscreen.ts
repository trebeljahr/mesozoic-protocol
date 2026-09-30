import { useCallback, useEffect, useState } from "react";

// Webkit-specific fullscreen API still ships in iOS Safari (the standard
// API is rejected on iPhone outright). The shim covers both forms so
// callers don't have to branch.
type FsDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export const isFullscreen = (): boolean => {
  if (typeof document === "undefined") return false;
  const d = document as FsDoc;
  return Boolean(d.fullscreenElement || d.webkitFullscreenElement);
};

type KeyboardLock = {
  lock: (keys: string[]) => Promise<void>;
  unlock: () => void;
};

let releaseKeyboardLock: (() => void) | undefined;

// Fullscreen owns Escape unless the browser grants Keyboard Lock.
// Keep a fallback for screens without their own Escape action.
const captureFullscreenEscape = async (): Promise<void> => {
  const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
  if (!keyboard?.lock) return;
  releaseKeyboardLock?.();
  const onKey = (event: KeyboardEvent) => {
    if (event.code !== "Escape" || !isFullscreen()) return;
    if (event.repeat) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    // Let selection and dialog handlers claim this press first.
    setTimeout(() => {
      if (releaseKeyboardLock === release && !event.defaultPrevented && isFullscreen())
        void exitFullscreen();
    }, 0);
  };
  const release = () => {
    if (releaseKeyboardLock !== release) return;
    keyboard.unlock();
    window.removeEventListener("keydown", onKey, { capture: true });
    document.removeEventListener("fullscreenchange", onChange);
    if (releaseKeyboardLock === release) releaseKeyboardLock = undefined;
  };
  const onChange = () => {
    if (!isFullscreen()) release();
  };
  releaseKeyboardLock = release;
  window.addEventListener("keydown", onKey, { capture: true });
  document.addEventListener("fullscreenchange", onChange);
  try {
    await keyboard.lock(["Escape"]);
    if (!isFullscreen()) release();
  } catch {
    // Permission denied or unsupported: retain the browser's normal exit.
    release();
  }
};

export const enterFullscreen = async (): Promise<boolean> => {
  if (typeof document === "undefined") return false;
  const root = document.documentElement as FsElement;
  try {
    if (root.requestFullscreen) await root.requestFullscreen();
    else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen();
    else return false;
    void captureFullscreenEscape();
    return true;
  } catch {
    // iPhone Safari rejects the request entirely; some browsers reject
    // when not in a user-gesture context. Either way, swallow and report.
    return false;
  }
};

export const exitFullscreen = async (): Promise<void> => {
  if (typeof document === "undefined") return;
  const d = document as FsDoc;
  try {
    releaseKeyboardLock?.();
    if (d.exitFullscreen) await d.exitFullscreen();
    else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
  } catch {
    /* ignore */
  }
};

// Live `isFullscreen` value plus a one-call toggle. The `change` listener
// catches both programmatic changes and the user pressing Esc to exit.
export const useFullscreen = () => {
  const [active, setActive] = useState(isFullscreen);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => setActive(isFullscreen());
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const toggle = useCallback(async () => {
    if (isFullscreen()) await exitFullscreen();
    else await enterFullscreen();
  }, []);

  return { active, toggle, enter: enterFullscreen, exit: exitFullscreen };
};

// Persisted user preference for fullscreen-on-level-start. Default is
// "auto" — undecided; the app picks based on device. Once the user
// toggles fullscreen via the menu, we save explicit on/off and stop
// auto-entering.
const FS_PREF_KEY = "mesozoic-protocol:fullscreen:v1";
type FsPref = "auto" | "on" | "off";

export const loadFullscreenPref = (): FsPref => {
  if (typeof localStorage === "undefined") return "auto";
  try {
    const raw = localStorage.getItem(FS_PREF_KEY);
    if (raw === "on" || raw === "off") return raw;
    return "auto";
  } catch {
    return "auto";
  }
};

export const saveFullscreenPref = (pref: FsPref): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(FS_PREF_KEY, pref);
  } catch {
    /* ignore */
  }
};
