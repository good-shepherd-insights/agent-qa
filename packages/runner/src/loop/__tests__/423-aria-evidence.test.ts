import { expect, it, vi } from 'vitest'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import { AriaEvidenceDocumentSchema, sha256hexBytes } from '@vostride/agent-qa-schema'
import type { EvidenceDocument, RunEventEnvelope, SubActionRecordedPayload } from '@vostride/agent-qa-schema'
import { executeStep } from '../index.js'
import type { EvidenceArtifactStorePort, LoopPorts } from '../ports.js'
import { createRunEventBus } from '../../run/bus.js'
import { createMemberEventSink } from '../../run/event-sink.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import { makeActionPlan, makeAdapter, makePlanner, makeStepContext } from './loop-harness.js'

function fixture(tree = 'before synthetic-run-secret') {
  const masking = createMaskingContext()
  masking.register('synthetic-run-secret')
  const before = makeScreenState({ tree })
  const after = makeScreenState({ tree: 'after must remain raw synthetic-run-secret' })
  const events: RunEventEnvelope[] = []
  const documents: EvidenceDocument[] = []
  const blobs = new Map<string, Uint8Array>()
  const screenshot = Buffer.from('synthetic decision image')
  const screenshotSha = sha256hexBytes(screenshot)
  const store: EvidenceArtifactStorePort = {
    persistDecisionScreenshot: bytes => {
      blobs.set(screenshotSha, bytes)
      return { id: `decision-screenshot:${screenshotSha}`, sha: screenshotSha }
    },
    persistEvidenceDocument: document => {
      documents.push(structuredClone(document))
      const bytes = new TextEncoder().encode(JSON.stringify(document))
      const sha = sha256hexBytes(bytes)
      blobs.set(sha, bytes)
      return { id: `aria-state:${sha}`, sha }
    },
    getBlob: sha => blobs.get(sha),
  }
  const bus = createRunEventBus({ runId: 'synthetic-aria-run' })
  bus.subscribe(1, event => events.push(event))
  const adapter = makeAdapter({ observeResults: [before, after], screenshot: async () => screenshot })
  const observe = vi.spyOn(adapter, 'observe')
  const ports: LoopPorts = {
    adapter, planner: makePlanner(), masking, evidenceArtifacts: store,
    events: createMemberEventSink({ bus, masking, testIndex: 2 }).loopEmitFor(3),
  }
  const children = () => events.filter(event => event.type === 'subActionRecorded')
    .map(event => event.payload as SubActionRecordedPayload)
  return { before, after, ports, store, masking, documents, blobs, screenshotSha, children, observe }
}

it('ARIA-LIVE-MASK: the live run mask persists only before tree and leaves raw handoff states unchanged', async () => {
  const f = fixture()
  const raw = JSON.stringify([f.before, f.after])
  const result = await executeStep('Click Log in', f.ports, makeStepContext())
  expect(result.status).toBe('passed')
  expect(f.documents).toEqual([{ schemaVersion: 1, kind: 'aria', tree: f.masking.mask(f.before.tree) }])
  expect(JSON.stringify(f.documents)).not.toContain('synthetic-run-secret')
  expect(JSON.stringify([f.before, f.after])).toBe(raw)
  expect(result.evidence?.subActions[0]?.stateBefore).toBe(f.before)
  expect(result.evidence?.subActions[0]?.stateAfter).toBe(f.after)
  expect(f.observe).toHaveBeenCalledTimes(2)
})

it('ARIA-REF-APPEND: real sink appends one valid ARIA SHA beside the exact decision screenshot before publication', async () => {
  const f = fixture()
  await executeStep('Click Log in', f.ports, makeStepContext())
  expect(f.children()).toHaveLength(1)
  const child = f.children()[0]!
  expect(child.ariaEvidence?.state).toBe('present')
  if (child.ariaEvidence?.state !== 'present') throw new Error('Expected ARIA entry')
  const ref = child.ariaEvidence.ref
  expect(child.artifactRefs).toEqual([
    { id: `decision-screenshot:${f.screenshotSha}`, sha: f.screenshotSha }, ref,
  ])
  const bytes = f.blobs.get(ref.sha)!
  expect(sha256hexBytes(bytes)).toBe(ref.sha)
  expect(ref.id).toBe(`aria-state:${ref.sha}`)
  expect(AriaEvidenceDocumentSchema.parse(JSON.parse(new TextDecoder().decode(bytes))).tree)
    .toBe(f.masking.mask(f.before.tree))
  expect(child).toMatchObject({ testIndex: 2, stepIndex: 3, subActionIndex: 0 })
})

it('ARIA-ROTATED-SECRET: two runs and execution-time registration use their current independent masks', async () => {
  for (const secret of ['synthetic-first-run', 'synthetic-second-run']) {
    const f = fixture(`before ${secret}`)
    f.ports.adapter.execute = async () => { f.masking.register(secret); return { success: true } }
    await executeStep('Click Log in', f.ports, makeStepContext())
    expect(f.documents).toEqual([{ schemaVersion: 1, kind: 'aria', tree: f.masking.mask(f.before.tree) }])
    expect(JSON.stringify(f.documents)).not.toContain(secret)
    expect(f.before.tree).toContain(secret)
  }
})

for (const failure of ['write', 'mask', 'missing-mask', 'missing-store', 'invalid-ref'] as const) {
  it(`ARIA-WRITE-FAILED: ${failure} retains the action and screenshot with failed evidence`, async () => {
    const f = fixture()
    if (failure === 'write') f.store.persistEvidenceDocument = () => { throw new Error('synthetic write failure') }
    if (failure === 'mask') f.ports.masking = { mask: () => { throw new Error('synthetic mask failure') }, unmask: text => text }
    if (failure === 'missing-mask') f.ports.masking = undefined
    if (failure === 'missing-store') f.store.persistEvidenceDocument = undefined
    if (failure === 'invalid-ref') f.store.persistEvidenceDocument = () => ({ id: `console-evidence:${'a'.repeat(64)}`, sha: 'a'.repeat(64) })
    // Isolate a failing ARIA mask from the loop's unrelated narrative masking sites.
    if (failure === 'mask') f.ports.masking = { mask: text => {
      if (text === f.before.tree) throw new Error('synthetic tree mask failure')
      return f.masking.mask(text)
    }, unmask: text => text }
    const result = await executeStep('Click Log in', f.ports, makeStepContext())
    expect(result.status).toBe('passed')
    expect(result.evidence?.subActions).toHaveLength(1)
    expect(f.children()).toHaveLength(1)
    expect(f.children()[0]?.ariaEvidence).toEqual({ kind: 'aria', state: 'absent', reason: 'failed' })
    expect(f.children()[0]?.artifactRefs).toEqual([{ id: `decision-screenshot:${f.screenshotSha}`, sha: f.screenshotSha }])
  })
}

it('ARIA-EMPTY: an existing empty before tree emits empty without writing a document', async () => {
  const f = fixture('')
  await executeStep('Click Log in', f.ports, makeStepContext())
  expect(f.children()[0]?.ariaEvidence).toEqual({ kind: 'aria', state: 'absent', reason: 'empty' })
  expect(f.documents).toEqual([])
})

for (const platform of ['android', 'ios'] as const) {
  it(`EVID-MOBILE-TREE: ${platform} uses its existing screen tree with no new capture`, async () => {
    const f = fixture(`native ${platform} synthetic-run-secret`)
    f.ports.adapter = { ...f.ports.adapter, platform }
    f.before.platform = platform
    f.after.platform = platform
    f.ports.planner = makePlanner([makeActionPlan({ action: { type: 'wait' } })])
    await executeStep('Wait', f.ports, makeStepContext())
    expect(f.documents).toEqual([{ schemaVersion: 1, kind: 'aria', tree: f.masking.mask(f.before.tree) }])
    expect(f.children()[0]?.ariaEvidence?.state).toBe('present')
    expect(f.observe).toHaveBeenCalledTimes(2)
  })
}
