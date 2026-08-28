#!/usr/bin/env bash
#
# 405-failure-banner-mutation.sh — the acceptance bar for the FAILURE BANNER half of criterion 2
# (405-15, gap-closure round 1; the cells are 405-14's, WINDOWS #287).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. `conformance/run-detail-failure-dom.
# test.ts` asserts that seven facts hold about a FAILED run's summary banner: the producer masked it,
# the banner mounted truncated, the email is a typed chip in both states, the masking-seeded
# credential is restored inside the expanded banner, the CLIPBOARD carries only what the collapsed
# banner rendered, and none of the three planted values is at rest in the clear. Every one of those
# is a cell that asserts a fact is PRESENT — exactly the kind that
# passes for free when it is looking at the wrong element, waiting on the wrong node, or reading a
# fixture it accidentally produced itself. The only way to know a cell measures its fact is to take
# the fact away and watch the cell go red — and to watch its NEIGHBOURS stay green, because a
# mutation that reds the whole file is measuring blast radius.
#
# FOUR MUTATIONS, ONE PER FACT-CARRIER, ACROSS TWO PACKAGES:
#
#   M4  the banner's `MaskedText` render replaced by the raw string — the summary still arrives
#       through the display seam, the truncation still runs and the toggle still works; the only
#       thing this leg removes is the CHIP PAINTING
#   M5  405-12's M3 verbatim: the display-unmask seam still reads the sidecar, still resolves the
#       host key, still re-derives every candidate and still matches every digest, and restores
#       NOTHING
#   M6  `truncateMaskedText` hands its input back unchanged — the parse still runs, the chip seam
#       still paints, the seam still restores; the only thing this leg removes is the TRUNCATION
#   M7  the copy button's argument reverted to the whole summary — the page renders exactly what it
#       rendered before, the truncation still runs and the labels are still substituted; the only
#       thing this leg removes is the clipboard's AGREEMENT WITH THE PAGE
#
# WHAT EACH LEG IS EXPECTED TO REACH IS STATED IN ADVANCE, AND SO IS WHAT IT MUST NOT.
#
# M4 IS THE CHIP MUTATION. It reds (3c) and (3d) — the truncated and expanded chip claims — and it
# must red NOTHING else. (3a) reads the run-stream envelope, which never crosses this component.
# (3b) asks that the banner mounted showing a PREVIEW — shorter than the full text, ellipsis and
# all — which a raw render still does, because M4 removes the painting and not the budget. (3e) asks
# whether the RESTORED credential is inside the banner text, and a raw render still prints it: the
# restore happened upstream at the seam, so a banner that paints the string raw shows the restored
# value and the un-restorable markers side by side. (3f) is an at-rest scan of bytes this component
# never writes. Those four are the control, named below so the log records what did NOT move.
#
# M5 IS THE RESTORE MUTATION, AND ITS CONTROL IS THE POINT. (3e) is the ONLY cell of the six whose
# fact is RESTORATION. The chip cells do not depend on it — an unrestored placeholder is rewritten
# into a marker by the pass that runs last, and a marker is exactly what `MaskedText` paints as a
# chip — so (3c) and (3d) must stay green. Neither does the at-rest scan (3f): the seam is a DISPLAY
# lane and the bytes on disk and on the run-stream wire are masked by design (CONTEXT D-09). A
# mutation that also red the chip cells would mean (3e) is measuring "there is text in the banner"
# rather than "the seam restored it". (3b) is a control here for the same reason it is under M4: an
# unrestored placeholder becomes a one-word marker in place of a one-word value, so the word budget
# spends identically and the preview is cut in exactly the same place.
#
# M6 IS THE TRUNCATION MUTATION, AND IT EXISTS BECAUSE (3b) HAD NOTHING TO LOSE. Before this leg,
# `data-failure-banner-state` was derived from the toggle's `useState(false)` alone, so it read
# `truncated` on first paint for EVERY input and (3b) asserted a compile-time constant of the
# component — a cell naming a fact ("the truncation ran") it could not measure, and a control in the
# two lists below that was structurally incapable of moving. A control that has never been shown to
# move is a comment, by this script's own law below ("A GREEN SUITE UNDER ANY MUTATION IS A
# FAILURE OF THIS SCRIPT"). M6 is the measurement that (3b)
# can go red: with `truncateMaskedText` returning its input, the banner mounts showing the WHOLE
# summary and (3b) loses all three of its assertions — the state attribute, the preview being
# shorter than the full text, and the ellipsis.
#
# M6's blast radius is wider than one cell, and the reason is a property of the SUITE rather than a
# weakness of the leg, so it is written down rather than tuned away:
#
#   (3d) reds because the toggle is rendered only when something was cut. Nothing was, so there is
#        no `[data-failure-banner-toggle]` to click and `observed.toggled` is false.
#   (3e) reds on its SECOND assertion — "the credential is not in the preview". That is a fact about
#        truncation living inside the restore cell, and with the preview equal to the full text the
#        credential is in both. The entanglement is real and it is (3e)'s, not M6's.
#   (3g) reds for the same reason one medium over. With nothing cut, the banner mounts `full` and
#        the copy button copies what is on the page — which is now the WHOLE summary, restored
#        credential included. (3g) reds on its precondition (it asserts it measured a COLLAPSED
#        banner) and would red again on the credential. A clipboard cell cannot be insulated from
#        the truncation when its whole rule is "carry what was rendered".
#
# What makes M6 a measurement and not a blast radius is what stays green: (3a) reads the wire before
# any render, (3c) reads the chips — which are painted from the same markers whether the text was
# cut or not — and (3f) scans bytes at rest. Those three are named as the control below.
#
# M7 IS THE CLIPBOARD MUTATION, AND IT EXISTS BECAUSE THE CLIPBOARD HAD NOTHING TAKING ITS FACT
# AWAY. `copyTextOf` is the one function in this round that converts a redaction into a
# human-readable string in a SECOND medium, and until (3g) was written the only cell asserting it
# was a jsdom unit cell whose red-ability had never been demonstrated. The gap was not theoretical:
# the shipped button mapped the FULL summary regardless of banner state, so a click on a COLLAPSED
# banner put 47 words on the clipboard against 21 on the page — including the fixture's RESTORED
# credential at word 24, a value the reader had never been shown. That is what this leg restores.
#
# ITS BLAST RADIUS IS EXACTLY ONE CELL, and that is the point of where the mutation is placed. The
# argument to `copyTextOf` is read by nothing but the clipboard: the render call beside it is
# untouched, so the page paints the same chips over the same preview, the toggle still works, the
# seam still restores and the bytes at rest never went near the copy path. (3a) through (3f) are
# named as the control below — six cells, the whole rest of the file.
#
# WHY THE ARGUMENT IS SPELLED OUT AT BOTH SITES IN THE COMPONENT. `open ? summary : preview.text`
# appears twice — once in the render and once in the copy — rather than being hoisted into a shared
# `const`. M4's pattern matches the first literally and M7's matches the second; a hoist would leave
# M4 matching nothing, which is a FATAL by this script's law rather than a tidier component. The
# component says so at the call site so the next reader does not "clean it up".
#
# WHY THERE IS NO "TRUNCATE-BEFORE-PARSE" LEG IN THIS SCRIPT. The reviewer named a further
# candidate mutation: truncate the raw string BEFORE parsing it, restoring the page-local helper's
# wrong ordering. It is not a leg here, and the reason is narrower than it once said.
#
# THE MUTATION CANNOT RED A CELL OF *THIS* SUITE, which is a claim about the DOM file and nothing
# more. `truncateMaskedText` spends its word budget over segments precisely so a marker is one word;
# the naive helper split the RAW string on WHITESPACE, and today's marker spelling (`\x1f`-delimited,
# no whitespace inside) means a whitespace split cannot cut inside a marker. So on the fixture this
# file drives, both orderings produce the same preview, every cell here stays green, and a leg that
# cannot red is a FATAL by this script's own law — hence a written-down non-leg rather than a leg
# disguised as a passing one. The scope of that sentence is load-bearing: it does NOT mean the
# mutation reds nothing anywhere.
#
# WHAT ACTUALLY REDS UNDER IT IS `lib/__tests__/masked-text.test.ts:123-132` — "charges a marker
# glued to text exactly one word, and re-emits it unchanged". Its input is `contact:<EMAIL>.` with
# `maxWords: 2`. Parsed first, that is three words (`contact:`, the marker, `.`) and the cell's
# `expect(cut.isTruncated).toBe(true)` holds. Truncated first, the naive whitespace helper sees ONE
# token, decides nothing is over a budget of two and returns `{ text: input, isTruncated: false }` —
# and the cell reds on that expectation. A glued marker, not a whitespace-bearing one, is what
# separates the two orderings at HEAD.
#
# AND THERE IS NO CELL FEEDING THE HELPER A MARKER WHOSE PAYLOAD CONTAINS WHITESPACE. An earlier
# version of this block said there was, and pointed a future auditor at it. There is not, and one
# cannot be written through the published API: `maskedMarker` is `(category: MaskedCategory) =>
# string` over the closed set `secret | email` (`packages/schema/src/run/masked-marker.ts:50,61`),
# `MASKED_MARKER_PATTERN` is `/␟masked:(secret|email)␟/` (line 75), and a hand-typed
# `␟masked: secret␟` does not match that pattern — so it parses as ordinary TEXT and any cell built
# on it would assert the parser's stray-delimiter behaviour rather than the ordering. The whitespace
# case is the scenario `lib/masked-text.ts:59-64` says the ordering exists to survive, and it is
# guarded today by the ordering itself plus the glued-marker cell above, NOT by a cell that feeds it
# a whitespace payload. The day the schema pattern admits that form, that cell becomes writable and
# should be written; until then this block claims only the measurement that exists.
#
# EVERY LEG CROSSES A `dist` BOUNDARY AND THE REBUILD IS PART OF THE MUTATION. All three subjects
# are resolved by the spawned `agent-qa dashboard` as BUILT workspace dependencies — dashboard-ui's
# bundle for M4, M6 and M7, the cli dist for M5 — and the DOM file's own `buildFreshness` guard compares
# mtimes against those artifacts, so a restored-but-unbuilt source is "newer than" the build and
# every cell refuses to run at all. That is a red the leg never measured. `--force` is required for
# the same guard's sake in the other direction: a byte-identical restore is a turbo CACHE HIT, so a
# plain build reports FULL TURBO and refreshes no dist mtime. Measured in 405-12/405-13 (fd9b95ae).
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# THE VERDICTS ARE READ PER CELL FROM THE JSON REPORTER, never scraped out of prose. A cell name
# that gains a comma would silently stop matching a line-oriented grep, and the failure mode of that
# is a leg that reports "the named cell stayed green" about a cell that was red.
#
# THIS SCRIPT IS SLOW AND IT IS SLOW FOR A REASON. Nine forced workspace builds (preflight plus
# mutate-and-restore per leg) and five passes of a suite that spawns the built binary, launches a
# real Chromium and executes a real failing run through a real planning turn. Minutes, not seconds.
# It is the phase's ACCEPTANCE for the banner, run at wave merge and before `/gsd-verify-work`; the
# per-commit sample is the fast unit cells.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# USAGE
#   bash agent-qa/scripts/405-failure-banner-mutation.sh   # from the super-repository root
#   bash scripts/405-failure-banner-mutation.sh            # from the agent-qa root
#   pnpm validate:failure-banner-mutation                  # from the agent-qa root
#
# KNOBS
#   FAILURE_BANNER_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green under the mutation" — a gate nobody has seen fire is a comment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CLI_FILTER="agent-qa"

BANNER_SUBJECT="packages/dashboard-ui/src/components/run-detail/failure-banner.tsx"
UNMASK_SUBJECT="packages/cli/src/composition/display-unmask.ts"
TRUNCATE_SUBJECT="packages/dashboard-ui/src/lib/masked-text.ts"

SUBJECT_PATHS=("$BANNER_SUBJECT" "$UNMASK_SUBJECT" "$TRUNCATE_SUBJECT")

DOM_SUITE="src/__tests__/conformance/run-detail-failure-dom.test.ts"

WORK="$(mktemp -d)"
LOG="$WORK/leg.log"
VERDICTS="$WORK/verdicts.json"

snapshot_path () { echo "$WORK/$(echo "$1" | tr '/' '_').snapshot"; }

sha_of () {
  if command -v shasum > /dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else sha256sum "$1" | cut -d' ' -f1
  fi
}

# RESTORING IS A NO-OP WHEN THE BYTES ALREADY MATCH, and that is not tidiness. `cp` bumps an mtime
# whether or not it changes a byte, and the DOM cells' `buildFreshness` guard compares source mtimes
# against the dists they drive — so an unconditional restore in the EXIT trap, which runs AFTER this
# script's last rebuild, leaves every source "newer than" the artifacts and the next person to run
# the suite gets seven refusals that read exactly like a red. Measured by 404-04.
restore_subjects () {
  local path snapshot
  for path in "${SUBJECT_PATHS[@]}"; do
    snapshot="$(snapshot_path "$path")"
    [ -f "$snapshot" ] || continue
    cmp -s "$snapshot" "$REPO_ROOT/$path" && continue
    cp "$snapshot" "$REPO_ROOT/$path"
  done
}

trap 'restore_subjects; rm -rf "$WORK"' EXIT

declare -a BASELINE_SHAS=()
for path in "${SUBJECT_PATHS[@]}"; do
  cp "$REPO_ROOT/$path" "$(snapshot_path "$path")"
  sha="$(sha_of "$(snapshot_path "$path")")"
  BASELINE_SHAS+=("$sha")
  echo "subject   $path"
  echo "  sha256  $sha"
done
echo

# ── The named cells, by the ordinal each carries in its own name. REQUIRED is every cell the
# mutation exists to red; ALLOWED is everything a red is permitted to be; GREEN is the control —
# cells this mutation must NOT reach, asserted by name so the log carries what stayed still.
#
# The ordinals are the contract between this script and the suite. A cell renamed without its
# ordinal reds nothing here and this script says so by name rather than passing quietly.

# The two chip claims, and only those: the seam still restored, the banner still mounted, and the
# bytes at rest never went near this component.
REQUIRED_M4="(3c)
(3d)"
ALLOWED_M4="(3c)
(3d)"
GREEN_M4="(3a)
(3b)
(3e)
(3f)
(3g)"

# The one restore claim. The chips are painted from MARKERS, which an unrestored placeholder becomes
# — so a seam that restores nothing leaves (3c)/(3d) exactly as they were, and (3f) scans a lane the
# display seam never touches.
REQUIRED_M5="(3e)"
ALLOWED_M5="(3e)"
GREEN_M5="(3a)
(3b)
(3c)
(3d)
(3f)
(3g)"

# The truncation claim, plus the two cells that inherit it. (3b) is what this leg exists to move —
# it is the one cell whose whole subject is the preview. (3d) and (3e) are REQUIRED rather than
# merely ALLOWED because their dependence on the truncation is predicted above by name, and a
# prediction that is not asserted is a note: if either stayed green under M6 the analysis in the
# header would be wrong and this script should say so rather than pass.
REQUIRED_M6="(3b)
(3d)
(3e)
(3g)"
ALLOWED_M6="(3b)
(3d)
(3e)
(3g)"
GREEN_M6="(3a)
(3c)
(3f)"

# The one clipboard claim, and nothing else. The argument to `copyTextOf` is read by the clipboard
# and by nothing else on this page: the render call beside it is untouched, so the chips, the
# preview, the toggle, the restore and the bytes at rest are all exactly where the unmutated tree
# left them. Six controls for one required red is the widest control list in this script, and it is
# the reason this leg is worth its four minutes.
REQUIRED_M7="(3g)"
ALLOWED_M7="(3g)"
GREEN_M7="(3a)
(3b)
(3c)
(3d)
(3e)
(3f)"

apply_mutation () {
  case "${FAILURE_BANNER_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    M4)
      # The chip seam removed at the ONE render site. `truncateMaskedText` still runs above, the
      # toggle still switches `open`, and the clipboard path is untouched — so what this leg takes
      # away is the painting of markers into typed chips, and nothing else. The summary reaching
      # this expression is still the seam's output: restored where the host could, marker-bearing
      # where it could not.
      perl -0pi -e "s/          <MaskedText text=\{open \? summary : preview\.text\} \/>\n/          \{open ? summary : preview.text\}\n/" \
        "$REPO_ROOT/$BANNER_SUBJECT" ;;
    M5)
      # 405-12's M3 verbatim. The seam still reads the sidecar, still resolves the host key, still
      # re-derives every candidate and still matches the digests — and then puts the placeholder
      # back in place of the value it matched, so the marker pass that runs last rewrites every one
      # into a chip. A leg that had disabled the whole seam would also have removed the marker pass,
      # which is a different mutation with a different meaning.
      perl -0pi -e "s/            restore\.set\(placeholder, candidate\.value\)\n/            restore.set\(placeholder, placeholder\)\n/" \
        "$REPO_ROOT/$UNMASK_SUBJECT" ;;
    M6)
      # THE BUDGET REMOVED, THE PARSE LEFT WHERE IT IS. Both return statements collapse into the
      # at-or-under-budget one, so every input comes back byte-identical with `isTruncated: false`.
      # `splitMaskedText` still runs above it and the loop still walks the segments — this leg takes
      # away the TRUNCATION, not the ordering, and a leg that had deleted the parse as well would be
      # measuring two things at once. Collapsing the pair (rather than negating the condition) also
      # leaves no unreachable statement behind for the forced build to trip over.
      perl -0pi -e 's/  if \(total <= maxWords\) return \{ text, isTruncated: false \}\n  return \{[^\n]*\n/  return { text, isTruncated: false }\n/' \
        "$REPO_ROOT/$TRUNCATE_SUBJECT" ;;
    M7)
      # THE CLIPBOARD'S ARGUMENT REVERTED TO THE WHOLE SUMMARY, AND NOTHING ELSE MOVED. This is the
      # shipped defect, restored one token at a time: `copyTextOf` still substitutes every marker
      # for its published label, `MaskedText` still paints the same chips over the same preview and
      # the toggle still expands. What comes back is the state where a click on a COLLAPSED banner
      # copies text the reader was never shown — 47 words against 21 on the page, the fixture's
      # restored credential among them. The pattern matches the COPY call and not the render one
      # beside it, which is why the component spells the expression out at both sites.
      perl -0pi -e 's/copyTextOf\(open \? summary : preview\.text\)/copyTextOf(summary)/' \
        "$REPO_ROOT/$BANNER_SUBJECT" ;;
    *) echo "FATAL: unknown mutation $1" >&2; exit 1 ;;
  esac
}

# THE MUTATION IS ASSERTED TO HAVE LANDED. A `perl` substitution that matched nothing exits 0 and
# leaves the file untouched, and the leg would then measure an unmutated tree and report a green
# suite as the mutation "measuring nothing" — the right verdict for the wrong reason, and one that
# sends a reader looking at the cell instead of at this script's own pattern.
assert_mutated () {
  local index=0 path current
  for path in "${SUBJECT_PATHS[@]}"; do
    current="$(sha_of "$REPO_ROOT/$path")"
    if [ "$current" != "${BASELINE_SHAS[$index]}" ]; then return 0; fi
    index=$((index + 1))
  done
  return 1
}

build_all () {
  set +e
  pnpm turbo run build --force > "$WORK/build.log" 2>&1
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: the forced workspace build failed — see $WORK/build.log" >&2
    tail -40 "$WORK/build.log" >&2
    restore_subjects
    exit 1
  fi
}

assert_restored () {
  local index=0 path restored
  for path in "${SUBJECT_PATHS[@]}"; do
    restored="$(sha_of "$REPO_ROOT/$path")"
    if [ "$restored" != "${BASELINE_SHAS[$index]}" ]; then
      echo "FATAL: $path was not restored byte-identically ($restored)" >&2
      exit 1
    fi
    index=$((index + 1))
  done
  echo "  every subject restored byte-identically (sha256 compared)"
}

# Run the suite, leaving per-cell verdicts in $VERDICTS. Answers the process's own exit code.
#
# IT DOES NOT TOUCH `errexit` ITSELF, and that is a correctness point rather than a style one. A
# helper that ends with `set -e; return "$rc"` re-arms errexit and then returns non-zero — which
# aborts the caller at the call site, before the caller can read the code it asked for. The whole
# purpose of a mutation leg is to read a NON-ZERO exit, so the one function that produces it must
# leave the shell exactly as it found it. Every caller wraps the call in its own `set +e`/`set -e`.
run_suite () {
  rm -f "$VERDICTS"
  pnpm --filter "$CLI_FILTER" exec vitest run "$DOM_SUITE" \
    --reporter=json --outputFile="$VERDICTS" > "$LOG" 2>&1
}

# Every cell whose recorded status is not `passed`, one ordinal per line.
reds_from_verdicts () {
  node -e '
    const fs = require("node:fs")
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    const out = []
    for (const file of report.testResults ?? []) {
      for (const cell of file.assertionResults ?? []) {
        if (cell.status !== "passed") out.push(cell.title)
      }
    }
    process.stdout.write(out.join("\n"))
  ' "$VERDICTS"
}

# run_leg <name> <label> <required> <allowed> <green>
run_leg () {
  local name="$1" label="$2" required="$3" allowed="$4" green="$5"

  echo "=== MUTATION $name — $label"
  restore_subjects
  apply_mutation "$name"

  case "${FAILURE_BANNER_MUTATION_SELFTEST:-}" in
    neutered) echo "  SELFTEST=neutered: applying a NO-OP edit in place of $name" ;;
    *)
      if ! assert_mutated; then
        echo "FATAL: mutation $name changed no byte — its pattern no longer matches the subject" >&2
        exit 1
      fi ;;
  esac

  echo "  rebuilding every dist the spawned dashboard resolves, so it IS the mutated source"
  build_all

  set +e
  run_suite
  local rc=$?
  set -e
  echo "  leg exited $rc"

  if [ ! -f "$VERDICTS" ]; then
    echo "FATAL: mutation $name produced no per-cell verdicts — the suite never ran" >&2
    sed -n '1,60p' "$LOG" >&2
    restore_subjects
    build_all
    exit 1
  fi

  if [ "$rc" -eq 0 ]; then
    echo "FATAL: the suite stayed green under the mutation — mutation $name measures nothing" >&2
    restore_subjects
    build_all
    exit 1
  fi

  local red
  red="$(reds_from_verdicts)"
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
      build_all
      exit 1
    fi
  done <<< "$red"

  while IFS= read -r fragment; do
    [ -z "$fragment" ] && continue
    case "$red" in
      *"$fragment"*) echo "  REQUIRED red observed: $fragment" ;;
      *)
        echo "FATAL: mutation $name did not red its named cell: $fragment" >&2
        restore_subjects
        build_all
        exit 1 ;;
    esac
  done <<< "$required"

  while IFS= read -r fragment; do
    [ -z "$fragment" ] && continue
    case "$red" in
      *"$fragment"*)
        echo "FATAL: mutation $name red an expected NON-CATCHER: $fragment" >&2
        restore_subjects
        build_all
        exit 1 ;;
      *) echo "  expected non-catcher stayed green: $fragment" ;;
    esac
  done <<< "$green"

  restore_subjects
  build_all
  assert_restored
  echo
}

echo "=== PREFLIGHT — the dists these cells drive, then the pre-mutation suite"
build_all
set +e
run_suite
PREFLIGHT_RC=$?
set -e
echo "  $DOM_SUITE exited $PREFLIGHT_RC"
if [ "$PREFLIGHT_RC" -ne 0 ]; then
  echo "FATAL: $DOM_SUITE is already red before any mutation" >&2
  sed -n '1,100p' "$LOG" >&2
  exit 1
fi
echo

run_leg M4 "the banner's MaskedText render replaced by the raw string" "$REQUIRED_M4" "$ALLOWED_M4" "$GREEN_M4"
run_leg M5 "the display-unmask seam made a marker pass, restoring nothing" "$REQUIRED_M5" "$ALLOWED_M5" "$GREEN_M5"
run_leg M6 "truncateMaskedText hands its input back unchanged" "$REQUIRED_M6" "$ALLOWED_M6" "$GREEN_M6"
run_leg M7 "the copy button's argument reverted to the whole summary" "$REQUIRED_M7" "$ALLOWED_M7" "$GREEN_M7"

echo "PASS — taking the chip painting away from the banner red exactly the two chip cells, taking"
echo "       restoration away from the display seam red exactly the restore cell, taking the"
echo "       truncation away red the preview cell and the three claims that rest on it, and taking"
echo "       the clipboard's agreement with the page away red exactly the clipboard cell and left"
echo "       the other six standing, while the producer's masked wire, the chip painting and the"
echo "       at-rest scan of a failing run stayed green under every mutation that does not touch"
echo "       them."
