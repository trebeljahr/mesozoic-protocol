#!/usr/bin/env node
/**
 * Single source of truth for the release version.
 *
 * The version has to be stated in five places that can silently drift apart:
 *
 *   package.json                            "version"
 *   src-tauri/tauri.conf.json               "version"          (drives Tauri bundle filenames)
 *   src-tauri/Cargo.toml                    [package] version
 *   src-tauri/Cargo.lock                    the mesozoic-protocol [[package]] entry
 *                                           (out of sync => cargo refuses to build)
 *   ios/App/App.xcodeproj/project.pbxproj   MARKETING_VERSION  (Debug + Release configs)
 *
 * Android's versionName is *derived* from the git tag at build time via the
 * ANDROID_VERSION_NAME env var (android/app/build.gradle), so there is no file
 * to write — but we assert that wiring is still in place so a future refactor
 * can't quietly reintroduce a sixth hardcoded version.
 *
 * Usage:
 *   node scripts/sync-version.mjs 0.2.0     write 0.2.0 everywhere
 *   node scripts/sync-version.mjs --from-tag  take the version from GITHUB_REF_NAME
 *                                             or `git describe --tags --exact-match`
 *   node scripts/sync-version.mjs --check    write nothing; exit 1 on any disagreement
 *
 * Deliberately dependency-free plain string editing: adding a TOML or pbxproj
 * parser to a game repo to rewrite one line each is not worth the supply chain.
 * Every edit is anchored tightly enough to survive unrelated changes to those
 * files (e.g. Xcode adding a resource to the pbxproj).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Apple (MARKETING_VERSION / CFBundleShortVersionString) and Play (versionName)
 *  both reject anything that is not up to three dot-separated integers. We keep
 *  it stricter still — exactly X.Y.Z — so all five files can hold the same literal. */
const SEMVER = /^\d+\.\d+\.\d+$/;

const PACKAGE_JSON = join(ROOT, "package.json");
const TAURI_CONF = join(ROOT, "src-tauri/tauri.conf.json");
const CARGO_TOML = join(ROOT, "src-tauri/Cargo.toml");
const CARGO_LOCK = join(ROOT, "src-tauri/Cargo.lock");
const PBXPROJ = join(ROOT, "ios/App/App.xcodeproj/project.pbxproj");
const BUILD_GRADLE = join(ROOT, "android/app/build.gradle");

const CARGO_PACKAGE_NAME = "mesozoic-protocol";

const rel = (p) => relative(ROOT, p);

function read(path) {
	try {
		return readFileSync(path, "utf8");
	} catch (err) {
		fail(`cannot read ${rel(path)}: ${err.message}`);
	}
}

function fail(message) {
	console.error(`sync-version: ${message}`);
	process.exit(1);
}

/* ------------------------------------------------------------------ targets */

/**
 * A target knows how to read the current version out of a file and how to
 * produce new file contents with a different version. `read` returning null
 * means "the anchor I expect is gone" — always an error, never a silent skip.
 */

/** Top-level `"version": "x"` in a JSON file, formatting preserved. */
function jsonVersionTarget(path, label) {
	const pattern = /^(\s*"version"\s*:\s*")([^"]*)(")/m;
	return {
		path,
		label,
		read: (text) => text.match(pattern)?.[2] ?? null,
		write: (text, version) => text.replace(pattern, `$1${version}$3`),
	};
}

/** `version = "x"` inside Cargo.toml's `[package]` table only. */
const cargoTomlTarget = {
	path: CARGO_TOML,
	label: "Cargo.toml [package] version",
	read: (text) => sliceCargoPackage(text)?.match(/^version\s*=\s*"([^"]*)"/m)?.[1] ?? null,
	write: (text, version) => {
		const section = sliceCargoPackage(text);
		if (section === null) return text;
		const updated = section.replace(/^(version\s*=\s*")[^"]*(")/m, `$1${version}$2`);
		return text.replace(section, updated);
	},
};

/** Body of the `[package]` table: from the header to the next `[` at line start. */
function sliceCargoPackage(text) {
	const start = text.search(/^\[package\]\s*$/m);
	if (start === -1) return null;
	const after = text.slice(start);
	const nextHeader = after.slice(1).search(/^\[/m);
	return nextHeader === -1 ? after : after.slice(0, nextHeader + 1);
}

/**
 * The `[[package]] name = "mesozoic-protocol"` stanza in Cargo.lock. Forgetting
 * this makes every cargo/tauri build fail with "the lock file needs to be
 * updated but --locked was passed", which is the actual CI failure mode.
 */
const cargoLockTarget = {
	path: CARGO_LOCK,
	label: `Cargo.lock (${CARGO_PACKAGE_NAME})`,
	read: (text) => sliceCargoLockEntry(text)?.match(/^version\s*=\s*"([^"]*)"/m)?.[1] ?? null,
	write: (text, version) => {
		const entry = sliceCargoLockEntry(text);
		if (entry === null) return text;
		const updated = entry.replace(/^(version\s*=\s*")[^"]*(")/m, `$1${version}$2`);
		return text.replace(entry, updated);
	},
};

function sliceCargoLockEntry(text) {
	const marker = `name = "${CARGO_PACKAGE_NAME}"\n`;
	const nameAt = text.indexOf(marker);
	if (nameAt === -1) return null;
	const after = text.slice(nameAt);
	const nextEntry = after.indexOf("\n[[package]]");
	return nextEntry === -1 ? after : after.slice(0, nextEntry);
}

/**
 * MARKETING_VERSION appears once per build configuration (Debug + Release).
 * Anchored on the setting name only, so unrelated pbxproj churn (new files,
 * new resources, reshuffled sections) does not affect us.
 */
const pbxprojTarget = {
	path: PBXPROJ,
	label: "project.pbxproj MARKETING_VERSION",
	read: (text) => {
		const found = [...text.matchAll(/MARKETING_VERSION\s*=\s*([^;\s]+)\s*;/g)].map((m) => m[1]);
		if (found.length === 0) return null;
		const distinct = [...new Set(found)];
		// Report internal disagreement (Debug vs Release drift) verbatim so
		// --check surfaces it rather than picking one arbitrarily.
		return distinct.length === 1 ? distinct[0] : distinct.join(" / ");
	},
	write: (text, version) =>
		text.replace(/(MARKETING_VERSION\s*=\s*)[^;\s]+(\s*;)/g, `$1${version}$2`),
};

const TARGETS = [
	jsonVersionTarget(PACKAGE_JSON, "package.json version"),
	jsonVersionTarget(TAURI_CONF, "tauri.conf.json version"),
	cargoTomlTarget,
	cargoLockTarget,
	pbxprojTarget,
];

/* ------------------------------------------------------- android assertion */

/**
 * Android has no version literal to sync: build.gradle reads ANDROID_VERSION_NAME
 * from the environment (the workflow feeds it the git tag). Assert that is still
 * true — if someone hardcodes a versionName, this is the only place that notices.
 */
function checkAndroidDerivation() {
	const text = read(BUILD_GRADLE);
	const line = text.match(/^\s*versionName\s+(.*)$/m)?.[1];
	if (line === undefined) {
		return { ok: false, detail: "no `versionName` line found in android/app/build.gradle" };
	}
	if (!line.includes("ANDROID_VERSION_NAME")) {
		return {
			ok: false,
			detail: `versionName is not derived from the ANDROID_VERSION_NAME env var: ${line.trim()}`,
		};
	}
	return { ok: true, detail: `versionName ← $ANDROID_VERSION_NAME (${line.trim()})` };
}

/* ----------------------------------------------------------------- version */

function versionFromTag() {
	let raw = process.env.GITHUB_REF_NAME?.trim();
	if (!raw && process.env.GITHUB_REF?.startsWith("refs/tags/")) {
		raw = process.env.GITHUB_REF.slice("refs/tags/".length).trim();
	}
	if (!raw) {
		try {
			raw = execFileSync("git", ["describe", "--tags", "--exact-match"], {
				cwd: ROOT,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
		} catch {
			fail(
				"--from-tag: no GITHUB_REF_NAME and HEAD is not tagged " +
					"(git describe --tags --exact-match failed)",
			);
		}
	}
	const version = raw.replace(/^v/, "");
	if (!SEMVER.test(version)) {
		fail(`--from-tag: tag "${raw}" does not yield a plain X.Y.Z version (got "${version}")`);
	}
	return version;
}

function requireSemver(version, origin) {
	if (!SEMVER.test(version)) {
		fail(
			`${origin} must be a plain semver X.Y.Z (Apple's MARKETING_VERSION and ` +
				`Play's versionName reject anything else) — got "${version}"`,
		);
	}
}

/* -------------------------------------------------------------- operations */

function runCheck() {
	const expected = TARGETS[0].read(read(PACKAGE_JSON));
	if (expected === null) fail("could not read the version out of package.json");
	requireSemver(expected, "package.json version");

	const problems = [];
	for (const target of TARGETS) {
		const actual = target.read(read(target.path));
		if (actual === null) {
			problems.push({ target, actual: "<version anchor not found>" });
		} else if (actual !== expected) {
			problems.push({ target, actual });
		}
	}

	const android = checkAndroidDerivation();

	console.log(`expected version (from package.json): ${expected}`);
	for (const target of TARGETS) {
		const bad = problems.find((p) => p.target === target);
		if (bad) {
			console.log(`  ${rel(target.path)} — ${target.label}`);
			console.log(`    - ${bad.actual}`);
			console.log(`    + ${expected}`);
		} else {
			console.log(`  ok  ${rel(target.path)} — ${target.label} = ${expected}`);
		}
	}
	console.log(`  ${android.ok ? "ok  " : ""}${rel(BUILD_GRADLE)} — ${android.detail}`);

	if (problems.length > 0 || !android.ok) {
		console.error(
			`\nsync-version: ${problems.length} file(s) disagree with package.json` +
				`${android.ok ? "" : " (+ android versionName wiring broken)"}.` +
				`\nRun: node scripts/sync-version.mjs ${expected}`,
		);
		process.exit(1);
	}
	console.log("\nAll version declarations agree.");
}

function runWrite(version) {
	requireSemver(version, "version argument");

	const changed = [];
	for (const target of TARGETS) {
		const before = read(target.path);
		const current = target.read(before);
		if (current === null) {
			fail(`${rel(target.path)}: could not locate ${target.label} — refusing to guess`);
		}
		const after = target.write(before, version);
		if (after === before) continue;
		if (target.read(after) !== version) {
			fail(`${rel(target.path)}: rewrite did not take effect (${target.label})`);
		}
		writeFileSync(target.path, after);
		changed.push({ target, from: current });
	}

	const android = checkAndroidDerivation();

	for (const { target, from } of changed) {
		console.log(`updated ${rel(target.path)}: ${from} → ${version} (${target.label})`);
	}
	if (changed.length === 0) {
		console.log(`already at ${version} — nothing to write`);
	}
	if (!android.ok) {
		fail(`android versionName wiring is broken: ${android.detail}`);
	}
	console.log(`android versionName stays derived at build time (${android.detail})`);
}

/* ------------------------------------------------------------------- entry */

const [arg, ...extra] = process.argv.slice(2);

if (!arg || arg === "--help" || arg === "-h") {
	console.log(
		[
			"Usage:",
			"  node scripts/sync-version.mjs <X.Y.Z>   write the version to every file",
			"  node scripts/sync-version.mjs --from-tag  derive it from the current git tag",
			"  node scripts/sync-version.mjs --check     verify agreement, write nothing",
		].join("\n"),
	);
	process.exit(arg ? 0 : 1);
}
if (extra.length > 0) fail(`unexpected extra arguments: ${extra.join(" ")}`);

if (arg === "--check") {
	runCheck();
} else if (arg === "--from-tag") {
	runWrite(versionFromTag());
} else if (arg.startsWith("-")) {
	fail(`unknown flag: ${arg}`);
} else {
	runWrite(arg.replace(/^v/, ""));
}
