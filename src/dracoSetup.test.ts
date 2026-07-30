import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Staleness guard for the vendored Draco decoder (public/draco).
//
// A `three` upgrade ships a new decoder build, and a decoder that disagrees
// with the DRACOLoader driving it produces *corrupt geometry*, not a thrown
// error — exploded or collapsed meshes that look like an art bug. There is no
// runtime signal to catch it, so it has to be caught here: byte-compare the
// vendored copy against the installed package and fail the suite on drift.
//
// Fix when this fails:
//   cp node_modules/three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js \
//      node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm \
//      public/draco/
// …then bump the version recorded in public/draco/README.md.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDORED_DIR = join(REPO_ROOT, "public", "draco");
const UPSTREAM_DIR = join(
  REPO_ROOT,
  "node_modules",
  "three",
  "examples",
  "jsm",
  "libs",
  "draco",
  "gltf",
);

// The wasm decoder and its wrapper. `draco_decoder.js` (the pure-JS fallback)
// and `draco_encoder.js` are deliberately not vendored — see the README.
const VENDORED_FILES = ["draco_wasm_wrapper.js", "draco_decoder.wasm"];

const threeVersion = (): string =>
  (
    JSON.parse(readFileSync(join(REPO_ROOT, "node_modules", "three", "package.json"), "utf8")) as {
      version: string;
    }
  ).version;

describe("vendored draco decoder", () => {
  for (const file of VENDORED_FILES) {
    it(`${file} is byte-identical to the installed three build`, () => {
      const vendored = readFileSync(join(VENDORED_DIR, file));
      const upstream = readFileSync(join(UPSTREAM_DIR, file));
      expect(vendored.equals(upstream)).toBe(true);
    });
  }

  it("README records the three version the decoder came from", () => {
    const readme = readFileSync(join(VENDORED_DIR, "README.md"), "utf8");
    expect(readme).toContain(`**${threeVersion()}**`);
  });

  it("does not ship the encoder or the JS-only decoder fallback", () => {
    for (const unwanted of ["draco_encoder.js", "draco_decoder.js"]) {
      expect(() => readFileSync(join(VENDORED_DIR, unwanted))).toThrow();
    }
  });
});
