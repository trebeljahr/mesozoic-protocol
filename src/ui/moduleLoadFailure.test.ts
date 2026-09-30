import { describe, expect, it } from "vitest";
import { isModuleLoadFailure } from "./moduleLoadFailure";

describe("isModuleLoadFailure", () => {
  it.each([
    "Failed to fetch dynamically imported module: http://127.0.0.1:3286/node_modules/.vite/deps/rapier.es-3NU4D43L.js?v=e03cb584",
    "error loading dynamically imported module: https://example.com/physics.js",
    "Importing a module script failed.",
    "Failed to load module script: Expected a JavaScript module script",
  ])("requires a reload for %s", (message) => {
    expect(isModuleLoadFailure(new TypeError(message))).toBe(true);
  });

  it.each([
    "Failed to fetch",
    "Could not load /models/tree.glb",
    "WebGL context lost",
  ])("preserves subtree retry for %s", (message) => {
    expect(isModuleLoadFailure(new Error(message))).toBe(false);
  });
});
