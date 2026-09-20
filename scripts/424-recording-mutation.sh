#!/usr/bin/env bash
# Recording contract mutations (424-21): named REDs, counted GREEN siblings, source arrival,
# byte-identical restoration and forced rebuilds are enforced by the shared 423 engine.
# Type legs widen the union and list together; their diagnostics must reach the test-d wall.
# AGENT_QA_424_RECORDING_MUTATION_{LIST,LEG,SELFTEST} use the engine's standard controls.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const RECORDING = 'packages/schema/src/run/recording.ts'
const FAMILY = 'packages/schema/src/action/family.ts'
const STORE = 'packages/runner-local/src/evidence-artifact-store.ts'
const MEMBER = 'packages/runner/src/run/member-runner.ts'
const SHELL = 'packages/runner/src/run/shell.ts'
const LOOP = 'packages/runner/src/loop/index.ts'
const DB = 'packages/dashboard-server/src/db/database.ts'
const DETAIL = 'packages/agent/src/functions/ops/runs-detail.ts'
const ARTIFACT = 'packages/agent/src/functions/ops/runs-artifact.ts'
const ROUTE = 'packages/dashboard-server/src/run-service/run-detail-routes.ts'
const CLI = 'packages/cli/src/commands/recording-setting.ts'

const RT = 'src/__tests__/424-recording-contracts.test.ts'
const TD = 'src/__tests__/424-recording-contracts.test-d.ts'
const FAMILY_RT = 'src/__tests__/424-action-family.test.ts'
const FAMILY_TD = 'src/__tests__/424-action-family.test-d.ts'
const STORE_T = 'src/__tests__/424-recording-store.test.ts'
const MEMBER_T = 'src/run/__tests__/424-recording-member.test.ts'
const SHELL_T = 'src/run/__tests__/424-recording-shell.test.ts'
const OFFSET_T = 'src/loop/__tests__/424-recording-offsets.test.ts'
const MIGRATION_T = 'src/__tests__/424-read-migration.test.ts'
const SUB_T = 'src/__tests__/424-recording-subscriber.test.ts'
const DETAIL_T = 'src/functions/__tests__/424-detail-recording.test.ts'
const ARTIFACT_T = 'src/functions/__tests__/424-artifact-range.test.ts'
const ROUTE_T = 'src/__tests__/424-artifact-range-route.test.ts'
const CLI_T = 'src/__tests__/424-recording-default.test.ts'

// Measured from actual green JSON verdicts, including expanded parameterized rows.
const instruments = {
  schema: { pkg: 'packages/schema', files: [RT, TD, FAMILY_RT, FAMILY_TD], typecheck: true, count: 24 },
  store: { pkg: 'packages/runner-local', files: [STORE_T], typecheck: false, count: 24 },
  member: { pkg: 'packages/runner', files: [MEMBER_T, SHELL_T], typecheck: false, count: 15 },
  offsets: { pkg: 'packages/runner', files: [OFFSET_T], typecheck: false, count: 8 },
  db: { pkg: 'packages/dashboard-server', files: [MIGRATION_T, SUB_T], typecheck: false, count: 25 },
  agent: { pkg: 'packages/agent', files: [DETAIL_T, ARTIFACT_T], typecheck: false, count: 36 },
  route: { pkg: 'packages/dashboard-server', files: [ROUTE_T], typecheck: false, count: 17 },
  cli: { pkg: 'packages/cli', files: [CLI_T], typecheck: false, count: 17, env: { VITEST_MAX_WORKERS: '1' } },
}
const s = (file, name) => cell('schema', file, name)
const store = (name, count) => cell('store', STORE_T, name, count)
const member = name => cell('member', MEMBER_T, name)
const shell = name => cell('member', SHELL_T, name)
const offset = name => cell('offsets', OFFSET_T, name)
const migration = (name, count) => cell('db', MIGRATION_T, name, count)
const sub = (name, count) => cell('db', SUB_T, name, count)
const detail = (name, count) => cell('agent', DETAIL_T, name, count)
const artifact = (name, count) => cell('agent', ARTIFACT_T, name, count)
const route = (name, count) => cell('route', ROUTE_T, name, count)
const cli = (name, count) => cell('cli', CLI_T, name, count)
const schemaGreens = (...moved) => [
  ...['C424-RECORDING-STATES-EXACT', 'C424-RECORDING-TYPES-EXACT', 'C424-RECORDING-REF-EXACT']
    .filter(name => !moved.includes(name)).flatMap(name => [s(RT, name), s(TD, name)]),
  ...['C424-FAMILIES-EXACT', 'C424-FAMILIES-EXHAUSTIVE']
    .filter(name => !moved.includes(name)).flatMap(name => [s(FAMILY_RT, name), s(FAMILY_TD, name)]),
  s(TD, 'REC-DTO-OPTIONAL'),
]

const legs = [
  {
    subject: RECORDING, instrument: 'schema', claim: 'C424-RECORDING-STATES-EXACT',
    operation: 'widen RecordingState and RECORDING_STATES with expired',
    edits: [{
      from: "export type RecordingState = 'present' | 'absent'\nexport const RECORDING_STATES = [\n  'present', 'absent',\n] as const satisfies readonly RecordingState[]\n",
      to: "export type RecordingState = 'present' | 'absent' | 'expired'\nexport const RECORDING_STATES = [\n  'present', 'absent', 'expired',\n] as const satisfies readonly RecordingState[]\n",
    }],
    reds: [s(RT, 'C424-RECORDING-STATES-EXACT'), s(TD, 'C424-RECORDING-STATES-EXACT')],
    allowed: [], greens: schemaGreens('C424-RECORDING-STATES-EXACT'),
  },
  {
    subject: RECORDING, instrument: 'schema', claim: 'C424-RECORDING-TYPES-EXACT',
    operation: 'widen RecordingContentType and RECORDING_CONTENT_TYPES with text/html',
    edits: [{
      from: "export type RecordingContentType = 'video/webm' | 'video/mp4'\nexport const RECORDING_CONTENT_TYPES = [\n  'video/webm', 'video/mp4',\n] as const satisfies readonly RecordingContentType[]\n",
      to: "export type RecordingContentType = 'video/webm' | 'video/mp4' | 'text/html'\nexport const RECORDING_CONTENT_TYPES = [\n  'video/webm', 'video/mp4', 'text/html',\n] as const satisfies readonly RecordingContentType[]\n",
    }],
    reds: [s(RT, 'C424-RECORDING-TYPES-EXACT'), s(TD, 'C424-RECORDING-TYPES-EXACT')],
    allowed: [], greens: schemaGreens('C424-RECORDING-TYPES-EXACT'),
  },
  {
    subject: RECORDING, instrument: 'schema', claim: 'C424-RECORDING-REF-EXACT',
    operation: 'remove the recording ref prefix-plus-SHA equality refinement',
    edits: [{
      from: '}).refine(ref => ref.id === `${RECORDING_REF_PREFIX}${ref.sha}`, {\n',
      to: '}).refine(() => true, {\n',
    }],
    reds: [s(RT, 'C424-RECORDING-REF-EXACT')], allowed: [],
    greens: [...schemaGreens('C424-RECORDING-REF-EXACT'), s(TD, 'C424-RECORDING-REF-EXACT')],
  },
  {
    subject: FAMILY, instrument: 'schema', claim: 'C424-FAMILIES-EXACT',
    operation: 'widen ActionFamily and ACTION_FAMILIES with unknown',
    edits: [{
      from: "  | 'script'\n\nexport const ACTION_FAMILIES = [\n  'pointer', 'input', 'gesture', 'navigate', 'verify', 'extract', 'wait', 'device',\n  'environment', 'script',\n] as const satisfies readonly ActionFamily[]\n",
      to: "  | 'script'\n  | 'unknown'\n\nexport const ACTION_FAMILIES = [\n  'pointer', 'input', 'gesture', 'navigate', 'verify', 'extract', 'wait', 'device',\n  'environment', 'script', 'unknown',\n] as const satisfies readonly ActionFamily[]\n",
    }],
    reds: [s(FAMILY_RT, 'C424-FAMILIES-EXACT'), s(FAMILY_TD, 'C424-FAMILIES-EXACT')],
    allowed: [], greens: schemaGreens('C424-FAMILIES-EXACT'),
  },
  {
    subject: FAMILY, instrument: 'schema', claim: 'C424-FAMILIES-EXHAUSTIVE',
    operation: 'weaken the family map to Partial and omit doubleClick',
    // One complete object literal is the anchor: weaken the constraint and remove its key together.
    edits: [{
      from: "export const ACTION_FAMILY_BY_TYPE = {\n  click: 'pointer',\n  doubleClick: 'pointer',\n  rightClick: 'pointer',\n  hover: 'pointer',\n  focus: 'pointer',\n  tap: 'pointer',\n  doubleTap: 'pointer',\n  multiTap: 'pointer',\n  longpress: 'pointer',\n  tapCoordinate: 'pointer',\n  fill: 'input',\n  paste: 'input',\n  copy: 'input',\n  clearText: 'input',\n  keypress: 'input',\n  keyevent: 'input',\n  select: 'input',\n  nativeSelect: 'input',\n  pickerSelect: 'input',\n  fileUpload: 'input',\n  scroll: 'gesture',\n  swipe: 'gesture',\n  drag: 'gesture',\n  pinch: 'gesture',\n  swipeFromEdge: 'gesture',\n  navigate: 'navigate',\n  tab: 'navigate',\n  openUniversalLink: 'navigate',\n  assertAI: 'verify',\n  assertValue: 'verify',\n  extractAI: 'extract',\n  inspect: 'extract',\n  reportValue: 'extract',\n  setVariable: 'extract',\n  uniqueValue: 'extract',\n  waitFor: 'wait',\n  waitForUrl: 'wait',\n  delay: 'wait',\n  pressBack: 'device',\n  pressHome: 'device',\n  pressRecent: 'device',\n  pressButton: 'device',\n  hideKeyboard: 'device',\n  setOrientation: 'device',\n  openApp: 'device',\n  stopApp: 'device',\n  openNotifications: 'device',\n  openQuickSettings: 'device',\n  intent: 'device',\n  setCookies: 'environment',\n  setLocalStorage: 'environment',\n  storageState: 'environment',\n  route: 'environment',\n  unroute: 'environment',\n  networkState: 'environment',\n  handleDialog: 'environment',\n  executeScript: 'script',\n} as const satisfies Record<Action['type'], ActionFamily>\n",
      to: "export const ACTION_FAMILY_BY_TYPE = {\n  click: 'pointer',\n  rightClick: 'pointer',\n  hover: 'pointer',\n  focus: 'pointer',\n  tap: 'pointer',\n  doubleTap: 'pointer',\n  multiTap: 'pointer',\n  longpress: 'pointer',\n  tapCoordinate: 'pointer',\n  fill: 'input',\n  paste: 'input',\n  copy: 'input',\n  clearText: 'input',\n  keypress: 'input',\n  keyevent: 'input',\n  select: 'input',\n  nativeSelect: 'input',\n  pickerSelect: 'input',\n  fileUpload: 'input',\n  scroll: 'gesture',\n  swipe: 'gesture',\n  drag: 'gesture',\n  pinch: 'gesture',\n  swipeFromEdge: 'gesture',\n  navigate: 'navigate',\n  tab: 'navigate',\n  openUniversalLink: 'navigate',\n  assertAI: 'verify',\n  assertValue: 'verify',\n  extractAI: 'extract',\n  inspect: 'extract',\n  reportValue: 'extract',\n  setVariable: 'extract',\n  uniqueValue: 'extract',\n  waitFor: 'wait',\n  waitForUrl: 'wait',\n  delay: 'wait',\n  pressBack: 'device',\n  pressHome: 'device',\n  pressRecent: 'device',\n  pressButton: 'device',\n  hideKeyboard: 'device',\n  setOrientation: 'device',\n  openApp: 'device',\n  stopApp: 'device',\n  openNotifications: 'device',\n  openQuickSettings: 'device',\n  intent: 'device',\n  setCookies: 'environment',\n  setLocalStorage: 'environment',\n  storageState: 'environment',\n  route: 'environment',\n  unroute: 'environment',\n  networkState: 'environment',\n  handleDialog: 'environment',\n  executeScript: 'script',\n} as const satisfies Partial<Record<Action['type'], ActionFamily>>\n",
    }],
    reds: [s(FAMILY_RT, 'C424-FAMILIES-EXHAUSTIVE'), s(FAMILY_TD, 'C424-FAMILIES-EXHAUSTIVE')],
    allowed: [], greens: schemaGreens('C424-FAMILIES-EXHAUSTIVE'),
  },
  {
    subject: STORE, instrument: 'store', claim: 'REC-STORE-ZERO-LENGTH-REFUSED',
    operation: 'remove the empty recording refusal',
    edits: [{ from: "      if (byteLength === 0) throw new Error('Cannot persist an empty recording')\n", to: '' }],
    reds: [store('REC-STORE-ZERO-LENGTH-REFUSED')], allowed: [],
    greens: [store('REC-STORE-STAGING-UNLINKED'), store('REC-STORE-HASH-BY-PATH'), store('REC-STORE-RANGE', 2)],
  },
  {
    subject: STORE, instrument: 'store', claim: 'REC-STORE-STAGING-UNLINKED',
    operation: 'remove the final staging unlink',
    edits: [{ from: '        this.unlinkRecordingStaging(stagingPath)\n', to: '        // Mutation: leave staging behind.\n' }],
    reds: [store('REC-STORE-STAGING-UNLINKED')],
    allowed: [store('REC-STORE-FAILURE-UNLINKS', 6), store('REC-STORE-ZERO-LENGTH-REFUSED'), store('REC-STORE-IDEMPOTENT'), store('REC-STORE-EXDEV-FALLBACK')],
    greens: [store('REC-STORE-HASH-BY-PATH'), store('REC-STORE-RANGE', 2), store('REC-STORE-SHA-GUARD')],
  },
  {
    subject: MEMBER, instrument: 'member', claim: 'REC-MEMBER-NOT-REQUESTED',
    operation: 'settle an unrequested recording without an explicit absence entry',
    edits: [{ from: "  if (recording.state !== 'staged') return recording\n", to: "  if (recording.state !== 'staged') return config.recording?.enabled ? recording : undefined\n" }],
    reds: [member('REC-MEMBER-NOT-REQUESTED')], allowed: [],
    greens: [member('REC-MEMBER-PRESENT'), member('REC-MEMBER-UNSUPPORTED'), member('REC-MEMBER-PER-ATTEMPT'), shell('REC-SHELL-SKIP-NOT-CAPTURED')],
  },
  {
    subject: SHELL, instrument: 'member', claim: 'REC-SHELL-SKIP-NOT-CAPTURED',
    operation: 'omit the shell skip recording extra',
    edits: [{ from: "          recording: { state: 'absent', reason: 'not-captured' },\n", to: '' }],
    reds: [shell('REC-SHELL-SKIP-NOT-CAPTURED')], allowed: [],
    greens: [shell('REC-SHELL-TESTFINISHED-CARRIES'), member('REC-MEMBER-NOT-REQUESTED'), member('REC-MEMBER-PRESENT')],
  },
  {
    subject: LOOP, instrument: 'offsets', claim: 'OFFSET-ABSENT-WITHOUT-ZERO',
    operation: 'invent zero when the recording clock is absent',
    edits: [{ from: '  if (zeroMs === undefined) return undefined\n', to: '  if (zeroMs === undefined) return 0\n' }],
    reds: [offset('OFFSET-ABSENT-WITHOUT-ZERO')], allowed: [],
    greens: ['OFFSET-LIVE', 'OFFSET-CACHE-REPLAY', 'OFFSET-PROCEDURE-REPLAY', 'OFFSET-MONOTONIC-NOT-WALL', 'OFFSET-EQUAL-BOTH-PUBLISHED'].map(offset),
  },
  {
    subject: DB, instrument: 'db', claim: 'MIGRATION-V1-REFUSE',
    operation: 'admit older database versions through the fresh-schema path',
    edits: [{ from: '  if (currentVersion !== 0 && !upgradingV3) throw unmigratedVersionError(currentVersion, schemaVersion)\n', to: '' }],
    reds: [migration('MIGRATION-V1-REFUSE')], allowed: [migration('MIGRATION-V2-DISPOSITION')],
    greens: [migration('MIGRATION-FRESH'), migration('MIGRATION-V3-HISTORY'), migration('MIGRATION-FUTURE-REFUSE', 2), migration('MIGRATION-REOPEN')],
  },
  {
    subject: DB, instrument: 'db', claim: 'REC-SUB-UPSERT-OMISSION',
    operation: 'overwrite recording_json with NULL on an omitted upsert',
    edits: [{ from: '        recording_json = COALESCE(excluded.recording_json, run_members.recording_json)\n', to: '        recording_json = excluded.recording_json\n' }],
    reds: [sub('REC-SUB-UPSERT-OMISSION')], allowed: [],
    greens: [sub('REC-SUB-MEMBER-MIRRORED', 6), sub('REC-SUB-ABSENT-KEY-NULL'), sub('REC-SUB-OFFSET-ZERO'), migration('MIGRATION-V1-REFUSE')],
  },
  {
    subject: DETAIL, instrument: 'agent', claim: 'DETAIL-REC-NULL-UNAVAILABLE',
    operation: 'mislabel historical NULL recording as not-captured',
    edits: [{ from: "  if (recording === undefined) return { state: 'absent', reason: 'unavailable' }\n", to: "  if (recording === undefined) return { state: 'absent', reason: 'not-captured' }\n" }],
    reds: [detail('DETAIL-REC-NULL-UNAVAILABLE')], allowed: [],
    greens: [detail('DETAIL-REC-PRESENT'), detail('DETAIL-REC-BYTES-GONE', 2), detail('DETAIL-REC-NOT-CAPTURED'), artifact('SNIFF-WEBM')],
  },
  {
    subject: DETAIL, instrument: 'agent', claim: 'DETAIL-REC-BYTES-GONE',
    operation: 'skip the recording reference presence check',
    edits: [{ from: '  const [ref] = await annotatePresence(port, runId, [recording.ref])\n', to: '  const ref = { present: true }\n' }],
    reds: [detail('DETAIL-REC-BYTES-GONE', 2)], allowed: [detail('DETAIL-REC-PRESENT')],
    greens: [detail('DETAIL-REC-NULL-UNAVAILABLE'), detail('DETAIL-REC-PRESENCE-UNKNOWN', 2), detail('DETAIL-OFFSET-PASSTHROUGH'), artifact('SNIFF-WEBM')],
  },
  {
    subject: ARTIFACT, instrument: 'agent', claim: 'ARTIFACT-RANGE-UNSATISFIABLE',
    operation: 'remove the unsatisfiable-range throw',
    edits: [{ from: '      if (start >= totalLength) throw new ArtifactRangeNotSatisfiableError(totalLength)\n', to: '' }],
    reds: [artifact('ARTIFACT-RANGE-UNSATISFIABLE', 2)], allowed: [],
    greens: [artifact('ARTIFACT-NO-RANGE-UNCHANGED'), artifact('ARTIFACT-RANGE-CAP'), artifact('SNIFF-FROM-HEAD-NOT-SLICE'), detail('DETAIL-REC-BYTES-GONE', 2)],
  },
  {
    subject: ARTIFACT, instrument: 'agent', claim: 'SNIFF-NEVER-MARKUP',
    operation: 'serve unrecognized bytes as executable markup',
    edits: [{ from: '  return OPAQUE_EVIDENCE_CONTENT_TYPE\n', to: "  return 'text/html'\n" }],
    reds: [artifact('SNIFF-NEVER-MARKUP', 4)], allowed: [],
    greens: [artifact('SNIFF-WEBM'), artifact('SNIFF-MP4'), artifact('SNIFF-FROM-HEAD-NOT-SLICE'), detail('DETAIL-REC-PRESENT')],
  },
  {
    subject: ROUTE, instrument: 'route', claim: 'ROUTE-RANGE-HEADERS-EVERY-ARM',
    operation: 'drop nosniff only from partial-content responses',
    edits: [{
      from: '      res.writeHead(outcome.range === undefined ? 200 : 206, {\n        ...headers,\n',
      to: "      res.writeHead(outcome.range === undefined ? 200 : 206, {\n        ...Object.fromEntries(Object.entries(headers).filter(([key]) => outcome.range === undefined || key !== 'X-Content-Type-Options')),\n",
    }],
    reds: [route('ROUTE-RANGE-HEADERS-EVERY-ARM')],
    allowed: [route('ROUTE-RANGE-206'), route('ROUTE-RANGE-TAIL-BYTE'), route('ROUTE-RANGE-END-CLAMPED', 2)],
    greens: [route('ROUTE-RANGE-416'), route('ROUTE-RANGE-304-KEPT', 3), route('ROUTE-RANGE-MALFORMED-IS-200', 6), route('ROUTE-RANGE-NO-SHA-ECHO')],
  },
  {
    subject: CLI, instrument: 'cli', claim: 'REC-DEFAULT-EXPLICIT-FALSE-OFF',
    operation: 'ignore an explicit config false in favor of the default',
    edits: [{ from: '    enabled: meta ?? flag ?? config?.enabled ?? true,\n', to: '    enabled: meta ?? flag ?? (config?.enabled || true),\n' }],
    reds: [cli('REC-DEFAULT-EXPLICIT-FALSE-OFF')],
    allowed: [cli('REC-DEFAULT-KNOB-REACHES-RUNNER: suite false / true / undefined', 2), cli('REC-DEFAULT-KNOB-REACHES-RUNNER: direct false / true / undefined', 2)],
    greens: ['REC-DEFAULT-ABSENT-KEY-ON', 'REC-DEFAULT-FLAG-NO-RECORD', 'REC-DEFAULT-META-FALSE-OFF', 'REC-DEFAULT-META-TRUE-ON', 'REC-STAGING-NOT-LEGACY-DIR'].map(name => cli(name)),
  },
]

runGate({
  slug: '424-recording-mutation', envPrefix: 'AGENT_QA_424_RECORDING_MUTATION', idPrefix: 'K',
  expectedLegs: 18, banner: 'RECORDING_MUTATION_OK', instruments, legs,
})
NODE
