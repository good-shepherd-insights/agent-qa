#!/usr/bin/env bash
# LEG 6 CAN FAIL — and here is each way, observed (395-28 · CR-04 / I-01).
#
# WHY THIS FILE EXISTS. `395-live-from-zero.sh` LEG 6 needs a live planner, a real pty and real
# money, so in practice it runs rarely and its verdict is read as evidence when it does. That is
# exactly the instrument you must be able to falsify cheaply. Round 4's review found LEG 6 asserting
# inside a PASS sentence that "the repository is untouched" without ever comparing the two commit
# counts it had captured, and found the pty driver reporting a clean exit for a child that had never
# exited — a hang that read as SKIP, which does not set the lane's return code. A leg that reports a
# hang as green is a false-green generator.
#
# WHAT IT PROVES, IN SECONDS AND WITHOUT A PLANNER. Seven probes, in two halves:
#
#   DRIVER HALF (3) — the real `395-ask-road-pty.py`, against tiny fake CLI entries:
#     D1  a child that never exits, and that IGNORES SIGHUP so the pty master's close cannot take it
#         down  -> timedout=1, a SIGKILL status, and NO SURVIVING PROCESS
#     D2  a child that exits 3                     -> timedout=0, status=3 (not the raw 768)
#     D3  an exec that cannot launch (empty PATH)  -> status=126, verdict line present, no traceback
#
#   GRADING HALF (4) — the real `leg6_grade`, sourced from `395-leg6-grade.sh`, driven with
#   INJECTED measurements. The lane sources the same file, so what is proven falsifiable here is
#   what the lane grades with, never a re-typed sibling:
#     G1  a healthy set                            -> PASS
#     G2  the same set with the commit counts differing -> RED
#     G3  the same set with declined=0             -> RED
#     G4  the same set with timedout=1             -> RED
#
# EVERY EXPECTATION IS ASSERTED, NOT PRINTED. The script exits non-zero if any probe's reading is
# not the expected one, and the failure names the probe.
#
# HOW IT IS ITSELF PROVEN FALSIFIABLE (395-28): each of the three refusals `leg6_grade` gained was
# removed in turn and the corresponding probe observed RED — G2 for the repository comparison, G3
# for the decline, G4 for the timeout. Recorded in 395-28-SUMMARY.md. Re-run that mutation whenever
# the grading changes; a check that has never been seen to fail has not been checked.
#
#   usage:  bash scripts/395-leg6-instrument-check.sh
#           L6_CHECK_DRIVER=/path/to/other-driver.py bash scripts/395-leg6-instrument-check.sh
#
# The driver override exists so the PRE-fix driver can be run through the SAME probes — that is how
# the readings this script was written against were taken.

set -u
set -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRIVER="${L6_CHECK_DRIVER:-$REPO_ROOT/scripts/395-ask-road-pty.py}"
GRADER="$REPO_ROOT/scripts/395-leg6-grade.sh"
PROBE_TIMEOUT="${L6_CHECK_TIMEOUT:-3}"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/395-leg6-check.XXXXXX")"
FAILURES=0
PROBES=0

cleanup() {
  local rc=$?
  # A check that leaks the processes it was written to catch would be its own defect.
  pkill -9 -f "$WORK/" 2>/dev/null || true
  rm -rf "$WORK"
  exit "$rc"
}
trap cleanup EXIT

pass() { PROBES=$((PROBES + 1)); printf '  ok    %-4s %s\n' "$1" "$2"; }
fail() {
  PROBES=$((PROBES + 1)); FAILURES=$((FAILURES + 1))
  printf '  FAIL  %-4s %s\n' "$1" "$2"
}
expect_eq() { # <probe> <what> <actual> <expected>
  if [ "$3" = "$4" ]; then pass "$1" "$2 = $3"; else fail "$1" "$2: expected $4, got '$3'"; fi
}

field() { # <verdict-line> <name>
  printf '%s' "$1" | sed -n "s/.*$2=\\([-0-9]*\\).*/\\1/p"
}

command -v python3 >/dev/null || { printf 'FATAL: python3 is required\n' >&2; exit 2; }
[ -f "$DRIVER" ] || { printf 'FATAL: driver not found: %s\n' "$DRIVER" >&2; exit 2; }
[ -f "$GRADER" ] || { printf 'FATAL: grader not found: %s\n' "$GRADER" >&2; exit 2; }

printf '\n=== DRIVER HALF — %s\n' "$DRIVER"

# ---- D1: a child that never exits, and that cannot be hung up on -----------------------------
# SIGHUP-DEAF ON PURPOSE. Closing the pty master delivers SIGHUP to the child's foreground process
# group, so a child with default handlers dies on the close alone and the leak is invisible. This
# probe removes that accident so the assertion measures the DRIVER's kill, not the platform's.
cat > "$WORK/hang.js" <<'EOF'
process.on('SIGHUP', () => {})
process.on('SIGTERM', () => {})
process.stdout.write('deaf and hanging\n')
setInterval(() => {}, 1000)
EOF
D1_LINE="$(python3 "$DRIVER" "$WORK" "$WORK/hang.js" 'x' "$WORK/d1.txt" "$PROBE_TIMEOUT" 2>&1 \
  | grep '^L6-VERDICT' || true)"
# THE READING IS PRINTED BESIDE THE ASSERTION, not instead of it — a probe whose expectation is not
# visible next to what it measured is hard to audit, and this whole round is about auditability.
printf '  read  D1   %s\n' "${D1_LINE:-<no verdict line>}"
expect_eq D1 'a wedged drive is reported as a timeout' "$(field "$D1_LINE" timedout)" '1'
expect_eq D1 'the killed child reports the negated signal' "$(field "$D1_LINE" status)" '-9'
D1_PID="$(field "$D1_LINE" pid)"
if [ -n "$D1_PID" ] && kill -0 "$D1_PID" 2>/dev/null; then
  fail D1 "the driver LEAKED the child: pid $D1_PID is still alive"
  kill -9 "$D1_PID" 2>/dev/null || true
elif [ -z "$D1_PID" ]; then
  fail D1 'the verdict line carries no pid, so survival cannot be asserted'
else
  pass D1 "no child survived the run (pid $D1_PID is gone)"
fi

# ---- D2: a child that exits non-zero ----------------------------------------------------------
cat > "$WORK/exit3.js" <<'EOF'
process.stdout.write('bye\n')
process.exit(3)
EOF
D2_LINE="$(python3 "$DRIVER" "$WORK" "$WORK/exit3.js" 'x' "$WORK/d2.txt" "$PROBE_TIMEOUT" 2>&1 \
  | grep '^L6-VERDICT' || true)"
printf '  read  D2   %s\n' "${D2_LINE:-<no verdict line>}"
expect_eq D2 'a clean exit is not reported as a timeout' "$(field "$D2_LINE" timedout)" '0'
# 768 is the RAW wait status for exit 3 — the pre-fix reading, and the reason this asserts 3.
expect_eq D2 'the real exit code, not the raw wait status' "$(field "$D2_LINE" status)" '3'

# ---- D3: the exec itself cannot launch --------------------------------------------------------
# `os.execvp` resolves `node` through the CHILD's PATH, so emptying PATH makes the launch fail while
# leaving this script's own python3 reachable by absolute path.
PY3="$(command -v python3)"
D3_OUT="$(env PATH= "$PY3" "$DRIVER" "$WORK" "$WORK/exit3.js" 'x' "$WORK/d3.txt" \
  "$PROBE_TIMEOUT" 2>&1 || true)"
D3_LINE="$(printf '%s' "$D3_OUT" | grep '^L6-VERDICT' || true)"
printf '  read  D3   %s\n' "${D3_LINE:-<no verdict line>}"
if [ -z "$D3_LINE" ]; then
  fail D3 'a launch failure produced no verdict line at all'
else
  pass D3 'a launch failure still produces a verdict line'
fi
expect_eq D3 'the distinct launch-failure code' "$(field "$D3_LINE" status)" '126'
D3_LINES="$(printf '%s\n' "$D3_OUT" | grep -c '^L6-VERDICT' || true)"
expect_eq D3 'exactly one verdict line (the child did not re-enter main)' "$D3_LINES" '1'
if grep -q 'Traceback (most recent call last)' "$WORK/d3.txt" 2>/dev/null; then
  fail D3 "the child unwound through the interpreter and wrote its traceback into the transcript"
else
  pass D3 'the transcript carries no interpreter traceback'
fi

# ---- GRADING HALF -----------------------------------------------------------------------------
printf '\n=== GRADING HALF — %s\n' "$GRADER"
# shellcheck source=./395-leg6-grade.sh
. "$GRADER"

# A HEALTHY SET, and every other probe is this set with ONE measurement changed — so a RED can only
# be attributed to that one measurement.
#   verdict-line  prompt summary files diff  declined timedout  before after  transcript known-cause
grade_probe() { # <probe> <expected-verdict> <args...>
  local probe="$1" expected="$2"; shift 2
  leg6_grade "$@"
  if [ "$L6_GRADE_VERDICT" = "$expected" ]; then
    pass "$probe" "graded $L6_GRADE_VERDICT"
  else
    fail "$probe" "expected $expected, graded $L6_GRADE_VERDICT — $L6_GRADE_WHY"
  fi
}

HEALTHY_LINE='L6-VERDICT prompt=500 declined=1 timedout=0 status=0 pid=1 bytes=900 summary=10 files=20 diff=30'
T='/tmp/leg6-check-transcript.txt'
printf '  base  G*   %s\n' "$HEALTHY_LINE"

grade_probe G1 PASS "$HEALTHY_LINE" 500 10 20 30 1 0 7 7 "$T" 0
grade_probe G2 RED  "$HEALTHY_LINE" 500 10 20 30 1 0 7 8 "$T" 0
grade_probe G3 RED  "$HEALTHY_LINE" 500 10 20 30 0 0 7 7 "$T" 0
grade_probe G4 RED  "$HEALTHY_LINE" 500 10 20 30 1 1 7 7 "$T" 0

# THE SENTENCE MUST NAME WHAT IT REFUSED, or a RED verdict is an unactionable one.
leg6_grade "$HEALTHY_LINE" 500 10 20 30 1 0 7 8 "$T" 0
case "$L6_GRADE_WHY" in
  *'commits 7 -> 8'*) pass G2 'the refusal names both commit counts' ;;
  *) fail G2 "the mutation refusal does not name the counts: $L6_GRADE_WHY" ;;
esac

printf '\n=== RESULT\n'
printf '  probes   %s\n  failures %s\n' "$PROBES" "$FAILURES"
if [ "$FAILURES" -eq 0 ]; then
  printf '\nINSTRUMENT GREEN — every refusal in LEG 6 fired, and the driver told a hang from an exit.\n'
  printf 'BOUND: this proves the leg CAN fail on each enumerated shape. It says nothing about the\n'
  printf 'ask road itself, which only the live lane measures, at k=1.\n'
  exit 0
fi
printf '\nINSTRUMENT RED — %s probe(s) above did not match. LEG 6 cannot be trusted until they do.\n' \
  "$FAILURES"
exit 1
