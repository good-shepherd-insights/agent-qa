import { expectTypeOf } from 'vitest'
import type {
  ApprovalsPort,
  ClockPort,
  KnowledgePort,
  PersistencePort,
  ToolsPort,
} from '../ports/index.js'
import type {
  Action,
  ActionProposal,
  ActionResult,
  Approval,
  ApprovalDecision,
  ApprovalId,
  ApprovalPolicy,
  CanaryOutcome,
  Delta,
  Job,
  JobId,
  JobStatus,
  Patch,
  PatchId,
  RecordId,
} from '@vostride/agent-qa-schema'

declare const knowledge: KnowledgePort
declare const tools: ToolsPort
declare const persistence: PersistencePort
declare const approvals: ApprovalsPort
declare const clock: ClockPort

expectTypeOf(knowledge).toMatchTypeOf<KnowledgePort>()
expectTypeOf(tools).toMatchTypeOf<ToolsPort>()
expectTypeOf(persistence).toMatchTypeOf<PersistencePort>()
expectTypeOf(approvals).toMatchTypeOf<ApprovalsPort>()
expectTypeOf(clock).toMatchTypeOf<ClockPort>()

expectTypeOf<keyof KnowledgePort>().toEqualTypeOf<
  'proposeDeltas' | 'commit' | 'recordCanaryOutcome' | 'promote'
>()

expectTypeOf<Parameters<KnowledgePort['proposeDeltas']>>().toEqualTypeOf<[deltas: Delta[]]>()
expectTypeOf<ReturnType<KnowledgePort['proposeDeltas']>>().toEqualTypeOf<Promise<void>>()
expectTypeOf<Parameters<KnowledgePort['commit']>>().toEqualTypeOf<[deltas: Delta[]]>()
expectTypeOf<ReturnType<KnowledgePort['commit']>>().toEqualTypeOf<Promise<void>>()
expectTypeOf<Parameters<KnowledgePort['recordCanaryOutcome']>>().toEqualTypeOf<
  [outcome: CanaryOutcome]
>()
expectTypeOf<ReturnType<KnowledgePort['recordCanaryOutcome']>>().toEqualTypeOf<Promise<void>>()
expectTypeOf<Parameters<KnowledgePort['promote']>>().toEqualTypeOf<[candidateId: RecordId]>()
expectTypeOf<ReturnType<KnowledgePort['promote']>>().toEqualTypeOf<Promise<void>>()

expectTypeOf<Parameters<ToolsPort['execute']>>().toEqualTypeOf<[action: Action]>()
expectTypeOf<ReturnType<ToolsPort['execute']>>().toEqualTypeOf<Promise<ActionResult>>()

expectTypeOf<Parameters<PersistencePort['saveJob']>>().toEqualTypeOf<[job: Job]>()
expectTypeOf<ReturnType<PersistencePort['saveJob']>>().toEqualTypeOf<Promise<void>>()
expectTypeOf<Parameters<PersistencePort['getJob']>>().toEqualTypeOf<[id: JobId]>()
expectTypeOf<ReturnType<PersistencePort['getJob']>>().toEqualTypeOf<Promise<Job | undefined>>()
expectTypeOf<Parameters<PersistencePort['listJobs']>>().toEqualTypeOf<[status?: JobStatus]>()
expectTypeOf<ReturnType<PersistencePort['listJobs']>>().toEqualTypeOf<Promise<Job[]>>()
expectTypeOf<Parameters<PersistencePort['saveCheckpoint']>>().toEqualTypeOf<
  [jobId: JobId, checkpoint: unknown]
>()
expectTypeOf<ReturnType<PersistencePort['loadCheckpoint']>>().toEqualTypeOf<
  Promise<unknown | undefined>
>()
expectTypeOf<Parameters<PersistencePort['appendConversation']>>().toEqualTypeOf<
  [jobId: JobId, event: unknown]
>()
expectTypeOf<ReturnType<PersistencePort['loadConversation']>>().toEqualTypeOf<Promise<unknown[]>>()
expectTypeOf<Parameters<PersistencePort['saveApproval']>>().toEqualTypeOf<[approval: Approval]>()
expectTypeOf<ReturnType<PersistencePort['saveApproval']>>().toEqualTypeOf<Promise<void>>()
expectTypeOf<Parameters<PersistencePort['getApproval']>>().toEqualTypeOf<[id: ApprovalId]>()
expectTypeOf<ReturnType<PersistencePort['getApproval']>>().toEqualTypeOf<
  Promise<Approval | undefined>
>()
expectTypeOf<Parameters<PersistencePort['savePatch']>>().toEqualTypeOf<[patch: Patch]>()
expectTypeOf<ReturnType<PersistencePort['savePatch']>>().toEqualTypeOf<Promise<void>>()
expectTypeOf<Parameters<PersistencePort['getPatch']>>().toEqualTypeOf<[id: PatchId]>()
expectTypeOf<ReturnType<PersistencePort['getPatch']>>().toEqualTypeOf<Promise<Patch | undefined>>()

expectTypeOf<Parameters<ApprovalsPort['requestApproval']>>().toEqualTypeOf<
  [proposal: ActionProposal]
>()
expectTypeOf<ReturnType<ApprovalsPort['requestApproval']>>().toEqualTypeOf<Promise<Approval>>()
expectTypeOf<Parameters<ApprovalsPort['decide']>>().toEqualTypeOf<
  [approvalId: ApprovalId, decision: ApprovalDecision]
>()
expectTypeOf<ReturnType<ApprovalsPort['decide']>>().toEqualTypeOf<Promise<void>>()
expectTypeOf<Parameters<ApprovalsPort['resolvePolicy']>>().toEqualTypeOf<
  [proposal: ActionProposal]
>()
expectTypeOf<ReturnType<ApprovalsPort['resolvePolicy']>>().toEqualTypeOf<Promise<ApprovalPolicy>>()

expectTypeOf<ReturnType<ClockPort['now']>>().toEqualTypeOf<string>()
