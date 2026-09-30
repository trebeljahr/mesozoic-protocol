import type { Effect } from "postprocessing";

// Some postprocessing wrappers pass dispose={null}, which R3F assigns over
// the instance method. Recover its implementation for explicit ownership.
export const disposePrimitiveEffect = (effect: Effect): void => {
  Object.getPrototypeOf(effect).dispose.call(effect);
};
