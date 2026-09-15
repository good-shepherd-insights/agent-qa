#!/usr/bin/env bash
# The usage instrument's own test (423-22). Every declared leg is run NEUTERED — the mutation
# withheld — and must FATAL with "<leg>: suite stayed green" after an actual green child of its own
# suite, including the dist-crossing U06, whose neutered run must not rebuild or touch the schema
# dist. The interruption modes (fatal, SIGINT, SIGTERM, SIGHUP) must mutate every subject and hand
# back the exact bytes and mtimes, then rebuild; a dirty subject must be refused and left as found;
# invalid knobs refuse before ownership.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A leg silently dropped, re-aimed or renamed in
# 423-usage-mutation.sh reddens HERE instead of shrinking both in step.
#
# Runs in place on the real tree. Slow; a phase gate, not a per-commit sample.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const AUTH = 'src/__tests__/423-usage-authority.test.ts'
const AUTH_D = 'src/__tests__/423-usage-authority.test-d.ts'
const COVER = 'src/run/__tests__/423-usage-coverage.test.ts'
const REPORT = 'packages/model/src/provider-call-report.ts'
const SCOPE = 'packages/runner/src/run/step-model-observations.ts'
const USAGE = 'packages/schema/src/run/model-usage.ts'

runSelftest({
  slug: '423-usage-mutation',
  gateScript: 'scripts/423-usage-mutation.sh',
  envPrefix: 'AGENT_QA_423_USAGE_MUTATION',
  idPrefix: 'U',
  banner: 'USAGE_MUTATION_OK',
  registration: {
    'validate:423-usage-mutation': 'bash scripts/423-usage-mutation.sh',
    'validate:423-usage-mutation-selftest': 'bash scripts/423-usage-mutation-selftest.sh',
  },
  expected: [
    { id: 'U01', claim: 'USAGE-RAW-ABSENT', subject: REPORT,
      reds: [`${AUTH} > USAGE-RAW-ABSENT (x5)`] },
    { id: 'U02', claim: 'MODEL-SDK-FALLBACK', subject: 'packages/model/src/registry.ts',
      reds: [`${AUTH} > MODEL-SDK-FALLBACK never fills absent provider-result identity (x5)`] },
    { id: 'U03', claim: 'USAGE-EXTRACTION', subject: 'packages/runner/src/run/member-runner.ts',
      reds: [`${COVER} > USAGE-EXTRACTION: post-loop capture reaches final facts and replaces legacy loop totals once`] },
    { id: 'U04', claim: 'USAGE-RETRY-FAILURE', subject: SCOPE,
      reds: [`${COVER} > USAGE-RETRY-FAILURE`] },
    { id: 'U05', claim: 'USAGE-CONCURRENT', subject: SCOPE,
      reds: [`${COVER} > USAGE-CONCURRENT`] },
    { id: 'U06', claim: 'USAGE-NO-DOUBLE-COUNT', subject: USAGE, crossing: '@vostride/agent-qa-schema',
      reds: ['src/__tests__/423-read-migration.test.ts > USAGE-NO-DOUBLE-COUNT'] },
    { id: 'U07', claim: 'C423-MODEL-ROLES-EXACT', subject: USAGE,
      reds: ['src/__tests__/423-model-usage.test.ts > C423-MODEL-ROLES-EXACT', 'src/__tests__/423-model-usage.test-d.ts > C423-MODEL-ROLES-EXACT'] },
    { id: 'U08', claim: 'C423-OBSERVATION-EXACT', subject: REPORT,
      reds: [
        `${AUTH} > C423-OBSERVATION-EXACT independently pins event and trusted-origin lists`,
        `${AUTH_D} > C423-OBSERVATION-EXACT event discriminants are exactly start/success/failure`,
        `${AUTH_D} > C423-OBSERVATION-EXACT exhaustive event never-bar`,
      ] },
    { id: 'U09', claim: 'INPUT-SAMPLE-POPULATION', subject: USAGE,
      reds: ['src/__tests__/423-model-usage.test.ts > INPUT-SAMPLE-POPULATION: inclusive totals count each attempt once without adding cache reads'] },
  ],
})
NODE
