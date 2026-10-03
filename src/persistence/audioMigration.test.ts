import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../audio/AudioManager", () => ({ audio: {} }));
let storage: Storage;
beforeEach(() => {
  vi.resetModules();
  const data = new Map<string, string>();
  storage = {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
    clear: () => data.clear(),
  };
  vi.stubGlobal("localStorage", storage);
});
afterEach(() => vi.unstubAllGlobals());

it("migrates old-prefix v1 audio through the per-bus schema", async () => {
  storage.setItem(
    "extinction-protocol:audio:v1",
    JSON.stringify({ sfx: 0.2, music: 0.1, muted: true }),
  );
  const { loadAudioPrefs } = await import("../audio/preferences");
  expect(loadAudioPrefs()).toMatchObject({
    ui: 0.2,
    towers: 0.2,
    enemies: 0.2,
    notifications: 0.2,
    music: 0.1,
    muted: true,
  });
  expect(storage.getItem("extinction-protocol:audio:v1")).toBeNull();
  expect(storage.getItem("mesozoic-protocol:audio:v1")).toBeNull();
  expect(storage.getItem("mesozoic-protocol:audio:v2")).not.toBeNull();
});

it("preserves the old audio value if copying or schema migration fails", async () => {
  storage.setItem("mesozoic-protocol:audio:v1", JSON.stringify({ sfx: 0.3 }));
  storage.setItem = () => {
    throw new Error("quota");
  };
  const { loadAudioPrefs } = await import("../audio/preferences");
  expect(loadAudioPrefs().ui).toBe(0.3);
  expect(storage.getItem("mesozoic-protocol:audio:v1")).not.toBeNull();
});

it("keeps existing new-prefix v2 preferences", async () => {
  storage.setItem("mesozoic-protocol:audio:v2", JSON.stringify({ ui: 0.8, muted: true }));
  storage.setItem("extinction-protocol:audio:v2", JSON.stringify({ ui: 0.1 }));
  const { loadAudioPrefs } = await import("../audio/preferences");
  expect(loadAudioPrefs().ui).toBe(0.8);
  expect(storage.getItem("extinction-protocol:audio:v2")).not.toBeNull();
});
