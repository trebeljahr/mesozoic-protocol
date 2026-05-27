import { type ReactNode, useEffect, useState } from "react";

// Mount-stagger gate. Renders nothing for `frames` requestAnimationFrame
// ticks after mount, then renders children. Used to spread the GPU work
// (program compile + first-frame texture/geometry upload + initial shadow
// pass) of a heavy scene across multiple frames so a single tick can't
// exceed Chrome's WebGL context-loss watchdog window.
//
// Frames is measured from this component's first React commit, so callers
// can stagger groups simply by handing each its own `frames` count
// (`0 / 1 / 2 / 3 …`). The component itself is otherwise inert — it
// neither subscribes to the store nor allocates GPU resources of its own.
export const Defer = ({ frames, children }: { frames: number; children: ReactNode }): ReactNode => {
  const [ready, setReady] = useState(frames <= 0);
  useEffect(() => {
    if (frames <= 0) {
      setReady(true);
      return;
    }
    let remaining = frames;
    let id = 0;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        setReady(true);
        return;
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [frames]);
  return ready ? children : null;
};
