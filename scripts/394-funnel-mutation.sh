#!/usr/bin/env bash
#
# 394-funnel-mutation.sh — the acceptance-failure flag's acceptance bar (WTST-05 · D-13/D-15).
#
# WHAT THIS PROVES, and why the green suite alone does not prove it. `funnel.test.ts` passing says
# the funnel agrees with a table of numbers. It does NOT say the flag can actually FIRE, which is
# the one thing WTST-05 asks for — a report nobody proved can fire is the vacuous-cell failure
# mode this project keeps re-learning. A detector's acceptance bar is the implementation it must
# go RED on, never the suite it passes. This script is that bar: it edits
# `packages/schema/src/authoring/funnel.ts` into four implementations D-13 forbids and requires
# named cells to red on each.
#
#   E  the flag branch deleted           — the rate is computed and the flag is never raised.
#   F  the ceiling comparison relaxed    — greater-or-equal, so a rate exactly at the pin flags.
#   G  the flag read off the ROUNDED %   — the display value decides, so 90.4% stops flagging.
#   H  the wording table framed          — a success framing enters the ONE rendered line.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS. So is a red that names
# a cell outside the allowed list: a differential that reds on collateral has not shown the corpus
# catches what it forbids, only that the corpus is fragile.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE. Every measured command writes to a
# log FILE and its status is captured with `set +e` / `rc=$?` / `set -e`. A `| grep` reports the
# PIPE's status and swallows a red.
#
# THE SUBJECT IS RESTORED FROM A BYTE SNAPSHOT AND THE RESTORE IS PROVEN. `git checkout --` cannot
# restore an uncommitted edit, so the snapshot is a `cp` taken before the first mutation and the
# sha256 is compared after every restore.
#
# USAGE
#   bash agent-qa/scripts/394-funnel-mutation.sh     # from the super-repository root
#   bash scripts/394-funnel-mutation.sh              # from the agent-qa root
#
# KNOBS
#   FUNNEL_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation". A mutation script that cannot fail when its mutation
#       does nothing is measuring nothing, and this is how that is checked without hand-editing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SUBJECT_REL="packages/schema/src/authoring/funnel.ts"
SUBJECT="$REPO_ROOT/$SUBJECT_REL"
SCHEMA_FILTER="@vostride/agent-qa-schema"
SUITE="src/authoring/__tests__/funnel.test.ts"

WORK="$(mktemp -d)"
SNAPSHOT="$WORK/funnel.ts.snapshot"
LOG="$WORK/leg.log"
trap 'cp "$SNAPSHOT" "$SUBJECT" 2>/dev/null || true; rm -rf "$WORK"' EXIT

cp "$SUBJECT" "$SNAPSHOT"
BASELINE_SHA="$(shasum -a 256 "$SNAPSHOT" | cut -d' ' -f1)"
echo "subject   $SUBJECT_REL"
echo "  sha256  $BASELINE_SHA"
echo

# Each mutation's allowed red cells, spelled exactly as vitest prints them. Every entry is an
# assertion about the property the mutation removes — see the per-mutation note.
#
# E removes the flag's ability to fire AT ALL, so every cell that asserts a firing flag reds.
ALLOWED_E="ADMITS the flag at a draft count exactly equal to the floor
admits the flag one above the floor
FIRES on the seeded high-keep corpus
fires one step ABOVE the ceiling
flags a rate that DISPLAYS as 90%"
# F changes only the boundary DIRECTION, so exactly the boundary cell reds.
ALLOWED_F="does NOT fire at a rate exactly equal to the ceiling"
# G changes only the flag's INPUT, so exactly the rounding cell reds.
ALLOWED_G="flags a rate that DISPLAYS as 90%"
# H frames the rendered line, so the render REFUSES to construct — which reds the prohibition
# cells and, because the refusal is thrown, every cell that renders a flagged line.
ALLOWED_H="$ALLOWED_E
checks the SHIPPED wording table
never frames a high keep rate as an achievement"

apply_mutation () {
  case "${FUNNEL_MUTATION_SELFTEST:-}" in
    neutered)
      # A NO-OP that still changes bytes would defeat the point; this changes nothing at all.
      return 0
      ;;
  esac
  case "$1" in
    E) perl -0pi -e 's/const acceptanceFailure = aboveCeiling \&\& built >= FUNNEL_MIN_DRAFTS_FLOOR/const acceptanceFailure = false \&\& aboveCeiling \&\& built >= FUNNEL_MIN_DRAFTS_FLOOR/' "$SUBJECT" ;;
    F) perl -0pi -e 's/accepted \* KEEP_RATE_CEILING\.den > KEEP_RATE_CEILING\.num \* built/accepted * KEEP_RATE_CEILING.den >= KEEP_RATE_CEILING.num * built/' "$SUBJECT" ;;
    G) perl -0pi -e 's{const aboveCeiling = accepted \* KEEP_RATE_CEILING\.den > KEEP_RATE_CEILING\.num \* built}{const aboveCeiling = built === 0 ? false : Math.round((accepted / built) * 100) > 90}' "$SUBJECT" ;;
    H) perl -0pi -e "s/notFiltering: 'the loop is not filtering'/notFiltering: 'the loop is not filtering — a great score'/" "$SUBJECT" ;;
    *) echo "FATAL: unknown mutation $1" >&2; exit 1 ;;
  esac
}

run_mutation () {
  local name="$1" label="$2" allowed="$3"

  echo "=== MUTATION $name — $label"
  cp "$SNAPSHOT" "$SUBJECT"
  apply_mutation "$name"
  local mutated_sha
  mutated_sha="$(shasum -a 256 "$SUBJECT" | cut -d' ' -f1)"
  echo "  mutated sha256 $mutated_sha"

  set +e
  pnpm --filter "$SCHEMA_FILTER" exec vitest run "$SUITE" > "$LOG" 2>&1
  local rc=$?
  set -e
  echo "  leg exited $rc"
  grep -E '^      Tests' "$LOG" || true

  if [ "$rc" -eq 0 ]; then
    echo "FATAL: the suite stayed green under the mutation — mutation $name measures nothing" >&2
    cp "$SNAPSHOT" "$SUBJECT"
    exit 1
  fi

  local red
  red="$(grep -oE "^ FAIL  $SUITE > .*" "$LOG" | sed "s|^ FAIL  $SUITE > ||" | sort -u)"
  echo "  cells red:"
  while IFS= read -r cell; do
    [ -z "$cell" ] && continue
    echo "    - $cell"
  done <<< "$red"

  # Every red cell must match one allowed fragment. A red outside the list is collateral, and a
  # differential that reds on collateral has measured fragility rather than the property.
  local line fragment ok
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    ok=0
    while IFS= read -r fragment; do
      [ -z "$fragment" ] && continue
      case "$line" in *"$fragment"*) ok=1 ;; esac
    done <<< "$allowed"
    if [ "$ok" -eq 0 ]; then
      echo "FATAL: mutation $name red a cell outside its allowed list: $line" >&2
      cp "$SNAPSHOT" "$SUBJECT"
      exit 1
    fi
  done <<< "$red"

  cp "$SNAPSHOT" "$SUBJECT"
  local restored_sha
  restored_sha="$(shasum -a 256 "$SUBJECT" | cut -d' ' -f1)"
  if [ "$restored_sha" != "$BASELINE_SHA" ]; then
    echo "FATAL: restore was not byte-identical ($restored_sha != $BASELINE_SHA)" >&2
    exit 1
  fi
  echo "  restored byte-identically — sha256 $restored_sha"
  echo
}

echo "=== PREFLIGHT — the pre-mutation suite must be green"
set +e
pnpm --filter "$SCHEMA_FILTER" exec vitest run "$SUITE" > "$LOG" 2>&1
PREFLIGHT_RC=$?
set -e
echo "  preflight exited $PREFLIGHT_RC"
grep -E '^      Tests' "$LOG" || true
if [ "$PREFLIGHT_RC" -ne 0 ]; then
  echo "FATAL: the suite is already red before any mutation" >&2
  exit 1
fi
echo

run_mutation E "the flag branch deleted"                        "$ALLOWED_E"
run_mutation F "the ceiling comparison made greater-or-equal"    "$ALLOWED_F"
run_mutation G "the flag computed from the ROUNDED display %"    "$ALLOWED_G"
run_mutation H "the wording table grows a success framing"       "$ALLOWED_H"

echo "PASS — the acceptance-failure flag is proven able to fire, and proven to disappear under"
echo "       the deleted branch, the wrong boundary, the rounded input and the framed render."
