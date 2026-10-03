#!/usr/bin/env node
// Assemble verified platform workflow outputs into a complete, reviewable candidate.
// This checks collection integrity; native signing verification remains in each build job.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const specs = [
  { artifact: "macos-bundles", platform: "macos", suffix: ".dmg", kind: "developer-id-notarized" },
  {
    artifact: "macos-bundles",
    platform: "macos",
    suffix: ".app.tar.gz",
    kind: "developer-id-notarized",
    signature: true,
  },
  { artifact: "windows-bundles", platform: "windows", suffix: ".msi", kind: "authenticode" },
  {
    artifact: "windows-bundles",
    platform: "windows",
    suffix: "-setup.exe",
    kind: "authenticode",
    signature: true,
  },
  {
    artifact: "linux-bundles",
    platform: "linux",
    suffix: ".AppImage",
    kind: "tauri-updater",
    signature: true,
  },
  { artifact: "linux-bundles", platform: "linux", suffix: ".deb", kind: "provenance" },
  {
    artifact: "android-aab",
    platform: "android",
    suffix: ".aab",
    kind: "android-upload-key",
    mobile: true,
  },
  {
    artifact: "android-apk",
    platform: "android",
    suffix: ".apk",
    kind: "android-upload-key",
    mobile: true,
  },
  {
    artifact: "ios-ipa",
    platform: "ios",
    suffix: ".ipa",
    kind: "apple-distribution",
    mobile: true,
  },
];
const payloadPattern = /\.(?:dmg|app\.tar\.gz|msi|exe|AppImage|deb|aab|apk|ipa)(?:\.sig)?$/i;
const unsafeBuildName = /(?:^|[._ -])(?:unsigned|debug)(?:[._ -]|$)/i;
const safeName = (name) => name.replace(/[^A-Za-z0-9._-]/g, ".");
const within = (parent, child) => {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
};

async function walk(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(`Not a real artifact directory: ${directory}`);
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not candidate inputs: ${path}`);
    if (entry.isDirectory()) {
      // The signed updater archive preserves bundle structure and executable modes.
      if (!entry.name.endsWith(".app")) files.push(...(await walk(path)));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      throw new Error(`Unsupported artifact entry: ${path}`);
    }
  }
  return files.sort();
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function destinationName(spec, file, version) {
  const name = basename(file);
  if (unsafeBuildName.test(name)) throw new Error(`Refusing unsigned/debug payload: ${name}`);
  if (spec.mobile) return `Mesozoic.Protocol_${version}_${spec.platform}${spec.suffix}`;
  if (
    spec.suffix === ".app.tar.gz" &&
    ["Mesozoic Protocol.app.tar.gz", "Mesozoic.Protocol.app.tar.gz"].includes(name)
  ) {
    // Tauri omits the version here. The paired DMG supplies the filename check;
    // the native build verifies the app version before archiving this payload.
    return `Mesozoic.Protocol_${version}_universal.app.tar.gz`;
  }
  const versions = [...name.matchAll(/\d+\.\d+\.\d+/g)].map((match) => match[0]);
  if (versions.length !== 1 || versions[0] !== version || !name.includes(`_${version}_`)) {
    throw new Error(`Desktop payload version must be ${version}: ${name}`);
  }
  return safeName(name);
}

export async function collectCandidate({
  artifacts,
  out,
  commit,
  runId,
  version,
  requireUpdater = true,
}) {
  if (typeof requireUpdater !== "boolean")
    throw new Error("--require-updater must be true or false");
  if (!/^[a-f0-9]{40}$/i.test(commit ?? ""))
    throw new Error("--commit must be a full 40-character Git SHA");
  if (!/^[1-9]\d*$/.test(runId ?? "")) throw new Error("--run-id must be a positive integer");
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version ?? ""))
    throw new Error("--version must be a numeric X.Y.Z version");
  if (!artifacts || !out) throw new Error("--artifacts and --out directories are required");
  const source = resolve(artifacts);
  const target = resolve(out);
  if (within(source, target) || within(target, source))
    throw new Error("Input and output directories must not overlap");
  const targetInfo = await lstat(target).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (
    targetInfo &&
    (!targetInfo.isDirectory() || targetInfo.isSymbolicLink() || (await readdir(target)).length)
  ) {
    throw new Error("Output directory must be absent or an empty real directory");
  }

  const byArtifact = new Map();
  for (const artifact of new Set(specs.map((spec) => spec.artifact))) {
    byArtifact.set(artifact, await walk(join(source, artifact)));
  }
  const pending = [];
  const selected = new Set();
  const names = new Set(["candidate.json", "SHA256SUMS.txt"]);
  const add = async (file, filename, platform, signing, artifact) => {
    if (names.has(filename)) throw new Error(`Candidate filename collision: ${filename}`);
    names.add(filename);
    const size = (await lstat(file)).size;
    if (!size) throw new Error(`Empty candidate input: ${file}`);
    selected.add(file);
    pending.push({ file, filename, platform, signing, artifact, size, sha256: await sha256(file) });
  };

  let updaterSignatures = 0;
  for (const spec of specs) {
    const matches = byArtifact
      .get(spec.artifact)
      .filter((file) => basename(file).endsWith(spec.suffix));
    if (matches.length !== 1)
      throw new Error(
        `${spec.artifact} requires exactly one *${spec.suffix}; found ${matches.length}`,
      );
    const file = matches[0];
    const filename = destinationName(spec, file, version);
    const signature = `${file}.sig`;
    const hasSignature = spec.signature && byArtifact.get(spec.artifact).includes(signature);
    const kind = spec.kind === "tauri-updater" && !hasSignature ? "provenance" : spec.kind;
    const signing = {
      kind,
      verification: kind === "provenance" ? "candidate-workflow-attestation" : "platform-workflow",
    };
    if (spec.signature && !hasSignature && requireUpdater)
      throw new Error(`Missing adjacent updater signature: ${signature}`);
    if (hasSignature) {
      if (!(await readFile(signature, "utf8")).trim())
        throw new Error(`Empty updater signature: ${signature}`);
      updaterSignatures += 1;
      signing.updaterSignature = `${filename}.sig`;
      await add(
        signature,
        `${filename}.sig`,
        spec.platform,
        { kind: "tauri-updater-signature", verification: "platform-workflow" },
        spec.artifact,
      );
    }
    await add(file, filename, spec.platform, signing, spec.artifact);
  }
  if (
    updaterSignatures !== 0 &&
    updaterSignatures !== specs.filter((spec) => spec.signature).length
  )
    throw new Error(
      "Partial updater signatures: all three platforms must have signatures or none may have them",
    );
  for (const [artifact, files] of byArtifact) {
    for (const file of files) {
      if (!selected.has(file) && payloadPattern.test(file))
        throw new Error(`Unexpected or mixed payload in ${artifact}: ${basename(file)}`);
    }
  }
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!entry.name.endsWith("signature-evidence")) continue;
    const platform = entry.name.replace(/-signature-evidence$/, "");
    for (const file of await walk(join(source, entry.name))) {
      if (!file.endsWith(".json")) continue;
      JSON.parse(await readFile(file, "utf8"));
      await add(
        file,
        safeName(basename(file)),
        platform,
        { kind: "verification-evidence", verification: "platform-workflow" },
        entry.name,
      );
    }
  }

  pending.sort((a, b) => a.filename.localeCompare(b.filename, "en"));
  const manifest = {
    schemaVersion: 1,
    commit: commit.toLowerCase(),
    runId,
    version,
    updaterEnabled: updaterSignatures > 0,
    files: pending.map(({ file: _file, ...metadata }) => metadata),
  };
  await mkdir(target, { recursive: true });
  for (const item of pending) await copyFile(item.file, join(target, item.filename));
  await writeFile(join(target, "candidate.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const checksums = pending.map(({ sha256: hash, filename }) => `${hash}  ${filename}`);
  checksums.push(`${await sha256(join(target, "candidate.json"))}  candidate.json`);
  await writeFile(join(target, "SHA256SUMS.txt"), `${checksums.sort().join("\n")}\n`);
  return manifest;
}

function parseArgs(argv) {
  const options = {};
  const keys = {
    "--artifacts": "artifacts",
    "--out": "out",
    "--commit": "commit",
    "--run-id": "runId",
    "--version": "version",
    "--require-updater": "requireUpdater",
  };
  for (let index = 0; index < argv.length; index += 2) {
    const key = keys[argv[index]];
    const value = argv[index + 1];
    if (!key || !value || value.startsWith("--") || Object.hasOwn(options, key))
      throw new Error(`Invalid or duplicate argument: ${argv[index]}`);
    if (key === "requireUpdater") {
      if (!["true", "false"].includes(value))
        throw new Error("--require-updater must be true or false");
      options[key] = value === "true";
    } else options[key] = value;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const candidate = await collectCandidate(parseArgs(process.argv.slice(2)));
    console.log(
      `Collected ${candidate.files.length} files for ${candidate.version} at ${candidate.commit}`,
    );
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
