import assert from "node:assert/strict";
import { test } from "node:test";
import { assertFingerprint, propertyValue } from "./android-signing.mjs";

test("Java properties preserve backslashes, whitespace and Unicode secrets", () => {
  assert.equal(propertyValue("abc=:#$!"), "abc=:#$!");
  assert.equal(propertyValue(" a\\b\n\té"), "\\u0020a\\u005cb\\u000a\\u0009\\u00e9");
  const raw = " leading\\pass\n\tword😀 ";
  const decoded = propertyValue(raw).replace(/\\u([0-9a-f]{4})/g, (_, value) =>
    String.fromCharCode(Number.parseInt(value, 16)),
  );
  assert.equal(decoded, raw);
});

test("artifact signer must match the configured certificate", () => {
  const expected = "abcdef01".repeat(8);
  assert.doesNotThrow(() =>
    assertFingerprint(expected.match(/../g).join(":").toUpperCase(), expected),
  );
  assert.throws(() => assertFingerprint("01234567".repeat(8), expected), /does not match/);
  assert.throws(() => assertFingerprint("", expected), /does not match/);
});
