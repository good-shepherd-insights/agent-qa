#!/usr/bin/env bash
#
# 413-eval-root-hygiene.sh — validate:eval-root-hygiene (413 D-12; SC2, SC4, D-18).
#
# WHAT THIS PROVES. Five properties of the committed measurement substrate that must hold for
# every later v55 phase, not just for the commit that introduced them:
#
#   L1  no absolute machine path anywhere in the committed eval root  -> PASS L1 / FAIL L1
#   L2  no inherited-threshold literal on any gate path               -> PASS L2 / FAIL L2
#   L3  the same-family judge override is not enabled in the demo cfg -> PASS L3 / FAIL L3
#   L4  the v50 39/45 same-family report is still in place, still     -> PASS L4 / FAIL L4
#       carrying its familyOverride marker (D-18 refusal fixture)
#   L5  no noise-floor artefact under reports/                        -> PASS L5 / FAIL L5
#
# WHY A GREEN SUITE DOES NOT PROVE IT. The workspace vitest suite never reads the committed eval
# root and never reads the demo config — `packages/eval` is pure by construction (its own
# module-discipline cell forbids runtime IO) and every gate is deliberately kept out of vitest
# (FLOOR-05, plus the suite's known contention flake). So each of these five is a property of
# BYTES ON DISK OUTSIDE THE SUITE'S REACH: a home-directory path re-seeded into a corpus entry, a
# threshold constant smuggled onto a gate path, the override flipped back on, the refusal fixture
# quietly regenerated, or a floor published a phase early — none of them turn a single existing
# test red. This script is the instrument that sees them.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS. `--selftest` plants a
# home-directory path into a throwaway copy of the eval root, then a Windows drive-letter path into
# the same copy, then a threshold literal into a throwaway gate file, and REQUIRES L1, L1 again and
# L2 to red under those three plants. Every plant uses a literal that never appears in the shipped
# tree. A leg that stays green under its own plant exits 1 with SELFTEST FAILED.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE. `grep` returns 1 for "no match",
# which is this script's success condition on four of five legs, so every grep's status is captured
# with `|| status=$?` and read as 0=hit / 1=clean / >=2=grep itself failed (also a FAIL — a leg
# that could not run has not passed).
#
# L2 SCOPE IS DELIBERATELY NARROW (Pitfall 8). A bare `0.867` matches cassette geometry
# (`310.8671875`), so the pattern is anchored on both sides and the scope is the gate surface only:
# the committed reports plus the eval / eval-local / cli-eval sources, with `--exclude-dir=__tests__`
# because a test may legitimately cite the inherited number as a fixture. The fixture report's own
# `0.8666666666666667` does not match the anchored pattern and must not.
#
# L5 IS PHASE-SCOPED. Phase 413 publishes no floor (SC4). Phase 415 (FLOOR-01..06) is the phase
# that publishes one — when it does, it relaxes or retires L5 and says so in its own plan.
#
# ENV OVERRIDES exist for the self-test only:
#   EVAL_ROOT             the committed eval root to scan
#   DEMO_CONFIG           the demo config to read for L3
#   GATE_PATHS_OVERRIDE   colon-separated replacement for L2's gate path list

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EVAL_ROOT="${EVAL_ROOT:-$ROOT/../demo/init/agent-qa-eval}"
DEMO_CONFIG="${DEMO_CONFIG:-$ROOT/../demo/init/agent-qa.config.yaml}"

FIXTURE_BATCH_KEY='358327d21294f77b91645e3cefde46ad12fe065422757372835447a41865a71e'

# L1's three absolute-path shapes. The drive-letter arm is boundary-anchored on the left and
# requires a path character after the separator, because a bare `[A-Za-z]:\` matches JSON string
# escapes that are not paths at all — the committed tree really contains `fields:\n-` and
# `Search:\"`, and a leg that reds on those would be turned off within a phase. A genuine Windows
# path (`C:\Users\…` in markdown, `"C:\\Users\\…"` in JSON) still matches both forms.
ABSOLUTE_PATH_PATTERN='(/Users/|/home/|(^|[^A-Za-z0-9])[A-Za-z]:\\+[A-Za-z0-9_.$-])'

pass() { echo "PASS $1" >&2; }
fail() { echo "FAIL $1: $2" >&2; fail_count=1; }

gate_paths() {
  if [ -n "${GATE_PATHS_OVERRIDE:-}" ]; then
    local IFS=':'
    # shellcheck disable=SC2086
    for path in $GATE_PATHS_OVERRIDE; do [ -n "$path" ] && echo "$path"; done
    return 0
  fi
  echo "$EVAL_ROOT/reports"
  echo "$ROOT/packages/eval/src"
  echo "$ROOT/packages/eval-local/src"
  echo "$ROOT/packages/cli/src/commands/eval.ts"
  for file in "$ROOT/packages/cli/src/"eval-*.ts; do
    [ -e "$file" ] && echo "$file"
  done
}

run_legs() {
  fail_count=0
  local status hits

  # ---- L1: no absolute machine path in the committed eval root -----------------------------
  # A leg that scanned nothing has not passed (T-413-15). `grep -r` over a missing directory
  # returns "no match" on this platform, so the root's existence is asserted before the scan
  # rather than inferred from the scan's exit code.
  if [ ! -d "$EVAL_ROOT/corpus" ]; then
    fail L1 "no committed corpus at $EVAL_ROOT/corpus — the scan would cover nothing"
  else
    status=0
    hits=$(grep -rEl "$ABSOLUTE_PATH_PATTERN" "$EVAL_ROOT" --include='*.json' --include='*.md') || status=$?
    if [ "$status" -eq 0 ]; then
      fail L1 "absolute path in the committed eval root: $(echo "$hits" | head -5 | tr '\n' ' ')"
    elif [ "$status" -eq 1 ]; then
      pass L1
    else
      fail L1 "grep could not scan $EVAL_ROOT (exit $status)"
    fi
  fi

  # ---- L2: no inherited-threshold literal on a gate path -----------------------------------
  local -a paths=()
  while IFS= read -r line; do paths+=("$line"); done < <(gate_paths)
  status=0
  if [ "${#paths[@]}" -eq 0 ]; then
    fail L2 "no gate paths resolved — the leg would scan nothing"
  else
    hits=$(grep -rEn --exclude-dir=__tests__ '(^|[^0-9.])(0\.867|86\.7)([^0-9]|$)' "${paths[@]}") || status=$?
    if [ "$status" -eq 0 ]; then
      fail L2 "inherited threshold literal on a gate path: $(echo "$hits" | head -3 | tr '\n' ' ')"
    elif [ "$status" -eq 1 ]; then
      pass L2
    else
      fail L2 "grep could not scan the gate paths (exit $status)"
    fi
  fi

  # ---- L3: the same-family override is not enabled in the demo config ----------------------
  if [ ! -f "$DEMO_CONFIG" ]; then
    fail L3 "demo config not found at $DEMO_CONFIG"
  else
    status=0
    hits=$(grep -vE '^[[:space:]]*#' "$DEMO_CONFIG" | grep -E 'judgeAllowSameFamily:[[:space:]]*true') || status=$?
    if [ "$status" -eq 0 ]; then
      fail L3 "the D-10 same-family override is enabled: $hits"
    else
      pass L3
    fi
  fi

  # ---- L4: the D-18 refusal fixture is in place, untouched ---------------------------------
  local fixture="$EVAL_ROOT/reports/$FIXTURE_BATCH_KEY/report.json"
  if [ ! -f "$fixture" ]; then
    fail L4 "the v50 same-family refusal fixture is missing: $fixture"
  else
    status=0
    grep -q '"familyOverride": "same-family-allowed"' "$fixture" || status=$?
    if [ "$status" -eq 0 ]; then
      pass L4
    else
      fail L4 "the refusal fixture no longer carries its same-family override marker: $fixture"
    fi
  fi

  # ---- L5: no noise-floor artefact under reports/ -------------------------------------------
  if [ ! -d "$EVAL_ROOT/reports" ]; then
    fail L5 "reports/ not found under $EVAL_ROOT"
  else
    hits=$(find "$EVAL_ROOT/reports" -name 'noise-floor.json')
    if [ -n "$hits" ]; then
      fail L5 "a noise floor left this phase (413 publishes none; 415 owns it): $(echo "$hits" | tr '\n' ' ')"
    else
      pass L5
    fi
  fi

  return "$fail_count"
}

selftest() {
  local tmp_root tmp_gate status stderr_file
  tmp_root="$(mktemp -d)"
  tmp_gate="$(mktemp -d)"
  stderr_file="$(mktemp)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp_root' '$tmp_gate' '$stderr_file'" EXIT

  echo "SELFTEST plant 1: a home-directory path in a throwaway copy of the eval root" >&2
  cp -R "$EVAL_ROOT/." "$tmp_root/"
  mkdir -p "$tmp_root/corpus/selftest"
  printf '{"handoffPath":"/Users/selftest/handoff.json"}\n' > "$tmp_root/corpus/selftest/planted.json"
  status=0
  EVAL_ROOT="$tmp_root" DEMO_CONFIG="$DEMO_CONFIG" "$0" 2>"$stderr_file" || status=$?
  if [ "$status" -eq 0 ]; then
    echo "SELFTEST FAILED: L1 stayed green under a planted absolute path" >&2
    return 1
  fi
  if ! grep -q '^FAIL L1' "$stderr_file"; then
    echo "SELFTEST FAILED: the run reddened (exit $status) but not on L1" >&2
    cat "$stderr_file" >&2
    return 1
  fi
  grep '^FAIL L1' "$stderr_file" >&2

  echo "SELFTEST plant 1b: a Windows drive-letter path — the arm narrowed to skip JSON escapes" >&2
  printf '{"handoffPath":"C:\\\\Users\\\\selftest\\\\handoff.json"}\n' > "$tmp_root/corpus/selftest/planted.json"
  status=0
  EVAL_ROOT="$tmp_root" DEMO_CONFIG="$DEMO_CONFIG" "$0" 2>"$stderr_file" || status=$?
  if [ "$status" -eq 0 ] || ! grep -q '^FAIL L1' "$stderr_file"; then
    echo "SELFTEST FAILED: L1 stayed green under a planted Windows drive-letter path" >&2
    cat "$stderr_file" >&2
    return 1
  fi
  grep '^FAIL L1' "$stderr_file" >&2
  rm -f "$tmp_root/corpus/selftest/planted.json"

  echo "SELFTEST plant 2: an inherited-threshold literal on a throwaway gate path" >&2
  printf 'export const THRESHOLD = 0.867\n' > "$tmp_gate/gate.ts"
  status=0
  GATE_PATHS_OVERRIDE="$tmp_gate" "$0" 2>"$stderr_file" || status=$?
  if [ "$status" -eq 0 ]; then
    echo "SELFTEST FAILED: L2 stayed green under a planted threshold literal" >&2
    return 1
  fi
  if ! grep -q '^FAIL L2' "$stderr_file"; then
    echo "SELFTEST FAILED: the run reddened (exit $status) but not on L2" >&2
    cat "$stderr_file" >&2
    return 1
  fi
  grep '^FAIL L2' "$stderr_file" >&2

  echo "SELFTEST PASSED: every plant reddened the leg that exists to catch it" >&2
  return 0
}

case "${1:-}" in
  --selftest)
    selftest
    exit "$?"
    ;;
  '')
    status=0
    run_legs || status=$?
    exit "$status"
    ;;
  *)
    echo "usage: $0 [--selftest]" >&2
    exit 2
    ;;
esac
