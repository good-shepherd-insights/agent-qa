import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asRecordId, KnowledgeProposalV1Schema, ProposalIdSchema } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGateInconsistencyProposal, fileGateInconsistencyProposal, gateInconsistencyProposalId,
  pendingGateInconsistencyFor } from '../gate-inconsistency.js'
import { claimPendingProposal, proposalsDir, publishAppliedProposal, readPendingProposal,
  readProposal, rejectPendingProposal, restorePendingProposal } from '../proposals-store.js'

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) }
})

describe('418 gate inconsistency proposal durability', () => {
  let root: string
  const input = { candidateId: asRecordId('fact-checkout'), scope: { tier: 'product', key: 'storefront' } as const,
    shape: 'gate1-pass-gate2-fail' as const, gate1Digest: 'a'.repeat(64), gate2Digest: 'b'.repeat(64), proposedAt: 10 }
  const proposal = () => buildGateInconsistencyProposal(input)
  const file = () => fileGateInconsistencyProposal(root, proposal(), { at: 10 })
  const pending = () => pendingGateInconsistencyFor({ agentQaRoot: root, candidateId: input.candidateId })
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'gate-inconsistency-')) })
  afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }) })

  it('derives stable schema-valid identity from candidate and both receipts, without authorship', () => {
    expect(ProposalIdSchema.parse(gateInconsistencyProposalId(input))).toBe(proposal().proposalId)
    expect(gateInconsistencyProposalId({ ...input, proposedAt: 20 } as typeof input)).toBe(proposal().proposalId)
    expect(gateInconsistencyProposalId({ ...input, gate2Digest: 'c'.repeat(64) })).not.toBe(proposal().proposalId)
    expect(KnowledgeProposalV1Schema.parse(proposal())).toEqual(proposal())
    expect(proposal().deltas[0]).toMatchObject({ kind: 'Deprecate', origin: 'system' })
    expect(proposal().deltas[0]).not.toHaveProperty('authorship')
  })

  it('files once, reads by candidate, and leaves every persisted byte unchanged on re-file', () => {
    expect(file()).toEqual({ kind: 'filed', proposalId: proposal().proposalId })
    const path = join(proposalsDir(root), `${proposal().proposalId}.json`)
    const bytes = readFileSync(path, 'utf8')
    expect(file()).toEqual({ kind: 'already-filed', state: 'pending' })
    expect(readFileSync(path, 'utf8')).toBe(bytes)
    expect(readdirSync(proposalsDir(root))).toHaveLength(1)
    expect(pending()).toEqual({ proposalId: proposal().proposalId, shape: input.shape,
      gate1Digest: input.gate1Digest, gate2Digest: input.gate2Digest })
    expect(pendingGateInconsistencyFor({ agentQaRoot: root, candidateId: 'another-candidate' })).toBeUndefined()
  })

  it('measures the existing readProposal blind spot but neither remints nor clears during a real claim', () => {
    file()
    expect(claimPendingProposal(root, proposal().proposalId).kind).toBe('consumed')
    expect(readProposal(root, proposal().proposalId)).toBeUndefined()
    const names = readdirSync(proposalsDir(root))
    expect(names).toEqual([`${proposal().proposalId}.json.claimed.${process.pid}`])
    expect(file()).toEqual({ kind: 'already-filed', state: 'claimed' })
    expect(pending()?.proposalId).toBe(proposal().proposalId)
    expect(readPendingProposal(root, proposal().proposalId)).toBeUndefined()
    expect(readdirSync(proposalsDir(root))).toEqual(names)
    restorePendingProposal(root, proposal().proposalId)
    expect(file()).toEqual({ kind: 'already-filed', state: 'pending' })
    expect(pending()?.proposalId).toBe(proposal().proposalId)
  })

  it.each(['applied', 'rejected'] as const)('retains %s after claim resolution, clears only the flag and never remints', state => {
    file()
    expect(claimPendingProposal(root, proposal().proposalId).kind).toBe('consumed')
    expect(pending()).toBeDefined()
    if (state === 'applied') publishAppliedProposal(root, { proposal: proposal() })
    else {
      restorePendingProposal(root, proposal().proposalId)
      expect(rejectPendingProposal(root, proposal().proposalId, { at: 20 }).kind).toBe('rejected')
    }
    const names = readdirSync(proposalsDir(root))
    const bytes = names.map(name => readFileSync(join(proposalsDir(root), name), 'utf8'))
    expect(pending()).toBeUndefined()
    expect(file()).toEqual({ kind: 'already-filed', state })
    expect(readdirSync(proposalsDir(root))).toEqual(names)
    expect(names.map(name => readFileSync(join(proposalsDir(root), name), 'utf8'))).toEqual(bytes)
  })

  it('rejects path-shaped proposal ids before filing', () => {
    expect(() => fileGateInconsistencyProposal(root, { ...proposal(), proposalId: '../escape' }, { at: 10 })).toThrow()
    expect(readdirSync(root)).toEqual([])
  })

  it('refuses a decided path carrying another proposal rather than clearing the flag', () => {
    file()
    writeFileSync(join(proposalsDir(root), `${proposal().proposalId}.applied.json`), JSON.stringify({
      proposal: { ...proposal(), proposalId: 'prop_another', status: 'applied' },
    }))
    expect(pending).toThrow('Proposal path and payload id disagree')
    expect(file).toThrow('Proposal path and payload id disagree')
  })

  it.each(['restore', 'applied', 'rejected'] as const)('re-reads when a claim becomes %s between listing and content read', async transition => {
    file()
    claimPendingProposal(root, proposal().proposalId)
    const originalRead = (await vi.importActual<typeof fs>('node:fs')).readFileSync
    let transitions = 0
    const reader = vi.mocked(fs.readFileSync).mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => {
      if (String(args[0]).endsWith(`.json.claimed.${process.pid}`) && transitions === 0) {
        transitions += 1
        if (transition === 'applied') publishAppliedProposal(root, { proposal: proposal() })
        else {
          restorePendingProposal(root, proposal().proposalId)
          if (transition === 'rejected') rejectPendingProposal(root, proposal().proposalId, { at: 20 })
        }
      }
      return originalRead(...args)
    }) as typeof fs.readFileSync)
    expect(file()).toEqual({ kind: 'already-filed', state: transition === 'restore' ? 'pending' : transition })
    reader.mockImplementation(originalRead)
    expect(transitions).toBe(1)
    expect(pending()?.proposalId).toBe(transition === 'restore' ? proposal().proposalId : undefined)
    expect(readdirSync(proposalsDir(root)).filter(name => name === `${proposal().proposalId}.json`))
      .toHaveLength(transition === 'restore' ? 1 : 0)
  })
})
