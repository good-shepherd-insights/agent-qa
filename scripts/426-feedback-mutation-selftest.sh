#!/usr/bin/env bash
# The feedback instrument's own test (426-18). Every declared leg is run NEUTERED — the mutation
# withheld — and must FATAL with "<leg>: suite stayed green" after an actual green child of its own
# suite. The interruption modes (fatal, SIGINT, SIGTERM, SIGHUP) must mutate every subject and hand
# back the exact bytes and mtimes, then rebuild; a dirty subject must be refused and left as found;
# invalid knobs refuse before ownership.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A leg silently dropped, re-aimed or renamed in
# 426-feedback-mutation.sh reddens HERE instead of shrinking both in step — which is the whole reason
# a total read off the gate would be worthless: it would agree with the gate however the gate moved.
#
# Runs in place on the real tree. Slow; a phase gate, not a per-commit sample.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const VIEW_SRC = 'packages/dashboard-ui/src/lib/feedback-view.ts'
const HOOK_SRC = 'packages/dashboard-ui/src/hooks/use-run-feedback.ts'
const ROW_SRC = 'packages/dashboard-ui/src/components/run-detail/step-tree-item.tsx'
const HISTORY_SRC = 'packages/dashboard-ui/src/components/run-detail/feedback-history.tsx'
const PREVIEW_SRC = 'packages/dashboard-ui/src/components/run-detail/feedback-preview.tsx'
const APPROVAL_SRC = 'packages/dashboard-ui/src/components/run-detail/feedback-approval.tsx'

const VIEW = 'src/lib/__tests__/feedback-view.test.ts'
const VIEW_D = 'src/lib/__tests__/feedback-view.test-d.ts'
const PAGE = 'src/pages/__tests__/run-detail.feedback.test.tsx'
const COMPOSER = 'src/components/run-detail/__tests__/feedback-composer.test.tsx'
const PREVIEW = 'src/components/run-detail/__tests__/feedback-preview.test.tsx'
const HISTORY = 'src/components/run-detail/__tests__/feedback-history.test.tsx'
const DOM = 'src/__tests__/conformance/426-feedback-dom.test.ts'

runSelftest({
  slug: '426-feedback-mutation',
  gateScript: 'scripts/426-feedback-mutation.sh',
  envPrefix: 'AGENT_QA_426_FEEDBACK_MUTATION',
  idPrefix: 'F',
  banner: 'FEEDBACK_MUTATION_OK',
  registration: {
    'validate:426-feedback-mutation': 'bash scripts/426-feedback-mutation.sh',
    'validate:426-feedback-mutation-selftest': 'bash scripts/426-feedback-mutation-selftest.sh',
  },
  expected: [
    { id: 'F01', claim: 'C426-OUTCOME-CLASSES-EXACT', subject: VIEW_SRC,
      reds: [`${VIEW_D} > C426-OUTCOME-CLASSES-EXACT`] },
    { id: 'F02', claim: 'CHOICE-ORDER-FAILED', subject: VIEW_SRC,
      reds: [`${VIEW} > CHOICE-ORDER-FAILED`] },
    { id: 'F03', claim: 'C426-ENTRY-SCOPES-EXACT', subject: VIEW_SRC,
      reds: [`${VIEW_D} > C426-ENTRY-SCOPES-EXACT`] },
    { id: 'F04', claim: 'C426-COMPOSER-STATES-EXACT', subject: VIEW_SRC,
      reds: [`${VIEW_D} > C426-COMPOSER-STATES-EXACT`] },
    { id: 'F05', claim: 'C426-PREVIEW-STATES-EXACT', subject: VIEW_SRC,
      reds: [`${VIEW_D} > C426-PREVIEW-STATES-EXACT`] },
    { id: 'F06', claim: 'C426-HISTORY-STATES-EXACT', subject: VIEW_SRC,
      reds: [`${VIEW_D} > C426-HISTORY-STATES-EXACT`] },
    { id: 'F07', claim: 'C426-LAYOUTS-EXACT', subject: VIEW_SRC,
      reds: [`${VIEW_D} > C426-LAYOUTS-EXACT`] },
    { id: 'F08', claim: 'TRIGGER-COUNT', subject: ROW_SRC,
      reds: [`${PAGE} > TRIGGER-COUNT`] },
    { id: 'F09', claim: 'NO-PILL-ANYWHERE', subject: ROW_SRC,
      reds: [`${PAGE} > NO-PILL-ANYWHERE`] },
    { id: 'F10', claim: 'NO-INTERNAL-NAME-IN-COPY', subject: VIEW_SRC,
      reds: [`${COMPOSER} > NO-INTERNAL-NAME-IN-COPY (x3)`] },
    { id: 'F11', claim: 'SUBMIT-NEEDS-CURRENT-PREVIEW', subject: VIEW_SRC,
      reds: [`${PAGE} > SUBMIT-NEEDS-CURRENT-PREVIEW`] },
    { id: 'F12', claim: 'NO-DIALOG-ON-MARK-PATH', subject: APPROVAL_SRC,
      reds: [`${DOM} > NO-DIALOG-ON-MARK-PATH`], crossing: '@vostride/agent-qa-dashboard-ui' },
    { id: 'F13', claim: 'HISTORY-REPLACED-EXPLAINED', subject: HISTORY_SRC,
      reds: [`${HISTORY} > HISTORY-REPLACED-EXPLAINED`] },
    { id: 'F14', claim: 'PREVIEW-REPLACES-LINE', subject: PREVIEW_SRC,
      reds: [`${PREVIEW} > PREVIEW-REPLACES-LINE`] },
    { id: 'F15', claim: 'NOTE-DOES-NOT-REFETCH', subject: HOOK_SRC,
      reds: [`${PAGE} > NOTE-DOES-NOT-REFETCH`] },
    { id: 'F16', claim: 'TARGET-PINNED', subject: HOOK_SRC,
      reds: [`${PAGE} > TARGET-PINNED`] },
  ],
})
NODE
