import { z } from 'zod'

import { asApprovalId, asProposalId } from './approval-id'
import type { ApprovalId, ProposalId } from './approval-id'

export type QaProposalKind = 'issue' | 'memory' | 'patch' | 'deletion'
export type ProposalStatus =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'superseded'
export type ApprovalPolicy = 'allow' | 'auto' | 'ask'
export type ApprovalDecision = 'approve' | 'reject' | 'cancel'

export interface ActionProposal {
  id: ProposalId
  kind: QaProposalKind
  status: ProposalStatus
  policy: ApprovalPolicy
  summary: string
  rationale: string
  payloadHash?: `sha256:${string}`
}

export interface Approval {
  id: ApprovalId
  proposalRef: ProposalId
  policy: ApprovalPolicy
  summary: string
  requestedAt: string
  expiresAt?: string | null
}

const proposalKindValues = ['issue', 'memory', 'patch', 'deletion'] as const satisfies readonly QaProposalKind[]

const proposalStatusValues = [
  'proposed',
  'approved',
  'rejected',
  'expired',
  'cancelled',
  'superseded',
] as const satisfies readonly ProposalStatus[]

const approvalPolicyValues = ['allow', 'auto', 'ask'] as const satisfies readonly ApprovalPolicy[]

const proposalIdSchema = z.string().transform(asProposalId)
const approvalIdSchema = z.string().transform(asApprovalId)
const payloadHashSchema = z
  .string()
  .regex(/^sha256:/)
  .transform((value) => value as `sha256:${string}`)

export const actionProposalSchema = z.object({
  id: proposalIdSchema,
  kind: z.enum(proposalKindValues),
  status: z.enum(proposalStatusValues),
  policy: z.enum(approvalPolicyValues),
  summary: z.string(),
  rationale: z.string(),
  payloadHash: payloadHashSchema.optional(),
}).strict()

export const approvalSchema = z.object({
  id: approvalIdSchema,
  proposalRef: proposalIdSchema,
  policy: z.enum(approvalPolicyValues),
  summary: z.string(),
  requestedAt: z.string(),
  expiresAt: z.string().nullable().optional(),
}).strict()
