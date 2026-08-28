#!/usr/bin/env bash
#
# 405-debris-mutation.sh — the acceptance bar for phase 405's deletions (405-13, D-21 / DETL-06).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 405 deleted three v1 projection
# tables, five `runs` columns, two path-addressed artifact routes, the legacy live feed, the v1 UI
# step shape and one orphaned analytics field. Every one of those is a set that got SMALLER, and a
# set that got smaller has a failure mode a passing suite cannot see: the removed member coming
# back. Nothing in a green run fails when a retired token, column, field or type member is re-added
# — an assertion that a shape CONTAINS what it should is satisfied by a shape that contains more.
# So the bar is measured by mutation:
#
#   G  a retired needle re-appears in a PRODUCTION source, as a comment
#   D  a healing column re-added to the version-2 DDL
#   U  a recording-path member re-added to the UI step type
#   A  the retired healing counter re-added to the analytics completion shape
#
# EACH MUTATION MUST RED A CELL THIS SCRIPT NAMES IN ADVANCE. A red somewhere is not the claim; a
# red in the cell that exists to catch that specific return is. Each leg therefore carries a
# REQUIRED cell (must be among the reds) and an ALLOWED list (nothing else may be red) — a mutation
# that reds half the package is measuring blast radius, not the property.
#
# G MUTATES A COMMENT, ON PURPOSE. The inventory's promise is "this string is not in the shipped
# tree", not "no code calls it": a retirement note that spells a retired token is a hit exactly like
# a live reference is. Three plans in this phase were sent back for tripping on their own prose, so
# the property is not merely documented in the cell — it is the mutation.
#
# U IS TWO WALLS AND BOTH ARE READ. `DisplayStep` is a TypeScript interface, so a returning member
# is a compile error before it is a behaviour: `tsc --noEmit` must refuse it (the cell's `Extract`
# pin over the key union). But a type is erased before anything runs and this package's vitest does
# not typecheck, so the source-reading cell must red too. A leg that only read the compiler would go
# quiet the day somebody widens the type with a cast.
#
# NO `dist` REBUILD IS REQUIRED BY ANY LEG, and that is a property of the cells rather than an
# omission. Each cell reads its subject from the SAME package it lives in — the inventory and the
# DDL cell import `../db/schema.js`, the UI cell reads `lib/display-step.ts` as source text and the
# analytics cell reads its own `../events.js` — so vitest transforms the mutated source directly.
# Nothing here crosses a package boundary that resolves through built output, which is what forces
# 404-chip-teardown-mutation.sh and 405-run-detail-mutation.sh to rebuild between legs.
#
# D REDS TWO INSTRUMENTS, AND BOTH ARE ALLOWED. `healing_attempts` in `schema.ts` is both a DDL
# column (the structural cell) and a D-21 needle in a production source (the lexical cell). Two
# independent predicates catching the same return is the census idiom, not blast radius.
#
# AFTER RUNNING THIS SCRIPT, REBUILD WITH `--force` BEFORE THE CONFORMANCE ANCHORS. Every subject is
# restored BYTE-IDENTICALLY, which turbo treats as a cache hit: a plain `pnpm build` then reports
# FULL TURBO and refreshes no `dist` mtime, while the four sources this script touched are now newer
# than the build. The CLI conformance cells carry a staleness guard that refuses to certify a stale
# binary and will red with "run `pnpm build` at the repository root first". The fix is
# `npx turbo run build --force`, not a rebuild. Same hazard the 404 mutation scripts documented.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# USAGE
#   bash agent-qa/scripts/405-debris-mutation.sh   # from the super-repository root
#   bash scripts/405-debris-mutation.sh            # from the agent-qa root
#
# KNOBS
#   DEBRIS_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation" — a gate nobody has seen fire is a comment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

DASHBOARD_FILTER="@vostride/agent-qa-dashboard"
UI_FILTER="@vostride/agent-qa-dashboard-ui"
ANALYTICS_FILTER="@vostride/agent-qa-analytics"

# The four subjects, one per leg.
GREP_SUBJECT="packages/dashboard-server/src/queue/job-queue.ts"
DDL_SUBJECT="packages/dashboard-server/src/db/schema.ts"
UI_SUBJECT="packages/dashboard-ui/src/lib/display-step.ts"
ANALYTICS_SUBJECT="packages/analytics/src/events.ts"

SUBJECT_PATHS=("$GREP_SUBJECT" "$DDL_SUBJECT" "$UI_SUBJECT" "$ANALYTICS_SUBJECT")

DEBRIS_SUITE="src/__tests__/405-debris-deleted.test.ts"
UI_SUITE="src/lib/__tests__/run-detail-shape.test.ts"
ANALYTICS_SUITE="src/__tests__/events.test.ts"

# THE RETIRED TOKENS ARE ASSEMBLED FROM TWO HALVES, exactly as the cells do it. This script lives
# outside `packages/`, so the inventory's own walk cannot see it — but a repo-wide grep run by a
# human has no such exclusion, and a mutation script that spells the token it forbids is the same
# self-matching defect one layer out.
NEEDLE_SSE="/api/execution/""events"
NEEDLE_HEALING="healing_att""empts"
NEEDLE_UI_PATH="screenshot""Path"
NEEDLE_ANALYTICS="healing_attempt""_count"

WORK="$(mktemp -d)"
LOG="$WORK/leg.log"

snapshot_path () { echo "$WORK/$(echo "$1" | tr '/' '_').snapshot"; }

restore_subjects () {
  local path
  for path in "${SUBJECT_PATHS[@]}"; do
    cp "$(snapshot_path "$path")" "$REPO_ROOT/$path" 2>/dev/null || true
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

# ── The named cells. REQUIRED is what the mutation exists to red; ALLOWED is everything a red is
# permitted to be. Both are matched as substrings of the cell name a red prints.
REQUIRED_G="no production source spells the legacy execution-events SSE route"
ALLOWED_G="no production source spells the legacy execution-events SSE route"

REQUIRED_D="the version-2 DDL declares no healing column"
# The lexical arm sees the same bytes from the other side — see the header note on D.
ALLOWED_D="the version-2 DDL declares no healing column
no production source spells the v1 healing attempt list"

REQUIRED_U="declares no member naming a screenshot, a healing capture, a video or a path"
ALLOWED_U="declares no member naming a screenshot, a healing capture, a video or a path"

REQUIRED_A="carries neither retired producer-less field, on EITHER completion member"
ALLOWED_A="carries neither retired producer-less field, on EITHER completion member
declares EXACTLY the base keys, the completion keys and its own discriminating id
shares that same shape with the suite member, which adds only suite facts
the retired healing-attempt counter is not a key of the completion shape, and is REFUSED"

apply_mutation () {
  case "${DEBRIS_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    G)
      # A retirement note that names the route it retired — the exact shape of the comment somebody
      # writes while deleting the thing, and the one this phase has already been caught by twice.
      printf '\n// A dated note naming the retired %s feed.\n' "$NEEDLE_SSE" \
        >> "$REPO_ROOT/$GREP_SUBJECT" ;;
    D)
      # A healing column back on the step projection. Nothing PRODUCES it — which is exactly why
      # only a closed-shape cell over the DDL can see it arrive.
      perl -0pi -e "s/        total_tokens INTEGER,\n        PRIMARY KEY \(run_id, test_index, step_index\)/        total_tokens INTEGER,\n        ${NEEDLE_HEALING} TEXT,\n        PRIMARY KEY (run_id, test_index, step_index)/" \
        "$REPO_ROOT/$DDL_SUBJECT" ;;
    U)
      # A recording-path member back on the UI step type — declared and never assigned, which is how
      # a path field actually comes back and why the cell reads the DECLARATION rather than a value.
      perl -0pi -e "s/  \/\*\* ABSENT when the step reported no usage — never a zero \(D-05\/D-06\)\. \*\//  ${NEEDLE_UI_PATH}?: string\n  \/** ABSENT when the step reported no usage — never a zero (D-05\/D-06). *\//" \
        "$REPO_ROOT/$UI_SUBJECT" ;;
    A)
      # The retired counter back on the completion shape's DECLARATION. The pre-existing strict-parse
      # cell sees a payload carrying the key; only the key-set equality sees the declaration grow.
      perl -0pi -e "s/  retry_count: NonNegativeInteger\.optional\(\),/  retry_count: NonNegativeInteger.optional(),\n  ${NEEDLE_ANALYTICS}: NonNegativeInteger.optional(),/" \
        "$REPO_ROOT/$ANALYTICS_SUBJECT" ;;
    *) echo "FATAL: unknown mutation $1" >&2; exit 1 ;;
  esac
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

assert_mutation_landed () {
  local name="$1" path="$2"
  case "${DEBRIS_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  if cmp -s "$REPO_ROOT/$path" "$(snapshot_path "$path")"; then
    echo "FATAL: mutation $name changed nothing — the patch no longer matches $path" >&2
    restore_subjects
    exit 1
  fi
}

# run_leg <name> <label> <required> <allowed> <filter> <suite> <subject>
run_leg () {
  local name="$1" label="$2" required="$3" allowed="$4" filter="$5" suite="$6" subject="$7"

  echo "=== MUTATION $name — $label"
  restore_subjects
  apply_mutation "$name"
  assert_mutation_landed "$name" "$subject"
  local path
  for path in "${SUBJECT_PATHS[@]}"; do
    echo "  $path sha256 $(shasum -a 256 "$REPO_ROOT/$path" | cut -d' ' -f1)"
  done

  set +e
  pnpm --filter "$filter" exec vitest run "$suite" > "$LOG" 2>&1
  local rc=$?
  set -e
  echo "  leg exited $rc"
  grep -E '^      Tests' "$LOG" || true

  if [ "$rc" -eq 0 ]; then
    echo "FATAL: the suite stayed green under the mutation — mutation $name measures nothing" >&2
    restore_subjects
    exit 1
  fi

  local red
  red="$(grep -oE "^ FAIL  $suite > .*" "$LOG" | sed "s|^ FAIL  $suite > ||" | sort -u)"
  echo "  cells red:"
  local line fragment ok
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    echo "    - $line"
  done <<< "$red"

  # Nothing outside the allowed list may be red: a mutation that reds the package is measuring
  # blast radius rather than the property.
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
      exit 1
    fi
  done <<< "$red"

  # …and the cell this mutation EXISTS to red must be among them.
  case "$red" in
    *"$required"*) echo "  named cell red: $required" ;;
    *)
      echo "FATAL: mutation $name did not red its named cell: $required" >&2
      restore_subjects
      exit 1 ;;
  esac

  restore_subjects
  assert_restored
  echo
}

echo "=== PREFLIGHT — every cell must be green before any mutation"
for preflight in \
  "$DASHBOARD_FILTER|$DEBRIS_SUITE" \
  "$UI_FILTER|$UI_SUITE" \
  "$ANALYTICS_FILTER|$ANALYTICS_SUITE"
do
  set +e
  pnpm --filter "${preflight%%|*}" exec vitest run "${preflight##*|}" > "$LOG" 2>&1
  PREFLIGHT_RC=$?
  set -e
  echo "  ${preflight##*|} exited $PREFLIGHT_RC"
  grep -E '^      Tests' "$LOG" || true
  if [ "$PREFLIGHT_RC" -ne 0 ]; then
    echo "FATAL: ${preflight##*|} is already red before any mutation" >&2
    exit 1
  fi
done
echo

run_leg G "a retired needle re-appears in a production source, as a comment" \
  "$REQUIRED_G" "$ALLOWED_G" "$DASHBOARD_FILTER" "$DEBRIS_SUITE" "$GREP_SUBJECT"
run_leg D "a healing column re-added to the version-2 DDL" \
  "$REQUIRED_D" "$ALLOWED_D" "$DASHBOARD_FILTER" "$DEBRIS_SUITE" "$DDL_SUBJECT"

# ── U reads the COMPILER first, then the runtime cell (see the header).
echo "=== MUTATION U (type wall) — a recording-path member must not compile"
restore_subjects
apply_mutation U
assert_mutation_landed U "$UI_SUBJECT"
set +e
pnpm --filter "$UI_FILTER" exec tsc --noEmit > "$LOG" 2>&1
U_TSC_RC=$?
set -e
echo "  tsc --noEmit exited $U_TSC_RC"
grep -E 'error TS' "$LOG" | head -3 || true
restore_subjects
if [ "$U_TSC_RC" -eq 0 ] && [ "${DEBRIS_MUTATION_SELFTEST:-}" != "neutered" ]; then
  echo "FATAL: a recording-path member compiled — the key-union pin no longer refuses it" >&2
  exit 1
fi
if [ "${DEBRIS_MUTATION_SELFTEST:-}" = "neutered" ] && [ "$U_TSC_RC" -ne 0 ]; then
  echo "FATAL: the unmutated tree does not typecheck" >&2
  exit 1
fi
assert_restored
echo

run_leg U "a recording-path member re-added to the UI step type" \
  "$REQUIRED_U" "$ALLOWED_U" "$UI_FILTER" "$UI_SUITE" "$UI_SUBJECT"
run_leg A "the retired healing counter re-added to the analytics completion shape" \
  "$REQUIRED_A" "$ALLOWED_A" "$ANALYTICS_FILTER" "$ANALYTICS_SUITE" "$ANALYTICS_SUBJECT"

echo "PASS — a retired needle in a production comment reds the inventory, a healing column reds the"
echo "       version-2 DDL cell (and the lexical arm beside it), a recording-path member on the UI"
echo "       step type neither compiles nor survives the declaration cell, and the retired analytics"
echo "       counter reds the completion shape's key-set equality. Every subject restored byte-"
echo "       identically, verified by sha256."
