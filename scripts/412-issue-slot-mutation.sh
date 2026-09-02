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

# The V-03 coherence gate, run while the mutation is live and BEFORE the instrument.
#
# A PARTIAL readmission is not a measurement. 409 Row 10 measured the trap: restoring
# `issue-delta.ts` without the id brand makes `pnpm --filter <schema> typecheck` exit 2 on
# `TS2305: Module '"../ids/record-id"' has no exported member` — a BROKEN IMPORT, not a wall
# firing — and a census RED read off a tree that does not compile says nothing about the tree the
# codebase would really be in. So the gate asserts both halves of coherence: the schema typecheck
# exits 0 under the whole readmission (409 Rows 10-13 measured exactly that), and the barrel
# carries EXACTLY the three insertions the 409 diff records. The second half is Pitfall 1's guard:
# a whole-file restore of `src/index.ts` would readmit 411's deletions, drop the stop-arm exports
# and RED cells outside this leg's allowed set — a blast radius, not a property.
v03_coherence_gate () {
  set +e
  pnpm --filter "$SCHEMA_FILTER" typecheck > "$WORK/v03-typecheck.log" 2>&1
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: partial readmission — measures nothing (schema typecheck exited $rc under the" >&2
    echo "       V-03 mutation; see $WORK/v03-typecheck.log)" >&2
    exit 1
  fi
  local ins
  ins="$(git diff --numstat -- packages/schema/src/index.ts | awk '{print $1}')"
  if [ "${ins:-0}" != "3" ]; then
    echo "FATAL: partial readmission — measures nothing (the barrel took ${ins:-0} insertions;" >&2
    echo "       the 409 diff records exactly 3, and a whole-file restore is Pitfall 1)" >&2
    exit 1
  fi
  echo "  V-03 coherence gate: schema typecheck exit 0, packages/schema/src/index.ts +3"
}

apply_mutation () {
  case "${ISSUE_SLOT_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    P-*|C-01|C-02)
      # One needle, one line, one file — 410 Row 7 showed a line spelling two needles reds two
      # cells, so a plant carries exactly one. The two controls plant the same way; only WHERE
      # they land differs, and where is the whole claim (a path rule, never a by-name filter).
      printf '%s\n' "$PLANT_LINE" > "$REPO_ROOT/$PLANT_PATH" ;;
    V-01)
      # 409 Row 4's diff, verbatim: a seventh arm on the SURVIVING six-arm union.
      perl -0pi -e "s/\Qexport type Delta = Add | Confirm | Supersede | Deprecate | MintUnknown | Noop\E\n/export type Delta = Add | Confirm | Supersede | Deprecate | MintUnknown | Noop | (DeltaEnvelope \& { kind: 'FileIssue' })\n/" \
        "$REPO_ROOT/packages/schema/src/delta/delta.ts" ;;
    V-02)
      # 409 Row 5's diff, verbatim. The cast is the point: a plain append under
      # `as const satisfies readonly Delta['kind'][]` is a compile error at the constant itself,
      # so the leg would FATAL on the build instead of reaching the runtime cell. `as unknown as`
      # is what lets the widening REACH the assertion — and the schema typecheck stays GREEN under
      # this exact mutation, which is the whole claim: a type wall cannot see a cast-widened
      # projection and the runtime cell is the only instrument that can.
      perl -0pi -e "s/\Q  'Noop',\E\n\Q] as const satisfies readonly Delta['kind'][]\E/  'Noop',\n  'Reopen',\n] as unknown as readonly Delta['kind'][]/" \
        "$REPO_ROOT/packages/schema/src/delta/delta.ts" ;;
    V-03)
      # 409 Rows 10-13's diff, applied as it must be applied TODAY. Four whole-file restores from
      # the phase-baseline commit (the byte authority) plus the THREE barrel insertions the 409
      # diff records — never a whole-file restore of `src/index.ts`, which moved under 410/411.
      git show 9b0c3459:packages/schema/src/delta/issue-delta.ts > "$REPO_ROOT/packages/schema/src/delta/issue-delta.ts"
      git show 9b0c3459:packages/schema/src/delta/index.ts       > "$REPO_ROOT/packages/schema/src/delta/index.ts"
      git show 9b0c3459:packages/schema/src/ids/record-id.ts     > "$REPO_ROOT/packages/schema/src/ids/record-id.ts"
      git show 9b0c3459:packages/schema/src/ids/index.ts         > "$REPO_ROOT/packages/schema/src/ids/index.ts"
      perl -0pi -e 's/  asRecordId,\n  asEvidenceToken,/  asRecordId,\n  asIssueId,\n  asEvidenceToken,/;
                    s/  EvidenceToken,\n  RecordId,\n\} from \x27\.\/ids\/index\x27/  EvidenceToken,\n  IssueId,\n  RecordId,\n} from \x27.\/ids\/index\x27/;
                    s/  DeltaOrigin,\n\} from \x27\.\/delta\/index\x27/  DeltaOrigin,\n  IssueDelta,\n} from \x27.\/delta\/index\x27/' \
        "$REPO_ROOT/packages/schema/src/index.ts"
      v03_coherence_gate ;;
    J-02)
      # 409 Row 2's diff, verbatim. `consolidate` is chosen deliberately: it is a REGISTERED kind,
      # so the registry's own `declares only successors that are themselves registered` validation
      # stays out of the blast and the reds that remain are the successor-list cells.
      perl -0pi -e "s/\Qconst ANALYZE_RUN_SUCCESSORS: readonly JobKind[] = ['curate-memory']\E/const ANALYZE_RUN_SUCCESSORS: readonly JobKind[] = ['curate-memory', 'consolidate']/" \
        "$REPO_ROOT/packages/agent/src/jobs/kinds.ts" ;;
    J-01)
      # 409 Row 1's diff, verbatim — TWO lines, because both declarations spell the one set and
      # re-adding the member to `jobKindValues` alone violates `satisfies readonly JobKind[]`.
      perl -0pi -e "s/\Q  | 'curate-memory'\E\n/  | 'curate-memory'\n  | 'triage-issues'\n/; s/\Q  'curate-memory',\E\n/  'curate-memory',\n  'triage-issues',\n/" \
        "$REPO_ROOT/packages/schema/src/job/job.ts" ;;
    J-03a|J-03b|J-03c)
      # 409 Row 3's diff, verbatim — one mutation measured at three distances, the Row 7/8
      # precedent. The interface widening and the derivation must move together or the object
      # literal no longer satisfies `ChainJobIds`.
      perl -0pi -e 's/\n  readonly curateMemory: JobId\n/\n  readonly curateMemory: JobId\n  readonly consolidate: JobId\n/;
                    s/^(    curateMemory: idSource\.jobIdFor\(.*\n)/$1    consolidate: idSource.jobIdFor(\x27consolidate\x27, `\${String(analyzeRun)}->consolidate`),\n/m' \
        "$REPO_ROOT/packages/agent/src/jobs/chain-identity.ts" ;;
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

# The twelve plant lines and the census cell each one must RED, rotated by root ordinal so every
# D-15 sweep needle, the production-scoped status literal, the kind needle and three 409/411
# needles each get at least one plant in a REAL package. Each line spells exactly ONE needle
# (410 Row 7: a line spelling two reds two cells), so ALLOWED equals REQUIRED for every plant.
#
# Entries 5 and 6 are the two shelf spellings and must reach the plant file as EXACT BYTES:
# entry 5 carries a bare delimiter either side of `issues/`, entry 6 carries a BACKSLASH before
# each delimiter (the form the scaffold spelled inside a template literal). Inside single quotes
# bash treats both the backslash and the delimiter literally, so neither entry may ever be
# rewritten as a double-quoted string and neither backslash may ever be doubled — the two needles
# are distinguished by exactly that one byte, and a plain-delimiter needle cannot see the escaped
# form.
PLANT_LINES=(
  '// 412 plant: triage-issues'
  '// 412 plant: issue-curation'
  '// 412 plant: issues-write'
  '// 412 plant: filed issues'
  '// 412 plant: `issues/`'
  '// 412 plant: \`issues/\`'
  '// 412 plant: the issues/ shelf'
  '// 412 plant: Issue milestone'
  '// 412 plant: the BUG kind'
  "const planted = 'reserved'"
  '// 412 plant: FindingRoute'
  '// 412 plant: IssueId'
)

PLANT_TITLES=(
  'no source or test spells the reserved sixth job kind'
  "no source or test spells the deleted curation spec's citation"
  'no source or test spells the anticipated scope door'
  "no source or test spells the scaffolded README's filed-issues promise"
  'no source or test spells the scaffolded issues shelf, backticked'
  'no source or test spells the scaffolded issues shelf, template-escaped'
  'no source or test spells the scaffolded issues shelf, spoken'
  'no source or test spells the Issue-milestone attribution'
  'no source or test spells the retired entity kind'
  'no production source spells the retired status literal'
  'no source or test spells the retired route interface'
  'no source or test spells the third id brand'
)

PLANT_ROTATION=12

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
#
# Every instrument any leg will drive, run once on the committed tree. Two failures this catches
# that no leg could: a suite that was ALREADY red, whose red a leg would then read as its own
# measurement; and a stale `dist` between a subject and a cell, which turns a live mutation into a
# green. The dists are rebuilt in dependency order first — schema, then agent, then agent-local —
# because each resolves its predecessor through built output.
PREFLIGHT_COUNT=0

preflight_suite () {
  local filter="$1" suite="$2"
  set +e
  pnpm --filter "$filter" exec vitest run "$suite" > "$LOG" 2>&1
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: already red before any mutation: $suite (filter $filter, exit $rc)" >&2
    exit 1
  fi
  echo "  preflight green: $filter $suite"
  PREFLIGHT_COUNT=$((PREFLIGHT_COUNT + 1))
}

preflight_typecheck () {
  local filter="$1"
  set +e
  pnpm --filter "$filter" typecheck > "$LOG" 2>&1
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: already red before any mutation: typecheck (filter $filter, exit $rc)" >&2
    exit 1
  fi
  echo "  preflight green: $filter typecheck"
  PREFLIGHT_COUNT=$((PREFLIGHT_COUNT + 1))
}

echo "=== PREFLIGHT — every instrument must be green before any subject is touched"
build_package "$SCHEMA_FILTER"
build_package "$AGENT_FILTER"
build_package "$LOCAL_FILTER"
echo "  dists rebuilt in dependency order: schema, agent, agent-local"

preflight_suite "$ARCH_FILTER" "$CENSUS"

preflight_suite "$AGENT_FILTER" "src/jobs/__tests__/kind-registry.test.ts"
preflight_suite "$AGENT_FILTER" "src/jobs/__tests__/real-kinds.test.ts"
preflight_suite "$AGENT_FILTER" "src/jobs/__tests__/engine-semantics.test.ts"
preflight_suite "$AGENT_FILTER" "src/jobs/__tests__/chain-identity.test.ts"
preflight_suite "$AGENT_FILTER" "src/functions/ops/__tests__/runs-post-processing.test.ts"
preflight_suite "$AGENT_FILTER" "src/functions/__tests__/authoring-draft-write.stop.test.ts"
preflight_suite "$AGENT_FILTER" "src/authoring/__tests__/router.test-d.ts"
preflight_suite "$AGENT_FILTER" "src/authoring/__tests__/loop.test-d.ts"

preflight_suite "$LOCAL_FILTER" "src/__tests__/chain-terminal-notify.test.ts"

preflight_suite "$CLI_FILTER" "src/__tests__/post-run-enqueue-idempotency.test.ts"

preflight_suite "$SCHEMA_FILTER" "src/__tests__/delta-kinds.test.ts"
preflight_suite "$SCHEMA_FILTER" "src/__tests__/proposal-envelope.test.ts"
preflight_suite "$SCHEMA_FILTER" "src/entity/__tests__/410-five-entity-kinds.test.ts"
preflight_suite "$SCHEMA_FILTER" "src/functions/__tests__/authoring-loop-outcomes.test.ts"
preflight_suite "$SCHEMA_FILTER" "src/authoring/__tests__/funnel.test-d.ts"

preflight_suite "@vostride/agent-qa-knowledge-local" "src/resolver/__tests__/corpus.test.ts"

preflight_typecheck "$SCHEMA_FILTER"

echo "PREFLIGHT OK ($PREFLIGHT_COUNT instruments)"
echo

# ── The legs, cheapest first ──────────────────────────────────────────────────────────────────

# 412 Rows P-<pkg> / CLSR-01 — the census names the package it accuses, in EVERY package.
#
# The roots are discovered FROM DISK by the census's own rule (a package with a `src/`), never a
# pinned list: a list drifts the day a package is added, and the leg that would have proved the
# census reaches that package silently would not exist. Legs run strictly sequentially — one plant
# file exists at a time, `run_leg`'s pre-existence gate FATALs if the path is already there, and
# the EXIT trap removes any plant on an abnormal exit. Two concurrent runs are NOT supported; that
# gate is what makes the collision visible instead of silent.
ROOTS=0
for dir in packages/*/; do
  [ -d "$dir/src" ] || continue
  ROOTS=$((ROOTS + 1))
done
if [ "$ROOTS" -lt "$PLANT_ROTATION" ]; then
  echo "FATAL: $ROOTS package roots with a src/, fewer than the $PLANT_ROTATION plant lines —" >&2
  echo "       a rotation shorter than its table leaves a needle with no real-tree plant" >&2
  exit 1
fi
echo "PLANT ROOTS $ROOTS"
echo

PLANT_ORDINAL=0
for dir in packages/*/; do
  [ -d "$dir/src" ] || continue
  PLANT_INDEX=$((PLANT_ORDINAL % PLANT_ROTATION))
  plant_leg "$(basename "$dir")" "${PLANT_LINES[$PLANT_INDEX]}" "${PLANT_TITLES[$PLANT_INDEX]}"
  PLANT_ORDINAL=$((PLANT_ORDINAL + 1))
done

# D-03 positive control / 410 Row 8 half (b) — the plant lands under `__tests__`, so it is IN
# `SOURCES` and OUT of `PRODUCTION_SOURCES`. The by-name control REDs on a third non-production
# speller while the production cell stays GREEN, and that the blast radius is exactly one cell is
# what proves the split is a path rule rather than a filter that measures nothing.
C01_CELL='names exactly the two migration fixtures that spell the retired status literal outside production'
PLANT_PATH="packages/schema/src/__tests__/412-plant.ts"
PLANT_LINE="const planted = 'reserved'"
run_leg C-01 "the retired status literal planted OUTSIDE production" runtime \
  "$C01_CELL" "$C01_CELL" "$ARCH_FILTER" "$CENSUS" "" "" "$PLANT_PATH"

# 411 Row 10 / the funnel path rule, leg IN — the plant path matches `FUNNEL_RULE`
# (`…/src/authoring/funnel*`), so the funnel-scoped cell REDs. The same key in any other file is
# ordinary English the rule refuses, which is the other direction 411 Row 10 measured.
C02_CELL='no funnel file spells the retired side-counter key'
PLANT_PATH="packages/schema/src/authoring/funnel-412-plant.ts"
PLANT_LINE="// findings: 0"
run_leg C-02 "a side-counter key planted in a funnel-scoped file" runtime \
  "$C02_CELL" "$C02_CELL" "$ARCH_FILTER" "$CENSUS" "" "" "$PLANT_PATH"

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

# ── The 409 legs ──────────────────────────────────────────────────────────────────────────────
#
# Every REQUIRED and ALLOWED string below is TRANSCRIBED VERBATIM from the row that measured it
# (409-MUTATION-LEDGER.md). Two transcription rules the ledger states explicitly and this script
# obeys: an ALLOWED set is a MEASUREMENT, not a prediction — a red the ledger recorded without
# predicting it stays in the set, and a red RESEARCH predicted but the ledger measured GREEN stays
# out; and a title that exists only UNDER the mutation (J-01's generated `it.each` row) stays in
# ALLOWED as a literal string even though the kind it names is not in the tree. This script's
# ALLOWED means "the whole permitted red set", so where a ledger row writes "ALLOWED: none" the
# list here is the REQUIRED set itself — nothing besides the named cells may be red.

# 409 Row 5 / the DELTA_KINDS cast (the runtime wall beside Row 4).
V02_REQUIRED='declares exactly the six §7.3 delta kinds, in declaration order'
V02_ALLOWED="$V02_REQUIRED"
run_leg V-02 "a seventh DELTA_KINDS member smuggled past the satisfies clause by a cast" runtime \
  "$V02_REQUIRED" "$V02_ALLOWED" "$SCHEMA_FILTER" "src/__tests__/delta-kinds.test.ts" "" \
  "packages/schema/src/delta/delta.ts" ""

# 409 Rows 10-13 / VOCB-01 + VOCB-02 — the whole-vocabulary readmission (D-05).
#
# D-05 words this as "five `git show 9b0c3459:<path>` restores". It is applied here as FOUR
# restores plus a three-line barrel hunk, because `packages/schema/src/index.ts` moved under 410
# and 411: a whole-file restore would readmit 411's deleted finding schemas and drop the stop-arm
# exports, which is a broken tree and a blast radius rather than a measurement (Pitfall 1). The
# four subjects are still byte-identical to the 409 baseline, so their restores are verbatim.
#
# THIS is the leg that carries VOCB-01. V-01 above widens the SURVIVING six-arm `Delta` and guards
# it — the 409 ledger corrected that attribution after verification, and under this complete
# readmission both of Row 4's `never` bars stay GREEN.
V03_REQUIRED="no source or test spells the second delta vocabulary
no source or test spells the second delta vocabulary's module
no source or test spells the third id brand
no source or test spells the third id brand's cast helper"
V03_ALLOWED="$V03_REQUIRED"
run_leg V-03 "the whole deleted delta vocabulary and id brand readmitted from the phase baseline" runtime \
  "$V03_REQUIRED" "$V03_ALLOWED" "$ARCH_FILTER" "$CENSUS" "" \
  "packages/schema/src/delta/index.ts
packages/schema/src/ids/record-id.ts
packages/schema/src/ids/index.ts
packages/schema/src/index.ts" \
  "packages/schema/src/delta/issue-delta.ts"

# 409 Row 2 / JOBK-02 — the successor list. Declared now equals produced, so one second successor
# moves all six cells the row recorded; RESEARCH predicted a seventh (kind-registry's topology
# cell) and the ledger measured it GREEN, so it is deliberately absent from ALLOWED.
J02_REQUIRED="declares curate-memory as the one allowed successor of analyze-run
chains analyze-run into its declared successors"
J02_ALLOWED="$J02_REQUIRED
keeps the scripted stand-ins when no capabilities are bound
returns exactly one curate-memory instance from a successful analysis
returns exactly one curate-memory continuation from a permanently failed analysis
proceeds with unknown verdicts, and only into curate-memory, when analyze-run permanently fails"
run_leg J-02 "a second successor declared for analyze-run" runtime \
  "$J02_REQUIRED" "$J02_ALLOWED" "$AGENT_FILTER" \
  "src/jobs/__tests__/real-kinds.test.ts src/jobs/__tests__/engine-semantics.test.ts src/jobs/__tests__/kind-registry.test.ts" \
  "" "packages/agent/src/jobs/kinds.ts" ""

# 409 Row 1 / JOBK-01 — schema-only rebuild; the AGENT MUST NOT BE REBUILT.
#
# The rebuild rule is load-bearing in BOTH directions and is the one row in the ledger where a
# rebuild is FORBIDDEN rather than required (409 note (d)): schema must be rebuilt because
# `CONTRACT_JOB_KINDS` reads the enqueue contract through `schema/dist`, and agent must not be,
# because `kinds.ts`'s `satisfies Record<JobKind, JobKindDeclaration>` would fail the agent DTS
# build under a six-member union and FATAL the leg before any cell runs — a build failure is not a
# red cell. vitest transforms the agent test sources without typechecking them, so the runtime
# cells are reached.
#
# `declares triage-issues` is an `it.each` row GENERATED from the MUTATED contract at run time; it
# stays in ALLOWED as a literal string even though the kind is not in the tree (D-07).
J01_REQUIRED='reads exactly the five shipped kinds out of the enqueue contract, by sorted list'
J01_ALLOWED="$J01_REQUIRED
declares triage-issues
registers every contract kind and nothing else"
run_leg J-01 "a sixth kind re-added to the enqueue contract" runtime \
  "$J01_REQUIRED" "$J01_ALLOWED" "$AGENT_FILTER" "src/jobs/__tests__/kind-registry.test.ts" \
  "$SCHEMA_FILTER" "packages/schema/src/job/job.ts" ""

# 409 Row 3 / JOBK-03 — one mutation, three instruments, three independent cycles (the Row 7/8
# precedent). `tsc` is SILENT on a third key — both rebuild filters exited 0 under the mutation,
# so the widening reaches every cell as a runtime change and these are the only wall there is.
#
# The rebuild order is load-bearing twice over: agent-local resolves the agent through `dist` and
# the cli resolves BOTH through `dist`, so leg (c) reads a stale derivation if either build is
# skipped. Agent then agent-local, in that order, before the mutated run and again after the
# restore. `$CLI_FILTER` is `agent-qa`, not `@vostride/agent-qa-cli` — a filter that matches no
# project exits 0 without running anything, which is a green that measures nothing (407-25 D-5).
J03_SUBJECT="packages/agent/src/jobs/chain-identity.ts"
J03_REBUILD="$AGENT_FILTER $LOCAL_FILTER"

J03A_REQUIRED="derives exactly two chain ids, keyed analyzeRun and curateMemory
lets every derived chain kind land the terminal — the terminal list equals the derived kind set"
# The port cell is recorded ALLOWED but the ledger calls it a valid optional REQUIRED, promotable
# without re-measuring (409 note (e)); it is left where the row put it.
J03A_ALLOWED="$J03A_REQUIRED
derives two distinct ids whose successor key is built from the head id
asks the port for exactly the two ids chainJobIdsForRun derives"
run_leg J-03a "a third derived chain id, read in the agent package" runtime \
  "$J03A_REQUIRED" "$J03A_ALLOWED" "$AGENT_FILTER" \
  "src/jobs/__tests__/chain-identity.test.ts src/functions/ops/__tests__/runs-post-processing.test.ts" \
  "$J03_REBUILD" "$J03_SUBJECT" ""

J03B_REQUIRED="drives enqueue -> analyze-run -> curate-memory -> exactly one notification row
notifies honestly when the analysis died and curation carried on"
J03B_ALLOWED="$J03B_REQUIRED"
run_leg J-03b "the same third id, read across the agent -> agent-local dist boundary" runtime \
  "$J03B_REQUIRED" "$J03B_ALLOWED" "$LOCAL_FILTER" "src/__tests__/chain-terminal-notify.test.ts" \
  "$J03_REBUILD" "$J03_SUBJECT" ""

J03C_REQUIRED='produces exactly one analyze-run job, and the second run dedupes rather than errors'
J03C_ALLOWED="$J03C_REQUIRED"
run_leg J-03c "the same third id, read by the cli through both dists" runtime \
  "$J03C_REQUIRED" "$J03C_ALLOWED" "$CLI_FILTER" \
  "src/__tests__/post-run-enqueue-idempotency.test.ts" \
  "$J03_REBUILD" "$J03_SUBJECT" ""

echo "LEGS $LEGS_RUN"
echo "PASS — a needle planted in EVERY package with a src/ REDs the merged census by that package's"
echo "       own file name, each plant is removed and the tree is byte-clean afterwards, the census"
echo "       is green again before the next leg starts, the retired status literal planted outside"
echo "       production REDs the by-name control alone while the production cell stays green, a"
echo "       side-counter key planted in a funnel-scoped file REDs the funnel cell alone, a re-added"
echo "       funnel side-counter key fails the keyof pin as ONE failed suite with exactly one type"
echo "       error, and a seventh arm widened onto the surviving Delta union cannot compile past"
echo "       the retained never bar. And of the 409 ledger: a seventh delta kind smuggled past the"
echo "       satisfies clause by a cast REDs the runtime projection cell the type wall cannot see;"
echo "       the WHOLE deleted delta vocabulary and id brand, readmitted from the phase baseline"
echo "       into a tree that still compiles, REDs exactly the four census cells that name them;"
echo "       a second declared successor for analyze-run REDs the successor cells and nothing in"
echo "       the registry; a sixth kind re-added to the enqueue contract REDs the sorted-list cell"
echo "       with the schema alone rebuilt; and a third derived chain id REDs by name at all three"
echo "       distances — in the agent, across the agent-local dist, and through both dists in the"
echo "       cli — with every subject restored byte-identically after each cycle."
