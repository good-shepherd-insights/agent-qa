#!/usr/bin/env bash
# The Knowledge tab instrument's own test (427-12). Every declared leg is run NEUTERED — the mutation
# withheld — and must FATAL with "<leg>: suite stayed green" after an actual green child of its own
# suite. The interruption modes (fatal, SIGINT, SIGTERM, SIGHUP) must mutate every subject and hand
# back the exact bytes and mtimes, then rebuild; a dirty subject must be refused and left as found;
# invalid knobs refuse before ownership.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A leg silently dropped, re-aimed or renamed in
# 427-knowledge-mutation.sh reddens HERE instead of shrinking both in step — which is the whole reason
# a total read off the gate would be worthless: it would agree with the gate however the gate moved.
#
# Runs in place on the real tree. Slow; a phase gate, not a per-commit sample.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

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
const VIEW_D = 'src/lib/__tests__/knowledge-view.test-d.ts'
const USED_C = 'src/components/run-detail/__tests__/knowledge-used.test.tsx'
const BODY_C = 'src/components/run-detail/__tests__/knowledge-record-body.test.tsx'
const DEFAULT_C = 'src/components/run-detail/__tests__/knowledge-default-view.test.tsx'
const STATEMENT_C = 'src/components/run-detail/__tests__/retrieval-statement.test.tsx'
const TAB_C = 'src/components/run-detail/__tests__/tab-knowledge.test.tsx'
const LEARNED_C = 'src/components/run-detail/__tests__/knowledge-learned.test.tsx'
const STEP_C = 'src/components/run-detail/__tests__/knowledge-step-detail.test.tsx'
const BANNER_C = 'src/components/run-detail/__tests__/retrieval-rung-banner.test.tsx'
const SNAPSHOT_T = 'src/__tests__/423-curation-snapshot.test.ts'
const DOM = 'src/__tests__/conformance/knowledge-tab-dom.test.ts'

const UI = '@vostride/agent-qa-dashboard-ui'

runSelftest({
  slug: '427-knowledge-mutation',
  gateScript: 'scripts/427-knowledge-mutation.sh',
  envPrefix: 'AGENT_QA_427_KNOWLEDGE_MUTATION',
  idPrefix: 'K',
  banner: 'KNOWLEDGE_MUTATION_OK',
  registration: {
    'validate:427-knowledge-mutation': 'bash scripts/427-knowledge-mutation.sh',
    'validate:427-knowledge-mutation-selftest': 'bash scripts/427-knowledge-mutation-selftest.sh',
  },
  expected: [
    { id: 'K01', claim: 'C427-SECTIONS-EXACT', subject: VIEW_SRC,
      reds: [`${VIEW_D} > C427-SECTIONS-EXACT`] },
    { id: 'K02', claim: 'C427-USE-VERBS-EXACT', subject: VIEW_SRC,
      reds: [`${VIEW_D} > C427-USE-VERBS-EXACT`] },
    { id: 'K03', claim: 'C427-RECORD-KINDS-EXACT', subject: VIEW_SRC,
      reds: [`${VIEW_D} > C427-RECORD-KINDS-EXACT`] },
    { id: 'K04', claim: 'C427-ANCHOR-PHRASE-TYPES-EXACT', subject: VIEW_SRC,
      reds: [`${VIEW_D} > C427-ANCHOR-PHRASE-TYPES-EXACT`] },
    { id: 'K05', claim: 'C427-EFFECT-OUTCOMES-EXACT', subject: VIEW_SRC,
      reds: [`${VIEW_D} > C427-EFFECT-OUTCOMES-EXACT`] },
    { id: 'K06', claim: 'C427-EFFECT-TONES-EXACT', subject: VIEW_SRC,
      reds: [`${VIEW_D} > C427-EFFECT-TONES-EXACT`] },
    { id: 'K07', claim: 'C427-BUCKET-LABELS-SHAPE', subject: VIEW_SRC,
      reds: [`${VIEW_D} > C427-BUCKET-LABELS-SHAPE`] },
    { id: 'K08', claim: 'C427-STATUS-WORDS-SHAPE', subject: VIEW_SRC,
      reds: [`${VIEW_D} > C427-STATUS-WORDS-SHAPE`] },
    { id: 'K09', claim: 'C427-RETRIEVAL-CLASSES-EXACT', subject: VIEW_SRC,
      reds: [`${VIEW_D} > C427-RETRIEVAL-CLASSES-EXACT`] },
    { id: 'K10', claim: 'C427-RETRIEVAL-CLASS-BY-REASON-TOTAL', subject: VIEW_SRC,
      reds: [`${VIEW_D} > C427-RETRIEVAL-CLASS-BY-REASON-TOTAL`] },
    { id: 'K11', claim: 'NO-ID-IN-DEFAULT-VIEW', subject: VIEW_SRC,
      reds: [`${DEFAULT_C} > NO-ID-IN-DEFAULT-VIEW`] },
    { id: 'K12', claim: 'SECTIONS-IN-ORDER', subject: TAB_SRC,
      reds: [`${TAB_C} > SECTIONS-IN-ORDER`] },
    { id: 'K13', claim: 'GROUPED-ONE-ROW', subject: VIEW_SRC,
      reds: [`${USED_V} > GROUPED-ONE-ROW`] },
    { id: 'K14', claim: 'NO-CHANNEL-IN-DEFAULT-VIEW', subject: USED_SRC,
      reds: [`${USED_C} > NO-CHANNEL-IN-DEFAULT-VIEW`] },
    { id: 'K15', claim: 'LEDGER-OMITS-EMPTY-CHANNEL', subject: STEP_SRC,
      reds: [`${STEP_C} > LEDGER-OMITS-EMPTY-CHANNEL`] },
    { id: 'K16', claim: 'BUCKET-LABEL-VOCABULARY', subject: VIEW_SRC,
      reds: [`${LEARNED_C} > BUCKET-LABEL-VOCABULARY`] },
    { id: 'K17', claim: 'ROWS-EQUAL-COUNTS', subject: VIEW_SRC,
      reds: [`${CHANGES_V} > ROWS-EQUAL-COUNTS`] },
    { id: 'K18', claim: 'NO-MACHINERY-IN-DEFAULT-VIEW', subject: USED_SRC,
      reds: [`${DEFAULT_C} > NO-MACHINERY-IN-DEFAULT-VIEW`] },
    { id: 'K19', claim: 'BOOTSTRAP-NOT-IN-STRIP', subject: VIEW_SRC,
      reds: [`${BANNER_C} > BOOTSTRAP-NOT-IN-STRIP: both variants`] },
    { id: 'K20', claim: 'NO-POINTER-ON-INFO', subject: STATEMENT_SRC,
      reds: [`${STATEMENT_C} > NO-POINTER-ON-INFO`] },
    { id: 'K21', claim: 'ZERO-EFFECT-SNAPSHOT', subject: DRAIN_SRC,
      reds: [`${SNAPSHOT_T} > ZERO-EFFECT-SNAPSHOT`] },
    { id: 'K22', claim: 'EFFECT-ORDER', subject: VIEW_SRC,
      reds: [`${EFFECT_V} > EFFECT-ORDER: harmful and contradicted`] },
    { id: 'K23', claim: 'UNCOUNTED-NOT-EFFECTS', subject: VIEW_SRC,
      reds: [`${EFFECT_V} > UNCOUNTED-NOT-EFFECTS (x3)`] },
    { id: 'K24', claim: 'HINT-NOT-EFFECT', subject: VIEW_SRC,
      reds: [`${EFFECT_V} > HINT-NOT-EFFECT`] },
    { id: 'K25', claim: 'FULL-RECORD-ORDER', subject: BODY_SRC,
      reds: [`${BODY_C} > FULL-RECORD-ORDER: current status, the body with its line breaks, the counts, then the labelled note`] },
    { id: 'K26', claim: 'NO-ID-IN-DEFAULT-VIEW', subject: VIEW_SRC, crossing: UI,
      reds: [`${DOM} > (b7)`] },
    { id: 'K27', claim: 'BOOTSTRAP-NOT-IN-STRIP', subject: VIEW_SRC, crossing: UI,
      reds: [`${DOM} > (a2)`] },
    { id: 'K28', claim: 'REPLAY-INCOMPLETE-NOT-COMPLETE', subject: VIEW_SRC,
      reds: [`${EFFECT_V} > REPLAY-INCOMPLETE-NOT-COMPLETE (x2)`] },
    { id: 'K29', claim: 'REPLAY-SIZE-FROM-FLOW', subject: VIEW_SRC,
      reds: [`${EFFECT_V} > REPLAY-SIZE-FROM-FLOW: three completed body steps`] },
    { id: 'K30', claim: 'REPLAY-GROUPED-STEPS', subject: VIEW_SRC,
      reds: [`${EFFECT_V} > REPLAY-GROUPED-STEPS (x2)`] },
  ],
})
NODE
