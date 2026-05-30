import { useEffect, useRef } from "react";

// Browser-history-backed "back gesture" registry. Each call to
// useBackNavigation that flips `active` to true pushes a synthetic history
// entry and registers a handler on a LIFO stack; the next popstate (browser
// back, mouse back-button, Android hardware back, iOS edge-swipe, Capacitor
// WebView default) pops the top handler and invokes it instead of leaving
// the SPA. When `active` flips back to false from React-side state (close
// button, escape key, programmatic transition), the current synthetic entry
// is marked inert. We intentionally do not call history.back() from cleanup:
// browser history movement is async, and screen transitions can push a new
// entry in the same React commit. Rewinding there can pop the fresh entry and
// walk the tab out of the app.

type Entry = { id: number; fn: () => void };

const stack: Entry[] = [];
let nextId = 0;
let userPoppedId: number | null = null;
let initialized = false;

const initListener = (): void => {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("popstate", () => {
    const top = stack.pop();
    if (!top) return;
    userPoppedId = top.id;
    try {
      top.fn();
    } finally {
      userPoppedId = null;
    }
  });
};

export const useBackNavigation = (active: boolean, onBack: () => void): void => {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    initListener();
    if (!active) return;
    const id = ++nextId;
    stack.push({ id, fn: () => onBackRef.current() });
    window.history.pushState({ __navId: id }, "");
    return () => {
      // User-initiated pop already removed the entry from the stack and
      // moved browser history onto the previous entry.
      if (userPoppedId === id) return;
      const idx = stack.findIndex((e) => e.id === id);
      if (idx < 0) return;
      stack.splice(idx, 1);

      const state = window.history.state as { __navId?: unknown } | null;
      if (state?.__navId === id) {
        window.history.replaceState({ __navId: id, __navInactive: true }, "");
      }
    };
  }, [active]);
};
