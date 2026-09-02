#!/usr/bin/env bash
#
# 412-issue-slot-mutation.sh — the acceptance bar for the Issue-slot cleanup (CLSR-02, D-07/D-08/D-09).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phases 409, 410 and 411 narrowed a
# dozen closed sets and deleted the vocabulary that addressed the reserved issue slot. Every one of
# those is a set that got SMALLER, and a set that got smaller has a failure mode a passing suite
# cannot see: the removed member coming back. Nothing in a green run fails when a retired kind, id,
# brand, entity, proposal arm or side counter is re-added — an assertion that a shape CONTAINS what
# it should contain is satisfied by a shape that contains more. So the bar is measured by mutation:
# each leg re-adds exactly one retired thing, runs the instrument that exists to refuse it, and
# proves the RED landed in the cell this script NAMES IN ADVANCE.
#
# THE PLANT LEGS POINT AT THE CENSUS. `packages/arch/src/__tests__/412-issue-slot-deleted.test.ts`
# claims a lexical inventory over every package's `src`. A claim like that is satisfied by a scan
# that walks nothing, so each plant leg drops a one-line file spelling one needle into a real
# package, runs the census, and requires the RED to NAME that file (D-04). No `dist` is crossed —
# the census reads raw utf8 off disk — so a plant leg rebuilds nothing.
#
# THE SCHEMA-LOCAL LEGS POINT AT TYPE WALLS. Two of the narrowings are compile-time bars rather
# than runtime cells: the surviving six-arm `Delta` refuses a seventh arm through a `never` bar in
# a `.test-d.ts` sibling, and the funnel's side-counter key set is pinned by `keyof`. Those read
# `pnpm --filter <pkg> typecheck` and a type-test suite respectively, which is why this script has
# three red-parsers rather than one.
#
# THE THREE RED-PARSERS, AND WHY ONE GREP CANNOT SERVE ALL THREE.
#   runtime    a vitest cell prints ` FAIL  <suite> > <describe> > <title>` — the TITLE is the cell
#              name, and the suite prefix is stripped so REQUIRED/ALLOWED stay substrings.
#   typecheck  `pnpm --filter <pkg> typecheck` prints tsc's own
#              `src/<path>(<line>,<col>): error TS<n>` — the FILE AND COLUMN are the cell name,
#              because an `expectTypeOf<X>().toEqualTypeOf<never>()` whose X is no longer `never`
#              reds at the column of `toEqualTypeOf` and has no test title at all. pnpm surfaces
#              tsc's exit 2 here; every leg asserts NON-ZERO and prints the number it observed,
#              because a `-eq 1` assertion would fail on a correct measurement. The root
#              `turbo`-driven typecheck is never the instrument: it caches per package and a cache
#              hit replays a stale green.
#   testd      a `.test-d.ts` reds as ONE FAILED SUITE — ` FAIL  <suite> [ <suite> ]` plus a
#              `TypeCheckError` block pointing at `<suite>:<line>:<col>`, with `Tests  no tests`.
#              A `^ FAIL  <suite> > <title>` grep finds NOTHING there, which is why this mode
#              exists; "nothing else may be red" is checked by counting TypeCheckError blocks.
#
# EACH MUTATION MUST RED A CELL THIS SCRIPT NAMES IN ADVANCE. A red somewhere is not the claim; a
# red in the cell that exists to catch that specific return is. Each leg therefore carries a
# REQUIRED set (every fragment must be among the reds) and an ALLOWED set (nothing else may be
# red) — a mutation that reds half the package is measuring blast radius, not the property. Both
# are matched as SUBSTRINGS of the FAIL title, never against a test COUNT: several mutations grow
# the total by generating cells that exist only under the mutation.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# FAIL-FAST, AND THE TREE IS NEVER LEFT DIRTY. The first FATAL restores every subject from its byte
# snapshot, removes every path the leg created, rebuilds the same filters and exits 1; the EXIT
# trap does the same on any other exit path. There is no LEG selector and no run-all-and-report
# mode: a selector that runs nothing is a green script (D-09).
#
# USAGE
#   pnpm validate:issue-slot-mutation                   # from the agent-qa root
#   bash agent-qa/scripts/412-issue-slot-mutation.sh    # from the super-repository root
#
# KNOBS
#   ISSUE_SLOT_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation" — a gate nobody has seen fire is a comment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ARCH_FILTER="@vostride/agent-qa-arch"
SCHEMA_FILTER="@vostride/agent-qa-schema"
AGENT_FILTER="@vostride/agent-qa-agent"
LOCAL_FILTER="@vostride/agent-qa-agent-local"
# The cli package is named `agent-qa`, not `@vostride/agent-qa-cli`. A filter that matches no
# project exits 0 without running anything, which is a green that measures nothing.
CLI_FILTER="agent-qa"

CENSUS="src/__tests__/412-issue-slot-deleted.test.ts"

WORK="$(mktemp -d)"
LOG="$WORK/leg.log"
LEGS_RUN=0

# The one mid-leg extension point. A leg may name a shell function here; `run_leg` invokes it while
# the mutation is still live and after the red set has been accepted, then clears it so it cannot
# leak into the next leg. The hook FATALs on its own terms (echo to stderr, exit 1 — the EXIT trap
# restores). Plant legs use it to prove the RED named the planted file.
POST_RUN_CHECK=""

snapshot_path () { echo "$WORK/$(echo "$1" | tr '/' '_').snapshot"; }

# Newline-separated, never associative arrays: /bin/bash here is 3.2.57.
CURRENT_SUBJECTS=""
CURRENT_CREATED=""

restore_current () {
  local p
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    cp "$(snapshot_path "$p")" "$REPO_ROOT/$p" 2>/dev/null || true
  done <<< "$CURRENT_SUBJECTS"
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    rm -f "$REPO_ROOT/$p"
  done <<< "$CURRENT_CREATED"
}

trap 'restore_current; rm -rf "$WORK"' EXIT

# SCOPED to the subject path, never a bare `git status`: this working tree carries pre-existing
# unrelated dirt under `packages/knowledge-local/src` and `tools/embedding-bench` that predates
# this milestone and cannot be cleaned by it.
clean_gate () {
  local p="$1"
  if [ -n "$(git status --porcelain -- "$p")" ]; then
    echo "FATAL: $p is dirty before the snapshot — refusing to mutate it" >&2
    exit 1
  fi
}

build_package () {
  local filter="$1"
  set +e
  pnpm --filter "$filter" build > "$WORK/build.log" 2>&1
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: rebuilding $filter failed — see $WORK/build.log" >&2
    restore_current
    exit 1
  fi
}

apply_mutation () {
  case "${ISSUE_SLOT_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    P-*)
      # One needle, one line, one file — 410 Row 7 showed a line spelling two needles reds two
      # cells, so a plant carries exactly one.
      printf '%s\n' "$PLANT_LINE" > "$REPO_ROOT/$PLANT_PATH" ;;
    V-01)
      # 409 Row 4's diff, verbatim: a seventh arm on the SURVIVING six-arm union.
      perl -0pi -e "s/\Qexport type Delta = Add | Confirm | Supersede | Deprecate | MintUnknown | Noop\E\n/export type Delta = Add | Confirm | Supersede | Deprecate | MintUnknown | Noop | (DeltaEnvelope \& { kind: 'FileIssue' })\n/" \
        "$REPO_ROOT/packages/schema/src/delta/delta.ts" ;;
    W-06)
      # 411 Row 8's diff, verbatim. OPTIONAL on purpose: a required key would red the producers
      # and the leg would measure the compiler's required-field check instead of the counter bar.
      perl -0pi -e "s/\Q  readonly dedupRefusals?: number\E\n/  readonly dedupRefusals?: number\n  readonly findings?: number\n/" \
        "$REPO_ROOT/packages/schema/src/authoring/funnel.ts" ;;
    *) echo "FATAL: unknown leg $1" >&2; exit 1 ;;
  esac
}

# run_leg <id> <label> <mode> <required> <allowed> <filter> <suite> <rebuild-filters> <subjects> <created>
#
#   mode      runtime | typecheck | testd — which red-parser reads the log
#   required  newline-separated fragments, every one of which must be among the reds
#   allowed   newline-separated fragments; every red must contain one of them
#   rebuild   space-separated filters, rebuilt in order before the run and again after the restore
#   subjects  newline-separated committed paths this leg edits (snapshotted, sha256-verified)
#   created   newline-separated paths this leg brings into existence (must not exist beforehand)
run_leg () {
  local id="$1" label="$2" mode="$3" required="$4" allowed="$5" filter="$6" suite="$7" rebuild="$8"
  CURRENT_SUBJECTS="$9"
  CURRENT_CREATED="${10}"

  echo "=== LEG $id — $label"

  local p
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    clean_gate "$p"
    cp "$REPO_ROOT/$p" "$(snapshot_path "$p")"
    echo "  subject $p sha256 $(shasum -a 256 "$REPO_ROOT/$p" | cut -d' ' -f1)"
  done <<< "$CURRENT_SUBJECTS"
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if [ -e "$REPO_ROOT/$p" ]; then
      echo "FATAL: $p already exists — leg $id would overwrite a real file" >&2
      exit 1
    fi
  done <<< "$CURRENT_CREATED"

  apply_mutation "$id"

  # The 410 landed gate: an edit that no longer matches its anchor changes nothing and the leg
  # would report a green that measures the absence of the mutation. Skipped when neutered — a
  # no-op edit changing nothing is exactly what the self-test is for.
  if [ "${ISSUE_SLOT_SELFTEST:-}" != neutered ]; then
    local landed=0
    while IFS= read -r p; do
      [ -z "$p" ] && continue
      cmp -s "$REPO_ROOT/$p" "$(snapshot_path "$p")" || landed=1
    done <<< "$CURRENT_SUBJECTS"
    while IFS= read -r p; do
      [ -z "$p" ] && continue
      [ -e "$REPO_ROOT/$p" ] && landed=1
    done <<< "$CURRENT_CREATED"
    if [ "$landed" -ne 1 ]; then
      echo "FATAL: leg $id changed nothing — the edit no longer matches" >&2
      exit 1
    fi
  fi

  local f
  for f in $rebuild; do
    echo "  rebuilding $f so the cell resolves the MUTATED source through dist"
    build_package "$f"
  done

  set +e
  case "$mode" in
    typecheck) pnpm --filter "$filter" typecheck > "$LOG" 2>&1 ;;
    *)         pnpm --filter "$filter" exec vitest run $suite > "$LOG" 2>&1 ;;
  esac
  local rc=$?
  set -e
  echo "  leg exited $rc"
  grep -E '^      Tests' "$LOG" || true

  if [ "$rc" -eq 0 ]; then
    echo "FATAL: the suite stayed green under the mutation — leg $id measures nothing" >&2
    restore_current
    for f in $rebuild; do build_package "$f"; done
    exit 1
  fi

  local red
  set +e
  case "$mode" in
    runtime)
      # A runtime cell prints ` FAIL  <suite> > <describe> > <title>`; the title alone is enough to
      # match on, so the suite prefix is stripped and REQUIRED/ALLOWED stay substrings.
      red="$(grep -oE "^ FAIL  [^ ]+ > .*" "$LOG" | sed -E 's|^ FAIL  [^ ]+ > ||' | sort -u)" ;;
    typecheck)
      # tsc's own diagnostic spelling, which is the ledgers' field-8 spelling verbatim:
      # `src/__tests__/delta.test-d.ts(76,55): error TS2554`. The FILE AND COLUMN are the cell name.
      red="$(grep -oE '^src/[^ ]+\([0-9]+,[0-9]+\): error TS[0-9]+' "$LOG" | sort -u)" ;;
    testd)
      # A `.test-d.ts` reds as ONE FAILED SUITE with a TypeCheckError pointer — there is no test
      # title to match, so the suite line and the `<file>:<line>:<col>` pointer are the cell name.
      red="$(grep -oE "^ FAIL  $suite \[ $suite \]|❯ $suite:[0-9]+:[0-9]+" "$LOG" | sort -u)" ;;
    *)
      set -e
      echo "FATAL: leg $id asks for mode $mode — mode not implemented" >&2
      restore_current
      for f in $rebuild; do build_package "$f"; done
      exit 1 ;;
  esac
  set -e

  echo "  cells red:"
  local line fragment ok
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    echo "    - $line"
  done <<< "$red"

  if [ -z "$red" ]; then
    echo "FATAL: leg $id did not red its named cell — the log carries no parseable red" >&2
    restore_current
    for f in $rebuild; do build_package "$f"; done
    exit 1
  fi

  # A type-test leg's ALLOWED list is "nothing else", and "nothing else" is only checkable by
  # counting the blocks: the suite line names the file but not how many walls inside it fell.
  if [ "$mode" = testd ]; then
    local blocks
    set +e
    blocks="$(grep -c 'TypeCheckError' "$LOG" | tr -d '[:space:]')"
    set -e
    echo "  TypeCheckError blocks: $blocks"
    if [ "$blocks" -ne 1 ]; then
      echo "FATAL: leg $id raised $blocks TypeCheckError blocks — exactly one was predicted" >&2
      restore_current
      for f in $rebuild; do build_package "$f"; done
      exit 1
    fi
  fi

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
      echo "FATAL: leg $id red a cell outside its allowed list: $line" >&2
      restore_current
      for f in $rebuild; do build_package "$f"; done
      exit 1
    fi
  done <<< "$red"

  # …and every cell this mutation EXISTS to red must be among them.
  while IFS= read -r fragment; do
    [ -z "$fragment" ] && continue
    case "$red" in
      *"$fragment"*) echo "  named cell red: $fragment" ;;
      *)
        echo "FATAL: leg $id did not red its named cell: $fragment" >&2
        restore_current
        for f in $rebuild; do build_package "$f"; done
        exit 1 ;;
    esac
  done <<< "$required"

  # The mid-leg hook — the mutation is still live and the red set has been accepted.
  if [ -n "$POST_RUN_CHECK" ]; then
    "$POST_RUN_CHECK"
    POST_RUN_CHECK=""
  fi

  restore_current
  for f in $rebuild; do build_package "$f"; done

  while IFS= read -r p; do
    [ -z "$p" ] && continue
    local restored baseline
    restored="$(shasum -a 256 "$REPO_ROOT/$p" | cut -d' ' -f1)"
    baseline="$(shasum -a 256 "$(snapshot_path "$p")" | cut -d' ' -f1)"
    if [ "$restored" != "$baseline" ]; then
      echo "FATAL: $p was not restored byte-identically ($restored)" >&2
      exit 1
    fi
  done <<< "$CURRENT_SUBJECTS"
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if [ -e "$REPO_ROOT/$p" ]; then
      echo "FATAL: $p survived the leg — a created path was not removed" >&2
      exit 1
    fi
  done <<< "$CURRENT_CREATED"
  echo "  every subject restored byte-identically (sha256 compared); every created path removed"

  # D-09: the instrument must be green again before the next leg starts.
  set +e
  case "$mode" in
    typecheck) pnpm --filter "$filter" typecheck > "$LOG" 2>&1 ;;
    *)         pnpm --filter "$filter" exec vitest run $suite > "$LOG" 2>&1 ;;
  esac
  local back=$?
  set -e
  if [ "$back" -ne 0 ]; then
    echo "FATAL: the instrument is still red after leg $id restored (exit $back)" >&2
    exit 1
  fi
  echo "  instrument green again after restore"

  CURRENT_SUBJECTS=""
  CURRENT_CREATED=""
  LEGS_RUN=$((LEGS_RUN + 1))
  echo
}

# ── The plant legs (D-04) ──────────────────────────────────────────────────────────────────────
#
# The census claims a lexical inventory over every package's `src`. A plant proves the claim is
# non-vacuous FOR THAT PACKAGE: the RED must name the planted file, not merely exist.
PLANT_PATH=""
PLANT_LINE=""
PLANT_PKG=""

plant_names_the_file () {
  if grep -qF "$PLANT_PKG/src/412-plant.ts:1:" "$LOG"; then
    echo "  red names the plant: $PLANT_PKG/src/412-plant.ts:1:"
  else
    echo "FATAL: the census red did not name the plant: $PLANT_PKG/src/412-plant.ts:1:" >&2
    exit 1
  fi
}

# plant_leg <pkg> <plant line> <census cell title>
plant_leg () {
  PLANT_PKG="$1"
  PLANT_LINE="$2"
  PLANT_PATH="packages/$1/src/412-plant.ts"
  local title="$3"
  POST_RUN_CHECK="plant_names_the_file"
  run_leg "P-$1" "a needle planted in $1" runtime "$title" "$title" \
    "$ARCH_FILTER" "$CENSUS" "" "" "$PLANT_PATH"
}

# ── PREFLIGHT ─────────────────────────────────────────────────────────────────────────────────
echo "=== PREFLIGHT — every instrument must be green before any subject is touched"
set +e
pnpm --filter "$ARCH_FILTER" exec vitest run "$CENSUS" > "$LOG" 2>&1
PREFLIGHT_RC=$?
set -e
echo "  $CENSUS exited $PREFLIGHT_RC"
grep -E '^      Tests' "$LOG" || true
if [ "$PREFLIGHT_RC" -ne 0 ]; then
  echo "FATAL: already red before any mutation: $CENSUS" >&2
  exit 1
fi
echo

# ── The legs, cheapest first ──────────────────────────────────────────────────────────────────

# 412 Row P-arch / CLSR-01 — the census names the package it accuses.
plant_leg arch '// 412 plant: triage-issues' 'no source or test spells the reserved sixth job kind'

# 411 Row 8 / the funnel keyof pin — the cheapest type wall in the tree (~2 s, no rebuild).
W06_SUITE="src/authoring/__tests__/funnel.test-d.ts"
W06_REQUIRED="src/authoring/__tests__/funnel.test-d.ts:41:56"
W06_ALLOWED="src/authoring/__tests__/funnel.test-d.ts"
run_leg W-06 "a side-counter key re-added beside the funnel's surviving counter" testd \
  "$W06_REQUIRED" "$W06_ALLOWED" "$SCHEMA_FILTER" "$W06_SUITE" "" \
  "packages/schema/src/authoring/funnel.ts" ""

# 409 Row 4 / the Delta guard (NOT VOCB-01; D-05) — the ledger corrected this row's attribution:
# `delta.ts` is byte-identical across the whole deletion, so what the retained `never` bars guard
# is the SURVIVING six-arm union against a future widening. VOCB-01 is carried by leg V-03, the
# whole-vocabulary readmission.
V01_REQUIRED="src/__tests__/delta.test-d.ts(76,55): error TS2554"
V01_ALLOWED="src/__tests__/delta.test-d.ts(76,55): error TS2554
src/__tests__/review-dtos.test-d.ts(31,70): error TS2554
src/__tests__/seam-root.test-d.ts(93,55): error TS2554"
run_leg V-01 "a seventh arm widened onto the surviving Delta union" typecheck \
  "$V01_REQUIRED" "$V01_ALLOWED" "$SCHEMA_FILTER" "" "" \
  "packages/schema/src/delta/delta.ts" ""

echo "LEGS $LEGS_RUN"
echo "PASS — a needle planted in a real package REDs the merged census by that package's own file"
echo "       name, the plant is removed and the tree is byte-clean afterwards, the census is green"
echo "       again before the script exits, a re-added funnel side-counter key fails the keyof pin"
echo "       as ONE failed suite with exactly one type error, and a seventh arm widened onto the"
echo "       surviving Delta union cannot compile past the retained never bar."
