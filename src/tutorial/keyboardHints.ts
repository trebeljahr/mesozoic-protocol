import { type KeyBindings, keyLabel } from "../input/keyBindings";

export const tutorialKeyboardHints = (bindings: KeyBindings) => ({
  robot: keyLabel(bindings.robot),
  abilities: [bindings.ability1, bindings.ability2, bindings.ability3, bindings.ability4]
    .map(keyLabel)
    .join(" / "),
});
