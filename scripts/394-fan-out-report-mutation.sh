#!/usr/bin/env bash
#
# 394-fan-out-report-mutation.sh — the fan-out REPORT's acceptance bar (WTST-08 · 394-14).
#
# WHAT THIS PROVES, and why a green suite does not prove it. `scripts/394-fan-out-mutation.sh` is
# the bound's differential: ONE ARITHMETIC, so the preview a person approves and the figure they
# are later shown cannot be two sums. This file is the other half — ONE RENDERER. The chat receipt
# now carries the report, and a receipt that HAND-FORMATTED the sentence would be indistinguishable
# from one that called `renderFanOutReport` for exactly as long as the two agree. That is what makes
# a copied sentence dangerous rather than merely redundant: it is invisible until a phrase moves,
# and the moment it moves the confirm and the receipt are telling one person two different things
# about the same nine runs.
#
# A DETECTOR'S ACCEPTANCE BAR IS THE IMPLEMENTATION IT MUST GO RED ON, never the suite it passes.
# So each mutation below edits the shipped source into an implementation 394-14 forbids:
#
#   R  the receipt HAND-FORMATS the report, then the phrase table is retuned
#   S  the D-18 exception widened from one op to every op
#   T  the typed parse replaced by a cast, so anything shaped like a result is rendered
#
# R IS TWO EDITS, AND IT HAS TO BE — the same argument `394-fan-out-mutation.sh` mutation I makes
# for a second arithmetic. A copied sentence is not observable while the copy and the renderer say
# the same words, so the mutation copies the sentence AND retunes `FAN_OUT_PHRASES.reportLead`. The
# cells that compare the receipt line against `renderFanOutReport` computed fresh are what red. A
# cell pinning a restated string literal would have stayed green through both edits, which is why
# no assertion in the measured suite spells the sentence out.
#
# THE THREE RED SETS ARE DISJOINT, AND THAT IS THE POINT OF HAVING THREE. R reds the two rendered-
# line cells; S reds the other-op cell alone; T reds the unparsable-result cell alone. A file whose
# mutations all red the same rows would have proven its cells are restatements of one another —
# here each mutation names a different property, and the allowed lists below are the proof.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS. So is a red naming a
# cell outside the allowed list: a differential that reds on collateral has shown the corpus is
# fragile, not that it catches what it forbids.
#
# THE MUTATIONS ARE ANCHORED, AND A MISSING ANCHOR IS FATAL. Each edit is an exact substring swap
# performed by `node`, and a source whose anchor text has drifted stops the run by name instead of
# applying nothing and reporting whatever the untouched tree does. A `perl -0pi` substitution that
# matches nothing exits 0 and mutates nothing, which is a differential silently measuring the
# shipped implementation against itself.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE. Every measured command writes to a log
# FILE and its status is captured with `set +e` / `rc=$?` / `set -e`.
#
# THE SUBJECTS ARE RESTORED FROM BYTE SNAPSHOTS AND EVERY RESTORE IS PROVEN. `git checkout --`
# cannot restore an uncommitted edit, so the snapshots are `cp` copies taken before the first
# mutation and the sha256 is compared after each restore.
#
# DEPENDENCY DISTS ARE REBUILT BEFORE EVERY LEG. The measured suite reads `renderFanOutReport` and
# `FAN_OUT_PHRASES` through `@vostride/agent-qa-schema`'s built `dist`, so a schema source mutated
# and not rebuilt measures the PREVIOUS wording — a differential that would report green for the
# best possible reason and the worst possible one identically.
#
# USAGE
#   bash agent-qa/scripts/394-fan-out-report-mutation.sh   # from the super-repository root
#   bash scripts/394-fan-out-report-mutation.sh            # from the agent-qa root
#
# KNOBS
#   FAN_OUT_REPORT_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation". A mutation script that cannot fail when its mutation does
#       nothing is measuring nothing, and this is how that is checked without hand-editing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SUBJECT_PATHS=(
  "packages/schema/src/authoring/fan-out.ts"
  "packages/agent/src/chat/turn-engine.ts"
)

SCHEMA_FILTER="@vostride/agent-qa-schema"
AGENT_FILTER="@vostride/agent-qa-agent"

SUITE="src/chat/__tests__/turn-engine-compound.test.ts"

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

# ---- the anchored substring swap ---------------------------------------------------------------
#
# `from` and `to` arrive as FILES written by literal heredocs, so nothing in the replacement text is
# interpreted by a shell, by perl, or by a regex engine. Template literals, `${…}` and backticks —
# all of which appear in the code being swapped — are ordinary bytes here.
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

# --- R, edit 1: the receipt copies the sentence instead of calling the one render.
cat > "$WORK/r1.from" <<'ANCHOR'
  const report = FanOutReportSchema.safeParse(carried)
  return report.success ? `${line} — ${renderFanOutReport(report.data)}` : line
ANCHOR
cat > "$WORK/r1.to" <<'ANCHOR'
  const report = FanOutReportSchema.safeParse(carried)
  if (!report.success) return line
  const copied = `Runs consumed: ${String(report.data.consumedTotal)} `
    + `(previewed up to ${String(report.data.previewed.total)})`
  return report.data.exceedsPreview
    ? `${line} — ${copied} — THIS EXCEEDS THE PREVIEWED BOUND — report this, it is a defect in `
      + 'the bound'
    : `${line} — ${copied}`
ANCHOR

# --- R, edit 2: the phrase moves. With ONE renderer this is invisible; with a copy it is a
#     divergence, and the divergence is the whole measurement.
cat > "$WORK/r2.from" <<'ANCHOR'
  reportLead: 'Runs consumed:',
ANCHOR
cat > "$WORK/r2.to" <<'ANCHOR'
  reportLead: 'Runs actually spent:',
ANCHOR

# --- S: the exception stops being one op's.
cat > "$WORK/s1.from" <<'ANCHOR'
  if (functionId !== AUTHORING_DRAFT_WRITE_FUNCTION_ID) return line
ANCHOR
cat > "$WORK/s1.to" <<'ANCHOR'
  void AUTHORING_DRAFT_WRITE_FUNCTION_ID
ANCHOR

# --- T: the typed parse becomes a cast, so a malformed result reaches the renderer.
cat > "$WORK/t1.from" <<'ANCHOR'
  const report = FanOutReportSchema.safeParse(carried)
  return report.success ? `${line} — ${renderFanOutReport(report.data)}` : line
ANCHOR
cat > "$WORK/t1.to" <<'ANCHOR'
  void FanOutReportSchema
  return `${line} — ${renderFanOutReport(carried as never)}`
ANCHOR

TURN_ENGINE="packages/agent/src/chat/turn-engine.ts"
FAN_OUT="packages/schema/src/authoring/fan-out.ts"

# Each mutation's allowed red cells, spelled as vitest prints them. THE THREE LISTS ARE DISJOINT,
# which is what proves the cells are not restatements of one another.
ALLOWED_R="extends the outcome line with the RENDERER
puts the same rendered line on the LOG"
ALLOWED_S="leaves every OTHER op"
ALLOWED_T="renders NOTHING extra when the result carries no parsable report"

apply_mutation () {
  case "${FAN_OUT_REPORT_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    R)
      swap "$TURN_ENGINE" "$WORK/r1.from" "$WORK/r1.to"
      swap "$FAN_OUT" "$WORK/r2.from" "$WORK/r2.to" ;;
    S)
      swap "$TURN_ENGINE" "$WORK/s1.from" "$WORK/s1.to" ;;
    T)
      swap "$TURN_ENGINE" "$WORK/t1.from" "$WORK/t1.to" ;;
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
  local name="$1" label="$2" allowed="$3"

  echo "=== MUTATION $name — $label"
  restore_subjects
  apply_mutation "$name"
  local path
  for path in "${SUBJECT_PATHS[@]}"; do
    echo "  $path sha256 $(shasum -a 256 "$REPO_ROOT/$path" | cut -d' ' -f1)"
  done
  rebuild_dists

  set +e
  pnpm --filter "$AGENT_FILTER" exec vitest run "$SUITE" > "$LOG" 2>&1
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

echo "=== PREFLIGHT — the pre-mutation suite must be green"
rebuild_dists
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

run_leg R "the receipt hand-formats the report, then the phrase is retuned" "$ALLOWED_R"
run_leg S "the D-18 exception widened from one op to every op" "$ALLOWED_S"
run_leg T "the typed parse replaced by a cast" "$ALLOWED_T"

echo "PASS — the receipt line is the RENDERER's own sentence, the D-18 exception is one field on"
echo "       one op, and a malformed result is refused by the schema rather than rendered."
