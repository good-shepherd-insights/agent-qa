import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadBundle, readGateReceipts } from '../../bundle-read.js'
import { enumerateBundleDirs } from '../../bundle-scan.js'
import { createLocalKnowledgeStore } from '../../curator/knowledge-store.js'
import { acquireWriterLease, releaseLease } from '../../lease/writer-lease.js'
import { readPolicyLadder } from '../../serving/policy-ladder.js'
import { applyReview } from '../apply-review.js'
import { proposeReview } from '../propose-review.js'
import { readAppliedProposal } from '../proposals-store.js'

it('materializes a production Add policy as a distinct replay-stable reference under a real lease', async () => {
  const root = mkdtempSync(join(tmpdir(), 'policy-generation-'))
  const knowledgeRoot = join(root, 'knowledge'), agentQaRoot = join(root, '.agent-qa')
  const lease = acquireWriterLease(knowledgeRoot)
  if (lease.kind !== 'acquired') throw new Error('lease unavailable')
  try {
    const store = createLocalKnowledgeStore({ knowledgeRoot, auditBaseDir: agentQaRoot,
      executionContext: 'local-interactive', epoch: lease.epoch, writerLeaseId: lease.leaseId })
    const scope = { tier: 'product' as const, key: 'review' }
    await store.commit([{ kind: 'Add', origin: 'user', scope, citedIds: [], bundle: {
      kind: 'policy', scope, anchors: [{ t: 'page', route: '/review' }],
      summary: 'Dismiss the banner.', body: 'Dismiss the banner.',
      distilledEvidenceRef: { id: 'review-evidence', sha: 'a'.repeat(64) }, originStage: 'run-curation',
    } }])
    const bundles = () => enumerateBundleDirs(knowledgeRoot).map(entry => {
      const loaded = loadBundle(entry.dir)
      if (loaded.kind !== 'loaded') throw new Error('bundle unreadable')
      return { ...loaded.bundle, dir: entry.dir }
    })
    const original = bundles()[0]!
    const recordId = original.manifest.id
    const proposed = proposeReview({ agentQaRoot, knowledgeRoot,
      request: { verb: 'accept', input: { target: { grain: 'record', recordId } } } })
    if (proposed.kind !== 'proposed') throw new Error('proposal unavailable')
    const input = { agentQaRoot, knowledgeRoot, proposalId: proposed.proposal.proposalId,
      writerAuthority: { leaseId: lease.leaseId, epoch: lease.epoch } }
    const applied = await applyReview(input)
    expect(applied.outcome).toBe('applied')
    expect(applied.commitReceipt?.promoted).toEqual([])
    expect(applied.commitReceipt?.policy?.relPath).toBe('policies/review.md')
    const victim = bundles().find(bundle => bundle.manifest.id === recordId)!
    const replacement = bundles().find(bundle => bundle.manifest.id !== recordId)!
    expect(bundles()).toHaveLength(2)
    expect(victim.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'window-close' }),
      expect.objectContaining({ type: 'superseded', byRecordId: replacement.manifest.id }),
    ]))
    expect(replacement.body).toBe(`policies/review.md#agent-qa:policy ${recordId}`)
    expect(replacement.events.some(event => event.type === 'window-close')).toBe(false)
    expect(victim.body).toBe(original.body)
    const gates = readGateReceipts(victim.dir, recordId)!
    const approval = gates.find(receipt => 'gate' in receipt && receipt.gate === 3)
    expect(approval).toMatchObject({ policyApproval: { proposalId: input.proposalId, recordId } })
    expect(approval).not.toHaveProperty('mark')
    expect(approval).not.toHaveProperty('runId')
    expect(readAppliedProposal(agentQaRoot, input.proposalId)?.commitReceipt).toEqual(applied.commitReceipt)
    expect(readPolicyLadder(knowledgeRoot, 'review').text).toContain('Dismiss the banner.')
    const shelf = readFileSync(join(knowledgeRoot, 'policies/review.md'))
    expect(await applyReview(input)).toMatchObject({ outcome: 'already-applied', commitReceipt: applied.commitReceipt })
    expect(readFileSync(join(knowledgeRoot, 'policies/review.md'))).toEqual(shelf)
    expect(bundles()).toHaveLength(2)
  } finally {
    releaseLease({ knowledgeRoot, leaseId: lease.leaseId })
    rmSync(root, { recursive: true, force: true })
  }
})
