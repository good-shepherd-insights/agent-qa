import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_CURATION_CAPABILITIES } from '@vostride/agent-qa-agent-local'
import { asEvidenceToken, asRecordId, type AuthoringDraftEditOutput, type ImprovementPlan } from '@vostride/agent-qa-schema'
import { wordImprovementPlan } from '../feedback-wording.js'
import { createFeedbackPortForHost } from '../feedback-host.js'
import { markFixture, files, loadBundle } from './feedback-fixture.js'

const { readPendingProposal, showProposalEnvelope, decidePendingProposal } = await import(new URL('../../../../knowledge-local/src/review/proposals-store.js', import.meta.url).href)
const { appendOutcomeEvent } = await import(new URL('../../../../knowledge-local/src/bundle-append.js', import.meta.url).href)

describe('419 feedback host', () => {
  let root: string | undefined
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }) })
  const hashes = (dir: string) => files(dir).map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])

  it('draft false-fail files a real mark fact proposal with user Supersede and floor wording', async () => {
    const f = markFixture(); root = f.root
    let worded: ImprovementPlan | undefined
    const word = vi.fn<typeof wordImprovementPlan>(async input => { worded = await wordImprovementPlan(input); return worded })
    const port = createFeedbackPortForHost({ ...f.deps, word })
    const result = await port.mark({ runId: f.handoff.runId, kind: 'false-fail' })
    expect(result).toMatchObject({ kind: 'marked', receipt: { disposition: { kind: 'drafted', fix: 'fact', proposalKind: 'knowledge' }, evidence: { confirmed: 1 } } })
    if (result.kind !== 'marked' || result.receipt.disposition.kind !== 'drafted') throw new Error('expected draft')
    const proposal = readPendingProposal(f.agentQaRoot, result.receipt.disposition.proposalId)
    expect(proposal).toMatchObject({ verb: 'mark', wording: 'floor', mark: { markId: result.receipt.markId }, deltas: [{ kind: 'Supersede', victimId: f.published.id, origin: 'user' }] })
    expect(proposal.deltas).toHaveLength(1)
    expect(worded).toMatchObject({ wording: 'floor' })
    expect(result.receipt.gold).toHaveLength(1)
    const before = hashes(root)
    expect(await port.mark({ runId: f.handoff.runId, kind: 'false-fail' })).toEqual({ kind: 'already-marked', receipt: result.receipt })
    expect(hashes(root)).toEqual(before)
    expect(word).toHaveBeenCalledOnce()
    const next = await port.mark({ runId: f.handoff.runId, kind: 'confirmed-bug' })
    expect(next).toMatchObject({ kind: 'marked', receipt: { supersedes: result.receipt.markId } })
    expect(showProposalEnvelope(f.agentQaRoot, result.receipt.disposition.proposalId, { now: Date.now() }).envelope.status).toBe('rejected')
  })

  it('draft false-pass adds a caution, overturned gold and cancels this run helpful attribution', async () => {
    const f = markFixture(); root = f.root
    f.handoff.tests[0]!.steps[0]!.verifierVerdict.pass = true; f.save()
    const lease = LOCAL_CURATION_CAPABILITIES.maintenance.acquireWriterLease(f.knowledgeRoot)
    if (lease.kind !== 'acquired') throw new Error('expected authority')
    try {
      appendOutcomeEvent({ knowledgeRoot: f.knowledgeRoot, auditBaseDir: f.agentQaRoot,
        productKey: 'storefront', commitArtifacts: 'none', writerLeaseId: lease.leaseId, writerEpoch: lease.epoch },
      asRecordId(f.published.id), { type: 'helpful', evidenceToken: asEvidenceToken('prior-feedback'),
        curationJobId: 'fixture-job', buildOrdinal: 45, observationId: `${f.handoff.runId}:test-0:step-0` })
    } finally { LOCAL_CURATION_CAPABILITIES.maintenance.releaseLease({ knowledgeRoot: f.knowledgeRoot, leaseId: lease.leaseId }) }
    const result = await createFeedbackPortForHost(f.deps).mark({ runId: f.handoff.runId, kind: 'false-pass' })
    expect(result).toMatchObject({ kind: 'marked', receipt: { disposition: { kind: 'drafted', fix: 'caution' }, evidence: { overturned: 1 } } })
    if (result.kind !== 'marked') throw new Error('expected mark')
    expect(result.receipt.gold.map(item => item.channel)).toContain('overturned-verdict')
    expect(loadBundle(f.published.dir).bundle.events).toContainEqual(expect.objectContaining({ type: 'overturned' }))
  })
  it('false-pass overturns run evidence even with no served records on the marked step', async () => {
    const f = markFixture(); root = f.root
    f.handoff.tests[0]!.steps[0]!.servedBrief.channel3 = []
    f.handoff.tests[0]!.steps[0]!.verifierVerdict.pass = true; f.save()
    const lease = LOCAL_CURATION_CAPABILITIES.maintenance.acquireWriterLease(f.knowledgeRoot)
    if (lease.kind !== 'acquired') throw new Error('expected authority')
    try {
      appendOutcomeEvent({ knowledgeRoot: f.knowledgeRoot, auditBaseDir: f.agentQaRoot,
        productKey: 'storefront', commitArtifacts: 'none', writerLeaseId: lease.leaseId, writerEpoch: lease.epoch },
      asRecordId(f.published.id), { type: 'helpful', evidenceToken: asEvidenceToken('unserved-feedback'),
        curationJobId: 'fixture-job', buildOrdinal: 45, observationId: `${f.handoff.runId}:test-0:step-0` })
    } finally { LOCAL_CURATION_CAPABILITIES.maintenance.releaseLease({ knowledgeRoot: f.knowledgeRoot, leaseId: lease.leaseId }) }
    expect(await createFeedbackPortForHost(f.deps).mark({ runId: f.handoff.runId, kind: 'false-pass' }))
      .toMatchObject({ kind: 'marked', receipt: { evidence: { confirmed: 0, overturned: 1 } } })
    expect(loadBundle(f.published.dir).bundle.events).toContainEqual(expect.objectContaining({ type: 'overturned' }))
  })

  it('draft test_bug invokes authoring edit and files its real pending test-draft identity', async () => {
    const f = markFixture(); root = f.root
    const member = f.handoff.tests[0]!
    member.steps[0]!.servedBrief.channel3 = []
    member.rootCause = { class: 'test_bug', producer: 'deterministic-classifier', confidence: 1, evidence: { citedSteps: [0], citedAnchors: [], citedArtifacts: [], rationale: 'Assertion drift' }, memoryMisdirectionRuledOut: true, perTest: 0 }
    f.save()
    const draftRef = { filePath: 'tests/draft.yaml', testId: member.testId!, testName: member.testName, contentDigest: 'draft-digest' }
    const edited: AuthoringDraftEditOutput = { draftRef, editedFrom: { filePath: member.filePath, testName: member.testName, boundBy: 'exact-ref' }, patches: [], thoughts: 'Correct assertion', proposal: {
      schemaVersion: 1, draftRef, targetPath: member.filePath, sourceDigest: 'original-digest', disposition: 'unverified', runsPreviewed: 0, runsConsumed: 0, repairIterations: 0, summaryLine: 'Correct assertion',
    } }
    const invokeAuthoringDraftEdit = vi.fn(async () => edited)
    const port = createFeedbackPortForHost({ ...f.deps, invokeAuthoringDraftEdit })
    const result = await port.mark({ runId: f.handoff.runId, kind: 'false-fail' })
    expect(invokeAuthoringDraftEdit).toHaveBeenCalledWith({ testRef: `${member.filePath}::${member.testName}`, intent: expect.any(String) })
    expect(result).toMatchObject({ kind: 'marked', receipt: { disposition: { kind: 'drafted', fix: 'test-edit', proposalKind: 'test-draft' } } })
    if (result.kind !== 'marked' || result.receipt.disposition.kind !== 'drafted') throw new Error('expected test draft')
    const id = result.receipt.disposition.proposalId
    expect(showProposalEnvelope(f.agentQaRoot, id, { now: Date.now() }).envelope).toMatchObject({ id, kind: 'test-draft', status: 'pending' })
    // The existing decision store records a confirmed draft; a later mark leaves it standing.
    expect(decidePendingProposal(f.agentQaRoot, id, { decision: 'applied', at: Date.now() }).kind).toBe('decided')
    const before = files(join(f.agentQaRoot, 'proposals')).map(path => readFileSync(path, 'utf8'))
    await port.mark({ runId: f.handoff.runId, kind: 'confirmed-bug' })
    expect(files(join(f.agentQaRoot, 'proposals')).map(path => readFileSync(path, 'utf8'))).toEqual(before)
  })

  it('draft no-draftable-fix names the empty resolved evidence without filing a fallback', async () => {
    const f = markFixture(); root = f.root
    const member = f.handoff.tests[0]!
    member.steps[0]!.servedBrief.channel3 = []
    member.steps[0]!.verifierVerdict.pass = true
    member.rootCause = { class: 'app_bug', producer: 'deterministic-classifier', confidence: 1, evidence: { citedSteps: [], citedAnchors: [], citedArtifacts: [], rationale: 'Application bug' }, memoryMisdirectionRuledOut: true, perTest: 0 }
    f.save()
    const invokeAuthoringDraftEdit = vi.fn()
    const result = await createFeedbackPortForHost({ ...f.deps, invokeAuthoringDraftEdit }).mark({ runId: f.handoff.runId, kind: 'false-fail' })
    expect(result).toMatchObject({ kind: 'marked', receipt: { disposition: { kind: 'no-draftable-fix', checked: { servedRecords: 0, procedureReads: 0, assertionDrift: false, rootCause: 'app_bug' } } } })
    if (result.kind !== 'marked') throw new Error('expected mark')
    expect(result.receipt.gold).toHaveLength(1)
    expect(files(join(f.agentQaRoot, 'proposals'))).toEqual([])
    expect(invokeAuthoringDraftEdit).not.toHaveBeenCalled()
  })

  it.each(['flake', 'environment', 'timeout'] as const)('quarantines %s with no gold, knowledge bytes or proposal', async klass => {
    const f = markFixture(); root = f.root
    f.handoff.tests[0]!.rootCause = { class: klass, producer: 'deterministic-classifier', confidence: 1, evidence: { citedSteps: [0], citedAnchors: [], citedArtifacts: [], rationale: 'Recorded classification' }, memoryMisdirectionRuledOut: true, perTest: 0 }
    f.save()
    const before = [hashes(f.knowledgeRoot), hashes(join(root, 'agent-qa-eval'))]
    const result = await createFeedbackPortForHost(f.deps).mark({ runId: f.handoff.runId, kind: 'false-fail' })
    expect(result).toMatchObject({ kind: 'marked', receipt: { disposition: { kind: 'quarantined', class: klass }, rootCause: { class: klass, producer: 'deterministic-classifier' }, gold: [], evidence: { confirmed: 0, overturned: 0 } } })
    expect([hashes(f.knowledgeRoot), hashes(join(root, 'agent-qa-eval'))]).toEqual(before)
    expect(files(join(f.agentQaRoot, 'proposals'))).toEqual([])
    expect(readFileSync(join(f.runDir, 'marks.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1)
  })

  it('already-marked repeats write no bytes; a changed re-mark supersedes gold with ordinal 2', async () => {
    const f = markFixture(); root = f.root
    const port = createFeedbackPortForHost(f.deps)
    const first = await port.mark({ runId: f.handoff.runId, kind: 'confirmed-bug' })
    if (first.kind !== 'marked') throw new Error('expected mark')
    const before = hashes(root)
    expect(await port.mark({ runId: f.handoff.runId, kind: 'confirmed-bug' })).toEqual({ kind: 'already-marked', receipt: first.receipt })
    expect(hashes(root)).toEqual(before)
    const second = await port.mark({ runId: f.handoff.runId, kind: 'false-fail' })
    expect(second).toMatchObject({ kind: 'marked', receipt: { ordinal: 2, supersedes: first.receipt.markId } })
    if (second.kind !== 'marked') throw new Error('expected re-mark')
    expect(second.receipt.gold[0]!.cassetteId).toContain('-gold-m02')
    const labels = files(join(root, 'agent-qa-eval')).filter(path => path.includes('labels') && path.includes('-gold-m02')).map(path => JSON.parse(readFileSync(path, 'utf8')))
    expect(JSON.stringify(labels)).toContain(first.receipt.gold[0]!.cassetteId)
    expect(await port.marksFor(f.handoff.runId)).toEqual([second.receipt])
  })

  it('refuses ambiguous-address, member-not-found and step-not-found without appending', async () => {
    const f = markFixture(); root = f.root
    const port = createFeedbackPortForHost(f.deps)
    f.handoff.tests.push({ ...f.handoff.tests[0]!, testIndex: 1, testId: 'second-member' }); f.save()
    expect(await port.mark({ runId: f.handoff.runId, kind: 'confirmed-bug' })).toMatchObject({ kind: 'ambiguous-address', candidates: [{ testIndex: 0 }, { testIndex: 1 }] })
    expect(await port.mark({ runId: f.handoff.runId, testId: 'nope', kind: 'confirmed-bug' })).toMatchObject({ kind: 'member-not-found' })
    expect(await port.mark({ runId: f.handoff.runId, testId: f.handoff.tests[0]!.testId, stepIndex: 1, kind: 'confirmed-bug' })).toMatchObject({ kind: 'step-not-found', stepCount: 1 })
    expect(files(f.runDir).some(path => path.endsWith('marks.jsonl'))).toBe(false)
    expect(await port.mark({ runId: f.handoff.runId, testId: f.handoff.tests[0]!.testId, stepIndex: 0, kind: 'confirmed-bug' })).toMatchObject({ kind: 'marked' })
  })

  it('rerun members remain sovereign and disclose isRerun', async () => {
    const f = markFixture(); root = f.root
    f.handoff.tests[0]!.isRerun = true; f.save()
    expect(await createFeedbackPortForHost(f.deps).mark({ runId: f.handoff.runId, kind: 'confirmed-bug' })).toMatchObject({ kind: 'marked', receipt: { isRerun: true } })
  })
  it('refuses an explicit duplicate test ID with the true member indexes before side effects', async () => {
    const f = markFixture(); root = f.root
    const first = f.handoff.tests[0]!
    f.handoff.tests.push({ ...first, testIndex: 1 }); f.save()
    const before = hashes(root)
    expect(await createFeedbackPortForHost(f.deps).mark({ runId: f.handoff.runId,
      testId: first.testId, kind: 'confirmed-bug' })).toEqual({
      kind: 'ambiguous-address', runId: f.handoff.runId,
      candidates: [{ testIndex: 0, testId: first.testId }, { testIndex: 1, testId: first.testId }],
    })
    expect(hashes(root)).toEqual(before)
  })
  it('tracer: confirmed-bug bare mark freezes private gold, evidence and one ledger receipt', async () => {
    const f = markFixture(); root = f.root
    const port = createFeedbackPortForHost(f.deps)
    const result = await port.mark({ runId: f.handoff.runId, kind: 'confirmed-bug' })
    expect(result).toMatchObject({ kind: 'marked', receipt: { ordinal: 1, origin: 'user', disposition: { kind: 'confirmed-bug', confirmedRecords: 1 }, evidence: { confirmed: 1, overturned: 0 } } })
    if (result.kind !== 'marked') throw new Error('expected mark')
    expect(result.receipt.gold).toHaveLength(1)
    expect(result.receipt.gold[0]!.cassetteId).toContain('-gold-m01')
    expect(result.receipt.gold[0]!.channel).toBe('user-mark')
    const goldFiles = files(join(root, 'agent-qa-eval')).filter(path => path.endsWith('.json')).map(path => JSON.parse(readFileSync(path, 'utf8')))
    expect(goldFiles).toContainEqual(expect.objectContaining({ split: 'held-out', heldOutVisibility: 'private' }))
    expect(goldFiles).toContainEqual(expect.objectContaining({ label: expect.objectContaining({ tier: 'gold', sourceChannel: 'user-mark' }) }))
    const lines = readFileSync(join(f.runDir, 'marks.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(lines).toEqual([result.receipt])
    expect(await port.marksFor(f.handoff.runId)).toEqual(lines)
    expect(loadBundle(f.published.dir).bundle.events).toContainEqual(expect.objectContaining({ type: 'confirmed', evidenceToken: `mark:${result.receipt.markId}` }))
    expect(files(join(f.agentQaRoot, 'proposals'))).toEqual([])
  })
})
