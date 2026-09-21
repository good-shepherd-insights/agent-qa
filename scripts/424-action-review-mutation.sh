#!/usr/bin/env bash
# Focused negative controls for the Plan36 browser-discovered review defects.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))
const helper = 'src/lib/__tests__/frame-annotation.test.ts'
const browser = 'src/__tests__/conformance/424-suite-player-dom.test.ts'
const review = cell('helper', helper, 'VIDEO-ACTION-REVIEW uses measured midpoint and bounded labelled cue without changing execution facts')
const controls = [
  cell('helper', helper, 'FRAME-ANNOTATION preserves all recorded geometry forms and failure bounds'),
  cell('helper', helper, 'VIDEO-ANNOTATION-BOUNDARIES refuses legacy, invalid, mismatched and outside-interval overlays'),
]
runGate({ slug: '424-action-review-mutation', envPrefix: 'AGENT_QA_424_ACTION_REVIEW_MUTATION', idPrefix: 'R',
  expectedLegs: 3, banner: 'ACTION_REVIEW_MUTATION_OK', instruments: {
    helper: { pkg: 'packages/dashboard-ui', files: [helper], typecheck: false, count: 3 },
    browser: { pkg: 'packages/cli', files: [browser], typecheck: false, count: 4, env: { VITEST_MAX_WORKERS: '1' } },
  }, legs: [
    { subject: 'packages/dashboard-ui/src/lib/frame-annotation.ts', instrument: 'helper', claim: 'measured action seek',
      operation: 'replace measured midpoint with legacy completion',
      edits: [{ from: '? (witness.startMs + witness.endMs) / 2 : sub.recordingOffsetMs', to: '? sub.recordingOffsetMs : sub.recordingOffsetMs' }],
      reds: [review], greens: controls, allowed: [] },
    { subject: 'packages/dashboard-ui/src/lib/frame-annotation.ts', instrument: 'helper', claim: 'perceptible bounded review cue',
      operation: 'remove post-action review cue duration', edits: [{ from: 'witness.endMs + 350', to: 'witness.endMs + 0' }],
      reds: [review], greens: controls, allowed: [] },
    { subject: 'packages/dashboard-ui/src/components/run-detail/timeline.tsx', instrument: 'browser', claim: 'dense marker click preserves action ownership',
      operation: 'let portal pointerdown bubble into the rail scrub handler',
      crossing: { pkg: '@vostride/agent-qa-dashboard-ui', dir: 'packages/dashboard-ui', marker: 'review424bubble', reference: "join(PACKAGES_ROOT, 'dashboard-ui', 'dist')" },
      edits: [{ from: "aria-label='Nearby actions'\n              onPointerDown={event => event.stopPropagation()}", to: "aria-label='Nearby actions' data-review424bubble='review424bubble'" }],
      reds: [cell('browser', browser, 'SUITE-BROWSER-ANNOTATION: new recorded intervals align in normal, zoom and fullscreen')],
      greens: [cell('browser', browser, 'SUITE-BROWSER-ORDER: arrows cross steps and members in both directions with one boxed action'),
        cell('browser', browser, 'SUITE-BROWSER-MEDIA: real progress, marker details, local seeks and continued rate')], allowed: [] },
  ],
})
NODE
