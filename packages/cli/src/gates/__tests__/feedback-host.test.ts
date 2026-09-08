import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFeedbackPortForHost } from '../feedback-host.js'
import { markFixture, files, loadBundle } from './feedback-fixture.js'

describe('419 feedback host', () => {
  let root: string | undefined
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }) })
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
