#!/usr/bin/env bash
# The feedback-read instrument's own test (423-23). Every declared leg is run NEUTERED — the
# mutation withheld — and must FATAL with "<leg>: suite stayed green" after an actual green child of
# its own suite, including the counted `.test-d.ts` walls of F07-F09. The interruption modes (fatal,
# SIGINT, SIGTERM, SIGHUP) must mutate every subject and hand back the exact bytes and mtimes, then
# rebuild; a dirty subject must be refused and left as found; invalid knobs refuse before ownership.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A leg silently dropped, re-aimed or renamed in
# 423-feedback-read-mutation.sh reddens HERE instead of shrinking both in step.
#
# Runs in place on the real tree. Slow; a phase gate, not a per-commit sample.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const HOST = 'packages/cli/src/gates/feedback-read-host.ts'
const PLAN = 'packages/cli/src/gates/feedback-plan.ts'
const FEEDBACK = 'packages/schema/src/functions/feedback.ts'
const READS = 'src/__tests__/423-feedback-reads.test.ts'
const RESULTS = 'src/__tests__/423-feedback-contracts.test.ts > C423-FEEDBACK-RESULTS-EXACT'
const RESULTS_D = 'src/__tests__/423-feedback-contracts.test-d.ts > C423-FEEDBACK-RESULTS-EXACT'
const PORTS_D = 'src/functions/__tests__/port-split.test-d.ts > C423-FEEDBACK-BINDINGS-EXACT'

runSelftest({
  slug: '423-feedback-read-mutation',
  gateScript: 'scripts/423-feedback-read-mutation.sh',
  envPrefix: 'AGENT_QA_423_FEEDBACK_READ_MUTATION',
  idPrefix: 'F',
  banner: 'FEEDBACK_READ_MUTATION_OK',
  registration: {
    'validate:423-feedback-read-mutation': 'bash scripts/423-feedback-read-mutation.sh',
    'validate:423-feedback-read-mutation-selftest': 'bash scripts/423-feedback-read-mutation-selftest.sh',
  },
  expected: [
    { id: 'F01', claim: 'PREVIEW-WRITES-NOTHING', subject: HOST, reds: [`${READS} > PREVIEW-WRITES-NOTHING`] },
    { id: 'F02', claim: 'HISTORY-WRITES-NOTHING', subject: HOST, reds: [`${READS} > HISTORY-WRITES-NOTHING`] },
    { id: 'F03', claim: 'NOTE-ONLY-REPEAT', subject: PLAN, reds: [`${READS} > NOTE-ONLY-REPEAT`] },
    { id: 'F04', claim: 'QUARANTINE-ORDER', subject: PLAN, reds: [`${READS} > QUARANTINE-ORDER`] },
    { id: 'F05', claim: 'CORRELATED-EVIDENCE', subject: PLAN, reds: [`${READS} > CORRELATED-EVIDENCE`] },
    { id: 'F06', claim: 'CORRELATED-EVIDENCE', subject: 'packages/knowledge-local/src/feedback/mark-evidence-plan.ts',
      reds: ['src/feedback/__tests__/423-mark-evidence-plan.test.ts > CORRELATED-EVIDENCE'] },
    { id: 'F07', claim: 'C423-FEEDBACK-RESULTS-EXACT', subject: FEEDBACK,
      reds: [`${RESULTS} > pins the marks-history outcome arms: runtime list, schema arms and parser`,
        `${RESULTS_D} > pins the four marks-history outcome arms in both directions`] },
    { id: 'F08', claim: 'C423-FEEDBACK-RESULTS-EXACT', subject: FEEDBACK,
      reds: [`${RESULTS} > pins the preview outcome arms: runtime list, schema arms and parser`,
        `${RESULTS_D} > pins the eight preview outcome arms in both directions`] },
    { id: 'F09', claim: 'C423-FEEDBACK-BINDINGS-EXACT', subject: 'packages/agent/src/functions/spec.ts',
      reds: [
        'src/functions/__tests__/optional-dep-keys.test.ts > C423-FEEDBACK-BINDINGS-EXACT > pins the runtime roster exactly, with no missing, extra or repeated binding',
        `${PORTS_D} > pins the optional dep key union and its runtime roster in both directions`,
        `${PORTS_D} > binds the feedback writer and the read-only feedback observations as two optional deps`,
      ] },
  ],
})
NODE
