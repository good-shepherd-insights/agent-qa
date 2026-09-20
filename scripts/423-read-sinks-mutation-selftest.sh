#!/usr/bin/env bash
# The read-sinks instrument's own test (423-23). Every declared leg is run NEUTERED — the mutation
# withheld, so no bundle or server is rebuilt — and must FATAL with "<leg>: suite stayed green"
# after an actual green child of its own built-page or HTTP suite. The interruption modes (fatal,
# SIGINT, SIGTERM, SIGHUP) must mutate every subject and hand back the exact bytes and mtimes, then
# rebuild the workspace so no dist is left built from mutated source; a dirty subject must be
# refused and left as found; invalid knobs refuse before ownership.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A leg silently dropped, re-aimed or renamed in
# 423-read-sinks-mutation.sh reddens HERE instead of shrinking both in step.
#
# Runs in place on the real tree. Slow; a phase gate, not a per-commit sample.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const UI = '@vostride/agent-qa-dashboard-ui'
const DRAWER = 'packages/dashboard-ui/src/components/run-detail/artifact-attribute-rows.tsx'
const ROUTES = 'packages/dashboard-server/src/run-service/run-detail-routes.ts'
const VIEW = 'packages/dashboard-ui/src/lib/knowledge-view.ts'
const SINKS = 'src/__tests__/conformance/423-read-sinks.test.ts'
const NO_CHAT = `${SINKS} > NO-CHAT-TARGET`

runSelftest({
  slug: '423-read-sinks-mutation',
  gateScript: 'scripts/423-read-sinks-mutation.sh',
  envPrefix: 'AGENT_QA_423_READ_SINKS_MUTATION',
  idPrefix: 'S',
  banner: 'READ_SINKS_MUTATION_OK',
  registration: {
    'validate:423-read-sinks-mutation': 'bash scripts/423-read-sinks-mutation.sh',
    'validate:423-read-sinks-mutation-selftest': 'bash scripts/423-read-sinks-mutation-selftest.sh',
  },
  expected: [
    { id: 'S01', claim: 'SINK-CLIPBOARD', subject: DRAWER, crossing: UI, reds: [`${SINKS} > SINK-CLIPBOARD`] },
    { id: 'S02', claim: 'SINK-TITLE', subject: 'packages/dashboard-ui/src/pages/run-detail.tsx', crossing: UI, reds: [`${SINKS} > SINK-TITLE`] },
    { id: 'S03', claim: 'SINK-DOM', subject: DRAWER, crossing: UI, reds: [`${SINKS} > SINK-DOM`] },
    { id: 'S04', claim: 'C423-HUMAN-DETAIL-SANITIZED', subject: ROUTES, crossing: '@vostride/agent-qa-dashboard',
      reds: [`${SINKS} > C423-HUMAN-DETAIL-SANITIZED: T-405-38 restores then sanitizes durable HTTP output`] },
    { id: 'S05', claim: 'HTTP-EVIDENCE-HUMAN', subject: ROUTES, crossing: '@vostride/agent-qa-dashboard',
      reds: [`${SINKS} > HTTP-EVIDENCE-HUMAN`] },
    { id: 'S06', claim: 'NO-CHAT-TARGET', subject: 'packages/dashboard-ui/src/components/run-detail/verdict-block.tsx', crossing: UI, reds: [NO_CHAT] },
    { id: 'S07', claim: 'NO-CHAT-TARGET', subject: 'packages/dashboard-ui/src/components/run-detail/step-tree-item.tsx', crossing: UI, reds: [NO_CHAT] },
    { id: 'S08', claim: 'NO-CHAT-TARGET', subject: 'packages/dashboard-ui/src/components/run-detail/knowledge-learned.tsx', crossing: UI, reds: [NO_CHAT] },
    { id: 'S09', claim: 'FAILED-CHAIN-ROWS-RETAINED', subject: VIEW, reds: [
      'src/components/run-detail/__tests__/knowledge-learned.test.tsx > FAILED-CHAIN-ROWS-RETAINED',
      'src/components/run-detail/__tests__/tab-knowledge.test.tsx > FAILED-CHAIN-ROWS-RETAINED'] },
    { id: 'S10', claim: 'FAILED-CHAIN-ROWS-RETAINED', subject: VIEW, crossing: UI,
      reds: ['src/__tests__/conformance/knowledge-tab-dom.test.ts > (c4)'] },
  ],
})
NODE
