#!/usr/bin/env bash
# Independent, hand-written inventory. Every withheld mutation must be refused after its actual
# green instrument; fatal/signals restore all bytes and mtimes, and dirty sources stay untouched.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const RT = 'src/__tests__/424-recording-contracts.test.ts'
const TD = 'src/__tests__/424-recording-contracts.test-d.ts'
const FAMILY_RT = 'src/__tests__/424-action-family.test.ts'
const FAMILY_TD = 'src/__tests__/424-action-family.test-d.ts'
const STORE_T = 'src/__tests__/424-recording-store.test.ts'
const DETAIL_T = 'src/functions/__tests__/424-detail-recording.test.ts'
const ARTIFACT_T = 'src/functions/__tests__/424-artifact-range.test.ts'

runSelftest({
  slug: '424-recording-mutation',
  gateScript: 'scripts/424-recording-mutation.sh',
  envPrefix: 'AGENT_QA_424_RECORDING_MUTATION',
  idPrefix: 'K', banner: 'RECORDING_MUTATION_OK',
  registration: {
    'validate:424-recording-mutation': 'bash scripts/424-recording-mutation.sh',
    'validate:424-recording-mutation-selftest': 'bash scripts/424-recording-mutation-selftest.sh',
  },
  expected: [
    { id: 'K01', claim: 'C424-RECORDING-STATES-EXACT', subject: 'packages/schema/src/run/recording.ts', reds: [`${RT} > C424-RECORDING-STATES-EXACT`, `${TD} > C424-RECORDING-STATES-EXACT`] },
    { id: 'K02', claim: 'C424-RECORDING-TYPES-EXACT', subject: 'packages/schema/src/run/recording.ts', reds: [`${RT} > C424-RECORDING-TYPES-EXACT`, `${TD} > C424-RECORDING-TYPES-EXACT`] },
    { id: 'K03', claim: 'C424-RECORDING-REF-EXACT', subject: 'packages/schema/src/run/recording.ts', reds: [`${RT} > C424-RECORDING-REF-EXACT`] },
    { id: 'K04', claim: 'C424-FAMILIES-EXACT', subject: 'packages/schema/src/action/family.ts', reds: [`${FAMILY_RT} > C424-FAMILIES-EXACT`, `${FAMILY_TD} > C424-FAMILIES-EXACT`] },
    { id: 'K05', claim: 'C424-FAMILIES-EXHAUSTIVE', subject: 'packages/schema/src/action/family.ts', reds: [`${FAMILY_RT} > C424-FAMILIES-EXHAUSTIVE`, `${FAMILY_TD} > C424-FAMILIES-EXHAUSTIVE`] },
    { id: 'K06', claim: 'REC-STORE-ZERO-LENGTH-REFUSED', subject: 'packages/runner-local/src/evidence-artifact-store.ts', reds: [`${STORE_T} > REC-STORE-ZERO-LENGTH-REFUSED`] },
    { id: 'K07', claim: 'REC-STORE-STAGING-UNLINKED', subject: 'packages/runner-local/src/evidence-artifact-store.ts', reds: [`${STORE_T} > REC-STORE-STAGING-UNLINKED`] },
    { id: 'K08', claim: 'REC-MEMBER-NOT-REQUESTED', subject: 'packages/runner/src/run/member-runner.ts', reds: ['src/run/__tests__/424-recording-member.test.ts > REC-MEMBER-NOT-REQUESTED'] },
    { id: 'K09', claim: 'REC-SHELL-SKIP-NOT-CAPTURED', subject: 'packages/runner/src/run/shell.ts', reds: ['src/run/__tests__/424-recording-shell.test.ts > REC-SHELL-SKIP-NOT-CAPTURED'] },
    { id: 'K10', claim: 'OFFSET-ABSENT-WITHOUT-ZERO', subject: 'packages/runner/src/loop/index.ts', reds: ['src/loop/__tests__/424-recording-offsets.test.ts > OFFSET-ABSENT-WITHOUT-ZERO'] },
    { id: 'K11', claim: 'MIGRATION-V1-REFUSE', subject: 'packages/dashboard-server/src/db/database.ts', reds: ['src/__tests__/424-read-migration.test.ts > MIGRATION-V1-REFUSE'] },
    { id: 'K12', claim: 'REC-SUB-UPSERT-OMISSION', subject: 'packages/dashboard-server/src/db/database.ts', reds: ['src/__tests__/424-recording-subscriber.test.ts > REC-SUB-UPSERT-OMISSION'] },
    { id: 'K13', claim: 'DETAIL-REC-NULL-UNAVAILABLE', subject: 'packages/agent/src/functions/ops/runs-detail.ts', reds: [`${DETAIL_T} > DETAIL-REC-NULL-UNAVAILABLE`] },
    { id: 'K14', claim: 'DETAIL-REC-BYTES-GONE', subject: 'packages/agent/src/functions/ops/runs-detail.ts', reds: [`${DETAIL_T} > DETAIL-REC-BYTES-GONE (x2)`] },
    { id: 'K15', claim: 'ARTIFACT-RANGE-UNSATISFIABLE', subject: 'packages/agent/src/functions/ops/runs-artifact.ts', reds: [`${ARTIFACT_T} > ARTIFACT-RANGE-UNSATISFIABLE (x2)`] },
    { id: 'K16', claim: 'SNIFF-NEVER-MARKUP', subject: 'packages/agent/src/functions/ops/runs-artifact.ts', reds: [`${ARTIFACT_T} > SNIFF-NEVER-MARKUP (x4)`] },
    { id: 'K17', claim: 'ROUTE-RANGE-HEADERS-EVERY-ARM', subject: 'packages/dashboard-server/src/run-service/run-detail-routes.ts', reds: ['src/__tests__/424-artifact-range-route.test.ts > ROUTE-RANGE-HEADERS-EVERY-ARM'] },
    { id: 'K18', claim: 'REC-DEFAULT-EXPLICIT-FALSE-OFF', subject: 'packages/cli/src/commands/recording-setting.ts', reds: ['src/__tests__/424-recording-default.test.ts > REC-DEFAULT-EXPLICIT-FALSE-OFF'] },
  ],
})
NODE
