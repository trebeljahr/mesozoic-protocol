// Headless capture mode (dev only). Hidden browser tabs suspend
// requestAnimationFrame and throttle every other task source, freezing the
// R3F frameloop and the sim with it. `?debug=true&headless=1` installs a
// fully virtual clock so automated sessions (press screenshots, scripted
// repros) can advance time and render exact frames deterministically.
//
// Design: a single virtual clock backs both performance.now() and the
// requestAnimationFrame callback timestamps. The game's sim ticker reads
// performance.now() to derive its frame delta, and R3F's frameloop reads the
// rAF timestamp; backing both with one monotonic clock means a step advances
// the simulation and renders the matching frame in lockstep. Capture code
// drives it through `window.__step(dtMs)` (advance + render one frame) or
// `window.__advance(ms)` (advance several frames worth at once). Nothing
// fires on its own — the tab can be fully hidden.
//
// This lives in its own module, imported first in main.tsx, so the shims are
// installed before @react-three/fiber (pulled in transitively by App) reads
// performance.now() or requestAnimationFrame. Dead-codes out of prod builds
// via the DEV gate.

if (
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("headless") === "1"
) {
  const realNow = performance.now.bind(performance);
  let vnow = realNow();

  // Virtual clock. performance.now() only advances when capture code steps it,
  // so a tight JS loop can simulate arbitrary wall-clock time.
  performance.now = () => vnow;

  const queue = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id: number): void => {
    queue.delete(id);
  };

  // Some libraries gate their loop on page visibility. Force "visible" so the
  // R3F frameloop keeps re-queuing even though the preview tab is hidden.
  try {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  } catch {
    /* getters already locked — ignore */
  }

  // Hidden tabs don't deliver ResizeObserver callbacks, so react-use-measure
  // (used by R3F's <Canvas>) never learns the real element size and the
  // drawing buffer stays at the 300x150 default — the scene renders into a
  // tiny unconfigured viewport and reads back black. Wrap ResizeObserver so
  // observed elements are measured synchronously on observe() and again
  // whenever capture code calls window.__fireResize().
  const NativeRO = window.ResizeObserver;
  const observers = new Set<{
    cb: ResizeObserverCallback;
    els: Set<Element>;
    ro: ResizeObserver;
  }>();
  const measure = (entry: {
    cb: ResizeObserverCallback;
    els: Set<Element>;
    ro: ResizeObserver;
  }) => {
    const entries = [...entry.els].map((target) => {
      const rect = target.getBoundingClientRect();
      return {
        target,
        contentRect: rect,
        borderBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
        contentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
        devicePixelContentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
      } as unknown as ResizeObserverEntry;
    });
    if (entries.length) entry.cb(entries, entry.ro);
  };
  window.ResizeObserver = class {
    private entry: { cb: ResizeObserverCallback; els: Set<Element>; ro: ResizeObserver };
    private native: ResizeObserver;
    constructor(cb: ResizeObserverCallback) {
      this.native = new NativeRO(cb);
      this.entry = { cb, els: new Set(), ro: this as unknown as ResizeObserver };
      observers.add(this.entry);
    }
    observe(el: Element, opts?: ResizeObserverOptions) {
      this.entry.els.add(el);
      this.native.observe(el, opts);
      // Fire once now so the initial size lands without a delivered callback.
      queueMicrotask(() => measure(this.entry));
    }
    unobserve(el: Element) {
      this.entry.els.delete(el);
      this.native.unobserve(el);
    }
    disconnect() {
      this.entry.els.clear();
      observers.delete(this.entry);
      this.native.disconnect();
    }
  } as unknown as typeof ResizeObserver;
  (window as unknown as { __fireResize: () => number }).__fireResize = () => {
    for (const entry of observers) measure(entry);
    return observers.size;
  };

  // Drain queued frame callbacks once at the current virtual time.
  const flush = (): number => {
    const batch = [...queue.values()];
    queue.clear();
    for (const cb of batch) cb(vnow);
    return batch.length;
  };

  // Advance the clock by dtMs and render exactly one frame.
  const step = (dtMs = 16.7): number => {
    vnow += dtMs;
    return flush();
  };

  // Advance `ms` of virtual time in ~16ms frames (one render per frame).
  const advance = (ms: number, dtMs = 16.7): number => {
    let frames = 0;
    let remaining = ms;
    while (remaining > 0) {
      step(Math.min(dtMs, remaining));
      remaining -= dtMs;
      frames++;
    }
    return frames;
  };

  const api = window as unknown as {
    __rafFlush: () => number;
    __rafStep: (dtMs?: number) => number;
    __advance: (ms: number, dtMs?: number) => number;
    __vnow: () => number;
  };
  api.__rafFlush = flush;
  api.__rafStep = step;
  api.__advance = advance;
  api.__vnow = () => vnow;
}

export {};
