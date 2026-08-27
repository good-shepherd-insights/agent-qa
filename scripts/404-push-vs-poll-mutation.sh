#!/usr/bin/env bash
#
# 404-push-vs-poll-mutation.sh — the acceptance bar for LIFE-04's PUSH claim (404-08, D-16/D-17).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. After 404-05 and 404-07 a page watching
# a chain has TWO channels: a 3-second poll floor that is always there, and a dedicated stream that
# says "read again" whenever this process is the one draining. The floor alone is enough to make
# every chip word CORRECT — which is exactly why a passing suite cannot tell you the push channel
# works. Silence the relay and the chips still reach the right words, a second or three later, and
# nothing in the repository notices. `conformance/post-processing-dom.test.ts` cell (1b) is the one
# cell that would, because it is the one that TIMES the two channels against each other: a `fetch`
# subscriber and a poller running at the client's own published period, started at the same instant,
# racing over one real drain on the shipped binary.
#
# TWO MUTATIONS, BECAUSE THE RELAY IS THREADED IN TWO PLACES AND EITHER HALF CAN ROT ALONE:
#
#   M1  the emitter's SECOND SINK made a no-op — the trail is still written, nobody is told
#   M2  `agent-qa dashboard` composes the relay and hands it to the RUN DOOR but not to
#       `startServer` — the emitter publishes into a registry no route is subscribed to
#
# WINDOWS #264 is the reason M2 exists as its own leg: a composition that wires one half of a
# two-way threading and not the other is a defect this repository has already shipped once, and it
# is invisible to every unit cell on either side of the seam.
#
# EACH MUTATION MUST RED THE CELL NAMED IN ADVANCE, AND ONLY THAT CELL. The DOM file's other seven
# cells are the CONTROL and they are the half people skip: the chips must still reach the right
# words under both mutations, because the poll floor is what makes them correct and the push
# channel is only what makes them fast. A mutation that reddened the whole file would be measuring
# blast radius rather than a property, so every leg carries an ALLOWED list and a GREEN list and a
# red outside either is a FATAL.
#
# EVERY LEG CROSSES A `dist` BOUNDARY AND THE REBUILD IS PART OF THE MUTATION. Both subjects live in
# `packages/cli`, whose `dist/cli.js` IS the binary these cells spawn — and the file's own
# `buildFreshness` guard compares source mtimes against that artifact, so a restored-but-untouched
# source is "newer than" the build and every cell would refuse to run at all. That is a red the leg
# never measured, and it is how 404-04's script first failed.
#
# THIS LEG IS SLOW AND IT IS SLOW FOR A REASON. The DOM file spawns the built `agent-qa dashboard`,
# launches a real Chromium, drives eleven real runs, starts a real `agent-qa daemon` over the same
# project root and kills the dashboard to ask a cold process the same question. Roughly forty-five
# seconds per pass, three passes (preflight plus two legs), plus four CLI rebuilds.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# USAGE
#   bash agent-qa/scripts/404-push-vs-poll-mutation.sh   # from the super-repository root
#   bash scripts/404-push-vs-poll-mutation.sh            # from the agent-qa root
#
# KNOBS
#   PUSH_POLL_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation" — a gate nobody has seen fire is a comment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CLI_FILTER="agent-qa"

EMITTER_SUBJECT="packages/cli/src/curation/post-run-chip-emitter.ts"
COMMAND_SUBJECT="packages/cli/src/commands/dashboard.ts"

SUBJECT_PATHS=("$EMITTER_SUBJECT" "$COMMAND_SUBJECT")

DOM_SUITE="src/__tests__/conformance/post-processing-dom.test.ts"

WORK="$(mktemp -d)"
LOG="$WORK/leg.log"

snapshot_path () { echo "$WORK/$(echo "$1" | tr '/' '_').snapshot"; }

# RESTORING IS A NO-OP WHEN THE BYTES ALREADY MATCH, and that is not tidiness. `cp` bumps an mtime
# whether or not it changes a byte, and the DOM cells' `buildFreshness` guard compares source mtimes
# against `cli/dist/cli.js` — so an unconditional restore in the EXIT trap, which runs AFTER this
# script's last rebuild, leaves every source "newer than" the artifact and the next person to run
# the suite gets eight SKIPPED cells and an exit 1 that reads exactly like a red. Measured.
restore_subjects () {
  local path snapshot
  for path in "${SUBJECT_PATHS[@]}"; do
    snapshot="$(snapshot_path "$path")"
    [ -f "$snapshot" ] || continue
    cmp -s "$snapshot" "$REPO_ROOT/$path" && continue
    cp "$snapshot" "$REPO_ROOT/$path"
  done
}

trap 'restore_subjects; rm -rf "$WORK"' EXIT

declare -a BASELINE_SHAS=()
for path in "${SUBJECT_PATHS[@]}"; do
  cp "$REPO_ROOT/$path" "$(snapshot_path "$path")"
  sha="$(shasum -a 256 "$(snapshot_path "$path")" | cut -d' ' -f1)"
  BASELINE_SHAS+=("$sha")
  echo "subject   $path"
  echo "  sha256  $sha"
done
echo

# ── The named cells. REQUIRED is every cell the mutation exists to red; ALLOWED is everything a red
# is permitted to be; GREEN is the control — cells this mutation must NOT reach, asserted by name so
# the log carries the control rather than only the catch.
#
# Both mutations red the SAME cell and that is the point rather than a shortcut: (1b) is the only
# cell in the repository that can tell a working push channel from a poll floor, so either half of
# the threading rotting has exactly one witness. What differs between the legs is WHY it reds — M1
# leaves the stream open and silent, M2 leaves the door unable to open at all — and each leg's
# failure text names its own diagnosis.
REQUIRED_M1="(1b) PUSH beats POLL on the shipped dashboard"
ALLOWED_M1="(1b) PUSH beats POLL on the shipped dashboard"
GREEN_M1="(1) the D-13 arrival opens AT MOST one stream
(2) no socket: the SAME terminal words arrive
(3) handedOff: a real daemon drains it
(3b) D-21 as narrowed
(4) return visit: exactly ONE read
the RED run paints
CONTROL: a COLD process"

REQUIRED_M2="(1b) PUSH beats POLL on the shipped dashboard"
ALLOWED_M2="(1b) PUSH beats POLL on the shipped dashboard"
GREEN_M2="$GREEN_M1"

apply_mutation () {
  case "${PUSH_POLL_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    M1)
      # The second sink silenced. The append above it is untouched, so the run's own trail is
      # byte-identical and every durable claim in the file still holds — which is exactly the
      # blindness this leg exists to expose.
      perl -0pi -e "s/      options\.relay\?\.\(envelope\)\n/      void options.relay\n/" \
        "$REPO_ROOT/$EMITTER_SUBJECT" ;;
    M2)
      # WINDOWS #264's shape: the relay is composed, the emitter publishes into it, and no route
      # is subscribed because `startServer` was never handed it. The stream door then refuses by
      # name rather than answering an empty channel.
      perl -0pi -e "s/\n      postProcessingRelay,\n/\n/" \
        "$REPO_ROOT/$COMMAND_SUBJECT" ;;
    *) echo "FATAL: unknown mutation $1" >&2; exit 1 ;;
  esac
}

build_cli () {
  set +e
  pnpm --filter "$CLI_FILTER" build > "$WORK/build.log" 2>&1
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: rebuilding $CLI_FILTER failed — see $WORK/build.log" >&2
    restore_subjects
    exit 1
  fi
}

assert_restored () {
  local index=0 path restored
  for path in "${SUBJECT_PATHS[@]}"; do
    restored="$(shasum -a 256 "$REPO_ROOT/$path" | cut -d' ' -f1)"
    if [ "$restored" != "${BASELINE_SHAS[$index]}" ]; then
      echo "FATAL: $path was not restored byte-identically ($restored)" >&2
      exit 1
    fi
    index=$((index + 1))
  done
  echo "  every subject restored byte-identically (sha256 compared)"
}

# run_leg <name> <label> <required> <allowed> <green>
run_leg () {
  local name="$1" label="$2" required="$3" allowed="$4" green="$5"

  echo "=== MUTATION $name — $label"
  restore_subjects
  apply_mutation "$name"
  echo "  rebuilding the CLI so the spawned dashboard IS the mutated source"
  build_cli

  set +e
  pnpm --filter "$CLI_FILTER" exec vitest run "$DOM_SUITE" > "$LOG" 2>&1
  local rc=$?
  set -e
  echo "  leg exited $rc"
  grep -E '^      Tests' "$LOG" || true

  if [ "$rc" -eq 0 ]; then
    echo "FATAL: the suite stayed green under the mutation — mutation $name measures nothing" >&2
    restore_subjects
    build_cli
    exit 1
  fi

  local red
  red="$(grep -oE "^ FAIL  $DOM_SUITE > .*" "$LOG" | sed "s|^ FAIL  $DOM_SUITE > ||" | sort -u)"
  echo "  cells red:"
  local line fragment ok
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    echo "    - $line"
  done <<< "$red"

  while IFS= read -r line; do
    [ -z "$line" ] && continue
    ok=0
    while IFS= read -r fragment; do
      [ -z "$fragment" ] && continue
      case "$line" in *"$fragment"*) ok=1 ;; esac
    done <<< "$allowed"
    if [ "$ok" -eq 0 ]; then
      echo "FATAL: mutation $name red a cell outside its allowed list: $line" >&2
      restore_subjects
      build_cli
      exit 1
    fi
  done <<< "$red"

  while IFS= read -r fragment; do
    [ -z "$fragment" ] && continue
    case "$red" in
      *"$fragment"*) echo "  named cell red: $fragment" ;;
      *)
        echo "FATAL: mutation $name did not red its named cell: $fragment" >&2
        restore_subjects
        build_cli
        exit 1 ;;
    esac
  done <<< "$required"

  while IFS= read -r fragment; do
    [ -z "$fragment" ] && continue
    case "$red" in
      *"$fragment"*)
        echo "FATAL: mutation $name red an expected NON-CATCHER: $fragment" >&2
        restore_subjects
        build_cli
        exit 1 ;;
      *) echo "  expected non-catcher stayed green: $fragment" ;;
    esac
  done <<< "$green"

  restore_subjects
  build_cli
  assert_restored
  echo
}

echo "=== PREFLIGHT — the dist these cells drive, then the pre-mutation suite"
build_cli
set +e
pnpm --filter "$CLI_FILTER" exec vitest run "$DOM_SUITE" > "$LOG" 2>&1
PREFLIGHT_RC=$?
set -e
echo "  $DOM_SUITE exited $PREFLIGHT_RC"
grep -E '^      Tests' "$LOG" || true
if [ "$PREFLIGHT_RC" -ne 0 ]; then
  echo "FATAL: $DOM_SUITE is already red before any mutation" >&2
  sed -n '1,80p' "$LOG" >&2
  exit 1
fi
echo

run_leg M1 "the emitter's second sink made a no-op" "$REQUIRED_M1" "$ALLOWED_M1" "$GREEN_M1"
run_leg M2 "the relay handed to the run door but never to startServer (WINDOWS #264's shape)" \
  "$REQUIRED_M2" "$ALLOWED_M2" "$GREEN_M2"

echo "PASS — silencing the emitter's second sink and withholding the relay from the stream door each"
echo "       red the one cell that times push against poll, while every chip word in the file stays"
echo "       correct on the poll floor alone."
