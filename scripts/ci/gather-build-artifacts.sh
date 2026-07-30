#!/usr/bin/env bash
# Wait for the desktop platform build workflows to finish for a given commit,
# then download every artifact they produced into one directory.
#
# The platform builds are triggered independently by the same `v*` tag push, so
# by the time this runs they may be queued, in progress, or finished. We wait
# rather than race, and we fail loudly if any of them did not succeed — a
# release that silently ships Windows because macOS died is worse than no
# release at all.
#
# Environment:
#   GH_TOKEN       required — token with `actions: read` on this repo
#   EXPECTED_SHA   required — commit the build runs must belong to
#   WORKFLOWS      required — space-separated workflow filenames to wait for
#   OUT_DIR        required — directory to download artifacts into
#   TIMEOUT_MIN    optional — minutes to wait before giving up (default 90)
#   POLL_SECONDS   optional — seconds between polls (default 30)
#
# Exit codes: 0 all good, 1 something failed / timed out.

set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN must be set}"
: "${EXPECTED_SHA:?EXPECTED_SHA must be set}"
: "${WORKFLOWS:?WORKFLOWS must be set}"
: "${OUT_DIR:?OUT_DIR must be set}"
TIMEOUT_MIN="${TIMEOUT_MIN:-90}"
POLL_SECONDS="${POLL_SECONDS:-30}"

deadline=$(( $(date +%s) + TIMEOUT_MIN * 60 ))

# Latest run id for a workflow file at EXPECTED_SHA, or empty if it has not
# been created yet. `gh run list` returns newest first, so head -1 wins.
run_id_for() {
  gh run list \
    --workflow "$1" \
    --commit "$EXPECTED_SHA" \
    --limit 20 \
    --json databaseId,status,conclusion \
    --jq '.[0].databaseId // empty'
}

run_field() {
  gh run view "$1" --json status,conclusion --jq ".$2 // \"\""
}

declare -A RUN_IDS=()
failed=()

while :; do
  pending=()
  failed=()

  for wf in $WORKFLOWS; do
    id="${RUN_IDS[$wf]:-}"
    if [ -z "$id" ]; then
      id="$(run_id_for "$wf")"
      if [ -z "$id" ]; then
        pending+=("$wf (no run yet)")
        continue
      fi
      RUN_IDS[$wf]="$id"
      echo "found run for $wf: $id"
    fi

    status="$(run_field "$id" status)"
    if [ "$status" != "completed" ]; then
      pending+=("$wf ($status)")
      continue
    fi

    conclusion="$(run_field "$id" conclusion)"
    if [ "$conclusion" != "success" ]; then
      failed+=("$wf (run $id concluded: $conclusion)")
    fi
  done

  if [ ${#pending[@]} -eq 0 ]; then
    break
  fi

  now=$(date +%s)
  if [ "$now" -ge "$deadline" ]; then
    echo "::error::Timed out after ${TIMEOUT_MIN}m waiting for: ${pending[*]}"
    exit 1
  fi

  echo "waiting on: ${pending[*]} (retrying in ${POLL_SECONDS}s)"
  sleep "$POLL_SECONDS"
done

if [ ${#failed[@]} -gt 0 ]; then
  for entry in "${failed[@]}"; do
    echo "::error::Platform build did not succeed — $entry"
  done
  echo "::error::Refusing to publish a partial release. Fix the failing build(s) and re-run this workflow."
  exit 1
fi

mkdir -p "$OUT_DIR"
for wf in $WORKFLOWS; do
  id="${RUN_IDS[$wf]}"
  echo "downloading artifacts from $wf (run $id)"
  gh run download "$id" --dir "$OUT_DIR"
done

echo "--- gathered into $OUT_DIR ---"
find "$OUT_DIR" -type f | sort
