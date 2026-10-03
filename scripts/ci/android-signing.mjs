import { spawnSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function propertyValue(value) {
  // Properties.load(InputStream) consumes ISO-8859-1 and treats backslashes as
  // escapes. Encode every non-ASCII code unit, whitespace and backslash.
  return value.replace(
    /[\\\s\u0080-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function assertFingerprint(actual, expected) {
  const normalize = (value) => value.replaceAll(":", "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalize(actual)) || normalize(actual) !== normalize(expected)) {
    throw new Error("Artifact signer does not match the configured Android upload certificate.");
  }
}

function command(name, args, encoding = "utf8") {
  const result = spawnSync(name, args, { encoding, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${name} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return result.stdout;
}

export function verifyAndroidArtifacts({ keystore, aab, apk, buildTools, alias }) {
  const cert = command(
    "keytool",
    ["-exportcert", "-keystore", keystore, "-alias", alias, "-storepass:env", "STORE_PASSWORD"],
    null,
  );
  const expected = createHash("sha256").update(cert).digest("hex");
  // Supplying the upload keystore trusts its self-signed leaf. Strict checking
  // still rejects unsigned entries, unexpected aliases and invalid signatures.
  command("jarsigner", [
    "-J-Duser.language=en",
    "-verify",
    "-strict",
    "-keystore",
    keystore,
    "-storepass:env",
    "STORE_PASSWORD",
    aab,
    alias,
  ]);
  const jarCertificates = command("keytool", ["-printcert", "-jarfile", aab, "-rfc"]);
  const jarCertificate = jarCertificates.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/,
  );
  if (!jarCertificate) throw new Error("AAB signing certificate was not found.");
  assertFingerprint(new X509Certificate(jarCertificate[0]).fingerprint256, expected);
  const apkResult = command(resolve(buildTools, "apksigner"), [
    "verify",
    "--verbose",
    "--print-certs",
    apk,
  ]);
  const signers = [
    ...apkResult.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([0-9a-f:]+)$/gim),
  ];
  if (signers.length !== 1) throw new Error("Expected exactly one APK signer.");
  assertFingerprint(signers[0][1], expected);
  console.log(`Verified AAB and APK upload certificate SHA-256: ${expected}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "properties") {
    for (const name of ["STORE_PASSWORD", "KEY_ALIAS", "KEY_PASSWORD"]) {
      if (!process.env[name]) throw new Error(`Missing ${name}.`);
    }
    writeFileSync(
      "android/keystore.properties",
      [
        "storeFile=app/upload.keystore",
        `storePassword=${propertyValue(process.env.STORE_PASSWORD)}`,
        `keyAlias=${propertyValue(process.env.KEY_ALIAS)}`,
        `keyPassword=${propertyValue(process.env.KEY_PASSWORD)}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
  } else if (process.argv[2] === "verify") {
    if (!process.env.KEY_ALIAS || !process.env.STORE_PASSWORD)
      throw new Error("Android signing environment is missing.");
    verifyAndroidArtifacts({
      keystore: "android/app/upload.keystore",
      aab: "android/app/build/outputs/bundle/release/app-release.aab",
      apk: "android/app/build/outputs/apk/release/app-release.apk",
      buildTools: resolve(
        process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT,
        "build-tools/36.0.0",
      ),
      alias: process.env.KEY_ALIAS,
    });
  } else {
    throw new Error("Usage: android-signing.mjs properties|verify");
  }
}
