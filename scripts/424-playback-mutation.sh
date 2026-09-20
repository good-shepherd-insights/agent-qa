#!/usr/bin/env bash
# Presentation contract mutations (424-30). The shared engine counts cells, proves arrival,
# requires named REDs and GREEN controls, and restores source bytes and mtimes before rebuilding.
# AGENT_QA_424_PLAYBACK_MUTATION_{LIST,LEG,SELFTEST} expose the standard engine controls.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const PAGE = 'packages/dashboard-ui/src/pages/run-detail.tsx'
const PLAYHEAD = 'packages/dashboard-ui/src/lib/playhead.ts'
const ABSENCE = 'packages/dashboard-ui/src/lib/evidence-state-view.ts'
const COUNTS = 'packages/dashboard-ui/src/lib/evidence-counts.ts'
const DRAWER = 'packages/dashboard-ui/src/lib/drawer-view.ts'
const VOCABULARY = 'packages/dashboard-ui/src/lib/action-vocabulary.ts'
const NOTICE = 'packages/dashboard-ui/src/lib/run-notice-view.ts'
const SCOPE = 'packages/dashboard-ui/src/components/run-detail/evidence-scope-line.tsx'
const A = 'src/lib/__tests__/evidence-state-view.test.ts'
const AT = 'src/lib/__tests__/evidence-state-view.test-d.ts'
const C = 'src/lib/__tests__/evidence-counts.test.ts'
const CT = 'src/lib/__tests__/evidence-counts.test-d.ts'
const D = 'src/lib/__tests__/drawer-view.test.ts'
const DT = 'src/lib/__tests__/drawer-view.test-d.ts'
const V = 'src/lib/__tests__/action-vocabulary.test.ts'
const P = 'src/lib/__tests__/playhead.test.ts'
const PT = 'src/lib/__tests__/playhead.test-d.ts'
const N = 'src/lib/__tests__/run-notice-view.test.ts'
const PAGE_T = 'src/pages/__tests__/run-detail.playhead.test.tsx'
const DOM = 'src/__tests__/conformance/recording-dom.test.ts'

// Measured from fresh Vitest JSON reports, including parameterized rows and type assertions.
const instruments = {
  absence: { pkg: 'packages/dashboard-ui', files: [A, AT, 'src/components/run-detail/__tests__/evidence-state.test.tsx'], typecheck: true, count: 18 },
  counts: { pkg: 'packages/dashboard-ui', files: [C, CT], typecheck: true, count: 8 },
  drawer: { pkg: 'packages/dashboard-ui', files: [D, DT], typecheck: true, count: 6 },
  vocabulary: { pkg: 'packages/dashboard-ui', files: [V, 'src/components/run-detail/__tests__/action-sentence.test.tsx'], typecheck: false, count: 10 },
  playhead: { pkg: 'packages/dashboard-ui', files: [P, PT], typecheck: true, count: 30 },
  notice: { pkg: 'packages/dashboard-ui', files: [N], typecheck: false, count: 3 },
  page: { pkg: 'packages/dashboard-ui', files: [PAGE_T], typecheck: false, count: 37 },
  browser: { pkg: 'packages/cli', files: [DOM], typecheck: false, count: 4, env: { VITEST_MAX_WORKERS: '1' } },
}
const a = name => cell('absence', A, name)
const c = name => cell('counts', C, name)
const d = name => cell('drawer', D, name)
const v = name => cell('vocabulary', V, name)
const p = name => cell('playhead', P, name)
const n = name => cell('notice', N, name)
const page = name => cell('page', PAGE_T, name)
const dom = name => cell('browser', DOM, name)
const exact = (instrument, runtime, types, name) => [cell(instrument, runtime, name), cell(instrument, types, name)]
const edit = (from, to) => ({ from, to })
const noFold = '    return group ? parkTargetForStep(group) : null\n'

const legs = [
  {
    subject: PAGE, instrument: 'page', claim: 'PLAYHEAD-PARENT-PARKS-LATEST-FRAME',
    operation: 'remove the parent-step resolution fold',
    edits: [edit(noFold, '    return address\n')],
    reds: [page('PLAYHEAD-PARENT-PARKS-LATEST-FRAME')],
    // These controls also inspect the parent-derived playhead or its synchronized UI.
    allowed: ['PLAYHEAD-PARENT-SUBSTITUTED', 'PLAYHEAD-TREE-FOLLOWS', 'PLAYHEAD-TREE-MOVES-PLAYHEAD',
      'PLAYHEAD-ONE-RING-ONE-BAR', 'KEYS-IGNORED-IN-TABLIST', 'KEYS-LEGACY-MAP-UNCHANGED',
      'OVERVIEW-PLAYER-FIRST-BLOCK', 'OVERVIEW-SEEK-REACHES-PLAYER', 'PLAYHEAD-DRIVES-TABS',
      'PLAYHEAD-URL-REPLACE', 'TIMELINE-BADGE-OPENS-TAB', 'TIMELINE-MEMBER-SWITCH'].map(page),
    greens: ['CITED-JUMPS-PLAYHEAD', 'CITED-UNMATCHED-OPENS-LIGHTBOX', 'PLAYHEAD-URL-RESTORE'].map(page),
  },
  {
    subject: PLAYHEAD, instrument: 'playhead', claim: 'PARENT-FRAME-SUBSTITUTED',
    operation: 'accept every frame including missing bytes',
    edits: [edit('  return ref !== undefined && ref.evidenceIncomplete !== true && ref.present !== false\n', '  return true\n')],
    reds: [p('PARENT-FRAME-SUBSTITUTED')],
    allowed: ['PARENT-FRAME-NONE', 'FRAME-PRESENCE-UNKNOWN-USABLE', 'MARKER-GAP-STILL-NUMBERED'].map(p),
    greens: ['PARENT-FRAME-RESOLVED', 'SNAP-THRESHOLD-INCLUSIVE', 'PLAYHEAD-SELECTION-ROUNDTRIP'].map(p),
  },
  {
    subject: ABSENCE, instrument: 'absence', claim: 'C424-STATES-EXACT',
    operation: 'widen EvidenceState and EVIDENCE_STATES with expired',
    edits: [edit(
      "export type EvidenceState = 'empty' | 'not-captured' | 'unsupported' | 'unavailable' | 'failed' | 'no-selection'\nexport const EVIDENCE_STATES = [\n  'empty', 'not-captured', 'unsupported', 'unavailable', 'failed', 'no-selection',\n] as const satisfies readonly EvidenceState[]\n",
      "export type EvidenceState = 'empty' | 'not-captured' | 'unsupported' | 'unavailable' | 'failed' | 'no-selection' | 'expired'\nexport const EVIDENCE_STATES = [\n  'empty', 'not-captured', 'unsupported', 'unavailable', 'failed', 'no-selection', 'expired',\n] as const satisfies readonly EvidenceState[]\n")],
    reds: exact('absence', A, AT, 'C424-STATES-EXACT'),
    allowed: [a('C424-COPY-TOTAL'), cell('absence', 'src/components/run-detail/__tests__/evidence-state.test.tsx', 'STATE-PANE-TONES')],
    greens: [a('C424-TONES-EXACT'), a('VIEW-LOAD-FAILURE-NEVER-EMPTY')],
  },
  {
    subject: ABSENCE, instrument: 'absence', claim: 'C424-TONES-EXACT',
    operation: 'widen EvidenceTone and EVIDENCE_TONES with unknown',
    edits: [edit("export type EvidenceTone = 'positive' | 'neutral' | 'alert'\nexport const EVIDENCE_TONES = ['positive', 'neutral', 'alert'] as const satisfies readonly EvidenceTone[]\n", "export type EvidenceTone = 'positive' | 'neutral' | 'alert' | 'unknown'\nexport const EVIDENCE_TONES = ['positive', 'neutral', 'alert', 'unknown'] as const satisfies readonly EvidenceTone[]\n")],
    reds: exact('absence', A, AT, 'C424-TONES-EXACT'), allowed: [],
    greens: [a('C424-STATES-EXACT'), a('VIEW-LOAD-FAILURE-NEVER-EMPTY')],
  },
  {
    subject: ABSENCE, instrument: 'absence', claim: 'C424-FAILURES-EXACT',
    operation: 'widen EvidenceFailure and EVIDENCE_FAILURES with unknown',
    edits: [edit("export type EvidenceFailure = 'capture' | 'load'\nexport const EVIDENCE_FAILURES = ['capture', 'load'] as const satisfies readonly EvidenceFailure[]\n", "export type EvidenceFailure = 'capture' | 'load' | 'unknown'\nexport const EVIDENCE_FAILURES = ['capture', 'load', 'unknown'] as const satisfies readonly EvidenceFailure[]\n")],
    reds: exact('absence', A, AT, 'C424-FAILURES-EXACT'), allowed: [],
    greens: [a('C424-STATES-EXACT'), a('VIEW-LOAD-FAILURE-NEVER-EMPTY')],
  },
  {
    subject: ABSENCE, instrument: 'absence', claim: 'C424-EVIDENCE-KINDS-EXACT',
    operation: 'widen evidence kinds with unknown',
    edits: [edit(
      "export type EvidenceKindLabel = 'variables' | 'network' | 'console' | 'aria' | 'a11y' | 'video' | 'frame'\nexport const EVIDENCE_KIND_LABELS = [\n  'variables', 'network', 'console', 'aria', 'a11y', 'video', 'frame',\n] as const satisfies readonly EvidenceKindLabel[]\n",
      "export type EvidenceKindLabel = 'variables' | 'network' | 'console' | 'aria' | 'a11y' | 'video' | 'frame' | 'unknown'\nexport const EVIDENCE_KIND_LABELS = [\n  'variables', 'network', 'console', 'aria', 'a11y', 'video', 'frame', 'unknown',\n] as const satisfies readonly EvidenceKindLabel[]\n")],
    reds: exact('absence', A, AT, 'C424-EVIDENCE-KINDS-EXACT'), allowed: [a('C424-COPY-TOTAL')],
    greens: [a('C424-STATES-EXACT'), a('VIEW-LOAD-FAILURE-NEVER-EMPTY')],
  },
  {
    subject: ABSENCE, instrument: 'absence', claim: 'VIEW-LOAD-FAILURE-NEVER-EMPTY',
    operation: 'fold a failed read into empty',
    edits: [edit("  if (read.kind === 'failed' || read.result.outcome === 'read-error') return stateView('failed', 'load')\n",
      "  if (read.kind === 'failed' || read.result.outcome === 'read-error') return stateView('empty')\n")],
    reds: [a('VIEW-LOAD-FAILURE-NEVER-EMPTY')], allowed: [],
    greens: [a('VIEW-EMPTY-INPUTS'), a('C424-STATES-EXACT')],
  },
  {
    subject: ABSENCE, instrument: 'absence', claim: 'RECORDED-ELSEWHERE-TIE-LATER',
    operation: 'prefer the earlier step on a distance tie',
    edits: [edit('    if (distance < nearestDistance || (distance === nearestDistance && step.stepIndex > nearest!.stepIndex)) {\n',
      '    if (distance < nearestDistance || (distance === nearestDistance && step.stepIndex < nearest!.stepIndex)) {\n')],
    reds: [a('RECORDED-ELSEWHERE-TIE-LATER')], allowed: [],
    greens: [a('RECORDED-ELSEWHERE-NEAREST'), a('VIEW-LOAD-FAILURE-NEVER-EMPTY')],
  },
  {
    subject: PLAYHEAD, instrument: 'playhead', claim: 'C424-PLAYER-SOURCES-EXACT',
    operation: 'widen PlayerSource and PLAYER_SOURCES with unknown',
    edits: [edit("export type PlayerSource = 'frames' | 'video'\nexport const PLAYER_SOURCES = ['frames', 'video'] as const satisfies readonly PlayerSource[]\n", "export type PlayerSource = 'frames' | 'video' | 'unknown'\nexport const PLAYER_SOURCES = ['frames', 'video', 'unknown'] as const satisfies readonly PlayerSource[]\n")],
    reds: exact('playhead', P, PT, 'C424-PLAYER-SOURCES-EXACT'), allowed: [],
    greens: [p('PARENT-FRAME-SUBSTITUTED'), p('SNAP-THRESHOLD-INCLUSIVE')],
  },
  {
    subject: PLAYHEAD, instrument: 'playhead', claim: 'C424-MARKER-RESULTS-EXACT',
    operation: 'widen MarkerResult and MARKER_RESULTS with unknown',
    edits: [edit("export type MarkerResult = 'passed' | 'failed' | 'healed'\nexport const MARKER_RESULTS = ['passed', 'failed', 'healed'] as const satisfies readonly MarkerResult[]\n", "export type MarkerResult = 'passed' | 'failed' | 'healed' | 'unknown'\nexport const MARKER_RESULTS = ['passed', 'failed', 'healed', 'unknown'] as const satisfies readonly MarkerResult[]\n")],
    reds: exact('playhead', P, PT, 'C424-MARKER-RESULTS-EXACT'), allowed: [],
    greens: [p('PARENT-FRAME-SUBSTITUTED'), p('SNAP-THRESHOLD-INCLUSIVE')],
  },
  {
    subject: PLAYHEAD, instrument: 'playhead', claim: 'C424-MARKER-FRAMES-EXACT',
    operation: 'widen MarkerFrame and MARKER_FRAMES with unknown',
    edits: [edit("export type MarkerFrame = 'available' | 'absent'\nexport const MARKER_FRAMES = ['available', 'absent'] as const satisfies readonly MarkerFrame[]\n", "export type MarkerFrame = 'available' | 'absent' | 'unknown'\nexport const MARKER_FRAMES = ['available', 'absent', 'unknown'] as const satisfies readonly MarkerFrame[]\n")],
    reds: exact('playhead', P, PT, 'C424-MARKER-FRAMES-EXACT'), allowed: [],
    greens: [p('PARENT-FRAME-SUBSTITUTED'), p('SNAP-THRESHOLD-INCLUSIVE')],
  },
  {
    subject: PLAYHEAD, instrument: 'playhead', claim: 'C424-TIMELINE-AXES-EXACT',
    operation: 'widen TimelineAxis and TIMELINE_AXES with unknown',
    edits: [edit("export type TimelineAxis = 'time' | 'ordinal'\nexport const TIMELINE_AXES = ['time', 'ordinal'] as const satisfies readonly TimelineAxis[]\n", "export type TimelineAxis = 'time' | 'ordinal' | 'unknown'\nexport const TIMELINE_AXES = ['time', 'ordinal', 'unknown'] as const satisfies readonly TimelineAxis[]\n")],
    reds: exact('playhead', P, PT, 'C424-TIMELINE-AXES-EXACT'), allowed: [],
    greens: [p('PARENT-FRAME-SUBSTITUTED'), p('SNAP-THRESHOLD-INCLUSIVE')],
  },
  {
    subject: PLAYHEAD, instrument: 'playhead', claim: 'AXIS-ONE-MISSING-ORDINAL',
    operation: 'choose time when only some sub-actions have offsets',
    edits: [edit('    && steps.every(entry => entry.subActions.every(action => action.recordingOffsetMs !== undefined))\n',
      '    && steps.every(entry => entry.subActions.some(action => action.recordingOffsetMs !== undefined))\n')],
    // some() also changes the empty-step time-axis case (every() is vacuously true).
    reds: [p('AXIS-ONE-MISSING-ORDINAL')], allowed: [p('MODEL-ZERO-SUBACTIONS')],
    greens: [p('AXIS-ALL-OFFSETS-TIME'), p('AXIS-HISTORICAL-ORDINAL')],
  },
  {
    subject: PLAYHEAD, instrument: 'playhead', claim: 'SNAP-THRESHOLD-INCLUSIVE',
    operation: 'exclude the snap threshold boundary',
    edits: [edit('    Math.abs(positionPx - centre.centrePx) <= SNAP_THRESHOLD_PX))\n',
      '    Math.abs(positionPx - centre.centrePx) < SNAP_THRESHOLD_PX))\n')],
    // The snap tie fixtures sit exactly 12px from both markers, so they share the boundary.
    reds: [p('SNAP-THRESHOLD-INCLUSIVE')], allowed: [p('SNAP-TIE-EARLIER')],
    greens: [p('PARENT-FRAME-SUBSTITUTED'), p('NEAREST-TIE-EARLIER')],
  },
  {
    subject: DRAWER, instrument: 'drawer', claim: 'C424-CAPTURE-STATES-EXACT',
    operation: 'widen CaptureState and CAPTURE_STATES with unknown',
    edits: [edit("export type CaptureState = 'sealed' | 'unsealed'\nexport const CAPTURE_STATES = ['sealed', 'unsealed'] as const satisfies readonly CaptureState[]\n",
      "export type CaptureState = 'sealed' | 'unsealed' | 'unknown'\nexport const CAPTURE_STATES = ['sealed', 'unsealed', 'unknown'] as const satisfies readonly CaptureState[]\n")],
    reds: exact('drawer', D, DT, 'C424-CAPTURE-STATES-EXACT'), allowed: [],
    greens: [d('DRAWER-NO-STATUS-WORDS'), d('DRAWER-RAN-AGAINST-DEGRADES')],
  },
  {
    subject: DRAWER, instrument: 'drawer', claim: 'DRAWER-NO-STATUS-WORDS',
    operation: 'put a storage status word into drawer copy',
    edits: [edit("  test: 'Test',\n  config: 'Config',\n", "  test: 'Test finalized',\n  config: 'Config',\n")],
    reds: [d('DRAWER-NO-STATUS-WORDS')], allowed: [],
    greens: [d('C424-CAPTURE-STATES-EXACT'), d('DRAWER-RAN-AGAINST-DEGRADES')],
  },
  {
    subject: COUNTS, instrument: 'counts', claim: 'COUNTS-ABSENT-NOT-ZERO',
    operation: 'invent zero for absent console evidence and widen the signal closed set',
    // P17 covers both count honesty and the U8 step-signal set without dropping a planned leg.
    edits: [
      edit("      ? positive(consoleEntry.counts.errors) : undefined,\n", "      ? positive(consoleEntry.counts.errors) : 0,\n"),
      edit("export type StepSignal = 'console' | 'network' | 'a11y'\nexport const STEP_SIGNALS = ['console', 'network', 'a11y'] as const satisfies readonly StepSignal[]\n",
        "export type StepSignal = 'console' | 'network' | 'a11y' | 'unknown'\nexport const STEP_SIGNALS = ['console', 'network', 'a11y', 'unknown'] as const satisfies readonly StepSignal[]\n"),
    ],
    reds: [c('COUNTS-ABSENT-NOT-ZERO'), ...exact('counts', C, CT, 'C424-STEP-SIGNALS-EXACT')],
    allowed: [], greens: [c('COUNTS-NETWORK-FAILED-PLUS-ERRORED'), c('COUNTS-A11Y-SUM-AND-SEVERITY')],
  },
  {
    subject: SCOPE, instrument: 'counts', claim: 'C424-EVIDENCE-SCOPES-EXACT',
    operation: 'widen EvidenceScope and EVIDENCE_SCOPES with run',
    edits: [edit("export type EvidenceScope = 'step' | 'sub-action'\nexport const EVIDENCE_SCOPES = ['step', 'sub-action'] as const satisfies readonly EvidenceScope[]\n",
      "export type EvidenceScope = 'step' | 'sub-action' | 'run'\nexport const EVIDENCE_SCOPES = ['step', 'sub-action', 'run'] as const satisfies readonly EvidenceScope[]\n")],
    reds: exact('counts', C, CT, 'C424-EVIDENCE-SCOPES-EXACT'), allowed: [],
    greens: [c('COUNTS-ABSENT-NOT-ZERO'), c('C424-STEP-SIGNALS-EXACT')],
  },
  {
    subject: VOCABULARY, instrument: 'vocabulary', claim: 'SENTENCE-FAILURE-TRIED',
    operation: 'use a past-tense success verb for failure',
    edits: [edit("    text: outcome === 'succeeded' ? verb.past : `Tried to ${verb.infinitive}`,\n",
      "    text: verb.past,\n")],
    reds: [v('SENTENCE-FAILURE-TRIED')],
    // The renderer's masked-chip cell also asserts the failed fill sentence verbatim.
    allowed: [...['SENTENCE-NAVIGATE-BRANCHES', 'SENTENCE-INSPECT-BRANCHES', 'SENTENCE-UNKNOWN-TYPE'].map(v),
      cell('vocabulary', 'src/components/run-detail/__tests__/action-sentence.test.tsx', 'SENTENCE-SECRET-CHIP')],
    greens: [v('SENTENCE-SUCCESS-PAST'), v('C424-VERBS-TOTAL')],
  },
  {
    subject: VOCABULARY, instrument: 'vocabulary', claim: 'C424-VERBS-TOTAL',
    operation: 'weaken ACTION_VERBS to Partial and omit doubleClick',
    edits: [
      edit("  doubleClick: { past: 'Double-clicked', infinitive: 'double-click' },\n", ''),
      edit("} satisfies Record<Action['type'], { past: string; infinitive: string }>\n",
        "} satisfies Partial<Record<Action['type'], { past: string; infinitive: string }>>\n"),
    ],
    reds: [v('C424-VERBS-TOTAL')], allowed: [],
    greens: [v('SENTENCE-FAILURE-TRIED'), v('SENTENCE-SUCCESS-PAST')],
  },
  {
    subject: NOTICE, instrument: 'notice', claim: 'NOTICE-HIDDEN-FOR-BYTES-GONE',
    operation: 'ignore evidenceIncomplete when deciding historical absence',
    edits: [edit("  return entry?.state === 'absent' && entry.reason === 'unavailable' && entry.evidenceIncomplete !== true\n",
      "  return entry?.state === 'absent' && entry.reason === 'unavailable'\n")],
    reds: [n('NOTICE-HIDDEN-FOR-BYTES-GONE')], allowed: [],
    greens: [n('NOTICE-PRE-MILESTONE-SHOWN'), n('NOTICE-HIDDEN-WHEN-ANY-RECORDED')],
  },
  {
    subject: PAGE, instrument: 'browser', claim: 'PARENT-STEP-PARKS-PLAYHEAD',
    operation: 'remove the parent fold in the shipped dashboard bundle',
    crossing: { pkg: '@vostride/agent-qa-dashboard-ui', dir: 'packages/dashboard-ui',
      marker: 'play424fold', reference: "join(PACKAGES_ROOT, 'dashboard-ui', 'dist')" },
    edits: [edit(noFold, '    return Object.assign(address, { mutation: "play424fold" })\n')],
    reds: [dom('PARENT-STEP-PARKS-PLAYHEAD')], allowed: [],
    greens: [dom('RECORDING-SEEKABLE'), dom('RECORDING-RANGE-206'), dom('RECORDING-OFF-OPENS-FRAMES')],
  },
]

runGate({
  slug: '424-playback-mutation', envPrefix: 'AGENT_QA_424_PLAYBACK_MUTATION', idPrefix: 'P',
  expectedLegs: 22, banner: 'PLAYBACK_MUTATION_OK', instruments, legs,
})
NODE
