import { expect, test, vi } from 'vitest'
import type { EvidenceDocument, RunEventEnvelope, StepFinalizedPayload } from '@vostride/agent-qa-schema'
import { createRunEventBus } from '../bus.js'
import { createMemberEventSink } from '../event-sink.js'
import { runMemberTest, type MemberRunConfig, type MemberTest } from '../member-runner.js'
import { fakeModel, makeAdapter, makePlanner } from '../../loop/__tests__/loop-harness.js'
import type { ConsoleLogEntry } from '../../result.js'

const secret = 'synthetic-live-secret-423'
const hookId = 'h_amber-birch-coral-delta-ember-falcon-garden-harbor-island-jungle'
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
        return { id: `console-evidence:${'b'.repeat(64)}`, sha: 'b'.repeat(64) }
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
