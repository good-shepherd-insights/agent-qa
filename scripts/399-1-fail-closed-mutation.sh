#!/usr/bin/env bash
#
# 399-1-fail-closed-mutation.sh — the D-03 fail-closed guard's acceptance bar (399.1-04).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. D-03's asymmetry is the whole of the
# G-399-2 repair: a result the declared fold cannot read reports `failed`/`unclassifiable-result`
# and NEVER `executed`, because an unreadable result might be a refusal and success is the one claim
# a receipt must not default to. Plan 01 shipped that guard with nothing driving its refusing
# branches; plan 03 drove two of them with a shipped op; plan 04 makes `classify` REQUIRED, which is
# what finally gives the remaining two a constructible input — an op with no fold at all, and a fold
# answering a structurally-valid non-verdict.
#
# A DETECTOR'S ACCEPTANCE BAR IS THE IMPLEMENTATION IT MUST GO RED ON, never the suite it passes.
# The cells added in 399.1-04 all assert the same three words, so a reader is entitled to ask
# whether they would notice a guard that had quietly gone fail-OPEN. Each mutation below edits the
# shipped source into an implementation D-03 forbids:
#
#   U  the absent-classifier branch goes fail-OPEN — the pre-399.1-04 legacy `executed`
#   V  the verdict CHECK becomes a shape sniff, so any object at all is put on a receipt
#
# THE TWO RED SETS ARE DISJOINT, AND THAT IS THE POINT OF HAVING TWO. U reds the absent-fold cell
# alone; V reds the two non-verdict cells and neither of the others. A file whose mutations all red
# the same rows would have proven its cells are restatements of one another.
#
# NEITHER MUTATION MAY RED THE CONTROL. `control: a probe answering a REAL verdict is reported
# verbatim` is what stops the four assertions above it from passing against a wrapper that answers
# `unclassifiable-result` for everything — a wrapper that would also destroy every real verdict in
# the product. A mutation that red it would be attacking the wrong property, and the allowed lists
# below say so by omission: a red outside the list is FATAL.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# THE MUTATIONS ARE ANCHORED, AND A MISSING ANCHOR IS FATAL — a substitution that matches nothing
# exits 0 and measures the shipped implementation against itself.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# THE SUBJECT IS RESTORED FROM A BYTE SNAPSHOT AND EVERY RESTORE IS PROVEN. `git checkout --` cannot
# restore an uncommitted edit, so the snapshot is a `cp` copy taken before the first mutation and
# the sha256 is compared after each restore.
#
# THE AGENT DIST IS REBUILT BEFORE EVERY LEG for the stale-dist reason this repo has been bitten by:
# a mutated source that was not rebuilt measures the previous build, and reports green for the best
# possible reason and the worst possible one identically.
#
# USAGE
#   bash agent-qa/scripts/399-1-fail-closed-mutation.sh   # from the super-repository root
#   bash scripts/399-1-fail-closed-mutation.sh            # from the agent-qa root
#
# KNOBS
#   FAIL_CLOSED_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation". A mutation script that cannot fail when its mutation does
#       nothing is measuring nothing, and this is how that is checked without hand-editing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SUBJECT="packages/agent/src/functions/classify.ts"
AGENT_FILTER="@vostride/agent-qa-agent"
SUITE="src/functions/__tests__/refusal-classifiers.test.ts"

WORK="$(mktemp -d)"
LOG="$WORK/leg.log"
SNAPSHOT="$WORK/classify.snapshot"

restore_subject () { cp "$SNAPSHOT" "$REPO_ROOT/$SUBJECT" 2>/dev/null || true; }
trap 'restore_subject; rm -rf "$WORK"' EXIT

cp "$REPO_ROOT/$SUBJECT" "$SNAPSHOT"
BASELINE_SHA="$(shasum -a 256 "$SNAPSHOT" | cut -d' ' -f1)"
echo "subject   $SUBJECT"
echo "  sha256  $BASELINE_SHA"
echo

# ---- the anchored substring swap ---------------------------------------------------------------
#
# `from` and `to` arrive as FILES written by literal heredocs, so nothing in the replacement text is
# interpreted by a shell, by perl, or by a regex engine.
swap () {
  local file="$1" from="$2" to="$3"
  node -e '
    const fs = require("fs")
    const [file, fromPath, toPath] = process.argv.slice(1)
    const source = fs.readFileSync(file, "utf8")
    const from = fs.readFileSync(fromPath, "utf8")
    const to = fs.readFileSync(toPath, "utf8")
    if (!source.includes(from)) {
      console.error("FATAL: mutation anchor not found in " + file)
      process.exit(1)
    }
    fs.writeFileSync(file, source.replace(from, to))
  ' "$REPO_ROOT/$file" "$from" "$to"
}

# --- U: the absent-classifier branch answers the pre-399.1-04 legacy verdict. This is not a straw
#     man — it is the exact line this plan deleted, and it was correct while `classify` was
#     optional. What makes it wrong now is that an absent fold means a cast got past `tsc` and past
#     the conformance census, so `executed` is a receipt certifying a claim nothing substantiates.
cat > "$WORK/u.from" <<'ANCHOR'
  if (typeof spec.classify !== 'function') return UNCLASSIFIABLE
ANCHOR
cat > "$WORK/u.to" <<'ANCHOR'
  if (typeof spec.classify !== 'function') return { status: 'executed', outcome: '' }
ANCHOR

# --- V: the verdict check becomes a shape sniff. Any object at all is accepted, so a fold's
#     invented status word reaches the receipt, the session log and the goldens. The `null` guard is
#     kept deliberately: without it the plan-03 cell that hands the fold `null` would red too, and
#     the two red sets would stop being disjoint.
cat > "$WORK/v.from" <<'ANCHOR'
  const candidate = value as { status?: unknown; outcome?: unknown }
  if (typeof candidate.outcome !== 'string') return false
  return candidate.status === 'executed' || candidate.status === 'refused'
    || candidate.status === 'failed'
ANCHOR
cat > "$WORK/v.to" <<'ANCHOR'
  void (value as { status?: unknown; outcome?: unknown })
  return true
ANCHOR

# Each mutation's allowed red cells, spelled as vitest prints them. THE TWO LISTS ARE DISJOINT,
# which is what proves the cells are not restatements of one another.
ALLOWED_U="for an op that declares NO fold at all"
ALLOWED_V="for a WELL-FORMED answer that is not a verdict
when the OUTCOME is not a string"

apply_mutation () {
  case "${FAIL_CLOSED_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    U) swap "$SUBJECT" "$WORK/u.from" "$WORK/u.to" ;;
    V) swap "$SUBJECT" "$WORK/v.from" "$WORK/v.to" ;;
    *) echo "FATAL: unknown mutation $1" >&2; exit 1 ;;
  esac
}

rebuild_dist () {
  set +e
  pnpm --filter "$AGENT_FILTER" build > "$WORK/build.log" 2>&1
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: the agent rebuild failed — see $WORK/build.log" >&2
    restore_subject
    exit 1
  fi
}

run_leg () {
  local name="$1" label="$2" allowed="$3"

  echo "=== MUTATION $name — $label"
  restore_subject
  apply_mutation "$name"
  echo "  $SUBJECT sha256 $(shasum -a 256 "$REPO_ROOT/$SUBJECT" | cut -d' ' -f1)"
  rebuild_dist

  set +e
  pnpm --filter "$AGENT_FILTER" exec vitest run "$SUITE" > "$LOG" 2>&1
  local rc=$?
  set -e
  echo "  leg exited $rc"
  grep -E '^      Tests' "$LOG" || true

  if [ "$rc" -eq 0 ]; then
    echo "FATAL: the suite stayed green under the mutation — mutation $name measures nothing" >&2
    restore_subject
    exit 1
  fi

  local red
  red="$(grep -oE "^ FAIL  $SUITE > .*" "$LOG" | sed "s|^ FAIL  $SUITE > ||" | sort -u)"
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
      restore_subject
      exit 1
    fi
  done <<< "$red"

  restore_subject
  local restored
  restored="$(shasum -a 256 "$REPO_ROOT/$SUBJECT" | cut -d' ' -f1)"
  if [ "$restored" != "$BASELINE_SHA" ]; then
    echo "FATAL: $SUBJECT was not restored byte-identically ($restored)" >&2
    exit 1
  fi
  rebuild_dist
  echo "  subject restored byte-identically"
  echo
}

echo "=== PREFLIGHT — the pre-mutation suite must be green"
rebuild_dist
set +e
pnpm --filter "$AGENT_FILTER" exec vitest run "$SUITE" > "$LOG" 2>&1
PREFLIGHT_RC=$?
set -e
echo "  $SUITE exited $PREFLIGHT_RC"
grep -E '^      Tests' "$LOG" || true
if [ "$PREFLIGHT_RC" -ne 0 ]; then
  echo "FATAL: $SUITE is already red before any mutation" >&2
  exit 1
fi
echo

run_leg U "the absent-classifier branch goes fail-OPEN" "$ALLOWED_U"
run_leg V "the verdict check becomes a shape sniff" "$ALLOWED_V"

echo "PASS — an op with no fold reports failed rather than executed, and a fold answering something"
echo "       that is not a verdict is refused rather than put on a receipt."
