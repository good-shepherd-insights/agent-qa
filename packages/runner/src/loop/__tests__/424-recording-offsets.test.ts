import { afterEach, expect, it, vi } from 'vitest'
import { asRecordId, asRef, sha256hexBytes } from '@vostride/agent-qa-schema'
import type { RunEventEnvelope, SubActionRecordedPayload } from '@vostride/agent-qa-schema'
import { executeStep } from '../index.js'
import type { LoopPorts } from '../ports.js'
import { createRunEventBus } from '../../run/bus.js'
import { createMemberEventSink } from '../../run/event-sink.js'
import { makeActionPlan, makeAdapter, makePlanner, makeStepContext, makeVerifier } from './loop-harness.js'

function fixture(path: 'live' | 'cache' | 'procedure' = 'live', zeroMs?: number) {
  const events: RunEventEnvelope[] = []
  const bus = createRunEventBus({ runId: 'synthetic-offset-run' })
  bus.subscribe(1, event => events.push(event))
  const blobs = new Map<string, Uint8Array>()
  const persist = (bytes: Uint8Array, prefix: string) => {
    const sha = sha256hexBytes(bytes)
    blobs.set(sha, bytes)
    return { id: `${prefix}:${sha}`, sha }
  }
  const masking = { mask: (text: string) => text, unmask: (text: string) => text }
  const ports: LoopPorts & { recordingZeroMs?: number } = {
    adapter: makeAdapter({ screenshot: async () => Buffer.from('synthetic frame') }),
    planner: makePlanner(), verifier: makeVerifier(), masking,
    ...(zeroMs === undefined ? {} : { recordingZeroMs: zeroMs }),
    evidenceArtifacts: {
      persistDecisionScreenshot: bytes => persist(bytes, 'decision-screenshot'),
      persistEvidenceDocument: doc => persist(new TextEncoder().encode(JSON.stringify(doc)), 'aria-state'),
      getBlob: sha => blobs.get(sha),
    },
    events: createMemberEventSink({ bus, masking, testIndex: 0 }).loopEmitFor(0),
  }
  if (path !== 'live') ports.planner = { plan: async () => { throw new Error('Replay must bypass planner') } }
  if (path === 'cache') ports.cache = {
    get: async () => ({ plannedActions: [{ type: 'click', ref: asRef('e2') }],
      groundedLocator: [{ role: 'button', nameNormalized: 'log in', ordinal: 0 }],
      verificationOutcome: 'passed' }),
    set: async () => {}, invalidate: async () => {},
  }
  if (path === 'procedure') ports.procedureFlow = { carry: {
    match: { id: asRecordId('procedure-recording-offset'), flowAnchor: { t: 'flow', name: 'login' },
      confidence: 0.9, authoringModelTier: 'full', parameterSchema: [], replayRecommendation: 'replay' },
    payload: { schemaVersion: 1, parameters: [], steps: [{ instruction: 'Click Log in',
      action: { type: 'click', targets: { ref: { role: 'button', nameNormalized: 'log in' } }, values: {} },
      guard: { target: { role: 'button', nameNormalized: 'log in' },
        pageAnchor: { t: 'page', route: 'https://example.test/login' } },
    }], successAssertion: 'Logged in' }, nextIndex: 0,
  } }
  const children = () => events.filter(event => event.type === 'subActionRecorded')
    .map(event => event.payload as SubActionRecordedPayload)
  const run = () => executeStep('Click Log in', ports, makeStepContext())
  return { ports, children, run }
}

afterEach(() => vi.restoreAllMocks())

for (const [path, cell] of [['live', 'OFFSET-LIVE'], ['cache', 'OFFSET-CACHE-REPLAY'],
  ['procedure', 'OFFSET-PROCEDURE-REPLAY']] as const) {
  it(`${cell}: the real bus carries the measured offset`, async () => {
    vi.spyOn(performance, 'now').mockReturnValue(125.6)
    const f = fixture(path, 100)
    const result = await f.run()
    expect(result.status).toBe('passed')
    if (path === 'cache') expect(result.evidence?.cacheStatus).toBe('hit')
    if (path === 'procedure') expect(result.evidence?.planSource?.kind).toBe('procedure-replay')
    expect(f.children()).toHaveLength(1)
    expect(f.children()[0]?.recordingOffsetMs).toBe(26)
  })
}

it('OFFSET-ABSENT-WITHOUT-ZERO: every path distinguishes missing zero from measured zero', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(0)
  for (const path of ['live', 'cache', 'procedure'] as const) {
    const absent = fixture(path)
    expect((await absent.run()).status).toBe('passed')
    expect(absent.children()).toHaveLength(1)
    expect(absent.children()[0]).not.toHaveProperty('recordingOffsetMs')
    const measured = fixture(path, 0)
    await measured.run()
    expect(measured.children()[0]?.recordingOffsetMs).toBe(0)
  }
})

it('OFFSET-INDEPENDENT-OF-SCREENSHOT: text-only turns still carry offsets', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(125)
  const f = fixture('live', 100)
  f.ports.visionGate = { attachImage: false, captureMode: 'textOnly', promptNote: '' }
  expect((await f.run()).status).toBe('passed')
  expect(f.children()[0]?.artifactRefs?.some(ref => ref.id.startsWith('decision-screenshot:'))).toBe(false)
  expect(f.children()[0]?.recordingOffsetMs).toBe(25)
})

it('OFFSET-MONOTONIC-NOT-WALL: backward wall time cannot change the monotonic delta', async () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(110)
  const wall = vi.spyOn(Date, 'now').mockReturnValue(9000)
  const f = fixture('live', 100)
  f.ports.planner = makePlanner([makeActionPlan({ stepComplete: false }), makeActionPlan()])
  let calls = 0
  f.ports.adapter.execute = async () => {
    clock.mockReturnValue(++calls === 1 ? 120 : 130)
    wall.mockReturnValue(calls === 1 ? 8000 : 1000)
    return { success: true }
  }
  expect((await f.run()).status).toBe('passed')
  expect(f.children().map(child => child.recordingOffsetMs)).toEqual([20, 30])
})

it('OFFSET-ROUNDED-NONNEGATIVE: fractional deltas round and future zero clamps', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(125.6)
  for (const [zero, offset] of [[100, 26], [125.3, 0], [130, 0]]) {
    const f = fixture('live', zero)
    await f.run()
    expect(f.children()[0]?.recordingOffsetMs).toBe(offset)
    expect(Number.isFinite(f.children()[0]?.recordingOffsetMs)).toBe(true)
  }
})

it('OFFSET-EQUAL-BOTH-PUBLISHED: a frozen clock retains both events in order', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(125)
  const f = fixture('live', 100)
  f.ports.planner = makePlanner([makeActionPlan({ stepComplete: false }), makeActionPlan()])
  expect((await f.run()).status).toBe('passed')
  expect(f.children().map(child => [child.subActionIndex, child.recordingOffsetMs])).toEqual([[0, 25], [1, 25]])
})
