import { useLayoutEffect, useRef } from "react";
import { mountModal } from "./modalFocus";

export function useModalFocus(onEscape?: () => void, enabled = true, priority = 0) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onEscape);
  callback.current = onEscape;
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    return mountModal(ref.current, () => callback.current?.(), priority);
  }, [enabled, priority]);
  return ref;
}
