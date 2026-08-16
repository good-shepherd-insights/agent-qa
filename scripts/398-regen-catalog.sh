#!/usr/bin/env bash
#
# 398-regen-catalog.sh — the ONE writer of the committed capability catalog (Phase 398 plan 01, D-01).
#
# WHAT THIS IS FOR, IN ONE LINE: `packages/cli/capability-catalog/capability-catalog.json` is the
# single data source behind `init --agent`, the chat `/` type-ahead, the starter prompts and the
# `explain` op. Every answer this product gives about what it can do is a projection of those bytes,
# so the bytes must not be one keystroke from silently blessed. The discipline is 397's, verbatim:
#
#   * NO TEST-RUNNER UPDATE PATH REACHES IT. There is no snapshot, no `-u`, no `--update`. Nothing
#     under `src/__tests__/conformance/` opens the artifact for writing, and `catalog.test.ts`
#     asserts that as source over every file in the directory, including files added later. The
#     suite offers this script a PRINT between sentinels; the writing happens here.
#   * THE REGEN REFUSES WHILE THE SUITE IS RED FOR ANY OTHER REASON. A regeneration against a broken
#     tree would launder the breakage into the artifact — the catalog would faithfully describe
#     whatever the broken tree declares, and the reviewer would see a diff with no failing test
#     beside it. The only failures allowed through the gate are the cells whose SUBJECT is the
#     committed artifact agreeing with the live tree, by exact name (see ALLOWED_RED_NAMES).
#   * THE GATE IS SELF-TESTING. `--selftest` injects a deliberately failing probe into the suite and
#     requires the refusal to fire, then requires the gate to pass again once the probe is removed.
#     A gate nobody has seen fire is a comment.
#   * WRITING IS EXPLICIT. Without `--write` this script prints the diff and touches nothing.
#
# ONE RECIPE, NEVER TWO. The catalog this script emits is built by `buildCatalogRows` in
# `conformance/catalog.ts` — the same function the freshness cell compares against, over the same
# composition root the golden ledger walks. A regen that re-derived the rows its own way would agree
# with whatever the code does on the day it ran, which is an artifact that pins nothing.
#
# STALE DIST IS A REAL FAILURE MODE HERE. The cli tests resolve `@vostride/agent-qa-*` through built
# `dist`, so a catalog minted against a stale build describes the PREVIOUS build's capabilities. The
# workspace is therefore rebuilt in dependency order before anything is measured.
#
# USAGE
#   bash agent-qa/scripts/398-regen-catalog.sh            # from the super-repository root
#   bash scripts/398-regen-catalog.sh                     # from the agent-qa root: mint + diff only
#   bash scripts/398-regen-catalog.sh --write             # …and overwrite the committed artifact
#   bash scripts/398-regen-catalog.sh --selftest          # prove the refuse-while-red gate fires
#   bash scripts/398-regen-catalog.sh --no-build          # skip the rebuild (iteration only)
#   bash scripts/398-regen-catalog.sh --gate-only         # INTERNAL: run the gate, exit 0/1
#
# Case lookups and plain functions rather than associative arrays: macOS ships bash 3.2, where
# `declare -A` silently becomes an indexed array and every named key reads as unbound under `set -u`.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="$ROOT/packages/cli"
SUITE_REL="src/__tests__/conformance/"
CATALOG_REL="packages/cli/capability-catalog/capability-catalog.json"
CATALOG="$ROOT/$CATALOG_REL"

# ── The pins. Every one of these is a deliberate-commit knob, not a default. ────────────────────
#
# The failures the gate lets through, by EXACT full name, one per line. Exact rather than a pattern:
# a pattern is a hole that widens on its own, and this list is the whole of what "refuses while red"
# means.
#
# WHAT MAKES A CELL ELIGIBLE, STATED SO THE LIST CANNOT GROW BY HABIT (2026-08-17, 398-08). Every
# member is a cell whose SUBJECT IS THE COMMITTED ARTIFACT AGREEING WITH THE LIVE TREE. Those are
# exactly the cells a stale artifact reds, and exactly the state this script exists to let a person
# out of — leaving them out would make the one writer unusable the moment a producer change reddened
# more than one of them, which is the deadlock a second cell of that class introduces. A cell that
# measures anything else — a census, a loader refusal, a parity anchor's enumeration — is NOT
# eligible, because a regeneration performed while one of those is red records a tree nobody has
# fixed.
#
# AND THE LIST CHECKS ITSELF. Every name below must MATCH A CELL THE SUITE ACTUALLY RAN; a stale
# entry naming a renamed or deleted cell is a hole that is invisible precisely because nothing ever
# fires through it. `classify.mjs` reports the misses and the gate FATALs on them.
#
# The names are vitest's `fullName`: the describe title and the cell title, joined by one space.
#
# A PLAIN MULTI-LINE STRING, not a heredoc inside a command substitution. Measured 2026-08-17 on the
# bash 3.2 macOS ships: `VAR="$(cat <<'X' ... X )"` mis-parses there and the script dies at an
# unrelated line with `arg: unbound variable`, which is the least helpful diagnosis available for
# it. The rest of this file avoids bash-4 idioms for the same reason the header states.
ALLOWED_RED_NAMES="the capability catalog regenerates byte-identically from the live seams into the committed artifact (D-03)
the catalog's migration map projection (D-14, XPLN-03) lands in the COMMITTED artifact, entry for entry, as the shipped map declares it"
# Vacuity floor. A gate that passed because the suite collected nothing is the CI-shaped version of
# the failure this artifact exists to prevent. Measured 2026-08-16: 88 tests in the directory;
# 2026-08-17 (398-08): 113, after the manifest legs and the `init --agent` cells joined. Raised in
# the same diff that added them, which is the rule the knob exists for.
FROZEN_MIN_TESTS=105
# The artifact's own floor, so a mint that produced a truncated or empty file cannot be written.
# Measured 2026-08-16: 41 registry ops + 5 chat op-aliases + 3 shipped skills = 49 rows.
FROZEN_MIN_ROWS=49
# The migration section's floor (398-08, D-14). It is SEPARATE from the row floor because it is a
# separate section with a separate source: a mint that folded every capability correctly and dropped
# the projected map would clear FROZEN_MIN_ROWS and write a manifest that answers no v1 caller.
# Measured 2026-08-17: the shipped map's 33 adjudicated tool rows.
FROZEN_MIN_MIGRATION_ENTRIES=33

EMIT_FLAG="AGENT_QA_398_CATALOG_EMIT"
EMIT_BEGIN="<<<398-01-CATALOG-BEGIN>>>"
EMIT_END="<<<398-01-CATALOG-END>>>"
SELFTEST_PROBE="$CLI_DIR/src/__tests__/conformance/398-regen-selftest-probe.test.ts"

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
note() { echo "[398-regen-catalog] $*" >&2; }

# PORTABLE FORM, DELIBERATELY. `mktemp -d -t <prefix>` is a BSD idiom: on macOS it appends random
# characters to the prefix, on GNU coreutils the same call FAILS with "too few X's in template".
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/398regen.XXXXXXXX")"

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
// Read vitest's JSON report and classify the failures against the allowed-red list.
// Prints `TOTAL=<n>`, then one `UNEXPECTED <full name>` line per failure outside the list, one
// `ALLOWED <full name>` line per failure inside it, and one `MISSINGALLOWED <full name>` line per
// list entry naming a cell THIS RUN DID NOT CONTAIN. That last line is the list's own self-check:
// an allow-list entry for a renamed or deleted cell is a hole nothing will ever fire through, so
// nothing would ever reveal it. Decides nothing; bash decides.
import { readFileSync } from 'node:fs'
const [, , reportPath, allowedPath] = process.argv
let report
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch (err) {
  process.stdout.write(`UNREADABLE ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(0)
}
const allowed = readFileSync(allowedPath, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
const results = Array.isArray(report.testResults) ? report.testResults : []
process.stdout.write(`TOTAL=${Number(report.numTotalTests ?? 0)}\n`)
const collected = new Set()
for (const file of results) {
  for (const assertion of file.assertionResults ?? []) {
    const name = String(assertion.fullName ?? '')
    collected.add(name)
    if (assertion.status !== 'failed') continue
    process.stdout.write(`${allowed.includes(name) ? 'ALLOWED' : 'UNEXPECTED'} ${name}\n`)
  }
}
for (const name of allowed) {
  if (!collected.has(name)) process.stdout.write(`MISSINGALLOWED ${name}\n`)
}
CLASSIFY_MJS

cat > "$SANDBOX/inspect.mjs" <<'INSPECT_MJS'
// Answer, with ONE parse, every question a truncated mint would fail: is it valid JSON at all, how
// many rows does it carry, and how many migration entries. Each SECTION reports its own length and
// its own count sentence, because a document that folded one section correctly and dropped the
// other is a document both halves of a single count would call complete.
import { readFileSync } from 'node:fs'
try {
  const catalog = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const rows = Array.isArray(catalog.rows) ? catalog.rows.length : -1
  const migration = Array.isArray(catalog.migrationMap) ? catalog.migrationMap.length : -1
  process.stdout.write(
    `ROWS=${rows}\nCOUNT=${Number(catalog.rowCount ?? -1)}\n`
    + `MIGRATION=${migration}\nMIGRATIONCOUNT=${Number(catalog.migrationCount ?? -1)}\n`,
  )
} catch (err) {
  process.stdout.write(
    `ROWS=-1\nCOUNT=-1\nMIGRATION=-1\nMIGRATIONCOUNT=-1\n`
    + `ERROR=${err instanceof Error ? err.message : err}\n`,
  )
}
INSPECT_MJS

cat > "$SANDBOX/probe.test.ts" <<'PROBE_TS'
// TRANSIENT — written by `scripts/398-regen-catalog.sh --selftest` and removed by its EXIT trap.
//
// The gate this script carries refuses to regenerate the catalog while the conformance suite is red
// for any reason other than the freshness cell itself. This file is the deliberate other reason:
// it fails by name, so the selftest can observe the refusal fire instead of assuming it would.
import { describe, expect, it } from 'vitest'

describe('398-01 regen selftest probe', () => {
  it('fails on purpose so the refuse-while-red gate can be observed firing', () => {
    expect('the regen gate must refuse while this is red').toBe('and it must say which cell')
  })
})
PROBE_TS

# ── The gate ────────────────────────────────────────────────────────────────────────────────────
#
# Runs the conformance suite and refuses on any failure outside the allowed-red list. Those legs are
# NOT filtered out by the runner: they stay in and their failures are classified by name. That is
# stricter than an exclusion — an exclusion would also hide one of them breaking for a reason having
# nothing to do with the artifact's contents.
run_gate() {
  local report="$SANDBOX/results.$$.json"
  note "gate: running the conformance suite"
  # The exit code is read from the process, never through a pipe, and a red suite is EXPECTED here
  # (the freshness cell) so the run itself must not abort the script under `set -e`.
  (cd "$CLI_DIR" && npx vitest run "$SUITE_REL" --reporter=json --outputFile="$report") \
    > "$SANDBOX/gate.stdout" 2>&1 || true

  [ -f "$report" ] || fatal "the suite produced no JSON report — it did not run at all"

  printf '%s\n' "$ALLOWED_RED_NAMES" > "$SANDBOX/allowed-red.txt"

  local classified
  classified="$(node "$SANDBOX/classify.mjs" "$report" "$SANDBOX/allowed-red.txt")"

  case "$classified" in
    UNREADABLE*) fatal "the suite's JSON report could not be read: ${classified#UNREADABLE }" ;;
  esac

  # THE ALLOW-LIST'S OWN CHECK, before any verdict is read off it. An entry naming a cell that no
  # longer exists is a permission granted to nothing — invisible, because a hole nothing fires
  # through never reports.
  local missing_allowed
  missing_allowed="$(printf '%s\n' "$classified" | sed -n 's/^MISSINGALLOWED //p')"
  if [ -n "$missing_allowed" ]; then
    echo "FATAL: the allowed-red list names cells this suite does not contain:" >&2
    printf '  - %s\n' "$missing_allowed" >&2
    echo "An allow-list entry for a renamed or deleted cell is a hole nothing can fire through." >&2
    echo "Fix the name in ALLOWED_RED_NAMES, or remove the entry." >&2
    exit 1
  fi

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
    echo "FATAL: the conformance suite is red for a reason other than the capability catalog:" >&2
    printf '  - %s\n' "$unexpected" >&2
    echo "REFUSING to regenerate. A regeneration against a red tree records whatever that tree" >&2
    echo "declares, and the reviewer sees an artifact diff with no failing test beside it. Fix the" >&2
    echo "failures above first (D-01)." >&2
    exit 1
  fi

  local allowed
  allowed="$(printf '%s\n' "$classified" | sed -n 's/^ALLOWED //p')"
  if [ -n "$allowed" ]; then
    note "gate: only committed-artifact cells are red, as expected before a regeneration"
  else
    note "gate: no committed-artifact cell is red — the catalog already matches the tree"
  fi
  note "gate: PASSED — no failure outside the catalog"
}

# ── The mint ────────────────────────────────────────────────────────────────────────────────────
#
# One run of the same suite with the emit flag set. The suite PRINTS the catalog between sentinels;
# this function lifts it out and writes it into the sandbox. Nothing inside the suite writes a file.
#
# It sets a GLOBAL rather than printing the path, deliberately: `X="$(mint_catalog)"` would run this
# in a subshell, where `fatal`'s `exit 1` kills only that subshell — the script would sail on with
# an empty path and a vacuity gate that fired into the void.
MINTED=""
mint_catalog() {
  local out="$SANDBOX/minted.json"
  note "mint: emitting a fresh catalog from the composition root"
  # `--disable-console-intercept` so the sentinels reach this shell rather than the runner's buffer.
  (cd "$CLI_DIR" && env "$EMIT_FLAG=1" npx vitest run "$SUITE_REL" --disable-console-intercept) \
    > "$SANDBOX/mint.stdout" 2>&1 || true

  awk -v begin="$EMIT_BEGIN" -v end="$EMIT_END" \
    'index($0, begin) { capturing = 1; next } index($0, end) { capturing = 0 } capturing { print }' \
    "$SANDBOX/mint.stdout" > "$out"

  [ -s "$out" ] || fatal "the suite printed no catalog between the sentinels — is $EMIT_FLAG still read by catalog.ts?"

  local inspected rows count migration migration_count
  inspected="$(node "$SANDBOX/inspect.mjs" "$out")"
  rows="$(printf '%s\n' "$inspected" | sed -n 's/^ROWS=//p')"
  count="$(printf '%s\n' "$inspected" | sed -n 's/^COUNT=//p')"
  migration="$(printf '%s\n' "$inspected" | sed -n 's/^MIGRATION=//p')"
  migration_count="$(printf '%s\n' "$inspected" | sed -n 's/^MIGRATIONCOUNT=//p')"
  [ "$rows" -ge "$FROZEN_MIN_ROWS" ] \
    || fatal "the minted catalog carries $rows rows, fewer than the frozen floor of $FROZEN_MIN_ROWS ($(printf '%s' "$inspected" | tr '\n' ' '))"
  [ "$count" = "$rows" ] || fatal "the minted catalog's own count sentence ($count) disagrees with its rows ($rows)"
  [ "$migration" -ge "$FROZEN_MIN_MIGRATION_ENTRIES" ] \
    || fatal "the minted catalog carries $migration migration entries, fewer than the frozen floor of $FROZEN_MIN_MIGRATION_ENTRIES ($(printf '%s' "$inspected" | tr '\n' ' '))"
  [ "$migration_count" = "$migration" ] \
    || fatal "the minted catalog's own migration count sentence ($migration_count) disagrees with its entries ($migration)"
  note "mint: $rows rows, $migration migration entries"
  MINTED="$out"
}

build_workspace() {
  if [ "$DO_BUILD" -eq 0 ]; then
    note "build: SKIPPED (--no-build) — the catalog may be minted against a stale dist"
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
mint_catalog

if [ -f "$CATALOG" ]; then
  if diff -u "$CATALOG" "$MINTED" > "$SANDBOX/catalog.diff"; then
    note "diff: the committed catalog already matches the tree — nothing to change"
    exit 0
  fi
  echo "--- the committed catalog vs the live seams ---------------------------------------------"
  sed -e "s|^--- .*|--- committed  $CATALOG_REL|" -e "s|^+++ .*|+++ live       (minted from the composition root)|" \
    "$SANDBOX/catalog.diff"
  echo "----------------------------------------------------------------------------------------"
else
  note "diff: no committed catalog exists yet — this run would create it"
fi

if [ "$MODE" != "write" ]; then
  note "nothing was written. Re-run with --write to commit this catalog as a reviewed change."
  exit 0
fi

mkdir -p "$(dirname "$CATALOG")"
cp "$MINTED" "$CATALOG"
note "wrote $CATALOG_REL"
note "REVIEW THE DIFF ABOVE, then commit it. A catalog change is a capability change."
