#!/usr/bin/env bash
#
# 406-failure-view-mutation.sh — the acceptance bar for ANLZ-01 and DETL-05 on the failure view
# (406-11; the cells are 406-10's, the apparatus is 405-15's as 406-09 repaired it).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. `conformance/failure-view-dom.test.ts`
# asserts that eleven facts hold about the page the shipped `agent-qa dashboard` serves: that a RED
# run's `analyze-run` job completed first-attempt and the model AUTHORED its verdict, that the block
# under member 0 reads the LLM-verdict provenance over the op's own sentence, that the cited
# screenshot is a real button whose bytes the pane fetched, that no masking delimiter reaches a text
# node, that a GREEN run still terminates with nothing to explain, and that once one blob is unlinked
# both ops say `present: false` while the page paints `evidence-incomplete` at BOTH ref sites with
# the verdict unmoved. Every one of those is a cell that asserts a fact is PRESENT — exactly the kind
# that passes for free when it is looking at the wrong element, waiting on the wrong node, or reading
# a fixture it accidentally produced itself. The only way to know a cell measures its fact is to take
# the fact away and watch the cell go red — and to watch its NEIGHBOURS stay green, because a
# mutation that reds the whole file is measuring blast radius.
#
# FIVE MUTATIONS, ONE PER FACT-CARRIER, ACROSS TWO PACKAGES:
#
#   M1   406-07's fix at the egress guardrail reverted — `isFractionalTail` goes back to the
#        2026-08-10 rule (suppress a zero-integer decimal, score everything else), so the analyze-run
#        prompt's memory-relevance score is read as a credit card again and the handler throws the
#        message the 399 job store recorded verbatim
#   M2   the failure view's absent cited artifact rendered as an ABSENT ROW — `ref.incomplete ?`'s
#        true branch returns `null`, so the ref is silently DROPPED from the row
#   M3a  the overview's absent ref rendered as a PLAIN AVAILABLE PANE — `ref.present === false` drops
#        out of `DecisionScreenshot`'s predicate, so the page mounts an `img` for a sha it was just
#        told is gone and learns about absence from a 404
#   M3b  the failure view's absent ref rendered as a PLAIN CLICKABLE LINK — the `ref.incomplete ?`
#        ternary collapses to its button branch, so an affordance that opens nothing is painted over
#        bytes that are not there
#   M4   the feedback entry removed from the run header (426 D-01); only (4a) reds
#
# WHAT EACH LEG IS EXPECTED TO REACH IS STATED IN ADVANCE, AND SO IS WHAT IT MUST NOT.
#
# M1 IS THE AUTHORING MUTATION, AND ITS BLAST RADIUS IS THE WIDEST IN THIS SCRIPT BY CONSTRUCTION.
# It removes the one thing that lets the model be asked at all: with the guardrail scoring the
# relevance score's Luhn-valid fraction again, `authorRunAnalysis`'s provider request throws
# `Guardrail blocked outbound prompt leaf: creditCard` — the 399 job store's own words — the job
# retries to its bound, and nothing durable carries a verdict. Measured, on this fixture, with the
# job row read out of `agent-jobs.db` after the dashboard exited:
#
#   [{"kind":"analyze-run","status":"queued","attempts":1,
#     "last_failure_reason":"handler-threw: Guardrail blocked outbound prompt leaf: creditCard"}]
#
# THE LEAF IS IN THE FIXTURE ON PURPOSE, AND IT IS THERE BECAUSE THIS SCRIPT MEASURED ITS ABSENCE.
# The first version of this leg reverted 406-07's fix, rebuilt every dist and ran the suite — and
# all ten cells stayed GREEN. The reason was not the cells: this fixture mints an EMPTY
# `agent-qa-knowledge` directory, so no memory is served, no `retrievalTrace` reaches the evidence
# pack, and the analyze-run prompt carried no printed float for the pre-fix rule to score. A cell
# that certifies a guardrail fix over a prompt the guardrail could never have blocked is certifying
# nothing, so `populated-run-fixture.ts` now plants the MEASURED 399 literal
# (`POPULATED_RETRIEVAL_SCORE`, `1.0285714285714285`) at the end of the failing arm's planner
# reasoning, which `quoteStep` copies into `subActions[].plan` and `volatileTier` copies into the
# author's prompt. Through the real `scan()` under the default policy that sentence is `pass` at
# HEAD and `block` / `creditCard` with this leg applied.
#
# SEVEN CELLS RED AND THEY ARE ALL PREDICTED BY NAME. (1a) reds on the job row, (1b) on the model's
# block that never mounted, (1c) on the citation that was never authored, and the DELETION drive's
# analysis-side cells — (3a) the wire's cited ref, (3c) the incomplete chip, (3b) the page-wide
# `data-evidence-state` count that includes the failure view's inline chip — red because a verdict
# that was never authored cites nothing to be missing.
#
# AND (1d) REDS ON A FACT ABOUT THE FLOOR, WHICH IS WORTH SAYING OUT LOUD. With no authored verdict
# the page still paints a block: `analysis.get`'s floor leg composes a sentence out of the failing
# step's recorded narration, and that narration is the planner's plan — the one string this fixture
# plants its masking-seeded credential in, restored for the reader by the display seam. So (1d)'s
# BLOCK-SCOPED clause ("no planted value inside the verdict the model wrote") fires, not because
# masking broke, but because the block on the page is no longer the model's. Its page-wide clauses —
# the delimiter, the placeholder, the visible email, the declared secret — all still hold. A leg that
# had listed (1d) as a control would have been wrong about the product, so it is REQUIRED here.
#
# WHAT STAYS GREEN UNDER M1 IS THE POINT OF THE LEG. (2a) and (2b) are the green control's own cells
# and they must not move: a run with nothing to explain has no unknown-floor member, so
# `authorRunAnalysis` never calls the model at all and its chain never reaches the seam this leg
# mutates. A guardrail retune that broke the runs which already worked would be a different defect
# wearing ANLZ-01's clothes. (3d) is the before/after comparison, which asks only that losing a
# screenshot did not RE-GRADE anything — and it does not, because the floor block the page paints
# after the deletion is the same floor block it painted before. That green is the weaker of the two
# under this leg and it is named as such rather than counted twice: what makes (3d) a measured cell
# is M2/M3a/M3b, where an AUTHORED verdict is on the page and stays put.
#
# M2 IS THE DROPPED-ROW MUTATION. `ref.incomplete ?`'s true branch stops rendering the chip, so the
# absent ref leaves the row entirely — the exact failure D-19 forbids, where a reader counts the
# links and concludes the verdict cited fewer things than it did. (3c) reds on the chip that is not
# there. (3b) reds WITH it, and the entanglement is (3b)'s rather than this leg's: `evidenceStates`
# is a PAGE-WIDE reading of `data-evidence-state`, and its expected pair is one attribute from the
# overview pane and one from this very chip, so a leg that removes the failure view's chip removes
# half of a count the overview's cell asserts. That is written down rather than tuned away, because
# the alternative — narrowing (3b) to its own subtree — would weaken a ratified cell to flatter a
# mutation script.
#
# WHAT STAYS GREEN UNDER M2 IS THE REST OF THE FILE: (3a) reads the WIRE, before any render; (3d)
# compares the badge, the producer, the sentence and the provenance, none of which this ternary
# touches; (1a)-(1d) never see an incomplete ref at all, because before the deletion every cited
# artifact's bytes are on disk and the row takes the button branch; and the green run cites nothing.
# Eight controls for two required reds.
#
# M3a IS THE PLAIN-PASS MUTATION AT THE OVERVIEW, AND ITS SUBJECT IS THE PREDICATE D-17 EXISTS FOR.
# `ref.present === false` is what lets the pane know the bytes are gone WITHOUT asking; drop it and
# the pane renders `available`, mounts the `img`, asks the door for a sha the op has already reported
# absent, and learns about the absence from a 404 it then has to interpret. (3b) is REQUIRED and it
# is the only required red: the cell asserts the pane's state, the page-wide `incomplete` pair AND
# that ZERO artifact requests were made, and this leg moves all three.
#
# ITS CONTROL LIST IS THE WIDEST IN THIS SCRIPT — ten cells. The failure view's own ternary is
# untouched, so (3c)'s chip and its count line are exactly where the unmutated tree left them; the
# wire in (3a) never crosses this component; (3d)'s four comparisons are of the verdict, not the
# pane; and (1a)-(1d)/(2a)-(2b) drive a page whose bytes are all present, where `present === false`
# is false for every ref and the mutated clause could not have fired.
#
# M3b IS THE PLAIN-PASS MUTATION AT THE FAILURE VIEW, AND IT IS THE ONE D-19 NAMES AS THE WORSE LIE.
# The ternary collapses to its button branch, so the absent ref is painted as an ordinary clickable
# affordance under `data-cited-artifact` — a link that opens a drawer tab for bytes that do not
# exist. (3c) reds twice over: the chip is gone from `citedArtifactStates` AND the sha is back in
# `citedArtifacts`, which the cell asserts is empty after the deletion. (3b) reds with it for M2's
# reason, unchanged: the inline chip is half of a page-wide count. Everything else is M2's control
# list, for M2's reasons.
#
# M2 AND M3b EDIT THE SAME TERNARY AND THAT IS WHY BOTH EXIST. Dropping the row and rendering it as
# a link are the two DIFFERENT ways the same expression can be wrong, and D-20 names both: never
# silently dropped, never masquerading as a pass. A single leg over that ternary would have proved
# only that the cell notices SOMETHING changed there.
#
# THE MUTATED EXPRESSIONS ARE SPELLED LITERALLY AT THEIR SITES, ON PURPOSE. `ref.incomplete ?` is
# written once in `verdict-block.tsx` and is not hoisted into a helper — 406-08 says so at the call
# site. The shared frameUsable predicate in lib/playhead.ts owns the frame presence check;
# M3a follows that predicate. A missing literal remains fatal. The patterns and the sites:
#
#   M1   packages/safety/src/guardrail/detectors.ts        `isFractionalTail`'s round-trip tail
#   M2   .../run-detail/verdict-block.tsx                  `ref.incomplete ? (` … `) : (`
#   M3a  .../lib/playhead.ts                             `&& ref.present !== false`
#   M3b  .../run-detail/verdict-block.tsx                  `ref.incomplete ? (` … `) : (`
#   M4   .../run-detail/run-navbar.tsx                     `{feedbackEntry === undefined ? null : (`
#
# EVERY LEG CROSSES A `dist` BOUNDARY AND THE REBUILD IS PART OF THE MUTATION. All four subjects are
# resolved by the spawned `agent-qa dashboard` as BUILT workspace dependencies — dashboard-ui's
# bundle for M2/M3a/M3b/M4, the safety dist the CLI links for M1 — and the DOM file's own
# `buildFreshness(POPULATED_RUN_ANCHORED_BUILDS)` guard compares mtimes against those artifacts, so a
# restored-but-unbuilt source refuses every cell with a message that reads exactly like a red. That
# is a red the leg never measured. `--force` is required for the same guard's sake in the other
# direction: a byte-identical restore is a turbo CACHE HIT, so a plain build reports FULL TURBO and
# refreshes no dist mtime.
#
# AND THAT APPLIES TO THE ERROR PATHS (WINDOWS #294, fixed in 406-09). `restore_and_rebuild` is the
# only restore any error path calls: it copies, and if it copied anything it rebuilds. Inside a
# failed build and inside the EXIT trap it prints the `pnpm turbo run build --force` notice instead —
# the first because the build is what just failed, the second because an EXIT trap can be running
# under a ^C and a person aborting this script did not ask for four more minutes of turbo.
#
# THE MUTATION GUARD ASSERTS ABOUT THE LEG'S OWN SUBJECT (WINDOWS #298, fixed in 406-09). A guard
# that answered "something in the tree changed" could certify M3a while `verdict-block.tsx` was dirty
# for an unrelated reason, and the leg would then reach the right verdict for the wrong reason.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# THE VERDICTS ARE READ PER CELL FROM THE JSON REPORTER, never scraped out of prose. A cell name that
# gains a comma would silently stop matching a line-oriented grep, and the failure mode of that is a
# leg that reports "the named cell stayed green" about a cell that was red.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# THIS SCRIPT IS SLOW AND IT IS SLOW FOR A REASON. Eleven forced workspace builds (preflight plus
# mutate-and-restore per leg) and six passes of a suite that spawns the built binary twice, launches
# a real Chromium, executes a real failing run and a real passing run through real planning turns,
# and unlinks a blob between two browser contexts. Tens of minutes, not seconds. It is the phase's
# ACCEPTANCE for ANLZ-01 and DETL-05, run at wave merge and before `/gsd-verify-work`; the per-commit
# sample is `FAILURE_VIEW_MUTATION_ONLY=M2` plus the neutered refusal.
#
# USAGE
#   bash agent-qa/scripts/406-failure-view-mutation.sh   # from the super-repository root
#   bash scripts/406-failure-view-mutation.sh            # from the agent-qa root
#   pnpm validate:failure-view-mutation                  # from the agent-qa root
#
# KNOBS
#   FAILURE_VIEW_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The byte guard must FATAL at "changed no byte".
#   FAILURE_VIEW_MUTATION_ONLY=M1|M2|M3a|M3b|M4
#       run ONE leg (the preflight still runs). A single leg is a SAMPLE, never the acceptance: the
#       script says so on the way out so nobody quotes a one-leg run as the bar.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CLI_FILTER="agent-qa"

case "${FAILURE_VIEW_MUTATION_ONLY:-}" in
  ''|M1|M2|M3a|M3b|M4) ;;
  *) echo "FATAL: unknown FAILURE_VIEW_MUTATION_ONLY=${FAILURE_VIEW_MUTATION_ONLY}" >&2; exit 1 ;;
esac

SEAM_SUBJECT="packages/safety/src/guardrail/detectors.ts"
VERDICT_SUBJECT="packages/dashboard-ui/src/components/run-detail/verdict-block.tsx"
OVERVIEW_SUBJECT="packages/dashboard-ui/src/lib/playhead.ts"
NAVBAR_SUBJECT="packages/dashboard-ui/src/components/run-detail/run-navbar.tsx"

SUBJECT_PATHS=("$SEAM_SUBJECT" "$VERDICT_SUBJECT" "$OVERVIEW_SUBJECT" "$NAVBAR_SUBJECT")

DOM_SUITE="src/__tests__/conformance/failure-view-dom.test.ts"

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
# the suite gets eleven refusals that read exactly like a red.
#
# AND IT REPORTS WHETHER IT ACTUALLY COPIED, because that is what lets `restore_and_rebuild` below
# know a rebuild is owed on an ERROR path, where the file on disk IS still mutated.
RESTORE_COPIED=0
restore_subjects () {
  local path snapshot
  RESTORE_COPIED=0
  for path in "${SUBJECT_PATHS[@]}"; do
    snapshot="$(snapshot_path "$path")"
    [ -f "$snapshot" ] || continue
    cmp -s "$snapshot" "$REPO_ROOT/$path" && continue
    cp "$snapshot" "$REPO_ROOT/$path"
    RESTORE_COPIED=1
  done
}

REBUILD_NOTICE="NOTICE: the subjects were restored from their snapshots, which bumps their mtimes,
and this run could not rebuild afterwards. Every dist in this workspace is now OLDER than its
source and failure-view-dom.test.ts will refuse every cell with a freshness message that
reads exactly like a red. RUN THIS BEFORE BELIEVING ANY SUITE:

  ( cd $REPO_ROOT && pnpm turbo run build --force )
"

# THE ONLY RESTORE ANY ERROR PATH CALLS, because a restore is only half of putting the tree back.
# The other half is the build: `--force`, because a byte-identical restore is a turbo CACHE HIT and
# a plain build would report FULL TURBO and refresh no dist mtime.
#
# RECURSION IS GUARDED RATHER THAN RISKED. `build_all`'s own failure branch calls this, and the thing
# that just failed is the build — so a second one would fail the same way, forever.
BUILDING=0
IN_EXIT_TRAP=0
restore_and_rebuild () {
  restore_subjects
  if [ "$RESTORE_COPIED" -eq 0 ]; then
    return 0
  fi
  if [ "$BUILDING" -eq 1 ] || [ "$IN_EXIT_TRAP" -eq 1 ]; then
    echo "$REBUILD_NOTICE" >&2
    return 0
  fi
  build_all
}

on_exit () {
  IN_EXIT_TRAP=1
  restore_and_rebuild
  rm -rf "$WORK"
}

trap on_exit EXIT

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
# EVERY ONE OF THE ELEVEN IS CLASSIFIED IN EVERY LEG. There is no third bucket of cells nobody
# predicted: a cell missing from both lists is a cell whose behaviour under the mutation was never
# reasoned about, and this file's whole claim is that the reasoning was done in advance.
#
# The ordinals are the contract between this script and the suite. A cell renamed without its
# ordinal reds nothing here and this script says so by name rather than passing quietly.

# The authoring claim and everything that rests on it. Eight of eleven, predicted by name above —
# including (1d), whose block-scoped clause reads the FLOOR's sentence once the model's is gone.
# 419-11 measured (4a) as another REQUIRED catcher: the exact same planted reasoning float reaches
# the marked cassette and label. Reverting its generic egress fix must refuse that real freeze too.
# Audit fingerprint 3e30cfd8846b918c is the candidate `0285714285714285 `, including its final space.
REQUIRED_M1="(1a)
(1b)
(1c)
(1d)
(3a)
(3b)
(3c)
(4a)"
ALLOWED_M1="(1a)
(1b)
(1c)
(1d)
(3a)
(3b)
(3c)
(4a)"
GREEN_M1="(2a)
(2b)
(3d)"

# The dropped-row claim, plus the page-wide count that includes the chip it drops.
REQUIRED_M2="(3b)
(3c)"
ALLOWED_M2="(3b)
(3c)"
GREEN_M2="(1a)
(1b)
(1c)
(1d)
(2a)
(2b)
(3a)
(3d)
(4a)"

# The overview's own claim, and nothing else. Ten controls for one required red — the widest
# control list in this script, and the reason this leg is worth its build.
REQUIRED_M3A="(3b)"
ALLOWED_M3A="(3b)"
GREEN_M3A="(1a)
(1b)
(1c)
(1d)
(2a)
(2b)
(3a)
(3c)
(3d)
(4a)"

# The plain-link claim, plus the same page-wide count for the same reason as M2.
REQUIRED_M3B="(3b)
(3c)"
ALLOWED_M3B="(3b)
(3c)"
GREEN_M3B="(1a)
(1b)
(1c)
(1d)
(2a)
(2b)
(3a)
(3d)
(4a)"

# 419 D-16: the mark action is independent of the authored verdict and missing screenshot UI.
REQUIRED_M4="(4a)"
ALLOWED_M4="(4a)"
GREEN_M4="(1a)
(1b)
(1c)
(1d)
(2a)
(2b)
(3a)
(3b)
(3c)
(3d)"

apply_mutation () {
  case "${FAILURE_VIEW_MUTATION_SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  case "$1" in
    M1)
      # 406-07'S FIX REVERTED AT THE FUNCTION THAT CARRIES IT, AND NOWHERE ELSE. The whole
      # nonzero-integer arm — the right-hand delimiter walk and the round-trip test — collapses into
      # `return false`, which is the 2026-08-10 rule verbatim: a standalone ZERO-integer decimal is a
      # fractional tail, everything else falls through to Luhn scoring. `matchCreditCards` above is
      # untouched, the candidate regex is untouched and the policy is untouched: this leg takes away
      # the SUPPRESSION OF A PRINTED FLOAT and nothing else, which is exactly the state the three
      # permanently-failed 399 `analyze-run` jobs died in. Collapsing the tail (rather than negating
      # the last return) also leaves no unused local behind for the build to trip over.
      perl -0pi -e 's/  let fractionEnd = start\n(?:.*\n)*?  return Number\.isFinite\(value\) && String\(value\) === literal\n/  return false\n/' \
        "$REPO_ROOT/$SEAM_SUBJECT" ;;
    M2)
      # THE ABSENT REF DROPPED FROM THE ROW. The ternary keeps its shape and its condition — the
      # projection still decides `incomplete`, the count line below still renders, the present
      # siblings still take the button branch — and the true branch answers `null`, so the one thing
      # this leg removes is the CHIP KEEPING ITS PLACE.
      perl -0pi -e 's/            ref\.incomplete \? \(\n(?:.*\n)*?            \) : \(\n/            ref.incomplete ? null : (\n/' \
        "$REPO_ROOT/$VERDICT_SUBJECT" ;;
    M3a)
      # THE READ-TIME ABSENCE DROPPED FROM THE PANE'S PREDICATE. The producer's own
      # `evidenceIncomplete` flag and the failed-load fallback both stay, so the pane can still reach
      # `unavailable` by the two roads that do not know in advance; what this leg removes is the one
      # road that DOES — D-17's read-time stat — and with it the page's ability to avoid asking.
      perl -0pi -e 's/ref\.evidenceIncomplete !== true && ref\.present !== false/ref.evidenceIncomplete !== true/' \
        "$REPO_ROOT/$OVERVIEW_SUBJECT" ;;
    M3b)
      # THE TERNARY COLLAPSED TO ITS BUTTON BRANCH. Same expression as M2, the opposite wrong answer:
      # instead of vanishing, the absent ref is painted as an ordinary clickable affordance over
      # bytes that are not there — the "affordance that opens nothing" the one component's own header
      # names as the worse lie.
      perl -0pi -e 's/            ref\.incomplete \? \(\n(?:.*\n)*?            \) : \(\n/            (\n/' \
        "$REPO_ROOT/$VERDICT_SUBJECT" ;;
    M4)
      # The test-level feedback entry after the verdict badge, the one door (4a) opens the composer by.
      perl -0pi -e 's/        \{feedbackEntry === undefined \? null : \(\n(?:.*\n)*?        \)\}\n//' \
        "$REPO_ROOT/$NAVBAR_SUBJECT" ;;
    *) echo "FATAL: unknown mutation $1" >&2; exit 1 ;;
  esac
}

# The baseline sha recorded for ONE subject, by path — the parallel array read by name.
baseline_of () {
  local index=0 path
  for path in "${SUBJECT_PATHS[@]}"; do
    if [ "$path" = "$1" ]; then echo "${BASELINE_SHAS[$index]}"; return 0; fi
    index=$((index + 1))
  done
  echo "FATAL: $1 is not one of this script's subjects" >&2
  exit 1
}

# THE MUTATION IS ASSERTED TO HAVE LANDED, ON THE LEG'S OWN SUBJECT (WINDOWS #298). A `perl`
# substitution that matched nothing exits 0 and leaves the file untouched, and the leg would then
# measure an unmutated tree and report a green suite as the mutation "measuring nothing" — the right
# verdict for the wrong reason, and one that sends a reader looking at the cell instead of at this
# script's pattern. The subject is a PARAMETER so the answer is about that file and no other.
assert_mutated () {
  local path="$1" baseline="$2" current
  current="$(sha_of "$REPO_ROOT/$path")"
  [ "$current" != "$baseline" ]
}

build_all () {
  BUILDING=1
  set +e
  pnpm turbo run build --force > "$WORK/build.log" 2>&1
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "FATAL: the forced workspace build failed — see $WORK/build.log" >&2
    tail -40 "$WORK/build.log" >&2
    # THE RESTORE STILL HAPPENS, AND SO DOES THE NOTICE. `BUILDING` is still 1, so
    # `restore_and_rebuild` restores and prints the `--force` instruction rather than starting a
    # second turbo run: the thing that just failed IS the build.
    restore_and_rebuild
    exit 1
  fi
  BUILDING=0
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
# IT DOES NOT TOUCH `errexit` ITSELF. A helper that ends with `set -e; return "$rc"` re-arms errexit
# and then returns non-zero — which aborts the caller at the call site, before the caller can read
# the code it asked for. The whole purpose of a mutation leg is to read a NON-ZERO exit, so the one
# function that produces it leaves the shell exactly as it found it.
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

# ONE LEG, OR ALL OF THEM. `FAILURE_VIEW_MUTATION_ONLY` is the per-commit sample: it skips the other
# legs by name so the log says which measurement was NOT taken.
assert_cell_census () {
  node -e '
    const fs = require("node:fs")
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    const split = text => text.split("\n").filter(Boolean)
    const required = split(process.argv[2]), allowed = split(process.argv[3]), green = split(process.argv[4])
    const cells = (report.testResults ?? []).flatMap(file => file.assertionResults ?? [])
    const ids = cells.map(cell => cell.title.match(/^\([1-4][a-d]\)/)?.[0])
    const expected = [...allowed, ...green]
    const fatal = message => { console.error(`FATAL: cell census ${message}`); process.exit(1) }
    if (cells.length !== 11 || ids.some(id => !id) || new Set(ids).size !== 11) fatal("must collect eleven uniquely named cells")
    if (new Set(expected).size !== expected.length || expected.length !== 11) fatal("must classify each cell exactly once")
    if (expected.some(id => !ids.includes(id)) || ids.some(id => !expected.includes(id))) fatal("does not match required/allowed/green lists")
    if (required.some(id => !allowed.includes(id))) fatal("required lies outside allowed")
    if (cells.some(cell => !["passed", "failed"].includes(cell.status))) fatal("contains skipped or unmeasured cells")
    for (const id of green) if (cells[ids.indexOf(id)].status !== "passed") fatal(`expected non-catcher ${id} did not pass`)
    console.log("  eleven cells collected; every expected non-catcher explicitly passed")
  ' "$VERDICTS" "$1" "$2" "$3"
}

should_run () {
  case "${FAILURE_VIEW_MUTATION_ONLY:-}" in
    ''|"$1") return 0 ;;
    *) echo "=== MUTATION $1 — SKIPPED (FAILURE_VIEW_MUTATION_ONLY=${FAILURE_VIEW_MUTATION_ONLY})"
       return 1 ;;
  esac
}

# run_leg <name> <subject> <label> <required> <allowed> <green>
run_leg () {
  local name="$1" subject="$2" label="$3" required="$4" allowed="$5" green="$6"

  should_run "$name" || return 0

  echo "=== MUTATION $name — $label"
  echo "  subject $subject"
  restore_and_rebuild
  apply_mutation "$name"

  case "${FAILURE_VIEW_MUTATION_SELFTEST:-}" in
    neutered) echo "  SELFTEST=neutered: applying a NO-OP edit in place of $name" ;;
  esac
  if ! assert_mutated "$subject" "$(baseline_of "$subject")"; then
    echo "FATAL: mutation $name changed no byte of $subject — its pattern no longer matches" >&2
    exit 1
  fi

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
    restore_and_rebuild
    exit 1
  fi

  if [ "$rc" -eq 0 ]; then
    echo "FATAL: the suite stayed green under the mutation — mutation $name measures nothing" >&2
    restore_and_rebuild
    exit 1
  fi

  if ! assert_cell_census "$required" "$allowed" "$green"; then
    sed -n '1,120p' "$LOG" >&2
    restore_and_rebuild
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
      restore_and_rebuild
      exit 1
    fi
  done <<< "$red"

  while IFS= read -r fragment; do
    [ -z "$fragment" ] && continue
    case "$red" in
      *"$fragment"*) echo "  REQUIRED red observed: $fragment" ;;
      *)
        echo "FATAL: mutation $name did not red its named cell: $fragment" >&2
        restore_and_rebuild
        exit 1 ;;
    esac
  done <<< "$required"

  while IFS= read -r fragment; do
    [ -z "$fragment" ] && continue
    case "$red" in
      *"$fragment"*)
        echo "FATAL: mutation $name red an expected NON-CATCHER: $fragment" >&2
        restore_and_rebuild
        exit 1 ;;
      *) echo "  expected non-catcher stayed green: $fragment" ;;
    esac
  done <<< "$green"

  restore_and_rebuild
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
  sed -n '1,120p' "$LOG" >&2
  exit 1
fi
assert_cell_census "$REQUIRED_M4" "$ALLOWED_M4" "$GREEN_M4"
echo

run_leg M1 "$SEAM_SUBJECT" "406-07's egress fix reverted — the analyze-run prompt is blocked again" "$REQUIRED_M1" "$ALLOWED_M1" "$GREEN_M1"
run_leg M2 "$VERDICT_SUBJECT" "the absent cited artifact dropped from the row" "$REQUIRED_M2" "$ALLOWED_M2" "$GREEN_M2"
run_leg M3a "$OVERVIEW_SUBJECT" "the overview's absent ref rendered as a plain available pane" "$REQUIRED_M3A" "$ALLOWED_M3A" "$GREEN_M3A"
run_leg M3b "$VERDICT_SUBJECT" "the absent cited artifact rendered as a plain clickable link" "$REQUIRED_M3B" "$ALLOWED_M3B" "$GREEN_M3B"
run_leg M4 "$NAVBAR_SUBJECT" "the feedback entry removed from the run header" "$REQUIRED_M4" "$ALLOWED_M4" "$GREEN_M4"

if [ -n "${FAILURE_VIEW_MUTATION_ONLY:-}" ]; then
  echo "SAMPLE — one leg (${FAILURE_VIEW_MUTATION_ONLY}) ran. This is the per-commit sample, NOT the"
  echo "         acceptance: the other four facts were not taken away in this run."
  exit 0
fi

echo "PASS — taking 406-07's fix away from the egress guardrail red the authored verdict and every"
echo "       cell that rests on it while the green run still completed, dropping the absent cited"
echo "       artifact from the row red exactly the chip cell and the page-wide count it is half of,"
echo "       rendering the overview's absent ref as an available pane red exactly the pane cell and"
echo "       left ten standing, and rendering the failure view's absent ref as a plain link red the"
echo "       same pair as the drop — while the wire's own answer, the verdict that was not re-graded"
echo "       and the masking scan stayed green under every mutation that does not touch them."
echo "       M4 removed the feedback entry from the run header and red exactly (4a), while all ten"
echo "       prior cells stayed green: five live legs passed."
echo "       M1 also required (4a) red: the shared egress mutation refused the same opaque float"
echo "       in the real gold freeze; its three original non-catchers stayed green."
