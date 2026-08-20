#!/usr/bin/env bash
#
# 399.1-render-mutation.sh — the acceptance bar for the chat render contract (Phase 399.1, FUNC-05).
#
# WHAT THIS PROVES, AND WHY 272 GREEN CELLS DO NOT PROVE IT. Phase 393's terminating lesson is that
# a cell can go green under the very implementation the frozen item forbids: A DETECTOR'S BAR IS THE
# IMPLEMENTATION IT MUST RED ON, NEVER THE SUITE IT PASSES. 399.1 shipped four load-bearing
# mechanisms and the conformance directory passing says only that this tree behaves. It does not say
# the suite would CATCH the four implementations this phase forbids. Each leg below edits shipped
# source into one of them:
#
#   CHANNEL  the turn stops putting anything on `results[]` — the pre-399.1 drop site reborn. The
#            payload is computed and discarded (`void answered.payload`), which is LITERALLY what
#            the engine did before D-05 gave the turn a member that could carry one, and it is the
#            state in which forty of forty-two capabilities rendered nothing for two phases.
#   VERDICT  `config.field.set`'s fold reports the `blocked` arm as `executed` — the exact
#            implementation D-01 forbids, and the literal G-399-2 defect: a guardrail declined to
#            write a secret into the config, the file was byte-unchanged, and chat said the mutation
#            was carried out.
#   CENSUS   the declaration projection drops `classifies` for ONE op while the op keeps folding.
#            This is the `as`-cast bypass the type system cannot see, stated as a projection lie:
#            `tsc` is satisfied, every fold still runs, and the product's own listing under-reports.
#   ROSTER   the `fn` row is removed from `SURFACE_ROSTER`. The door still exists, still dispatches,
#            still consults the gate — the roster simply stops naming it, which is the "surface the
#            parity claim silently excludes itself from" that `roster.ts`'s own header warns about.
#
# EVERY MUTATION IS THE FORBIDDEN IMPLEMENTATION AND NOTHING ELSE. No leg plants a marker string, a
# throw, or a sentinel — a mutation that reds because it tripped a schema, a type or a planted token
# manufactures confidence instead of measuring it (395's finding, not smoothed here). The rebuild
# proof below is what a planted marker would otherwise have bought, obtained from the mutation's own
# bytes rather than from an addition to it.
#
# THE FOUR RED SETS ARE ALMOST DISJOINT, AND THAT IS THE POINT OF HAVING FOUR. A file whose
# mutations all red the same rows would have proven its cells are restatements of one another.
# Measured 2026-08-20: 6 / 1 / 4 / 2 cells, no cell in two lists.
#
# 2026-08-20 (399.1-09), RE-MEASURED AT 7 / 2 / 4 / 2, AND ONE CELL IS NOW IN TWO LISTS. Plan 09's
# nested-composition anchor reds under CHANNEL and under VERDICT, and the overlap is a property of
# the cell rather than a weakening of the legs: it is the only cell that asserts a verdict word AND
# the payload the word is about, one composition layer up, so the two mutations reach it by two
# different roads (CHANNEL takes away the inner refusal it reads for non-vacuity; VERDICT turns that
# refusal into a success before it is folded). Every OTHER cell is still in at most one list, so the
# legs remain distinguishable from one another — which is what the disjointness was for.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS — and this script found
# one. See THE VERDICT LEG'S FINDING below.
#
# ── THE VERDICT LEG'S FINDING (2026-08-20) ──────────────────────────────────────────────────────
#
# On its first run the VERDICT leg reddened NOTHING: with `blocked` folded to `executed`, the whole
# conformance directory was 271/271 GREEN. That is G-399-2 itself passing this phase's own suite.
# The reason was structural rather than an oversight: every content assertion in
# `render-anchors.test.ts` reads the POST-MARKER slice — the payload block — and `receipt-line.ts`
# renders `  <status>  <op>  <clause>`, so the VERDICT WORD precedes the clause the marker is and no
# strict post-marker slice can carry it. A guardrail's own words printed underneath the word
# `executed` satisfied every cell in the file.
#
# THE SUITE WAS FIXED; THE LEG WAS NOT NARROWED (397 leg B's precedent, and its exact shape). A cell
# — `reports each arm's own VERDICT WORD on the receipt line, refusals and success alike` — now
# reads the marker's own line and pins `refused` / `refused` / `executed` across the two blocked
# arms and the applyable one, with the filed `payloadKind`s asserted first for non-vacuity. The leg
# reds exactly there. A leg list edited to match a vacuous suite would have left this phase's
# leading defect unguarded on the surface the phase is about.
#
# CORROBORATION, DELIBERATELY OUT OF THIS SCRIPT'S DENOMINATOR. The same mutation also reds three
# cells in `packages/agent/src/functions/__tests__/refusal-classifiers.test.ts` (measured: the two
# config-family fold cells and the fail-closed wrapper's control). That is a different register in a
# different package, and this script keeps ONE measured denominator so that four red sets are
# comparable and one cell floor applies to all of them. The agent-side reds are recorded in the
# 399.1-07 SUMMARY rather than folded in here.
#
# ── WHAT THE PLAN PREDICTED AND THE RUN DID NOT (2026-08-20) ────────────────────────────────────
#
# The plan expected the CHANNEL leg to red "the render-parity chat-door cells". IT DOES NOT, and the
# reason is worth carrying: `render-parity.test.ts`'s chat door calls `renderClauseResults` DIRECTLY
# with a document produced from the op's own contract. It is a unit-level render check and is blind
# to the channel by construction — correct for what it claims (coverage across 42 capabilities x 3
# doors) and unable to see a turn that put nothing on the wire. What sees the channel is the spawned
# anchors and the compound turn-shape cell, and those are what this leg's list names. The list
# follows the measurement, BY NAME; it was never widened to any-red.
#
# ── HOW THE RESTORE GUARANTEE IS SCOPED, AND WHY ────────────────────────────────────────────────
#
# THE CLEAN-TREE ASSERTION IS `git -C <agent-qa> status --porcelain`, OVER THE WHOLE SUBMODULE. The
# super-repository this submodule sits in carries ~100 pre-existing dirty paths (spec/, demo/,
# strategy/, node_modules) that no run of this script can clean and that have nothing to do with it,
# so a super-repo-wide check could only ever be RELAXED until it passed — and a relaxed restore
# check is worse than none, because a mutation that survives silently poisons every later
# measurement taken in this repository. The honest scope is the tree this script actually writes to:
# every subject below lives inside `agent-qa/`, and the assertion is that the ENTIRE submodule tree
# is clean, not merely that the four subjects were put back. Both halves are asserted — a per-subject
# sha256 AND the whole-tree status — and either failing is FATAL and non-zero.
#
# THE MUTATIONS ARE ANCHORED, AND A MISSING ANCHOR IS FATAL — a substitution that matches nothing
# would exit 0 and measure the shipped implementation against itself. Every anchor's occurrence
# count is asserted to be exactly 1 by literal comparison, never by a regex over bracket-heavy lines
# (this project has recorded two false "DID NOT APPLY" verdicts from escaping).
#
# THE REBUILD PROOF IS TWO-SIDED AND CARRIES NO PLANT. `pnpm build --force` is run before every
# measurement, and the built bundle is then required to contain the MUTATED bytes and NOT the
# ORIGINAL ones — and, after each restore, the exact opposite. tsup/esbuild emits this project's
# source nearly verbatim (no minifier), so both tokens are the mutation's own text. A stale dist
# therefore stops this script rather than letting it measure the previous build's behaviour through
# a source it never compiled — the trap this repository has been bitten by more than once.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# THREE WORKSPACE REDS ARE KNOWN AND PRE-EXISTING (embedding-bench `tau-lex`, knowledge-local
# `vec-parity`, cli `daemon-heartbeat-supervisor`; filed in the phase's deferred-items.md). None is
# in this script's denominator: the measured suite is `packages/cli/src/__tests__/conformance/`
# only, and the preflight requires it green before any mutation is applied.
#
# USAGE
#   bash agent-qa/scripts/399.1-render-mutation.sh   # from the super-repository root
#   bash scripts/399.1-render-mutation.sh            # from the agent-qa root
#
# KNOBS
#   SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. Every leg must then FATAL with "an allowed
#       cell did NOT red", and the script must exit 1 — which is what proves this script can fail,
#       and that a PASS above is not something it prints unconditionally. Unlike a fail-fast run,
#       the neutered run visits ALL FOUR legs and names each one's vacuity, so the self-test covers
#       the whole file rather than its first leg.
#   RENDER_MUTATION_NO_BUILD=1
#       INTERNAL, iteration only. Skips the rebuilds and the rebuild proofs. Never use it for a
#       result that is evidence.
#
# Case lookups and plain functions rather than associative arrays: macOS ships bash 3.2, where
# `declare -A` silently becomes an indexed array and every named key reads as unbound under `set -u`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_DIR="$ROOT/packages/cli"
SUITE_REL="src/__tests__/conformance/"
SCRIPT_REL="scripts/399.1-render-mutation.sh"
AGENT_DIST="$ROOT/packages/agent/dist/index.js"

cd "$ROOT"

# THE CELL FLOOR. A leg that "passed" because the suite collected nothing is the vacuity this whole
# file exists to refuse. 272 is the measured count at agent-qa c4de0279; it may only ever go up.
FROZEN_MIN_TESTS=272

WORK="$(mktemp -d)"

note ()  { echo "    $*"; }
fatal () { echo "FATAL: $*" >&2; restore_all; exit 1; }

# ── The subjects ────────────────────────────────────────────────────────────────────────────────
subject_of () {
  case "$1" in
    CHANNEL) echo "packages/agent/src/chat/turn-engine.ts" ;;
    VERDICT) echo "packages/agent/src/functions/ops/config-propose-verdict.ts" ;;
    CENSUS)  echo "packages/agent/src/functions/registry.ts" ;;
    ROSTER)  echo "packages/cli/src/__tests__/conformance/roster.ts" ;;
    *) echo "unknown-leg-$1" ;;
  esac
}
snapshot_of () { echo "$WORK/snapshot.$1"; }
sha_of ()      { shasum -a 256 "$1" | cut -d' ' -f1; }

restore_all () {
  local leg
  for leg in CHANNEL VERDICT CENSUS ROSTER; do
    [ -f "$(snapshot_of "$leg")" ] && cp "$(snapshot_of "$leg")" "$ROOT/$(subject_of "$leg")"
  done
  return 0
}
trap 'restore_all; rm -rf "$WORK"' EXIT

# ── The mutations ───────────────────────────────────────────────────────────────────────────────
#
# `from` and `to` arrive as FILES written by literal heredocs, so nothing in the replacement text is
# interpreted by a shell, by perl, or by a regex engine.

# CHANNEL — the payload is computed and DISCARDED. Not a comment and not a deletion: this is the
# pre-399.1 engine, which had no member on the turn contract that could carry a result. `results[]`
# stays declared, stays required, and stays empty for every turn — so a person reads the receipt
# line and nothing else, which is the reading 399's UAT rejected.
cat > "$WORK/from.CHANNEL" <<'ANCHOR'
        results.push({ functionId: step.functionId, payload: answered.payload })
ANCHOR
cat > "$WORK/to.CHANNEL" <<'ANCHOR'
        void answered.payload
ANCHOR

# VERDICT — the `blocked` arm reports `executed`. One word, and it is the one word D-01 exists to
# forbid: the guardrail refused, nothing was written, and the receipt certifies a change. The other
# three arms are untouched deliberately, so a build that answered `executed` for EVERYTHING (which
# would be a different and cruder defect) is not what is being measured here.
cat > "$WORK/from.VERDICT" <<'ANCHOR'
    case 'blocked':
      return { status: 'refused', outcome: output.blockedReason }
ANCHOR
cat > "$WORK/to.VERDICT" <<'ANCHOR'
    case 'blocked':
      return { status: 'executed', outcome: output.blockedReason }
ANCHOR

# CENSUS — the projection lies about ONE op. The spec still declares `classify`, the fold still runs
# on every call, and `tsc` sees nothing: what changes is only what the shipped registry SAYS it
# contains. That is the shape a spec registered through an `as`-cast produces, stated where it can
# be applied by an anchored edit; `classifier-census.test.ts`'s own header names this as the case
# the type layer cannot catch and the census exists for.
cat > "$WORK/from.CENSUS" <<'ANCHOR'
    ...(spec.classify === undefined ? {} : { classifies: true as const }),
ANCHOR
cat > "$WORK/to.CENSUS" <<'ANCHOR'
    ...(spec.classify === undefined || spec.id === 'runs.list'
      ? {} : { classifies: true as const }),
ANCHOR

# ROSTER — the third row is gone. The `fn` door still exists, still dispatches through
# `invokeFunction` and still consults the gate; the roster simply stops naming it. `roster.ts`'s own
# 2026-08-16 registration note calls this out as the failure mode that reads GREEN: "a surface
# without a row is not 'not yet covered' — it is a surface the parity claim silently excludes itself
# from". The import left unused is deliberate and harmless (`noUnusedLocals` is not set), so the
# mutation is a ROW removal and not a compile error wearing one.
cat > "$WORK/from.ROSTER" <<'ANCHOR'
  Object.freeze({ id: 'fn', adapter: fnSurfaceAdapter }),
ANCHOR
cat > "$WORK/to.ROSTER" <<'ANCHOR'
ANCHOR

# ── The rebuild proof tokens ────────────────────────────────────────────────────────────────────
#
# Read off `packages/agent/dist/index.js`, which tsup emits nearly verbatim from source (esbuild,
# no minifier — `undefined` becomes `void 0` and string quotes become double, which is why these are
# spelled as the BUNDLE spells them rather than as the source does). Each leg asserts BOTH: the
# mutated bytes present, and the original bytes gone. Counts are measured, not assumed.
#
# ROSTER's subject is a TEST file that vitest loads straight from `packages/cli/src`; there is no
# build step between the edit and the measurement, so there is nothing a rebuild proof could add and
# the leg says so rather than grepping an artifact that could never hold its token.
dist_token_mutated () {
  case "$1" in
    CHANNEL) echo 'void answered.payload' ;;
    VERDICT) echo 'status: "executed", outcome: output.blockedReason' ;;
    CENSUS)  echo 'spec.id === "runs.list"' ;;
    ROSTER)  echo "" ;;
  esac
}
dist_token_original () {
  case "$1" in
    CHANNEL) echo 'results.push({ functionId: step.functionId, payload: answered.payload })' ;;
    VERDICT) echo 'status: "refused", outcome: output.blockedReason' ;;
    CENSUS)  echo '...spec.classify === void 0 ? {} : { classifies: true },' ;;
    ROSTER)  echo "" ;;
  esac
}

# ── The allowed red lists ───────────────────────────────────────────────────────────────────────
#
# EXACT vitest `fullName`s (describe + cell), one per line, written through a quoted heredoc so an
# apostrophe inside a cell name survives. Each list is the WHOLE of what its leg claims, in BOTH
# directions: every name here must red, and nothing else in the directory may. A red outside the
# list is FATAL and is a finding — never a licence to widen.
#
# THE COUNTS ARE MEASURED, at agent-qa c4de0279, and where a measurement disagreed with the plan the
# list follows the measurement and the disagreement is recorded in the phase SUMMARY.

# 2026-08-20 (399.1-09): CHANNEL's fan-out is SEVEN. Plan 09's nested-composition cell joined the
# list BY NAME, measured, never by relaxing the leg. Its verdict-word claim survives an empty
# channel — `agent.ask` folds `receipts`, which this mutation does not touch — but its NON-VACUITY
# half reads the inner turn's own refusal out of the rendered payload, so a turn that carries no
# payload cannot satisfy it. That is the cell working as written: it refuses to certify an outer
# word without first seeing the inner refusal it is a word about.
#
# CHANNEL's fan-out was SIX: the four chat render anchors that read a payload off the terminal, the
# per-surface chat anchor whose CONTENT half compares child stdout to the child's own filed result,
# and the compound turn-shape cell whose `results[]`-vs-receipts ordering claim has nothing left to
# order. Two neighbours stay GREEN and both are explainable from the mutation rather than from luck:
# `prints no payload block … for a turn that executed nothing` asserts `results` IS `[]`, which an
# empty channel satisfies; and `renders three DIFFERENT filed payloads as three different terminal
# readings` still passes because the three RECEIPT lines differ by verdict and outcome even when
# every payload is withheld — distinguishability survives a total channel drop, which is a fact
# about that cell worth knowing and is recorded rather than smoothed.
cat > "$WORK/allowed.CHANNEL" <<'ALLOWED_CHANNEL'
399.1 — the turn shape a person reads (E2E-02 empty/ordering edges) prints a compound turn's payloads in the order its clauses ran
the chat render anchors (399.1, G-399-2) prints the guardrail refusal and its findings when a mutation would write a secret
the chat render anchors (399.1, G-399-2) prints the reviewable diff when the mutation is genuinely proposed
the chat render anchors (399.1, G-399-2) prints the validation refusal and the validator's own words when the result is invalid
the chat render anchors (399.1, G-399-2) renders a SECOND op's payload too, on the read door chat advertises itself
the chat render anchors (399.1, G-399-2) the nested composition: a refusal is never a success one composition layer up
the per-surface render anchors (399.1 D-08): in-process ≡ shipped chat: the shipped binary prints the bytes this process renders from its own filed result
ALLOWED_CHANNEL

# 2026-08-20 (399.1-09): VERDICT's fan-out is TWO. It was ONE, and that one cell existed because
# this leg found the file blind — see THE VERDICT LEG'S FINDING in the header. Plan 09's
# nested-composition cell is the second, joined BY NAME after being measured red: it reads the
# verdict word one COMPOSITION LAYER UP, so a `blocked` arm folded to `executed` reaches it through
# `agent.ask`'s own receipts fold. Two cells now read a verdict word rather than a payload block,
# one per layer, and this leg is the differential that says so.
cat > "$WORK/allowed.VERDICT" <<'ALLOWED_VERDICT'
the chat render anchors (399.1, G-399-2) reports each arm's own VERDICT WORD on the receipt line, refusals and success alike
the chat render anchors (399.1, G-399-2) the nested composition: a refusal is never a success one composition layer up
ALLOWED_VERDICT

# CENSUS's fan-out is FOUR, and the fourth is the one that matters most: the golden ledger cell in
# `parity.test.ts` is a comparison against a COMMITTED artifact a person reviewed, so an op that
# quietly stops being reported as folding is a reviewed one-line diff and not a silent shrink. The
# three census cells range the live enumerations; the ledger cell is what catches both live sides
# getting smaller together.
cat > "$WORK/allowed.CENSUS" <<'ALLOWED_CENSUS'
399.1 D-01 — the classifier census: no capability ships without a fold agrees with the committed ledger, so an op that STOPS folding is a reviewed diff
399.1 D-01 — the classifier census: no capability ships without a fold carries exactly one classifier per registered capability, in both directions
399.1 D-01 — the classifier census: no capability ships without a fold declares a classifier on every registered capability, naming any that does not
the parity suite ranges the registry census over every rostered surface matches the committed golden registry, op by op and field by field
ALLOWED_CENSUS

# ROSTER's fan-out is TWO, and the pair is the both-directions property D-04 asks for: the exact-list
# pin catches a row REMOVED or REPLACED, and the `perSurface.fn` join catches the row's column
# losing the live enumeration it is joined to. Note what does NOT red: `render-parity.test.ts`'s 42
# fn cells stay green, because `RENDER_DOORS` is its own declared table rather than a projection of
# the roster. That is a real asymmetry between the two files and it is named here rather than left
# for somebody to discover under a mutation they cared about.
cat > "$WORK/allowed.ROSTER" <<'ALLOWED_ROSTER'
the parity suite ranges the registry census over every rostered surface joins every row fn expectation to the live fn listing, in both directions
the parity suite ranges the registry census over every rostered surface pins the roster at the three surfaces that exist today
ALLOWED_ROSTER

# ── The needles ─────────────────────────────────────────────────────────────────────────────────
#
# THE RED MUST NAME THE THING, ON THE SURFACE A PERSON READS. A cell that reds without naming what
# broke tells a reviewer that something is wrong and not what. Both channels are searched — the
# assertion messages and the console diff — because the name lands in whichever one the value's
# depth allows (chai truncates a deep diff to `expected [ Array(1) ] to deeply equal []`, and the
# member is printed only in the unified diff the default reporter renders).
needle_of () {
  case "$1" in
    # The withholding, in the render's own vocabulary, naming the arm whose report never arrived.
    CHANNEL) echo "printed none of the guardrail arm's own report" ;;
    # THE FORBIDDEN IMPLEMENTATION ITSELF, as the terminal prints it: the word `executed` leading
    # the receipt line of a capability whose guardrail had just refused. This needle IS G-399-2.
    VERDICT) echo "executed  config.field.set" ;;
    # The op the projection lied about, by name.
    CENSUS)  echo "runs.list" ;;
    # The door the roster stopped naming, in the pin's own diff.
    ROSTER)  echo "[ 'chat', 'mcp', 'fn' ]" ;;
  esac
}

# ── Applying, and proving it applied ────────────────────────────────────────────────────────────
apply_mutation () {
  local leg="$1"
  case "${SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  node -e '
    const fs = require("fs")
    const [file, fromPath, toPath] = process.argv.slice(1)
    const source = fs.readFileSync(file, "utf8")
    const from = fs.readFileSync(fromPath, "utf8")
    const to = fs.readFileSync(toPath, "utf8")
    const seen = source.split(from).length - 1
    if (seen !== 1) {
      console.error("FATAL: the mutation anchor occurs " + seen + " times in " + file + " (expected exactly 1)")
      process.exit(1)
    }
    fs.writeFileSync(file, source.replace(from, to))
  ' "$ROOT/$(subject_of "$leg")" "$WORK/from.$leg" "$WORK/to.$leg" \
    || fatal "leg $leg's anchor did not match its subject exactly once"
}

# CONFIRMED BY `diff` AGAINST THE SNAPSHOT, never by grepping for the pattern that was written.
assert_applied () {
  local leg="$1"
  case "${SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  if diff -q "$(snapshot_of "$leg")" "$ROOT/$(subject_of "$leg")" > /dev/null; then
    fatal "leg $leg changed nothing — the anchor no longer matches the source"
  fi
}

rebuild () {
  if [ "${RENDER_MUTATION_NO_BUILD:-0}" = "1" ]; then
    note "build: SKIPPED (RENDER_MUTATION_NO_BUILD=1) — no result from this run is evidence"
    return 0
  fi
  set +e
  (cd "$ROOT" && pnpm build --force) > "$WORK/build.log" 2>&1
  local rc=$?
  set -e
  [ "$rc" -eq 0 ] || { tail -40 "$WORK/build.log" >&2; fatal "the rebuild failed — see $WORK/build.log"; }
}

# THE PROOF THAT THE REBUILD TOOK, BOTH SIDES. `state` is `mutated` or `original`.
assert_dist () {
  local leg="$1" state="$2"
  case "${SELFTEST:-}" in
    neutered) return 0 ;;
  esac
  [ "${RENDER_MUTATION_NO_BUILD:-0}" = "1" ] && return 0
  local mutated original seen_m seen_o
  mutated="$(dist_token_mutated "$leg")"
  original="$(dist_token_original "$leg")"
  if [ -z "$mutated" ]; then
    note "no dist carries leg $leg's subject (a test file, loaded from source) — no rebuild proof to make"
    return 0
  fi
  # `pipefail` is on and `grep` exits 1 when it matches nothing, which is an EXPECTED reading on one
  # side of every comparison below; without the `|| true` that would kill the script under `set -e`.
  seen_m="$( { grep -oF -- "$mutated"  "$AGENT_DIST" 2>/dev/null || true; } | wc -l | tr -d ' ')"
  seen_o="$( { grep -oF -- "$original" "$AGENT_DIST" 2>/dev/null || true; } | wc -l | tr -d ' ')"
  note "dist: mutated token x$seen_m, original token x$seen_o (state: $state)"
  case "$state" in
    mutated)
      [ "$seen_m" -ge 1 ] || fatal "the bundle does not carry leg $leg's MUTATED bytes — the rebuild did not take, so any result measured through it is a result about the PREVIOUS build"
      [ "$seen_o" -eq 0 ] || fatal "the bundle still carries leg $leg's ORIGINAL bytes — the mutated source was not the one compiled"
      ;;
    original)
      [ "$seen_o" -ge 1 ] || fatal "the bundle does not carry leg $leg's ORIGINAL bytes after the restore — the tree is not back where it started"
      [ "$seen_m" -eq 0 ] || fatal "the bundle still carries leg $leg's MUTATED bytes after the restore — the mutation survived into the build"
      ;;
  esac
}

# ── One suite run, classified ───────────────────────────────────────────────────────────────────
#
# Globals rather than a printed value on purpose: `X="$(run_suite)"` would run this in a subshell,
# where `fatal`'s `exit 1` kills only that subshell and the script sails on with an empty answer.
RUN_TOTAL=0
RUN_FAILED=""
RUN_MESSAGES=""
RUN_STDOUT=""
run_suite () {
  local label="$1"
  local report="$WORK/report.$label.json"
  RUN_FAILED="$WORK/failed.$label"
  RUN_MESSAGES="$WORK/messages.$label"
  RUN_STDOUT="$WORK/run.$label.stdout"
  rm -f "$report" "$RUN_FAILED" "$RUN_MESSAGES"

  # TWO REPORTERS, AND THE SECOND IS NOT DECORATION: classification needs the JSON report's exact
  # `fullName`s, and the console diff is the surface a person reads a NAMED red on. The exit code is
  # read from the process, never through a pipe; a red suite is EXPECTED under a mutation, so the
  # run itself must not abort the script under `set -e`.
  (cd "$CLI_DIR" && npx vitest run "$SUITE_REL" \
      --reporter=default --reporter=json --outputFile.json="$report") \
    > "$RUN_STDOUT" 2>&1 || true
  [ -f "$report" ] || { tail -40 "$RUN_STDOUT" >&2; fatal "the suite produced no JSON report for $label — it did not run at all"; }

  node -e '
    const fs = require("fs")
    const [reportPath, failedPath, messagesPath] = process.argv.slice(1)
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"))
    const failed = []
    const messages = []
    let total = 0
    for (const file of report.testResults ?? []) {
      for (const cell of file.assertionResults ?? []) {
        total += 1
        if (cell.status !== "failed") continue
        failed.push(cell.fullName)
        for (const message of cell.failureMessages ?? []) messages.push(message)
      }
    }
    fs.writeFileSync(failedPath, [...new Set(failed)].sort().join("\n") + (failed.length ? "\n" : ""))
    fs.writeFileSync(messagesPath, messages.join("\n"))
    process.stdout.write(String(total))
  ' "$report" "$RUN_FAILED" "$RUN_MESSAGES" > "$WORK/total.$label" \
    || fatal "the suite's JSON report could not be read for $label"

  RUN_TOTAL="$(cat "$WORK/total.$label")"
  [ -n "$RUN_TOTAL" ] || fatal "the suite's JSON report carried no test total"
  if [ "$RUN_TOTAL" -lt "$FROZEN_MIN_TESTS" ]; then
    fatal "the suite ran $RUN_TOTAL cells, fewer than the frozen floor of $FROZEN_MIN_TESTS — a leg that passes because nothing ran is not a leg"
  fi
  note "$label: $RUN_TOTAL cells collected, $(grep -c . "$RUN_FAILED" || true) red"
}

# ── One leg ─────────────────────────────────────────────────────────────────────────────────────
VACUOUS_LEGS=""
run_leg () {
  local leg="$1" label="$2"
  local subject snapshot allowed baseline restored needle
  subject="$(subject_of "$leg")"
  snapshot="$(snapshot_of "$leg")"
  allowed="$WORK/allowed.$leg"
  baseline="$(sha_of "$snapshot")"
  needle="$(needle_of "$leg")"

  echo
  echo "=== LEG $leg — $label"
  echo "    subject $subject"
  echo "    sha256  $baseline"

  apply_mutation "$leg"
  assert_applied "$leg"
  note "applied; subject sha256 now $(sha_of "$ROOT/$subject")"

  rebuild
  assert_dist "$leg" mutated

  run_suite "$leg"

  echo "  cells red:"
  if [ -s "$RUN_FAILED" ]; then
    sed 's/^/    - /' "$RUN_FAILED"
  else
    echo "    (none)"
  fi

  # DIRECTION 1 — nothing outside the list. A red the leg did not intend is a finding, never a
  # licence to widen: it means either the mutation reached further than the leg claims, or the
  # allowed list is a description of a different tree.
  local line unexpected=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if ! grep -Fxq -- "$line" "$allowed"; then
      echo "FATAL: leg $leg red a cell OUTSIDE its allowed list: $line" >&2
      unexpected=1
    fi
  done < "$RUN_FAILED"

  # DIRECTION 2 — nothing in the list stayed green. This is the half that catches a vacuous suite,
  # and it is the half `SELFTEST=neutered` exercises.
  local missing=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if ! grep -Fxq -- "$line" "$RUN_FAILED"; then
      echo "FATAL: leg $leg's allowed cell did NOT red — the suite is green under an implementation it must catch: $line" >&2
      missing=1
    fi
  done < "$allowed"

  # THE NEUTERED RUN VISITS EVERY LEG. A fail-fast self-test proves only that the FIRST leg can
  # fail; the plan asks for each leg to report its own vacuity, so the neutered mode records and
  # continues, and the close below exits non-zero naming all four.
  case "${SELFTEST:-}" in
    neutered)
      if [ "$missing" -eq 0 ] && [ "$unexpected" -eq 0 ]; then
        fatal "leg $leg discriminated correctly with NO mutation applied — the neutered self-test is itself vacuous"
      fi
      VACUOUS_LEGS="$VACUOUS_LEGS $leg"
      note "neutered: leg $leg reported its vacuity as required"
      return 0
      ;;
  esac

  [ "$unexpected" -eq 0 ] && [ "$missing" -eq 0 ] \
    || fatal "leg $leg failed exact discrimination (see above). No leg is ever widened to accept any-red."

  if ! grep -Fq -- "$needle" "$RUN_MESSAGES" && ! grep -Fq -- "$needle" "$RUN_STDOUT"; then
    sed -n '1,80p' "$RUN_MESSAGES" >&2
    fatal "leg $leg red the right cells but nothing in its output NAMES '$needle' — an unnamed red is not proof"
  fi
  note "the red names '$needle'"

  # VERBATIM, BOTH CHANNELS. The assertion messages say which claim broke; the console section says
  # WHICH MEMBER broke it. A run that printed only the first would be asking the reader to take the
  # naming on trust.
  echo "  --- verbatim, the assertion messages ---"
  sed -n '1,40p' "$RUN_MESSAGES" | sed 's/^/  | /'
  echo "  --- verbatim, the console's own diff (the surface a person reads) ---"
  awk '/Failed Tests/ { seen = 1 } seen' "$RUN_STDOUT" | sed -n '1,60p' | sed 's/^/  | /'
  echo "  --------------------------------------------------------------------"

  # ── Restore, prove it, and return to green ───────────────────────────────────────────────────
  cp "$snapshot" "$ROOT/$subject"
  restored="$(sha_of "$ROOT/$subject")"
  [ "$restored" = "$baseline" ] || fatal "$subject was not restored byte-identically ($restored, expected $baseline)"
  note "subject restored byte-identically"

  rebuild
  assert_dist "$leg" original

  run_suite "$leg.restored"
  if [ -s "$RUN_FAILED" ]; then
    sed 's/^/    - /' "$RUN_FAILED" >&2
    fatal "leg $leg did not return to green after the revert — every red above is now unattributable"
  fi
  note "reverted -> the suite is green again ($RUN_TOTAL cells)"
}

# ── Preflight ───────────────────────────────────────────────────────────────────────────────────

echo "=== PREFLIGHT"

# A DIRTY SUBMODULE IS REFUSED. A mutation applied over an uncommitted edit cannot be restored to
# anything meaningful, and a restore that "succeeded" would be restoring somebody's work in
# progress. Scoped to the submodule for the reason spelled out in the header; this script's own file
# is excluded, because it is the thing being written.
DIRTY="$(git -C "$ROOT" status --porcelain | grep -vF -- "$SCRIPT_REL" || true)"
if [ -n "$DIRTY" ]; then
  echo "$DIRTY" >&2
  fatal "the agent-qa working tree is dirty; this script plants and reverts real edits and refuses to run over uncommitted work"
fi
note "agent-qa working tree clean (this script's own file excluded)"

for leg in CHANNEL VERDICT CENSUS ROSTER; do
  path="$(subject_of "$leg")"
  [ -f "$ROOT/$path" ] || fatal "leg $leg's subject is missing: $path"
  cp "$ROOT/$path" "$(snapshot_of "$leg")"
  note "snapshot $path  sha256 $(sha_of "$(snapshot_of "$leg")")"
done

rebuild
note "workspace rebuilt with --force"
for leg in CHANNEL VERDICT CENSUS ROSTER; do assert_dist "$leg" original; done

run_suite preflight
if [ -s "$RUN_FAILED" ]; then
  sed 's/^/  - /' "$RUN_FAILED" >&2
  fatal "the conformance suite is already red before any mutation — every observation below would be meaningless"
fi
note "preflight: the suite is green ($RUN_TOTAL cells)"

case "${SELFTEST:-}" in
  neutered)
    echo
    note "SELFTEST=neutered — every mutation below is a NO-OP. All four legs MUST report vacuity and this script MUST exit 1."
    ;;
esac

# ── The legs ────────────────────────────────────────────────────────────────────────────────────

run_leg CHANNEL "the turn puts nothing on results[] — the pre-399.1 drop site reborn"
run_leg VERDICT "config.field.set's blocked arm reports executed — G-399-2, exactly"
run_leg CENSUS  "the declaration projection drops classifies for one op that still folds"
run_leg ROSTER  "the fn row is removed from SURFACE_ROSTER while the door keeps dispatching"

# ── The close ───────────────────────────────────────────────────────────────────────────────────

echo
case "${SELFTEST:-}" in
  neutered)
    echo "NEUTERED SELF-TEST: every leg reported its vacuity —${VACUOUS_LEGS}"
    echo "This script cannot pass without its mutations. Exiting 1, as required."
    exit 1
    ;;
esac

# THE RESTORE GUARANTEE, OVER THE WHOLE SUBMODULE. Per-leg sha256 checks prove each SUBJECT went
# back; this proves nothing else moved either — a build artifact written into a tracked path, a
# fixture a spawned child left behind, a mutation applied to a file no leg snapshotted.
FINAL_DIRTY="$(git -C "$ROOT" status --porcelain | grep -vF -- "$SCRIPT_REL" || true)"
if [ -n "$FINAL_DIRTY" ]; then
  echo "$FINAL_DIRTY" >&2
  echo "FATAL: the agent-qa tree is dirty after the run — a mutation survived, which is the one outcome this script must never leave behind" >&2
  exit 1
fi
note "agent-qa tree clean after the run (git -C agent-qa status --porcelain empty)"

echo
echo "PASS — all four of 399.1's shipped mechanisms are mutation-detectable, each by an exact list"
echo "       of NAMED cells (399.1-09: the nested-composition anchor is in two of them, by two"
echo "       different roads — see THE FOUR RED SETS in the header):"
echo "         CHANNEL  a turn that puts nothing on results[] is named by five chat render anchors,"
echo "                  by the spawned chat anchor's content half, and by the compound ordering cell"
echo "         VERDICT  a guardrail's refusal reported as \`executed\` is named on the receipt line a"
echo "                  person reads it on — the cell this leg's first run proved was missing"
echo "         CENSUS   an op the projection stops reporting as folding is named by three census"
echo "                  cells and by the committed golden ledger"
echo "         ROSTER   a door the roster stops naming is named by the exact-list pin and by the"
echo "                  fn column's join to the live enumeration"
echo "       Every leg observed RED on exactly its allowed cells and no others, every red NAMED its"
echo "       subject, every restore was byte-identical by sha256, every rebuild was proven two-sided"
echo "       in the bundle, reverting each mutation returned the suite to green, and the agent-qa"
echo "       tree is clean."
