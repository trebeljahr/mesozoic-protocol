import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeModal, focusableElements, isActivationKey, mountModal } from "./modalFocus";

// Tiny DOM adapter: exercise the real boundary listeners without a browser or
// renderer. Native Tab's middle-of-list navigation remains the browser's job.
class ElementStub extends EventTarget {
  isConnected = true;
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
  closest() {
    return null;
  }
  focus() {
    doc.activeElement = this;
    const event = new Event("focusin");
    Object.defineProperty(event, "target", { value: this });
    doc.dispatchEvent(event);
  }
}
let doc: EventTarget & { activeElement: ElementStub | null };
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
  doc = Object.assign(new EventTarget(), { activeElement: null });
  win = new EventTarget();
  cleanups = [];
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("HTMLElement", ElementStub);
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
    expect(key("Tab").defaultPrevented).toBe(false);
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
