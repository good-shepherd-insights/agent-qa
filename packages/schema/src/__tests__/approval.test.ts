import { describe, expect, it } from 'vitest'
import { approvalSchema, actionProposalSchema } from '../approval/approval'

describe('actionProposalSchema', () => {
  it('accepts a valid patch action proposal with a three-tier approval policy', () => {
    const result = actionProposalSchema.safeParse({
      id: 'proposal_1',
      kind: 'patch',
      status: 'proposed',
      policy: 'ask',
      summary: 'Review patch proposal',
      rationale: 'The patch changes committed config.',
      payloadHash: 'sha256:abc123',
    })

    expect(result.success).toBe(true)
  })

  it('rejects unknown top-level keys', () => {
    const result = actionProposalSchema.safeParse({
      id: 'proposal_1',
      kind: 'patch',
      status: 'proposed',
      policy: 'ask',
      summary: 'Review patch proposal',
      rationale: 'The patch changes committed config.',
      sandboxRuntimeGate: { required: true },
    })

    expect(result.success).toBe(false)
  })

  it('rejects the agent-runtime allowed resolution as a forged schema policy', () => {
    const result = actionProposalSchema.safeParse({
      id: 'proposal_1',
      kind: 'patch',
      status: 'proposed',
      policy: 'allowed',
      summary: 'Review patch proposal',
      rationale: 'The patch changes committed config.',
    })

    expect(result.success).toBe(false)
  })
})

describe('approvalSchema', () => {
  it('accepts a valid approval wait record', () => {
    const result = approvalSchema.safeParse({
      id: 'approval_1',
      proposalRef: 'proposal_1',
      policy: 'ask',
      summary: 'Approval needed for config mutation',
      requestedAt: '2026-06-23T15:00:00.000Z',
      expiresAt: null,
    })

    expect(result.success).toBe(true)
  })

  it('rejects unknown approval resolution keys', () => {
    const result = approvalSchema.safeParse({
      id: 'approval_1',
      proposalRef: 'proposal_1',
      policy: 'ask',
      summary: 'Approval needed for config mutation',
      requestedAt: '2026-06-23T15:00:00.000Z',
      decision: 'approve',
    })

    expect(result.success).toBe(false)
  })
})
