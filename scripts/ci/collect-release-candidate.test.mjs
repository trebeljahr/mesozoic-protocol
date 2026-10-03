import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { collectCandidate } from "./collect-release-candidate.mjs";

const payloads = [
  ["macos-bundles", "dmg/Mesozoic Protocol_0.1.0_universal.dmg"],
  ["macos-bundles", "macos/Mesozoic Protocol.app.tar.gz"],
  ["windows-bundles", "msi/Mesozoic Protocol_0.1.0_x64_en-US.msi"],
  ["windows-bundles", "nsis/Mesozoic Protocol_0.1.0_x64-setup.exe"],
  ["linux-bundles", "appimage/mesozoic-protocol_0.1.0_amd64.AppImage"],
  ["linux-bundles", "deb/mesozoic-protocol_0.1.0_amd64.deb"],
  ["android-aab", "app-release.aab"],
  ["android-apk", "app-release.apk"],
  ["ios-ipa", "App.ipa"],
];
const signatures = [1, 3, 4];

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "release-candidate-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifacts = join(root, "artifacts");
  for (const [index, [artifact, name]] of payloads.entries()) {
    const path = join(artifacts, artifact, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, `signed fixture ${index}`);
    if (signatures.includes(index)) await writeFile(`${path}.sig`, "fixture signature\n");
  }
  return {
    artifacts,
    out: join(root, "candidate"),
    commit: "a".repeat(40),
    runId: "123456",
    version: "0.1.0",
  };
}

test("collects all platforms, preserves signed bytes, normalizes names, and hashes the manifest", async (t) => {
  const options = await fixture(t);
  const bundle = join(options.artifacts, "macos-bundles", "macos", "Mesozoic Protocol.app");
  await mkdir(bundle);
  await writeFile(join(bundle, "ignored"), "bundle is preserved in archive");
  const evidence = join(options.artifacts, "windows-signature-evidence");
  await mkdir(evidence);
  await writeFile(join(evidence, "windows-signatures.json"), '{"verified":true}\n');
  const manifest = await collectCandidate(options);
  assert.equal(manifest.files.length, 13);
  assert.equal(manifest.commit, options.commit);
  assert.equal(manifest.runId, "123456");
  assert.equal(manifest.updaterEnabled, true);
  assert.deepEqual(
    new Set(manifest.files.map((file) => file.platform)),
    new Set(["macos", "windows", "linux", "android", "ios"]),
  );
  assert.equal(
    manifest.files.find((file) => file.filename.endsWith(".deb")).signing.kind,
    "provenance",
  );
  assert.equal(
    await readFile(join(options.out, "Mesozoic.Protocol_0.1.0_android.apk"), "utf8"),
    "signed fixture 7",
  );
  assert.equal(
    await readFile(join(options.out, "Mesozoic.Protocol_0.1.0_universal.app.tar.gz.sig"), "utf8"),
    "fixture signature\n",
  );
  const names = await readdir(options.out);
  assert(names.every((name) => /^[A-Za-z0-9._-]+$/.test(name)));
  assert(!names.includes("ignored"));
  const sums = (await readFile(join(options.out, "SHA256SUMS.txt"), "utf8")).trim().split("\n");
  assert.equal(sums.length, 14);
  for (const line of sums) {
    const [hash, name] = line.split("  ");
    assert.equal(
      hash,
      createHash("sha256")
        .update(await readFile(join(options.out, name)))
        .digest("hex"),
    );
  }
});

test("optional updater requires either all signatures or none, while preserving native signing", async (t) => {
  const options = await fixture(t);
  for (const index of signatures) await rm(`${join(options.artifacts, ...payloads[index])}.sig`);
  const manifest = await collectCandidate({ ...options, requireUpdater: false });
  assert.equal(manifest.updaterEnabled, false);
  assert.equal(manifest.files.length, 9);
  assert.equal(
    manifest.files
      .filter((file) => file.platform === "linux")
      .every((file) => file.signing.kind === "provenance"),
    true,
  );
  assert.equal(
    manifest.files.find((file) => file.filename.endsWith("-setup.exe")).signing.kind,
    "authenticode",
  );
  assert.equal(
    manifest.files.find((file) => file.filename.endsWith(".app.tar.gz")).signing.kind,
    "developer-id-notarized",
  );
  assert(!manifest.files.some((file) => file.signing.updaterSignature));
});

test("optional updater still rejects partial and empty signatures and requires the app archive", async (t) => {
  await t.test("partial signatures", async (subtest) => {
    const options = await fixture(subtest);
    await rm(`${join(options.artifacts, ...payloads[1])}.sig`);
    await assert.rejects(
      collectCandidate({ ...options, requireUpdater: false }),
      /Partial updater signatures/,
    );
  });
  await t.test("empty signature", async (subtest) => {
    const options = await fixture(subtest);
    await writeFile(`${join(options.artifacts, ...payloads[1])}.sig`, "\n");
    await assert.rejects(
      collectCandidate({ ...options, requireUpdater: false }),
      /Empty updater signature/,
    );
  });
  await t.test("missing app archive", async (subtest) => {
    const options = await fixture(subtest);
    for (const index of signatures) await rm(`${join(options.artifacts, ...payloads[index])}.sig`);
    await rm(join(options.artifacts, ...payloads[1]));
    await assert.rejects(
      collectCandidate({ ...options, requireUpdater: false }),
      /requires exactly one \*\.app.tar.gz/,
    );
  });
  await t.test("enabled signatures retained", async (subtest) => {
    const options = await fixture(subtest);
    const manifest = await collectCandidate({ ...options, requireUpdater: false });
    assert.equal(manifest.updaterEnabled, true);
    assert.equal(manifest.files.filter((file) => file.filename.endsWith(".sig")).length, 3);
  });
  await t.test("invalid option", async (subtest) => {
    const options = await fixture(subtest);
    await assert.rejects(
      collectCandidate({ ...options, requireUpdater: "yes" }),
      /must be true or false/,
    );
  });
});

test("every platform payload and its updater signature is required", async (t) => {
  for (const [index, [artifact, name]] of payloads.entries()) {
    await t.test(name, async (subtest) => {
      const options = await fixture(subtest);
      await rm(join(options.artifacts, artifact, name));
      await assert.rejects(collectCandidate(options), /requires exactly one/);
    });
    if (signatures.includes(index)) {
      await t.test(`${name} signature`, async (subtest) => {
        const options = await fixture(subtest);
        await rm(join(options.artifacts, artifact, `${name}.sig`));
        await assert.rejects(collectCandidate(options), /Missing adjacent updater signature/);
      });
    }
  }
});

test("rejects duplicate payloads even when their basenames and bytes match", async (t) => {
  const options = await fixture(t);
  const path = join(options.artifacts, "macos-bundles", "duplicate");
  await mkdir(path);
  await writeFile(join(path, "Mesozoic Protocol_0.1.0_universal.dmg"), "signed fixture 0");
  await assert.rejects(collectCandidate(options), /requires exactly one \*\.dmg; found 2/);
});

test("rejects wrong versions, unsigned/debug names, and unexpected payload families", async (t) => {
  for (const name of [
    "Mesozoic Protocol_0.2.0_universal.dmg",
    "Mesozoic Protocol_0.1.0_unsigned.dmg",
    "Mesozoic Protocol_0.1.0_debug.dmg",
  ]) {
    await t.test(name, async (subtest) => {
      const options = await fixture(subtest);
      await rename(
        join(options.artifacts, ...payloads[0]),
        join(options.artifacts, "macos-bundles", name),
      );
      await assert.rejects(collectCandidate(options), /version must be|unsigned\/debug/);
    });
  }
  const options = await fixture(t);
  await writeFile(join(options.artifacts, "android-aab", "another.apk"), "unexpected");
  await assert.rejects(collectCandidate(options), /Unexpected or mixed payload/);
});

test("rejects empty signatures, empty installers, symlinks, and normalized filename collisions", async (t) => {
  await t.test("empty signature", async (subtest) => {
    const options = await fixture(subtest);
    await writeFile(`${join(options.artifacts, ...payloads[1])}.sig`, " \n");
    await assert.rejects(collectCandidate(options), /Empty updater signature/);
  });
  await t.test("empty installer", async (subtest) => {
    const options = await fixture(subtest);
    await writeFile(join(options.artifacts, ...payloads[0]), "");
    await assert.rejects(collectCandidate(options), /Empty candidate input/);
  });
  await t.test("symlink", async (subtest) => {
    const options = await fixture(subtest);
    await symlink(
      join(options.artifacts, ...payloads[0]),
      join(options.artifacts, "macos-bundles", "link.dmg"),
    );
    await assert.rejects(collectCandidate(options), /Symbolic links/);
  });
  await t.test("collision", async (subtest) => {
    const options = await fixture(subtest);
    const evidence = join(options.artifacts, "windows-signature-evidence");
    await mkdir(evidence);
    await writeFile(join(evidence, "signature evidence.json"), "{}");
    await writeFile(join(evidence, "signature.evidence.json"), "{}");
    await assert.rejects(collectCandidate(options), /filename collision/);
  });
});

test("rejects invalid provenance and never mixes with an existing candidate", async (t) => {
  const options = await fixture(t);
  for (const override of [{ commit: "abc" }, { runId: "1;whoami" }, { version: "0.1.0-beta.1" }]) {
    await assert.rejects(collectCandidate({ ...options, ...override }));
  }
  await assert.rejects(
    collectCandidate({ ...options, out: join(options.artifacts, "candidate") }),
    /must not overlap/,
  );
  await mkdir(options.out);
  await writeFile(join(options.out, "old-build.exe"), "old");
  await assert.rejects(collectCandidate(options), /must be absent or an empty/);
  assert.equal(await readFile(join(options.out, "old-build.exe"), "utf8"), "old");
});
