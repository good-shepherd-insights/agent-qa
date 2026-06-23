import { expectTypeOf } from 'vitest'
import type { z } from 'zod'
import {
  actionProposalSchema,
  approvalSchema,
  asApprovalId,
  asJobId,
  asPatchId,
  asProposalId,
  jobSchema,
  patchSchema,
} from '../index'
import type {
  ActionProposal,
  Approval,
  ApprovalDecision,
  ApprovalId,
  ApprovalPolicy,
  ExecutionContext,
  FileChange,
  Hunk,
  Job,
  JobConclusionKind,
  JobId,
  JobKind,
  JobStatus,
  Patch,
  PatchId,
  PatchStatus,
  ProposalId,
  ProposalStatus,
  QaProposalKind,
  RunId,
  RunSession,
  RunStatus,
} from '../index'

expectTypeOf(asJobId).parameter(0).toEqualTypeOf<string>()
expectTypeOf(asJobId).returns.toEqualTypeOf<JobId>()
expectTypeOf(asApprovalId).returns.toEqualTypeOf<ApprovalId>()
expectTypeOf(asProposalId).returns.toEqualTypeOf<ProposalId>()
expectTypeOf(asPatchId).returns.toEqualTypeOf<PatchId>()

expectTypeOf<z.infer<typeof jobSchema>>().toEqualTypeOf<Job>()
expectTypeOf<z.infer<typeof approvalSchema>>().toEqualTypeOf<Approval>()
expectTypeOf<z.infer<typeof actionProposalSchema>>().toEqualTypeOf<ActionProposal>()
expectTypeOf<z.infer<typeof patchSchema>>().toEqualTypeOf<Patch>()

expectTypeOf<RunSession['status']>().toEqualTypeOf<RunStatus>()
expectTypeOf<RunSession['executionContext']>().toEqualTypeOf<ExecutionContext>()
expectTypeOf<RunSession['id']>().toEqualTypeOf<RunId>()

expectTypeOf<Job['id']>().toEqualTypeOf<JobId>()
expectTypeOf<Job['kind']>().toEqualTypeOf<JobKind>()
expectTypeOf<Job['status']>().toEqualTypeOf<JobStatus>()
expectTypeOf<Job['conclusionKind']>().toEqualTypeOf<JobConclusionKind | undefined>()

expectTypeOf<ActionProposal['id']>().toEqualTypeOf<ProposalId>()
expectTypeOf<ActionProposal['kind']>().toEqualTypeOf<QaProposalKind>()
expectTypeOf<ActionProposal['status']>().toEqualTypeOf<ProposalStatus>()
expectTypeOf<ActionProposal['policy']>().toEqualTypeOf<ApprovalPolicy>()
expectTypeOf<Approval['proposalRef']>().toEqualTypeOf<ProposalId>()
expectTypeOf<ApprovalDecision>().toEqualTypeOf<'approve' | 'reject' | 'cancel'>()

expectTypeOf<Patch['id']>().toEqualTypeOf<PatchId>()
expectTypeOf<Patch['status']>().toEqualTypeOf<PatchStatus>()
expectTypeOf<Patch['changes']>().toEqualTypeOf<FileChange[]>()
expectTypeOf<FileChange['hunks']>().toEqualTypeOf<Hunk[]>()
