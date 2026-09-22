#!/usr/bin/env bash
#
# 404-chip-teardown-mutation.sh — the acceptance bar for D-01's chip-side teardown (404-03, D-04).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. After 404-03 the post-processing chip
# set is `{analysis, curation}`, the status vocabulary is four words, and the durable notification
# row carries two stages. Every one of those is a CLOSED set that got smaller, and a set that got
# smaller has a failure mode a passing suite cannot see: the removed member coming back. Nothing in
# a green run fails when a third chip arm, a fifth status word or a third stage is re-added — an
# assertion that a set CONTAINS what it should contain is satisfied by a set that contains more.
# So the bar is measured by mutation:
#
#   M1  a third CHIP ARM re-added to `projectPostProcessingChips`
#   M2  a fifth STATUS WORD re-added to `POST_PROCESSING_CHIP_STATUSES`
#   M3  a third STAGE re-stamped by the chain-terminal notification writer
#   G   the chip-side grep inventory, which must be EMPTY
#
# EACH MUTATION MUST RED A CELL THIS SCRIPT NAMES IN ADVANCE. A red somewhere is not the claim; a
# red in the cell that exists to catch that specific return is. Each leg therefore carries a
# REQUIRED cell (must be among the reds) and an ALLOWED list (nothing else may be red) — a
# mutation that reds half the package is measuring blast radius, not the property.
#
# M1 IS TWO WALLS AND BOTH ARE READ. The chip DTO is a TypeScript interface, so a third arm is a
# compile error before it is a behaviour: `tsc --noEmit` must refuse it. But a type is erased before
# anything runs, and every surface iterates the runtime object — so the key-set cell must red too.
# A leg that only read the compiler would go quiet the day somebody widens the type with a cast.
#
# M2 AND M3 CROSS A `dist` BOUNDARY, AND THE REBUILD IS PART OF THE MUTATION. The agent package
# resolves `@vostride/agent-qa-schema` through built `dist`, and agent-local resolves
# `@vostride/agent-qa-agent` the same way. A leg that mutated the source and ran the cell without
# rebuilding would be running the PREVIOUS build against a mutated file and calling the resulting
# green a measurement. So each of those legs rebuilds after mutating and rebuilds again after
# restoring — and the restore is proven by sha256 against a byte snapshot taken before anything ran.
#
# M3 CARRIES A CAST, DELIBERATELY. The mutation models a WRITER that stamps a third stage, and the
# leg's subject is the runtime guard/migration wall — the row reaching `guardRunNotification` with
# a member this build does not read. Without the cast the package's own DTS build would refuse the
# mutation and the leg could not run at all; that type wall is real and is what M1 measures.
#
# G EXCLUDES THE JOB-KIND LAYER BY NAME. D-04: "`triage-issues`/`triageIssues` in the job-kind layer
# are excluded from 404's grep by name; they are the cleanup milestone's." So `kinds.ts`, the chain
# id derivation in `chain-identity.ts`, `engine.ts`'s candidate id list, the `BUG` entity kind in
# `entity-card.ts` and the resolver's reserved-kind corpus are named exclusions, not oversights —
# 404 tears down the chip side and touches nothing that decides what job kinds exist.
#
# G ALSO EXCLUDES THE MIGRATION CORPUS BY NAME. Two test files construct the PREVIOUS contract on
# purpose — a schemaVersion-1 payload with the third stage — because that is the shape the
# migrate-older walk exists to read. They are the only legal place those bytes may still be spelled,
# and the grep is non-vacuous anyway: the leg proves its own patterns match a synthetic fixture.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# USAGE
#   bash agent-qa/scripts/404-chip-teardown-mutation.sh   # from the super-repository root
#   bash scripts/404-chip-teardown-mutation.sh            # from the agent-qa root
#
# KNOBS
#   CHIP_TEARDOWN_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation" — a gate nobody has seen fire is a comment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SCHEMA_FILTER="@vostride/agent-qa-schema"
AGENT_FILTER="@vostride/agent-qa-agent"
LOCAL_FILTER="@vostride/agent-qa-agent-local"

CHIP_SUBJECT="packages/agent/src/functions/ops/runs-post-processing.ts"
VOCAB_SUBJECT="packages/schema/src/notification/post-processing-status.ts"
WRITER_SUBJECT="packages/agent/src/jobs/chain-identity.ts"

SUBJECT_PATHS=("$CHIP_SUBJECT" "$VOCAB_SUBJECT" "$WRITER_SUBJECT")

CHIP_SUITE="src/functions/ops/__tests__/runs-post-processing.test.ts"
MIGRATION_SUITE="src/__tests__/run-notification-migration.test.ts"
WRITER_SUITE="src/__tests__/chain-terminal-notify.test.ts"
STORED_ROW_SUITE="src/__tests__/post-processing-status.test.ts"

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
REQUIRED_M1="projects EXACTLY the two chips, by key set"
ALLOWED_M1="projects EXACTLY the two chips, by key set
reports pending/pending when the project holds no queue database at all
reports the same pair from a database that holds none of this chain's rows
asks the port for exactly the three ids chainJobIdsForRun derives
projects a finished chain and attaches the notification the terminal wrote
OMITS the notification key entirely while the chain is still in flight
answers the all-pending projection for a host whose queue database is absent
serves the exclusion beside untouched pending chips for a run with no job rows
omits the key and refuses nothing when the port has no handoff yet
omits the key for an ordinary run whose handoff carries neither marker"
# 2026-09-22, 425-12: the last three names are 425-02's exclusion cells, and they are the SAME
# measured blast as the six above them — each asserts the whole chips object or the whole served
# status, so a third arm on the projection reds them for the one reason M1 exists to catch. The
# required cell is unchanged, and nothing about the exclusion fact itself is admitted here: M1
# does not touch it, and the cell that measures the fold is EXCLUSION-FROM-HANDOFF, which stays
# green under this mutation and has its own leg in scripts/425-header-mutation.sh.

REQUIRED_M2="declares EXACTLY the four status words, in the order a stage passes through them"
ALLOWED_M2="declares EXACTLY the four status words, in the order a stage passes through them
maps EVERY job status, claimed and unclaimed, identically for both stages"

# 2026-09-15, 423-25: re-spelled to the 422 writer cell names; the three added names are the measured
# notification-row blast of the same mutation.
REQUIRED_M3="drives enqueue -> analyze-run -> curate-memory -> propose-improvements -> exactly one notification row"
ALLOWED_M3="drives enqueue -> analyze-run -> curate-memory -> propose-improvements -> exactly one notification row
inserts the successor before it considers the terminal — no record at stage two
lands a failed proposal stage without retracting the committed curation
records the staged counts a bound port reported
notifies on the FAILURE terminal, reporting the failed stage honestly
lands curation: failed when the fold never completes
recovers when a retry completes the fold
dedupes a replayed chain terminal on the unique index, byte-identically
notifies honestly when the analysis died and curation carried on"

apply_mutation () {
  case "${CHIP_TEARDOWN_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    M1)
      # A third arm on the projection — the shape of the change somebody makes when they are
      # "restoring" a chip they remember, with an absence word that looks harmless.
      perl -0pi -e "s/    curation: chipFor\(state\?\.curateMemory, 'pending'\),\n  \}/    curation: chipFor(state?.curateMemory, 'pending'),\n    issues: chipFor(undefined, 'pending'),\n  }/" \
        "$REPO_ROOT/$CHIP_SUBJECT" ;;
    M2)
      # A fifth word in the closed vocabulary. Nothing PRODUCES it — which is exactly why only a
      # set-equality cell can see it arrive.
      perl -0pi -e "s/  'failed',\n\] as const/  'failed',\n  'reserved',\n] as const/" \
        "$REPO_ROOT/$VOCAB_SUBJECT" ;;
    M3)
      # The writer stamps a third stage into the durable row. See the header on the cast.
      # 2026-09-15, 423-25: re-spelled onto the writer's current tail. 422-07 (878fe5f7a) appended
      # the proposals spread after curation, so the old anchor matched nothing and the leg went
      # green without mutating.
      perl -0pi -e "s/      \.\.\.\(proposals === undefined \? \{\} : \{ proposals \}\),\n    \},\n  \}\n\}/      ...(proposals === undefined ? {} : { proposals }),\n      issues: { status: 'reserved' },\n    } as unknown as RunNotification['stages'],\n  }\n}/" \
        "$REPO_ROOT/$WRITER_SUBJECT" ;;
    *) echo "FATAL: unknown mutation $1" >&2; exit 1 ;;
  esac
}

build_package () {
  local filter="$1"
  set +e
  pnpm --filter "$filter" build > "$WORK/build.log" 2>&1
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: rebuilding $filter failed — see $WORK/build.log" >&2
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

# run_leg <name> <label> <required> <allowed> <filter> <suite> [rebuild-filter]
run_leg () {
  local name="$1" label="$2" required="$3" allowed="$4" filter="$5" suite="$6" rebuild="${7:-}"

  echo "=== MUTATION $name — $label"
  restore_subjects
  apply_mutation "$name"
  local path
  for path in "${SUBJECT_PATHS[@]}"; do
    echo "  $path sha256 $(shasum -a 256 "$REPO_ROOT/$path" | cut -d' ' -f1)"
  done
  if [ -n "$rebuild" ]; then
    echo "  rebuilding $rebuild so the cell resolves the MUTATED source through dist"
    build_package "$rebuild"
  fi

  set +e
  pnpm --filter "$filter" exec vitest run "$suite" > "$LOG" 2>&1
  local rc=$?
  set -e
  echo "  leg exited $rc"
  grep -E '^      Tests' "$LOG" || true

  if [ "$rc" -eq 0 ]; then
    echo "FATAL: the suite stayed green under the mutation — mutation $name measures nothing" >&2
    restore_subjects
    [ -n "$rebuild" ] && build_package "$rebuild"
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
      [ -n "$rebuild" ] && build_package "$rebuild"
      exit 1
    fi
  done <<< "$red"

  # …and the cell this mutation EXISTS to red must be among them.
  case "$red" in
    *"$required"*) echo "  named cell red: $required" ;;
    *)
      echo "FATAL: mutation $name did not red its named cell: $required" >&2
      restore_subjects
      [ -n "$rebuild" ] && build_package "$rebuild"
      exit 1 ;;
  esac

  restore_subjects
  [ -n "$rebuild" ] && build_package "$rebuild"
  assert_restored
  echo
}

echo "=== PREFLIGHT — the dists the cells resolve through, then the pre-mutation suites"
build_package "$SCHEMA_FILTER"
build_package "$AGENT_FILTER"
for preflight in \
  "$SCHEMA_FILTER|$MIGRATION_SUITE" \
  "$AGENT_FILTER|$CHIP_SUITE" \
  "$LOCAL_FILTER|$WRITER_SUITE" \
  "$LOCAL_FILTER|$STORED_ROW_SUITE"
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

# ── M1 reads the COMPILER first, then the runtime cell (see the header).
echo "=== MUTATION M1 (type wall) — a third chip arm must not compile"
restore_subjects
apply_mutation M1
set +e
pnpm --filter "$AGENT_FILTER" exec tsc --noEmit > "$LOG" 2>&1
M1_TSC_RC=$?
set -e
echo "  tsc --noEmit exited $M1_TSC_RC"
grep -E 'error TS' "$LOG" | head -3 || true
restore_subjects
if [ "$M1_TSC_RC" -eq 0 ]; then
  echo "FATAL: a third chip arm compiled — the DTO is no longer a closed interface" >&2
  exit 1
fi
assert_restored
echo

run_leg M1 "a third chip arm re-added to the projection" \
  "$REQUIRED_M1" "$ALLOWED_M1" "$AGENT_FILTER" "$CHIP_SUITE"
run_leg M2 "a fifth status word re-added to the closed vocabulary" \
  "$REQUIRED_M2" "$ALLOWED_M2" "$AGENT_FILTER" "$CHIP_SUITE" "$SCHEMA_FILTER"
run_leg M3 "the notification writer re-stamps a third stage" \
  "$REQUIRED_M3" "$ALLOWED_M3" "$LOCAL_FILTER" "$WRITER_SUITE" "$AGENT_FILTER"

# ── G — the chip-side grep inventory ───────────────────────────────────────────────────────────
#
# Two greps, because the inventory has two shapes. The first is REPO-WIDE and names the three bus
# event names 404-02 removed: they were never emitted by any producer, so any occurrence anywhere
# is a resurrection. The second is scoped to the chip-side FILES and forbids the code shapes a
# returning member takes — an object member `issues:`, a rendered `issues ${…}` segment, a
# `.issues` property read, or the `'reserved'` status literal.
CHIP_SIDE_FILES=(
  "packages/schema/src/notification/post-processing-status.ts"
  "packages/schema/src/notification/run-notification.ts"
  "packages/schema/src/notification/run-digest.ts"
  "packages/schema/src/functions/runs.ts"
  "packages/agent/src/functions/ops/runs-post-processing.ts"
  "packages/agent/src/functions/ops/runs-digest.ts"
  "packages/agent/src/functions/spec.ts"
  "packages/agent-local/src/store/post-processing-reader.ts"
  "packages/cli/src/curation/post-run-tail.ts"
  "packages/cli/src/curation/post-run-chip-emitter.ts"
)
CHIP_SIDE_PATTERN="issues:|issues \\\$\\{|\\.issues|'reserved'|issuesStarted|issuesCompleted|issuesFailed"
EVENT_NAME_PATTERN="issuesStarted|issuesCompleted|issuesFailed"

# EXCLUDED BY NAME — the job-kind layer, which is the Issue-slot cleanup milestone's (D-04). None of
# these decides what a CHIP says; each decides what job kinds or entity kinds exist:
#   packages/agent/src/jobs/kinds.ts              — `'triage-issues'` in JOB_KINDS
#   packages/agent/src/jobs/chain-identity.ts     — chainJobIdsForRun's third derived id
#   packages/agent/src/jobs/engine.ts             — candidateJobIds, three ids wide
#   packages/schema/src/entity/entity-card.ts     — the BUG entity kind's status vocabulary
#   packages/knowledge-local/src/resolver/**      — the reserved-kind resolution corpus
#   the `triageIssues` identifier wherever it appears — the chain id, not a chip
# EXCLUDED BY NAME — the migrate-older corpus, which must still spell the PREVIOUS contract:
#   packages/schema/src/__tests__/run-notification-migration.test.ts
#   packages/agent-local/src/__tests__/post-processing-status.test.ts
echo "=== GREP LEG G — the chip-side inventory must be empty"
G_HITS="$WORK/grep-hits.txt"
: > "$G_HITS"

set +e
grep -rnE "$EVENT_NAME_PATTERN" packages --include=*.ts --include=*.tsx --include=*.json 2>/dev/null \
  | grep -v '/dist/' | grep -v '/node_modules/' >> "$G_HITS"
for file in "${CHIP_SIDE_FILES[@]}"; do
  grep -nE "$CHIP_SIDE_PATTERN" "$REPO_ROOT/$file" 2>/dev/null \
    | grep -v 'triageIssues' | sed "s|^|$file:|" >> "$G_HITS"
done
set -e

G_COUNT="$(wc -l < "$G_HITS" | tr -d '[:space:]')"
echo "  chip-side inventory lines: $G_COUNT"
if [ "$G_COUNT" -ne 0 ]; then
  echo "FATAL: the chip-side inventory is not empty:" >&2
  cat "$G_HITS" >&2
  exit 1
fi

# NON-VACUITY. A grep that matches nothing because its patterns are wrong reports the same zero as
# a clean tree. So the same expressions are run against a synthetic file carrying every forbidden
# shape, and every one of them must be found.
PROBE="$WORK/probe.ts"
{
  echo "    issues: chipFor(state?.triageSlot, 'reserved'),"
  echo "    const line = \`issues \${chain.status}\`"
  echo "    render(status.chips.issues)"
  echo "    bus.publish('issuesStarted', payload)"
} > "$PROBE"
PROBE_HITS="$(grep -cE "$CHIP_SIDE_PATTERN" "$PROBE")"
echo "  non-vacuity probe matched $PROBE_HITS of 4 forbidden shapes"
if [ "$PROBE_HITS" -ne 4 ]; then
  echo "FATAL: the grep patterns do not match the shapes they forbid — G measures nothing" >&2
  exit 1
fi
echo

echo "PASS — a third chip arm neither compiles nor survives the key-set cell, a fifth status word"
echo "       reds the vocabulary cell, a third stage on the durable row reds the chain-terminal"
echo "       cell, and the chip-side inventory greps empty while the job-kind layer is excluded"
echo "       by name."
