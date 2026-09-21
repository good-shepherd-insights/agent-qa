#!/usr/bin/env bash
# Plan39: measure the assembled clock wire and shared endpoint coordinates.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))
const browser = 'src/__tests__/conformance/424-suite-player-dom.test.ts'
const named = name => cell('browser', browser, name)
const order = 'SUITE-BROWSER-ORDER: arrows cross steps and members in both directions with one boxed action'
const annotation = 'SUITE-BROWSER-ANNOTATION: new recorded intervals align in normal, magnifier and fullscreen'
const media = 'SUITE-BROWSER-MEDIA: real progress, marker details, local seeks and continued rate'
const gaps = 'SUITE-BROWSER-GAPS: dense actions remain individually reachable and missing recordings stop continuation'
const crossing = marker => ({ pkg: '@vostride/agent-qa-dashboard-ui', dir: 'packages/dashboard-ui', marker, reference: "join(PACKAGES_ROOT, 'dashboard-ui', 'dist')" })
runGate({ slug: '424-suite-clock-mutation', envPrefix: 'AGENT_QA_424_SUITE_CLOCK_MUTATION', idPrefix: 'C',
  expectedLegs: 2, banner: 'SUITE_CLOCK_MUTATION_OK', instruments: {
    browser: { pkg: 'packages/cli', files: [browser], typecheck: false, count: 4, env: { VITEST_MAX_WORKERS: '1' } },
  }, legs: [
    { subject: 'packages/dashboard-ui/src/components/run-detail/tab-overview.tsx', instrument: 'browser',
      claim: 'visible suite clock reaches the actual Player', operation: 'drop measured suite context and fall back to local recording time',
      crossing: crossing('clock424local'),
      edits: [{ from: '<div data-overview>', to: '<div data-overview data-clock424local="clock424local">' },
        { from: 'clock={clock}', to: 'clock={undefined}' }],
      reds: [media, gaps].map(named), greens: [order, annotation].map(named), allowed: [] },
    { subject: 'packages/dashboard-ui/src/components/run-detail/timeline.tsx', instrument: 'browser',
      claim: 'endpoint circles share the slider coordinate', operation: 'independently clamp marker centers away from the endpoints',
      crossing: crossing('clock424clamp'),
      edits: [{ from: 'data-timeline-track className=', to: 'data-timeline-track data-clock424clamp="clock424clamp" className=' },
        { from: 'const style = { left: `${marker.position * 100}%` }', to: 'const style = { left: `clamp(14px, ${marker.position * 100}%, calc(100% - 14px))` }' }],
      reds: [media].map(named), greens: [order, annotation, gaps].map(named), allowed: [] },
  ],
})
NODE
