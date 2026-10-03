import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  value: null as string | null,
  failRead: false,
  failWrite: false,
  writes: [] as string[],
  beforeRead: null as (() => Promise<void>) | null,
  beforeWrite: null as (() => Promise<void>) | null,
  inFlight: 0,
  maxInFlight: 0,
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async () => {
      await native.beforeRead?.();
      if (native.failRead) throw new Error("native read failed");
      return { value: native.value };
    },
    set: async ({ value }: { value: string }) => {
      native.inFlight++;
      native.maxInFlight = Math.max(native.maxInFlight, native.inFlight);
      try {
        await native.beforeWrite?.();
        if (native.failWrite) throw new Error("disk full");
        native.value = value;
        native.writes.push(value);
      } finally {
        native.inFlight--;
      }
    },
  },
}));

const SLOT = "mesozoic-protocol:slot:1:v1";
const SECOND = "mesozoic-protocol:slot:2:v1";
const TOMBSTONE = '{"deleted":true}';
let storage: Storage;
let events: Map<string, () => void>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  native.value = null;
  native.failRead = false;
  native.failWrite = false;
  native.writes = [];
  native.beforeRead = null;
  native.beforeWrite = null;
  native.inFlight = 0;
  native.maxInFlight = 0;
  const map = new Map<string, string>();
  events = new Map();
  storage = {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => map.clear(),
  };
  vi.stubGlobal("window", {
    localStorage: storage,
    addEventListener: (name: string, fn: () => void) => events.set(name, fn),
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const api = async () => ({
  ...(await import("../nativeSaveBackup")),
  ...(await import("./storageHealth")),
});
const hasWarning = (issues: { reason: string }[]) => issues.some((i) => i.reason === "native");

it("restores native saves, keeps local tombstones, and retries write failures", async () => {
  native.value = JSON.stringify({
    [SLOT]: "checkpoint",
    [SECOND]: "old",
    "extinction-protocol:audio:v1": "audio",
  });
  storage.setItem(SECOND, TOMBSTONE);
  const s = await api();
  await s.restoreNativeSaveBackup();
  expect(storage.getItem(SLOT)).toBe("checkpoint");
  expect(storage.getItem(SECOND)).toBe(TOMBSTONE);
  expect(storage.getItem("extinction-protocol:audio:v1")).toBe("audio");
  native.failWrite = true;
  s.installNativeSaveMirror();
  await vi.advanceTimersByTimeAsync(1500);
  expect(hasWarning(s.getSaveIssues())).toBe(true);
  native.failWrite = false;
  await s.retryFailedSaves();
  expect(hasWarning(s.getSaveIssues())).toBe(false);
  expect(JSON.parse(native.value!)[SLOT]).toBe("checkpoint");
  expect(JSON.parse(native.value!)["extinction-protocol:audio:v1"]).toBe("audio");
});

it("flushes continuous one-second checkpoints at bounded deadlines", async () => {
  const s = await api();
  await s.restoreNativeSaveBackup();
  s.installNativeSaveMirror();
  for (let i = 1; i <= 10; i++) {
    storage.setItem(SLOT, `checkpoint-${i}`);
    await vi.advanceTimersByTimeAsync(1000);
  }
  expect(native.writes.length).toBeGreaterThanOrEqual(5);
  expect(JSON.parse(native.value!)[SLOT]).toBe("checkpoint-10");
});

it("leaves unread native data untouched until retry restores it safely", async () => {
  const original = JSON.stringify({
    [SLOT]: "original",
    [SECOND]: "other",
    "extinction-protocol:slot:1:v1": "legacy",
  });
  native.value = original;
  native.failRead = true;
  const s = await api();
  await s.restoreNativeSaveBackup();
  s.installNativeSaveMirror();
  storage.setItem(SLOT, TOMBSTONE);
  await vi.advanceTimersByTimeAsync(5000);
  events.get("pagehide")?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(native.writes).toEqual([]);
  expect(native.value).toBe(original);
  expect(hasWarning(s.getSaveIssues())).toBe(true);
  native.failRead = false;
  await s.retryFailedSaves();
  expect(storage.getItem(SLOT)).toBe(TOMBSTONE);
  expect(storage.getItem(SECOND)).toBe("other");
  expect(storage.getItem("extinction-protocol:slot:1:v1")).toBeNull();
  expect(JSON.parse(native.value!)[SLOT]).toBe(TOMBSTONE);
  expect(hasWarning(s.getSaveIssues())).toBe(false);
});

it.each([
  "",
  "broken",
  "[]",
  "null",
  JSON.stringify({ [SLOT]: 42 }),
  JSON.stringify({ [SLOT]: "good", "unrelated:key": "bad" }),
])("preserves invalid mirror %j and blocks all writes on retry", async (raw) => {
  native.value = raw;
  const s = await api();
  await s.restoreNativeSaveBackup();
  s.installNativeSaveMirror();
  await vi.advanceTimersByTimeAsync(1500);
  await s.retryFailedSaves();
  expect(native.value).toBe(raw);
  expect(native.writes).toEqual([]);
  expect(storage.getItem(SLOT)).toBeNull();
  expect(hasWarning(s.getSaveIssues())).toBe(true);
});

it("blocks seeding while an initial native read is still pending", async () => {
  let release!: () => void;
  native.beforeRead = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  native.value = JSON.stringify({ [SLOT]: "restored" });
  const s = await api();
  const restoring = s.restoreNativeSaveBackup();
  s.installNativeSaveMirror();
  await vi.advanceTimersByTimeAsync(2000);
  expect(native.writes).toEqual([]);
  release();
  await restoring;
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(native.value!)[SLOT]).toBe("restored");
  expect(storage.getItem(SLOT)).toBe("restored");
});

it("refuses seeding before any successful native read", async () => {
  native.value = JSON.stringify({ [SLOT]: "original" });
  const s = await api();
  s.installNativeSaveMirror();
  await vi.advanceTimersByTimeAsync(1500);
  expect(native.writes).toEqual([]);
  await s.retryFailedSaves();
  expect(storage.getItem(SLOT)).toBe("original");
});

it("preserves the mirror after a partial restore and retains newer local values on retry", async () => {
  native.value = JSON.stringify({ [SLOT]: "first", [SECOND]: "second" });
  const set = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === SECOND) throw new Error("quota");
    set(key, value);
  };
  const s = await api();
  await s.restoreNativeSaveBackup();
  expect(storage.getItem(SLOT)).toBe("first");
  s.installNativeSaveMirror();
  await vi.advanceTimersByTimeAsync(1500);
  expect(native.writes).toEqual([]);
  storage.setItem = set;
  storage.setItem(SLOT, "newer local");
  await s.retryFailedSaves();
  expect(storage.getItem(SLOT)).toBe("newer local");
  expect(storage.getItem(SECOND)).toBe("second");
  expect(JSON.parse(native.value!)[SLOT]).toBe("newer local");
});

it("detects a silently dropped local restore without overwriting its source", async () => {
  const original = JSON.stringify({ [SLOT]: "original" });
  native.value = original;
  storage.setItem = () => {};
  const s = await api();
  await s.restoreNativeSaveBackup();
  s.installNativeSaveMirror();
  await vi.advanceTimersByTimeAsync(1500);
  expect(native.value).toBe(original);
  expect(native.writes).toEqual([]);
  expect(hasWarning(s.getSaveIssues())).toBe(true);
});

it("serializes slow native writes and eventually flushes the latest checkpoint", async () => {
  const s = await api();
  await s.restoreNativeSaveBackup();
  s.installNativeSaveMirror();
  let release!: () => void;
  native.beforeWrite = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  storage.setItem(SLOT, "first");
  await vi.advanceTimersByTimeAsync(1500);
  storage.setItem(SLOT, "latest");
  await vi.advanceTimersByTimeAsync(1500);
  expect(native.inFlight).toBe(1);
  native.beforeWrite = null;
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(native.maxInFlight).toBe(1);
  expect(JSON.parse(native.value!)[SLOT]).toBe("latest");
});
