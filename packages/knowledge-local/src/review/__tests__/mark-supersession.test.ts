import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { asRecordId, asRunId, foldBundleTrust, stampReceiptDigest, type CompletedRunHandoff } from '@vostride/agent-qa-schema'
import { makeBundleDraftFixture, makeScreenStateFixture, scaffoldKnowledgeRoot } from '../../__tests__/fixtures/bundle-fixture.js'
import { loadBundle, readGateReceipts } from '../../bundle-read.js'
import { enumerateBundleDirs } from '../../bundle-scan.js'
import { createLocalKnowledgeStore } from '../../curator/knowledge-store.js'
import { applyFeedback } from '../../feedback/apply-feedback.js'
import { acquireWriterLease, releaseLease } from '../../lease/writer-lease.js'
import { applyReview } from '../apply-review.js'
import { proposeReview } from '../propose-review.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it.each([false, true])('commits a real same-kind same-anchor floor replacement before sovereign promotion (interrupted=%s)', async interrupted => {
  const root = mkdtempSync(join(tmpdir(), 'mark-supersession-'))
  roots.push(root)
  const knowledgeRoot = join(root, 'knowledge')
  const agentQaRoot = join(root, '.agent-qa')
  scaffoldKnowledgeRoot(knowledgeRoot)
  const draft = makeBundleDraftFixture({ anchors: [{ t: 'page', route: '/products' }] })
  const lease = acquireWriterLease(knowledgeRoot)
  if (lease.kind !== 'acquired') throw new Error('fixture lease unavailable')
  try {
    const store = createLocalKnowledgeStore({ knowledgeRoot, auditBaseDir: agentQaRoot,
      executionContext: 'local-interactive', writerLeaseId: lease.leaseId, epoch: lease.epoch,
      sourceBuildOrdinal: 6 })
    await store.commit([{ kind: 'Add', origin: 'user', scope: draft.scope, citedIds: [], bundle: draft }])
    const loaded = loadBundle(enumerateBundleDirs(knowledgeRoot)[0]!.dir)
    if (loaded.kind !== 'loaded') throw new Error('fixture must load')
    await store.promote(asRecordId(loaded.bundle.manifest.id), [stampReceiptDigest({
      schemaVersion: 1, gate: 3, candidateId: loaded.bundle.manifest.id, verdict: 'pass',
      producedAtOrdinal: 6, producedBy: { opId: 'knowledge.proposal.apply' },
      runId: 'prior-approved-run', mark: 'false-fail',
    })])
  } finally { releaseLease({ knowledgeRoot, leaseId: lease.leaseId }) }
  const bundles = () => enumerateBundleDirs(knowledgeRoot).map(entry => {
    const loaded = loadBundle(entry.dir)
    if (loaded.kind !== 'loaded') throw new Error('bundle must load through the real guard')
    return { dir: entry.dir, bundle: loaded.bundle }
  })
  const original = bundles()[0]!
  const recordId = original.bundle.manifest.id
  expect(foldBundleTrust(original.bundle.events, original.bundle.manifest)).toMatchObject({
    status: 'active', validity: { openedAtOrdinal: 6 },
  })
  expect(original.bundle.events.some(event => event.type === 'window-close')).toBe(false)
  const runId = asRunId('mark-supersession-run')
  const mark = { markId: 'mark_0123456789ab', runId, runSlug: 'mark-supersession-run',
    testIndex: 0, stepIndex: 0, kind: 'false-fail' as const }
  const handoff: CompletedRunHandoff = { schemaVersion: 7, runId, scope: draft.scope,
    buildOrdinal: 7, executionContext: 'local-interactive', aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: '', testConfigDigest: '' }, startedAt: 0, endedAt: 1,
    tests: [{ testId: 'products', testName: 'Products', filePath: 'products.yaml',
      testIndex: 0, outcome: 'failed', steps: [{ stepIndex: 0,
      stepText: 'Open products', cacheStatus: 'miss', servedBrief: { scope: draft.scope,
        asOfBuild: 6, budget: 200, truncation: '', briefDigest: 'brief', channel2: [], channel3: [],
        channel1: [{ id: asRecordId(recordId), kind: 'fact', summary: draft.summary,
          trust: 1, status: 'active', servedAsCanary: false, tier: '1' }] },
      subActions: [{ plan: 'Open products', plannedAction: { type: 'delay', ms: 1 },
        stateBefore: makeScreenStateFixture(), result: { success: true } }],
      verifierVerdict: { pass: false, reasoning: 'Products were shown despite the failed verdict' },
    }] }] }
  const plan = applyFeedback({ mark, handoff, resolvedStepIndex: 0,
    served: [{ recordId, ...draft }] })
  expect(plan.kind).toBe('knowledge')
  if (plan.kind !== 'knowledge') throw new Error('expected knowledge floor')
  expect(plan.deltas[0]).toMatchObject({ kind: 'Supersede', victimId: recordId,
    newBundle: { kind: draft.kind, subtype: draft.subtype, anchors: draft.anchors } })
  const proposed = proposeReview({ agentQaRoot, knowledgeRoot, request: { verb: 'mark', input: {
    target: plan.target, plan, mark: { markId: mark.markId, runId, testIndex: 0,
      stepIndex: 0, kind: mark.kind, fix: plan.fix },
  } } })
  if (proposed.kind !== 'proposed') throw new Error('expected a filed proposal')
  const proposalId = proposed.proposal.proposalId
  let beforeRetry: unknown
  if (interrupted) {
    await expect(applyReview({ agentQaRoot, knowledgeRoot, proposalId,
      now: () => { throw new Error('injected interrupted mark publication') } })).rejects.toThrow('injected')
    beforeRetry = bundles().map(row => ({ id: row.bundle.manifest.id, events: row.bundle.events,
      gates: readGateReceipts(row.dir, row.bundle.manifest.id) }))
  }
  const result = await applyReview({ agentQaRoot, knowledgeRoot, proposalId })
  if (interrupted) expect(bundles().map(row => ({ id: row.bundle.manifest.id, events: row.bundle.events,
    gates: readGateReceipts(row.dir, row.bundle.manifest.id) }))).toEqual(beforeRetry)
  expect(result.commitReceipt?.held).toEqual([])
  expect(result.commitReceipt?.promoted).toEqual([{ candidateId: expect.any(String), promotionPath: 'user-sovereign' }])
  const replacementId = result.commitReceipt!.recordIds[0]!
  expect(replacementId).not.toBe(recordId)
  const replacement = bundles().find(row => row.bundle.manifest.id === replacementId)!
  const delta = plan.deltas[0]!
  if (delta.kind !== 'Supersede') throw new Error('expected supersession')
  expect(replacement.bundle.body).toBe(delta.newBundle.body)
  expect(replacement.bundle.frontmatter.originClass).toBe('user')
  expect(replacement.bundle.events.some(event => event.type === 'promoted')).toBe(true)
  expect(replacement.bundle.events.some(event => event.type === 'window-close')).toBe(false)
  expect(readGateReceipts(replacement.dir, replacementId)).toEqual(expect.arrayContaining([
    expect.objectContaining({ gate: 3, verdict: 'pass', candidateId: replacementId }),
    expect.objectContaining({ kind: 'promotion', promotionPath: 'user-sovereign' }),
  ]))
  const victim = bundles().find(row => row.bundle.manifest.id === recordId)!.bundle
  expect(victim.body).toBe(original.bundle.body)
  expect(victim.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'superseded', byRecordId: replacementId }),
    expect.objectContaining({ type: 'window-close' }),
  ]))
  const repeat = await applyReview({ agentQaRoot, knowledgeRoot, proposalId })
  expect(repeat.outcome).toBe('already-applied')
  expect(repeat.commitReceipt).toEqual(result.commitReceipt)
  expect(bundles()).toHaveLength(2)
  // A later actual correction of the same semantic fact gets its own generation.
  const nextMark = { ...mark, markId: 'mark_1123456789ab', note: 'Use the product list heading' }
  const nextPlan = applyFeedback({ mark: nextMark, handoff, resolvedStepIndex: 0,
    served: [{ recordId: replacementId, ...delta.newBundle }] })
  if (nextPlan.kind !== 'knowledge') throw new Error('expected subsequent knowledge floor')
  const next = proposeReview({ agentQaRoot, knowledgeRoot, request: { verb: 'mark', input: {
    target: nextPlan.target, plan: nextPlan, mark: { markId: nextMark.markId, runId,
      testIndex: 0, stepIndex: 0, kind: nextMark.kind, fix: nextPlan.fix },
  } } })
  if (next.kind !== 'proposed') throw new Error('expected subsequent proposal')
  const corrected = await applyReview({ agentQaRoot, knowledgeRoot, proposalId: next.proposal.proposalId })
  expect(corrected.commitReceipt?.held).toEqual([])
  const nextId = corrected.commitReceipt!.recordIds[0]!
  expect(new Set([recordId, replacementId, nextId]).size).toBe(3)
  expect(corrected.commitReceipt?.promoted).toEqual([{ candidateId: nextId, promotionPath: 'user-sovereign' }])
  expect(bundles().find(row => row.bundle.manifest.id === replacementId)!.bundle.events)
    .toEqual(expect.arrayContaining([expect.objectContaining({ type: 'superseded', byRecordId: nextId })]))
  expect(bundles()).toHaveLength(3)
})
