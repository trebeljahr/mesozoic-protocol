import { flushDesktopSaves } from "./desktopSaves";
import { persistActiveSave } from "./persistence/persistActiveSave";
import { useGame } from "./store";

// Desktop auto-update bridge.
//
// Three layers have to line up before any of this does something, and every
// one of them can be absent:
//
//   1. The app is running inside the Tauri shell at all (not the web build,
//      not the Capacitor shells).
//   2. That shell was compiled with the `updater` cargo feature.
//   3. It is not a Steam install — src-tauri/src/updater.rs disables the
//      updater state there, because a self-update would desynchronize
//      the SteamPipe depot.
//
// Only (1) is detectable from here, so (2) and (3) surface as unavailable
// commands or state from `invoke` and are treated like "no update": silent
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
const performInstall = async (
  onProgress?: (progress: DownloadProgress) => void,
  onInstalling?: () => void,
): Promise<boolean> => {
  const unlisteners: Array<() => void> = [];
  let blocked = false;
  let installed = false;
  try {
    const tauri = await api();
    if (!tauri) return false;
    if (onProgress) {
      unlisteners.push(
        await tauri.event.listen<DownloadProgress>(PROGRESS_EVENT, (e) => onProgress(e.payload)),
      );
    }

    // The native side reuses a verified payload after a failed save/install.
    await tauri.core.invoke("updater_download");
    useGame.getState().setInterruptionBlocked("update-install", true);
    blocked = true;
    onInstalling?.();
    if (!persistActiveSave()) return false;
    if (!(await flushDesktopSaves())) return false;
    await tauri.core.invoke("updater_install");
    installed = true;
    return true;
  } catch {
    return false;
  } finally {
    for (const off of unlisteners) {
      try {
        off();
      } catch {
        /* Listener cleanup must not change the install result. */
      }
    }
    // Clearing the blocker deliberately keeps the mission's resume latch.
    if (blocked && !installed) useGame.getState().setInterruptionBlocked("update-install", false);
  }
};

let installing: Promise<boolean> | null = null;
export const installUpdate = (
  onProgress?: (progress: DownloadProgress) => void,
  onInstalling?: () => void,
): Promise<boolean> => {
  if (installing) return installing;
  installing = performInstall(onProgress, onInstalling).finally(() => {
    installing = null;
  });
  return installing;
};
