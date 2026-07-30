#!/usr/bin/env bash
# Decide whether this run should build/publish the Tauri auto-updater, and
# print the `tauri build` flags that turn it on.
#
# The updater cannot live in src-tauri/tauri.conf.json directly: with
# `bundle.createUpdaterArtifacts: true` in the base config, `tauri build` fails
# outright when TAURI_SIGNING_PRIVATE_KEY is unset. That would turn every
# current CI run red, months before the keypair exists. So the updater config
# sits in a separate overlay file that CI merges in with `--config` (RFC 7396
# merge patch — it only adds `bundle.createUpdaterArtifacts` and
# `plugins.updater`, everything else in the base config is preserved) and the
# Rust plugin sits behind a Cargo feature. Both are switched on together, here,
# so the compiled code and the config can never disagree.
#
# Same soft-skip idiom as the Steam gate in steam.yml and the itch job in
# release.yml: print a ::notice:: and carry on, never fail the run.
#
# Environment:
#   TAURI_SIGNING_PRIVATE_KEY  the minisign private key; absent → disabled
#   GITHUB_REPOSITORY          optional — <owner>/<repo>, used to sanity-check
#                              a github.com endpoint against the repo actually
#                              publishing the releases
#   UPDATER_CONFIG             optional — path to the overlay (default below)
#   GITHUB_OUTPUT              optional — step outputs are appended here
#
# Outputs (also echoed to stdout so this is testable outside Actions):
#   enabled=true|false
#   args=<flags to append to `pnpm tauri build`, empty when disabled>

set -euo pipefail

CONFIG="${UPDATER_CONFIG:-src-tauri/tauri.updater.conf.json}"
# Must match the `pubkey` shipped in the overlay file. Kept as a literal rather
# than parsed out of the file so that emptying the pubkey does not read as
# "activated".
PLACEHOLDER_PUBKEY='REPLACE_ME_RUN_TAURI_SIGNER_GENERATE'

emit() {
  printf 'enabled=%s\n' "$1"
  printf 'args=%s\n' "$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
      printf 'enabled=%s\n' "$1"
      printf 'args=%s\n' "$2"
    } >> "$GITHUB_OUTPUT"
  fi
}

disabled() {
  echo "::notice::Auto-updater not built — $1 See DISTRIBUTION.md → \"Auto-update\" for the one-time activation."
  emit false ""
  exit 0
}

[ -f "$CONFIG" ] || disabled "$CONFIG is missing."

if grep -q "$PLACEHOLDER_PUBKEY" "$CONFIG"; then
  disabled "$CONFIG still carries the placeholder pubkey."
fi

if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  disabled "the TAURI_SIGNING_PRIVATE_KEY secret is not set."
fi

# A pubkey without an endpoint produces installers that can never be updated,
# and the mistake is invisible until someone in the wild never gets an update.
if ! grep -q '"endpoints"' "$CONFIG"; then
  echo "::error::$CONFIG sets a pubkey but declares no plugins.updater.endpoints."
  exit 1
fi

# Only meaningful for GitHub-hosted manifests; a self-hosted endpoint is
# deliberately left alone.
if [ -n "${GITHUB_REPOSITORY:-}" ] && grep -q 'https://github.com/' "$CONFIG"; then
  if ! grep -q "https://github.com/${GITHUB_REPOSITORY}/" "$CONFIG"; then
    echo "::error::$CONFIG points its update endpoint at a different GitHub repository than ${GITHUB_REPOSITORY}, which is the repo publishing these releases. Fix plugins.updater.endpoints."
    exit 1
  fi
fi

echo "Auto-updater enabled — building with $CONFIG and the \`updater\` cargo feature."
emit true "--config $CONFIG --features updater"
