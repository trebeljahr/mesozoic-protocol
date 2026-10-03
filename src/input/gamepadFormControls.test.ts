import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activateGamepadControl, adjustGamepadControl } from "./gamepadFormControls";

class Input extends EventTarget {
  type = "range";
  disabled = false;
  readOnly = false;
  checked = false;
  min = "0";
  max = "1";
  step = "0.1";
  stored = "0.5";
  get value() {
    return this.stored;
  }
  set value(value: string) {
    this.stored = value;
  }
  click() {
    this.checked = !this.checked;
    this.dispatchEvent(new Event("change", { bubbles: true }));
  }
}
class Group {
  disabled = false;
}
class Select extends EventTarget {
  disabled = false;
  stored = "low";
  options = [
    { value: "low", disabled: false, parentElement: null },
    { value: "medium", disabled: true, parentElement: null },
    { value: "high", disabled: false, parentElement: null },
  ];
  get value() {
    return this.stored;
  }
  set value(value: string) {
    this.stored = value;
  }
}
const element = (value: Input | Select) => value as unknown as Element;
beforeEach(() => {
  vi.stubGlobal("HTMLInputElement", Input);
  vi.stubGlobal("HTMLSelectElement", Select);
  vi.stubGlobal("HTMLOptGroupElement", Group);
});
afterEach(() => vi.unstubAllGlobals());
describe("controller form editing", () => {
  it("changes native controlled select values and emits bubbling React-compatible events", () => {
    const select = new Select();
    const trackedSetter = vi.fn();
    Object.defineProperty(select, "value", { get: () => select.stored, set: trackedSetter });
    const changes: boolean[] = [];
    select.addEventListener("change", (event) => changes.push(event.bubbles));
    expect(adjustGamepadControl(element(select), 1)).toBe(true);
    expect(select.value).toBe("high");
    expect(trackedSetter).not.toHaveBeenCalled();
    expect(changes).toEqual([true]);
    adjustGamepadControl(element(select), 1);
    expect(changes).toHaveLength(1);
    adjustGamepadControl(element(select), -1);
    expect(select.value).toBe("low");
    activateGamepadControl(element(select));
    expect(select.value).toBe("high");
  });
  it("adjusts sliders by their step, respects limits, and bypasses the value tracker", () => {
    const input = new Input();
    const trackedSetter = vi.fn();
    Object.defineProperty(input, "value", { get: () => input.stored, set: trackedSetter });
    const changes = vi.fn();
    input.addEventListener("input", changes);
    adjustGamepadControl(element(input), 1);
    expect(input.value).toBe("0.6");
    for (let i = 0; i < 10; i++) adjustGamepadControl(element(input), -1);
    expect(input.value).toBe("0");
    expect(trackedSetter).not.toHaveBeenCalled();
    expect(changes).toHaveBeenCalledTimes(7);
    expect(activateGamepadControl(element(input))).toBe(true);
    expect(input.value).toBe("0");
  });
  it("toggles checkboxes with A and sets them with left/right", () => {
    const input = new Input();
    input.type = "checkbox";
    activateGamepadControl(element(input));
    expect(input.checked).toBe(true);
    adjustGamepadControl(element(input), 1);
    expect(input.checked).toBe(true);
    adjustGamepadControl(element(input), -1);
    expect(input.checked).toBe(false);
    input.disabled = true;
    expect(activateGamepadControl(element(input))).toBe(false);
    expect(adjustGamepadControl(element(input), 1)).toBe(false);
  });
});
