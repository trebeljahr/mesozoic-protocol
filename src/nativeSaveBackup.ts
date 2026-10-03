import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { clearSaveIssue, reportSaveIssue } from "./persistence/storageHealth";

// Save-data durability for the Capacitor shells.
//
// The game keeps everything in localStorage. Inside a WKWebView that is not
// a safe place to leave it: iOS treats web storage as evictable cache and
// clears it under disk pressure or when the app is offloaded, so a player
// can lose an entire campaign without ever uninstalling. Android's WebView
// is better behaved but not immune.
//
// So on native we mirror the player-facing keys into Preferences — NSUserDefaults
// on iOS, SharedPreferences on Android — which is durable app data, and restore
// from that mirror at boot whenever localStorage has come up empty. The browser
// build is untouched: every entry point below no-ops off-native.
//
// Mirror player preferences and saves, including old-prefix entries until
// their verified migration removes them. Editor scratch data is excluded.

const MIRRORED_PREFIX = "mesozoic-protocol:";
const MIRROR_KEY = "localstorage-mirror:v1";
const FLUSH_INTERVAL_MS = 1500;
const isMirroredKey = (key: string) =>
  key.startsWith(MIRRORED_PREFIX) || key.startsWith("extinction-protocol:");

const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

const readMirroredEntries = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key || !isMirroredKey(key)) continue;
    const value = window.localStorage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
};

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let operations: Promise<void> = Promise.resolve();
let restoreState: "unread" | "blocked" | "ready" = "unread";
let mirrorInstalled = false;
let mirrorRequested = false;

// Reads and writes share a queue. A pending restore can never race a seed
// snapshot, and slow native writes cannot overtake one another.
const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
  const next = operations.then(operation);
  operations = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
};

const reportNativeFailure = () => {
  reportSaveIssue({ key: MIRROR_KEY, reason: "native" }, async () => {
    if (restoreState !== "ready") await restoreNativeSaveBackup();
    if (restoreState !== "ready") return false;
    if (mirrorRequested && !mirrorInstalled) installNativeSaveMirror();
    if (mirrorRequested && !mirrorInstalled) return false;
    return flushNow();
  });
};

const flushNow = (): Promise<boolean> => {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  return serialize(async () => {
    // A failed read, malformed envelope, or partial local restore must not
    // authorize replacing the only durable source with an empty snapshot.
    if (restoreState !== "ready") {
      reportNativeFailure();
      return false;
    }
    try {
      await Preferences.set({ key: MIRROR_KEY, value: JSON.stringify(readMirroredEntries()) });
      clearSaveIssue(MIRROR_KEY);
      return true;
    } catch {
      reportNativeFailure();
      return false;
    }
  });
};

const scheduleFlush = (): void => {
  // First write starts a fixed deadline. Later writes join its snapshot
  // instead of resetting the timer and starving continuous checkpoints.
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow();
  }, FLUSH_INTERVAL_MS);
};

const parseMirror = (raw: string): Record<string, string> => {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid native mirror envelope");
  for (const [key, entry] of Object.entries(parsed)) {
    if (!isMirroredKey(key) || typeof entry !== "string")
      throw new Error("Invalid native mirror entry");
  }
  return parsed as Record<string, string>;
};

/**
 * Repopulates localStorage from the native mirror. Must run before anything
 * reads storage — see the boot sequence in main.tsx, which defers the App and
 * i18n imports until this resolves, because both read at module-evaluation
 * time.
 *
 * Existing localStorage values always win: the mirror only fills gaps, so a
 * stale snapshot can never overwrite a live save.
 */
export const restoreNativeSaveBackup = async (): Promise<void> => {
  if (!isNative()) return;
  await serialize(async () => {
    restoreState = "blocked";
    try {
      const { value } = await Preferences.get({ key: MIRROR_KEY });
      // Only null means there was no backup. An empty/invalid string is
      // unreadable data and must remain intact until recovery succeeds.
      const entries = value === null ? {} : parseMirror(value);
      const ls = window.localStorage;
      for (const [key, entry] of Object.entries(entries)) {
        if (ls.getItem(key) !== null) continue;
        // New-prefix values, including deletion tombstones, also outrank
        // old-prefix counterparts in a mirror restored after a failed boot.
        const nextKey = key.replace(/^extinction-protocol:/, MIRRORED_PREFIX);
        if (nextKey !== key && ls.getItem(nextKey) !== null) continue;
        ls.setItem(key, entry);
        if (ls.getItem(key) !== entry) throw new Error("Native restore verification failed");
      }
      restoreState = "ready";
      clearSaveIssue(MIRROR_KEY);
      if (mirrorInstalled) scheduleFlush();
    } catch {
      reportNativeFailure();
    }
  });
};

/**
 * Observes localStorage mutations so every write schedules a bounded snapshot,
 * and flushes on backgrounding. Storage instances have exotic named-property
 * setters, so wrap the prototype and filter by the target instance instead of
 * assigning methods on localStorage. Session storage must stay independent.
 */
export const installNativeSaveMirror = (): void => {
  if (!isNative()) return;
  mirrorRequested = true;
  if (mirrorInstalled) return;
  let ls: Storage;
  try {
    ls = window.localStorage;
  } catch {
    reportNativeFailure();
    return;
  }
  const prototype = Object.getPrototypeOf(ls) as Storage;
  const setItem = prototype.setItem;
  const removeItem = prototype.removeItem;
  const clear = prototype.clear;

  prototype.setItem = function (key: string, value: string): void {
    setItem.call(this, key, value);
    if (this === ls && isMirroredKey(String(key))) scheduleFlush();
  };
  prototype.removeItem = function (key: string): void {
    removeItem.call(this, key);
    if (this === ls && isMirroredKey(String(key))) scheduleFlush();
  };
  prototype.clear = function (): void {
    clear.call(this);
    if (this === ls) scheduleFlush();
  };
  mirrorInstalled = true;

  // pagehide is the reliable "app is going away" signal in WKWebView;
  // visibilitychange covers the Android task-switch path.
  window.addEventListener("pagehide", () => void flushNow());
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushNow();
  });

  // First snapshot seeds the mirror for a player who installed before this
  // shipped and has never written a save since.
  scheduleFlush();
};
