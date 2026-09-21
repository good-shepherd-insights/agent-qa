#!/usr/bin/env bash
# Plan38: retain pointer ownership through recording transitions and clean display only.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))
const browser = 'src/__tests__/conformance/424-suite-player-dom.test.ts'
const grounding = 'src/components/__tests__/tab-overview.empty-state.test.tsx'
const browserCell = name => cell('browser', browser, name)
runGate({ slug: '424-suite-drag-mutation', envPrefix: 'AGENT_QA_424_SUITE_DRAG_MUTATION', idPrefix: 'D',
  expectedLegs: 2, banner: 'SUITE_DRAG_MUTATION_OK', instruments: {
    browser: { pkg: 'packages/cli', files: [browser], typecheck: false, count: 4, env: { VITEST_MAX_WORKERS: '1' } },
    grounding: { pkg: 'packages/dashboard-ui', files: [grounding], typecheck: false, count: 7 },
  }, legs: [
    { subject: 'packages/dashboard-ui/src/components/run-detail/player.tsx', instrument: 'browser',
      claim: 'one captured drag survives media member changes', operation: 'key the shared footer by member, replacing its pointer owner',
      crossing: { pkg: '@vostride/agent-qa-dashboard-ui', dir: 'packages/dashboard-ui', marker: 'drag424replaced', reference: "join(PACKAGES_ROOT, 'dashboard-ui', 'dist')" },
      edits: [{ from: '<PlayerFooter timeline={props.timeline}', to: '<PlayerFooter key={`drag424replaced:${model.testIndex}`} timeline={props.timeline}' }],
      reds: ['SUITE-BROWSER-MEDIA: real progress, marker details, local seeks and continued rate',
        'SUITE-BROWSER-GAPS: dense actions remain individually reachable and missing recordings stop continuation'].map(browserCell),
      greens: ['SUITE-BROWSER-ORDER: arrows cross steps and members in both directions with one boxed action',
        'SUITE-BROWSER-ANNOTATION: new recorded intervals align in normal, magnifier and fullscreen'].map(browserCell), allowed: [] },
    { subject: 'packages/dashboard-ui/src/components/run-detail/tab-overview.tsx', instrument: 'grounding',
      claim: 'grounding cleans captured glyphs at display without losing masking or real text', operation: 'render the raw descriptor name',
      edits: [{ from: 'name === undefined ? undefined : displayTargetName(name)', to: 'name' }],
      reds: [cell('grounding', grounding, 'TabOverview screenshot states cleans icon glyphs from grounding display without changing Unicode or stored evidence')],
      greens: [cell('grounding', grounding, 'TabOverview screenshot states refuses without requesting when the ref says the evidence is incomplete')], allowed: [] },
  ],
})
NODE
