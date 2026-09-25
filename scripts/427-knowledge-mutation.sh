#!/usr/bin/env bash
# 427-knowledge-mutation.sh — the run-scoped Knowledge tab's closed sets and its guarantees cannot
# silently regress (427-12, PXH-KNOW-01..05).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 427 closed ten vocabularies (the
# sections, the use verbs, the record kinds, the anchor phrases, the effect outcomes and tones, the
# bucket labels, the status words, the retrieval classes and the reason-to-class map) and made a
# handful of promises about the tab: no record id in the default view, the sections in their
# published order, one row per record, no channel and no retrieval machinery above Retrieval
# details, a ledger that leaves out empty channels, 425's bucket words, rows that equal the counts,
# a header strip only for real problems, no doctor pointer on information, a zero-effect drain that
# still records its snapshot, problems first in the Effect section, no uncounted trial and no hint
# listed as an effect, a replay sized by its recorded flow and by its own flow (never by the other
# flows of its procedure), complete only when every attempted check passed and one entry per
# procedure and extent, the curator's note after the counts, and every tooltip trigger a named
# button whose meaning is its one description. Every suite that pins
# those is green today with nothing taken away, which is exactly what a green suite cannot tell you.
# So each leg below plants the regression that would re-open one set or break one promise, and
# requires its NAMED cell to red while the listed controls hold.
#
# THE LEGS
#   K01  a fifth section joins KnowledgeSection and KNOWLEDGE_SECTIONS            -> C427-SECTIONS-EXACT
#   K02  a sixth use verb joins UseVerb, USE_VERBS and its phrase                  -> C427-USE-VERBS-EXACT
#   K03  RecordKind widens with a sixth kind and its label                         -> C427-RECORD-KINDS-EXACT
#   K04  an eighth anchor phrase type joins the union and the render order         -> C427-ANCHOR-PHRASE-TYPES-EXACT
#   K05  a ninth effect outcome joins the union, the array, its tone and sentence  -> C427-EFFECT-OUTCOMES-EXACT
#   K06  a fifth effect tone joins the union and the array                         -> C427-EFFECT-TONES-EXACT
#   K07  BUCKET_LABELS gains a 'promoted' key by widening its key type             -> C427-BUCKET-LABELS-SHAPE
#   K08  the status key type of SINCE_STATUS_TAGS and CURRENT_STATUS_WORDS widens  -> C427-STATUS-WORDS-SHAPE
#   K09  a sixth retrieval class joins the union, the array, its tone and a case   -> C427-RETRIEVAL-CLASSES-EXACT
#   K10  RETRIEVAL_CLASS_BY_REASON becomes a Partial record with a fallback         -> C427-RETRIEVAL-CLASS-BY-REASON-TOTAL
#   K11  a served used row leads with its record id                               -> NO-ID-IN-DEFAULT-VIEW (SC2)
#   K12  the Effect and Memory changes sections swap places                        -> SECTIONS-IN-ORDER (SC1)
#   K13  used rows are keyed by record and step, so a repeated record is ungrouped -> GROUPED-ONE-ROW
#   K14  every used row paints the channel-1 eyebrow                               -> NO-CHANNEL-IN-DEFAULT-VIEW
#   K15  the ledger's channel-2 section loses its length guard                     -> LEDGER-OMITS-EMPTY-CHANNEL
#   K16  BUCKET_LABELS.added reads 'New'                                           -> BUCKET-LABEL-VOCABULARY (SC3)
#   K17  snapshot-run curation rows come from learned.changes, not the snapshot    -> ROWS-EQUAL-COUNTS (SC3)
#   K18  an on-trial used row paints the ledger's canary word and a trace line     -> NO-MACHINERY-IN-DEFAULT-VIEW (SC4)
#   K19  the fresh-index class takes the warning tone                              -> BOOTSTRAP-NOT-IN-STRIP (SC5)
#   K20  an info-class statement carries the doctor pointer                        -> NO-POINTER-ON-INFO (SC5)
#   K21  the drain's fold guard is effects.length > 0 alone again                  -> ZERO-EFFECT-SNAPSHOT (D-24)
#   K22  effect entries sort by first step only                                    -> EFFECT-ORDER (D-11)
#   K23  a not-attributed trial becomes an unknown entry                           -> UNCOUNTED-NOT-EFFECTS (D-14)
#   K24  a procedure hint adds an effect entry                                     -> HINT-NOT-EFFECT (D-11)
#   K25  the curator's note renders before the trust counts                        -> FULL-RECORD-ORDER (memory.md §7.5)
#   K26  K11's id-as-primary, on the rebuilt bundle a spawned dashboard serves     -> (b7) (SC2, shipped)
#   K27  the header strip paints a fresh store's bootstrap, on the rebuilt bundle  -> (a2) (SC5, shipped)
#   K28  a replay with no break member counts as complete, checks passed or not    -> REPLAY-INCOMPLETE-NOT-COMPLETE (D-14)
#   K29  a replay's size is the per-step guard total, not the recorded flow length -> REPLAY-SIZE-FROM-FLOW (D-12)
#   K30  every replayed step is its own effect entry again                         -> REPLAY-GROUPED-STEPS (UI-SPEC S4)
#   K31  every flow of a procedure is unioned into one completed replay again      -> REPLAY-PER-FLOW (D-12)
#   K32  the on-trial trigger is a focusable span again, with no role and so no name -> TRIGGER-ACCESSIBLE-NAME (G-427-1)
#
# ALLOWED CO-REDS are listed on each leg with a one-line reason; nothing else may red. No leg names
# the shipped-binary Learned-root curation-word cell as a red or a green: it is nondeterministic
# under a full-parallel build (WINDOWS #426).
#
# K26 AND K27 CROSS THE DIST BOUNDARY. Their cells read the shipped bundle a spawned dashboard serves,
# so each leg rebuilds `@vostride/agent-qa-dashboard-ui`, whose Vite bundle has no importable entry; it
# names the literal by which the instrument serves that dist and plants a marker (id427primary,
# boot427strip) the rebuilt bundle must carry, so the engine proves the mutation reached the page.
# The shipped-binary suite runs with one worker.
#
# Engine, arrival proof, counted selection and restoration: scripts/423-mutation-engine.cjs.
#
# USAGE
#   pnpm run validate:427-knowledge-mutation              # from the agent-qa root
#   bash agent-qa/scripts/427-knowledge-mutation.sh       # from the super-repository root
#
# KNOBS — AGENT_QA_427_KNOWLEDGE_MUTATION_SELFTEST
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal     mutate every subject, then throw; every subject must be restored
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
# AGENT_QA_427_KNOWLEDGE_MUTATION_LEG=K01..K32 runs one leg (normal or neutered runs only).
# AGENT_QA_427_KNOWLEDGE_MUTATION_LIST=1 prints the declared inventory and exits.
#
# Installed Node 24, workspace tools and the installed Playwright Chromium are required. No
# downloads or provider calls. Ends with a
# forced workspace build whenever a byte was mutated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const VIEW_SRC = 'packages/dashboard-ui/src/lib/knowledge-view.ts'
const TAB_SRC = 'packages/dashboard-ui/src/components/run-detail/tab-knowledge.tsx'
const USED_SRC = 'packages/dashboard-ui/src/components/run-detail/knowledge-used.tsx'
const STEP_SRC = 'packages/dashboard-ui/src/components/run-detail/knowledge-step-detail.tsx'
const BODY_SRC = 'packages/dashboard-ui/src/components/run-detail/knowledge-record-body.tsx'
const STATEMENT_SRC = 'packages/dashboard-ui/src/components/run-detail/retrieval-statement.tsx'
const DRAIN_SRC = 'packages/knowledge-local/src/curator/drain.ts'

const USED_V = 'src/lib/__tests__/knowledge-view.used.test.ts'
const EFFECT_V = 'src/lib/__tests__/knowledge-view.effect.test.ts'
const CHANGES_V = 'src/lib/__tests__/knowledge-view.changes.test.ts'
const RETRIEVAL_V = 'src/lib/__tests__/knowledge-view.retrieval.test.ts'
const VIEW_D = 'src/lib/__tests__/knowledge-view.test-d.ts'
const USED_C = 'src/components/run-detail/__tests__/knowledge-used.test.tsx'
const BODY_C = 'src/components/run-detail/__tests__/knowledge-record-body.test.tsx'
const EFFECT_C = 'src/components/run-detail/__tests__/knowledge-effect.test.tsx'
const DETAILS_C = 'src/components/run-detail/__tests__/retrieval-details.test.tsx'
const DEFAULT_C = 'src/components/run-detail/__tests__/knowledge-default-view.test.tsx'
const STATEMENT_C = 'src/components/run-detail/__tests__/retrieval-statement.test.tsx'
const STEP_REF_C = 'src/components/run-detail/__tests__/knowledge-step-ref.test.tsx'
const TAB_C = 'src/components/run-detail/__tests__/tab-knowledge.test.tsx'
const LEARNED_C = 'src/components/run-detail/__tests__/knowledge-learned.test.tsx'
const STEP_C = 'src/components/run-detail/__tests__/knowledge-step-detail.test.tsx'
const BANNER_C = 'src/components/run-detail/__tests__/retrieval-rung-banner.test.tsx'
const SNAPSHOT_T = 'src/__tests__/423-curation-snapshot.test.ts'
const DOM = 'src/__tests__/conformance/knowledge-tab-dom.test.ts'

const instruments = {
  'ui-view': { pkg: 'packages/dashboard-ui', files: [USED_V, EFFECT_V, CHANGES_V, RETRIEVAL_V, VIEW_D], typecheck: true, count: 101 },
  'ui-parts': { pkg: 'packages/dashboard-ui', files: [USED_C, BODY_C, EFFECT_C, DETAILS_C, DEFAULT_C, STATEMENT_C, STEP_REF_C], typecheck: false, count: 60 },
  'ui-tab': { pkg: 'packages/dashboard-ui', files: [TAB_C, LEARNED_C, STEP_C, BANNER_C], typecheck: false, count: 114 },
  store: { pkg: 'packages/knowledge-local', files: [SNAPSHOT_T], typecheck: false, count: 20 },
  'knowledge-dom': { pkg: 'packages/cli', files: [DOM], typecheck: false, count: 24, env: { VITEST_MAX_WORKERS: '1' } },
}

const UI_DIST = "join(PACKAGES_ROOT, 'dashboard-ui', 'dist')"
const ui = marker => ({ pkg: '@vostride/agent-qa-dashboard-ui', dir: 'packages/dashboard-ui', marker, reference: UI_DIST })

const used = (name, count) => cell('ui-view', USED_V, name, count)
const effect = (name, count) => cell('ui-view', EFFECT_V, name, count)
const changes = (name, count) => cell('ui-view', CHANGES_V, name, count)
const retrieval = (name, count) => cell('ui-view', RETRIEVAL_V, name, count)
const viewD = (name, count) => cell('ui-view', VIEW_D, name, count)
const usedC = (name, count) => cell('ui-parts', USED_C, name, count)
const body = (name, count) => cell('ui-parts', BODY_C, name, count)
const effectC = (name, count) => cell('ui-parts', EFFECT_C, name, count)
const details = (name, count) => cell('ui-parts', DETAILS_C, name, count)
const defaultView = (name, count) => cell('ui-parts', DEFAULT_C, name, count)
const statement = (name, count) => cell('ui-parts', STATEMENT_C, name, count)
const tab = (name, count) => cell('ui-tab', TAB_C, name, count)
const learned = (name, count) => cell('ui-tab', LEARNED_C, name, count)
const step = (name, count) => cell('ui-tab', STEP_C, name, count)
const banner = (name, count) => cell('ui-tab', BANNER_C, name, count)
const snap = (name, count) => cell('store', SNAPSHOT_T, name, count)
const dom = (name, count) => cell('knowledge-dom', DOM, name, count)

const legs = [
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'C427-SECTIONS-EXACT',
    operation: 'add a fifth section to KnowledgeSection and KNOWLEDGE_SECTIONS',
    edits: [{
      from: "export type KnowledgeSection = 'used' | 'effect' | 'changes' | 'retrieval-details'\n\n// prettier-ignore\nexport const KNOWLEDGE_SECTIONS = [\n  'used',\n  'effect',\n  'changes',\n  'retrieval-details',\n] as const satisfies readonly KnowledgeSection[]",
      to: "export type KnowledgeSection = 'used' | 'effect' | 'changes' | 'retrieval-details' | 'summary'\n\n// prettier-ignore\nexport const KNOWLEDGE_SECTIONS = [\n  'used',\n  'effect',\n  'changes',\n  'retrieval-details',\n  'summary',\n] as const satisfies readonly KnowledgeSection[]",
    }],
    reds: [viewD('C427-SECTIONS-EXACT')],
    // The runtime twin pins KNOWLEDGE_SECTIONS by value, so a fifth member moves it too.
    allowed: [used('CLOSED-SETS-427')],
    greens: [viewD('C427-USE-VERBS-EXACT'), used('GROUPED-ONE-ROW'), used('FORMAT-STEP-REFS')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'C427-USE-VERBS-EXACT',
    operation: 'add a sixth verb to UseVerb and USE_VERBS, with the phrase entry it needs to compile',
    edits: [
      {
        from: "export type UseVerb = 'given' | 'opened' | 'caution' | 'replayed' | 'hint'\n\n// prettier-ignore\nexport const USE_VERBS = [\n  'given',\n  'opened',\n  'caution',\n  'replayed',\n  'hint',\n] as const satisfies readonly UseVerb[]",
        to: "export type UseVerb = 'given' | 'opened' | 'caution' | 'replayed' | 'hint' | 'cited'\n\n// prettier-ignore\nexport const USE_VERBS = [\n  'given',\n  'opened',\n  'caution',\n  'replayed',\n  'hint',\n  'cited',\n] as const satisfies readonly UseVerb[]",
      },
      {
        from: "  hint: { lead: 'Used as a hint in', follow: 'used as a hint in' },\n} satisfies Record<UseVerb",
        to: "  hint: { lead: 'Used as a hint in', follow: 'used as a hint in' },\n  cited: { lead: 'Cited in', follow: 'cited in' },\n} satisfies Record<UseVerb",
      },
    ],
    reds: [viewD('C427-USE-VERBS-EXACT')],
    // The runtime twin pins USE_VERBS by value, so a sixth verb moves it too.
    allowed: [used('CLOSED-SETS-427')],
    greens: [viewD('C427-SECTIONS-EXACT'), used('EVERY-USE-ONE-ROW'), used('FIRST-USE-ORDER')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'C427-RECORD-KINDS-EXACT',
    operation: 'widen RecordKind with a sixth kind and give it a label',
    edits: [{
      from: "export type RecordKind = InspectRecordView['kind']\n\nexport const RECORD_KIND_LABELS = {\n  fact: 'Fact',\n",
      to: "export type RecordKind = InspectRecordView['kind'] | 'observation'\n\nexport const RECORD_KIND_LABELS = {\n  fact: 'Fact',\n  observation: 'Observation',\n",
    }],
    reds: [viewD('C427-RECORD-KINDS-EXACT')],
    // The runtime twin pins RECORD_KIND_LABELS by value, so a sixth label moves it too.
    allowed: [used('CLOSED-SETS-427')],
    greens: [viewD('C427-SECTIONS-EXACT'), used('SUMMARY-RULE', 2), used('GROUPED-ONE-ROW')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'C427-ANCHOR-PHRASE-TYPES-EXACT',
    operation: 'add an eighth anchor phrase type to the union and the render order',
    edits: [
      {
        from: "export type AnchorPhraseType = 'platform' | 'page' | 'flow' | 'el' | 'selector' | 'error' | 'unparsed'\n",
        to: "export type AnchorPhraseType = 'platform' | 'page' | 'flow' | 'el' | 'selector' | 'error' | 'region' | 'unparsed'\n",
      },
      {
        from: "  'error',\n  'unparsed',\n] as const satisfies readonly AnchorPhraseType[]",
        to: "  'error',\n  'region',\n  'unparsed',\n] as const satisfies readonly AnchorPhraseType[]",
      },
    ],
    reds: [viewD('C427-ANCHOR-PHRASE-TYPES-EXACT')],
    // The runtime twin pins ANCHOR_PHRASE_TYPES by value, so an eighth type moves it too.
    allowed: [used('CLOSED-SETS-427')],
    greens: [used('APPLICABILITY-ORDER'), used('APPLICABILITY-KNOWN-ANSWER'), used('ANCHOR-UNPARSED-VERBATIM')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'C427-EFFECT-OUTCOMES-EXACT',
    operation: 'add a ninth effect outcome to the union and the array, with its tone and its sentence',
    edits: [
      {
        from: "  | 'pending'\n  | 'unknown'\n\n// prettier-ignore\nexport const EFFECT_OUTCOMES = [",
        to: "  | 'pending'\n  | 'unknown'\n  | 'inconclusive'\n\n// prettier-ignore\nexport const EFFECT_OUTCOMES = [",
      },
      {
        from: "  'pending',\n  'unknown',\n] as const satisfies readonly EffectOutcome[]",
        to: "  'pending',\n  'unknown',\n  'inconclusive',\n] as const satisfies readonly EffectOutcome[]",
      },
      {
        from: "  pending: 'pending',\n  unknown: 'unknown',\n} as const satisfies Record<EffectOutcome, EffectTone>",
        to: "  pending: 'pending',\n  unknown: 'unknown',\n  inconclusive: 'unknown',\n} as const satisfies Record<EffectOutcome, EffectTone>",
      },
      {
        from: "} as const satisfies Record<TrialOutcome, EffectSentenceParts>",
        to: "  inconclusive: { lead: 'Inconclusive in', tail: '' },\n} as const satisfies Record<TrialOutcome, EffectSentenceParts>",
      },
    ],
    reds: [viewD('C427-EFFECT-OUTCOMES-EXACT')],
    // The runtime twin pins EFFECT_OUTCOMES and EFFECT_TONE_OF by value, so a ninth outcome moves it too.
    allowed: [effect('CLOSED-SETS-427')],
    greens: [viewD('C427-EFFECT-TONES-EXACT'), effect('EFFECT-ORDER', 2), effect('HINT-NOT-EFFECT')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'C427-EFFECT-TONES-EXACT',
    operation: 'add a fifth effect tone to the union and the array',
    edits: [
      {
        from: "export type EffectTone = 'problem' | 'positive' | 'pending' | 'unknown'\n",
        to: "export type EffectTone = 'problem' | 'positive' | 'pending' | 'unknown' | 'neutral'\n",
      },
      {
        from: "  'pending',\n  'unknown',\n] as const satisfies readonly EffectTone[]",
        to: "  'pending',\n  'unknown',\n  'neutral',\n] as const satisfies readonly EffectTone[]",
      },
    ],
    reds: [viewD('C427-EFFECT-TONES-EXACT')],
    // The runtime twin pins EFFECT_TONES by value, so a fifth tone moves it too.
    allowed: [effect('CLOSED-SETS-427')],
    greens: [viewD('C427-EFFECT-OUTCOMES-EXACT'), effect('EFFECT-ORDER', 2), effect('UNCOUNTED-NOT-EFFECTS', 3)],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'C427-BUCKET-LABELS-SHAPE',
    operation: "add a 'promoted' key to BUCKET_LABELS by widening its key type",
    edits: [{
      from: "  proposed: 'Proposed',\n} as const satisfies Record<CurationBucket, string>",
      to: "  proposed: 'Proposed',\n  promoted: 'Promoted',\n} as const satisfies Record<CurationBucket | 'promoted', string>",
    }],
    reds: [viewD('C427-BUCKET-LABELS-SHAPE')],
    // The runtime twin pins BUCKET_LABELS by value, and BUCKET-LABEL-MEANINGS requires the meanings
    // to key exactly the labels' keys, so a sixth label moves both.
    allowed: [changes('CLOSED-SETS-427'), changes('BUCKET-LABEL-MEANINGS')],
    greens: [changes('ROWS-EQUAL-COUNTS'), changes('SUPERSESSION-ONE-ROW'), changes('NO-SNAPSHOT-MAPPING')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'C427-STATUS-WORDS-SHAPE',
    operation: 'widen the status key type of SINCE_STATUS_TAGS and CURRENT_STATUS_WORDS with a fifth status',
    edits: [
      {
        from: "  deprecated: 'since retired',\n} as const satisfies Record<BundleStatus, string>",
        to: "  deprecated: 'since retired',\n  purged: 'since purged',\n} as const satisfies Record<BundleStatus | 'purged', string>",
      },
      {
        from: "  deprecated: 'retired',\n} as const satisfies Record<BundleStatus, string>",
        to: "  deprecated: 'retired',\n  purged: 'purged',\n} as const satisfies Record<BundleStatus | 'purged', string>",
      },
    ],
    reds: [viewD('C427-STATUS-WORDS-SHAPE')],
    // The runtime twin pins SINCE_STATUS_TAGS and CURRENT_STATUS_WORDS by value, so a fifth status moves it too.
    allowed: [used('CLOSED-SETS-427')],
    greens: [used('SINCE-TAG-RULE'), used('ON-TRIAL-TAG'), used('TRUST-COUNTS-LINE')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'C427-RETRIEVAL-CLASSES-EXACT',
    operation: 'add a sixth retrieval class to the union and the array, with its tone and a statement case',
    edits: [
      {
        from: "  | 'semantic-search-unavailable'\n  | 'by-configuration'\n\n// prettier-ignore\nexport const RETRIEVAL_CLASSES = [",
        to: "  | 'semantic-search-unavailable'\n  | 'by-configuration'\n  | 'index-rebuilding'\n\n// prettier-ignore\nexport const RETRIEVAL_CLASSES = [",
      },
      {
        from: "  'by-configuration',\n] as const satisfies readonly RetrievalClass[]",
        to: "  'by-configuration',\n  'index-rebuilding',\n] as const satisfies readonly RetrievalClass[]",
      },
      {
        from: "  'by-configuration': 'info',\n} as const satisfies Record<RetrievalClass, RetrievalTone>",
        to: "  'by-configuration': 'info',\n  'index-rebuilding': 'info',\n} as const satisfies Record<RetrievalClass, RetrievalTone>",
      },
      { from: "    case 'fresh-index':\n", to: "    case 'index-rebuilding':\n    case 'fresh-index':\n" },
    ],
    reds: [viewD('C427-RETRIEVAL-CLASSES-EXACT')],
    // The runtime twin pins RETRIEVAL_CLASSES by value; STATEMENTS-NAME-THIS-RUN requires the pinned
    // sentences to cover exactly RETRIEVAL_CLASSES; and the reason map's never-bar pins its value type
    // to RetrievalClass, which a class no reason maps to no longer equals.
    allowed: [retrieval('CLOSED-SETS-427'), retrieval('STATEMENTS-NAME-THIS-RUN'), viewD('C427-RETRIEVAL-CLASS-BY-REASON-TOTAL')],
    greens: [retrieval('RETRIEVAL-CLASS-PER-REASON', 12), viewD('C427-SECTIONS-EXACT'), viewD('C427-EFFECT-TONES-EXACT')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'C427-RETRIEVAL-CLASS-BY-REASON-TOTAL',
    operation: 'declare RETRIEVAL_CLASS_BY_REASON a Partial record, with the fallback it then needs',
    edits: [
      {
        from: 'export const RETRIEVAL_CLASS_BY_REASON = {\n',
        to: 'export const RETRIEVAL_CLASS_BY_REASON: Partial<Record<RetrievalRungReason, RetrievalClass>> = {\n',
      },
      {
        from: "  return reason === undefined ? 'cause-not-recorded' : RETRIEVAL_CLASS_BY_REASON[reason]\n",
        to: "  return reason === undefined ? 'cause-not-recorded' : RETRIEVAL_CLASS_BY_REASON[reason] ?? 'cause-not-recorded'\n",
      },
    ],
    reds: [viewD('C427-RETRIEVAL-CLASS-BY-REASON-TOTAL')],
    allowed: [],
    greens: [viewD('C427-RETRIEVAL-CLASSES-EXACT'), retrieval('RETRIEVAL-CLASS-PER-REASON', 12), retrieval('CLOSED-SETS-427')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-parts', claim: 'NO-ID-IN-DEFAULT-VIEW',
    operation: "lead a served used row with its record id instead of its served summary",
    edits: [{
      from: "      entry.served !== undefined\n        ? [entry.served, 'served']\n",
      to: "      entry.served !== undefined\n        ? [id, 'served']\n",
    }],
    reds: [defaultView('NO-ID-IN-DEFAULT-VIEW')],
    // Each of these reads a served row's primary text, which is now the id rather than the served
    // summary: IDS-ONLY-IN-DETAILS re-checks the default sections after opening the ledger, the
    // Effect entry repeats the used row's primary, and the paging and hostile-text cells read the
    // summaries they served.
    allowed: [defaultView('IDS-ONLY-IN-DETAILS'), effectC('EFFECT-HOSTILE-TEXT'), usedC('USED-PAGING: 60 records'),
      usedC('USED-HOSTILE-TEXT')],
    greens: [defaultView('NO-MACHINERY-IN-DEFAULT-VIEW'), defaultView('DETAILS-COLLAPSED-BY-DEFAULT'),
      usedC('USED-PAGING: exactly 50 records'), usedC('KIND-LABEL')],
  },
  {
    subject: TAB_SRC, instrument: 'ui-tab', claim: 'SECTIONS-IN-ORDER',
    operation: 'swap the Effect and Memory changes sections in the ready arm',
    edits: [{
      from: '      <KnowledgeEffect view={view.effect} stepRefs={stepRefs} testNames={stepRefs?.testNames} />\n      <KnowledgeLearned view={view.learned} proposals={view.proposals} />\n',
      to: '      <KnowledgeLearned view={view.learned} proposals={view.proposals} />\n      <KnowledgeEffect view={view.effect} stepRefs={stepRefs} testNames={stepRefs?.testNames} />\n',
    }],
    reds: [tab('SECTIONS-IN-ORDER')],
    // SECTION-ABSENCE-NOT-EMPTY reads each section's absence sentence in the published order.
    allowed: [tab('SECTION-ABSENCE-NOT-EMPTY')],
    greens: [tab('the Memory changes section renders its heading on every ready run'), tab('LEDGER-IN-RETRIEVAL-DETAILS'),
      learned('BUCKET-LABEL-VOCABULARY')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'GROUPED-ONE-ROW',
    operation: 'key the used rows by record and step, so a record used in several steps is several rows',
    edits: [{
      from: '): readonly UsedRecordView[] {\n  return [...usedRecordsById(projection).values()]\n}',
      to: '): readonly UsedRecordView[] {\n  const stepOf = (address: StepAddress) => `${String(address.testIndex)}:${String(address.stepIndex)}`\n  return [...usedRecordsById(projection).values()].flatMap(view =>\n    [...new Set(view.uses.flatMap(use => use.addresses.map(stepOf)))].map(key => ({\n      ...view,\n      uses: view.uses\n        .map(use => ({ verb: use.verb, addresses: use.addresses.filter(address => stepOf(address) === key) }))\n        .filter(use => use.addresses.length > 0),\n    })),\n  )\n}',
    }],
    reds: [used('GROUPED-ONE-ROW')],
    // Each of these counts one view per record: a record used in two steps is now two views.
    allowed: [used('EVERY-USE-ONE-ROW'), used('FIRST-USE-ORDER'), used('ON-TRIAL-TAG')],
    greens: [used('FORMAT-STEP-REFS'), used('CONTENT-BY-ID'), used('STEP-REF-SUITE-NAMES')],
  },
  {
    subject: USED_SRC, instrument: 'ui-parts', claim: 'NO-CHANNEL-IN-DEFAULT-VIEW',
    operation: "paint the channel-1 eyebrow on every used row",
    edits: [
      { from: 'import {\n  CONTENT_ABSENCE_REASON_TEXT,\n', to: 'import {\n  CHANNEL_EYEBROWS,\n  CONTENT_ABSENCE_REASON_TEXT,\n' },
      {
        from: '      <p data-row-uses className=',
        to: '      <p className="text-xs text-muted-foreground">{CHANNEL_EYEBROWS[1]}</p>\n      <p data-row-uses className=',
      },
    ],
    reds: [usedC('NO-CHANNEL-IN-DEFAULT-VIEW')],
    // 'channel' is one of NO-MACHINERY-IN-DEFAULT-VIEW's storage words, so the eyebrow reds it too.
    allowed: [defaultView('NO-MACHINERY-IN-DEFAULT-VIEW')],
    greens: [usedC('KIND-LABEL'), usedC('USED-COUNT-LINE'), defaultView('NO-ID-IN-DEFAULT-VIEW')],
  },
  {
    subject: STEP_SRC, instrument: 'ui-tab', claim: 'LEDGER-OMITS-EMPTY-CHANNEL',
    operation: "drop the length guard on the ledger's channel-2 section",
    edits: [{ from: '      {detail.channel2.length > 0 ? (\n', to: '      {detail.channel2.length >= 0 ? (\n' }],
    reds: [step('LEDGER-OMITS-EMPTY-CHANNEL')],
    // The tab-level twin expands a channel-1-only step and requires channels 2 and 3 to be absent.
    allowed: [tab("fills the row's detail slot with the channel sections it was served once it is expanded (407-06, 427 D-19)")],
    greens: [step('LEDGER-TRACE-INLINE'), step('paints a read trace and a caution on their own channels'), tab('SECTIONS-IN-ORDER')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-tab', claim: 'BUCKET-LABEL-VOCABULARY',
    operation: "label the added bucket 'New' instead of 425's 'Added'",
    edits: [{ from: "  added: 'Added',\n  confirmed: 'Confirmed',\n", to: "  added: 'New',\n  confirmed: 'Confirmed',\n" }],
    reds: [learned('BUCKET-LABEL-VOCABULARY')],
    allowed: [],
    greens: [learned('NO-ID-ON-CHANGE-ROWS'), learned('CHANGE-LEDGER-ENTRIES'), tab('SECTIONS-IN-ORDER')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'ROWS-EQUAL-COUNTS',
    operation: "build a snapshot run's curation rows from learned.changes instead of the snapshot's rows",
    edits: [{
      from: "    const curation = curationSnapshot.rows.map((row): ChangeDraft => {\n      const replaced = row.bucket === 'superseded' && row.byRecordId !== undefined\n      return {\n        bucket: row.bucket,\n        section: 'curation',\n        subjectId: replaced ? row.byRecordId! : row.recordId,\n        ...(replaced ? { wasId: row.recordId } : {}),\n        changes: row.changes.map(entry => entry.change),\n      }\n    })\n",
      to: "    const curation = changes.flatMap((change): ChangeDraft[] => isLearnedChangeKind(change.change)\n      ? [{ bucket: CHANGE_BUCKETS[change.change], section: 'curation', subjectId: change.recordId, changes: [change] }]\n      : [])\n",
    }],
    reds: [changes('ROWS-EQUAL-COUNTS')],
    // Every other snapshot-run row cell reads the rows the snapshot recorded; drawn from
    // learned.changes they re-split (a supersession is two rows) and lose Proposed and since-then order.
    allowed: [changes('SUPERSESSION-ONE-ROW'), changes('LEARNED-ROW-CONTENT-JOIN'), changes('PROPOSED-HELD-FOR-REVIEW'),
      changes('SINCE-THEN-ROWS'), changes('CHANGE-LEDGER-ENTRIES')],
    greens: [changes('NO-SNAPSHOT-MAPPING'), changes('BUCKET-LABEL-MEANINGS'), used('GROUPED-ONE-ROW')],
  },
  {
    subject: USED_SRC, instrument: 'ui-parts', claim: 'NO-MACHINERY-IN-DEFAULT-VIEW',
    operation: "paint the ledger's on-trial word and a trace line on an on-trial used row",
    edits: [
      { from: '  CONTENT_ABSENCE_REASON_TEXT,\n  ON_TRIAL_TAG,\n', to: '  CONTENT_ABSENCE_REASON_TEXT,\n  LEDGER_ON_TRIAL_TEXT,\n  ON_TRIAL_TAG,\n' },
      { from: '  showAllRecordsLabel,\n', to: '  showAllRecordsLabel,\n  traceLineText,\n' },
      {
        from: '        {record.onTrial === undefined ? null : <OnTrialTag />}\n',
        to: '        {record.onTrial === undefined ? null : <OnTrialTag />}\n        {record.onTrial === undefined ? null : (\n          <span className="font-mono text-xs text-muted-foreground">{LEDGER_ON_TRIAL_TEXT} · {traceLineText("anchor", 1, 1.487)}</span>\n        )}\n',
      },
    ],
    reds: [defaultView('NO-MACHINERY-IN-DEFAULT-VIEW')],
    // The used row's own on-trial cell requires the row never to say 'canary' (D-13).
    allowed: [usedC('ON-TRIAL-TAG')],
    greens: [defaultView('NO-ID-IN-DEFAULT-VIEW'), defaultView('DETAILS-COLLAPSED-BY-DEFAULT'), usedC('KIND-LABEL')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-tab', claim: 'BOOTSTRAP-NOT-IN-STRIP',
    operation: 'give the fresh-index retrieval class the warning tone',
    edits: [{ from: "  'fresh-index': 'info',\n", to: "  'fresh-index': 'warning',\n" }],
    reds: [banner('BOOTSTRAP-NOT-IN-STRIP: both variants')],
    allowed: [],
    greens: [banner('BOOTSTRAP-NOT-IN-STRIP: a degraded rung'), banner('WARNING-STRIP-WITH-POINTER', 2), tab('SECTIONS-IN-ORDER')],
  },
  {
    subject: STATEMENT_SRC, instrument: 'ui-parts', claim: 'NO-POINTER-ON-INFO',
    operation: 'give an info-class statement the doctor pointer',
    edits: [
      {
        from: 'import type { RetrievalClass, RetrievalStatementView } from "@/lib/knowledge-view"\n',
        to: 'import { DOCTOR_POINTER_TEXT, type RetrievalClass, type RetrievalStatementView } from "@/lib/knowledge-view"\n',
      },
      {
        from: '        <span>{view.sentence}</span>\n      </p>\n',
        to: '        <span>{view.sentence}</span>\n        <span data-doctor-pointer>{doctorSentenceNodes(DOCTOR_POINTER_TEXT)}</span>\n      </p>\n',
      },
    ],
    reds: [statement('NO-POINTER-ON-INFO')],
    // Each info row of TAB-STATEMENT-PER-CLASS requires its statement to carry no pointer.
    allowed: [statement('TAB-STATEMENT-PER-CLASS', 9)],
    greens: [statement('STATEMENT-TEXT-EQUALS-CONSTANT'), statement('MEMIDEX-NOTHING', 2), defaultView('NO-ID-IN-DEFAULT-VIEW')],
  },
  {
    subject: DRAIN_SRC, instrument: 'store', claim: 'ZERO-EFFECT-SNAPSHOT',
    operation: "restore the drain's fold guard to effects.length > 0 alone",
    edits: [{
      from: '      && (result.effects.length > 0 || runLinked === false)) {\n',
      to: '      && result.effects.length > 0) {\n',
    }],
    reds: [snap('ZERO-EFFECT-SNAPSHOT')],
    allowed: [],
    greens: [snap('HISTORICAL-MISSING'), snap('RECEIPT-LOSS-CANARY-LINKED', 2), snap('CURATION-FIVE-BUCKETS')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'EFFECT-ORDER',
    operation: 'sort effect entries by their first step only',
    edits: [{
      from: '      rank(a) - rank(b) ||\n      compareAddresses(a.addresses[0]!, b.addresses[0]!) ||\n      (position.get(a.recordId) ?? 0) - (position.get(b.recordId) ?? 0),\n',
      to: '      compareAddresses(a.addresses[0]!, b.addresses[0]!),\n',
    }],
    reds: [effect('EFFECT-ORDER: harmful and contradicted')],
    // A stopped replay after an earlier confirmation is the problems-first rule seen from the replay side.
    allowed: [effect('REPLAY-STOPPED-IS-PROBLEM: a stopped replay sorts before'),
      // 427-15's runner-shaped cells put a stop after a completed replay in an earlier step and read the stop first.
      effect('REPLAY-STOPPED-IS-PROBLEM: a miss at procedure step index 2'),
      effect('REPLAY-SIZE-FROM-FLOW: three completed body steps'), effect('REPLAY-SIZE-FROM-FLOW: with no recorded flow')],
    greens: [effect('HINT-NOT-EFFECT'), effect('UNCOUNTED-NOT-EFFECTS', 3), effect('EFFECT-GROUPED-STEPS')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'UNCOUNTED-NOT-EFFECTS',
    operation: 'turn a trial post-run processing did not count into an unknown effect entry',
    edits: [{
      from: "      const word = canaryOutcomeWord(status, attribution, scanIncomplete)\n      if (word === 'not-attributed') {\n        uncountedIds.add(line.id)\n        continue\n      }\n",
      to: "      const folded = canaryOutcomeWord(status, attribution, scanIncomplete)\n      const word = folded === 'not-attributed' ? 'unknown' : folded\n",
    }],
    reds: [effect('UNCOUNTED-NOT-EFFECTS', 3)],
    // Both fixtures carry an unattributed trial, which is now an extra unknown entry.
    allowed: [effect('EFFECT-ORDER: the join is on test, step and record'),
      effect('UNMEASURED-LINE: 4 used records, 1 entry, 1 uncounted leaves 2 unmeasured')],
    greens: [effect('HINT-NOT-EFFECT'), effect('EFFECT-GROUPED-STEPS'), effect('REPLAY-COMPLETE')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'HINT-NOT-EFFECT',
    operation: 'add an effect entry for a step whose plan a procedure only hinted',
    edits: [{
      from: "    if (step.planSource?.kind === 'procedure-replay') {\n      const { guard, procedureId, flow } = step.planSource\n",
      to: "    if (step.planSource?.kind === 'procedure-hint') {\n      const { procedureId } = step.planSource\n      replays.set(procedureId, { recordId: procedureId, length: undefined, stop: undefined, addresses: [address], cursors: new Set<number>() })\n    }\n    if (step.planSource?.kind === 'procedure-replay') {\n      const { guard, procedureId, flow } = step.planSource\n",
    }],
    reds: [effect('HINT-NOT-EFFECT')],
    allowed: [],
    greens: [effect('REPLAY-COMPLETE'), effect('EFFECT-ORDER', 2), effect('UNCOUNTED-NOT-EFFECTS', 3)],
  },
  {
    subject: BODY_SRC, instrument: 'ui-parts', claim: 'FULL-RECORD-ORDER',
    operation: "render the curator's note before the trust counts",
    edits: [{
      from: '        <p data-trust-counts className="text-xs text-muted-foreground tabular-nums">\n          {trustCountsLine(confirmations, contradictions)}\n        </p>\n        {trustNarrative === undefined ? null : (\n          <div data-evidence-note className="border-l-2 border-border pl-2 space-y-1">\n            <p className="text-xs font-medium text-muted-foreground">{EVIDENCE_NOTE_LABEL}</p>\n            <p className="text-xs text-muted-foreground whitespace-pre-wrap wrap-anywhere">\n              <MaskedText text={trustNarrative} />\n            </p>\n          </div>\n        )}\n',
      to: '        {trustNarrative === undefined ? null : (\n          <div data-evidence-note className="border-l-2 border-border pl-2 space-y-1">\n            <p className="text-xs font-medium text-muted-foreground">{EVIDENCE_NOTE_LABEL}</p>\n            <p className="text-xs text-muted-foreground whitespace-pre-wrap wrap-anywhere">\n              <MaskedText text={trustNarrative} />\n            </p>\n          </div>\n        )}\n        <p data-trust-counts className="text-xs text-muted-foreground tabular-nums">\n          {trustCountsLine(confirmations, contradictions)}\n        </p>\n',
    }],
    reds: [body('FULL-RECORD-ORDER: current status, the body with its line breaks, the counts, then the labelled note')],
    // EVIDENCE-NOTE-NEVER-ALONE and the used row's FULL-RECORD-ORDER both require the counts first.
    allowed: [body('EVIDENCE-NOTE-NEVER-ALONE'), usedC('FULL-RECORD-ORDER')],
    greens: [body('TRUST-COUNTS-LINE'), body('RECORD-BODY-HOSTILE-TEXT'), usedC('KIND-LABEL')],
  },
  {
    subject: VIEW_SRC, instrument: 'knowledge-dom', claim: 'NO-ID-IN-DEFAULT-VIEW',
    operation: 'lead a served used row with its record id, on the rebuilt bundle over a real served run',
    crossing: ui('id427primary'),
    edits: [{
      from: "      entry.served !== undefined\n        ? [entry.served, 'served']\n",
      to: "      entry.served !== undefined\n        ? [id || 'id427primary', 'served']\n",
    }],
    reds: [dom('(b7)')],
    allowed: [],
    greens: [dom('(a3)'), dom('(a8)'), dom('(b1)')],
  },
  {
    subject: VIEW_SRC, instrument: 'knowledge-dom', claim: 'BOOTSTRAP-NOT-IN-STRIP',
    operation: "paint the header strip for every class below memidex, a fresh store's bootstrap included",
    crossing: ui('boot427strip'),
    // Not K19's tone flip: (a2) reads RETRIEVAL_CLASS_TONES from source before it reads the page, so
    // a flipped table would red that source read and never reach the page. Opening the strip's own
    // gate leaves every table as published, so (a2) can only red on the painted header.
    edits: [{
      from: '  if (statement?.pointer === undefined) return undefined\n  return `${statement.sentence} ${statement.pointer}`\n',
      to: "  if (statement === undefined) return undefined\n  return `${statement.sentence} ${statement.pointer ?? 'boot427strip'}`\n",
    }],
    reds: [dom('(a2)')],
    // (b3) holds "strip present exactly when the tone is warning" on the served world, whose rung
    // depends on the host; where that world is served below memidex on an info class, the open gate
    // paints its strip too.
    allowed: [dom('(b3)')],
    greens: [dom('(a1)'), dom('(a3)'), dom('(a8)')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'REPLAY-INCOMPLETE-NOT-COMPLETE',
    operation: 'count a replay as complete whenever no break member is recorded',
    edits: [{
      from: '  return replayStop(guard) === undefined && guard.total > 0 && guard.checksPassed === guard.total\n',
      to: '  return replayStop(guard) === undefined\n',
    }],
    reds: [effect('REPLAY-INCOMPLETE-NOT-COMPLETE', 2)],
    // A denied cursor now counts as a completed body step of its flow, so each short flow reads 2 of 3.
    allowed: [effect("REPLAY-PER-FLOW: a second test's flow"), effect('REPLAY-PER-FLOW: inside one test')],
    greens: [effect('REPLAY-COMPLETE'), effect('REPLAY-SIZE-FROM-FLOW', 3), effect('HINT-NOT-EFFECT'), effect('EFFECT-ORDER', 2),
      effect('EFFECT-GROUPED-STEPS')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'REPLAY-SIZE-FROM-FLOW',
    operation: "take a replay's size from the per-step guard total instead of the recorded flow length",
    edits: [
      {
        from: "        const groupKey = stop === undefined\n          ? [procedureId, flow?.length ?? '', flowInstance].join('\\u0000')\n          : [procedureId, flow?.length ?? '', stop.step, stop.cause].join('\\u0000')\n",
        to: "        const groupKey = stop === undefined\n          ? [procedureId, guard.total, flowInstance].join('\\u0000')\n          : [procedureId, guard.total, stop.step, stop.cause].join('\\u0000')\n",
      },
      { from: '          length: flow?.length,\n', to: '          length: guard.total,\n' },
    ],
    reds: [effect('REPLAY-SIZE-FROM-FLOW: three completed body steps')],
    // Each of these pins a runner-shaped replay's sentence to its flow length, and the runner records
    // total 1 per step: six steps read "6 of its 1 steps", a three-step stop loses its "of 3", the
    // partial replay beside a stop reads "2 of its 1 steps", and an unfinished third step "2 of its 1".
    allowed: [effect('REPLAY-COMPLETE'), effect('REPLAY-GROUPED-STEPS'),
      effect('REPLAY-STOPPED-IS-PROBLEM: a miss at procedure step index 2'),
      effect('REPLAY-INCOMPLETE-NOT-COMPLETE: an unfinished third step'),
      // Each pins a runner-shaped three-step flow, which now reads "of its 1 steps".
      effect('REPLAY-PER-FLOW', 3)],
    greens: [effect('HINT-NOT-EFFECT'), effect('EFFECT-ORDER', 2), effect('UNCOUNTED-NOT-EFFECTS', 3), effect('EFFECT-GROUPED-STEPS'),
      effect('REPLAY-INCOMPLETE-NOT-COMPLETE: a policy-denied')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'REPLAY-GROUPED-STEPS',
    operation: 'give every replayed step its own effect entry again',
    edits: [
      {
        from: "        const groupKey = stop === undefined\n          ? [procedureId, flow?.length ?? '', flowInstance].join('\\u0000')\n          : [procedureId, flow?.length ?? '', stop.step, stop.cause].join('\\u0000')\n",
        to: "        const groupKey = stop === undefined\n          ? [procedureId, step.testIndex, step.stepIndex, flow?.length ?? '', flowInstance].join('\\u0000')\n          : [procedureId, step.testIndex, step.stepIndex, flow?.length ?? '', stop.step, stop.cause].join('\\u0000')\n",
      },
      {
        from: "      ? [draft.recordId, draft.length ?? '', draft.cursors.size].join('\\u0000')\n",
        to: "      ? [draft.recordId, draft.addresses[0]!.testIndex, draft.addresses[0]!.stepIndex, draft.length ?? '', draft.cursors.size].join('\\u0000')\n",
      },
    ],
    reds: [effect('REPLAY-GROUPED-STEPS', 2)],
    // Each of these replays one procedure across several steps and expects one entry for them: six
    // entries for REPLAY-COMPLETE, and a partial replay beside a stop or an unfinished step splits too.
    allowed: [effect('REPLAY-COMPLETE'), effect('REPLAY-STOPPED-IS-PROBLEM: a miss at procedure step index 2'),
      effect('REPLAY-SIZE-FROM-FLOW: three completed body steps'),
      effect('REPLAY-INCOMPLETE-NOT-COMPLETE: an unfinished third step'),
      // Each groups a runner-shaped three-step flow into one entry, which now splits per step.
      effect('REPLAY-PER-FLOW', 3)],
    greens: [effect('EFFECT-GROUPED-STEPS'), effect('HINT-NOT-EFFECT'), effect('EFFECT-ORDER', 2), effect('UNCOUNTED-NOT-EFFECTS', 3),
      effect('REPLAY-INCOMPLETE-NOT-COMPLETE: a policy-denied')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'REPLAY-PER-FLOW',
    operation: 'union every flow of a procedure into one completed replay again',
    edits: [{
      from: "          ? [procedureId, flow?.length ?? '', flowInstance].join('\\u0000')\n",
      to: "          ? [procedureId, flow?.length ?? ''].join('\\u0000')\n",
    }],
    reds: [effect('REPLAY-PER-FLOW', 3)],
    allowed: [],
    greens: [effect('REPLAY-COMPLETE'), effect('REPLAY-GROUPED-STEPS', 2), effect('REPLAY-SIZE-FROM-FLOW', 3),
      effect('REPLAY-INCOMPLETE-NOT-COMPLETE', 2), effect('EFFECT-GROUPED-STEPS'), effect('HINT-NOT-EFFECT')],
  },
  {
    subject: USED_SRC, instrument: 'ui-parts', claim: 'TRIGGER-ACCESSIBLE-NAME',
    operation: 'turn the on-trial trigger back into the focusable span the UAT found, with no role and so no name',
    edits: [
      { from: '        <button type="button"', to: '        <span tabIndex={0}' },
      { from: '        </button>\n', to: '        </span>\n' },
    ],
    reds: [usedC('TRIGGER-ACCESSIBLE-NAME')],
    allowed: [],
    greens: [usedC('ON-TRIAL-TAG'), usedC('KIND-LABEL'), effectC('TRIGGER-ACCESSIBLE-NAME'), defaultView('NO-MACHINERY-IN-DEFAULT-VIEW')],
  },
]

runGate({
  slug: '427-knowledge-mutation', envPrefix: 'AGENT_QA_427_KNOWLEDGE_MUTATION', idPrefix: 'K',
  instruments, legs, expectedLegs: 32, banner: 'KNOWLEDGE_MUTATION_OK',
})
NODE
