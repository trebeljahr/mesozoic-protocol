import assert from "node:assert/strict";
import { test } from "node:test";
import { MOBILE_BUILD_EPOCH, mobileBuildVersion } from "./mobile-build-version.mjs";

const env = { GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "main" };
const now = Date.UTC(2026, 9, 4, 12, 30);

test("build numbers survive reusable workflow caller and retry counter changes", () => {
  const first = mobileBuildVersion("0.1.0", { ...env, GITHUB_RUN_NUMBER: "900" }, now);
  const retry = mobileBuildVersion("0.1.0", { ...env, GITHUB_RUN_NUMBER: "1" }, now + 60_000);
  assert.equal(retry.build, first.build + 1);
  assert.ok(first.build > 401);
  assert.ok(Number(first.iosBuildNumber.split(".")[0]) > 302);
  assert.equal(
    first.iosBuildNumber,
    `${Math.floor(first.build / 10000)}.${Math.floor(first.build / 100) % 100}.${first.build % 100}`,
  );
});

test("timestamps use minute slots, independent of workflow metadata", () => {
  assert.deepEqual(
    mobileBuildVersion("0.1.0", env, now),
    mobileBuildVersion("0.1.0", {}, now + 59_999),
  );
  assert.equal(
    mobileBuildVersion("0.1.0", env, now + 60_000).build,
    mobileBuildVersion("0.1.0", env, now).build + 1,
  );
});

test("tags must agree with the native marketing version", () => {
  const tag = { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.1.0" };
  assert.equal(mobileBuildVersion("0.1.0", tag, now).version, "0.1.0");
  assert.throws(() => mobileBuildVersion("0.2.0", tag, now), /tag must match/);
  assert.throws(() => mobileBuildVersion("0.1.0-rc.1", env, now), /numeric/);
});

test("invalid timestamps and store limits fail before native compilation", () => {
  for (const invalid of [NaN, Infinity, MOBILE_BUILD_EPOCH - 1, MOBILE_BUILD_EPOCH]) {
    assert.throws(() => mobileBuildVersion("0.1.0", env, invalid), /valid build time/);
  }
  assert.equal(
    mobileBuildVersion("0.1.0", env, MOBILE_BUILD_EPOCH + 99_999_999 * 60_000).iosBuildNumber,
    "9999.99.99",
  );
  assert.throws(
    () => mobileBuildVersion("0.1.0", env, MOBILE_BUILD_EPOCH + 100_000_000 * 60_000),
    /iOS/,
  );
  assert.throws(
    () => mobileBuildVersion("0.1.0", env, MOBILE_BUILD_EPOCH + 2_100_000_001 * 60_000),
    /Android/,
  );
});
