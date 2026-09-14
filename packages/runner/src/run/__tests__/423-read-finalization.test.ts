import { expect, test, vi } from 'vitest'
import type { EvidenceDocument, RunEventEnvelope, StepFinalizedPayload } from '@vostride/agent-qa-schema'
import { createRunEventBus } from '../bus.js'
import { createMemberEventSink } from '../event-sink.js'
import { runMemberTest, type MemberRunConfig, type MemberTest } from '../member-runner.js'
import { fakeModel, makeActionPlan, makeAdapter, makePlanner } from '../../loop/__tests__/loop-harness.js'
import type { ConsoleLogEntry, NetworkLogEntry } from '../../result.js'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import { projectNetworkEvidence } from '../network-evidence-policy.js'
import { executeStep } from '../../loop/index.js'
import type { LoopPorts } from '../../loop/ports.js'

const secret = 'synthetic-live-secret-423'
const hookId = 'h_amber-birch-coral-delta-ember-falcon-garden-harbor-island-jungle'
const networkRecord = (index: number, status = 200): NetworkLogEntry => ({
  url: `https://example.test/${index}/${secret}`, method: 'POST', status,
  requestHeaders: { 'content-type': 'text/plain', Authorization: 'synthetic-fresh-session' },
  responseHeaders: { 'content-type': 'text/plain', 'set-cookie': 'synthetic-fresh-session' },
  requestBody: secret, body: secret, startTime: 1000 - index, endTime: 2000 - index,
})
function fixture() {
  const events: RunEventEnvelope[] = []
  const documents: EvidenceDocument[] = []
  const secrets = new Set<string>()
  const masking = {
    mask: (text: string) => [...secrets].reduce((value, item) => value.replaceAll(item, '[secret]'), text),
    unmask: (text: string) => text,
  }
  const bus = createRunEventBus({ runId: 'synthetic-run-423' })
  bus.subscribe(1, event => events.push(event))
  const abort = new AbortController()
  const adapter = makeAdapter()
  adapter.drainConsoleLogs = vi.fn((): ConsoleLogEntry[] => [])
  const config: MemberRunConfig = {
    adapter, planner: makePlanner(), plannerModel: fakeModel, verifierModel: fakeModel,
    sink: createMemberEventSink({ bus, masking, testIndex: 3 }), testIndex: 3,
    abortSignal: abort.signal, masking,
    evidenceArtifacts: {
      persistDecisionScreenshot: () => ({ id: `decision-screenshot:${'a'.repeat(64)}`, sha: 'a'.repeat(64) }),
      getBlob: () => undefined,
      persistEvidenceDocument: value => {
        documents.push(structuredClone(value))
        return { id: `${value.kind}-evidence:${'b'.repeat(64)}`, sha: 'b'.repeat(64) }
      },
    },
  }
  const member: MemberTest = { testId: 'synthetic-test-423', name: 'Console capture',
    filePath: 'synthetic.yaml', steps: ['Click Log in'] }
  const terminals = () => events.filter(event => event.type === 'stepFinalized').map(
    event => event.payload as StepFinalizedPayload,
  )
  return { events, documents, secrets, abort, adapter, config, member, terminals }
}

test('EVID-WEB-PRESENT: live masked records/counts publish after a11y and variable capture', async () => {
  const f = fixture()
  let terminalsAtA11y = -1
  let subActionsAtA11y = -1
  f.adapter.drainConsoleLogs = () => [
    { level: 'warn', text: secret, timestamp: 20, location: { url: `https://example.test/${secret}`, lineNumber: 2, columnNumber: 1 } },
    { level: 'error', text: 'second', timestamp: 10 },
  ]
  f.config.accessibility = { enabled: true }
  f.config.accessibilityCheck = async () => {
    terminalsAtA11y = f.terminals().length
    subActionsAtA11y = f.events.filter(event => event.type === 'subActionRecorded').length
    return []
  }
  f.member.steps = [{ step: 'Click Log in', capture: { variable: 'captured', method: 'ai' } }]
  f.config.extractorFactory = () => ({ extract: async () => {
    f.secrets.add(secret)
    return { success: true, variableName: 'captured', value: secret, reasoning: 'synthetic capture' }
  } })
  const result = await runMemberTest(f.member, f.config)
  expect(terminalsAtA11y).toBe(0)
  expect(subActionsAtA11y).toBeGreaterThan(0)
  expect(result.steps[0].variableSnapshot?.captured.value).toBe(secret)
  expect(f.terminals()).toHaveLength(1)
  expect(f.terminals()[0].evidence?.console).toEqual({ kind: 'console', state: 'present',
    ref: { id: `console-evidence:${'b'.repeat(64)}`, sha: 'b'.repeat(64) },
    counts: { total: 2, errors: 1, warnings: 1 } })
  expect(f.documents).toEqual([{ schemaVersion: 1, kind: 'console', records: [
    { level: 'warn', text: '[secret]', timestamp: 20, location: { url: 'https://example.test/[secret]', lineNumber: 2, columnNumber: 1 } },
    { level: 'error', text: 'second', timestamp: 10 },
  ] }])
  expect(JSON.stringify(f.documents)).not.toContain(secret)
})

test('NETWORK-COUNTS: one document and exact persisted total/failed/errored counts precede terminal', async () => {
  const f = fixture()
  const records = [networkRecord(0, 200), networkRecord(1, 400), networkRecord(2, 503), networkRecord(3, 0), networkRecord(4, 399)]
  f.adapter.drainNetworkLogs = vi.fn(() => records)
  f.member.steps = [{ step: 'Click Log in', capture: { variable: 'captured', method: 'ai' } }]
  f.config.extractorFactory = () => ({ extract: async () => {
    f.secrets.add(secret)
    return { success: true, variableName: 'captured', value: secret, reasoning: 'synthetic' }
  } })
  const persist = f.config.evidenceArtifacts!.persistEvidenceDocument!
  f.config.evidenceArtifacts!.persistEvidenceDocument = value => {
    expect(f.terminals()).toHaveLength(0)
    return persist(value)
  }
  await runMemberTest(f.member, f.config)
  expect(f.terminals()[0].evidence?.network).toMatchObject({ kind: 'network', state: 'present', counts: { total: 5, failed: 2, errored: 1 } })
  expect(f.documents).toHaveLength(1)
  expect(f.documents[0]).toEqual(projectNetworkEvidence(records, f.config.masking!.mask))
  expect(JSON.stringify(f.documents)).not.toContain(secret)
  expect(JSON.stringify(f.documents)).not.toContain('synthetic-fresh-session')
  expect(f.adapter.drainNetworkLogs).toHaveBeenCalledTimes(1)
})

test('NETWORK-MULTIPAGE: all drained page records survive in capture order without a global 500 cap', async () => {
  const f = fixture()
  const pages = [Array.from({ length: 400 }, (_, i) => networkRecord(i, 404)),
    Array.from({ length: 350 }, (_, i) => networkRecord(i + 400, 0))]
  f.adapter.drainNetworkLogs = () => pages.flat()
  await runMemberTest(f.member, f.config)
  expect(f.terminals()[0].evidence?.network).toMatchObject({ state: 'present', counts: { total: 750, failed: 400, errored: 350 } })
  expect(f.documents).toHaveLength(1)
  const document = f.documents[0]
  expect(document.kind).toBe('network')
  if (document.kind !== 'network') throw new Error('Expected network')
  expect(document.records.map(record => record.startTime)).toEqual(pages.flat().map(record => record.startTime))
})

test('NETWORK-BYTE-STRESS: 600 request plus response 32-KiB bodies retain masked bounds and small row facts', async () => {
  const f = fixture()
  const masking = createMaskingContext()
  for (let index = 0; index < 20; index++) masking.register(`synthetic-unused-secret-${index}`)
  masking.register(secret)
  f.config.masking = masking
  const body = secret + 'é'.repeat(Math.floor((32768 - secret.length) / 2)) + 'a'.repeat((32768 - secret.length) % 2)
  expect(Buffer.byteLength(body)).toBe(32768)
  const records = Array.from({ length: 600 }, (_, i) => ({ ...networkRecord(i), body, requestBody: body }))
  // Measure the unbatched policy on the same synthetic shape before assessing scheduling.
  const baselineStart = performance.now()
  let timerAt = 0
  const timer = new Promise<void>(resolve => setTimeout(() => { timerAt = performance.now(); resolve() }, 0))
  projectNetworkEvidence(records, text => masking.mask(text))
  const synchronousMs = performance.now() - baselineStart
  await timer
  console.info('NETWORK-BASELINE', JSON.stringify({ records: records.length, synchronousMs, timerDelayMs: timerAt - baselineStart }))
  let firstYieldMs: number | undefined
  let drainStarted = 0
  f.adapter.drainNetworkLogs = () => {
    drainStarted = performance.now()
    setTimeout(() => { firstYieldMs = performance.now() - drainStarted }, 0)
    return records
  }
  const persist = f.config.evidenceArtifacts!.persistEvidenceDocument!
  let serializationMs = 0
  let blobBytes = 0
  let maskMs = 0
  f.config.masking = { ...masking, mask: text => {
    const started = performance.now()
    const value = masking.mask(text)
    maskMs += performance.now() - started
    return value
  } }
  f.config.evidenceArtifacts!.persistEvidenceDocument = value => {
    expect(firstYieldMs).toBeDefined()
    const started = performance.now()
    const serialized = JSON.stringify(value)
    serializationMs = performance.now() - started
    blobBytes = Buffer.byteLength(serialized)
    expect(serialized).not.toContain(secret)
    return persist(value)
  }
  const started = performance.now()
  await runMemberTest(f.member, f.config)
  const elapsedMs = performance.now() - started
  expect(f.terminals()[0].evidence?.network).toMatchObject({ state: 'present', counts: { total: 600, failed: 0, errored: 0 } })
  const document = f.documents[0]
  if (document.kind !== 'network') throw new Error('Expected network')
  for (const record of document.records) {
    expect(record.body).toContain('<SECRET_20>')
    expect(record.requestBody).toBe(record.body)
    expect(Buffer.byteLength(record.body!)).toBeLessThanOrEqual(32768)
  }
  const rowEvidenceBytes = Buffer.byteLength(JSON.stringify(f.terminals()[0].evidence))
  expect(rowEvidenceBytes).toBeLessThan(1000)
  console.info('NETWORK-MEASUREMENTS', JSON.stringify({ records: 600, elapsedMs, maskMs, serializationMs, firstYieldMs, blobBytes, rowEvidenceBytes,
    terminalPayloadBytes: Buffer.byteLength(JSON.stringify(f.terminals()[0])) }))
})

test('NETWORK-CANCEL-DURING-BATCH: cancellation retains all drained content and one cancelled terminal', async () => {
  const f = fixture()
  const records = Array.from({ length: 65 }, (_, index) => networkRecord(index))
  f.adapter.drainNetworkLogs = () => {
    setTimeout(() => f.abort.abort(new Error('synthetic batch cancellation')), 0)
    return records
  }
  const result = await runMemberTest(f.member, f.config)
  expect(f.terminals()).toHaveLength(1)
  expect(result.status).toBe('cancelled')
  expect(result.steps[0].networkLogs).toEqual(records)
  expect(result.steps[0].evidence!.subActions.length).toBeGreaterThan(0)
  expect(f.terminals()[0].status).toBe('cancelled')
  expect(f.terminals()[0].evidence?.network).toMatchObject({ state: 'present', counts: { total: 65, failed: 0, errored: 0 } })
})

test.each(['empty', 'disabled', 'android', 'ios', 'capture-error', 'persist-error', 'missing-mask', 'missing-store', 'missing-drain'] as const)(
  'NETWORK-STATES: %s retains honest absence and the original verdict', async kind => {
    const f = fixture()
    f.adapter.drainNetworkLogs = vi.fn(() => {
      if (kind === 'capture-error') throw new Error('synthetic capture error')
      return kind === 'empty' ? [] : [networkRecord(0)]
    })
    if (kind === 'disabled') f.config.logCapture = { network: false }
    if (kind === 'android' || kind === 'ios') {
      f.config.adapter = { ...f.adapter, platform: kind }
      f.member.steps = ['{{appium: mobile: hideKeyboard}}']
      f.config.appiumScript = async () => ({ success: true })
    }
    if (kind === 'persist-error') f.config.evidenceArtifacts!.persistEvidenceDocument = () => { throw new Error('synthetic persist error') }
    if (kind === 'missing-mask') f.config.masking = undefined
    if (kind === 'missing-store') f.config.evidenceArtifacts = undefined
    if (kind === 'missing-drain') f.adapter.drainNetworkLogs = undefined
    const result = await runMemberTest(f.member, f.config)
    expect(result.status).toBe('passed')
    const reason = kind === 'empty' ? 'empty' : kind === 'disabled' ? 'not-captured'
      : ['android', 'ios', 'missing-drain'].includes(kind) ? 'unsupported' : 'failed'
    expect(f.terminals()[0].evidence?.network).toEqual({ kind: 'network', state: 'absent', reason })
    expect(f.documents).toEqual([])
    if (kind === 'disabled') expect(f.adapter.drainNetworkLogs).not.toHaveBeenCalled()
    if (kind === 'android' || kind === 'ios') expect(result.steps[0].networkLogs).toEqual([networkRecord(0)])
  },
)

test('EVID-ZERO: captured zero records is empty without counts or a blob', async () => {
  const f = fixture()
  await runMemberTest(f.member, f.config)
  expect(f.terminals()[0].evidence?.console).toEqual({ kind: 'console', state: 'absent', reason: 'empty' })
  expect(f.documents).toEqual([])
})

test('EVID-DISABLED: explicit console disable is not-captured and never drains', async () => {
  const f = fixture()
  f.config.logCapture = { console: false }
  await runMemberTest(f.member, f.config)
  expect(f.terminals()[0].evidence?.console).toEqual({ kind: 'console', state: 'absent', reason: 'not-captured' })
  expect(f.adapter.drainConsoleLogs).not.toHaveBeenCalled()
  expect(f.documents).toEqual([])
})

test.each(['template', 'hook', 'appium'] as const)(
  'EVID-BYPASS-TERMINAL: %s produces one started terminal with final status', async kind => {
    const f = fixture()
    if (kind === 'template') f.member.steps = ['Click {{env:MISSING}}']
    if (kind === 'hook') {
      f.member.steps = [`{{runHook:"${hookId}"}} Click Log in`]
      f.config.inlineHookDefs = new Map([[hookId, { id: hookId, name: 'synthetic', runtime: 'node', file: 'synthetic.js', deps: [], timeout: 1000, network: false }]])
      f.config.hookExecutor = { execute: async () => ({ success: false, duration: 1, stdout: '', stderr: '', output: '', variables: {} }) }
    }
    if (kind === 'appium') {
      f.member.steps = ['{{appium: mobile: hideKeyboard}}']
      f.config.appiumScript = async () => ({ success: true })
    }
    const result = await runMemberTest(f.member, f.config)
    expect(f.events.filter(event => event.type === 'stepStarted')).toHaveLength(1)
    expect(f.terminals()).toHaveLength(1)
    expect(f.terminals()[0].status).toBe(result.steps[0].status)
    expect(f.terminals()[0].cacheStatus).toBe('bypass')
    expect(f.terminals()[0].evidence?.console).toEqual({ kind: 'console', state: 'absent',
      reason: kind === 'appium' ? 'empty' : 'not-captured' })
  },
)

test('EVID-ABORT-BEFORE: pre-aborted navigation creates no unstarted result or terminal', async () => {
  const f = fixture()
  f.member.url = 'https://example.test/'
  f.abort.abort(new Error('synthetic cancellation'))
  const result = await runMemberTest(f.member, f.config)
  expect(result.steps).toEqual([])
  expect(f.terminals()).toEqual([])
  expect(f.events.filter(event => event.type === 'stepStarted')).toEqual([])
})

test('EVID-ABORT-DURING: runJS cancellation produces exactly one cancelled terminal', async () => {
  const f = fixture()
  f.member.steps = ['Click {{runJS:"value"}}', 'Never starts']
  f.config.runJs = async () => { f.abort.abort(new Error('synthetic cancellation')); return { value: 'cancelled' } }
  const result = await runMemberTest(f.member, f.config)
  expect(result.steps).toHaveLength(1)
  expect(f.terminals()).toHaveLength(1)
  expect(f.terminals()[0].status).toBe('cancelled')
  expect(f.terminals()[0].evidence?.console).toEqual({ kind: 'console', state: 'absent', reason: 'not-captured' })
})

test('EVID-A11Y-FINAL: final status includes late accessibility verdict changes', async () => {
  const f = fixture()
  f.config.accessibility = { enabled: true, failOnViolation: true }
  f.config.accessibilityCheck = async () => [{ ruleId: 'synthetic-rule', impact: 'critical',
    description: 'synthetic violation', help: 'Fix it', helpUrl: 'https://example.test/', nodes: [] }]
  const result = await runMemberTest(f.member, f.config)
  expect(result.status).toBe('failed')
  expect(f.terminals()).toHaveLength(1)
  expect(f.terminals()[0].status).toBe('failed')
  expect(f.terminals()[0].error).toBe(result.steps[0].error)
})

test.each(['drain', 'persist'] as const)('EVID-FAILED: %s failure marks evidence failed without changing verdict', async kind => {
  const f = fixture()
  f.adapter.drainConsoleLogs = () => {
    if (kind === 'drain') throw new Error('synthetic capture failed')
    return [{ level: 'error', text: secret, timestamp: 1 }]
  }
  f.config.evidenceArtifacts!.persistEvidenceDocument = () => { throw new Error('synthetic blob failed') }
  const outcome = await runMemberTest(f.member, f.config).then(value => value, error => ({ error }))
  expect(outcome).toMatchObject({ status: 'passed' })
  expect(f.terminals()).toHaveLength(1)
  expect(f.terminals()[0].evidence?.console).toEqual({ kind: 'console', state: 'absent', reason: 'failed' })
})

test('EVID-MOBILE-SCOPE: device logs remain captured while browser evidence is unsupported', async () => {
  const f = fixture()
  f.config.adapter = { ...f.adapter, platform: 'android' }
  f.member.steps = ['{{appium: mobile: hideKeyboard}}']
  f.config.appiumScript = async () => ({ success: true })
  const result = await runMemberTest(f.member, f.config)
  expect(result.steps[0].consoleLogs).toEqual([])
  expect(f.terminals()[0]?.evidence?.console).toEqual({ kind: 'console', state: 'absent', reason: 'unsupported' })
})

test('EVID-ABORT-DURING: an interrupted active console poll is failed, not an empty capture', async () => {
  const f = fixture()
  Object.assign(f.adapter, { pollDeviceLogs: async () => {
    f.abort.abort(new Error('synthetic poll cancellation'))
    return new Promise<void>(() => {})
  } })
  const result = await runMemberTest(f.member, f.config)
  expect(result.steps).toHaveLength(1)
  expect(f.terminals()).toHaveLength(1)
  expect(f.terminals()[0].status).toBe('cancelled')
  expect(f.terminals()[0].evidence?.console).toEqual({ kind: 'console', state: 'absent', reason: 'failed' })
  expect(f.adapter.drainConsoleLogs).not.toHaveBeenCalled()
})

test('EVID-ABORT-BEFORE: cancellation after loop execution skips unstarted capture', async () => {
  const f = fixture()
  f.config.executeStep = async (instruction, ports, context) => {
    const result = await executeStep(instruction, ports, context)
    f.abort.abort(new Error('synthetic cancellation before drain'))
    return result
  }
  const result = await runMemberTest(f.member, f.config)
  expect(result.steps).toHaveLength(1)
  expect(f.terminals()).toHaveLength(1)
  expect(f.terminals()[0].status).toBe('cancelled')
  expect(f.terminals()[0].evidence?.console).toEqual({ kind: 'console', state: 'absent', reason: 'not-captured' })
  expect(f.adapter.drainConsoleLogs).not.toHaveBeenCalled()
})

test('EVID-ONCE: duplicate and late loop terminals cannot overwrite final member facts', async () => {
  const f = fixture()
  let late: (() => void) | undefined
  f.config.executeStep = async (instruction, ports, context) => {
    const result = await executeStep(instruction, ports, context)
    const emit = () => ports.events?.stepFinalized(result.evidence!, { status: 'failed', error: 'stale callback' })
    emit()
    late = emit
    return result
  }
  await runMemberTest(f.member, f.config)
  late?.()
  expect(f.terminals()).toHaveLength(1)
  expect(f.terminals()[0].status).toBe('passed')
  expect(f.terminals()[0]).not.toHaveProperty('error')
})

test('EVID-ABORT-DURING: the real loop retains completed sub-action evidence before its cancellation funnel', async () => {
  const f = fixture()
  let actions = 0
  f.config.planner = makePlanner([
    makeActionPlan({ stepComplete: false }),
    makeActionPlan({ action: { type: 'click', ref: 'e1' } }),
  ])
  f.adapter.execute = async () => {
    if (++actions === 2) f.abort.abort(new Error('synthetic action cancellation'))
    return { success: true }
  }
  const result = await runMemberTest(f.member, f.config)
  expect(result.steps).toHaveLength(1)
  expect(result.steps[0].evidence).toBeDefined()
  expect(f.terminals()).toHaveLength(1)
  expect(f.terminals()[0].status).toBe('cancelled')
  const children = f.events.filter(event => event.type === 'subActionRecorded')
  expect(children.length).toBeGreaterThan(0)
  expect(children.length).toBe(result.steps[0].evidence!.subActions.length)
  expect(f.events.at(-1)?.type).toBe('stepFinalized')
})

test('EVID-TIMEOUT: non-cooperative started execution gets one timeout row and no later row', async () => {
  const f = fixture()
  f.config.timeouts = { step: 5 }
  f.member.steps = ['Never resolves', 'Never starts']
  let startedPorts: LoopPorts | undefined
  f.config.executeStep = async (_instruction, ports) => {
    startedPorts = ports
    return new Promise(() => {})
  }
  const result = await runMemberTest(f.member, f.config)
  expect(startedPorts).toBeDefined()
  expect(result.steps).toHaveLength(1)
  expect(f.terminals()).toHaveLength(1)
  expect(f.terminals()[0].status).toBe('failed')
  expect(f.terminals()[0].error).toContain('Step timed out')
})

test.each(['missing-mask', 'missing-store', 'bad-ref', 'missing-drain'] as const)(
  'EVID-UNBOUND: %s does not claim successful durable content', async kind => {
    const f = fixture()
    f.adapter.drainConsoleLogs = () => [{ level: 'error', text: secret, timestamp: 1 }]
    if (kind === 'missing-mask') f.config.masking = undefined
    if (kind === 'missing-store') f.config.evidenceArtifacts = undefined
    if (kind === 'bad-ref') f.config.evidenceArtifacts!.persistEvidenceDocument = () => ({ id: 'console-evidence:bad', sha: 'b'.repeat(64) })
    if (kind === 'missing-drain') f.adapter.drainConsoleLogs = undefined
    const result = await runMemberTest(f.member, f.config)
    expect(result.status).toBe('passed')
    expect(f.terminals()[0].evidence?.console).toEqual({ kind: 'console', state: 'absent',
      reason: kind === 'missing-drain' ? 'unsupported' : 'failed' })
    expect(f.documents).toEqual([])
  },
)
