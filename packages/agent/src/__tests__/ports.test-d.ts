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

// 385 plan 02 (D-06). The exact key set, pinned by equality rather than by a list of
// per-method assertions. Per-method assertions can only say what IS there, and the claim
// this carve-up has to support is what is NOT: no conversation surface for a later refactor
// to unify chat into, and no generic job CRUD beside the queue's compound verbs. A method
// resurrected under either name fails this line, and so does one quietly dropped from the
// four that survive — a deletion is not a way to make a pin pass.
expectTypeOf<keyof PersistencePort>().toEqualTypeOf<
  'saveApproval' | 'getApproval' | 'savePatch' | 'getPatch'
>()

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
