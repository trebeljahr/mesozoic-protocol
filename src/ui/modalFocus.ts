export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const modals: { element: HTMLElement; priority: number }[] = [];
export const activeModal = (): HTMLElement | null => {
  let top: (typeof modals)[number] | undefined;
  for (const modal of modals) {
    if (modal.element.isConnected && (!top || modal.priority >= top.priority)) top = modal;
  }
  return top?.element ?? null;
};

const SAVE_HEALTH_UTILITY = '[data-modal-utility="save-health"]';

// Only the persistent save-recovery banner may join a modal's input boundary.
export const isModalUtilityTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(SAVE_HEALTH_UTILITY) !== null;

const containsModalTarget = (element: HTMLElement, target: EventTarget | null) =>
  element.contains(target as Node) || isModalUtilityTarget(target);

export const focusableElements = (root: ParentNode): HTMLElement[] => {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  if (root === activeModal()) {
    for (const utility of document.querySelectorAll<HTMLElement>(SAVE_HEALTH_UTILITY)) {
      candidates.push(...utility.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    }
  }
  return [...new Set(candidates)].filter((el) => {
    const rect = el.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      getComputedStyle(el).visibility !== "hidden" &&
      !el.closest("[inert]")
    );
  });
};

export const isActivationKey = (
  event: Pick<KeyboardEvent, "key" | "repeat" | "altKey" | "ctrlKey" | "metaKey">,
) =>
  !event.repeat &&
  !event.altKey &&
  !event.ctrlKey &&
  !event.metaKey &&
  (event.key === "Enter" || event.key === " ");

// Shared by custom cards and MenuOverlay. Keep the stack independent of React
// so keyboard, scene input and controller routing agree on the same boundary.
export function mountModal(element: HTMLElement, onEscape?: () => void, priority = 0) {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const entry = { element, priority };
  modals.push(entry);
  const focusFirst = () =>
    (focusableElements(element)[0] ?? element).focus({ preventScroll: true });
  if (activeModal() === element) focusFirst();

  const onFocus = (event: FocusEvent) => {
    if (activeModal() === element && !containsModalTarget(element, event.target)) focusFirst();
  };
  const onKey = (event: KeyboardEvent) => {
    if (activeModal() !== element) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      onEscape?.();
      return;
    }
    if (event.key !== "Tab") return;
    const elements = focusableElements(element);
    const index = elements.indexOf(document.activeElement as HTMLElement);
    // The banner can live before or after the dialog in the document. Drive
    // the whole sequence explicitly so Tab and controller use the same order.
    event.preventDefault();
    const nextIndex =
      index < 0
        ? event.shiftKey
          ? elements.length - 1
          : 0
        : (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
    (elements[nextIndex] ?? element).focus();
    event.stopImmediatePropagation();
  };
  // Let native and React controls handle keys, then keep gameplay shortcuts
  // on window from observing input owned by the dialog.
  const onBubbleKey = (event: KeyboardEvent) => {
    if (activeModal() === element) event.stopPropagation();
  };
  const onPointer = (event: Event) => {
    if (activeModal() !== element) return;
    // The immediate overlay parent owns backdrop clicks. Everything else is
    // behind the dialog except the explicitly marked save-recovery banner.
    if (isModalUtilityTarget(event.target) || element.parentElement?.contains(event.target as Node))
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  document.addEventListener("focusin", onFocus);
  document.addEventListener("keydown", onBubbleKey);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointerdown", onPointer, true);
  window.addEventListener("click", onPointer, true);
  return () => {
    const wasTop = activeModal() === element || !element.isConnected;
    modals.splice(modals.indexOf(entry), 1);
    document.removeEventListener("focusin", onFocus);
    document.removeEventListener("keydown", onBubbleKey);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pointerdown", onPointer, true);
    window.removeEventListener("click", onPointer, true);
    if (!wasTop) return;
    const top = activeModal();
    if (previous?.isConnected && (!top || containsModalTarget(top, previous)))
      previous.focus({ preventScroll: true });
    else if (top) (focusableElements(top)[0] ?? top).focus({ preventScroll: true });
  };
}
