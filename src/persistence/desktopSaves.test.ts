import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  entries: null as Record<string, string> | null,
  calls: [] as string[],
  writes: [] as Record<string, string>[],
  failRead: false,
  failWrite: false,
  recovered: false,
  allowLegacyImport: true,
  beforeWrite: null as (() => Promise<void>) | null,
  active: 0,
  maximum: 0,
  events: new Map<string, () => Promise<void>>(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: { entries: Record<string, string> }) => {
    native.calls.push(command);
    switch (command) {
      case "desktop_saves_directory":
        return "/test/saves";
      case "desktop_saves_load":
        if (native.failRead) throw new Error("corrupt files");
        return {
          entries: native.entries,
          directory: "/test/saves",
          recovered: native.recovered,
          allowLegacyImport: native.allowLegacyImport,
        };
      case "desktop_saves_write":
        native.active++;
        native.maximum = Math.max(native.active, native.maximum);
        try {
          await native.beforeWrite?.();
          if (native.failWrite) throw new Error("disk full");
          native.entries = { ...args!.entries };
          native.writes.push(native.entries);
        } finally {
          native.active--;
        }
        return;
    }
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, callback: () => Promise<void>) => {
    native.events.set(name, callback);
    return () => native.events.delete(name);
  },
}));
const SLOT = "mesozoic-protocol:slot:1:v1";
const SECOND = "mesozoic-protocol:slot:2:v1";
const AUDIO = "mesozoic-protocol:audio:v2";
let storage: Storage;
beforeEach(() => {
  vi.resetModules();
  Object.assign(native, {
    entries: null,
    calls: [],
    writes: [],
    failRead: false,
    failWrite: false,
    recovered: false,
    allowLegacyImport: true,
    beforeWrite: null,
    active: 0,
    maximum: 0,
  });
  native.events.clear();
  // Each test gets its own prototype, just as each WebView does. Observe
  // another instance separately to ensure sessionStorage is never mirrored.
  class TestStorage implements Storage {
    private values = new Map<string, string>();
    get length() {
      return this.values.size;
    }
    key(index: number) {
      return [...this.values.keys()][index] ?? null;
    }
    getItem(key: string) {
      return this.values.get(key) ?? null;
    }
    setItem(key: string, value: string) {
      this.values.set(key, value);
    }
    removeItem(key: string) {
      this.values.delete(key);
    }
    clear() {
      this.values.clear();
    }
  }
  storage = new TestStorage();
  vi.stubGlobal("isTauri", true);
  vi.stubGlobal("window", { localStorage: storage, addEventListener: vi.fn() });
  vi.stubGlobal("document", { addEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
const api = () => import("../desktopSaves");

it("imports old WebView campaigns once, without copying machine preferences", async () => {
  storage.setItem(SLOT, "old campaign");
  storage.setItem(AUDIO, "quiet");
  storage.setItem("extinction-protocol:progress:v1", "legacy");
  const saves = await api();
  await saves.initializeDesktopSaves();
  expect(native.writes).toEqual([
    { [SLOT]: "old campaign", "extinction-protocol:progress:v1": "legacy" },
  ]);
  expect(saves.getDesktopSaveStatus()).toEqual({
    available: true,
    ready: true,
    recovered: false,
    directory: "/test/saves",
  });
  await saves.initializeDesktopSaves();
  expect(native.writes).toHaveLength(1);
});

it("loads cloud progress over stale WebView data and preserves cloud deletions", async () => {
  storage.setItem(SLOT, "stale");
  storage.setItem(SECOND, "deleted on another computer");
  storage.setItem(AUDIO, "local audio");
  native.entries = { [SLOT]: "cloud progress" };
  const saves = await api();
  await saves.initializeDesktopSaves();
  expect(storage.getItem(SLOT)).toBe("cloud progress");
  expect(storage.getItem(SECOND)).toBeNull();
  expect(storage.getItem(AUDIO)).toBe("local audio");
  expect(native.writes).toEqual([]);
  storage.setItem(SECOND, '{"deleted":true}');
  await saves.flushDesktopSaves();
  expect(native.entries).toEqual({ [SLOT]: "cloud progress", [SECOND]: '{"deleted":true}' });
});

it("treats an existing empty disk document as authoritative", async () => {
  storage.setItem(SLOT, "stale");
  native.entries = {};
  await (await api()).initializeDesktopSaves();
  expect(storage.getItem(SLOT)).toBeNull();
  expect(native.writes).toEqual([]);
});

it("blocks startup and all writes when both native copies are unreadable, then retries", async () => {
  native.entries = { [SLOT]: "protected" };
  native.failRead = true;
  storage.setItem(SLOT, "stale");
  const saves = await api();
  await expect(saves.initializeDesktopSaves()).rejects.toThrow();
  expect(await saves.flushDesktopSaves()).toBe(false);
  expect(native.writes).toEqual([]);
  expect(storage.getItem(SLOT)).toBe("stale");
  native.failRead = false;
  native.recovered = true;
  await saves.initializeDesktopSaves();
  expect(storage.getItem(SLOT)).toBe("protected");
  expect(saves.getDesktopSaveStatus().recovered).toBe(true);
});

it("rejects invalid native entries before changing any cached data", async () => {
  storage.setItem(SLOT, "old");
  native.entries = { [AUDIO]: "invalid in cloud" };
  const saves = await api();
  await expect(saves.initializeDesktopSaves()).rejects.toThrow();
  expect(storage.getItem(SLOT)).toBe("old");
  expect(native.writes).toEqual([]);
});

it("flushes transactions in order and coalesces changes during slow disk writes", async () => {
  const saves = await api();
  await saves.initializeDesktopSaves();
  let release!: () => void;
  native.beforeWrite = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  storage.setItem(SLOT, "first");
  const pending = saves.flushDesktopSaves();
  await vi.waitFor(() => expect(native.active).toBe(1));
  storage.setItem(SLOT, "latest");
  storage.setItem(SECOND, "second slot");
  native.beforeWrite = null;
  release();
  expect(await pending).toBe(true);
  expect(native.maximum).toBe(1);
  expect(native.entries).toEqual({ [SLOT]: "latest", [SECOND]: "second slot" });
});

it("keeps the window open after a disk failure and closes only after a successful retry", async () => {
  const saves = await api();
  await saves.initializeDesktopSaves();
  native.failWrite = true;
  storage.setItem(SLOT, "latest");
  await native.events.get("desktop-save-close-requested")!();
  expect(native.calls).not.toContain("desktop_saves_close");
  const health = await import("./storageHealth");
  expect(health.getSaveIssues().some((issue) => issue.reason === "native")).toBe(true);
  native.failWrite = false;
  await health.retryFailedSaves();
  await native.events.get("desktop-save-close-requested")!();
  expect(native.calls.at(-1)).toBe("desktop_saves_close");
  expect(native.entries).toEqual({ [SLOT]: "latest" });
});

it("keeps the window open when its final checkpoint fails", async () => {
  const saves = await api();
  await saves.initializeDesktopSaves();
  const beforeClose = vi.fn(() => false);
  const failure = vi.fn();
  saves.setDesktopBeforeClose(beforeClose, failure);
  await native.events.get("desktop-save-close-requested")!();
  expect(beforeClose).toHaveBeenCalledOnce();
  expect(failure).toHaveBeenCalledOnce();
  expect(native.calls).not.toContain("desktop_saves_close");
});

it("flushes the final checkpoint before close and releases the pause blocker on disk failure", async () => {
  const saves = await api();
  await saves.initializeDesktopSaves();
  const failure = vi.fn();
  saves.setDesktopBeforeClose(() => {
    storage.setItem(SLOT, "final checkpoint");
    return true;
  }, failure);
  native.failWrite = true;
  await native.events.get("desktop-save-close-requested")!();
  expect(failure).toHaveBeenCalledOnce();
  expect(native.calls).not.toContain("desktop_saves_close");
  native.failWrite = false;
  await native.events.get("desktop-save-close-requested")!();
  expect(native.entries).toEqual({ [SLOT]: "final checkpoint" });
  expect(native.calls.at(-1)).toBe("desktop_saves_close");
  expect(failure).toHaveBeenCalledOnce();
});

it("detects dropped cache writes and never overwrites their disk source", async () => {
  native.entries = { [SLOT]: "disk" };
  storage.setItem = () => {};
  const saves = await api();
  await expect(saves.initializeDesktopSaves()).rejects.toThrow();
  expect(native.writes).toEqual([]);
  expect(saves.getDesktopSaveStatus().ready).toBe(false);
});

it("persists removes and clear without mirroring preferences or sessionStorage", async () => {
  const saves = await api();
  await saves.initializeDesktopSaves();
  storage.setItem(SLOT, "save");
  await saves.flushDesktopSaves();
  storage.setItem(AUDIO, "muted");
  const other = new (storage.constructor as { new (): Storage })();
  other.setItem(SLOT, "session only");
  await saves.flushDesktopSaves();
  expect(native.writes).toHaveLength(2);
  storage.removeItem(SLOT);
  await saves.flushDesktopSaves();
  expect(native.entries).toEqual({});
  storage.setItem(SLOT, "again");
  storage.clear();
  await saves.flushDesktopSaves();
  expect(native.entries).toEqual({});
});

it("does not import another account's WebView cache into a fresh Steam profile", async () => {
  native.allowLegacyImport = false;
  storage.setItem(SLOT, "another Steam account or standalone campaign");
  const saves = await api();
  await saves.initializeDesktopSaves();
  expect(storage.getItem(SLOT)).toBeNull();
  expect(native.entries).toEqual({});
});

it("does not import Steam's cache when returning to a fresh standalone profile", async () => {
  storage.setItem("mesozoic-protocol:desktop-save-owner:v1", "/test/saves/steam/76561197960265729");
  storage.setItem(SLOT, "Steam campaign");
  await (await api()).initializeDesktopSaves();
  expect(storage.getItem(SLOT)).toBeNull();
  expect(native.entries).toEqual({});
});

it("does nothing in browser and Capacitor builds", async () => {
  vi.stubGlobal("isTauri", false);
  const saves = await api();
  await saves.initializeDesktopSaves();
  expect(await saves.flushDesktopSaves()).toBe(true);
  expect(native.calls).toEqual([]);
  expect(saves.getDesktopSaveStatus().available).toBe(false);
});
