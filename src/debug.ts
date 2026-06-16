// Debug mode — enabled only in dev builds AND when the URL has
// `?debug=true`. The pattern matches raptor-runner: gate on
// `import.meta.env.DEV` so Vite/Rollup dead-code-eliminate the entire
// debug surface in production. Adding `?debug=true` to a deployed
// build does nothing.
//
// Components read `isDebug` to decide whether to render their debug
// section, and CSS can target `body[data-debug="true"]` for finer
// gating (e.g. show-on-hover toggles).
//
// All runtime mutations live as store actions (see store.ts:
// debug*). This module only owns the URL gate + body attribute.

const readParam = (key: string, value: string): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get(key) === value;
  } catch {
    return false;
  }
};

// `import.meta.env.DEV` is replaced statically at build time, so these
// constants collapse to `false && ...` in production and the entire
// debug branch dead-codes out.
//
// Capture mode drives the game for press screenshots. It needs the store
// handle on `window` but must NOT draw any debug visuals — so it counts as
// "debug" for the store/console exposure below, while `showDebugOverlays`
// (which gates in-world debug drawing like the planner labels) is suppressed.
// Two query flags enable it:
//   ?capture=1  — overlay-free + store exposed, real-time clock. Used by the
//                 Playwright screenshot script (scripts/capture-screenshots.mjs),
//                 which runs in real headless Chromium where rAF works.
//   ?headless=1 — same, plus the virtual-clock shim in src/headlessRaf.ts for
//                 driving the game inside a throttled/hidden preview tab.
export const isHeadlessCapture: boolean =
  import.meta.env.DEV === true && (readParam("capture", "1") || readParam("headless", "1"));
export const isDebug: boolean =
  import.meta.env.DEV === true && (readParam("debug", "true") || isHeadlessCapture);

// True only for interactive debugging — gates in-world debug overlays
// (planner labels, path lines, etc.) that would pollute a capture frame.
export const showDebugOverlays: boolean = isDebug && !isHeadlessCapture;

if (isDebug && !isHeadlessCapture && typeof document !== "undefined") {
  document.body.setAttribute("data-debug", "true");
}

// In debug (or headless capture) mode, expose the Zustand store on window so
// quick console repros / preview eval can drive level selection without
// clicking through the world map. Production builds dead-code this since
// `isDebug` is gated on `import.meta.env.DEV`.
if (isDebug && typeof window !== "undefined") {
  // Lazy require to avoid a circular import at module init time.
  import("./store").then(({ useGame }) => {
    (window as unknown as { __game: unknown }).__game = useGame;
  });
}
