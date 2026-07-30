#!/usr/bin/env node
// Build the Tauri v2 updater manifest (`latest.json`) out of the artifacts
// gathered by scripts/ci/gather-build-artifacts.sh, and optionally verify that
// every URL it claims actually resolves once the Release is published.
//
// Shape (Tauri v2 "static JSON file" endpoint):
//
//   { version, notes, pub_date, platforms: { "<os>-<arch>": { signature, url } } }
//
// Two things about that shape are easy to get wrong and fatal:
//
//   * `signature` is the CONTENTS of the `.sig` file, not a path to it.
//   * Tauri deserializes and validates EVERY platform entry before it compares
//     versions. One malformed entry breaks updates for every platform, not
//     just its own. So this script emits a platform only when it has both the
//     payload and its signature, and otherwise fails the release outright
//     rather than shipping a half manifest.
//
// There is no `darwin-universal` key. The macOS build is a universal binary,
// so the same `.app.tar.gz` is listed under both darwin-x86_64 and
// darwin-aarch64 — the running app picks the key matching its own arch.
//
// Usage:
//   node scripts/ci/make-updater-manifest.mjs \
//     --artifacts <dir> --tag v0.2.0 --repo owner/repo --out <path/latest.json>
//     [--notes "..."] [--pub-date <RFC3339>]
//
//   node scripts/ci/make-updater-manifest.mjs --verify <path/latest.json>
//
// Exits non-zero with a ::error:: line on any missing or ambiguous input.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

// Which bundle each platform key updates from.
//
// Windows: the NSIS `-setup.exe`, deliberately NOT the `.msi`. Tauri's Windows
// updater only knows how to run an installer it downloaded, and the WiX MSI
// path needs elevation prompts and msiexec argument juggling that the NSIS
// installer's `installMode: "passive"` handles on its own. The MSI stays in the
// Release as a download for people who deploy by policy; it is not an update
// channel.
const PLATFORM_SPECS = [
  {
    label: "macOS (universal)",
    keys: ["darwin-x86_64", "darwin-aarch64"],
    // Produced next to the .app by `bundle.createUpdaterArtifacts: true`.
    matches: (name) => name.endsWith(".app.tar.gz"),
    describe: "*.app.tar.gz from build-macos.yml",
  },
  {
    label: "Windows x64",
    keys: ["windows-x86_64"],
    matches: (name) => name.endsWith("-setup.exe"),
    describe: "*-setup.exe (NSIS) from build-windows.yml",
  },
  {
    label: "Linux x64",
    keys: ["linux-x86_64"],
    // With `createUpdaterArtifacts: true` (not "v1Compatible") the AppImage is
    // itself the update payload; there is no .AppImage.tar.gz wrapper.
    matches: (name) => name.endsWith(".AppImage"),
    describe: "*.AppImage from build-linux.yml",
  },
];

const fail = (message) => {
  console.error(`::error::${message}`);
  process.exit(1);
};

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) fail(`unexpected argument "${token}"`);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
};

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // .app bundles are directories; never descend into one, the updater
    // payload is the sibling tarball.
    if (entry.isDirectory()) {
      if (entry.name.endsWith(".app")) continue;
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
};

// GitHub rewrites release asset names: anything outside [A-Za-z0-9._-] becomes
// a dot, so "Mesozoic Protocol_0.1.0_x64-setup.exe" is served as
// "Mesozoic.Protocol_0.1.0_x64-setup.exe". Getting this wrong yields a
// manifest full of 404s, which is why `--verify` exists.
const assetName = (file) => basename(file).replace(/[^A-Za-z0-9._-]/g, ".");

const generate = (args) => {
  const artifacts = resolve(args.artifacts ?? fail("--artifacts <dir> is required"));
  const tag = args.tag ?? fail("--tag <v0.0.0> is required");
  const repo = args.repo ?? fail("--repo <owner/repo> is required");
  const out = resolve(args.out ?? fail("--out <path/latest.json> is required"));

  const version = tag.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    fail(`tag "${tag}" does not yield a plain X.Y.Z version — Tauri compares with semver`);
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail(`--repo "${repo}" is not <owner>/<repo>`);

  if (!statSync(artifacts, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`--artifacts ${artifacts} is not a directory`);
  }

  const files = walk(artifacts);
  const platforms = {};

  for (const spec of PLATFORM_SPECS) {
    const payloads = files.filter((f) => spec.matches(basename(f)));
    if (payloads.length === 0) {
      fail(
        `no updater payload for ${spec.label}: expected ${spec.describe} under ${artifacts}. ` +
          `Either the build did not run with the updater enabled, or its upload-artifact glob is missing the file.`,
      );
    }
    // Two candidates means two different builds landed in the same gather
    // directory; picking one silently would ship the wrong binary.
    const unique = [...new Set(payloads.map((f) => basename(f)))];
    if (unique.length > 1) {
      fail(`ambiguous updater payload for ${spec.label}: ${unique.join(", ")}`);
    }
    const payload = payloads[0];

    const sig = `${payload}.sig`;
    if (!statSync(sig, { throwIfNoEntry: false })?.isFile()) {
      fail(
        `missing signature for ${spec.label}: expected ${basename(sig)} next to ${basename(payload)}. ` +
          `That file only exists when the build ran with TAURI_SIGNING_PRIVATE_KEY set and bundle.createUpdaterArtifacts on.`,
      );
    }
    const signature = readFileSync(sig, "utf8").trim();
    if (signature.length === 0) fail(`${basename(sig)} is empty`);

    const url = `https://github.com/${repo}/releases/download/${tag}/${assetName(payload)}`;
    for (const key of spec.keys) platforms[key] = { signature, url };

    const sha = createHash("sha256").update(readFileSync(payload)).digest("hex");
    console.log(
      `${spec.label.padEnd(18)} ${spec.keys.join(", ")}\n` +
        `  payload   ${basename(payload)}\n` +
        `  asset     ${assetName(payload)}\n` +
        `  sha256    ${sha}\n` +
        `  signature ${signature.length} chars`,
    );
  }

  const manifest = {
    version,
    notes: args.notes ?? `See https://github.com/${repo}/releases/tag/${tag}`,
    // Tauri parses this as RFC 3339. Milliseconds are legal but pointless here.
    pub_date: args["pub-date"] ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms,
  };

  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nwrote ${out}`);
  return manifest;
};

const verify = async (manifestPath) => {
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  const entries = Object.entries(manifest.platforms ?? {});
  if (entries.length === 0) fail(`${manifestPath} declares no platforms`);

  // Same URL under several keys (the universal macOS tarball) — check once.
  const urls = [...new Set(entries.map(([, p]) => p.url))];
  let broken = 0;
  for (const url of urls) {
    // Release assets are not always readable the instant the Release API call
    // returns, so a first 404 is not yet a verdict.
    let status = 0;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await fetch(url, { method: "HEAD", redirect: "follow" });
      status = res.status;
      if (res.ok) break;
      if (attempt < 5) await new Promise((r) => setTimeout(r, 5000));
    }
    console.log(`${status} ${url}`);
    if (status < 200 || status >= 300) broken += 1;
  }
  if (broken > 0) {
    fail(
      `${broken} of ${urls.length} updater URLs did not resolve. The Release asset names probably differ from what the manifest predicted.`,
    );
  }
  console.log(`all ${urls.length} updater URLs resolve`);
};

const args = parseArgs(process.argv.slice(2));
if (args.verify) {
  await verify(args.verify === true ? fail("--verify needs a path") : args.verify);
} else {
  generate(args);
}
