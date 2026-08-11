#!/usr/bin/env bash
#
# 394-apply-mutation.sh — the acceptance bar for D-06's one-commit apply and T-394-43's credential
# gate (394-10).
#
# WHAT THIS PROVES, and why a green suite does not prove it. `one-commit-apply.test.ts` passing says
# a draft became a commit. It does NOT say the suite would CATCH the two implementations D-06
# forbids, and both of them are a few tokens that read as simplifications:
#
#   M   the dirty check WIDENED       — `git status --porcelain` over the whole repository.
#   N1  the staging pathspec DROPPED  — `git add --all` instead of the single path.
#   N2  the commit pathspec DROPPED   — `git commit -m msg` with no `-- <path>`.
#
#   O   the credential gate UNWIRED   — the screen still exists; the loop stops calling it.
#   P   a credential family DELETED   — the set SHRINKS by one.
#   Q   `injectionShape` ADDED        — the set GROWS by one.
#
# P AND Q ARE A PAIR AND NEITHER ALONE IS THE CONTROL. P proves the family set cannot shrink
# unnoticed. Q proves it cannot GROW unnoticed, which is the dangerous direction: sweeping in a
# family the safety policy deliberately dispositions as `route` would convert a Curator-review
# signal into a hard write-path refusal — re-deciding a posture this module does not own, silently,
# with every other gate here green. Q must red the ACCEPTANCE cell and the MEMBERSHIP cell, and the
# membership cell exists because a behavioural suite can only see the exclusion through whatever
# fixture it happens to drive.
#
# O IS THE 394-09 TWO-LAYER LESSON, MEASURED AGAIN. The gate can be defeated inside the screen or at
# its call site, and seven of that file's thirteen cells call the screen DIRECTLY — so they cannot
# see an unwired loop at all. Without this leg the suite would prove the screen correct and leave
# the wiring free.
#
# M IS THE 394-04 LESSON ON THIS PATH. A gate that refuses everything passes a refuse-only corpus,
# and a repo-wide dirty check passes every refusal cell in the file while making the feature
# unusable in any session where a person has edited anything at all. Only the ADMIT cells catch it.
#
# N IS TWO LEGS, AND THE SECOND ONE IS THE FINDING. This plan's brief named ONE mutation — `git add
# -A` — and said the one-file cell must fail because the commit picks up the unrelated dirty file.
# Measured: it does not. A `git commit -- <path>` builds its tree from the named paths and HEAD, so
# what is in the index is irrelevant to what lands in the commit, and `git add --all` cannot move
# the one-file cell at all. The add's pathspec and the commit's pathspec are therefore TWO controls
# guarding two different properties — what gets STAGED and what gets COMMITTED — and each needs its
# own leg and its own sole catcher. Keeping only the briefed mutation would have meant weakening the
# commit form until the mutation reddened, which is optimising for the differential instead of for
# the property.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS. So is a red naming a
# cell outside the allowed list.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# THE SUBJECT IS RESTORED FROM A BYTE SNAPSHOT AND EVERY RESTORE IS PROVEN. `git checkout --` cannot
# restore an uncommitted edit, so the snapshot is a `cp` copy and the sha256 is compared after each
# restore.
#
# NO DIST REBUILD BETWEEN LEGS, and that is measured rather than skipped: the subject and the suite
# are both in `packages/cli/src`, which vitest resolves from source. The preflight builds the
# packages this file imports THROUGH a dist (`schema`, `agent`, `agent-local`, `core`) once, and
# none of them is mutated.
#
# USAGE
#   bash agent-qa/scripts/394-apply-mutation.sh   # from the super-repository root
#   bash scripts/394-apply-mutation.sh            # from the agent-qa root
#
# KNOBS
#   APPLY_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation".

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SUBJECT_PATHS=(
  "packages/cli/src/composition/local-agent-host.ts"
  "packages/agent/src/authoring/loop.ts"
)

CLI_FILTER="agent-qa"
AGENT_FILTER="@vostride/agent-qa-agent"
APPLY_SUITE="src/__tests__/one-commit-apply.test.ts"
GATE_SUITE="src/authoring/__tests__/secret-guardrail.test.ts"

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

# M widens the dirty check to the whole repository. Every cell that puts an unrelated file in a
# dirty or staged state reds, and so does the argv cell that counts the pathspec-carrying lines —
# which is the same claim seen from the other side rather than collateral, because the pathspec IS
# the scoping.
ALLOWED_M="does NOT block on an unrelated dirty file elsewhere in the repository
keeps an unrelated STAGED file out of the commit
stages nothing but its own target
puts the -- operand separator before every caller-controlled path"
# N1 drops the STAGING pathspec. Its sole behavioural catcher is the index cell: the commit's own
# pathspec keeps the swept file out of the COMMIT, so the one-file cell stays green — which is
# exactly why the briefed single mutation was not enough.
ALLOWED_N1="stages nothing but its own target
puts the -- operand separator before every caller-controlled path
issues no --amend, no -a and no ref-moving subcommand"
# N2 drops the COMMIT pathspec. Its sole behavioural catcher is the staged-file cell — the one
# arrangement where a person's own work is already in the index when they accept.
ALLOWED_N2="keeps an unrelated STAGED file out of the commit
puts the -- operand separator before every caller-controlled path"
# O unwires the gate from the loop. The six cells that DRIVE the loop red; the seven that call the
# screen directly, or read the exported set, stay green — which is the whole reason this leg exists
# beside P and Q rather than being implied by them.
ALLOWED_O="refuses a draft whose step carries a
refuses a credential in the test NAME too"
# P deletes `pemKey`. Its own cell reds, the whole-set membership assertion reds, and the n-gram
# cell reds because it iterates the same corpus and that family no longer refuses at all. Every one
# is an assertion that the set still contains the deleted family.
ALLOWED_P="refuses a draft whose step carries a pemKey literal
excludes injectionShape and email, read off the exported constant itself
never repeats the matched value, nor any run of it longer than four characters"
# Q adds `injectionShape`. EXACTLY TWO cells red, and they are the pair the plan requires: the
# acceptance cell whose fixture makes that family fire, and the membership cell read off the value.
ALLOWED_Q="accepts an instruction-override string even though injectionShape FIRES on it
excludes injectionShape and email, read off the exported constant itself"

apply_mutation () {
  case "${APPLY_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    M)
      # "Refuse if the repository is dirty at all" — the check a reasonable person writes when they
      # are thinking about safety and not about who is using the repository at the time.
      perl -0pi -e "s/\['status', '--porcelain', '--', targetPath\]/['status', '--porcelain']/" \
        "$REPO_ROOT/packages/cli/src/composition/local-agent-host.ts" ;;
    N1)
      perl -0pi -e "s/\['add', '--', targetPath\]/['add', '--all']/" \
        "$REPO_ROOT/packages/cli/src/composition/local-agent-host.ts" ;;
    N2)
      perl -0pi -e "s/\['commit', '--quiet', '-m', message, '--', targetPath\]/['commit', '--quiet', '-m', message]/" \
        "$REPO_ROOT/packages/cli/src/composition/local-agent-host.ts" ;;
    O)
      perl -0pi -e 's/\n  screenDraftForCredentials\(draft\)\n/\n/' \
        "$REPO_ROOT/packages/agent/src/authoring/loop.ts" ;;
    P)
      perl -0pi -e "s/\n  'pemKey',//" \
        "$REPO_ROOT/packages/agent/src/authoring/loop.ts" ;;
    Q)
      perl -0pi -e "s/\n  'apiKey',\n\] as const/\n  'apiKey',\n  'injectionShape',\n] as const/" \
        "$REPO_ROOT/packages/agent/src/authoring/loop.ts" ;;
    *) echo "FATAL: unknown mutation $1" >&2; exit 1 ;;
  esac
}

run_leg () {
  local name="$1" label="$2" allowed="$3" filter="$4" suite="$5" prefix="$6"

  echo "=== MUTATION $name — $label"
  restore_subjects
  apply_mutation "$name"
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
  red="$(grep -oE "^ FAIL  $suite > .*" "$LOG" \
    | sed "s|^ FAIL  $suite > ||" | sed "s|^$prefix > ||" | sort -u)"
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
      exit 1
    fi
  done <<< "$red"

  restore_subjects
  local index=0
  for path in "${SUBJECT_PATHS[@]}"; do
    local restored
    restored="$(shasum -a 256 "$REPO_ROOT/$path" | cut -d' ' -f1)"
    if [ "$restored" != "${BASELINE_SHAS[$index]}" ]; then
      echo "FATAL: $path was not restored byte-identically ($restored)" >&2
      exit 1
    fi
    index=$((index + 1))
  done
  echo "  every subject restored byte-identically"
  echo
}

echo "=== PREFLIGHT — the pre-mutation suite must be green"
set +e
pnpm --filter @vostride/agent-qa-schema build > "$WORK/build.log" 2>&1 \
  && pnpm --filter @vostride/agent-qa-agent build >> "$WORK/build.log" 2>&1
BUILD_RC=$?
set -e
if [ "$BUILD_RC" -ne 0 ]; then
  echo "FATAL: the dependency rebuild failed — see $WORK/build.log" >&2
  exit 1
fi
for preflight in "$CLI_FILTER|$APPLY_SUITE" "$AGENT_FILTER|$GATE_SUITE"; do
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

APPLY_PREFIX="applyTestDraftAsOneCommit"

run_leg M  "the dirty check widened to the whole repository" "$ALLOWED_M" \
  "$CLI_FILTER" "$APPLY_SUITE" "$APPLY_PREFIX"
run_leg N1 "the staging pathspec dropped for git add --all"  "$ALLOWED_N1" \
  "$CLI_FILTER" "$APPLY_SUITE" "$APPLY_PREFIX"
run_leg N2 "the commit pathspec dropped"                     "$ALLOWED_N2" \
  "$CLI_FILTER" "$APPLY_SUITE" "$APPLY_PREFIX"
run_leg O  "the credential gate unwired from the loop"       "$ALLOWED_O" \
  "$AGENT_FILTER" "$GATE_SUITE" "a pasted credential never reaches an inbox"
run_leg P  "a credential family deleted from the set"        "$ALLOWED_P" \
  "$AGENT_FILTER" "$GATE_SUITE" ""
run_leg Q  "injectionShape added to the credential set"      "$ALLOWED_Q" \
  "$AGENT_FILTER" "$GATE_SUITE" ""

echo "PASS — an unrelated dirty file cannot block the apply, an unrelated staged file cannot"
echo "       join its commit, the apply stages nothing but the one file it wrote, and the"
echo "       credential family set can neither shrink nor grow without a cell saying so."
