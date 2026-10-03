import { clearSaveIssue, reportSaveIssue } from "./persistence/storageHealth";

// Keep in sync with the native allowlist. Audio, display and input preferences
// belong to this device, never to the campaign's Steam Cloud files.
export const isDesktopSaveKey = (key: string): boolean =>
  /^(mesozoic-protocol|extinction-protocol):(slot:[123]:v1(:backup)?|progress:v1|training-offer-seen)$/.test(
    key,
  );

type Entries = Record<string, string>;
type LoadedSaves = {
  entries: Entries | null;
  directory: string;
  recovered: boolean;
  allowLegacyImport: boolean;
};
type Status = { available: boolean; directory: string | null; recovered: boolean; ready: boolean };
const isDesktop = () => !!(globalThis as { isTauri?: boolean }).isTauri;
const ISSUE_KEY = "desktop-save-files";
let status: Status = { available: isDesktop(), directory: null, recovered: false, ready: false };
const listeners = new Set<() => void>();
export const getDesktopSaveStatus = () => status;
export const subscribeDesktopSaveStatus = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const updateStatus = (next: Partial<Status>) => {
  status = { ...status, ...next };
  for (const listener of listeners) listener();
};
const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
  (await import("@tauri-apps/api/core")).invoke<T>(command, args);

const snapshot = (storage: Storage): Entries => {
  const entries: Entries = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key && isDesktopSaveKey(key)) {
      const value = storage.getItem(key);
      if (value !== null) entries[key] = value;
    }
  }
  return entries;
};
const validEntries = (value: unknown): value is Entries =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.entries(value).every(([key, entry]) => isDesktopSaveKey(key) && typeof entry === "string");
const equalEntries = (left: Entries, right: Entries) =>
  JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());

let dirty = false;
let writing: Promise<boolean> | null = null;
let installed = false;
let closeHandlerInstalled = false;
let closing = false;
let storage: Storage;
let beforeClose: () => boolean = () => true;
let closeFailed: () => void = () => {};

// Registered only after boot restores disk data and imports the game store.
export const setDesktopBeforeClose = (handler: () => boolean, onFailure: () => void = () => {}) => {
  beforeClose = handler;
  closeFailed = onFailure;
};

/** Drain pending disk writes. Failed writes stay pending and are visible in-game. */
export const flushDesktopSaves = async (): Promise<boolean> => {
  if (!isDesktop()) return true;
  if (!status.ready) return false;
  if (writing) return writing;
  writing = Promise.resolve().then(async () => {
    try {
      while (dirty) {
        dirty = false;
        await invoke("desktop_saves_write", { entries: snapshot(storage) });
      }
      clearSaveIssue(ISSUE_KEY);
      return true;
    } catch {
      dirty = true;
      reportSaveIssue({ key: ISSUE_KEY, reason: "native" }, flushDesktopSaves);
      return false;
    } finally {
      writing = null;
    }
  });
  return writing;
};

const changed = () => {
  dirty = true;
  // Coalesce all changes in a synchronous save transaction. Unlike a debounce,
  // sustained checkpoints cannot postpone persistence indefinitely.
  queueMicrotask(() => {
    void flushDesktopSaves();
  });
};

const installCloseHandler = async () => {
  if (closeHandlerInstalled) return;
  const { listen } = await import("@tauri-apps/api/event");
  await listen("desktop-save-close-requested", async () => {
    if (closing) return;
    closing = true;
    let closed = false;
    try {
      if (status.ready && (!beforeClose() || !(await flushDesktopSaves()))) return;
      await invoke("desktop_saves_close");
      closed = true;
    } catch {
      reportSaveIssue({ key: ISSUE_KEY, reason: "native" }, flushDesktopSaves);
    } finally {
      if (!closed) closeFailed();
      closing = false;
    }
  });
  closeHandlerInstalled = true;
};

const install = () => {
  if (installed) return;
  // Storage has exotic named-property setters: assigning setItem on the
  // instance can store a string instead of replacing the method in WebKit.
  // Wrap the prototype and only observe this window's localStorage.
  const prototype = Object.getPrototypeOf(storage) as Storage;
  const set = prototype.setItem;
  const remove = prototype.removeItem;
  const clear = prototype.clear;
  prototype.setItem = function (key: string, value: string) {
    set.call(this, key, value);
    if (this === storage && isDesktopSaveKey(String(key))) changed();
  };
  prototype.removeItem = function (key: string) {
    remove.call(this, key);
    if (this === storage && isDesktopSaveKey(String(key))) changed();
  };
  prototype.clear = function () {
    clear.call(this);
    if (this === storage) changed();
  };
  window.addEventListener("pagehide", () => {
    void flushDesktopSaves();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushDesktopSaves();
  });
  installed = true;
};

/** Called before importing modules which read saves. Disk is authoritative:
 * Steam downloads it before launch. A stale WebView cache must not resurrect
 * deleted slots or overwrite progress downloaded from another computer.
 */
export const initializeDesktopSaves = async (): Promise<void> => {
  if (!isDesktop()) return;
  if (status.ready) return;
  updateStatus({ available: true });
  updateStatus({ directory: await invoke<string>("desktop_saves_directory") });
  storage = window.localStorage;
  await installCloseHandler();
  const loaded = await invoke<LoadedSaves>("desktop_saves_load");
  const ownerKey = "mesozoic-protocol:desktop-save-owner:v1";
  const previousOwner = storage.getItem(ownerKey);
  let entries = loaded.entries;
  if (entries === null) {
    // WebView storage is shared by all Steam accounts. Only standalone may
    // migrate it, and never if another profile already owns this cache.
    entries =
      loaded.allowLegacyImport && (!previousOwner || previousOwner === loaded.directory)
        ? snapshot(storage)
        : {};
    await invoke("desktop_saves_write", { entries });
  }
  {
    if (!validEntries(entries)) throw new Error("Invalid desktop save document");
    const previous = snapshot(storage);
    // Keep one local migration snapshot for manual recovery if a player's old
    // WebView saves differ. This key is not part of the cloud allowlist.
    const cacheBackup = "mesozoic-protocol:desktop-cache-before-migration:v1";
    if (
      Object.keys(previous).length &&
      !equalEntries(previous, entries) &&
      !storage.getItem(cacheBackup)
    )
      storage.setItem(cacheBackup, JSON.stringify(previous));
    for (const key of Object.keys(previous)) {
      if (!(key in entries)) storage.removeItem(key);
    }
    for (const [key, value] of Object.entries(entries)) storage.setItem(key, value);
    if (!equalEntries(snapshot(storage), entries))
      throw new Error("Could not restore desktop saves into the game");
  }
  storage.setItem(ownerKey, loaded.directory);
  if (storage.getItem(ownerKey) !== loaded.directory)
    throw new Error("Could not identify save cache owner");
  install();
  updateStatus({ ready: true, directory: loaded.directory, recovered: loaded.recovered });
};

export const openDesktopSaveDirectory = async (): Promise<void> => {
  if (isDesktop()) await invoke("desktop_saves_open_directory");
};

export const closeDesktopWithoutSaving = async (): Promise<void> => {
  if (isDesktop()) await invoke("desktop_saves_close");
};
