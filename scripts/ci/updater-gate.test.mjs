import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const publicKey = Buffer.from(
  `untrusted comment: test public key\n${Buffer.alloc(42).toString("base64")}\n`,
).toString("base64");
const endpoint = "https://github.com/owner/game/releases/latest/download/latest.json";

function gate({
  key = "test-only",
  pubkey = publicKey,
  endpoints = [endpoint],
  required = true,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "updater-gate-"));
  try {
    const config = join(dir, "config.json");
    writeFileSync(config, JSON.stringify({ plugins: { updater: { pubkey, endpoints } } }));
    return spawnSync("bash", [new URL("./updater-gate.sh", import.meta.url).pathname], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        UPDATER_CONFIG: config,
        TAURI_SIGNING_PRIVATE_KEY: key,
        REQUIRE_UPDATER: String(required),
        GITHUB_REPOSITORY: "owner/game",
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("release builds cannot silently omit update signatures", () => {
  for (const options of [{ key: "" }, { pubkey: "REPLACE_ME_RUN_TAURI_SIGNER_GENERATE" }]) {
    assert.notEqual(gate(options).status, 0);
    const optional = gate({ ...options, required: false });
    assert.equal(optional.status, 0);
    assert.match(optional.stdout, /enabled=false/);
  }
});

test("valid configuration enables both updater config and compiled feature", () => {
  const result = gate();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /enabled=true/);
  assert.match(result.stdout, /--features updater/);
});

test("auto mode permits setup but requires the secret after public-key activation", () => {
  assert.equal(
    gate({ required: "auto", pubkey: "REPLACE_ME_RUN_TAURI_SIGNER_GENERATE" }).status,
    0,
  );
  assert.notEqual(gate({ required: "auto", key: "" }).status, 0);
});

test("invalid public keys and unsafe or empty endpoints fail", () => {
  for (const options of [
    { pubkey: "garbage" },
    { endpoints: [] },
    { endpoints: ["http://example.com/latest.json"] },
    { endpoints: ["https://github.com/another/game/releases/latest/download/latest.json"] },
  ])
    assert.notEqual(gate(options).status, 0);
});
