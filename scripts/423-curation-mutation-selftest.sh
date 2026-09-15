#!/usr/bin/env bash
# The curation instrument's own test (423-23). Every declared leg is run NEUTERED — the mutation
# withheld — and must FATAL with "<leg>: suite stayed green" after an actual green child of its own
# suite. The interruption modes (fatal, SIGINT, SIGTERM, SIGHUP) must mutate every subject and hand
# back the exact bytes and mtimes, then rebuild; a dirty subject must be refused and left as found;
# invalid knobs refuse before ownership.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A leg silently dropped, re-aimed or renamed in
# 423-curation-mutation.sh reddens HERE instead of shrinking both in step.
#
# Runs in place on the real tree. Slow; a phase gate, not a per-commit sample.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const SNAP = 'packages/schema/src/notification/curation-snapshot.ts'
const FOLD = 'packages/knowledge-local/src/curator/curation-snapshot.ts'
const CUR = 'src/__tests__/423-curation-contracts.test.ts'
const CUR_D = 'src/__tests__/423-curation-contracts.test-d.ts'
const STG = 'src/__tests__/423-stage-contracts.test.ts'
const STG_D = 'src/__tests__/423-stage-contracts.test-d.ts'
const SNAPSHOT = 'src/__tests__/423-curation-snapshot.test.ts'
const RECOVERY = 'src/__tests__/423-curation-recovery.test.ts'
const COLD_T = 'src/composition/__tests__/cold-read-masking.test.ts'

runSelftest({
  slug: '423-curation-mutation',
  gateScript: 'scripts/423-curation-mutation.sh',
  envPrefix: 'AGENT_QA_423_CURATION_MUTATION',
  idPrefix: 'C',
  banner: 'CURATION_MUTATION_OK',
  registration: {
    'validate:423-curation-mutation': 'bash scripts/423-curation-mutation.sh',
    'validate:423-curation-mutation-selftest': 'bash scripts/423-curation-mutation-selftest.sh',
  },
  expected: [
    { id: 'C01', claim: 'C423-BUCKETS-EXACT', subject: SNAP,
      reds: [`${CUR} > C423-BUCKETS-EXACT`, `${CUR_D} > C423-BUCKETS-EXACT`] },
    { id: 'C02', claim: 'C423-STAGES-EXACT', subject: 'packages/schema/src/notification/post-processing-status.ts',
      reds: [
        `${STG} > C423-STAGES-EXACT > pins the public detail list and schema to independent exact vocabularies`,
        `${STG} > C423-STAGES-EXACT > accepts the hand-spelled three detail stages and rejects a fourth`,
        `${STG_D} > C423-STAGES-EXACT > pins three detail stages in both directions through public exports`,
        `${STG_D} > C423-STAGES-EXACT > refuses a fourth stage and third chip at the type boundary`,
      ] },
    { id: 'C03', claim: 'STRONGEST-ONCE', subject: SNAP,
      reds: [`${CUR} > STRONGEST-ONCE: every stronger historical bucket wins regardless of ordering`] },
    { id: 'C04', claim: 'REPLACEMENT-NOT-ADDED', subject: SNAP,
      reds: [
        `${CUR} > REPLACEMENT-NOT-ADDED: victim represents replacement Add identity without a second membership`,
        `${CUR} > REPLACEMENT-NOT-ADDED: historical replacements remain suppressed after a later supersession`,
      ] },
    { id: 'C05', claim: 'SNAPSHOT-DISCRIMINANTS', subject: SNAP,
      reds: [`${CUR} > SNAPSHOT-DISCRIMINANTS`, `${CUR_D} > STRONGEST-ONCE: rows retain historical changes with exact bucket discriminants`] },
    { id: 'C06', claim: 'DOWNGRADE-ORIGIN', subject: FOLD,
      reds: [`${SNAPSHOT} > DOWNGRADE-ORIGIN (x4)`] },
    { id: 'C07', claim: 'CRASH-BEFORE-OUTER-CHECKPOINT', subject: 'packages/knowledge-local/src/curator/commit.ts',
      reds: [`${RECOVERY} > CRASH-BEFORE-OUTER-CHECKPOINT`] },
    { id: 'C08', claim: 'STRONGEST-ONCE', subject: FOLD,
      reds: [`${SNAPSHOT} > STRONGEST-ONCE`] },
    { id: 'C09', claim: 'EFFECT-RECEIPT-ROUNDTRIP', subject: 'packages/knowledge-local/src/journal/curation-effect-receipt.ts',
      reds: [`${RECOVERY} > EFFECT-RECEIPT-ROUNDTRIP`] },
    { id: 'C10', claim: 'SNAPSHOT-STABLE', subject: 'packages/agent/src/functions/ops/runs-knowledge.ts',
      reds: ['src/functions/__tests__/runs-knowledge.test.ts > SNAPSHOT-STABLE'] },
    { id: 'C11', claim: 'NOTIFICATION-COPY', subject: 'packages/agent/src/jobs/chain-identity.ts',
      reds: ['src/jobs/__tests__/chain-identity.test.ts > NOTIFICATION-COPY: direct completed curation detaches the authoritative snapshot'] },
    { id: 'C12', claim: 'C423-WITHHELD-EXACT', subject: 'packages/schema/src/notification/post-processing-status.ts',
      reds: [
        `${STG} > C423-WITHHELD-EXACT > pins the withheld reasons to an independent exact list through both barrels`,
        `${STG} > C423-WITHHELD-EXACT > accepts each hand-spelled reason and rejects a third reason or an extra key`,
        `${STG} > C423-WITHHELD-EXACT > parses a served snapshot alone and a withheld flag alone on the public result`,
        `${STG_D} > C423-WITHHELD-EXACT > pins exactly two withheld reasons in both directions through both barrels`,
        `${STG_D} > C423-WITHHELD-EXACT > refuses a third withheld reason at the type boundary`,
      ] },
    { id: 'C13', claim: 'POSTPROCESSING-SNAPSHOT-WITHHELD', subject: 'packages/agent/src/functions/ops/runs-post-processing.ts',
      reds: ['src/functions/__tests__/runs-post-processing.test.ts > POSTPROCESSING-SNAPSHOT-WITHHELD'] },
    { id: 'C14', claim: 'COLD-AUTH-SKIPPED', subject: 'packages/cli/src/composition/local-agent-host.ts',
      reds: [
        `${COLD_T} > COLD-AUTH-SKIPPED missing`,
        `${COLD_T} > COLD-AUTH-SKIPPED capture-missing`,
        `${COLD_T} > COLD-AUTH-SKIPPED coexisting`,
      ] },
  ],
})
NODE
