#!/usr/bin/env bash
#
# 395-scan-mutation.sh — the acceptance bar for CFGM-02's construction scan (395-04).
#
# WHAT THIS PROVES, and why a green suite does not prove it. `construct-blocked.test.ts` and
# `config-blocked-renders.test.ts` passing says a planted secret produced a blocked proposal and did
# not reach a render. It does NOT say those cells would CATCH the implementations D-09/D-10/D-12
# forbid — and all three below read as simplifications a reasonable person would write:
#
#   S1  the scan NARROWED to the changed lines. "Scan the diff" is the most natural reading there
#       is, and it is the exact defect D-12 exists to forbid: a secret a human committed months ago
#       sits on a CONTEXT line, renders in the artifact a person is shown, and becomes invisible to
#       the guard. The discrimination this leg buys is precise: the cells whose secret is on an
#       ADDED line stay GREEN under it, so a suite that only ever planted secrets in the new value
#       would pass this mutation completely. Only the context-line cells red — which is why the
#       allowed list below is short, and why a longer one would be the finding.
#
#   S2  the scan call site SEVERED — it still runs, over nothing. The guardrail stops existing while
#       every type checks and the call is still visibly there, which is how a wiring defect survives
#       review. This is the leg the plan names.
#
#   S3  the blocked summary line REUSING the applyable one. The applyable line prints the VALUE,
#       correctly, for a change nobody refused; reusing it for a blocked record puts the refused
#       secret into the inbox row on the way to refusing it — the leak moved one field to the left,
#       past a `scanFindings` shape that structurally cannot carry it. This leg is why cell (4)
#       exists and is what makes the blocked line's separateness a measured property.
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
# THE DIST REBUILD IS BAKED IN, AND IT IS PROVEN RATHER THAN ASSUMED. The subject lives in
# `packages/agent/src`; the agent leg's suite is in the same package and vitest resolves it from
# SOURCE, but the `cli` leg imports `@vostride/agent-qa-agent` through its published `dist`. A
# mutation applied to one package and measured through another's suite is VACUOUS without a rebuild,
# and a rebuild that silently failed is the same thing wearing a passing build log. So every
# mutation carries a unique MARKER — as CODE, never as a comment — and each leg greps the built
# artifact for it before it believes a single test result.
#
# THE MARKER IS CODE BECAUSE A COMMENT MARKER WAS MEASURED USELESS HERE. The first draft appended
# `// MUTATION_395_04_MARKER` to each mutated line. `packages/agent`'s bundler STRIPS comments from
# its dist (`packages/agent-local`'s does not, which is why the difference is easy to miss), so the
# marker count came back 0 on a rebuild that had actually taken — and this check refused the leg, as
# it should have. A marker that can be erased by a build step cannot prove that build step ran.
#
# USAGE
#   bash agent-qa/scripts/395-scan-mutation.sh   # from the super-repository root
#   bash scripts/395-scan-mutation.sh            # from the agent-qa root
#
# KNOBS
#   SCAN_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation" — which is what proves this script itself can fail.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SUBJECT="packages/agent/src/config-mutation/construct.ts"
AGENT_DIST="packages/agent/dist/index.js"

AGENT_FILTER="@vostride/agent-qa-agent"
CLI_FILTER="agent-qa"
AGENT_SUITE="src/config-mutation/__tests__/construct-blocked.test.ts"
CLI_SUITE="src/composition/__tests__/config-blocked-renders.test.ts"
AGENT_PREFIX="the blocked posture: one posture, two reasons (CFGM-01 · D-10)"
CLI_PREFIX="CFGM-02 on the surfaces a person reads (D-10/D-12)"

WORK="$(mktemp -d)"
LOG="$WORK/leg.log"
SNAPSHOT="$WORK/construct.ts.snapshot"

restore_subject () { cp "$SNAPSHOT" "$REPO_ROOT/$SUBJECT" 2>/dev/null || true; }
trap 'restore_subject; rm -rf "$WORK"' EXIT

cp "$REPO_ROOT/$SUBJECT" "$SNAPSHOT"
BASELINE_SHA="$(shasum -a 256 "$SNAPSHOT" | cut -d' ' -f1)"
echo "subject   $SUBJECT"
echo "  sha256  $BASELINE_SHA"
echo

# S1 narrows the scan to the changed lines. The context-line cells red; the cells whose secret is on
# an ADDED line stay green, and that asymmetry is the whole point of the leg.
ALLOWED_S1="D-12: a secret on a CONTEXT line blocks, and is named as already committed
a committed secret on a CONTEXT line blocks an innocuous edit
list and show name the file and the reason, and carry no window of the secret
accepting the blocked proposal answers not-applyable and commits nothing"
# S2 severs the scan. Every guardrail cell reds, including the invocation counter.
ALLOWED_S2="files a BLOCKED record when the proposed change would write a secret
the persisted record carries no diff, no content, and no window of the secret
the blocked summary line drops the value the applyable one would print
D-12: a secret on a CONTEXT line blocks, and is named as already committed
a secret the change itself introduces is NOT described as already committed
the two reasons are told apart, and the guardrail wins when both apply
the scan really runs on every construction
a committed secret on a CONTEXT line blocks an innocuous edit
list and show name the file and the reason, and carry no window of the secret
accepting the blocked posture
accepting the blocked proposal answers not-applyable and commits nothing"
# S3 leaks the refused value through the blocked summary line. EXACTLY the disclosure cells red —
# the block itself still happens, which is what makes this the subtle one.
ALLOWED_S3="the persisted record carries no diff, no content, and no window of the secret
the blocked summary line drops the value the applyable one would print
D-12: a secret on a CONTEXT line blocks, and is named as already committed
a secret the change itself introduces is NOT described as already committed
the two reasons are told apart, and the guardrail wins when both apply
list and show name the file and the reason, and carry no window of the secret
accepting the blocked proposal answers not-applyable and commits nothing"

MARKER="MUTATION_395_04_MARKER"

# THE MUTATIONS ARE APPLIED BY EXACT STRING REPLACEMENT, with a single-occurrence assertion on the
# anchor, rather than by a regex over a bracket-heavy line. This project has recorded two false
# "DID NOT APPLY" verdicts from escaping — one from BRE bracket handling and one from a shell-mangled
# multi-line pattern — so the anchor is compared literally and the count is asserted to be exactly 1.
apply_mutation () {
  case "${SCAN_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  MUTATION_NAME="$1" MARKER="$MARKER" SUBJECT_PATH="$REPO_ROOT/$SUBJECT" python3 <<'PY'
import os
import sys

name = os.environ['MUTATION_NAME']
marker = os.environ['MARKER']
path = os.environ['SUBJECT_PATH']

# S1: "scan the diff" read as the changed lines — the most natural reading, and the D-12 defect.
# S2: the call site severed. It still runs, still typechecks, and sees nothing.
# S3: the blocked line reusing the applyable one, which prints the VALUE the guardrail just refused.
MUTATIONS = {
    'S1': (
        r"text: change.hunks.map((hunk) => [hunk.header, ...hunk.lines].join('\n')).join('\n'),",
        "text: change.hunks.map((hunk) => [hunk.header, ...hunk.lines.filter("
        "(line) => line.startsWith('+') || line.startsWith('-') "
        "|| line.startsWith('%s'))]" % marker
        + r".join('\n')).join('\n'),",
    ),
    'S2': (
        "const scanned = deps.configScan.scan("
        "scanParts(change.path, change.changeKind, rendered.changes, mutated))",
        "const scanned = deps.configScan.scan([{ label: '%s', text: '' }])" % marker,
    ),
    'S3': (
        "summaryLine: configFieldSetBlockedSummaryLine(input.path, report.detail),",
        "summaryLine: configFieldSetSummaryLine(input.path, input.value),\n"
        "    ...(false ? { paths: ['%s'] } : {})," % marker,
    ),
}

if name not in MUTATIONS:
    sys.exit('FATAL: unknown mutation %s' % name)

anchor, replacement = MUTATIONS[name]
source = open(path).read()
found = source.count(anchor)
if found != 1:
    sys.exit(
        'FATAL: mutation %s expected exactly one occurrence of its anchor, found %d' % (name, found)
    )
open(path, 'w').write(source.replace(anchor, replacement, 1))
PY
}

assert_mutation_applied () {
  local name="$1"
  case "${SCAN_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  # CONFIRMED BY `diff` AGAINST THE SNAPSHOT, never by grepping for the pattern that was written —
  # a `grep` verdict over a bracket-heavy replacement has produced two false "DID NOT APPLY" reports
  # in this project's history.
  if diff -q "$SNAPSHOT" "$REPO_ROOT/$SUBJECT" > /dev/null; then
    echo "FATAL: mutation $name changed nothing — the anchor no longer matches the source" >&2
    exit 1
  fi
}

rebuild_agent_dist () {
  set +e
  pnpm --filter "$AGENT_FILTER" build > "$WORK/build.log" 2>&1
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: the agent rebuild failed — see $WORK/build.log" >&2
    exit 1
  fi
}

# THE PROOF THAT THE REBUILD TOOK. A count read off the built artifact, for a marker that exists
# nowhere else in the repository — so a stale dist reports 0 and this script stops rather than
# measuring the previous build's behaviour through a mutated source it never compiled.
assert_dist_carries_marker () {
  local expected="$1"
  case "${SCAN_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  local seen
  seen="$(grep -c "$MARKER" "$REPO_ROOT/$AGENT_DIST" || true)"
  echo "  dist marker count: $seen (expected $expected)"
  if [ "$seen" != "$expected" ]; then
    echo "FATAL: $AGENT_DIST does not carry the mutation marker — the rebuild did not take, so any" >&2
    echo "       result measured through it is a result about the PREVIOUS build" >&2
    exit 1
  fi
}

run_leg () {
  local name="$1" label="$2" allowed="$3" filter="$4" suite="$5" prefix="$6" needs_dist="$7"

  echo "=== MUTATION $name — $label   (measured through $filter)"
  restore_subject
  apply_mutation "$name"
  assert_mutation_applied "$name"
  echo "  subject sha256 $(shasum -a 256 "$REPO_ROOT/$SUBJECT" | cut -d' ' -f1)"

  if [ "$needs_dist" = "dist" ]; then
    rebuild_agent_dist
    assert_dist_carries_marker 1
  fi

  set +e
  pnpm --filter "$filter" exec vitest run "$suite" > "$LOG" 2>&1
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
  echo "  subject restored byte-identically"

  if [ "$needs_dist" = "dist" ]; then
    rebuild_agent_dist
    assert_dist_carries_marker 0
    echo "  dist rebuilt from the restored source"
  fi
  echo
}

echo "=== PREFLIGHT — the dependency dists and both suites must be green before any mutation"
set +e
pnpm --filter @vostride/agent-qa-schema build > "$WORK/build.log" 2>&1 \
  && pnpm --filter @vostride/agent-qa-safety build >> "$WORK/build.log" 2>&1 \
  && pnpm --filter "$AGENT_FILTER" build >> "$WORK/build.log" 2>&1 \
  && pnpm --filter @vostride/agent-qa-agent-local build >> "$WORK/build.log" 2>&1
BUILD_RC=$?
set -e
if [ "$BUILD_RC" -ne 0 ]; then
  echo "FATAL: the dependency rebuild failed — see $WORK/build.log" >&2
  exit 1
fi
assert_dist_carries_marker 0
for preflight in "$AGENT_FILTER|$AGENT_SUITE" "$CLI_FILTER|$CLI_SUITE"; do
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

run_leg S1 "the scan narrowed to the changed lines (D-12)" "$ALLOWED_S1" \
  "$AGENT_FILTER" "$AGENT_SUITE" "$AGENT_PREFIX" nodist
run_leg S1 "the scan narrowed to the changed lines, on the RENDER surfaces" "$ALLOWED_S1" \
  "$CLI_FILTER" "$CLI_SUITE" "$CLI_PREFIX" dist
run_leg S2 "the scan severed — it runs over nothing" "$ALLOWED_S2" \
  "$AGENT_FILTER" "$AGENT_SUITE" "$AGENT_PREFIX" nodist
run_leg S2 "the scan severed, on the RENDER surfaces" "$ALLOWED_S2" \
  "$CLI_FILTER" "$CLI_SUITE" "$CLI_PREFIX" dist
run_leg S3 "the blocked summary line reusing the applyable one" "$ALLOWED_S3" \
  "$AGENT_FILTER" "$AGENT_SUITE" "$AGENT_PREFIX" nodist

echo "PASS — a scan that reads only the changed lines is caught by the context-line cells and by"
echo "       nothing else; a severed scan is caught everywhere including its own invocation count;"
echo "       and a blocked record built from the applyable summary line is caught before it can"
echo "       carry a refused secret into an inbox row. Every leg observed RED, every restore was"
echo "       proven byte-identical, and every dist-measured leg proved its rebuild took."
