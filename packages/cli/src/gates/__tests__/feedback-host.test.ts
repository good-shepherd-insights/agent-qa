import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createFeedbackPortForHost } from '../feedback-host.js'
import { markFixture, files, loadBundle } from './feedback-fixture.js'

describe('419 feedback host', () => {
  let root: string | undefined
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }) })
  const hashes = (dir: string) => files(dir).map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])

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
