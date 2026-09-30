import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enterFullscreen, exitFullscreen } from "./useFullscreen";

describe("fullscreen Escape ownership", () => {
  let win: EventTarget;
  let doc: EventTarget & {
    fullscreenElement: object | null;
    documentElement: { requestFullscreen: ReturnType<typeof vi.fn> };
    exitFullscreen: ReturnType<typeof vi.fn>;
  };
  let keyboard: { lock: ReturnType<typeof vi.fn>; unlock: ReturnType<typeof vi.fn> };
  const escapeEvent = (repeat = false) =>
    Object.assign(new Event("keydown", { cancelable: true }), { code: "Escape", repeat });

  beforeEach(() => {
    vi.useFakeTimers();
    win = new EventTarget();
    doc = Object.assign(new EventTarget(), {
      fullscreenElement: null as object | null,
      documentElement: {
        requestFullscreen: vi.fn(async () => {
          doc.fullscreenElement = doc.documentElement;
        }),
      },
      exitFullscreen: vi.fn(async () => {
        doc.fullscreenElement = null;
        doc.dispatchEvent(new Event("fullscreenchange"));
      }),
    });
    keyboard = { lock: vi.fn().mockResolvedValue(undefined), unlock: vi.fn() };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", { keyboard });
  });

  afterEach(async () => {
    await exitFullscreen();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("captures only Escape and lets a selection or dialog consume it", async () => {
    await enterFullscreen();
    expect(keyboard.lock).toHaveBeenCalledWith(["Escape"]);
    win.addEventListener("keydown", (event) => event.preventDefault());
    win.dispatchEvent(escapeEvent());
    await vi.runAllTimersAsync();
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
  });

  it("stays fullscreen after repeated unhandled Escape taps", async () => {
    await enterFullscreen();
    for (let tap = 0; tap < 5; tap++) {
      win.dispatchEvent(escapeEvent());
      win.dispatchEvent(Object.assign(new Event("keyup"), { code: "Escape" }));
      await vi.runAllTimersAsync();
    }
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
    expect(keyboard.unlock).not.toHaveBeenCalled();
    expect(doc.fullscreenElement).not.toBeNull();
  });

  it("leaves hold-to-exit to the browser and suppresses repeated game actions", async () => {
    await enterFullscreen();
    win.dispatchEvent(escapeEvent());
    const repeated = escapeEvent(true);
    win.dispatchEvent(repeated);
    expect(repeated.defaultPrevented).toBe(true);
    await vi.runAllTimersAsync();
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
  });

  it("releases the lock and listeners when the browser exits fullscreen", async () => {
    await enterFullscreen();
    doc.fullscreenElement = null;
    doc.dispatchEvent(new Event("fullscreenchange"));
    expect(keyboard.unlock).toHaveBeenCalledOnce();
    doc.fullscreenElement = doc.documentElement;
    win.dispatchEvent(escapeEvent());
    await vi.runAllTimersAsync();
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
  });

  it("keeps fullscreen usable when permission is denied", async () => {
    keyboard.lock.mockRejectedValue(new Error("Permission denied"));
    expect(await enterFullscreen()).toBe(true);
    win.dispatchEvent(escapeEvent());
    await vi.runAllTimersAsync();
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
    expect(doc.fullscreenElement).not.toBeNull();
  });

  it("supports browsers without Keyboard Lock", async () => {
    vi.stubGlobal("navigator", {});
    expect(await enterFullscreen()).toBe(true);
    expect(keyboard.lock).not.toHaveBeenCalled();
  });
});
