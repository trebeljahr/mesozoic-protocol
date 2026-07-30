import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

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
// Only the `mesozoic-protocol:` namespace is mirrored (save slots, progress,
// language, audio, fullscreen preference). The editor's `mz:` keys are
// authoring scratch data — large, regenerable, and not shipped-player state.

const MIRRORED_PREFIX = "mesozoic-protocol:";
const MIRROR_KEY = "localstorage-mirror:v1";
const FLUSH_DEBOUNCE_MS = 1500;

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
    if (!key?.startsWith(MIRRORED_PREFIX)) continue;
    const value = window.localStorage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
};

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight: Promise<void> = Promise.resolve();

// Serialized behind `flushInFlight` so a burst of writes can never interleave
// two snapshots and persist a torn one.
const flushNow = (): Promise<void> => {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushInFlight = flushInFlight.then(async () => {
    try {
      await Preferences.set({ key: MIRROR_KEY, value: JSON.stringify(readMirroredEntries()) });
    } catch {
      // A failed mirror is not worth breaking a save over — localStorage
      // still holds the authoritative copy for this session.
    }
  });
  return flushInFlight;
};

const scheduleFlush = (): void => {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow();
  }, FLUSH_DEBOUNCE_MS);
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
  try {
    const { value } = await Preferences.get({ key: MIRROR_KEY });
    if (!value) return;
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!key.startsWith(MIRRORED_PREFIX) || typeof entry !== "string") continue;
      if (window.localStorage.getItem(key) !== null) continue;
      window.localStorage.setItem(key, entry);
    }
  } catch {
    // Corrupt or unreadable mirror: boot with whatever localStorage has.
  }
};

/**
 * Patches localStorage's mutating methods so every write schedules a debounced
 * snapshot, and flushes on backgrounding. Patching the instance is the one
 * choke point that covers all ~18 call sites without threading an async
 * storage API through the save layer.
 */
export const installNativeSaveMirror = (): void => {
  if (!isNative()) return;

  const ls = window.localStorage;
  const setItem = ls.setItem.bind(ls);
  const removeItem = ls.removeItem.bind(ls);
  const clear = ls.clear.bind(ls);

  ls.setItem = (key: string, value: string): void => {
    setItem(key, value);
    if (key.startsWith(MIRRORED_PREFIX)) scheduleFlush();
  };
  ls.removeItem = (key: string): void => {
    removeItem(key);
    if (key.startsWith(MIRRORED_PREFIX)) scheduleFlush();
  };
  ls.clear = (): void => {
    clear();
    scheduleFlush();
  };

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
