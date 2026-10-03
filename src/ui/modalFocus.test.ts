import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeModal,
  focusableElements,
  isActivationKey,
  isModalUtilityTarget,
  mountModal,
} from "./modalFocus";

// Tiny DOM adapter: exercise the real boundary listeners without a browser or
// renderer, including the composite dialog and save-utility Tab sequence.
class ElementStub extends EventTarget {
  isConnected = true;
  utility: string | null = null;
  inert = false;
  parentElement: ElementStub | null = null;
  children: ElementStub[] = [];
  append(child: ElementStub) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  contains(node: unknown): boolean {
    return node === this || this.children.some((child) => child.contains(node));
  }
  querySelectorAll(): ElementStub[] {
    return this.children;
  }
  getBoundingClientRect() {
    return { width: 20, height: 20 };
  }
  closest(selector: string): ElementStub | null {
    if (selector === '[data-modal-utility="save-health"]' && this.utility === "save-health")
      return this;
    if (selector === "[inert]" && this.inert) return this;
    return this.parentElement?.closest(selector) ?? null;
  }
  focus() {
    doc.activeElement = this;
    const event = new Event("focusin");
    Object.defineProperty(event, "target", { value: this });
    doc.dispatchEvent(event);
  }
}
let doc: EventTarget & { activeElement: ElementStub | null; querySelectorAll: () => ElementStub[] };
let utilities: ElementStub[];
let win: EventTarget;
let cleanups: (() => void)[];
const mount = (element: ElementStub, close?: () => void, priority?: number) => {
  const cleanup = mountModal(element as unknown as HTMLElement, close, priority);
  cleanups.push(cleanup);
  return () => {
    cleanup();
    cleanups = cleanups.filter((item) => item !== cleanup);
  };
};
const key = (key: string, shiftKey = false) => {
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, { key, shiftKey });
  win.dispatchEvent(event);
  return event;
};
beforeEach(() => {
  utilities = [];
  doc = Object.assign(new EventTarget(), {
    activeElement: null,
    querySelectorAll: () => utilities,
  });
  win = new EventTarget();
  cleanups = [];
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("HTMLElement", ElementStub);
  vi.stubGlobal("Element", ElementStub);
  vi.stubGlobal("getComputedStyle", () => ({ visibility: "visible" }));
});
afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  vi.unstubAllGlobals();
});

describe("modal input boundary", () => {
  it("focuses the first control, wraps Tab both ways, and restores the trigger", () => {
    const trigger = new ElementStub();
    trigger.focus();
    const card = new ElementStub();
    const first = card.append(new ElementStub());
    const last = card.append(new ElementStub());
    const close = mount(card);
    expect(doc.activeElement).toBe(first);
    expect(key("Tab", true).defaultPrevented).toBe(true);
    expect(doc.activeElement).toBe(last);
    expect(key("Tab").defaultPrevented).toBe(true);
    expect(doc.activeElement).toBe(first);
    expect(key("Tab").defaultPrevented).toBe(true);
    expect(doc.activeElement).toBe(last);
    close();
    expect(doc.activeElement).toBe(trigger);
  });
  it("routes Escape only to the active dialog and restores nested focus", () => {
    const base = new ElementStub();
    const first = base.append(new ElementStub());
    const closeBase = vi.fn();
    mount(base, closeBase);
    const top = new ElementStub();
    top.append(new ElementStub());
    const closeTop = vi.fn();
    const unmountTop = mount(top, closeTop);
    key("Escape");
    expect(closeTop).toHaveBeenCalledOnce();
    expect(closeBase).not.toHaveBeenCalled();
    expect(focusableElements(activeModal()!)).toEqual(top.children);
    unmountTop();
    expect(doc.activeElement).toBe(first);
    key("Escape");
    expect(closeBase).toHaveBeenCalledOnce();
  });
  it("blocks behind-overlay clicks and focus while preserving normal scrolling keys", () => {
    const overlay = new ElementStub();
    const card = overlay.append(new ElementStub());
    const first = card.append(new ElementStub());
    mount(card);
    const behind = new ElementStub();
    behind.focus();
    expect(doc.activeElement).toBe(first);
    const event = new Event("click", { cancelable: true });
    Object.defineProperty(event, "target", { value: behind });
    win.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(key("ArrowDown").defaultPrevented).toBe(false);
    expect(key("PageDown").defaultPrevented).toBe(false);
  });
  it("allows save recovery pointer, focus, Tab and button activation without opening gameplay input", () => {
    const overlay = new ElementStub();
    const card = overlay.append(new ElementStub());
    const first = card.append(new ElementStub());
    const last = card.append(new ElementStub());
    const banner = new ElementStub();
    banner.utility = "save-health";
    const retry = banner.append(new ElementStub());
    const retrySave = vi.fn();
    retry.addEventListener("click", retrySave);
    utilities.push(banner);
    mount(card);
    // Controller navigation uses this exact candidate list and clicks its focused button.
    expect(focusableElements(activeModal()!)).toEqual([first, last, retry]);
    last.focus();
    key("Tab");
    expect(doc.activeElement).toBe(retry);
    expect(isModalUtilityTarget(retry)).toBe(true);
    key("Tab");
    expect(doc.activeElement).toBe(first);
    key("Tab", true);
    expect(doc.activeElement).toBe(retry);
    key("Tab", true);
    expect(doc.activeElement).toBe(last);
    retry.focus();
    expect(doc.activeElement).toBe(retry);
    for (const type of ["pointerdown", "click"]) {
      const event = new Event(type, { cancelable: true });
      Object.defineProperty(event, "target", { value: retry });
      if (win.dispatchEvent(event)) retry.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(retrySave).toHaveBeenCalledOnce();
    const otherUtility = new ElementStub();
    otherUtility.utility = "other";
    expect(isModalUtilityTarget(otherUtility)).toBe(false);
    otherUtility.focus();
    expect(doc.activeElement).toBe(first);
    const event = new Event("click", { cancelable: true });
    Object.defineProperty(event, "target", { value: otherUtility });
    win.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
  it("shares only the active dialog with the banner across nested modal lifetimes", () => {
    const base = new ElementStub();
    const baseButton = base.append(new ElementStub());
    const banner = new ElementStub();
    banner.utility = "save-health";
    const retry = banner.append(new ElementStub());
    utilities.push(banner);
    mount(base);
    retry.focus();
    const top = new ElementStub();
    const topButton = top.append(new ElementStub());
    const unmountTop = mount(top);
    expect(focusableElements(activeModal()!)).toEqual([topButton, retry]);
    baseButton.focus();
    expect(doc.activeElement).toBe(topButton);
    key("Tab");
    expect(doc.activeElement).toBe(retry);
    unmountTop();
    expect(doc.activeElement).toBe(retry);
    expect(focusableElements(activeModal()!)).toEqual([baseButton, retry]);
    banner.inert = true;
    expect(focusableElements(activeModal()!)).toEqual([baseButton]);
    utilities.length = 0;
    key("Tab");
    expect(doc.activeElement).toBe(baseButton);
  });
  it("keeps the rotate prompt above later-mounted dialogs", () => {
    const rotate = new ElementStub();
    mount(rotate, undefined, 100);
    const card = new ElementStub();
    const close = vi.fn();
    mount(card, close);
    expect(activeModal()).toBe(rotate);
    key("Escape");
    expect(close).not.toHaveBeenCalled();
  });
  it("only accepts deliberate Enter or Space for briefing confirmation", () => {
    const event = { key: "Enter", repeat: false, ctrlKey: false, metaKey: false, altKey: false };
    expect(isActivationKey(event)).toBe(true);
    expect(isActivationKey({ ...event, key: " " })).toBe(true);
    for (const key of ["Tab", "ArrowDown", "PageDown", "Escape", "p"]) {
      expect(isActivationKey({ ...event, key })).toBe(false);
    }
    expect(isActivationKey({ ...event, repeat: true })).toBe(false);
    expect(isActivationKey({ ...event, ctrlKey: true })).toBe(false);
  });
});
