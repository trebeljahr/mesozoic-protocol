import { saveSlot } from "./progress";
import { useGame } from "./store";

// Desktop auto-update bridge.
//
// Three layers have to line up before any of this does something, and every
// one of them can be absent:
//
//   1. The app is running inside the Tauri shell at all (not the web build,
//      not the Capacitor shells).
//   2. That shell was compiled with the `updater` cargo feature.
//   3. It is not a Steam install — src-tauri/src/updater.rs refuses to
//      register the commands there, because a self-update would desynchronize
//      the SteamPipe depot.
//
// Only (1) is detectable from here, so (2) and (3) surface as "command not
// found" from `invoke` and are treated exactly like "no update": silent
// no-op. Nothing in this module ever throws at its caller.
//
// The Tauri API packages are behind dynamic imports so the web bundle never
// downloads them.

/** Payload of `updater_check` — mirrors `UpdateInfo` in src-tauri/src/updater.rs. */
export type UpdateInfo = {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
};

export type DownloadProgress = { downloaded: number; total: number | null };

/** Emitted by the Rust `on_before_exit` hook. Keep in sync with updater.rs. */
const BEFORE_EXIT_EVENT = "updater://before-exit";
const PROGRESS_EVENT = "updater://download-progress";

/**
 * Cheap synchronous probe, so the web build never even fetches the
 * `@tauri-apps/api` chunk. `globalThis.isTauri` is the flag Tauri's injected
 * IPC bootstrap sets, and is exactly what the package's own `isTauri()` reads.
 */
export const isTauriShell = (): boolean => {
  try {
    return !!(globalThis as { isTauri?: boolean }).isTauri;
  } catch {
    return false;
  }
};

const api = async () => {
  if (!isTauriShell()) return null;
  const [core, event] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);
  return core.isTauri() ? { core, event } : null;
};

/**
 * Re-persists the active save slot.
 *
 * Progress writes are already synchronous and write-through (see
 * `persistProgress` in store.ts), so this is belt-and-braces rather than a
 * flush of buffered state — there is no buffer. What it buys is a fresh
 * `localStorage.setItem` immediately before the process dies, which is the
 * best any web-storage-backed save layer can do: there is no API to force the
 * WebView to fsync, so the window between the write and the disk is the
 * WebView's to decide.
 */
const persistNow = (): void => {
  try {
    const { activeSlot, progress } = useGame.getState();
    if (activeSlot !== null) saveSlot(activeSlot, progress);
  } catch {
    // Never let a save failure stall the installer.
  }
};

/**
 * Asks the update endpoint whether a newer release exists.
 *
 * Resolves to `null` for "already current" and for every unavailable-here
 * case; callers do not need to distinguish them.
 */
export const checkForUpdate = async (): Promise<UpdateInfo | null> => {
  try {
    const tauri = await api();
    if (!tauri) return null;
    return await tauri.core.invoke<UpdateInfo | null>("updater_check");
  } catch {
    return null;
  }
};

/**
 * Downloads and installs the update reported by the last `checkForUpdate`,
 * then restarts.
 *
 * Resolves only on failure — on success the process is replaced (macOS/Linux)
 * or force-exited by the installer (Windows). Returns `false` when the install
 * did not happen.
 */
export const installUpdate = async (
  onProgress?: (progress: DownloadProgress) => void,
): Promise<boolean> => {
  const tauri = await api();
  if (!tauri) return false;

  const unlisteners: Array<() => void> = [];
  try {
    // Windows installers force-exit the process partway through. This is the
    // only warning the frontend gets, and the Rust side blocks for a few
    // hundred milliseconds after emitting it — so the handler must be
    // synchronous. Registered per install rather than at boot: outside an
    // install there is nothing to hear.
    unlisteners.push(await tauri.event.listen(BEFORE_EXIT_EVENT, persistNow));
    if (onProgress) {
      unlisteners.push(
        await tauri.event.listen<DownloadProgress>(PROGRESS_EVENT, (e) => onProgress(e.payload)),
      );
    }

    // Save before the download even starts, so the guaranteed-synchronous path
    // covers the common case and the before-exit hook is only the backstop for
    // whatever the player did during the download.
    persistNow();

    await tauri.core.invoke("updater_install");
    return true;
  } catch {
    return false;
  } finally {
    for (const off of unlisteners) off();
  }
};
