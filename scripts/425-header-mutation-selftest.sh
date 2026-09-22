#!/usr/bin/env bash
# The header instrument's own test (425-12). Every declared leg is run NEUTERED — the mutation
# withheld — and must FATAL with "<leg>: suite stayed green" after an actual green child of its own
# suite. The interruption modes (fatal, SIGINT, SIGTERM, SIGHUP) must mutate every subject and hand
# back the exact bytes and mtimes, then rebuild; a dirty subject must be refused and left as found;
# invalid knobs refuse before ownership.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A leg silently dropped, re-aimed or renamed in
# 425-header-mutation.sh reddens HERE instead of shrinking both in step — which is the whole reason
# a total read off the gate would be worthless: it would agree with the gate however the gate moved.
#
# Runs in place on the real tree. Slow; a phase gate, not a per-commit sample.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

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

runSelftest({
  slug: '425-header-mutation',
  gateScript: 'scripts/425-header-mutation.sh',
  envPrefix: 'AGENT_QA_425_HEADER_MUTATION',
  idPrefix: 'H',
  banner: 'HEADER_MUTATION_OK',
  registration: {
    'validate:425-header-mutation': 'bash scripts/425-header-mutation.sh',
    'validate:425-header-mutation-selftest': 'bash scripts/425-header-mutation-selftest.sh',
  },
  expected: [
    { id: 'H01', claim: 'C425-STAGE-STATES-EXACT', subject: VIEW_SRC,
      reds: [`${VIEW_D} > C425-STAGE-STATES-EXACT`] },
    { id: 'H02', claim: 'C425-EXCLUSION-REASONS-EXACT', subject: STATUS_SRC,
      reds: [
        `${EXCL} > C425-EXCLUSION-REASONS-EXACT > pins the reason list to an independent exact vocabulary through both barrels`,
        `${EXCL} > C425-EXCLUSION-REASONS-EXACT > accepts each hand-spelled reason and rejects a third reason or an extra key`,
        `${EXCL_D} > C425-EXCLUSION-REASONS-EXACT > pins exactly two exclusion reasons in both directions through both barrels`,
        `${EXCL_D} > C425-EXCLUSION-REASONS-EXACT > refuses a third reason at the type boundary`,
      ] },
    { id: 'H03', claim: 'HEADER-NO-LEGACY-COUNT', subject: VIEW_SRC,
      reds: [`${CHIPS} > HEADER-NO-LEGACY-COUNT`] },
    { id: 'H04', claim: 'ANALYSIS-COMPLETE-COPY', subject: VIEW_SRC,
      reds: [`${VIEW} > ANALYSIS-COMPLETE-COPY`] },
    { id: 'H05', claim: 'EXCLUDED-FROM-FIELD', subject: VIEW_SRC,
      reds: [
        `${VIEW} > EXCLUDED-FROM-FIELD: paints BOTH indicators excluded while the chip words stay verbatim`,
        `${VIEW} > EXCLUDED-FROM-FIELD: outranks the chip words — a settled read carrying the field is still excluded`,
      ] },
    { id: 'H06', claim: 'NO-HEADER-MODEL-ITEM', subject: NAVBAR_SRC,
      reds: [`${NAVBAR} > NO-HEADER-MODEL-ITEM`] },
    { id: 'H07', claim: 'CACHED-ONLY-WHEN-REPORTED', subject: DETAIL_SRC,
      reds: [`${DETAIL} > CACHED-ONLY-WHEN-REPORTED: no cachedInputTokens, no line — whatever else is present`] },
    { id: 'H08', claim: 'NO-HEADER-COVERAGE', subject: DETAIL_SRC,
      reds: [`${NAVBAR} > NO-HEADER-COVERAGE`] },
    { id: 'H09', claim: 'HEADER-STACKS', subject: NAVBAR_SRC,
      reds: [`${NAVBAR} > HEADER-STACKS`] },
    { id: 'H10', claim: 'LEARNED-BREAKDOWN-LINE', subject: KNOW_SRC,
      reds: [
        `${KNOW} > LEARNED-BREAKDOWN-LINE: spells the five buckets in the curation card's own words`,
        `${KNOW} > LEARNED-BREAKDOWN-LINE: omits a zero bucket rather than printing a count nobody took`,
      ] },
    { id: 'H11', claim: 'RECONCILIATION-ONLY-ON-MISMATCH', subject: KNOW_SRC,
      reds: [
        `${KNOW} > RECONCILIATION-ONLY-ON-MISMATCH: carries NO reconciliation key when the two numbers agree`,
        `${KNOW} > RECONCILIATION-ONLY-ON-MISMATCH: a since-then row is not one of the rows shown (423 D-15)`,
      ] },
    { id: 'H12', claim: 'EXCLUSION-FROM-HANDOFF', subject: OP_SRC,
      reds: [`${OP} > EXCLUSION-FROM-HANDOFF > folds the fact from the two durable markers and from nothing else`] },
    { id: 'H13', claim: 'STAGE-TIMING-LINE-DURABLE-START', subject: VIEW_SRC,
      reds: [`${VIEW} > STAGE-TIMING-LINE-DURABLE-START: a settled row whose claim was released still says how long the stage took`] },
  ],
})
NODE
