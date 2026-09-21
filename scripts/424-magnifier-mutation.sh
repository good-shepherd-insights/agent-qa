#!/usr/bin/env bash
# Plan37: retain real pixels and matching annotations in the shared lens.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))
const unit = 'src/components/run-detail/__tests__/media-viewport.test.tsx'
const browser = 'src/__tests__/conformance/424-suite-player-dom.test.ts'
runGate({ slug: '424-magnifier-mutation', envPrefix: 'AGENT_QA_424_MAGNIFIER_MUTATION', idPrefix: 'L',
  expectedLegs: 2, banner: 'MAGNIFIER_MUTATION_OK', instruments: {
    unit: { pkg: 'packages/dashboard-ui', files: [unit], typecheck: false, count: 2 },
    browser: { pkg: 'packages/cli', files: [browser], typecheck: false, count: 4, env: { VITEST_MAX_WORKERS: '1' } },
  }, legs: [
    { subject: 'packages/dashboard-ui/src/components/media-viewport.tsx', instrument: 'unit', claim: 'lens paints existing media',
      operation: 'remove the actual-media draw',
      edits: [{ from: '        context.drawImage(source, imageX, imageY, w * zoom, h * zoom)\n', to: '' }],
      reds: [cell('unit', unit, 'MEDIA-LENS-LIFECYCLE draws the same media and bounds redraw to active pixels')],
      greens: [cell('unit', unit, 'MEDIA-VIEWPORT-RESIZE: media and overlay share contain geometry, fullscreen and observer cleanup')], allowed: [] },
    { subject: 'packages/dashboard-ui/src/components/media-viewport.tsx', instrument: 'browser', claim: 'lens shares annotation geometry',
      operation: 'omit the annotation layer from the lens alone',
      crossing: { pkg: '@vostride/agent-qa-dashboard-ui', dir: 'packages/dashboard-ui', marker: 'lens424missing', reference: "join(PACKAGES_ROOT, 'dashboard-ui', 'dist')" },
      edits: [{ from: 'data-media-viewport className=', to: 'data-media-viewport data-lens424missing="lens424missing" className=' },
        { from: '{annotation && <div data-lens-annotation', to: '{false && annotation && <div data-lens-annotation' }],
      reds: [cell('browser', browser, 'SUITE-BROWSER-ANNOTATION: new recorded intervals align in normal, magnifier and fullscreen')],
      greens: ['SUITE-BROWSER-ORDER: arrows cross steps and members in both directions with one boxed action',
        'SUITE-BROWSER-MEDIA: real progress, marker details, local seeks and continued rate',
        'SUITE-BROWSER-GAPS: dense actions remain individually reachable and missing recordings stop continuation'].map(name => cell('browser', browser, name)),
      allowed: [] },
  ],
})
NODE
