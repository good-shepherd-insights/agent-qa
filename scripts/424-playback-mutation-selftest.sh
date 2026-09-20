#!/usr/bin/env bash
# Independent written inventory: never derive the expected legs from the gate.
# Neutered legs must fail after a real green child; interruptions restore all bytes and mtimes.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

runSelftest({
  slug: '424-playback-mutation',
  gateScript: 'scripts/424-playback-mutation.sh',
  envPrefix: 'AGENT_QA_424_PLAYBACK_MUTATION',
  idPrefix: 'P', banner: 'PLAYBACK_MUTATION_OK',
  registration: {
    'validate:424-playback-mutation': 'bash scripts/424-playback-mutation.sh',
    'validate:424-playback-mutation-selftest': 'bash scripts/424-playback-mutation-selftest.sh',
  },
  expected: [
    { id: 'P01', claim: 'PLAYHEAD-PARENT-PARKS-LATEST-FRAME', subject: 'packages/dashboard-ui/src/pages/run-detail.tsx', reds: ["src/pages/__tests__/run-detail.playhead.test.tsx > PLAYHEAD-PARENT-PARKS-LATEST-FRAME"] },
    { id: 'P02', claim: 'PARENT-FRAME-SUBSTITUTED', subject: 'packages/dashboard-ui/src/lib/playhead.ts', reds: ["src/lib/__tests__/playhead.test.ts > PARENT-FRAME-SUBSTITUTED"] },
    { id: 'P03', claim: 'C424-STATES-EXACT', subject: 'packages/dashboard-ui/src/lib/evidence-state-view.ts', reds: ["src/lib/__tests__/evidence-state-view.test.ts > C424-STATES-EXACT","src/lib/__tests__/evidence-state-view.test-d.ts > C424-STATES-EXACT"] },
    { id: 'P04', claim: 'C424-TONES-EXACT', subject: 'packages/dashboard-ui/src/lib/evidence-state-view.ts', reds: ["src/lib/__tests__/evidence-state-view.test.ts > C424-TONES-EXACT","src/lib/__tests__/evidence-state-view.test-d.ts > C424-TONES-EXACT"] },
    { id: 'P05', claim: 'C424-FAILURES-EXACT', subject: 'packages/dashboard-ui/src/lib/evidence-state-view.ts', reds: ["src/lib/__tests__/evidence-state-view.test.ts > C424-FAILURES-EXACT","src/lib/__tests__/evidence-state-view.test-d.ts > C424-FAILURES-EXACT"] },
    { id: 'P06', claim: 'C424-EVIDENCE-KINDS-EXACT', subject: 'packages/dashboard-ui/src/lib/evidence-state-view.ts', reds: ["src/lib/__tests__/evidence-state-view.test.ts > C424-EVIDENCE-KINDS-EXACT","src/lib/__tests__/evidence-state-view.test-d.ts > C424-EVIDENCE-KINDS-EXACT"] },
    { id: 'P07', claim: 'VIEW-LOAD-FAILURE-NEVER-EMPTY', subject: 'packages/dashboard-ui/src/lib/evidence-state-view.ts', reds: ["src/lib/__tests__/evidence-state-view.test.ts > VIEW-LOAD-FAILURE-NEVER-EMPTY"] },
    { id: 'P08', claim: 'RECORDED-ELSEWHERE-TIE-LATER', subject: 'packages/dashboard-ui/src/lib/evidence-state-view.ts', reds: ["src/lib/__tests__/evidence-state-view.test.ts > RECORDED-ELSEWHERE-TIE-LATER"] },
    { id: 'P09', claim: 'C424-PLAYER-SOURCES-EXACT', subject: 'packages/dashboard-ui/src/lib/playhead.ts', reds: ["src/lib/__tests__/playhead.test.ts > C424-PLAYER-SOURCES-EXACT","src/lib/__tests__/playhead.test-d.ts > C424-PLAYER-SOURCES-EXACT"] },
    { id: 'P10', claim: 'C424-MARKER-RESULTS-EXACT', subject: 'packages/dashboard-ui/src/lib/playhead.ts', reds: ["src/lib/__tests__/playhead.test.ts > C424-MARKER-RESULTS-EXACT","src/lib/__tests__/playhead.test-d.ts > C424-MARKER-RESULTS-EXACT"] },
    { id: 'P11', claim: 'C424-MARKER-FRAMES-EXACT', subject: 'packages/dashboard-ui/src/lib/playhead.ts', reds: ["src/lib/__tests__/playhead.test.ts > C424-MARKER-FRAMES-EXACT","src/lib/__tests__/playhead.test-d.ts > C424-MARKER-FRAMES-EXACT"] },
    { id: 'P12', claim: 'C424-TIMELINE-AXES-EXACT', subject: 'packages/dashboard-ui/src/lib/playhead.ts', reds: ["src/lib/__tests__/playhead.test.ts > C424-TIMELINE-AXES-EXACT","src/lib/__tests__/playhead.test-d.ts > C424-TIMELINE-AXES-EXACT"] },
    { id: 'P13', claim: 'AXIS-ONE-MISSING-ORDINAL', subject: 'packages/dashboard-ui/src/lib/playhead.ts', reds: ["src/lib/__tests__/playhead.test.ts > AXIS-ONE-MISSING-ORDINAL"] },
    { id: 'P14', claim: 'SNAP-THRESHOLD-INCLUSIVE', subject: 'packages/dashboard-ui/src/lib/playhead.ts', reds: ["src/lib/__tests__/playhead.test.ts > SNAP-THRESHOLD-INCLUSIVE"] },
    { id: 'P15', claim: 'C424-CAPTURE-STATES-EXACT', subject: 'packages/dashboard-ui/src/lib/drawer-view.ts', reds: ["src/lib/__tests__/drawer-view.test.ts > C424-CAPTURE-STATES-EXACT","src/lib/__tests__/drawer-view.test-d.ts > C424-CAPTURE-STATES-EXACT"] },
    { id: 'P16', claim: 'DRAWER-NO-STATUS-WORDS', subject: 'packages/dashboard-ui/src/lib/drawer-view.ts', reds: ["src/lib/__tests__/drawer-view.test.ts > DRAWER-NO-STATUS-WORDS"] },
    { id: 'P17', claim: 'COUNTS-ABSENT-NOT-ZERO', subject: 'packages/dashboard-ui/src/lib/evidence-counts.ts', reds: ["src/lib/__tests__/evidence-counts.test.ts > COUNTS-ABSENT-NOT-ZERO","src/lib/__tests__/evidence-counts.test.ts > C424-STEP-SIGNALS-EXACT","src/lib/__tests__/evidence-counts.test-d.ts > C424-STEP-SIGNALS-EXACT"] },
    { id: 'P18', claim: 'C424-EVIDENCE-SCOPES-EXACT', subject: 'packages/dashboard-ui/src/components/run-detail/evidence-scope-line.tsx', reds: ["src/lib/__tests__/evidence-counts.test.ts > C424-EVIDENCE-SCOPES-EXACT","src/lib/__tests__/evidence-counts.test-d.ts > C424-EVIDENCE-SCOPES-EXACT"] },
    { id: 'P19', claim: 'SENTENCE-FAILURE-TRIED', subject: 'packages/dashboard-ui/src/lib/action-vocabulary.ts', reds: ["src/lib/__tests__/action-vocabulary.test.ts > SENTENCE-FAILURE-TRIED"] },
    { id: 'P20', claim: 'C424-VERBS-TOTAL', subject: 'packages/dashboard-ui/src/lib/action-vocabulary.ts', reds: ["src/lib/__tests__/action-vocabulary.test.ts > C424-VERBS-TOTAL"] },
    { id: 'P21', claim: 'NOTICE-HIDDEN-FOR-BYTES-GONE', subject: 'packages/dashboard-ui/src/lib/run-notice-view.ts', reds: ["src/lib/__tests__/run-notice-view.test.ts > NOTICE-HIDDEN-FOR-BYTES-GONE"] },
    { id: 'P22', claim: 'PARENT-STEP-PARKS-PLAYHEAD', subject: 'packages/dashboard-ui/src/pages/run-detail.tsx', reds: ["src/__tests__/conformance/recording-dom.test.ts > PARENT-STEP-PARKS-PLAYHEAD"], crossing: '@vostride/agent-qa-dashboard-ui' },
  ],
})
NODE

