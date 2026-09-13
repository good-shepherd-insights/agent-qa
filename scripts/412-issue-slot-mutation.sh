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
# red) — a mutation that reds half the package is measuring blast radius, not the property. Neither
# is ever matched against a test COUNT: several mutations grow the total by generating cells that
# exist only under the mutation.
#
# ALLOWED is a per-line SUBSTRING match — deliberately, because three legs name a bare file path
# that must cover both a suite line and a pointer line. REQUIRED is a per-line match ANCHORED AT
# THE LINE END, which is stricter and must be: matched as a substring of the whole multi-line red
# blob, a cell whose title is a strict PREFIX of another cell's title is satisfied by that other
# cell's red, and a leg naming four cells passes when two redden. The comparator is exercised
# against leg V-03's own four titles at startup, in both directions.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# FAIL-FAST, AND THE TREE IS NEVER LEFT DIRTY. Every FATAL exits through ONE `fatal` helper, and
# that helper does the same four things in the same order every time: it restores every subject
# from its byte snapshot, PROVES the restore by comparing the full sha256 digest of each subject
# against its snapshot, proves every path the leg created is gone, rebuilds the same filters and
# exits 1. The proof runs on the abnormal exit exactly as it runs on success — CLSR-02 states that
# guarantee unconditionally, and a guarantee that holds only when the leg passed is the one that is
# absent at the single moment it is needed: a leg that failed with retired vocabulary live on disk.
# A SIGINT, SIGTERM or SIGHUP routes into that same helper — the trap is on INT/TERM/HUP — so a
# Ctrl-C mid-run is restored, proved and rebuilt exactly as a FATAL is, rather than abandoning a
# mutated tree; the EXIT trap remains behind both as the last-resort cleanup. There is no LEG
# selector and no run-all-and-report mode: a selector that runs nothing is a green script (D-09).
#
# USAGE
#   pnpm validate:issue-slot-mutation                   # from the agent-qa root
#   bash agent-qa/scripts/412-issue-slot-mutation.sh    # from the super-repository root
#
# KNOBS
#   ISSUE_SLOT_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation" — a gate nobody has seen fire is a comment.
#
# AND EVERY GATE THE CRITERION RESTS ON IS DRIVEN IN ITS FAILING DIRECTION AT STARTUP, before any
# subject is touched — the sha256 comparator, the line-exact REQUIRED comparator and the three
# restore/verify failure branches. Each prints the refusal it just performed, and the run FATALs
# if any of them has stopped being able to fail. The knob above is the same doctrine applied to
# the bar as a whole; this is it applied to the bar's own instruments.

# LEG INDEX — every leg, the ledger row it transcribes, the instrument that reads it, and whether
# it crosses a `dist`. This block is the register's transcription source (CLSR-03): the instruments
# table is copied from here rather than re-derived from the ledgers, so the bar and the register
# cannot drift into two accounts of the same measurement.
#
#   <id>  <phase> Row N / <requirement or wall>  <instrument>  <rebuild or none>
#
#   P-<pkg>  412 D-04 / CLSR-01, one leg per package root discovered from disk (23 today)  arch census  none
#            twelve plant lines rotated by root ordinal: triage-issues · issue-curation · issues-write ·
#            filed issues · the backticked issues shelf · the template-escaped issues shelf · the spoken
#            issues shelf · Issue milestone · the BUG kind · the quoted status literal (production cell) ·
#            FindingRoute · IssueId — each spelling exactly ONE needle (410 Row 7)
#   C-01  410 Row 8 half (b) / the D-03 by-name control, planted OUTSIDE production  arch census  none
#   C-02  411 Row 10 leg IN / the funnel path rule  arch census  none
#   W-06  411 Row 8 / the funnel keyof pin  schema funnel.test-d.ts (testd)  none
#   V-01  409 Row 4 / the SURVIVING Delta union's never bar (NOT VOCB-01 — D-05)  schema typecheck  none
#   V-02  409 Row 5 / the DELTA_KINDS cast, the runtime wall beside Row 4  schema delta-kinds.test.ts  none
#   V-03  409 Rows 10-13 / VOCB-01 + VOCB-02, the whole-vocabulary readmission  arch census  none
#   J-02  409 Row 2 / JOBK-02, a second declared successor  agent real-kinds + engine-semantics + kind-registry  none
#   J-01  409 Row 1 / JOBK-01, a sixth kind on the enqueue contract  agent kind-registry.test.ts  schema ONLY (agent MUST NOT be rebuilt)
#   J-03a  409 Row 3 / JOBK-03, RETARGETED by 422 D-13 — instrument (a)  agent chain-identity +
#            runs-post-processing  agent then agent-local
#   J-03b  409 Row 3 / JOBK-03, RETARGETED by 422 D-13 — instrument (b)  agent-local
#            chain-terminal-notify.test.ts  agent then agent-local
#   J-03c  409 Row 3 / JOBK-03, RETARGETED by 422 D-13 — instrument (c)  cli
#            post-run-enqueue-idempotency.test.ts  agent then agent-local
#   E-01  410 Row 1 / ENTY-03, the sixth kind in the ARRAY  schema 410-five-entity-kinds.test.ts  none
#   E-02  410 Row 2 / the cast smuggle on the two kinds.ts tables  same suite + a live schema typecheck (exit 0)  none
#   E-03  410 Row 3 / the cast smuggle on the two entity-card.ts tables  same suite + a live schema typecheck (exit 0)  none
#   E-04  410 Row 4 / the cast smuggle on ENTITY_DASHBOARD_ROUTES  same suite + a live schema typecheck (exit 0)  none
#   E-05  410 Row 5 / the retired no-match reason  same suite  none
#   E-06  410 Row 6 / the retired corpus category  knowledge-local corpus.test.ts  none
#   W-02  411 Row 2 / the loop outcome vocabulary  schema authoring-loop-outcomes.test.ts  none
#   W-01  411 Row 1 / WTST-09, the runtime exact-list pin  schema proposal-envelope.test.ts  none
#   W-01t  411 Row 1 / WTST-09, the ALLOWED second instrument (D-06)  schema typecheck  none
#   W-04  411 Row 4 / the StopRoute keyof pin  agent router.test-d.ts (testd)  none
#   W-05  411 Row 5 / the stopped-arm keyof pin  agent loop.test-d.ts (testd)  none
#   W-03  411 Row 3 / WTST-11, a put re-added on the stopped arm  agent authoring-draft-write.stop.test.ts  schema, before the mutated run AND before the restored run
#
# THE ROWS THIS SCRIPT DOES NOT ENCODE, AND WHAT STANDS IN THEIR PLACE. A bar that silently drops a
# row is a bar that measures less than it claims, so each omission is named with its reason and its
# standing instrument:
#
#   410 Rows 9-11  the three dist-crossing readmissions of the sixth kind — mcp's five-template
#                  pins, cli's parity URL-ABSENT arm across TWO dist boundaries, the dashboard's
#                  unrouted-kind link count — SKIPPED by D-06 (each needs a whole-package rebuild
#                  chain to measure what E-01 already REDs at its source).
#   409 Rows 6-8   the eleventh crash point (the kill matrix), the poison job's bound and the
#                  engine-semantics bound cell over consolidate — SKIPPED: they measure engine
#                  bounds rather than a set that got smaller, which is what this bar is for.
#   411 Rows 6-7   legs A and B of the 394 script — `pnpm validate:router-mutation` REMAINS their
#                  instrument (23 s, PASS at the 411 gate). Re-encoding them here would give one
#                  property two owners.
#
# D-05'S TWO-INSTRUMENT READING OF VOCB-01, AS MEASURED. The requirement is carried by V-03, the
# whole-vocabulary readmission: under it the schema still compiles (the coherence gate proves exit
# 0) and the census REDs exactly the four cells that name the deleted vocabulary. V-01 does NOT
# carry VOCB-01 — `delta.ts` is byte-identical across the whole deletion, so what its retained
# `never` bars guard is the SURVIVING six-arm union against a future widening. And D-05's wording
# ("five `git show 9b0c3459:<path>` restores") is applied as FOUR restores plus a three-line barrel
# hunk, because `packages/schema/src/index.ts` moved under 410 and 411: a whole-file restore would
# readmit 411's deleted finding schemas and drop the stop-arm exports — a blast radius rather than
# a measurement. That deviation is recorded here because the register transcribes this block.

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

# Byte-identity, and nothing weaker. The criterion says sha256 by name, so this compares the FULL
# hex digest of both files, hashed at call time — never a size, never an mtime, never a truncated
# digest, and never `cmp` (which the landed gate already uses for a different question). Two files
# that differ by one byte must compare non-equal, and the self-check below drives exactly that.
# A missing file hashes to the empty string; the `-n` guard stops two missing files comparing equal.
same_bytes () {
  local a b
  a="$(shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1)" || true
  b="$(shasum -a 256 "$2" 2>/dev/null | cut -d' ' -f1)" || true
  [ -n "$a" ] && [ "$a" = "$b" ]
}

# required_line_match <fragment> <red-blob> — is this named cell among the reds?
#
# PER RED LINE, AND ANCHORED AT THE LINE END. A substring match against the whole multi-line blob
# reports MATCHED for a fragment that is a strict PREFIX of some other cell's title, so a leg naming
# four cells passes when only the two longer ones redden — the defect 412-VERIFICATION reproduced
# against leg V-03, whose set holds two such pairs.
#
# The suffix is the right anchor, not full-line equality: the runtime red-parser strips the
# ` FAIL  <suite> > ` prefix but leaves the describe block, so a red line reads `<describe> > <title>`
# while a REQUIRED fragment is the title alone. It is also correct for the other two parsers, whose
# fragments are whole `grep -oE` outputs — the typecheck diagnostic and the testd pointer — and
# therefore already whole lines, which an end anchor with a left wildcard still matches.
required_line_match () {
  local fragment="$1" line
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in
      *"$fragment") return 0 ;;
    esac
  done <<< "$2"
  return 1
}

# Newline-separated, never associative arrays: /bin/bash here is 3.2.57.
CURRENT_SUBJECTS=""
CURRENT_CREATED=""
# The leg's rebuild filters, readable from `fatal` — a FATAL rebuilds the same filters the success
# path rebuilds, and it cannot read `run_leg`'s locals.
CURRENT_REBUILD=""
# `fatal`'s re-entry guard: a failure DURING cleanup, or a second interrupt, must exit rather than
# start the cleanup over.
FATAL_ACTIVE=0

# A COPY THAT DID NOT HAPPEN MUST NEVER BE REPORTED AS ONE THAT DID. `cp`'s own diagnostic reaches
# stderr and a non-zero status is FATAL: the whole guarantee rests on this copy, and the moment it
# is most needed is the moment a leg failed with retired vocabulary live on disk. The created paths
# are only `rm -f`'d here; a path that survives the leg is caught by the byte-identity proof below.
#
# This function exits DIRECTLY rather than through the `fatal` helper, because that helper calls
# this one and a call back would recurse forever. An `exit` taken from inside the EXIT trap does
# not re-enter the trap, so exiting directly is safe on the trap path too.
restore_current () {
  local p
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if ! cp "$(snapshot_path "$p")" "$REPO_ROOT/$p"; then
      echo "FATAL: could not restore $p from its byte snapshot" >&2
      exit 1
    fi
  done <<< "$CURRENT_SUBJECTS"
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    rm -f "$REPO_ROOT/$p"
  done <<< "$CURRENT_CREATED"
}

# The byte-identity proof, hoisted out of the success path so the six FATAL paths reach the same
# implementation. One implementation, two callers: a success and a failure cannot diverge into two
# accounts of the same guarantee. It prints its own FATAL and exits DIRECTLY rather than calling
# `fatal` — `fatal` calls this, so a call back would recurse.
verify_restored () {
  local p restored
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if ! same_bytes "$REPO_ROOT/$p" "$(snapshot_path "$p")"; then
      restored="$(shasum -a 256 "$REPO_ROOT/$p" 2>/dev/null | cut -d' ' -f1)" || true
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
}

# THE LEG'S CLOSE-OUT, and there is exactly one of it. Restore, PROVE the restore, then rebuild —
# in that order, which differs from the old success-path order deliberately: byte-identity is
# asserted before anything else runs, so a rebuild failure cannot mask an unrestored subject.
# Both callers — the success path and the FATAL path — come through here, so a leg that passed and
# a leg that failed cannot diverge into two accounts of the same guarantee.
close_leg () {
  restore_current
  verify_restored
  local f
  for f in $CURRENT_REBUILD; do build_package "$f"; done
}

# THE ONE FATAL EXIT. Message first (a reader of the log sees the reason before the cleanup), then
# the same close-out the success path takes, then exit 1.
# `build_package` keeps its own inline failure handling and must NOT be routed through here —
# the close-out calls `build_package`.
fatal () {
  echo "FATAL: $1" >&2
  if [ "$FATAL_ACTIVE" = 1 ]; then
    exit 1
  fi
  FATAL_ACTIVE=1
  close_leg
  exit 1
}

trap 'restore_current; rm -rf "$WORK"' EXIT
# AN INTERRUPT IS AN EXIT PATH LIKE ANY OTHER. A Ctrl-C at minute six of the ~435 s run would
# otherwise abandon a mutated tree, so the signal routes into the SAME helper a FATAL takes: the
# same restore, the same sha256 proof, the same rebuild. That makes the first interrupt
# deliberately slow — it restores and rebuilds before it goes — and a second interrupt hits the
# re-entry guard and exits at once. Bash defers a trap until the foreground child returns, so an
# interrupt during a build or a suite lands when that child finishes rather than instantly.
trap 'fatal "interrupted by signal — restoring every subject from its byte snapshot before exit"' INT TERM HUP

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
      # 409 Row 2's diff. `consolidate` is chosen deliberately: it is a REGISTERED kind, so the
      # registry's own `declares only successors that are themselves registered` validation stays
      # out of the blast and the reds that remain are the successor-list cells.
      #
      # 2026-09-12 (422-23): THE ANCHOR MOVED, THE MEASUREMENT DID NOT. 422-22 restated this
      # constant as `as const satisfies readonly JobKind[]` so the literal edge survives into the
      # type, which left the 409 spelling matching nothing — and an edit that matches nothing is a
      # leg that measures the ABSENCE of the mutation. The anchor is re-transcribed from the
      # shipped line; the six cells the row recorded were RE-MEASURED under the new anchor and are
      # the same six, so REQUIRED and ALLOWED below are untouched.
      perl -0pi -e "s/\Qconst ANALYZE_RUN_SUCCESSORS = ['curate-memory'] as const satisfies readonly JobKind[]\E/const ANALYZE_RUN_SUCCESSORS = ['curate-memory', 'consolidate'] as const satisfies readonly JobKind[]/" \
        "$REPO_ROOT/packages/agent/src/jobs/kinds.ts" ;;
    J-01)
      # 409 Row 1's diff, verbatim — TWO lines, because both declarations spell the one set and
      # re-adding the member to `jobKindValues` alone violates `satisfies readonly JobKind[]`.
      perl -0pi -e "s/\Q  | 'curate-memory'\E\n/  | 'curate-memory'\n  | 'triage-issues'\n/; s/\Q  'curate-memory',\E\n/  'curate-memory',\n  'triage-issues',\n/" \
        "$REPO_ROOT/packages/schema/src/job/job.ts" ;;
    J-03a|J-03b|J-03c)
      # 409 Row 3's diff, RETARGETED — one mutation measured at three distances, the Row 7/8
      # precedent. The interface widening and the derivation must move together or the object
      # literal no longer satisfies `ChainJobIds`.
      #
      # 2026-09-12 (422-23, D-13): THE ROW MOVED, SO THE MUTATION MOVED WITH IT. Phase 409 took the
      # chain from three derived ids to two, and this leg proved a THIRD id was refused. Phase 422
      # D-13 authorised a third — `proposeImprovements`, keyed transitively from the curate-memory
      # id — so re-adding a third here would now be re-adding a LEGAL one, and the leg would be
      # measuring the tree's disagreement with itself rather than a wall. The leg therefore injects
      # a FORBIDDEN FOURTH id. Two properties of the injection are load-bearing:
      #
      #   * the kind is `consolidate`, a REGISTERED kind, so the agent's `dts` build still compiles
      #     under the mutation and the leg reaches a red CELL rather than a build failure (the 409
      #     note (d) lesson, applied in the opposite direction);
      #   * the new member is appended AFTER `proposeImprovements`, so the three legal ids are still
      #     asked for in their shipped order and the extra ask is the only difference the cells see.
      #
      # The second anchor deliberately carries no `$`: the shipped derivation spells its successor
      # key as a template literal, and a pattern quoting `${String(curateMemory)}` would have to
      # escape perl's own interpolation in the SEARCH half as well as the replacement half — a
      # second place for a silently non-matching edit to hide (410 Row 5's recorded trap).
      perl -0pi -e 's/\n  readonly proposeImprovements: JobId\n\}/\n  readonly proposeImprovements: JobId\n  readonly admitProposals: JobId\n}/;
                    s/->propose-improvements`,\n    \),\n  \}/->propose-improvements`,\n    ),\n    admitProposals: idSource.jobIdFor(\x27consolidate\x27, `\${String(curateMemory)}->consolidate`),\n  }/' \
        "$REPO_ROOT/packages/agent/src/jobs/chain-identity.ts" ;;
    W-06)
      # 411 Row 8's diff, verbatim. OPTIONAL on purpose: a required key would red the producers
      # and the leg would measure the compiler's required-field check instead of the counter bar.
      perl -0pi -e "s/\Q  readonly dedupRefusals?: number\E\n/  readonly dedupRefusals?: number\n  readonly findings?: number\n/" \
        "$REPO_ROOT/packages/schema/src/authoring/funnel.ts" ;;
    E-01)
      # 410 Row 1's diff, verbatim: the sixth kind back in its pre-phase position, between 'RUN'
      # and 'MEM'. The five `satisfies`-total tables are UNTOUCHED, so their key sets are still
      # exactly five and the ARRAY cell is the only red. The type wall the row recorded beside
      # this edit — schema `typecheck` exit 2 with 14 `error TS` lines, five of them TS1360 at
      # kinds.ts:36, kinds.ts:58, entity-card.ts:41, entity-card.ts:83 and dashboard-route.ts:72 —
      # is an OBSERVATION WITH A COUNT in the ledger, not a per-diagnostic ALLOWED set, so it is
      # recorded in this comment and not encoded as a second instrument (D-07).
      perl -0pi -e "s/\Qexport const ENTITY_KINDS = ['TST', 'RUN', 'MEM', 'POL', 'TGT'] as const\E/export const ENTITY_KINDS = ['TST', 'RUN', 'BUG', 'MEM', 'POL', 'TGT'] as const/" \
        "$REPO_ROOT/packages/schema/src/entity/kinds.ts" ;;
    E-02)
      # 410 Row 2's diff, verbatim — one `Object.assign` line appended directly after each table's
      # closing `satisfies` line, the array left untouched. `as Record<string, unknown>` is a legal
      # widening and `Object.assign` is a legal call, so the compiler has NO OPINION about the
      # smuggled row: `assert_schema_typecheck_green` runs while this is live and requires exit 0.
      # The assign sits after the table and before `SEGMENT_TO_KIND`, which maps over the
      # still-five-member `ENTITY_KINDS`, so no derived table reds.
      perl -0pi -e "s/\Q} as const satisfies Record<EntityKind, string>\E\n/} as const satisfies Record<EntityKind, string>\nObject.assign(ENTITY_URI_SEGMENTS as Record<string, unknown>, { BUG: 'bug' })\n/" \
        "$REPO_ROOT/packages/schema/src/entity/kinds.ts"
      perl -0pi -e "s/\Q} as const satisfies Record<EntityKind, boolean>\E\n/} as const satisfies Record<EntityKind, boolean>\nObject.assign(SLUG_ADDRESSED_ENTITY_KINDS as Record<string, unknown>, { BUG: false })\n/" \
        "$REPO_ROOT/packages/schema/src/entity/kinds.ts" ;;
    E-03)
      # 410 Row 3's diff, verbatim. The same idiom on a table whose value type is a NON-EMPTY
      # TUPLE rather than a primitive — worth its own leg because the cast erases the tuple
      # constraint exactly as completely as it erases `string`, and the compiler stays green.
      perl -0pi -e "s/\Q} as const satisfies Record<EntityKind, readonly [string, ...string[]]>\E\n/} as const satisfies Record<EntityKind, readonly [string, ...string[]]>\nObject.assign(ENTITY_STATUSES as Record<string, unknown>, { BUG: ['reserved'] })\n/" \
        "$REPO_ROOT/packages/schema/src/entity/entity-card.ts"
      perl -0pi -e "s/\Q} as const satisfies Record<EntityKind, string>\E\n/} as const satisfies Record<EntityKind, string>\nObject.assign(ENTITY_IDENTITY_FACT_LABELS as Record<string, unknown>, { BUG: 'reserved address' })\n/" \
        "$REPO_ROOT/packages/schema/src/entity/entity-card.ts" ;;
    E-04)
      # 410 Row 4's diff, verbatim — the most pointed of the three cast rows: the smuggled value is
      # a whole `EntityDashboardRoute`-shaped object, so the row is not merely type-erased, it is a
      # fully plausible sixth route the compiler has no opinion about at all.
      perl -0pi -e "s/\Q} as const satisfies Record<EntityKind, EntityDashboardRoute>\E\n/} as const satisfies Record<EntityKind, EntityDashboardRoute>\nObject.assign(ENTITY_DASHBOARD_ROUTES as Record<string, unknown>, { BUG: { route: null, keyedBy: 'unrouted' } })\n/" \
        "$REPO_ROOT/packages/schema/src/entity/dashboard-route.ts" ;;
    E-05)
      # 410 Row 5's diff, verbatim — and Row 5's RECORDED TRAP, obeyed: the anchor spans two lines,
      # so each line is quoted separately and the `\n` sits OUTSIDE `\Q…\E`. A `\Q…\E` that quotes
      # the newline never matches, the file is left untouched, and the leg would read a green that
      # measures the ABSENCE of the mutation (the landed gate above is the other half of that
      # lesson). The enum only WIDENS here, so there is no compile wall in either direction and the
      # runtime cell is the only instrument that exists.
      perl -0pi -e "s/\Q  'unknown-address',\E\n\Q  'no-match',\E\n/  'unknown-address',\n  'reserved-kind',\n  'no-match',\n/" \
        "$REPO_ROOT/packages/schema/src/entity/resolution.ts" ;;
    E-06)
      # 410 Row 6's diff, verbatim. The re-added category contributes ZERO cases, so the census
      # cell reds on `atLeastFive: false` — which is why this row proves the corpus census would
      # also catch a category silently EMPTIED, not only one silently added.
      perl -0pi -e "s/\Q  'miss',\E\n\Q] as const\E\n/  'miss',\n  'reserved',\n] as const\n/" \
        "$REPO_ROOT/packages/knowledge-local/src/resolver/__tests__/fixtures/entity-corpus.ts" ;;
    W-01|W-01t)
      # 411 Row 1's diff, verbatim: the fourth kind back at the index Phase 411 removed it from.
      # ONE edit, TWO instruments — the runtime exact-list pin (W-01) and the schema typecheck
      # (W-01t), which the row recorded as OBSERVED (exit 2, exactly one diagnostic) rather than
      # predicted. Two legs rather than one because this script's ALLOWED sets are per-instrument.
      perl -0pi -e "s/\Qexport const PROPOSAL_KINDS = ['knowledge', 'test-draft', 'config'] as const\E/export const PROPOSAL_KINDS = ['knowledge', 'test-draft', 'finding', 'config'] as const/" \
        "$REPO_ROOT/packages/schema/src/proposal/envelope.ts" ;;
    W-02)
      # 411 Row 2's diff, verbatim. The added word is `'halted'` — a word this phase never shipped —
      # ON PURPOSE: D-04's pin is an ORDERED EXACT LIST, so any fifth member reds it, and a word
      # from outside the retired vocabulary proves the pin is about cardinality and order rather
      # than about one remembered token.
      perl -0pi -e "s/\Q  'stopped',\E\n\Q] as const\E\n/  'stopped',\n  'halted',\n] as const\n/" \
        "$REPO_ROOT/packages/schema/src/functions/authoring.ts" ;;
    W-03)
      # 411 Row 3's fenced diff, transcribed byte for byte — the thirteen-line block inserted
      # directly after the narrowed `drafted`/`repaired` put block. The attribution is RE-DERIVED
      # inside the new guard because the shipped one is block-scoped to the narrowed `if`; the
      # payload is cast `as never` so the mutation stays a one-block edit vitest transpiles without
      # argument (a type-correct payload would need a whole fixture and would measure the fixture).
      # The guard's `if (outcome.kind === 'stopped') {` shape is load-bearing: the ledger says a
      # transcription matches on it. THE ONLY dist-CROSSING ROW OF THE FIVE — the cell reads schema
      # through `packages/schema/dist`, so the schema build runs before the mutated run AND again
      # before the restored one (unchanged content, rebuilt to prove the read is current).
      perl -0pi -e "s/\Q      await proposals.put({ kind: 'test-draft', ...attribution, payload: outcome.proposal })\E\n\Q    }\E\n/      await proposals.put({ kind: 'test-draft', ...attribution, payload: outcome.proposal })\n    }\n\n    if (outcome.kind === 'stopped') {\n      const stopRunId = outcome.receipt.gateRuns.at(-1)?.runId\n      const stopAttribution = {\n        emittedBy: AUTHORING_DRAFT_WRITE_FUNCTION_ID,\n        ...(stopRunId === undefined ? {} : { runId: stopRunId }),\n      }\n      await proposals.put({\n        kind: 'test-draft',\n        ...stopAttribution,\n        payload: { draftRef: outcome.draftRef } as never,\n      })\n    }\n/" \
        "$REPO_ROOT/packages/agent/src/functions/ops/authoring-draft-write.ts" ;;
    W-04)
      # 411 Row 4's diff, verbatim. THE KEY IS OPTIONAL ON PURPOSE (411 note (a)): a required
      # `proposal` would red every construction site in `router.ts` and `loop.ts`, and the leg
      # would then measure "the compiler noticed a required field" rather than "the keyof pin
      # noticed a new key". With `?` every site still compiles and the ONLY red is the pin.
      perl -0pi -e "s/\Q  readonly evidenceRefs: readonly RunEvidenceRef[]\E\n\Q}\E\n/  readonly evidenceRefs: readonly RunEvidenceRef[]\n  readonly proposal?: unknown\n}\n/" \
        "$REPO_ROOT/packages/agent/src/authoring/router.ts" ;;
    W-05)
      # 411 Row 5's diff, verbatim — the SIBLING of the `abandonment?` block, not a member of it.
      # The pin is `keyof Extract<AuthoringLoopOutcome, { kind: 'stopped' }>`, so a key added
      # INSIDE `abandonment` would change a nested shape the pin never reads and the leg would
      # report a green. The anchor therefore spans the abandonment block's closing brace, and the
      # new line lands at the arm's own indentation. Optional for Row 4's reason: `loop.ts` builds
      # the stopped arm at two sites and neither supplies a `proposal`.
      perl -0pi -e "s/\Q        readonly iterations: number\E\n\Q      }\E\n\Q    }\E\n/        readonly iterations: number\n      }\n      readonly proposal?: unknown\n    }\n/" \
        "$REPO_ROOT/packages/agent/src/authoring/loop.ts" ;;
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
  local subjects="$9" created="${10}"

  echo "=== LEG $id — $label"

  # A refusal must not grant cleanup ownership. Check EVERY path before taking any
  # snapshot or publishing the restore lists; the EXIT trap also runs on refusal.
  local p
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    clean_gate "$p"
  done <<< "$subjects"
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if [ -e "$REPO_ROOT/$p" ] || [ -L "$REPO_ROOT/$p" ]; then
      echo "FATAL: $p already exists — leg $id would overwrite a real file" >&2
      exit 1
    fi
  done <<< "$created"

  while IFS= read -r p; do
    [ -z "$p" ] && continue
    cp "$REPO_ROOT/$p" "$(snapshot_path "$p")"
    echo "  subject $p sha256 $(shasum -a 256 "$REPO_ROOT/$p" | cut -d' ' -f1)"
  done <<< "$subjects"
  CURRENT_SUBJECTS="$subjects"
  CURRENT_CREATED="$created"
  CURRENT_REBUILD="$rebuild"

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
    fatal "the suite stayed green under the mutation — leg $id measures nothing"
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
      fatal "leg $id asks for mode $mode — mode not implemented" ;;
  esac
  set -e

  echo "  cells red:"
  local line fragment ok
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    echo "    - $line"
  done <<< "$red"

  if [ -z "$red" ]; then
    fatal "leg $id did not red its named cell — the log carries no parseable red"
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
      fatal "leg $id raised $blocks TypeCheckError blocks — exactly one was predicted"
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
      fatal "leg $id red a cell outside its allowed list: $line"
    fi
  done <<< "$red"

  # …and every cell this mutation EXISTS to red must be among them — matched PER RED LINE and
  # anchored at the line end, so a cell whose title is a strict prefix of another cell's title
  # cannot be satisfied by that other cell's red. An empty fragment is skipped, never treated as a
  # satisfied match.
  while IFS= read -r fragment; do
    [ -z "$fragment" ] && continue
    if required_line_match "$fragment" "$red"; then
      echo "  named cell red: $fragment"
    else
      fatal "leg $id did not red its named cell: $fragment"
    fi
  done <<< "$required"

  # The mid-leg hook — the mutation is still live and the red set has been accepted.
  if [ -n "$POST_RUN_CHECK" ]; then
    "$POST_RUN_CHECK"
    POST_RUN_CHECK=""
  fi

  # The same close-out `fatal` takes, through the same implementation: restore, PROVE the restore,
  # rebuild. Success and failure cannot diverge because there is only one of it.
  close_leg

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
  CURRENT_REBUILD=""
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

# Leg V-03's four named census cells, defined HERE rather than beside the leg because the startup
# control below drives the REQUIRED comparator with this exact set. A second copy of these titles
# next to the control would drift out of sync with the leg the day one cell is re-titled, and the
# control would then be proving something about a string that exists nowhere else. The leg's
# ALLOWED set and its `run_leg` invocation stay where they always were.
V03_REQUIRED="no source or test spells the second delta vocabulary
no source or test spells the second delta vocabulary's module
no source or test spells the third id brand
no source or test spells the third id brand's cast helper"

# ── INSTRUMENT SELF-CHECK ─────────────────────────────────────────────────────────────────────
#
# A gate nobody has seen fire is a comment. This phase's whole thesis is that a property nothing
# can fail on is not a property, and the gates the criterion rests on are subject to that thesis
# too — so each of them is DRIVEN IN ITS FAILING DIRECTION here, on every invocation, before any
# subject is touched. It costs milliseconds, writes nothing into a tracked path, and turns each
# repaired branch from one that has been READ into one that has been SEEN to fire.
#
# It deliberately does NOT increment `PREFLIGHT_COUNT`: that line counts INSTRUMENTS, and a control
# is not one.
instrument_self_check () {
  echo "=== INSTRUMENT SELF-CHECK — the gates the criterion rests on, driven in their failing direction"

  # Control 1 — the sha256 comparator, in BOTH directions. If it cannot tell two different files
  # apart, every restore verification in this script is vacuous and every FATAL path lies.
  local sc_a="$WORK/selfcheck-same-a" sc_b="$WORK/selfcheck-same-b" sc_c="$WORK/selfcheck-different"
  printf 'the same bytes\n' > "$sc_a"
  printf 'the same bytes\n' > "$sc_b"
  printf 'the same bytes.\n' > "$sc_c"
  local accepts_identical=0 rejects_differing=0
  if same_bytes "$sc_a" "$sc_b"; then accepts_identical=1; fi
  if same_bytes "$sc_a" "$sc_c"; then :; else rejects_differing=1; fi
  rm -f "$sc_a" "$sc_b" "$sc_c"
  if [ "$accepts_identical" -ne 1 ] || [ "$rejects_differing" -ne 1 ]; then
    echo "FATAL: the sha256 comparator cannot tell two different files apart — the restore verification is vacuous" >&2
    exit 1
  fi
  echo "  comparator: sha256 rejects differing bytes and accepts identical bytes"

  # Control 2 — the restore path's THREE failure branches, driven. A loud copy and two verify
  # branches checked only by a static grep would be exactly the shape this phase exists to reject,
  # so each is made to fire here. Every one runs in a SUBSHELL used as an `if` condition: `set -e`
  # cannot abort the run, the callee's `exit 1` ends only the subshell, and — this is the
  # load-bearing part — the assignments below never touch the parent shell. A parent-shell
  # `CURRENT_CREATED=package.json` would be `rm -f`'d by the EXIT trap and would DELETE a tracked
  # file at process exit. Output goes under $WORK, so no FATAL of a control reaches the run log.
  local sc_log="$WORK/selfcheck-restore.log"
  local copy_loud=0 digest_loud=0 created_loud=0

  # (a) the failed copy. `.selfcheck-no-snapshot` was never snapshotted, so `cp` fails on a MISSING
  # SOURCE and nothing is ever written into the repository. It is driven through the `fatal` helper
  # rather than by calling the restore helper directly, because the number of call sites that
  # helper has is ITSELF a gate (exactly four, none of them a self-check); driving the real exit
  # path also proves the helper reaches the restore before it reaches anything else.
  if (
    CURRENT_SUBJECTS=".selfcheck-no-snapshot"
    CURRENT_CREATED=""
    CURRENT_REBUILD=""
    fatal "self-check control: driving the failed-copy branch"
  ) > "$sc_log" 2>&1; then :; else copy_loud=1; fi
  grep -q 'FATAL: could not restore .selfcheck-no-snapshot from its byte snapshot' "$sc_log" || copy_loud=0

  # (b) the mismatched digest. `package.json` always exists and is never a leg subject, so its
  # snapshot name cannot collide with a real one; the bogus snapshot is removed immediately.
  local sc_snapshot
  sc_snapshot="$(snapshot_path "package.json")"
  printf 'these are not the bytes of package.json\n' > "$sc_snapshot"
  if (
    CURRENT_SUBJECTS="package.json"
    CURRENT_CREATED=""
    verify_restored
  ) > "$sc_log" 2>&1; then :; else digest_loud=1; fi
  rm -f "$sc_snapshot"
  grep -q 'FATAL: package.json was not restored byte-identically' "$sc_log" || digest_loud=0

  # (c) the surviving created path. Writes nothing at all: it names a path that already exists.
  if (
    CURRENT_SUBJECTS=""
    CURRENT_CREATED="package.json"
    verify_restored
  ) > "$sc_log" 2>&1; then :; else created_loud=1; fi
  grep -q 'FATAL: package.json survived the leg' "$sc_log" || created_loud=0

  rm -f "$sc_log"
  if [ "$copy_loud" -ne 1 ] || [ "$digest_loud" -ne 1 ] || [ "$created_loud" -ne 1 ]; then
    echo "FATAL: the restore path cannot fail — a failed copy, a mismatched digest or a surviving created path would pass unnoticed" >&2
    exit 1
  fi
  echo "  control: restore path FATALs on a failed copy, a mismatched digest and a surviving created path"

  # Control 3 — the REQUIRED comparator, driven with the EXACT 2-of-4 case the verifier reproduced
  # in bash: leg V-03 named four census cells and passed when only the two longer ones reddened,
  # because the two shorter titles are strict prefixes of them. The fixture is DERIVED from
  # V03_REQUIRED rather than transcribed, so a re-titled cell cannot leave this control pointing at
  # a string that no longer exists anywhere else.
  local v03_a v03_b sc_shadowed="" sc_shadowing=""
  while IFS= read -r v03_a; do
    [ -z "$v03_a" ] && continue
    while IFS= read -r v03_b; do
      [ -z "$v03_b" ] && continue
      case "$v03_b" in
        "$v03_a"?*)
          sc_shadowed="${sc_shadowed}${v03_a}
"
          sc_shadowing="${sc_shadowing}${v03_b}
" ;;
      esac
    done <<< "$V03_REQUIRED"
  done <<< "$V03_REQUIRED"
  sc_shadowed="$(echo "$sc_shadowed" | grep -v '^$' | sort -u)" || true
  sc_shadowing="$(echo "$sc_shadowing" | grep -v '^$' | sort -u)" || true
  if [ -z "$sc_shadowed" ]; then
    echo "FATAL: the V-03 REQUIRED set no longer contains a strict-prefix pair — the negative control is vacuous, re-point it" >&2
    exit 1
  fi

  # Two blobs, each line carrying a SYNTHETIC describe prefix — synthetic on purpose: the property
  # under test is about the suffix, and that the real red line has this shape is proven separately
  # by the full run's own `named cell red:` output over the live census.
  local sc_partial="" sc_whole=""
  while IFS= read -r v03_a; do
    [ -z "$v03_a" ] && continue
    sc_partial="${sc_partial}412 self-check synthetic describe > ${v03_a}
"
  done <<< "$sc_shadowing"
  while IFS= read -r v03_a; do
    [ -z "$v03_a" ] && continue
    sc_whole="${sc_whole}412 self-check synthetic describe > ${v03_a}
"
  done <<< "$V03_REQUIRED"

  local sc_long=0 sc_short=0 sc_every=0 sc_wrong=0
  while IFS= read -r v03_a; do
    [ -z "$v03_a" ] && continue
    sc_long=$((sc_long + 1))
    if required_line_match "$v03_a" "$sc_partial"; then :; else sc_wrong=$((sc_wrong + 1)); fi
  done <<< "$sc_shadowing"
  while IFS= read -r v03_a; do
    [ -z "$v03_a" ] && continue
    sc_short=$((sc_short + 1))
    if required_line_match "$v03_a" "$sc_partial"; then sc_wrong=$((sc_wrong + 1)); fi
  done <<< "$sc_shadowed"
  while IFS= read -r v03_a; do
    [ -z "$v03_a" ] && continue
    sc_every=$((sc_every + 1))
    if required_line_match "$v03_a" "$sc_whole"; then :; else sc_wrong=$((sc_wrong + 1)); fi
  done <<< "$V03_REQUIRED"
  if [ "$sc_wrong" -ne 0 ]; then
    echo "FATAL: the REQUIRED comparator cannot tell a named cell from a longer cell that merely starts with it — leg V-03 measures half its claim" >&2
    exit 1
  fi
  echo "  comparator: required-line-exact — $sc_long longer cells matched their own red, $sc_short shorter cells REFUSED that same red, $sc_every of $sc_every matched when every named cell is red"

  echo "INSTRUMENT SELF-CHECK OK (3 controls)"
  echo
}

node "$REPO_ROOT/scripts/412-issue-slot-refusal-selftest.mjs"
instrument_self_check

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
# The title is transcribed WHOLE. It was carried here truncated at "outside production" from 412-01
# onwards, and the old whole-blob substring match reported it MATCHED against the longer real title
# — the same defect as leg V-03's, in its second form: a REQUIRED fragment that is a strict prefix
# of the RED LINE rather than of a sibling fragment. The end-anchored comparator refuses it, which
# is how it was found. Naming the cell in full is what the leg always claimed to do.
C01_CELL='names exactly the two migration fixtures that spell the retired status literal outside production, and the domain-list marker that spells only the bare key'
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
#
# `V03_REQUIRED` is defined above the startup self-check, which derives its REQUIRED-comparator
# control from this exact set; ALLOWED equals it, as it always has.
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

# 409 Row 3 / JOBK-03, RETARGETED BY 422 D-13 — one mutation, three instruments, three independent
# cycles (the Row 7/8 precedent). `tsc` is SILENT on an extra key — both rebuild filters exit 0
# under the mutation, so the widening reaches every cell as a runtime change and these are the only
# wall there is.
#
# WHAT MOVED, AND WHY THE OLD EXPECTATIONS WOULD HAVE BEEN A LIE. 409 narrowed the chain to TWO
# derived ids and this leg proved a third was refused. 422 D-13 AUTHORISED a third — the
# `propose-improvements` stage — so the cells this leg names were re-titled to the three-id shape by
# 422-07, and its two-id REQUIRED strings named cells that no longer exist. Asserting them would
# have been a `did not red its named cell` FATAL at best and, had the titles happened to survive, a
# leg measuring a legal widening at worst. The mutation now injects a FORBIDDEN FOURTH id and the
# REQUIRED sets below are TRANSCRIBED FROM A MEASURED RUN of that mutation, not predicted: four
# cells in the agent, two across the agent-local dist, one through both dists in the cli.
#
# The rebuild order is load-bearing twice over: agent-local resolves the agent through `dist` and
# the cli resolves BOTH through `dist`, so leg (c) reads a stale derivation if either build is
# skipped. Agent then agent-local, in that order, before the mutated run and again after the
# restore. `$CLI_FILTER` is `agent-qa`, not `@vostride/agent-qa-cli` — a filter that matches no
# project exits 0 without running anything, which is a green that measures nothing (407-25 D-5).
J03_SUBJECT="packages/agent/src/jobs/chain-identity.ts"
J03_REBUILD="$AGENT_FILTER $LOCAL_FILTER"

J03A_REQUIRED="derives exactly three chain ids, keyed analyzeRun, curateMemory and proposeImprovements
derives three distinct ids, each successor key built from its own predecessor id
lets every derived chain kind land the terminal — the terminal list equals the derived kind set
asks the port for exactly the three ids chainJobIdsForRun derives"
# The port cell was ALLOWED-not-REQUIRED because 409 note (e) called it promotable without
# re-measuring. It is PROMOTED here on a measurement rather than on that permission: under the
# forbidden-fourth mutation it REDs every run, because the op hands the port the whole derived id
# set and the cell counts what the port was asked for.
J03A_ALLOWED="$J03A_REQUIRED"
run_leg J-03a "a forbidden FOURTH derived chain id, read in the agent package" runtime \
  "$J03A_REQUIRED" "$J03A_ALLOWED" "$AGENT_FILTER" \
  "src/jobs/__tests__/chain-identity.test.ts src/functions/ops/__tests__/runs-post-processing.test.ts" \
  "$J03_REBUILD" "$J03_SUBJECT" ""

J03B_REQUIRED="drives enqueue -> analyze-run -> curate-memory -> propose-improvements -> exactly one notification row
notifies honestly when the analysis died and curation carried on"
J03B_ALLOWED="$J03B_REQUIRED"
run_leg J-03b "the same fourth id, read across the agent -> agent-local dist boundary" runtime \
  "$J03B_REQUIRED" "$J03B_ALLOWED" "$LOCAL_FILTER" "src/__tests__/chain-terminal-notify.test.ts" \
  "$J03_REBUILD" "$J03_SUBJECT" ""

J03C_REQUIRED='produces exactly one analyze-run job, and the second run dedupes rather than errors'
J03C_ALLOWED="$J03C_REQUIRED"
run_leg J-03c "the same fourth id, read by the cli through both dists" runtime \
  "$J03C_REQUIRED" "$J03C_ALLOWED" "$CLI_FILTER" \
  "src/__tests__/post-run-enqueue-idempotency.test.ts" \
  "$J03_REBUILD" "$J03_SUBJECT" ""

# ── The 410 legs ──────────────────────────────────────────────────────────────────────────────
#
# Every REQUIRED and ALLOWED string below is TRANSCRIBED VERBATIM from the row that measured it
# (410-MUTATION-LEDGER.md). All six read `src` through relative imports, so NO leg here crosses a
# `dist` and no rebuild filter is encoded (410 D-01) — encoding one would be a claim the ledger
# does not make. Rows 7-8 are subsumed by the plant legs and C-01 above; Rows 9-11 (the three
# dist-crossing readmissions) are skipped by D-06.
#
# ROWS 2-4 ARE THE ASYMMETRY THIS PHASE EXISTS TO PIN. Row 1 mutates the ARRAY and the compiler
# screams (exit 2, 14 diagnostics); Rows 2-4 smuggle the same sixth kind into the five tables
# through `Object.assign` + `as Record<string, unknown>` and the compiler says NOTHING — exit 0,
# zero `error TS`. So for a table row the runtime key-set cell is the ONLY wall standing between
# this repo and a sixth-kind row, which is 410 D-02's whole reason to exist. That must be PROVEN
# on every run rather than remembered, so each cast leg runs a schema typecheck WHILE THE CAST IS
# LIVE through `run_leg`'s POST_RUN_CHECK hook and requires exit 0. A future `tsc` that learns to
# see the cast changes the measurement LOUDLY instead of silently.
assert_schema_typecheck_green () {
  set +e
  pnpm --filter "$SCHEMA_FILTER" typecheck > "$WORK/cast-typecheck.log" 2>&1
  local rc=$?
  set -e
  echo "  schema typecheck under the cast exited $rc"
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: the cast became visible to typecheck — re-measure 410 Row 2" >&2
    echo "       (see $WORK/cast-typecheck.log)" >&2
    exit 1
  fi
}

ENTITY_SUITE="src/entity/__tests__/410-five-entity-kinds.test.ts"

# 410 Row 1 / ENTY-03 — the sixth kind re-added to the array itself.
E01_REQUIRED='spells exactly the five kinds in declaration order'
E01_ALLOWED="$E01_REQUIRED"
run_leg E-01 "the sixth entity kind re-added to ENTITY_KINDS" runtime \
  "$E01_REQUIRED" "$E01_ALLOWED" "$SCHEMA_FILTER" "$ENTITY_SUITE" "" \
  "packages/schema/src/entity/kinds.ts" ""

# 410 Row 2 / the cast smuggle on the two kinds.ts tables.
E02_REQUIRED="ENTITY_URI_SEGMENTS has exactly the five kinds as keys
SLUG_ADDRESSED_ENTITY_KINDS has exactly the five kinds as keys"
E02_ALLOWED="$E02_REQUIRED"
POST_RUN_CHECK=assert_schema_typecheck_green
run_leg E-02 "a sixth-kind row cast-smuggled onto both kinds.ts tables" runtime \
  "$E02_REQUIRED" "$E02_ALLOWED" "$SCHEMA_FILTER" "$ENTITY_SUITE" "" \
  "packages/schema/src/entity/kinds.ts" ""

# 410 Row 3 / the cast smuggle on the two entity-card.ts tables.
E03_REQUIRED="ENTITY_STATUSES has exactly the five kinds as keys
ENTITY_IDENTITY_FACT_LABELS has exactly the five kinds as keys"
E03_ALLOWED="$E03_REQUIRED"
POST_RUN_CHECK=assert_schema_typecheck_green
run_leg E-03 "a sixth-kind row cast-smuggled onto both entity-card.ts tables" runtime \
  "$E03_REQUIRED" "$E03_ALLOWED" "$SCHEMA_FILTER" "$ENTITY_SUITE" "" \
  "packages/schema/src/entity/entity-card.ts" ""

# 410 Row 4 / the cast smuggle on ENTITY_DASHBOARD_ROUTES.
E04_REQUIRED='ENTITY_DASHBOARD_ROUTES has exactly the five kinds as keys'
E04_ALLOWED="$E04_REQUIRED"
POST_RUN_CHECK=assert_schema_typecheck_green
run_leg E-04 "a whole plausible sixth route cast-smuggled onto ENTITY_DASHBOARD_ROUTES" runtime \
  "$E04_REQUIRED" "$E04_ALLOWED" "$SCHEMA_FILTER" "$ENTITY_SUITE" "" \
  "packages/schema/src/entity/dashboard-route.ts" ""

# 410 Row 5 / the resolution-reason vocabulary.
E05_REQUIRED='resolves to nothing for exactly two reasons, in declaration order'
E05_ALLOWED="$E05_REQUIRED"
run_leg E-05 "the retired no-match reason re-added between the two survivors" runtime \
  "$E05_REQUIRED" "$E05_ALLOWED" "$SCHEMA_FILTER" "$ENTITY_SUITE" "" \
  "packages/schema/src/entity/resolution.ts" ""

# 410 Row 6 / the corpus category (the planner's call — cheap, crosses no dist, and the only leg
# here that drives a real resolver rather than reading a table). The clean gate is scoped to the
# fixture path, which is what lets this leg run inside a package that carries unrelated dirt.
E06_REQUIRED='holds at least a hundred query cases with five or more in every category'
E06_ALLOWED="$E06_REQUIRED"
run_leg E-06 "the retired corpus category re-added to CORPUS_CATEGORIES" runtime \
  "$E06_REQUIRED" "$E06_ALLOWED" "@vostride/agent-qa-knowledge-local" \
  "src/resolver/__tests__/corpus.test.ts" "" \
  "packages/knowledge-local/src/resolver/__tests__/fixtures/entity-corpus.ts" ""

# ── The 411 legs ──────────────────────────────────────────────────────────────────────────────
#
# Every REQUIRED and ALLOWED string below is TRANSCRIBED VERBATIM from the row that measured it
# (411-MUTATION-LEDGER.md). W-06 (Row 8) already ran above, with the cheap type walls — it is
# defined ONCE and is not repeated here. Rows 6-7 keep their own standing instrument,
# `pnpm validate:router-mutation`, and are deliberately not re-encoded; Rows 9-10 are subsumed by
# the P-agent plant (`FindingRoute`) and by C-02.
#
# Order: the two schema-local runtime pins, then the ONE type-wall reading of Row 1, then the two
# `keyof` pins, then the single dist-crossing leg last — cheapest first, as everywhere else here.

# 411 Row 2 / AUTHORING_LOOP_OUTCOMES — the suite holds exactly one cell, which is what keeps an
# unrelated red from masquerading as the pin.
W02_REQUIRED='has exactly four outcomes, in declaration order'
W02_ALLOWED="$W02_REQUIRED"
run_leg W-02 "a fifth outcome word added to AUTHORING_LOOP_OUTCOMES" runtime \
  "$W02_REQUIRED" "$W02_ALLOWED" "$SCHEMA_FILTER" \
  "src/functions/__tests__/authoring-loop-outcomes.test.ts" "" \
  "packages/schema/src/functions/authoring.ts" ""

# 411 Row 1 / WTST-09 — the runtime exact-list pin. vitest TRANSPILES WITHOUT TYPECHECKING, so the
# `Record<ProposalKind, …>` sites in the agent never enter this leg: the runtime pin is the whole
# wall here, which is exactly why WTST-09 needed one.
W01_REQUIRED='has exactly three kinds, and the predicate matches them exactly'
W01_ALLOWED="$W01_REQUIRED"
run_leg W-01 "a fourth proposal kind re-added to PROPOSAL_KINDS" runtime \
  "$W01_REQUIRED" "$W01_ALLOWED" "$SCHEMA_FILTER" "src/__tests__/proposal-envelope.test.ts" "" \
  "packages/schema/src/proposal/envelope.ts" ""

# 411 Row 1 / WTST-09 — the ALLOWED SECOND INSTRUMENT (D-06), and the row's own correction: the
# prediction was exit 0 and the measurement was exit 2 with EXACTLY ONE diagnostic — the
# `ExactlyEqual<z.infer<typeof ProposalEnvelopeSchema>, ProposalEnvelope>` parity pin at
# `inbox-ops.ts:81-84` reddening because the DTO gained a kind the union's three arms do not carry.
# The prediction was wrong in the SAFE direction (an extra instrument, not a missing one), so 412
# carries it as its own leg rather than asserting a green. pnpm surfaces tsc's exit as 2; the leg
# asserts NON-ZERO and prints the number it observed.
W01T_REQUIRED='src/proposal/inbox-ops.ts(82,7): error TS2322'
W01T_ALLOWED="$W01T_REQUIRED"
run_leg W-01t "the same fourth kind, read by the schema typecheck's parity pin" typecheck \
  "$W01T_REQUIRED" "$W01T_ALLOWED" "$SCHEMA_FILTER" "" "" \
  "packages/schema/src/proposal/envelope.ts" ""

# 411 Row 4 / the StopRoute keyof pin. A `.test-d.ts` reds as ONE FAILED SUITE with one
# TypeCheckError block — there is no test title to match, so the suite line and the
# `<file>:<line>:<col>` pointer are the cell name (Pitfall 8), and "nothing else may be red" is the
# block count `run_leg` already checks in `testd` mode.
W04_SUITE="src/authoring/__tests__/router.test-d.ts"
W04_REQUIRED="src/authoring/__tests__/router.test-d.ts:85:3"
W04_ALLOWED="src/authoring/__tests__/router.test-d.ts"
run_leg W-04 "an optional proposal key re-added to StopRoute" testd \
  "$W04_REQUIRED" "$W04_ALLOWED" "$AGENT_FILTER" "$W04_SUITE" "" \
  "packages/agent/src/authoring/router.ts" ""

# 411 Row 5 / the stopped-arm keyof pin. Rows 4 and 5 are THE PAIR: the route shape and the outcome
# arm are two different places a smuggled proposal could land, each with its own `keyof` wall, so
# both are transcribed rather than one treated as covering the other.
W05_SUITE="src/authoring/__tests__/loop.test-d.ts"
W05_REQUIRED="src/authoring/__tests__/loop.test-d.ts:38:3"
W05_ALLOWED="src/authoring/__tests__/loop.test-d.ts"
run_leg W-05 "an optional proposal key re-added to the loop's stopped arm" testd \
  "$W05_REQUIRED" "$W05_ALLOWED" "$AGENT_FILTER" "$W05_SUITE" "" \
  "packages/agent/src/authoring/loop.ts" ""

# 411 Row 3 / WTST-11 — a put re-added on the stopped arm. The smuggled envelope wears
# `kind: 'test-draft'` because after the narrowing that is the only kind left to smuggle, and the
# cell counts ANY envelope rather than a kind — the property that lets it survive a later widening
# of the vocabulary. THE ONE REBUILD IN THIS SECTION: the cell reads schema through `dist`, so
# `run_leg` builds the schema before the mutated run and again after the restore.
W03_REQUIRED='a stop writes NO envelope of any kind — the proposals store is read after the invocation, never the loop'"'"'s return'
W03_ALLOWED="$W03_REQUIRED"
run_leg W-03 "an envelope smuggled onto the stopped arm of the draft-write op" runtime \
  "$W03_REQUIRED" "$W03_ALLOWED" "$AGENT_FILTER" \
  "src/functions/__tests__/authoring-draft-write.stop.test.ts" "$SCHEMA_FILTER" \
  "packages/agent/src/functions/ops/authoring-draft-write.ts" ""

# D-09's last gate: a leg that silently did not run is a green script that measured LESS than it
# claims, and nothing above would notice. The expected count is RECOMPUTED from the roots
# discovered on disk plus the 23 named legs of the LEG INDEX above — never a pinned number, which
# would drift the day a package is added and read the drift as a pass.
EXPECTED_LEGS=$((ROOTS + 23))
if [ "$LEGS_RUN" -ne "$EXPECTED_LEGS" ]; then
  echo "FATAL: leg count drifted — expected $EXPECTED_LEGS, ran $LEGS_RUN" >&2
  exit 1
fi

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
echo "       with the schema alone rebuilt; and a FORBIDDEN FOURTH derived chain id — the third"
echo "       having been authorised by 422 D-13 — REDs by name at all three distances: in the"
echo "       agent, across the agent-local dist, and through both dists in the cli, with every"
echo "       subject restored byte-identically after each cycle."
echo "       And of the 410 ledger: a sixth entity kind REDs the array cell by name, and the same"
echo "       kind cast-smuggled onto all five satisfies-total tables REDs their key-set cells while"
echo "       the compiler stays at exit 0 under every cast — the asymmetry 410 measured, proven on"
echo "       this run rather than remembered; the retired no-match reason and the retired corpus"
echo "       category RED their own cells and nothing beside them. And of the 411 ledger: a fourth"
echo "       proposal kind REDs both the runtime exact-list pin and the ExactlyEqual parity wall the"
echo "       schema typecheck carries; a fifth loop outcome REDs the ordered-list pin; a put"
echo "       re-added on the stopped arm REDs the zero-envelope store read with the schema rebuilt"
echo "       before the mutated run and before the restored one; and each optional key added to a"
echo "       keyof-pinned shape REDs as ONE failed suite with exactly one type error. Every subject"
echo "       was restored byte-identically after every leg, the leg count was asserted against the"
echo "       package roots discovered on disk, and under ISSUE_SLOT_SELFTEST=neutered this same"
echo "       script FATALs on its first leg rather than passing — the gate has been seen to fire."
