#!/usr/bin/env bash
# The evidence instrument's own test (423-22). A gate nobody has seen fire is a comment, so every
# declared leg is run NEUTERED — the mutation withheld — and must FATAL with "<leg>: suite stayed
# green" after an actual green child of its own suite. The interruption modes (fatal, SIGINT,
# SIGTERM, SIGHUP) must mutate every subject and hand back the exact bytes and mtimes, then rebuild;
# a dirty subject must be refused and left as found; invalid knobs refuse before ownership.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A total read off the instrument agrees with the
# instrument however it changes; a leg silently dropped, re-aimed or renamed in
# 423-evidence-mutation.sh reddens HERE instead of shrinking both in step.
#
# Runs in place on the real tree. Slow (every leg runs its suite twice); a phase gate, not a
# per-commit sample.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const RT = 'src/__tests__/423-read-contracts.test.ts'
const TD = 'src/__tests__/423-read-contracts.test-d.ts'
const EVIDENCE = 'packages/schema/src/run/evidence.ts'

runSelftest({
  slug: '423-evidence-mutation',
  gateScript: 'scripts/423-evidence-mutation.sh',
  envPrefix: 'AGENT_QA_423_EVIDENCE_MUTATION',
  idPrefix: 'E',
  banner: 'EVIDENCE_MUTATION_OK',
  registration: {
    'validate:423-evidence-mutation': 'bash scripts/423-evidence-mutation.sh',
    'validate:423-evidence-mutation-selftest': 'bash scripts/423-evidence-mutation-selftest.sh',
  },
  expected: [
    { id: 'E01', claim: 'C423-KINDS-EXACT', subject: EVIDENCE,
      reds: [`${RT} > C423-KINDS-EXACT`, `${TD} > C423-KINDS-EXACT`] },
    { id: 'E02', claim: 'C423-ABSENCE-EXACT', subject: EVIDENCE,
      reds: [`${RT} > C423-ABSENCE-EXACT`, `${TD} > C423-ABSENCE-EXACT`] },
    { id: 'E03', claim: 'C423-REFS-EXACT', subject: 'packages/schema/src/ids/artifact-ref.ts',
      reds: [`${RT} > C423-REFS-EXACT`, `${TD} > C423-REFS-EXACT`] },
    { id: 'E04', claim: 'C423-PRESENCE-EXACT', subject: EVIDENCE,
      reds: [`${RT} > C423-PRESENCE-EXACT rejects absent counts while valid absence parses`, `${TD} > C423-PRESENCE-EXACT`] },
    { id: 'E05', claim: 'C423-HEADERS-EXACT', subject: EVIDENCE,
      reds: [`${RT} > C423-HEADERS-EXACT`, `${TD} > C423-HEADERS-EXACT`] },
    { id: 'E06', claim: 'C423-CONTENT-TYPES-EXACT', subject: EVIDENCE,
      reds: [`${RT} > C423-CONTENT-TYPES-EXACT`, `${TD} > C423-CONTENT-TYPES-EXACT`] },
    { id: 'E07', claim: 'EVID-WEB-PRESENT', subject: 'packages/runner/src/run/step-read-finalization.ts',
      reds: ['src/run/__tests__/423-read-finalization.test.ts > EVID-WEB-PRESENT'] },
    { id: 'E08', claim: 'ARIA-LIVE-MASK', subject: 'packages/runner/src/loop/evidence.ts',
      reds: ['src/loop/__tests__/423-aria-evidence.test.ts > ARIA-LIVE-MASK'] },
    { id: 'E09', claim: 'BODY-BYTES', subject: 'packages/runner/src/run/network-evidence-policy.ts',
      reds: ['src/run/__tests__/423-network-policy.test.ts > BODY-BYTES'] },
    { id: 'E10', claim: 'EVID-MISSING-BLOB', subject: 'packages/agent/src/functions/ops/runs-evidence.ts',
      reds: ['src/functions/__tests__/423-runs-evidence.test.ts > EVID-MISSING-BLOB'] },
    { id: 'E11', claim: 'CONCURRENT-BLOB', subject: 'packages/runner-local/src/evidence-artifact-store.ts',
      reds: ['src/__tests__/423-json-evidence.test.ts > CONCURRENT-BLOB'] },
    { id: 'E12', claim: 'COLD-EVIDENCE-HOST', subject: 'packages/agent-local/src/composition/compose-local-agent.ts',
      reds: ['src/__tests__/423-production-read-posture.test.ts > COLD-EVIDENCE-HOST'],
      crossing: '@vostride/agent-qa-agent-local' },
    { id: 'E13', claim: 'EVIDENCE-MASK-NO-CONTEXT', subject: 'packages/agent/src/functions/ops/runs-evidence.ts',
      reds: ['src/functions/__tests__/423-runs-evidence.test.ts > EVIDENCE-MASK-NO-CONTEXT'] },
  ],
})
NODE
