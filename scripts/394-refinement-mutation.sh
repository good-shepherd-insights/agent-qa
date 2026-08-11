#!/usr/bin/env bash
#
# 394-refinement-mutation.sh — the acceptance bar for D-17, D-18 and D-19 (394-09).
#
# WHAT THIS PROVES, and why a green suite does not prove it. The cells passing say a refinement
# round happened, a procedure reached a prompt as words, and a weak name was refused. They do NOT
# say those suites would CATCH the implementations the three decisions forbid — and each of the
# three forbidden implementations is a change of a few tokens that reads as an improvement. A
# detector's acceptance bar is the implementation it must go RED on, never the suite it passes.
#
#   K  the refinement round GATED        — skipped when the first retrieval already returned results.
#   L  a lone weak match BOUND           — `none.closestSuggestion` promoted to a binding.
#   M  the record id RENDERED            — the served procedure's address put into the prompt.
#
# K IS TWO LEGS, AND THAT IS THE FINDING. The trigger heuristic D-18 rules out can be written at
# either layer, and the two are caught by different files. Gating inside `refineDraft` is caught by
# the always-runs cell, which drives a POPULATED first brief on purpose; gating at the call site in
# `loop.ts` is invisible to that file — it never enters the loop — and is caught instead by the
# procedure cells, whose fixture brief carries a procedure and which therefore reach a loop-level
# gate's condition. A script with only one leg would have proven the round unconditional at one
# layer and left the other free.
#
# L IS THE ONE THAT LOOKS LIKE HELPFULNESS. The shipped resolver answers `none` for a single
# candidate that cleared neither its absolute score nor its margin, and attaches the near miss so a
# surface can ask about it. Binding that field is one line, is what a reasonable person writes when
# a user complains their name "obviously" meant one thing, and is exactly the silent guess into a
# test file D-19 forbids. Only the low-confidence cell can catch it: `resolved` binds and
# `ambiguous` refuses under the mutation just as they do without it.
#
# M IS THE ONE THE TYPE SYSTEM ALMOST PREVENTS. `procedureStepVocabulary` takes an `Anchor` and has
# no id in scope, so the leak has to be written at the CALL SITE, in the renderer that holds the
# whole `ProcedureMatch`. That is the shape it would really arrive in — somebody adding "helpful
# provenance" to a prompt — and the cells that red are the ones scanning the prompt and the bytes.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS. So is a red naming a
# cell outside the allowed list: a differential that reds on collateral has shown the corpus is
# fragile, not that it catches what it forbids.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE. Every measured command writes to a log
# FILE and its status is captured with `set +e` / `rc=$?` / `set -e`.
#
# THE SUBJECTS ARE RESTORED FROM BYTE SNAPSHOTS AND EVERY RESTORE IS PROVEN. `git checkout --`
# cannot restore an uncommitted edit, so the snapshots are `cp` copies taken before the first
# mutation and the sha256 is compared after each restore.
#
# DEPENDENCY DISTS ARE REBUILT BEFORE EVERY LEG. `agent` resolves `schema` through its built `dist`,
# so a mutation to a `schema` source that is not rebuilt measures the PREVIOUS implementation — a
# differential that reports green for the best possible reason and the worst one identically.
#
# USAGE
#   bash agent-qa/scripts/394-refinement-mutation.sh   # from the super-repository root
#   bash scripts/394-refinement-mutation.sh            # from the agent-qa root
#
# KNOBS
#   REFINEMENT_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation". A mutation script that cannot fail when its mutation does
#       nothing is measuring nothing, and this is how that is checked without hand-editing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SUBJECT_PATHS=(
  "packages/agent/src/authoring/refine.ts"
  "packages/agent/src/authoring/loop.ts"
  "packages/agent/src/authoring/entity-binding.ts"
  "packages/agent/src/authoring/brief-blocks.ts"
)

SCHEMA_FILTER="@vostride/agent-qa-schema"
AGENT_FILTER="@vostride/agent-qa-agent"

REFINE_SUITE="src/authoring/__tests__/refine.test.ts"
BINDING_SUITE="src/authoring/__tests__/entity-binding.test.ts"
PROCEDURE_SUITE="src/authoring/__tests__/procedure-anchor.test.ts"

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

# Each mutation's allowed red cells, spelled as vitest prints them. Every entry is an assertion
# about the property the mutation removes.
#
# K1 gates inside `refineDraft`, and it reds 8 of 11 — every cell that observes the round actually
# HAPPENING, which in a file about the round is most of them. That breadth is honest rather than
# blunt: the fixture brief is POPULATED for every cell (which is the point — it is the input a
# trigger skips), so the gate fires everywhere and each red is the same assertion seen from a
# different angle. The three that survive are the ones that never reach the model call: the query
# builder is pure, and the retrieval still happens ABOVE the gate. That is why K1 alone would not
# have proven the round runs, and why the always-runs cell is written to name the condition.
ALLOWED_K1="runs even when the FIRST retrieval already returned facts
is pinned at exactly one round
keys the second retrieval on the draft own steps and name
shows the model the draft it is refining
hands the parsed patch set to the CST applier port
keeps the draft when the emission is not JSON at all
keeps the draft when the emission is JSON that is not a patch set
keeps the draft when the applier REFUSES the patch set
keeps the draft when the patched document no longer parses"
# K2 gates at the CALL SITE in `loop.ts`, which `refine.test.ts` cannot see at all. The procedure
# suite drives the whole loop over a brief carrying a procedure, so its two-call cell reds.
ALLOWED_K2="shows both stage-3 calls the vocabulary and neither of them the address"
# L binds a lone weak match, and reds exactly the two cells whose input IS one: the direction cell
# and the whole-set cell, which uses the same `closestSuggestion` fixture to show a refusal is not
# partial. `resolved` still binds and `ambiguous` still refuses under the mutation, which is the
# point — three of the four directions are satisfied by the implementation D-19 forbids.
ALLOWED_L="does not promote closestSuggestion to a binding
refuses the WHOLE set when one name of several cannot be bound"
# M renders the record id into the procedure line. Every cell that scans for the address reds.
ALLOWED_M="renders NO record id
shows both stage-3 calls the vocabulary and neither of them the address
writes bytes that contain no record identifier
renders the flow anchor own words in the knowledge block"

apply_mutation () {
  case "${REFINEMENT_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    K1)
      # "The retrieval already answered; nothing new to add." The trigger heuristic, written the way
      # somebody would actually write it — after the retrieval, as an early return that looks like
      # an economy rather than a policy.
      perl -0pi -e 's/  const request = buildTieredPrompt\(\{\n    agent_context: AUTHORING_REFINE_AGENT_CONTEXT,/  if (brief.facts.length > 0) return { kind: \x27no-op\x27, draft, thoughts: \x27\x27 }\n\n  const request = buildTieredPrompt({\n    agent_context: AUTHORING_REFINE_AGENT_CONTEXT,/' \
        "$REPO_ROOT/packages/agent/src/authoring/refine.ts" ;;
    K2)
      # The same policy at the CALL SITE, keyed on the STAGE-1 brief — the layer `refine.test.ts`
      # cannot observe, which is why this leg exists beside K1.
      perl -0pi -e 's/  const refinement = await refineDraft\(compiled, input, deps\)/  const refinement = brief.procedures.length > 0 || brief.facts.length > 0\n    ? { kind: \x27no-op\x27 as const, draft: compiled, thoughts: \x27\x27 }\n    : await refineDraft(compiled, input, deps)/' \
        "$REPO_ROOT/packages/agent/src/authoring/loop.ts" ;;
    L)
      perl -0pi -e 's/      case \x27none\x27:\n(?:.*\n)*?        throw new UnresolvedEntityNameError\(\n          name,\n          resolution\.reason,\n          resolution\.closestSuggestion,\n        \)/      case \x27none\x27:\n        if (resolution.closestSuggestion !== undefined) {\n          bindings.push({ name, source: \x27resolver\x27, ref: resolution.closestSuggestion })\n          break\n        }\n        throw new UnresolvedEntityNameError(\n          name,\n          resolution.reason,\n          resolution.closestSuggestion,\n        )/' \
        "$REPO_ROOT/packages/agent/src/authoring/entity-binding.ts" ;;
    M)
      # The leak has to be written at the CALL SITE: `procedureStepVocabulary` takes an anchor and
      # has no id in scope, which is the mitigation. This is the shape it would arrive in.
      # No `$` anywhere in the replacement: perl interpolates the replacement side, so a template
      # literal written literally here is read as a subroutine call and the leg dies before it
      # measures anything. String concatenation says the same thing and survives the substitution.
      perl -0pi -e 's/\(procedure\) => `PROCEDURE: [^`]*`,/(procedure) => \x27PROCEDURE: [\x27 + String(procedure.id) + \x27] \x27 + procedureStepVocabulary(procedure.flowAnchor),/' \
        "$REPO_ROOT/packages/agent/src/authoring/brief-blocks.ts" ;;
    *) echo "FATAL: unknown mutation $1" >&2; exit 1 ;;
  esac
}

rebuild_dists () {
  # schema -> agent, the resolution order. Read from the process, never a pipe.
  set +e
  pnpm --filter "$SCHEMA_FILTER" build > "$WORK/build.log" 2>&1 \
    && pnpm --filter "$AGENT_FILTER" build >> "$WORK/build.log" 2>&1
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: the dependency rebuild failed — see $WORK/build.log" >&2
    restore_subjects
    exit 1
  fi
}

run_leg () {
  local name="$1" label="$2" allowed="$3" filter="$4" suite="$5"

  echo "=== MUTATION $name — $label"
  restore_subjects
  apply_mutation "$name"
  local path
  for path in "${SUBJECT_PATHS[@]}"; do
    echo "  $path sha256 $(shasum -a 256 "$REPO_ROOT/$path" | cut -d' ' -f1)"
  done
  rebuild_dists

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
  rebuild_dists
  echo "  every subject restored byte-identically"
  echo
}

echo "=== PREFLIGHT — the pre-mutation suites must be green"
rebuild_dists
for suite in "$REFINE_SUITE" "$BINDING_SUITE" "$PROCEDURE_SUITE"; do
  set +e
  pnpm --filter "$AGENT_FILTER" exec vitest run "$suite" > "$LOG" 2>&1
  PREFLIGHT_RC=$?
  set -e
  echo "  $suite exited $PREFLIGHT_RC"
  grep -E '^      Tests' "$LOG" || true
  if [ "$PREFLIGHT_RC" -ne 0 ]; then
    echo "FATAL: $suite is already red before any mutation" >&2
    exit 1
  fi
done
echo

run_leg K1 "the refinement round gated inside refineDraft" "$ALLOWED_K1" "$AGENT_FILTER" "$REFINE_SUITE"
run_leg K2 "the refinement round gated at the loop call site" "$ALLOWED_K2" "$AGENT_FILTER" "$PROCEDURE_SUITE"
run_leg L "a lone weak match bound instead of refused" "$ALLOWED_L" "$AGENT_FILTER" "$BINDING_SUITE"
run_leg M "the served procedure record id rendered into the prompt" "$ALLOWED_M" "$AGENT_FILTER" "$PROCEDURE_SUITE"

echo "PASS — the refinement round is unconditional at BOTH layers, a lone weak match refuses"
echo "       rather than binding, and no learned-shelf record id reaches an authored test."
