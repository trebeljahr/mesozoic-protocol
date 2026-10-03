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

export const focusableElements = (root: ParentNode): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    const rect = el.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      getComputedStyle(el).visibility !== "hidden" &&
      !el.closest("[inert]")
    );
  });

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
    if (activeModal() === element && !element.contains(event.target as Node)) focusFirst();
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
    if (
      elements.length === 0 ||
      index < 0 ||
      (event.shiftKey ? index === 0 : index === elements.length - 1)
    ) {
      event.preventDefault();
      (event.shiftKey ? (elements.at(-1) ?? element) : (elements[0] ?? element)).focus();
    }
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
    // behind the dialog, even if a utility button has a higher CSS z-index.
    if (element.parentElement?.contains(event.target as Node)) return;
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
    if (previous?.isConnected && (!top || top.contains(previous)))
      previous.focus({ preventScroll: true });
    else if (top) (focusableElements(top)[0] ?? top).focus({ preventScroll: true });
  };
}
