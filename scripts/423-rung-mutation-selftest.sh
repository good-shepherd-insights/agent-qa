#!/usr/bin/env bash
# The retrieval-rung instrument's own test (423-23). Every declared leg is run NEUTERED — the
# mutation withheld — and must FATAL with "<leg>: suite stayed green" after an actual green child of
# its own suite, including the counted `.test-d.ts` walls of R07 and R08. The interruption modes
# (fatal, SIGINT, SIGTERM, SIGHUP) must mutate every subject and hand back the exact bytes and
# mtimes, then rebuild; a dirty subject must be refused and left as found; invalid knobs refuse
# before ownership.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A leg silently dropped, re-aimed or renamed in
# 423-rung-mutation.sh reddens HERE instead of shrinking both in step.
#
# Runs in place on the real tree. Slow; a phase gate, not a per-commit sample.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const FOLD = 'packages/knowledge-local/src/retrieval-rung.ts'
const VOCAB = 'packages/schema/src/brief/retrieval-rung.ts'
const KL = 'src/__tests__/423-retrieval-rung.test.ts'
const SR = 'src/__tests__/423-rung-contracts.test.ts > C423-RUNG-REASONS-EXACT'
const SR_D = 'src/__tests__/423-rung-contracts.test-d.ts > C423-RUNG-REASONS-EXACT'

runSelftest({
  slug: '423-rung-mutation',
  gateScript: 'scripts/423-rung-mutation.sh',
  envPrefix: 'AGENT_QA_423_RUNG_MUTATION',
  idPrefix: 'R',
  banner: 'RUNG_MUTATION_OK',
  registration: {
    'validate:423-rung-mutation': 'bash scripts/423-rung-mutation.sh',
    'validate:423-rung-mutation-selftest': 'bash scripts/423-rung-mutation-selftest.sh',
  },
  expected: [
    { id: 'R01', claim: 'RUNG-ABSENT', subject: FOLD, reds: [
      `${KL} > RUNG-ABSENT > folds an absent index to bundle-scan/index-not-built under every embedder`,
      `${KL} > RUNG-ABSENT > records index-not-built for a fresh store with no index file on disk`] },
    { id: 'R02', claim: 'RUNG-LOCKED', subject: FOLD, reds: [
      `${KL} > RUNG-LOCKED > folds a locked index to bundle-scan/index-locked under every embedder`,
      `${KL} > RUNG-LOCKED > records index-locked while another connection holds an exclusive lock`] },
    { id: 'R03', claim: 'RUNG-CORRUPT', subject: FOLD, reds: [
      `${KL} > RUNG-CORRUPT > folds a corrupt index to bundle-scan/index-corrupt under every embedder`,
      `${KL} > RUNG-CORRUPT > records index-corrupt for an index file holding garbage bytes`] },
    { id: 'R04', claim: 'RUNG-SCHEMA', subject: FOLD, reds: [
      `${KL} > RUNG-SCHEMA > folds a schema-version mismatch to the same index-corrupt cause`,
      `${KL} > RUNG-SCHEMA > records index-corrupt for a built index whose schema version is missing`] },
    { id: 'R05', claim: 'LEGACY-HISTORICAL', subject: FOLD, reds: [
      `${KL} > LEGACY-HISTORICAL > never mints the historical index-unavailable word or the v1 stamp`] },
    { id: 'R06', claim: 'LEGACY-HISTORICAL', subject: 'packages/schema/src/run/bus-projections.ts', reds: [
      'src/__tests__/423-rung-contracts.test.ts > LEGACY-HISTORICAL > a v1 index-unavailable is never upgraded, reinterpreted or re-versioned by a read'] },
    { id: 'R07', claim: 'C423-RUNG-REASONS-EXACT', subject: VOCAB, reds: [
      `${SR} > pins eleven current reasons, in order, against an independent list`,
      `${SR_D} > pins eleven current reasons in both directions through public exports`] },
    { id: 'R08', claim: 'C423-RUNG-REASONS-EXACT', subject: VOCAB, reds: [
      `${SR} > the historical v1 arm admits exactly the eight pre-423 reasons`,
      `${SR_D} > pins the historical v1 arm to exactly the eight pre-423 reasons`] },
    { id: 'R09', claim: 'RUNG-LABEL-PARITY', subject: 'packages/cli/src/commands/doctor-knowledge-checks.ts', reds: [
      'src/__tests__/rung-label-parity.test.ts > RUNG-LABEL-PARITY > pins each index cause to the same exact bytes on both doors'] },
  ],
})
NODE
