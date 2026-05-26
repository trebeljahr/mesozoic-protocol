import { useEffect, useRef } from "react";

// Browser-history-backed "back gesture" registry. Each call to
// useBackNavigation that flips `active` to true pushes a synthetic history
// entry and registers a handler on a LIFO stack; the next popstate (browser
// back, mouse back-button, Android hardware back, iOS edge-swipe, Capacitor
// WebView default) pops the top handler and invokes it instead of leaving
// the SPA. When `active` flips back to false from React-side state (close
// button, escape key, programmatic transition), the synthetic entry is
// rewound so the next back targets the layer below, not the one we just
// closed.

type Entry = { id: number; fn: () => void };

const stack: Entry[] = [];
let nextId = 0;
let suppressNext = 0;
let userPoppedId: number | null = null;
let initialized = false;

const initListener = (): void => {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("popstate", () => {
    if (suppressNext > 0) {
      suppressNext--;
      return;
    }
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
      // User-initiated pop already removed the entry from both stack and
      // history; no further rewind needed.
      if (userPoppedId === id) return;
      const idx = stack.findIndex((e) => e.id === id);
      if (idx < 0) return;
      stack.splice(idx, 1);
      if (idx === stack.length) {
        // We were on top — pair the React unmount with a history rewind.
        suppressNext++;
        window.history.back();
      }
      // Middle removal leaves the history slot orphaned. The user pays one
      // extra no-op back press in that rare case rather than corrupting
      // the entries above.
    };
  }, [active]);
};
