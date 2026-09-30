import assert from "node:assert/strict";
import { test } from "node:test";
import { mobileBuildVersion } from "./mobile-build-version.mjs";

const env = {
  GITHUB_RUN_NUMBER: "12",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_REF_TYPE: "branch",
  GITHUB_REF_NAME: "main",
};

test("dispatch keeps the package version and retries increase the store build number", () => {
  assert.deepEqual(mobileBuildVersion("0.1.0", env), { version: "0.1.0", build: 1201 });
  assert.equal(mobileBuildVersion("0.1.0", { ...env, GITHUB_RUN_ATTEMPT: "2" }).build, 1202);
  assert.ok(mobileBuildVersion("0.1.0", { ...env, GITHUB_RUN_NUMBER: "13" }).build > 1299);
});

test("tags must agree with the native marketing version", () => {
  const tag = { ...env, GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.1.0" };
  assert.equal(mobileBuildVersion("0.1.0", tag).version, "0.1.0");
  assert.throws(() => mobileBuildVersion("0.2.0", tag), /tag must match/);
  assert.throws(() => mobileBuildVersion("0.1.0-rc.1", env), /numeric/);
});

test("invalid CI metadata cannot produce colliding or out-of-range build numbers", () => {
  for (const value of [undefined, "0", "-1", "1.5", "NaN"]) {
    assert.throws(() => mobileBuildVersion("0.1.0", { ...env, GITHUB_RUN_NUMBER: value }));
  }
  for (const value of [undefined, "0", "100", "1.5"]) {
    assert.throws(() => mobileBuildVersion("0.1.0", { ...env, GITHUB_RUN_ATTEMPT: value }));
  }
  assert.throws(
    () => mobileBuildVersion("0.1.0", { ...env, GITHUB_RUN_NUMBER: "21000000" }),
    /limit/,
  );
});
