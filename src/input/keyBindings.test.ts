import { afterEach, expect, it, vi } from "vitest";
import {
  actionForKey,
  BINDING_ACTIONS,
  DEFAULT_BINDINGS,
  normalizeBindings,
  useKeyBindings,
} from "./keyBindings";

afterEach(() => {
  vi.unstubAllGlobals();
  useKeyBindings.setState({ bindings: { ...DEFAULT_BINDINGS }, storageFailed: false });
});
it("repairs corrupt, reserved and duplicate keys without making any action unreachable", () => {
  const keys = normalizeBindings({ wave: "Escape", menu: "KeyQ", ability1: "KeyQ", robot: 9 });
  expect(new Set(Object.values(keys)).size).toBe(BINDING_ACTIONS.length);
  expect(Object.values(keys)).not.toContain("Escape");
  expect(keys.wave).toBe("Space");
  expect(keys.menu).toBe("KeyQ");
});
it("rejects conflicts and respects remaps, modifiers and held keys", () => {
  vi.stubGlobal("localStorage", { setItem: vi.fn() });
  expect(useKeyBindings.getState().bind("ability1", "KeyW")).toBe("conflict");
  expect(useKeyBindings.getState().bind("ability1", "KeyH")).toBe(null);
  const event = { code: "KeyH", ctrlKey: false, altKey: false, metaKey: false, repeat: false };
  expect(actionForKey(event, useKeyBindings.getState().bindings)).toBe("ability1");
  expect(
    actionForKey({ ...event, code: "KeyQ" }, useKeyBindings.getState().bindings),
  ).toBeUndefined();
  expect(
    actionForKey({ ...event, ctrlKey: true }, useKeyBindings.getState().bindings),
  ).toBeUndefined();
  expect(
    actionForKey({ ...event, repeat: true }, useKeyBindings.getState().bindings),
  ).toBeUndefined();
});
it("keeps working on write failure and restores defaults on reset", () => {
  vi.stubGlobal("localStorage", {
    setItem: vi.fn().mockImplementationOnce(() => {
      throw Error("quota");
    }),
  });
  useKeyBindings.getState().bind("menu", "KeyM");
  expect(useKeyBindings.getState().storageFailed).toBe(true);
  expect(useKeyBindings.getState().bindings.menu).toBe("KeyM");
  useKeyBindings.getState().reset();
  expect(useKeyBindings.getState().bindings).toEqual(DEFAULT_BINDINGS);
  expect(useKeyBindings.getState().storageFailed).toBe(false);
});
