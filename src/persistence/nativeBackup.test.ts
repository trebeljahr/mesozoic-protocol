import { afterEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ value: "", fail: false }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async () => ({ value: native.value }),
    set: async ({ value }: { value: string }) => {
      if (native.fail) throw new Error("disk full");
      native.value = value;
    },
  },
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("restores native slot/checkpoint backups without overriding tombstones and warns on failure", async () => {
  vi.useFakeTimers();
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
  vi.stubGlobal("window", { localStorage: storage, addEventListener: () => {} });
  native.value = JSON.stringify({
    "mesozoic-protocol:slot:1:v1": "checkpoint",
    "mesozoic-protocol:slot:2:v1": "old",
    "extinction-protocol:audio:v1": "audio",
  });
  storage.setItem("mesozoic-protocol:slot:2:v1", '{"deleted":true}');
  const { installNativeSaveMirror, restoreNativeSaveBackup } = await import("../nativeSaveBackup");
  const { getSaveIssues, retryFailedSaves } = await import("./storageHealth");
  await restoreNativeSaveBackup();
  expect(storage.getItem("mesozoic-protocol:slot:1:v1")).toBe("checkpoint");
  expect(storage.getItem("mesozoic-protocol:slot:2:v1")).toBe('{"deleted":true}');
  expect(storage.getItem("extinction-protocol:audio:v1")).toBe("audio");
  native.fail = true;
  installNativeSaveMirror();
  await vi.advanceTimersByTimeAsync(1500);
  expect(getSaveIssues().some((i) => i.reason === "native")).toBe(true);
  native.fail = false;
  await retryFailedSaves();
  expect(getSaveIssues().some((i) => i.reason === "native")).toBe(false);
  expect(JSON.parse(native.value)["mesozoic-protocol:slot:1:v1"]).toBe("checkpoint");
});
