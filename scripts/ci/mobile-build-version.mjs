import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MOBILE_BUILD_EPOCH = Date.UTC(2020, 0, 1);

export function mobileBuildVersion(version, env, now = Date.now()) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("Mobile releases require a numeric X.Y.Z package version.");
  }
  if (env.GITHUB_REF_TYPE === "tag" && env.GITHUB_REF_NAME !== `v${version}`) {
    throw new Error("Release tag must match the package version.");
  }
  // Workflow run numbers belong to the caller, so reusable workflows cannot
  // use them as store versions. Each platform serializes all builds and holds
  // its concurrency slot until this UTC minute ends, including failed retries.
  const build = Math.floor((now - MOBILE_BUILD_EPOCH) / 60_000);
  if (!Number.isSafeInteger(build) || build < 10_000) {
    throw new Error("Expected a valid build time after the mobile version epoch.");
  }
  if (build > 2_100_000_000) throw new Error("Android versionCode exceeds the Play limit.");
  const major = Math.floor(build / 10_000);
  if (major > 9999) throw new Error("iOS build number exceeds the 4.2.2 digit limit.");
  const iosBuildNumber = `${major}.${Math.floor(build / 100) % 100}.${build % 100}`;
  return { version, build, iosBuildNumber };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--finish-build-slot")) {
    const until = Number(process.env.MOBILE_BUILD_SLOT_END);
    const wait = until - Date.now();
    if (Number.isFinite(wait) && wait > 0 && wait <= 60_000) {
      await new Promise((done) => setTimeout(done, wait));
    }
    process.exit(0);
  }
  const { version } = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  const result = mobileBuildVersion(version, process.env);
  if (!process.env.GITHUB_ENV) throw new Error("GITHUB_ENV is required.");
  appendFileSync(
    process.env.GITHUB_ENV,
    `ANDROID_VERSION_NAME=${result.version}\nANDROID_VERSION_CODE=${result.build}\nIOS_BUILD_NUMBER=${result.iosBuildNumber}\nMOBILE_BUILD_SLOT_END=${MOBILE_BUILD_EPOCH + (result.build + 1) * 60_000}\n`,
  );
  console.log(
    `Mobile version ${result.version}, Android build ${result.build}, iOS build ${result.iosBuildNumber}`,
  );
}
