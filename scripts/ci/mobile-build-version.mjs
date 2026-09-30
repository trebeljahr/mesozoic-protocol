import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function mobileBuildVersion(version, env) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("Mobile releases require a numeric X.Y.Z package version.");
  }
  if (env.GITHUB_REF_TYPE === "tag" && env.GITHUB_REF_NAME !== `v${version}`) {
    throw new Error("Release tag must match the package version.");
  }
  const run = Number(env.GITHUB_RUN_NUMBER);
  const attempt = Number(env.GITHUB_RUN_ATTEMPT);
  if (
    !Number.isSafeInteger(run) ||
    run < 1 ||
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    attempt > 99
  ) {
    throw new Error("Expected a positive run number and a run attempt from 1 to 99.");
  }
  const build = run * 100 + attempt;
  if (build > 2_100_000_000) throw new Error("Android versionCode exceeds the Play limit.");
  return { version, build };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  const result = mobileBuildVersion(version, process.env);
  if (!process.env.GITHUB_ENV) throw new Error("GITHUB_ENV is required.");
  appendFileSync(
    process.env.GITHUB_ENV,
    `ANDROID_VERSION_NAME=${result.version}\nANDROID_VERSION_CODE=${result.build}\nIOS_BUILD_NUMBER=${result.build}\n`,
  );
  console.log(`Mobile version ${result.version}, build ${result.build}`);
}
