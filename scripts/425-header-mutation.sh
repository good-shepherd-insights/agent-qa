#!/usr/bin/env bash
# 425-header-mutation.sh — the closed sets and the pinned sentences of the run header, the
# post-processing cards and the Knowledge tab cannot silently regress (425-12, PXH-RUN-01..05/07).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 425 closed three vocabularies
# and pinned eight sentences. A closed set is only closed while something refuses to compile or
# refuses to pass when a seventh member arrives; a pinned sentence is only pinned while something
# reds when it is re-spelled. Every suite this phase shipped is green today with the sets open and
# the sentences free — that is exactly what a green suite cannot tell you. So each leg below plants
# the regression that would re-open one set or unpin one sentence, and requires its NAMED cell to
# red while the listed controls hold.
#
# THE LEGS
#   H01  a seventh presentation state joins the union and the array   -> C425-STAGE-STATES-EXACT
#   H02  a third exclusion reason joins the schema's closed set       -> C425-EXCLUSION-REASONS-EXACT
#   H03  the note slot re-spells the retired legacy facts sentence    -> HEADER-NO-LEGACY-COUNT
#   H04  the passing-run sentence is re-spelled                       -> ANALYSIS-COMPLETE-COPY
#   H05  the exclusion gate folds from missing job rows, not the field -> EXCLUDED-FROM-FIELD
#   H06  the header grows a run.modelName item again                  -> NO-HEADER-MODEL-ITEM
#   H07  a cached line is printed with no provider report behind it   -> CACHED-ONLY-WHEN-REPORTED
#   H08  the header pair re-appends the across-steps coverage clause  -> NO-HEADER-COVERAGE
#   H09  the header goes back to a fixed h-14 with no container query -> HEADER-STACKS
#   H10  the Learned heading prefers the legacy pair over the snapshot -> LEARNED-BREAKDOWN-LINE
#   H11  the reconciliation is set whenever a snapshot exists         -> RECONCILIATION-ONLY-ON-MISMATCH
#   H12  exclusion is folded from an undefined chain state            -> EXCLUSION-FROM-HANDOFF
#   H13  the card is timed from the released claim lease again        -> STAGE-TIMING-LINE-DURABLE-START
#
# H03 IS AIMED AT THE SLOT ITS CELL ACTUALLY WATCHES. HEADER-NO-LEGACY-COUNT renders a view the
# cell builds by hand and then greps the whole chips DOM for the retired sentence, so a change to
# the projection function that composes that view reaches nothing the cell can see. The one string
# this module puts into that DOM on the cell's own fixture is the breakdown-absent note, and that
# is where the leg plants the retired sentence — the regression the cell exists to catch, at the
# only site that reaches it.
#
# H08 CROSSES TWO SUITES ON PURPOSE. The clause lives in the usage module and the rule lives on the
# header, so the leg's instrument selects BOTH files: the header cell is the required red and the
# usage module's own pair cells are ALLOWED to move with it, because they measure the function
# rather than the rule.
#
# Engine, arrival proof, counted selection and restoration: scripts/423-mutation-engine.cjs.
#
# USAGE
#   pnpm run validate:425-header-mutation                # from the agent-qa root
#   bash agent-qa/scripts/425-header-mutation.sh         # from the super-repository root
#
# KNOBS — AGENT_QA_425_HEADER_MUTATION_SELFTEST
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal     mutate every subject, then throw; every subject must be restored
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
# AGENT_QA_425_HEADER_MUTATION_LEG=H01..H13 runs one leg (normal or neutered runs only).
# AGENT_QA_425_HEADER_MUTATION_LIST=1 prints the declared inventory and exits.
#
# Installed Node 24 and workspace tools are required. No downloads or provider calls. Ends with a
# forced workspace build whenever a byte was mutated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const VIEW_SRC = 'packages/dashboard-ui/src/lib/post-processing-view.ts'
const DETAIL_SRC = 'packages/dashboard-ui/src/lib/run-detail-view.ts'
const KNOW_SRC = 'packages/dashboard-ui/src/lib/knowledge-view.ts'
const NAVBAR_SRC = 'packages/dashboard-ui/src/components/run-detail/run-navbar.tsx'
const STATUS_SRC = 'packages/schema/src/notification/post-processing-status.ts'
const OP_SRC = 'packages/agent/src/functions/ops/runs-post-processing.ts'

const VIEW = 'src/lib/__tests__/post-processing-view.test.ts'
const VIEW_D = 'src/lib/__tests__/post-processing-view.test-d.ts'
const DETAIL = 'src/lib/__tests__/run-detail-view.test.ts'
const KNOW = 'src/lib/__tests__/knowledge-view.test.ts'
const CHIPS = 'src/components/run-detail/__tests__/post-processing-chips.test.tsx'
const NAVBAR = 'src/components/__tests__/run-navbar.test.tsx'
const EXCL = 'src/__tests__/425-post-processing-exclusion.test.ts'
const EXCL_D = 'src/__tests__/425-post-processing-exclusion.test-d.ts'
const OP = 'src/functions/ops/__tests__/runs-post-processing.test.ts'

const instruments = {
  'ui-view': { pkg: 'packages/dashboard-ui', files: [VIEW, VIEW_D], typecheck: true, count: 48 },
  schema: { pkg: 'packages/schema', files: [EXCL, EXCL_D], typecheck: true, count: 14 },
  'ui-chips': { pkg: 'packages/dashboard-ui', files: [CHIPS], typecheck: false, count: 31 },
  // The header rule and the function that feeds it, selected together: see H08's note above.
  'ui-navbar': { pkg: 'packages/dashboard-ui', files: [NAVBAR, DETAIL], typecheck: false, count: 51 },
  'ui-usage': { pkg: 'packages/dashboard-ui', files: [DETAIL], typecheck: false, count: 30 },
  'ui-knowledge': { pkg: 'packages/dashboard-ui', files: [KNOW], typecheck: false, count: 143 },
  'agent-op': { pkg: 'packages/agent', files: [OP], typecheck: false, count: 19 },
}

const view = (name, count) => cell('ui-view', VIEW, name, count)
const chips = (name, count) => cell('ui-chips', CHIPS, name, count)
const navbar = (name, count) => cell('ui-navbar', NAVBAR, name, count)
const navbarPair = (name, count) => cell('ui-navbar', DETAIL, name, count)
const usage = (name, count) => cell('ui-usage', DETAIL, name, count)
const know = (name, count) => cell('ui-knowledge', KNOW, name, count)
const op = (name, count) => cell('agent-op', OP, name, count)
const schema = (name, count) => cell('schema', EXCL, name, count)
const schemaD = (name, count) => cell('schema', EXCL_D, name, count)

const legs = [
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'C425-STAGE-STATES-EXACT',
    operation: 'add a seventh presentation state to the union and the runtime array',
    edits: [
      {
        from: "  | 'excluded'\n  | 'unavailable'\n\nexport const STAGE_PRESENTATION_STATES = [\n  'complete',\n  'running',\n  'pending',\n  'failed',\n  'excluded',\n  'unavailable',\n] as const satisfies readonly StagePresentationState[]",
        to: "  | 'excluded'\n  | 'stalled'\n  | 'unavailable'\n\nexport const STAGE_PRESENTATION_STATES = [\n  'complete',\n  'running',\n  'pending',\n  'failed',\n  'excluded',\n  'stalled',\n  'unavailable',\n] as const satisfies readonly StagePresentationState[]",
      },
      { from: "    excluded: 'Analysis excluded',\n", to: "    excluded: 'Analysis excluded',\n    stalled: 'Analysis stalled',\n" },
      { from: "    excluded: 'Curation excluded',\n", to: "    excluded: 'Curation excluded',\n    stalled: 'Curation stalled',\n" },
    ],
    reds: [cell('ui-view', VIEW_D, 'C425-STAGE-STATES-EXACT')],
    allowed: [view('STAGE-INDICATOR-WORDS')],
    greens: [view('ANALYSIS-COMPLETE-COPY'), view('EXCLUDED-FROM-FIELD', 3), view('PROJECTION-IDEMPOTENT'),
      view('STAGE-TIMING-LINE', 9)],
  },
  {
    subject: STATUS_SRC, instrument: 'schema', claim: 'C425-EXCLUSION-REASONS-EXACT',
    operation: 'add a third exclusion reason to the closed set and its schema',
    edits: [{
      from: "export type PostProcessingExclusionReason = 'gate-run' | 'outcome-excluded'\n\nexport const POST_PROCESSING_EXCLUSION_REASONS = [\n  'gate-run',\n  'outcome-excluded',\n] as const satisfies readonly PostProcessingExclusionReason[]",
      to: "export type PostProcessingExclusionReason = 'gate-run' | 'outcome-excluded' | 'excluded'\n\nexport const POST_PROCESSING_EXCLUSION_REASONS = [\n  'gate-run',\n  'outcome-excluded',\n  'excluded',\n] as const satisfies readonly PostProcessingExclusionReason[]",
    }],
    reds: [
      schema('C425-EXCLUSION-REASONS-EXACT > pins the reason list to an independent exact vocabulary through both barrels'),
      schema('C425-EXCLUSION-REASONS-EXACT > accepts each hand-spelled reason and rejects a third reason or an extra key'),
      schemaD('C425-EXCLUSION-REASONS-EXACT > pins exactly two exclusion reasons in both directions through both barrels'),
      schemaD('C425-EXCLUSION-REASONS-EXACT > refuses a third reason at the type boundary'),
    ],
    allowed: [],
    greens: [
      schema('C425-EXCLUSION-REASONS-EXACT > leaves the four chip words untouched'),
      schema('EXCLUSION-SCHEMA-ROUNDTRIP > round-trips each reason beside the untouched chip words'),
      schema('EXCLUSION-ON-DIGEST-CHAIN > refuses a fifth chip word on either chain arm'),
      schemaD('C425-EXCLUSION-REASONS-EXACT > rides beside the untouched chip words on both DTOs'),
    ],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-chips', claim: 'HEADER-NO-LEGACY-COUNT',
    operation: 'spell the retired legacy facts sentence into the breakdown-absent note',
    edits: [{
      from: "export const BREAKDOWN_NOT_RECORDED_TEXT = 'Breakdown not recorded for this run'",
      to: "export const BREAKDOWN_NOT_RECORDED_TEXT = 'curated 4 facts, deprecated 2'",
    }],
    reds: [chips('HEADER-NO-LEGACY-COUNT')],
    allowed: [],
    greens: [chips('STAGE-CARD-LINES', 2), chips('TRACER-PASSING-ANALYSIS-CARD'), chips('EXCLUDED-PAINT', 2)],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'ANALYSIS-COMPLETE-COPY',
    operation: 're-spell the sentence a passing run shows every day',
    edits: [{
      from: "export const ANALYSIS_COMPLETE_NO_ISSUES_TEXT = 'Analysis complete — no issues found'",
      to: "export const ANALYSIS_COMPLETE_NO_ISSUES_TEXT = 'Analysis done — no issues found'",
    }],
    reds: [view('ANALYSIS-COMPLETE-COPY')],
    allowed: [],
    greens: [view('STAGE-INDICATOR-WORDS'), view('EXCLUDED-FROM-FIELD', 3), view('PROJECTION-IDEMPOTENT'),
      view('ANALYSIS-ROOT-CAUSE-FROM-SUMMARY', 4), cell('ui-view', VIEW_D, 'C425-STAGE-STATES-EXACT')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'EXCLUDED-FROM-FIELD',
    operation: 'gate the exclusion on the absence of job rows instead of on the read own field',
    edits: [{
      from: '  const exclusion = read.status.exclusion\n',
      to: '  const exclusion = read.status.stageDetails === undefined ? undefined : read.status.exclusion\n',
    }],
    reds: [
      view('EXCLUDED-FROM-FIELD: paints BOTH indicators excluded while the chip words stay verbatim'),
      view('EXCLUDED-FROM-FIELD: outranks the chip words — a settled read carrying the field is still excluded'),
    ],
    allowed: [],
    greens: [
      view('EXCLUDED-FROM-FIELD: a pending read WITHOUT the field is queued — the absence of rows proves nothing'),
      view('STAGE-TIMING-LINE', 9), view('ANALYSIS-COMPLETE-COPY'), view('PROJECTION-IDEMPOTENT'),
    ],
  },
  {
    subject: NAVBAR_SRC, instrument: 'ui-navbar', claim: 'NO-HEADER-MODEL-ITEM',
    operation: 'restore a run.modelName item to the header row',
    edits: [{
      from: '        <span data-run-duration className="text-xs text-muted-foreground flex items-center gap-1">\n',
      to: '        {run.modelName ? (\n          <span className="text-xs text-muted-foreground">{run.modelName}</span>\n        ) : null}\n        {run.llmProvider ? (\n          <span className="text-xs text-muted-foreground">{run.llmProvider}</span>\n        ) : null}\n        <span data-run-duration className="text-xs text-muted-foreground flex items-center gap-1">\n',
    }],
    reds: [navbar('NO-HEADER-MODEL-ITEM')],
    allowed: [],
    greens: [navbar('HEADER-ORDER-FIXED'), navbar('HEADER-EMPTY-META'), navbar('BADGE-DOMINANT'),
      navbar('HEADER-STACKS'), navbar('NO-HEADER-COVERAGE'), navbarPair('TOKEN-PAIR-LINE', 5)],
  },
  {
    subject: DETAIL_SRC, instrument: 'ui-usage', claim: 'CACHED-ONLY-WHEN-REPORTED',
    operation: 'print a cached line for a run whose provider reported no cache at all',
    edits: [{
      from: '  if (cachedInputTokens === undefined) return undefined\n',
      to: '  if (cachedInputTokens === undefined) return `cached input ${fullTokens.format(0)} (provider-reported)`\n',
    }],
    reds: [usage('CACHED-ONLY-WHEN-REPORTED: no cachedInputTokens, no line — whatever else is present')],
    // 425-14's unmeasured-run cell ends on the same fact for a run with no cache report at all, so
    // it moves with the regression. Admitted rather than required: its subject is the coverage line.
    allowed: [usage('USAGE-COVERAGE-ABSENT-IS-NOT-ZERO: says nothing about coverage when no step was measured')],
    greens: [
      usage('CACHED-ONLY-WHEN-REPORTED: a cache that covers every measured step states the sum alone'),
      usage('CACHED-ONLY-WHEN-REPORTED: a narrower window names its own denominator'),
      usage('TOKEN-PAIR-LINE', 5),
    ],
  },
  {
    subject: DETAIL_SRC, instrument: 'ui-navbar', claim: 'NO-HEADER-COVERAGE',
    operation: 'append the across-steps coverage clause back onto the header pair',
    edits: [{
      from: '  return `${formatTokens(promptTokens)} in · ${formatTokens(completionTokens)} out`\n',
      to: '  const coverage = usageCoverageLine(tokens)\n  return `${formatTokens(promptTokens)} in · ${formatTokens(completionTokens)} out${coverage === undefined ? \'\' : ` — ${coverage}`}`\n',
    }],
    reds: [navbar('NO-HEADER-COVERAGE')],
    allowed: [navbarPair('TOKEN-PAIR-LINE')],
    greens: [navbar('TOKEN-USAGE-TRIGGER'), navbar('HEADER-ORDER-FIXED'), navbar('HEADER-EMPTY-META'),
      navbar('NO-HEADER-MODEL-ITEM'), navbar('HEADER-STACKS')],
  },
  {
    subject: NAVBAR_SRC, instrument: 'ui-navbar', claim: 'HEADER-STACKS',
    operation: 'restore the fixed h-14 row and drop the container query that stacks it',
    edits: [
      { from: '    <div className="shrink-0 @container">\n', to: '    <div className="shrink-0">\n' },
      { from: '    <div className="flex flex-col gap-y-2 min-h-14 border-b px-4 py-2 min-w-0 @5xl:flex-row',
        to: '    <div className="flex flex-col gap-y-2 h-14 border-b px-4 py-2 min-w-0 @5xl:flex-row' },
    ],
    reds: [navbar('HEADER-STACKS')],
    allowed: [],
    greens: [navbar('HEADER-ORDER-FIXED'), navbar('HEADER-EMPTY-META'), navbar('HEADER-NAME-TRUNCATES'),
      navbar('BADGE-DOMINANT'), navbar('NO-HEADER-MODEL-ITEM'), navbar('NO-HEADER-COVERAGE')],
  },
  {
    subject: KNOW_SRC, instrument: 'ui-knowledge', claim: 'LEARNED-BREAKDOWN-LINE',
    operation: 'prefer the legacy pair over the recorded snapshot in the Learned heading',
    edits: [{
      from: '  const countLine =\n    breakdown !== undefined\n      ? curationBreakdownLine(breakdown)\n      : counts !== undefined\n        ? legacyCurationPairText(counts.curated, counts.deprecated)\n        : COUNTS_NOT_RECORDED_TEXT\n',
      to: '  const countLine =\n    counts !== undefined\n      ? legacyCurationPairText(counts.curated, counts.deprecated)\n      : breakdown !== undefined\n        ? curationBreakdownLine(breakdown)\n        : COUNTS_NOT_RECORDED_TEXT\n',
    }],
    reds: [
      know("LEARNED-BREAKDOWN-LINE: spells the five buckets in the curation card's own words"),
      know('LEARNED-BREAKDOWN-LINE: omits a zero bucket rather than printing a count nobody took'),
    ],
    // THE TWO CELLS THAT MEASURE THE LADDER ITSELF MOVE WITH IT, and must: both read a run that
    // recorded BOTH records, which is the only shape where an order can be wrong at all. They are
    // admitted rather than required, because the fact this leg is aimed at is the heading's line.
    allowed: [
      know('reads the count line from the SAME function the chip does — one number, one wording'),
      know('LEARNED-LEGACY-NOTE: the snapshot outranks the pair — a recorded breakdown carries no note'),
    ],
    greens: [
      know('LEARNED-BREAKDOWN-LINE: reads five zeros as no memory changes, and still states the outcome'),
      know('LEARNED-LEGACY-NOTE: prints a pre-423 pair as a pair, with the not-recorded note beneath'),
      know('LEARNED-LEGACY-NOTE: a settled row with no counts at all keeps its own fragment and no note'),
      know('LEARNED-LEGACY-NOTE: names the withheld category when the READ ITSELF withheld the snapshot'),
      know('LEARNED-LEGACY-NOTE: leaves the unsettled ladder alone — no line and no note before it settles'),
      know('RECONCILIATION-ONLY-ON-MISMATCH', 4),
    ],
  },
  {
    subject: KNOW_SRC, instrument: 'ui-knowledge', claim: 'RECONCILIATION-ONLY-ON-MISMATCH',
    operation: 'attach the reconciliation whenever a snapshot exists, agreement or not',
    edits: [{
      from: '    snapshotView === undefined || counted === shown\n      ? snapshot\n',
      to: '    snapshotView === undefined\n      ? snapshot\n',
    }],
    reds: [
      know('RECONCILIATION-ONLY-ON-MISMATCH: carries NO reconciliation key when the two numbers agree'),
      know('RECONCILIATION-ONLY-ON-MISMATCH: a since-then row is not one of the rows shown (423 D-15)'),
    ],
    allowed: [],
    greens: [
      know('RECONCILIATION-ONLY-ON-MISMATCH: a schema-valid snapshot shows one curation row per counted record'),
      know('RECONCILIATION-ONLY-ON-MISMATCH: the reconciliation text agrees its noun with the count'),
      know('RECONCILIATION-CAUSE-FROM-READ', 4), know('LEARNED-BREAKDOWN-LINE', 3),
    ],
  },
  {
    subject: OP_SRC, instrument: 'agent-op', claim: 'EXCLUSION-FROM-HANDOFF',
    operation: 'fold an exclusion out of an undefined chain state instead of out of the handoff',
    edits: [{
      from: "  if (document?.excludedFromOutcomes === true) return { reason: 'outcome-excluded' }\n  return undefined\n",
      to: "  if (document?.excludedFromOutcomes === true) return { reason: 'outcome-excluded' }\n  return document === undefined ? { reason: 'outcome-excluded' } : undefined\n",
    }],
    reds: [op('EXCLUSION-FROM-HANDOFF > folds the fact from the two durable markers and from nothing else')],
    // EVERY OP CELL WHOSE FIXTURE HAS NO HANDOFF MOVES WITH IT, and must: the regression IS
    // "an absent record means excluded", so each of those reads now carries an exclusion key.
    // Admitted rather than required — the fact this leg is aimed at is the fold itself.
    allowed: [
      op('EXCLUSION-OP-READS-RUNS-PORT > omits the key and refuses nothing when the port has no handoff yet'),
      op('the runs.postProcessing op (D-14/D-15) > projects a finished chain and attaches the notification the terminal wrote'),
      op('the runs.postProcessing op (D-14/D-15) > answers the all-pending projection for a host whose queue database is absent'),
    ],
    greens: [
      op('EXCLUSION-FROM-HANDOFF > answers gate-run when both markers are set, in the enqueue skip order'),
      op('EXCLUSION-FROM-HANDOFF > never reads the fact off a failed run or off a finished chain'),
      op('EXCLUSION-OP-READS-RUNS-PORT > serves the exclusion beside untouched pending chips for a run with no job rows'),
      op('EXCLUSION-OP-READS-RUNS-PORT > omits the key for an ordinary run whose handoff carries neither marker'),
    ],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'STAGE-TIMING-LINE-DURABLE-START',
    operation: 'time the card from the released claim lease again instead of the durable start instant',
    edits: [{
      from: '  const started = instantOf(detail.startedAt)\n',
      to: '  const started = instantOf(detail.claimedAt)\n',
    }],
    reds: [view('STAGE-TIMING-LINE-DURABLE-START: a settled row whose claim was released still says how long the stage took')],
    // EVERY TIMING CELL WHOSE FIXTURE CARRIES A DURABLE START MOVES WITH IT, and must: the
    // regression IS "time from the lease", so each of those lines loses its durations (and the
    // lease-only fixture gains one). Admitted rather than required — the fact this leg is aimed at
    // is that a settled row with a released lease still says how long the stage took.
    allowed: [
      view('STAGE-TIMING-LINE: clock, then the two durations, and attempts only past one'),
      view('STAGE-TIMING-LINE: a running stage ends at `running` and claims no finish'),
      view('STAGE-TIMING-LINE: a stage queued to retry says when it started and claims no finish'),
      view('STAGE-TIMING-LINE: no row at all renders no line; an absent field renders no clause'),
      view('STAGE-TIMING-LINE: an unparseable timestamp drops its own clause and never renders NaN'),
      view('STAGE-TIMING-LINE: folds onto the stage that HAS a row, and onto neither when none does'),
    ],
    greens: [
      view('STAGE-TIMING-LINE: a pending stage with only a queue moment says exactly that'),
      view('STAGE-TIMING-LINE: reads both shapes the store actually writes — ISO with Z and the SQLite space form'),
      view('STAGE-TIMING-LINE: an excluded run is never timed — nothing was ever enqueued to time'),
      view('ANALYSIS-COMPLETE-COPY'), view('EXCLUDED-FROM-FIELD', 3), view('PROJECTION-IDEMPOTENT'),
    ],
  },
]

runGate({
  slug: '425-header-mutation', envPrefix: 'AGENT_QA_425_HEADER_MUTATION', idPrefix: 'H',
  instruments, legs, expectedLegs: 13, banner: 'HEADER_MUTATION_OK',
})
NODE
