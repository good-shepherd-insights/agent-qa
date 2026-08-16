#!/usr/bin/env bash
#
# 397-regen-golden.sh — the ONE writer of the golden capability ledger (Phase 397 plan 06, D-07).
#
# WHAT THIS IS FOR, IN ONE LINE: a capability ledger must not be one keystroke from silently
# blessed. `packages/cli/src/__tests__/conformance/golden-registry.json` records every registered
# capability's scopes, risk class, disclosure flag, binding status at the composition root, schema
# digests and MCP partition. A widened scope or a lowered risk tier is a one-line diff in that file
# — which is worth exactly as much as the discipline around changing it. So:
#
#   * NO TEST-RUNNER UPDATE PATH REACHES IT. There is no snapshot, no `-u`, no `--update`. Nothing
#     under `src/__tests__/conformance/` opens the ledger for writing at all, and `parity.test.ts`
#     asserts that as source over every file in the directory, including files added later. The
#     suite offers this script a PRINT between sentinels; the writing happens here.
#   * THE REGEN REFUSES WHILE THE SUITE IS RED FOR ANY OTHER REASON. A regeneration run against a
#     broken tree would launder the breakage into the ledger — the ledger would faithfully record
#     whatever the broken tree declares, and the reviewer would see a diff with no failing test
#     beside it. The only failure allowed through the gate is the golden-diff cell itself, by exact
#     name (see ALLOWED_RED).
#   * THE GATE IS SELF-TESTING. `--selftest` injects a deliberately failing probe into the suite and
#     requires the refusal to fire, then requires the gate to pass again once the probe is removed.
#     A gate nobody has seen fire is a comment.
#   * WRITING IS EXPLICIT. Without `--write` this script prints the diff and touches nothing.
#
# ONE RECIPE, NEVER TWO. The ledger this script emits is built by `buildGoldenRows` in
# `golden.ts` — the same function the diff leg compares against. A regen that re-derived the rows
# its own way would agree with whatever the code does on the day it ran, which is a golden that
# pins nothing: the file would be a photograph of the code taken by the code.
#
# STALE DIST IS A REAL FAILURE MODE HERE. The cli tests resolve `@vostride/agent-qa-*` through built
# `dist`, so a ledger minted against a stale build pins the PREVIOUS build's contracts. The
# workspace is therefore rebuilt in dependency order before anything is measured.
#
# USAGE
#   bash agent-qa/scripts/397-regen-golden.sh              # from the super-repository root
#   bash scripts/397-regen-golden.sh                       # from the agent-qa root: mint + diff only
#   bash scripts/397-regen-golden.sh --write               # …and overwrite the committed ledger
#   bash scripts/397-regen-golden.sh --selftest            # prove the refuse-while-red gate fires
#   bash scripts/397-regen-golden.sh --no-build            # skip the rebuild (iteration only)
#   bash scripts/397-regen-golden.sh --gate-only           # INTERNAL: run the gate, exit 0/1
#
# Case lookups and plain functions rather than associative arrays: macOS ships bash 3.2, where
# `declare -A` silently becomes an indexed array and every named key reads as unbound under `set -u`.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="$ROOT/packages/cli"
SUITE_REL="src/__tests__/conformance/"
GOLDEN_REL="packages/cli/src/__tests__/conformance/golden-registry.json"
GOLDEN="$ROOT/$GOLDEN_REL"

# ── The pins. Every one of these is a deliberate-commit knob, not a default. ────────────────────
#
# The ONE failure the gate lets through, by EXACT full name. Exact rather than a pattern: a pattern
# is a hole that widens on its own, and this list is the whole of what "refuses while red" means.
ALLOWED_RED="the parity suite ranges the registry census over every rostered surface matches the committed golden registry, op by op and field by field"
# Vacuity floor. A gate that passed because the suite collected nothing is the CI-shaped version of
# the failure this whole phase exists to prevent. Measured 2026-08-16: 71 tests in the directory.
FROZEN_MIN_TESTS=60
# The ledger's own floor, so a mint that produced a truncated or empty file cannot be written.
# Measured 2026-08-16: the registry census is 41 capabilities and is frozen for this phase (D-17).
FROZEN_MIN_ROWS=41

EMIT_FLAG="AGENT_QA_397_GOLDEN_EMIT"
EMIT_BEGIN="<<<397-06-GOLDEN-BEGIN>>>"
EMIT_END="<<<397-06-GOLDEN-END>>>"
SELFTEST_PROBE="$CLI_DIR/src/__tests__/conformance/397-regen-selftest-probe.test.ts"

MODE="run"
DO_BUILD=1
for arg in "$@"; do
  case "$arg" in
    --write) MODE="write" ;;
    --selftest) MODE="selftest" ;;
    --gate-only) MODE="gate-only" ;;
    --no-build) DO_BUILD=0 ;;
    *) echo "FATAL: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

fatal() { echo "FATAL: $*" >&2; exit 1; }
note() { echo "[397-regen-golden] $*" >&2; }

# PORTABLE FORM, DELIBERATELY. `mktemp -d -t <prefix>` is a BSD idiom: on macOS it appends random
# characters to the prefix, on GNU coreutils the same call FAILS with "too few X's in template".
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/397regen.XXXXXXXX")"

cleanup() {
  # The probe is removed unconditionally and first: a selftest interrupted half way through must
  # not leave a deliberately failing test file in the suite.
  [ -f "$SELFTEST_PROBE" ] && rm -f "$SELFTEST_PROBE"
  [ -n "${SANDBOX:-}" ] && [ -d "$SANDBOX" ] && rm -rf "$SANDBOX"
  return 0
}
trap cleanup EXIT

# ── Helper programs. Written to files, never passed as shell strings: a quoted argument mangled by
# the shell is how a harness ends up measuring an implementation nobody wrote.
cat > "$SANDBOX/classify.mjs" <<'CLASSIFY_MJS'
// Read vitest's JSON report and classify the failures against the ONE allowed red.
// Prints `TOTAL=<n>` then one `UNEXPECTED <full name>` line per failure outside the allow-list, and
// one `ALLOWED <full name>` line for each failure inside it. Decides nothing; bash decides.
import { readFileSync } from 'node:fs'
const [, , reportPath, allowed] = process.argv
let report
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch (err) {
  process.stdout.write(`UNREADABLE ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(0)
}
const results = Array.isArray(report.testResults) ? report.testResults : []
process.stdout.write(`TOTAL=${Number(report.numTotalTests ?? 0)}\n`)
for (const file of results) {
  for (const assertion of file.assertionResults ?? []) {
    if (assertion.status !== 'failed') continue
    const name = String(assertion.fullName ?? '')
    process.stdout.write(`${name === allowed ? 'ALLOWED' : 'UNEXPECTED'} ${name}\n`)
  }
}
CLASSIFY_MJS

cat > "$SANDBOX/inspect.mjs" <<'INSPECT_MJS'
// Answer two questions about a minted ledger with one parse: is it valid JSON at all, and how many
// rows does it carry. A mint that produced a truncated document must never reach the committed file.
import { readFileSync } from 'node:fs'
try {
  const ledger = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const rows = Array.isArray(ledger.rows) ? ledger.rows.length : -1
  process.stdout.write(`ROWS=${rows}\nCOUNT=${Number(ledger.opCount ?? -1)}\n`)
} catch (err) {
  process.stdout.write(`ROWS=-1\nCOUNT=-1\nERROR=${err instanceof Error ? err.message : err}\n`)
}
INSPECT_MJS

cat > "$SANDBOX/probe.test.ts" <<'PROBE_TS'
// TRANSIENT — written by `scripts/397-regen-golden.sh --selftest` and removed by its EXIT trap.
//
// The gate this script carries refuses to regenerate the ledger while the conformance suite is red
// for any reason other than the golden-diff cell itself. This file is the deliberate other reason:
// it fails by name, so the selftest can observe the refusal fire instead of assuming it would.
import { describe, expect, it } from 'vitest'

describe('397-06 regen selftest probe', () => {
  it('fails on purpose so the refuse-while-red gate can be observed firing', () => {
    expect('the regen gate must refuse while this is red').toBe('and it must say which cell')
  })
})
PROBE_TS

# ── The gate ────────────────────────────────────────────────────────────────────────────────────
#
# Runs the conformance suite and refuses on any failure that is not the golden-diff cell. The suite
# is NOT run with the golden leg filtered out by the runner: the leg stays in and its failure is
# classified by name. That is stricter than an exclusion — an exclusion would also hide a golden
# cell that broke for a reason having nothing to do with the ledger's contents.
run_gate() {
  local report="$SANDBOX/results.$$.json"
  note "gate: running the conformance suite"
  # The exit code is read from the process, never through a pipe, and a red suite is EXPECTED here
  # (the golden-diff cell) so the run itself must not abort the script under `set -e`.
  (cd "$CLI_DIR" && npx vitest run "$SUITE_REL" --reporter=json --outputFile="$report") \
    > "$SANDBOX/gate.stdout" 2>&1 || true

  [ -f "$report" ] || fatal "the suite produced no JSON report — it did not run at all"

  local classified
  classified="$(node "$SANDBOX/classify.mjs" "$report" "$ALLOWED_RED")"

  case "$classified" in
    UNREADABLE*) fatal "the suite's JSON report could not be read: ${classified#UNREADABLE }" ;;
  esac

  local total
  total="$(printf '%s\n' "$classified" | sed -n 's/^TOTAL=//p')"
  [ -n "$total" ] || fatal "the suite's JSON report carried no test total"
  if [ "$total" -lt "$FROZEN_MIN_TESTS" ]; then
    fatal "the suite ran $total tests, fewer than the frozen floor of $FROZEN_MIN_TESTS — a gate that passes because nothing ran is not a gate"
  fi
  note "gate: $total tests collected"

  local unexpected
  unexpected="$(printf '%s\n' "$classified" | sed -n 's/^UNEXPECTED //p')"
  if [ -n "$unexpected" ]; then
    echo "FATAL: the conformance suite is red for a reason other than the golden ledger:" >&2
    printf '  - %s\n' "$unexpected" >&2
    echo "REFUSING to regenerate. A regeneration against a red tree records whatever that tree" >&2
    echo "declares, and the reviewer sees a ledger diff with no failing test beside it. Fix the" >&2
    echo "failures above first (D-07)." >&2
    exit 1
  fi

  local allowed
  allowed="$(printf '%s\n' "$classified" | sed -n 's/^ALLOWED //p')"
  if [ -n "$allowed" ]; then
    note "gate: the golden-diff cell is red, as expected before a regeneration"
  else
    note "gate: the golden-diff cell is green — the committed ledger already matches the tree"
  fi
  note "gate: PASSED — no failure outside the ledger"
}

# ── The mint ────────────────────────────────────────────────────────────────────────────────────
#
# One run of the same suite with the emit flag set. The suite PRINTS the ledger between sentinels;
# this function lifts it out and writes it into the sandbox. Nothing inside the suite writes a file.
#
# It sets a GLOBAL rather than printing the path, deliberately: `X="$(mint_golden)"` would run this
# in a subshell, where `fatal`'s `exit 1` kills only that subshell — the script would sail on with
# an empty path and a vacuity gate that fired into the void.
MINTED=""
mint_golden() {
  local out="$SANDBOX/minted.json"
  note "mint: emitting a fresh ledger from the composition root"
  # `--disable-console-intercept` so the sentinels reach this shell rather than the runner's buffer.
  (cd "$CLI_DIR" && env "$EMIT_FLAG=1" npx vitest run "$SUITE_REL" --disable-console-intercept) \
    > "$SANDBOX/mint.stdout" 2>&1 || true

  awk -v begin="$EMIT_BEGIN" -v end="$EMIT_END" \
    'index($0, begin) { capturing = 1; next } index($0, end) { capturing = 0 } capturing { print }' \
    "$SANDBOX/mint.stdout" > "$out"

  [ -s "$out" ] || fatal "the suite printed no ledger between the sentinels — is $EMIT_FLAG still read by golden.ts?"

  local inspected rows count
  inspected="$(node "$SANDBOX/inspect.mjs" "$out")"
  rows="$(printf '%s\n' "$inspected" | sed -n 's/^ROWS=//p')"
  count="$(printf '%s\n' "$inspected" | sed -n 's/^COUNT=//p')"
  [ "$rows" -ge "$FROZEN_MIN_ROWS" ] \
    || fatal "the minted ledger carries $rows rows, fewer than the frozen floor of $FROZEN_MIN_ROWS ($(printf '%s' "$inspected" | tr '\n' ' '))"
  [ "$count" = "$rows" ] || fatal "the minted ledger's own count sentence ($count) disagrees with its rows ($rows)"
  note "mint: $rows capabilities"
  MINTED="$out"
}

build_workspace() {
  if [ "$DO_BUILD" -eq 0 ]; then
    note "build: SKIPPED (--no-build) — the ledger may be minted against a stale dist"
    return 0
  fi
  note "build: rebuilding the workspace in dependency order (stale dist would pin the last build)"
  (cd "$ROOT" && pnpm build) > "$SANDBOX/build.stdout" 2>&1 \
    || { cat "$SANDBOX/build.stdout" >&2; fatal "the workspace does not build"; }
}

# ── Modes ───────────────────────────────────────────────────────────────────────────────────────

if [ "$MODE" = "gate-only" ]; then
  build_workspace
  run_gate
  exit 0
fi

if [ "$MODE" = "selftest" ]; then
  note "selftest: proving the refuse-while-red gate can fire"
  build_workspace

  # LEG 1 — the clean tree. The gate must PASS. Without this leg a gate that refused unconditionally
  # would look identical to a gate that discriminates.
  if bash "$0" --gate-only --no-build > "$SANDBOX/selftest-clean.log" 2>&1; then
    note "selftest leg 1: clean tree -> gate PASSED (correct)"
  else
    cat "$SANDBOX/selftest-clean.log" >&2
    fatal "selftest leg 1: the gate refused a clean tree — it cannot discriminate, so its refusal in leg 2 would mean nothing"
  fi

  # LEG 2 — one deliberately failing cell, injected into the same suite. The gate must REFUSE, exit
  # 1, and NAME the cell it refused for.
  cp "$SANDBOX/probe.test.ts" "$SELFTEST_PROBE"
  set +e
  bash "$0" --gate-only --no-build > "$SANDBOX/selftest-red.log" 2>&1
  probe_status=$?
  set -e
  rm -f "$SELFTEST_PROBE"

  if [ "$probe_status" -ne 1 ]; then
    cat "$SANDBOX/selftest-red.log" >&2
    fatal "selftest leg 2: the gate exited $probe_status with a deliberately red suite; it must exit 1"
  fi
  grep -q "REFUSING to regenerate" "$SANDBOX/selftest-red.log" \
    || { cat "$SANDBOX/selftest-red.log" >&2; fatal "selftest leg 2: the gate exited 1 without saying it was refusing"; }
  grep -q "regen selftest probe" "$SANDBOX/selftest-red.log" \
    || { cat "$SANDBOX/selftest-red.log" >&2; fatal "selftest leg 2: the refusal did not NAME the failing cell"; }
  note "selftest leg 2: red tree -> gate REFUSED, exit 1, naming the cell (correct)"

  # LEG 3 — the probe removed. The gate must pass again, so the refusal was caused by the probe and
  # not by something the selftest broke on its way through.
  if bash "$0" --gate-only --no-build > "$SANDBOX/selftest-restored.log" 2>&1; then
    note "selftest leg 3: probe removed -> gate PASSED again (correct)"
  else
    cat "$SANDBOX/selftest-restored.log" >&2
    fatal "selftest leg 3: the gate still refuses after the probe was removed"
  fi

  if [ -f "$SELFTEST_PROBE" ]; then fatal "selftest: the probe file survived the run"; fi
  note "selftest: PASSED — the refusal fires on a red tree and only on a red tree"
  exit 0
fi

# ── run / write ─────────────────────────────────────────────────────────────────────────────────

build_workspace
run_gate
mint_golden

if [ -f "$GOLDEN" ]; then
  if diff -u "$GOLDEN" "$MINTED" > "$SANDBOX/ledger.diff"; then
    note "diff: the committed ledger already matches the tree — nothing to change"
    exit 0
  fi
  echo "--- the committed ledger vs the live registry ------------------------------------------"
  sed -e "s|^--- .*|--- committed  $GOLDEN_REL|" -e "s|^+++ .*|+++ live       (minted from the composition root)|" \
    "$SANDBOX/ledger.diff"
  echo "----------------------------------------------------------------------------------------"
else
  note "diff: no committed ledger exists yet — this run would create it"
fi

if [ "$MODE" != "write" ]; then
  note "nothing was written. Re-run with --write to commit this ledger as a reviewed change."
  exit 0
fi

cp "$MINTED" "$GOLDEN"
note "wrote $GOLDEN_REL"
note "REVIEW THE DIFF ABOVE, then commit it. A ledger change is a capability change."
