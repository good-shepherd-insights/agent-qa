#!/usr/bin/env bash
#
# 414-split-mutation.sh — the acceptance bar for the split widening (ROOT-06 SC1, ROOT-10 SC5,
# 414 D-20 / D-22).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 412's bar measured sets that got
# SMALLER; this one measures the opposite direction. Phase 414 WIDENED four closed sets —
# `CorpusSplit` from one member to three, `HeldOutVisibility` into being, `GeneratorKind` into
# being, `PromotionGateHoldReason` by `empty-gate-set` — and opened one new read port. Every closed
# set this phase widened has a failure mode a green suite cannot see: THE NEW MEMBER QUIETLY
# LEAVING. Nothing in a passing run fails when `held-out` is deleted from `CORPUS_SPLITS` and from
# `CorpusSplit` together — `satisfies` catches an ENTRY naming no member, never a set that shrank on
# both sides, and `vitest` transforms without typechecking, so the compile wall is not even reached.
# The port has the mirror failure mode: A PRIVATE-RETURNING READ QUIETLY JOINING. An `export` added
# to `packages/eval-local/src/reader.ts` widens the proposer's reach, and an assertion that a barrel
# CONTAINS `openCorpusReader` is satisfied by a barrel that contains more.
#
# So the bar is measured by mutation: each leg removes exactly one widened member (or plants exactly
# one new read), runs the instrument that exists to refuse it, and proves the RED landed in the cell
# this script NAMES IN ADVANCE. Eleven legs, eleven named cells.
#
# ROOT-06 SC1 SAYS "MEASURED BY MUTATION, v54's BAR". S-01 and S-03 are that sentence, executed:
# removing `held-out`, then `adversarial`, from `CORPUS_SPLITS` must RED the runtime cell that
# spells the three splits, BY NAME. ROOT-10 SC5 says "an arch cell under `validate:arch` REDs if a
# private-returning method is added to /reader". S-11 is that sentence, executed: ONE planted value
# export, measured in TWO packages — S-08 against eval-local's own runtime key-set pin, S-11 against
# the source-anchored export-set cell that runs under `pnpm validate:arch`. One plant, two cells,
# two packages, because the requirement names the arch cell specifically and a pin in the package
# being policed is not the pin the requirement asks for.
#
# THE TWO RED-PARSERS, AND WHY ONE GREP CANNOT SERVE BOTH.
#   runtime    a vitest cell prints ` FAIL  <suite> > <describe> > <title>` — the TITLE is the cell
#              name, and the suite prefix is stripped so REQUIRED/ALLOWED stay substrings.
#   testd      a `.test-d.ts` reds as ONE FAILED SUITE — ` FAIL  <suite> [ <suite> ]` plus a
#              `TypeCheckError` block pointing at `<suite>:<line>:<col>`, with `Tests  no tests`.
#              A `^ FAIL  <suite> > <title>` grep finds NOTHING there, which is why this mode
#              exists; "nothing else may be red" is checked by counting TypeCheckError blocks.
#
# THERE IS NO `typecheck` MODE HERE, DELIBERATELY. 412 needed one because two of its walls had no
# `.test-d.ts` sibling and only `pnpm --filter <pkg> typecheck` could see them. Every compile-time
# bar this phase put up lives in a `.test-d.ts` beside the type it guards
# (`corpus-entry.test-d.ts`, `promotion-gate.test-d.ts`, `reader.test-d.ts`), which `testd` mode
# reads directly and at file:line:col precision. A whole-package `tsc` would report the same wall
# plus every unrelated consequence of the same edit — a blast radius rather than a measurement. A
# leg that ever needs one must ADD the mode rather than reach for the root `turbo` typecheck, which
# caches per package and replays a stale green on a cache hit.
#
# NO LEG CROSSES A `dist`, AND THERE IS NO REBUILD PARAMETER. Every cell named below imports its
# subject RELATIVELY (Plans 01/02/06 chose relative imports for exactly this reason), and
# `validate:arch` reads raw source text off disk because `packages/arch` may not depend on the
# packages it polices. So a mutation and its measurement are separated by nothing, and `run_leg`
# carries no rebuild filters at all — encoding an always-empty parameter would be a claim this
# script does not make. A future leg whose cell reads a subject through built output must RE-ADD
# the rebuild step (412's `run_leg` is the shape); reading a stale `dist` turns a live mutation into
# a green.
#
# EACH MUTATION MUST RED A CELL THIS SCRIPT NAMES IN ADVANCE. A red somewhere is not the claim; a
# red in the cell that exists to catch that specific change is. Each leg therefore carries a
# REQUIRED set (every fragment must be among the reds) and an ALLOWED set (nothing else may be
# red). Neither is ever matched against a test COUNT.
#
# ALLOWED is a per-line SUBSTRING match — deliberately, because the two `testd` legs name a bare
# file path that must cover both a suite line and a pointer line. REQUIRED is a per-line match
# ANCHORED AT THE LINE END, which is stricter and must be: matched as a substring of the whole
# multi-line red blob, a fragment that is a strict PREFIX of a cell's real title is satisfied by
# that cell's red, and a leg that names a TRUNCATED title then proves nothing about the title it
# meant. That failing direction is driven at startup against leg S-01's own cell, using the exact
# truncation a hand would reach for.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# FAIL-FAST, AND THE TREE IS NEVER LEFT DIRTY. Every FATAL exits through ONE `fatal` helper, and
# that helper does the same three things in the same order every time: it restores every subject
# from its byte snapshot, PROVES the restore by comparing the full sha256 digest of each subject
# against its snapshot, and proves every path the leg created is gone. The proof runs on the
# abnormal exit exactly as it runs on success — a guarantee that holds only when the leg passed is
# the one that is absent at the single moment it is needed: a leg that failed with a widened set or
# a planted export live on disk. A SIGINT, SIGTERM or SIGHUP routes into that same helper, so a
# Ctrl-C mid-run is restored and proved rather than abandoning a mutated tree; the EXIT trap remains
# behind both as the last-resort cleanup. There is no LEG selector and no run-all-and-report mode: a
# selector that runs nothing is a green script.
# A path a leg would CREATE that already exists is refused BEFORE the leg's restore list is
# populated, so the refusing exit's trap has nothing to remove and the file survives — the list
# only ever names paths proven absent when they joined it.
#
# USAGE
#   pnpm validate:split-mutation                     # from the agent-qa root
#   bash agent-qa/scripts/414-split-mutation.sh      # from the super-repository root
#
# KNOBS
#   SPLIT_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation" on its FIRST leg — a gate nobody has seen fire is a
#       comment.
#
# AND EVERY GATE THE CRITERION RESTS ON IS DRIVEN IN ITS FAILING DIRECTION AT STARTUP, before any
# subject is touched — the sha256 comparator, the line-exact REQUIRED comparator, the three
# restore/verify failure branches AND the already-exists refusal, which must leave the file it
# refuses untouched. Each prints the refusal it just performed, and the run FATALs if any of them
# has stopped being able to fail.

# LEG INDEX — every leg, the widening it un-does, the cell it must RED, and the instrument.
#
#   <id>  <mutation>  <mode>  <named cell>  <filter / suite>
#
#   S-01  `'held-out',` deleted from CORPUS_SPLITS            runtime  the three-splits cell        eval / corpus-splits.test.ts
#   S-02  the same deletion, read by the never-bar            testd    corpus-entry.test-d.ts:25:70 eval / corpus-entry.test-d.ts
#   S-03  `'adversarial',` deleted from CORPUS_SPLITS         runtime  the three-splits cell        eval / corpus-splits.test.ts
#   S-04  `'private',` deleted from HELD_OUT_VISIBILITIES     runtime  the two-visibilities cell    eval / corpus-splits.test.ts
#   S-05  a SEVENTH GENERATOR_KINDS member, cast-smuggled     runtime  the six-generator-kinds cell eval / corpus-splits.test.ts
#   S-06  `'empty-gate-set',` deleted from the hold reasons   runtime  the twelve-reasons cell      schema / promotion-gate-hold-reasons.test.ts
#   S-07  the same deletion, read by the never-bar            testd    promotion-gate.test-d.ts:14:5 schema / promotion-gate.test-d.ts
#   S-08  a value export planted on eval-local/src/reader.ts  runtime  the D-20 key-set pin         eval-local / reader.test.ts
#   S-09  listEntries' return widened to CorpusEntry          testd    reader.test-d.ts:19:5        eval-local / reader.test-d.ts
#   S-10  a main-entry eval-local import planted in agent-local runtime the validate:arch aggregate arch / validate-arch.test.ts
#   S-11  THE SAME PLANT AS S-08, read by validate:arch       runtime  the SC5 export-set cell      arch / validate-arch.test.ts
#
# WHY S-02 AND S-07 EXIST BESIDE S-01 AND S-06. The runtime cell reads the ARRAY; the never-bar
# reads the TYPE. A member deleted from the array alone REDs the runtime cell and the never-bar
# together (the bar's `Exclude<T, (typeof ARRAY)[number]>` stops being `never`), and both are
# measured because they are two different walls that a later hand can remove independently.
#
# S-07 IS THE ARRAY DELETION, NOT THE UNION DELETION — and Plan 02 measured why that matters.
# Removing the MEMBER FROM THE UNION does not reach `promotion-gate.test-d.ts` at all: it dies
# earlier, as an unhandled SOURCE error out of `promotion-gate.ts` itself (TS2322 at the `satisfies`
# projection, TS2345 at the `hold()` call). A red-parser written to look for a named failing cell
# finds NOTHING there — the file that fails is production source, not a test. So the union direction
# is measured by its own compiler, not by this bar, and S-07 measures the wall that HAS a cell.
#
# S-10'S PLANT IS `packages/agent-local/src/414-split-plant.ts`, and the package choice is
# load-bearing. The rule (`findEvalLocalMainEntryOffenders`) allows `packages/cli/` and nothing
# else, and `sourceFilesFor` drops `__tests__`, so the plant must sit in the `src/` of a
# contract-bearing NON-cli package. `agent-local` is the package Phase 422 will actually give a
# corpus port to, so the leg plants the violation exactly where the rule was built to catch it. As
# measured: ONE cell reds, and the offender it names is
# `eval-local-reader-carveout: packages/agent-local/src/414-split-plant.ts:1`.
#
# S-11'S SECOND RED IS COLLATERAL AND IS ALLOWED BY MEASUREMENT, NOT BY PREDICTION. The cell
# `the export-set extractor sees a planted value export and ignores a type-only re-export` proves
# the extractor's own failing direction by CONCATENATING the real barrel with a literal
# `export function readPrivateEntries() { return [] }` — which is the exact line S-08/S-11 plant.
# With the plant live the extractor sees that name twice and the fixture cell reds too. That is the
# fixture agreeing with the plant, not a blast radius, so it stays in ALLOWED and out of REQUIRED.
# What S-11 asserts POSITIVELY is that the validate:arch AGGREGATE cell stays GREEN: a planted
# EXPORT is not an import, so the carve-out rule must have nothing to say about it. That direction
# is checked by `aggregate_stayed_green` while the mutation is still live.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

EVAL_FILTER="@vostride/agent-qa-eval"
SCHEMA_FILTER="@vostride/agent-qa-schema"
EVAL_LOCAL_FILTER="@vostride/agent-qa-eval-local"
ARCH_FILTER="@vostride/agent-qa-arch"

CORPUS_ENTRY="packages/eval/src/labels/corpus-entry.ts"
PROMOTION_GATE="packages/schema/src/knowledge/promotion-gate.ts"
READER_BARREL="packages/eval-local/src/reader.ts"
CORPUS_READER="packages/eval-local/src/corpus-reader.ts"
ARCH_SUITE="src/__tests__/validate-arch.test.ts"

# The one line both S-08 and S-11 plant. Spelled ONCE so the two legs cannot drift into measuring
# two different widenings of the same port.
READER_PLANT_EXPORT='export function readPrivateEntries() { return [] }'

# The offender string S-10 must find in the log, verbatim. The prefix is the rule's own
# (`eval-local-reader-carveout: `) and the `:1` is the line the single-line plant sits on.
S10_OFFENDER='eval-local-reader-carveout: packages/agent-local/src/414-split-plant.ts:1'
S10_PLANT_PATH="packages/agent-local/src/414-split-plant.ts"
S10_PLANT_LINE="import '@vostride/agent-qa-eval-local'"

WORK="$(mktemp -d)"
LOG="$WORK/leg.log"
LEGS_RUN=0

# The one mid-leg extension point. A leg may name a shell function here; `run_leg` invokes it while
# the mutation is still live and after the red set has been accepted, then clears it so it cannot
# leak into the next leg. The hook FATALs on its own terms (echo to stderr, exit 1 — the EXIT trap
# restores). S-10 uses it to prove the RED named the planted file; S-11 uses it to prove the
# aggregate cell did NOT red.
POST_RUN_CHECK=""

snapshot_path () { echo "$WORK/$(echo "$1" | tr '/' '_').snapshot"; }

# Byte-identity, and nothing weaker: the FULL hex digest of both files, hashed at call time — never
# a size, never an mtime, never a truncated digest. Two files that differ by one byte must compare
# non-equal, and the self-check below drives exactly that. A missing file hashes to the empty
# string; the `-n` guard stops two missing files comparing equal.
same_bytes () {
  local a b
  a="$(shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1)" || true
  b="$(shasum -a 256 "$2" 2>/dev/null | cut -d' ' -f1)" || true
  [ -n "$a" ] && [ "$a" = "$b" ]
}

# required_line_match <fragment> <red-blob> — is this named cell among the reds?
#
# PER RED LINE, AND ANCHORED AT THE LINE END. A substring match against the whole multi-line blob
# reports MATCHED for a fragment that is a strict PREFIX of a cell's real title — which is the
# truncation this phase's own plan text reaches for (`declares exactly the three corpus splits`,
# where the cell is `declares exactly the three corpus splits, in declaration order`). A leg that
# named the truncation would pass while proving nothing about the cell it meant.
#
# The suffix is the right anchor, not full-line equality: the runtime red-parser strips the
# ` FAIL  <suite> > ` prefix but leaves the describe block, so a red line reads
# `<describe> > <title>` while a REQUIRED fragment is the title alone. It is also correct for the
# `testd` parser, whose fragments are whole `grep -oE` outputs and therefore already whole lines,
# which an end anchor with a left wildcard still matches.
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
# `fatal`'s re-entry guard: a failure DURING cleanup, or a second interrupt, must exit rather than
# start the cleanup over.
FATAL_ACTIVE=0

# A COPY THAT DID NOT HAPPEN MUST NEVER BE REPORTED AS ONE THAT DID. `cp`'s own diagnostic reaches
# stderr and a non-zero status is FATAL: the whole guarantee rests on this copy, and the moment it
# is most needed is the moment a leg failed with a narrowed set live on disk. The created paths are
# only `rm -f`'d here; a path that survives the leg is caught by the byte-identity proof below.
#
# This function exits DIRECTLY rather than through the `fatal` helper, because that helper calls
# this one and a call back would recurse forever. An `exit` taken from inside the EXIT trap does not
# re-enter the trap, so exiting directly is safe on the trap path too.
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

# The byte-identity proof, hoisted out of the success path so every FATAL path reaches the same
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

# THE LEG'S CLOSE-OUT, and there is exactly one of it. Restore, then PROVE the restore. Both
# callers — the success path and the FATAL path — come through here, so a leg that passed and a leg
# that failed cannot diverge into two accounts of the same guarantee.
close_leg () {
  restore_current
  verify_restored
}

# THE ONE FATAL EXIT. Message first (a reader of the log sees the reason before the cleanup), then
# the same close-out the success path takes, then exit 1.
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
# AN INTERRUPT IS AN EXIT PATH LIKE ANY OTHER. A Ctrl-C mid-run would otherwise abandon a mutated
# tree, so the signal routes into the SAME helper a FATAL takes: the same restore, the same sha256
# proof. That makes the first interrupt deliberately slow — it restores and proves before it goes —
# and a second interrupt hits the re-entry guard and exits at once. Bash defers a trap until the
# foreground child returns, so an interrupt during a suite lands when that child finishes.
trap 'fatal "interrupted by signal — restoring every subject from its byte snapshot before exit"' INT TERM HUP

# SCOPED to the subject path, never a bare `git status`: this working tree can legitimately carry
# unrelated dirt elsewhere, and a bare status would make this bar refuse to run for a reason that
# has nothing to do with what it measures.
clean_gate () {
  local p="$1"
  if [ -n "$(git status --porcelain -- "$p")" ]; then
    echo "FATAL: $p is dirty before the snapshot — refusing to mutate it" >&2
    exit 1
  fi
}

apply_mutation () {
  case "${SPLIT_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    S-01|S-02)
      # `held-out` leaves the ARRAY, not the type. The anchor spans the NEXT member's line so the
      # match is unique to `CORPUS_SPLITS` — `'held-out'` also appears in the `CorpusSplit` union
      # and in prose above it, and a one-line anchor would be a coin toss. Each line is quoted
      # separately with the `\n` OUTSIDE `\Q…\E`: a `\Q…\E` that quotes the newline never matches,
      # the file is left untouched, and the leg would read a green that measures the ABSENCE of the
      # mutation (412's landed gate is the other half of that lesson, and it is kept below).
      perl -0pi -e "s/\Q  'held-out',\E\n\Q  'adversarial',\E\n/  'adversarial',\n/" \
        "$REPO_ROOT/$CORPUS_ENTRY" ;;
    S-03)
      # `adversarial` leaves the array. Anchored on the closing `satisfies` line, which is unique.
      perl -0pi -e "s/\Q  'adversarial',\E\n\Q] as const satisfies readonly CorpusSplit[]\E/] as const satisfies readonly CorpusSplit[]/" \
        "$REPO_ROOT/$CORPUS_ENTRY" ;;
    S-04)
      # `private` leaves HELD_OUT_VISIBILITIES. This is the member D-18/D-19 rest on: the whole
      # unseen test set is addressed by this one word.
      perl -0pi -e "s/\Q  'private',\E\n\Q] as const satisfies readonly HeldOutVisibility[]\E/] as const satisfies readonly HeldOutVisibility[]/" \
        "$REPO_ROOT/$CORPUS_ENTRY" ;;
    S-05)
      # The V-02 cast-smuggle idiom, applied to the one set 422 will extend. The cast is the point:
      # a plain append under `as const satisfies readonly GeneratorKind[]` is a compile error at the
      # constant itself, so `vitest` would still transform it but a reader would call the leg a type
      # error rather than a measurement. `as unknown as` is what lets the widening REACH the runtime
      # cell — and that cell is then the ONLY wall standing between this repo and a seventh
      # generator kind, which is what the leg exists to prove.
      perl -0pi -e "s/\Q  'judge-targeted',\E\n\Q] as const satisfies readonly GeneratorKind[]\E/  'judge-targeted',\n  'fuzz-html',\n] as unknown as readonly GeneratorKind[]/" \
        "$REPO_ROOT/$CORPUS_ENTRY" ;;
    S-06|S-07)
      # `empty-gate-set` leaves PROMOTION_GATE_HOLD_REASONS — the ARRAY, not the union (see the
      # LEG INDEX note above for what the union direction does instead).
      perl -0pi -e "s/\Q  'empty-gate-set',\E\n\Q] as const satisfies readonly PromotionGateHoldReason[]\E/] as const satisfies readonly PromotionGateHoldReason[]/" \
        "$REPO_ROOT/$PROMOTION_GATE" ;;
    S-08|S-11)
      # ONE plant, appended to the `/reader` barrel; TWO legs read it. A value export is the
      # widening the port exists to refuse — `readPrivateEntries` is named for what a hand would
      # actually reach for, and its body returns `[]` so nothing about the leg depends on it
      # working.
      printf '%s\n' "$READER_PLANT_EXPORT" >> "$REPO_ROOT/$READER_BARREL" ;;
    S-09)
      # `listEntries` stops promising a PROPOSER-VISIBLE entry. The interface line moves and the
      # type import gains `CorpusEntry`; the IMPLEMENTATION's own annotation is left alone on
      # purpose — `ProposerVisibleCorpusEntry` is assignable to `CorpusEntry`, so the source still
      # compiles and the never-bar is the only wall the leg can be measuring.
      perl -0pi -e "s/\Q  listEntries(product?: string): readonly ProposerVisibleCorpusEntry[]\E\n/  listEntries(product?: string): readonly CorpusEntry[]\n/" \
        "$REPO_ROOT/$CORPUS_READER"
      perl -0pi -e "s/\Qimport type {\E\n\Q  LeafCassette,\E\n/import type {\n  CorpusEntry,\n  LeafCassette,\n/" \
        "$REPO_ROOT/$CORPUS_READER" ;;
    S-10)
      printf '%s\n' "$S10_PLANT_LINE" > "$REPO_ROOT/$S10_PLANT_PATH" ;;
    *) echo "FATAL: unknown leg $1" >&2; exit 1 ;;
  esac
}

# run_leg <id> <label> <mode> <required> <allowed> <filter> <suite> <subjects> <created>
#
#   mode      runtime | testd — which red-parser reads the log
#   required  newline-separated fragments, every one of which must be among the reds
#   allowed   newline-separated fragments; every red must contain one of them
#   subjects  newline-separated committed paths this leg edits (snapshotted, sha256-verified)
#   created   newline-separated paths this leg brings into existence (must not exist beforehand)
run_leg () {
  local id="$1" label="$2" mode="$3" required="$4" allowed="$5" filter="$6" suite="$7"
  local subjects="$8" created="$9"

  echo "=== LEG $id — $label"

  # Refuse first: the restore lists only ever name a created path proven absent, or a subject
  # snapshotted, at the moment it joined. A refusing exit's trap can therefore remove nothing
  # that was on disk before the leg. 414-VERIFICATION.md gap 1 makes this order load-bearing:
  # populating CURRENT_CREATED before the already-exists refusal deleted the refused file.
  # Refusals exit directly, not through fatal: fatal runs close_leg, whose verify_restored would
  # print the restored-and-proven line for a leg that never started. Empty lists make exit honest.
  local p
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    clean_gate "$p"
  done <<< "$subjects"
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if [ -e "$REPO_ROOT/$p" ]; then
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
  apply_mutation "$id"

  # 412's landed gate: an edit that no longer matches its anchor changes nothing and the leg would
  # report a green that measures the absence of the mutation. Skipped when neutered — a no-op edit
  # changing nothing is exactly what the self-test is for.
  if [ "${SPLIT_MUTATION_SELFTEST:-}" != neutered ]; then
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

  set +e
  # shellcheck disable=SC2086
  pnpm --filter "$filter" exec vitest run $suite > "$LOG" 2>&1
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
      red="$(grep -oE "^ FAIL  [^ ]+ > .*" "$LOG" | sed -E 's|^ FAIL  [^ ]+ > ||' | sort -u)" ;;
    testd)
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
  # anchored at the line end. An empty fragment is skipped, never treated as a satisfied match.
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

  # The same close-out `fatal` takes, through the same implementation: restore, PROVE the restore.
  close_leg

  # The instrument must be green again before the next leg starts. Two legs share a subject in
  # three places here (S-01/S-02/S-03/S-04/S-05 on `corpus-entry.ts`, S-06/S-07 on
  # `promotion-gate.ts`, S-08/S-11 on `reader.ts`), so a restore that silently left a member out
  # would be read by the NEXT leg as its own measurement.
  set +e
  # shellcheck disable=SC2086
  pnpm --filter "$filter" exec vitest run $suite > "$LOG" 2>&1
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

# ── The two mid-leg hooks ──────────────────────────────────────────────────────────────────────

# S-10. The aggregate cell reds for a living: what makes THIS red a measurement of the eval-local
# carve-out rather than of anything else in `validate:arch` is that the offender list NAMES the
# planted file with the rule's own prefix.
red_names_the_plant () {
  if grep -qF "$S10_OFFENDER" "$LOG"; then
    echo "  red names the plant: $S10_OFFENDER"
  else
    echo "FATAL: the aggregate red did not name the plant: $S10_OFFENDER" >&2
    exit 1
  fi
}

# S-11. The POSITIVE half of the claim: a planted EXPORT is not an import, so the carve-out rule
# must have nothing to say about it and the aggregate cell must stay GREEN. Without this the leg
# would be satisfied by an arch run that reddened everything.
AGGREGATE_CELL='every contract-bearing package satisfies its class rules and dep contract'
aggregate_stayed_green () {
  if grep -qF "$AGGREGATE_CELL" "$LOG"; then
    echo "FATAL: the validate:arch aggregate cell red under a planted EXPORT — the carve-out rule" >&2
    echo "       is an IMPORT rule and must have nothing to say here (re-measure 414 D-20)" >&2
    exit 1
  fi
  echo "  aggregate cell stayed green under the planted export (an export is not an import)"
}

# ── The named cells ────────────────────────────────────────────────────────────────────────────
#
# Transcribed VERBATIM from the suites, including the `, in declaration order` tail that three of
# them carry. The tail is not decoration: declaration order is part of what an authored array
# claims, and it is also the exact thing a truncated fragment drops — which is why the startup
# control below drives the comparator against `S01_TRUNCATED`.
S01_CELL='declares exactly the three corpus splits, in declaration order'
S01_TRUNCATED='declares exactly the three corpus splits'
S04_CELL='declares exactly the two held-out visibilities, in declaration order'
S05_CELL='declares exactly the six generator kinds, in declaration order'
S06_CELL='declares exactly the twelve promotion-gate hold reasons, in declaration order'
S08_CELL='exports exactly one value from the /reader subpath (D-20 key-set pin)'
S11_CELL='the eval-local /reader subpath exports exactly one value, openCorpusReader (414 D-19/D-20)'
S11_COLLATERAL='the export-set extractor sees a planted value export and ignores a type-only re-export'

# ── INSTRUMENT SELF-CHECK ─────────────────────────────────────────────────────────────────────
#
# A gate nobody has seen fire is a comment. This phase's whole thesis is that a property nothing can
# fail on is not a property, and the gates the criterion rests on are subject to that thesis too —
# so each of them is DRIVEN IN ITS FAILING DIRECTION here, on every invocation, before any subject
# is touched. It costs milliseconds, writes nothing into a tracked path, and turns each branch from
# one that has been READ into one that has been SEEN to fire.
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

  # Control 2 — the restore path's THREE failure branches, driven. Every one runs in a SUBSHELL used
  # as an `if` condition: `set -e` cannot abort the run, the callee's `exit 1` ends only the
  # subshell, and — this is the load-bearing part — the assignments below never touch the parent
  # shell. A parent-shell `CURRENT_CREATED=package.json` would be `rm -f`'d by the EXIT trap and
  # would DELETE a tracked file at process exit. Output goes under $WORK, so no FATAL of a control
  # reaches the run log.
  local sc_log="$WORK/selfcheck-restore.log"
  local copy_loud=0 digest_loud=0 created_loud=0

  # (a) the failed copy. `.selfcheck-no-snapshot` was never snapshotted, so `cp` fails on a MISSING
  # SOURCE and nothing is ever written into the repository. It is driven through the `fatal` helper
  # rather than by calling the restore helper directly, so the real exit path is what gets proved —
  # including that the helper reaches the restore before it reaches anything else.
  if (
    CURRENT_SUBJECTS=".selfcheck-no-snapshot"
    CURRENT_CREATED=""
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

  # Control 3 — the REQUIRED comparator, driven against leg S-01's OWN cell in both directions, with
  # the exact truncation a hand reaches for. `S01_TRUNCATED` is a strict PREFIX of `S01_CELL`, so
  # under a whole-blob substring match it would report MATCHED against S-01's real red and the leg
  # would pass while naming a title that exists nowhere. The end-anchored comparator must REFUSE it.
  #
  # The blob carries a SYNTHETIC describe prefix — synthetic on purpose: the property under test is
  # about the suffix, and that the real red line has this shape is proven separately by the full
  # run's own `named cell red:` output over the live suites.
  case "$S01_CELL" in
    "$S01_TRUNCATED"?*) : ;;
    *)
      echo "FATAL: S01_TRUNCATED is no longer a strict prefix of S01_CELL — the negative control is vacuous, re-point it" >&2
      exit 1 ;;
  esac
  local sc_blob="414 self-check synthetic describe > ${S01_CELL}"
  local sc_wrong=0
  if required_line_match "$S01_CELL" "$sc_blob"; then :; else sc_wrong=1; fi
  if required_line_match "$S01_TRUNCATED" "$sc_blob"; then sc_wrong=1; fi
  if [ "$sc_wrong" -ne 0 ]; then
    echo "FATAL: the REQUIRED comparator cannot tell a named cell from a truncation of it — every leg below measures less than it claims" >&2
    exit 1
  fi
  echo "  comparator: required-line-exact — S-01's whole cell matched its own red, and the truncation '$S01_TRUNCATED' REFUSED that same red"

  # Control 4 — the already-exists refusal, through run_leg itself and the real cleanup helper.
  # Measured on bash 3.2.57: a subshell does NOT run the parent's EXIT trap; a trap set INSIDE it
  # does fire, and subshell assignments never reach the parent. Control 2 relies on that isolation;
  # this control must RE-ARM restore_current or the destructive step is never driven. Do not re-arm
  # the process trap's rm -rf "$WORK" half — the remaining self-check bookkeeping still needs WORK.
  # The path MUST be a throwaway this control creates: a regression deletes it, which is exactly
  # what we must observe. Never use a tracked file here; Control 2(c) can name package.json only
  # because verify_restored removes nothing, while this control drives the destructive path.
  local sc_preexisting=".selfcheck-already-exists" sc_bytes="$WORK/selfcheck-already-exists.bytes"
  if [ -e "$REPO_ROOT/$sc_preexisting" ]; then
    echo "FATAL: $sc_preexisting already exists — this control needs a path it can create; re-point it or remove the leftover by hand" >&2
    exit 1
  fi
  printf 'self-check bytes that must survive the already-exists refusal\n' > "$REPO_ROOT/$sc_preexisting"
  cp "$REPO_ROOT/$sc_preexisting" "$sc_bytes"
  local refused_loud=0 survived=0
  if (
    trap 'restore_current' EXIT
    run_leg SC-4 "self-check control: a created path that already exists" runtime "" "" "$EVAL_FILTER" "" "" "$sc_preexisting"
  ) > "$sc_log" 2>&1; then :; else refused_loud=1; fi
  grep -qF "FATAL: $sc_preexisting already exists — leg SC-4 would overwrite a real file" "$sc_log" || refused_loud=0
  if same_bytes "$REPO_ROOT/$sc_preexisting" "$sc_bytes"; then survived=1; fi
  rm -f "$REPO_ROOT/$sc_preexisting" "$sc_bytes" "$sc_log"
  if [ "$refused_loud" -ne 1 ] || [ "$survived" -ne 1 ]; then
    echo "FATAL: the already-exists refusal is not safe — it did not refuse loudly, or the EXIT trap removed the file it refused to overwrite (414-VERIFICATION gap 1)" >&2
    exit 1
  fi
  echo "  control: the already-exists refusal FATALs with the restore list still empty — the pre-existing file survived the EXIT trap byte-identically (sha256 compared)"

  echo "INSTRUMENT SELF-CHECK OK (4 controls)"
  echo
}

instrument_self_check

# ── PREFLIGHT ─────────────────────────────────────────────────────────────────────────────────
#
# Every instrument any leg will drive, run once on the committed tree. The failure this catches that
# no leg could: a suite that was ALREADY red, whose red a leg would then read as its own
# measurement. No `dist` is rebuilt — see the header: nothing below crosses one, and the preflight
# passing is itself the proof that the built output every suite resolves is usable as it stands.
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

echo "=== PREFLIGHT — every instrument must be green before any subject is touched"
preflight_suite "$EVAL_FILTER" "src/labels/__tests__/corpus-splits.test.ts"
preflight_suite "$EVAL_FILTER" "src/labels/__tests__/corpus-entry.test-d.ts"
preflight_suite "$SCHEMA_FILTER" "src/__tests__/promotion-gate-hold-reasons.test.ts"
preflight_suite "$SCHEMA_FILTER" "src/__tests__/promotion-gate.test-d.ts"
preflight_suite "$EVAL_LOCAL_FILTER" "src/__tests__/reader.test.ts"
preflight_suite "$EVAL_LOCAL_FILTER" "src/__tests__/reader.test-d.ts"
preflight_suite "$ARCH_FILTER" "$ARCH_SUITE"
echo "PREFLIGHT OK ($PREFLIGHT_COUNT instruments)"
echo

# ── The legs ──────────────────────────────────────────────────────────────────────────────────

# ROOT-06 SC1, first half: "REDs by name when held-out … is removed".
run_leg S-01 "held-out removed from CORPUS_SPLITS" runtime \
  "$S01_CELL" "$S01_CELL" "$EVAL_FILTER" "src/labels/__tests__/corpus-splits.test.ts" \
  "$CORPUS_ENTRY" ""

# The compile-time half of the SAME removal. `Exclude<CorpusSplit, (typeof CORPUS_SPLITS)[number]>`
# stops being `never`, and `expectTypeOf(...).toEqualTypeOf<never>()` reds at the column of the
# call. Measured, not predicted: line 25, column 70, exactly one TypeCheckError block.
S02_SUITE="src/labels/__tests__/corpus-entry.test-d.ts"
run_leg S-02 "the same removal, read by the never-bar" testd \
  "src/labels/__tests__/corpus-entry.test-d.ts:25:70" "$S02_SUITE" \
  "$EVAL_FILTER" "$S02_SUITE" "$CORPUS_ENTRY" ""

# ROOT-06 SC1, second half: "…or adversarial is removed". The SAME cell, because the cell spells all
# three members — which is what makes its red say WHICH one left rather than that a count moved.
run_leg S-03 "adversarial removed from CORPUS_SPLITS" runtime \
  "$S01_CELL" "$S01_CELL" "$EVAL_FILTER" "src/labels/__tests__/corpus-splits.test.ts" \
  "$CORPUS_ENTRY" ""

# D-18/D-19's own member. Without `private` there is no unseen test set at all, and nothing else in
# the tree would have said so.
run_leg S-04 "private removed from HELD_OUT_VISIBILITIES" runtime \
  "$S04_CELL" "$S04_CELL" "$EVAL_FILTER" "src/labels/__tests__/corpus-splits.test.ts" \
  "$CORPUS_ENTRY" ""

# The one leg that WIDENS rather than narrows — the V-02 cast-smuggle idiom. 422 adds a generator
# kind through this bar; this leg is what makes "through the bar" mean something.
run_leg S-05 "a seventh GENERATOR_KINDS member smuggled past the satisfies clause by a cast" runtime \
  "$S05_CELL" "$S05_CELL" "$EVAL_FILTER" "src/labels/__tests__/corpus-splits.test.ts" \
  "$CORPUS_ENTRY" ""

# 414 D-14 — the hold reason that lands ahead of PROM-04, under the bar from the day it ships.
run_leg S-06 "empty-gate-set removed from PROMOTION_GATE_HOLD_REASONS" runtime \
  "$S06_CELL" "$S06_CELL" "$SCHEMA_FILTER" "src/__tests__/promotion-gate-hold-reasons.test.ts" \
  "$PROMOTION_GATE" ""

# The compile-time half of the same removal. Measured: line 14, column 5, one block.
S07_SUITE="src/__tests__/promotion-gate.test-d.ts"
run_leg S-07 "the same removal, read by the never-bar" testd \
  "src/__tests__/promotion-gate.test-d.ts:14:5" "$S07_SUITE" \
  "$SCHEMA_FILTER" "$S07_SUITE" "$PROMOTION_GATE" ""

# ROOT-10 SC5, instrument one of two: eval-local's own runtime key-set pin.
run_leg S-08 "a private-returning value export planted on the /reader barrel" runtime \
  "$S08_CELL" "$S08_CELL" "$EVAL_LOCAL_FILTER" "src/__tests__/reader.test.ts" \
  "$READER_BARREL" ""

# The port's OTHER widening: not a new export, but the existing read promising more. The runtime
# cells cannot see this at all — the filter still returns the same objects — so the never-bar is the
# only wall, which is why D-19 put one there.
S09_SUITE="src/__tests__/reader.test-d.ts"
run_leg S-09 "listEntries' return type widened from the proposer-visible entry to CorpusEntry" testd \
  "src/__tests__/reader.test-d.ts:19:5" "$S09_SUITE" \
  "$EVAL_LOCAL_FILTER" "$S09_SUITE" "$CORPUS_READER" ""

# 414 D-20 — the import direction. A non-cli package naming eval-local's GATE-side main entry is the
# violation the carve-out exists for, and the leg proves the rule names the file rather than merely
# reddening.
POST_RUN_CHECK=red_names_the_plant
run_leg S-10 "the eval-local main entry named from a non-cli package" runtime \
  "$AGGREGATE_CELL" "$AGGREGATE_CELL" "$ARCH_FILTER" "$ARCH_SUITE" \
  "" "$S10_PLANT_PATH"

# ROOT-10 SC5, instrument two of two — the sentence measured literally: "an arch cell under
# `validate:arch` REDs if one is added". Same plant as S-08, different package, different cell. The
# collateral fixture cell is ALLOWED (it concatenates the real barrel with this exact line — see the
# LEG INDEX) and the aggregate cell must stay GREEN, which the hook asserts.
POST_RUN_CHECK=aggregate_stayed_green
run_leg S-11 "the same planted export, read by the source-anchored arch export-set pin" runtime \
  "$S11_CELL" "$S11_CELL
$S11_COLLATERAL" "$ARCH_FILTER" "$ARCH_SUITE" \
  "$READER_BARREL" ""

# The last gate: a leg that silently did not run is a green script that measured LESS than it
# claims, and nothing above would notice. Eleven is a PINNED count here rather than a derived one
# (412 derives its own from package roots discovered on disk) because every leg below names a
# specific cell in a specific file — there is nothing on disk to enumerate, so a derived count would
# be a fiction dressed as a computation.
EXPECTED_LEGS=11
if [ "$LEGS_RUN" -ne "$EXPECTED_LEGS" ]; then
  echo "FATAL: leg count drifted — expected $EXPECTED_LEGS, ran $LEGS_RUN" >&2
  exit 1
fi

echo "LEGS $LEGS_RUN"
echo "PASS — every closed set Phase 414 widened has been seen to fail. Removing 'held-out' and then"
echo "       'adversarial' from CORPUS_SPLITS REDs the three-splits cell BY NAME (ROOT-06 SC1,"
echo "       measured rather than asserted), and the same removal REDs the never-bar in"
echo "       corpus-entry.test-d.ts as ONE failed suite with exactly one type error; removing"
echo "       'private' from HELD_OUT_VISIBILITIES REDs the two-visibilities cell, so the unseen test"
echo "       set cannot leave quietly; a SEVENTH generator kind smuggled past the satisfies clause"
echo "       by a cast REDs the runtime projection cell the compiler cannot see, which is the bar"
echo "       422 will add its member through; removing 'empty-gate-set' from"
echo "       PROMOTION_GATE_HOLD_REASONS REDs the twelve-reasons cell and its never-bar, so the"
echo "       hold reason 414 landed ahead of PROM-04 is under the v54 bar from today. And of the"
echo "       proposer's read port: ONE planted value export on the /reader barrel REDs eval-local's"
echo "       runtime key-set pin AND, in a different package, the source-anchored export-set cell"
echo "       under validate:arch that ROOT-10 SC5 names — while the validate:arch aggregate stays"
echo "       GREEN, because an export is not an import; widening listEntries' return type past the"
echo "       proposer-visible entry REDs the never-bar the runtime cells cannot substitute for; and"
echo "       a non-cli package naming eval-local's gate-side main entry REDs the aggregate with the"
echo "       carve-out rule naming the planted file. Every subject was restored byte-identically"
echo "       after every leg and every planted file proved gone, each instrument was green again"
echo "       before the next leg started, the leg count was asserted at $EXPECTED_LEGS, and under"
echo "       SPLIT_MUTATION_SELFTEST=neutered this same script FATALs on its first leg rather than"
echo "       passing — the gate has been seen to fire."
