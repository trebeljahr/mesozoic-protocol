// Use native setters, bypassing React's value tracker, then emit the same
// bubbling events React observes for user changes to controlled form fields.
const setNativeValue = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
  const prototype =
    element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
};

export function adjustGamepadControl(element: Element | null, direction: -1 | 1): boolean {
  if (element instanceof HTMLSelectElement && !element.disabled) {
    const options = Array.from(element.options).filter(
      (option) =>
        !option.disabled &&
        !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled),
    );
    const current = options.findIndex((option) => option.value === element.value);
    const next = options[Math.min(options.length - 1, Math.max(0, current + direction))];
    if (next && next.value !== element.value) setNativeValue(element, next.value);
    return true;
  }
  if (!(element instanceof HTMLInputElement) || element.disabled || element.readOnly) return false;
  if (element.type === "checkbox" || element.type === "radio") {
    if (element.checked !== (direction === 1)) element.click();
    return true;
  }
  if (element.type !== "range" && element.type !== "number") return false;
  const min = element.min === "" ? (element.type === "range" ? 0 : -Infinity) : Number(element.min);
  const max =
    element.max === "" ? (element.type === "range" ? 100 : Infinity) : Number(element.max);
  const step =
    element.step === "any"
      ? Number.isFinite(max - min)
        ? (max - min) / 100
        : 1
      : Number(element.step || 1);
  if (!Number.isFinite(step) || step <= 0) return true;
  const current = Number(element.value || (Number.isFinite(min) ? min : 0));
  const origin = Number.isFinite(min) ? min : 0;
  const slot = (current - origin) / step;
  const nextSlot = direction > 0 ? Math.floor(slot + 1e-8) + 1 : Math.ceil(slot - 1e-8) - 1;
  const value = Math.max(min, Math.min(max, Number((origin + nextSlot * step).toFixed(10))));
  if (Number.isFinite(value) && value !== current) setNativeValue(element, String(value));
  return true;
}

export function activateGamepadControl(element: Element | null): boolean {
  if (element instanceof HTMLSelectElement) return adjustGamepadControl(element, 1);
  if (!(element instanceof HTMLInputElement) || element.disabled) return false;
  if (element.type === "checkbox" || element.type === "radio") {
    element.click();
    return true;
  }
  return element.type === "range" || element.type === "number";
}
