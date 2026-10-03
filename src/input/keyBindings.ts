import { create } from "zustand";
import type { TowerKind } from "../sim/types";

export const DEFAULT_BINDINGS = {
  wave: "Space",
  menu: "KeyP",
  clear: "KeyX",
  robot: "Digit1",
  ability1: "KeyQ",
  ability2: "KeyW",
  ability3: "KeyE",
  ability4: "KeyR",
  pulse: "Digit2",
  chain: "Digit3",
  flame: "Digit4",
  hive: "Digit5",
  mortar: "Digit6",
  cryo: "Digit7",
} as const;
export type BindingAction = keyof typeof DEFAULT_BINDINGS;
export type KeyBindings = Record<BindingAction, string>;
export const BINDING_ACTIONS = Object.keys(DEFAULT_BINDINGS) as BindingAction[];
export const BINDINGS_KEY = "mesozoic-protocol:keys:v1";
const KEY_CHOICES = [
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
  "Space",
];
export const isBindingCode = (code: string) => KEY_CHOICES.includes(code);
export const keyLabel = (code: string) => code.replace(/^(Key|Digit)/, "");

// Repair damaged settings without creating duplicate shortcuts. Escape and
// Tab remain reserved so menus and keyboard navigation are always reachable.
export const normalizeBindings = (raw: unknown): KeyBindings => {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const result: Partial<KeyBindings> = {};
  const used = new Set<string>();
  for (const action of BINDING_ACTIONS) {
    const code = source[action];
    if (typeof code === "string" && isBindingCode(code) && !used.has(code)) {
      result[action] = code;
      used.add(code);
    }
  }
  for (const action of BINDING_ACTIONS) {
    if (result[action]) continue;
    const code = !used.has(DEFAULT_BINDINGS[action])
      ? DEFAULT_BINDINGS[action]
      : KEY_CHOICES.find((candidate) => !used.has(candidate))!;
    result[action] = code;
    used.add(code);
  }
  return result as KeyBindings;
};
const loadBindings = () => {
  try {
    return normalizeBindings(JSON.parse(localStorage.getItem(BINDINGS_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
};
export const useKeyBindings = create<{
  bindings: KeyBindings;
  storageFailed: boolean;
  bind: (action: BindingAction, code: string) => "invalid" | "conflict" | null;
  reset: () => void;
}>((set, get) => {
  const save = (bindings: KeyBindings) => {
    let storageFailed = false;
    try {
      localStorage.setItem(BINDINGS_KEY, JSON.stringify(bindings));
    } catch {
      storageFailed = true;
    }
    set({ bindings, storageFailed });
  };
  return {
    bindings: loadBindings(),
    storageFailed: false,
    bind: (action, code) => {
      if (!isBindingCode(code)) return "invalid";
      if (BINDING_ACTIONS.some((other) => other !== action && get().bindings[other] === code))
        return "conflict";
      save({ ...get().bindings, [action]: code });
      return null;
    },
    reset: () => save({ ...DEFAULT_BINDINGS }),
  };
});

export const bindingForTower = (kind: TowerKind): BindingAction => kind;
export const actionForKey = (
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "metaKey" | "repeat">,
  bindings: KeyBindings,
): BindingAction | undefined => {
  if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;
  return BINDING_ACTIONS.find((action) => bindings[action] === event.code);
};
