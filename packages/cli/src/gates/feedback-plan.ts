// 2026-09-15, 423 D-16: the deterministic half of runs.mark, shared by the writer and its preview.
// Nothing here opens an intent, lease, model or audit dir, mints an id or time, or writes.
import { dirname, resolve } from 'node:path'
import type { KnowledgeReaderPort } from '@vostride/agent-qa-agent'
import { createKnowledgeReader, LOCAL_CURATION_CAPABILITIES, type LocalCurationCapabilities } from '@vostride/agent-qa-agent-local'
import { RunsMarkInputSchema, type CompletedRunHandoff, type ImprovementPlan, type KnowledgeTargetRef, type MarkAddress, type MarkQuarantineClass, type MarkReceipt, type NoDraftableFixChecked, type RunsMarkInput, type RunsMarkOutcome } from '@vostride/agent-qa-schema'
import { resolveConfiguredKnowledgeRoot } from '../config.js'
import { trustPriorsForHost, type ResolveTrustPriors } from '../curation/trust-priors.js'
import { canonicalJson, FsHandoffSource, FsMarkLedger, previewMarkLabels, resolveEvalSession, resolveMarkLabelTargets, slugBranch, type GoldenTrajectoryTarget, type MarkGroundTruthPreview, type MarkLabelPreviewItem } from '../eval-session-composition.js'

export type MarkPlanCuration = Pick<LocalCurationCapabilities, 'triageMark' | 'servedIdsOn' | 'procedureReadOn' | 'applyFeedback' | 'readFeedbackRecord'>
type MarkMember = CompletedRunHandoff['tests'][number]
type MarkStep = MarkMember['steps'][number]
export type ServedRecordFacts = NonNullable<ReturnType<LocalCurationCapabilities['readFeedbackRecord']>>

export type MarkTargetRefusal = Extract<RunsMarkOutcome, { kind: 'run-not-found' | 'member-not-found' | 'ambiguous-address' }>
export type MarkPlanRefusal = Extract<RunsMarkOutcome, { kind: 'step-not-found' | 'ambiguous-correction' }>

export function resolveMarkMember(handoff: CompletedRunHandoff, testId?: string) {
  const matches = testId === undefined ? handoff.tests : handoff.tests.filter(test => test.testId === testId)
  const candidates = matches.map(member => ({ testIndex: member.testIndex,
    ...(member.testId === undefined ? {} : { testId: member.testId }) }))
  if (candidates.length > 1) {
    return { kind: 'ambiguous-address' as const, runId: handoff.runId, candidates }
  }
  const member = matches[0]
  if (member === undefined) return { kind: 'member-not-found' as const, runId: handoff.runId,
    ...(testId === undefined ? {} : { testId }) }
  return { kind: 'member' as const, member }
}

export type MarkTarget =
  | { kind: 'target'; handoff: CompletedRunHandoff; member: MarkMember; address: MarkAddress }
  | MarkTargetRefusal

export function loadMarkTarget(agentQaRoot: string, input: RunsMarkInput): MarkTarget {
  let handoff: CompletedRunHandoff
  try { handoff = new FsHandoffSource({ root: agentQaRoot, runId: input.runId }).load() }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'run-not-found', runId: input.runId }
    throw error
  }
  const resolved = resolveMarkMember(handoff, input.testId)
  if (resolved.kind !== 'member') return resolved
  const { member } = resolved
  return { kind: 'target', handoff, member, address: { runId: input.runId, testIndex: member.testIndex,
    ...(member.testId === undefined ? {} : { testId: member.testId }),
    ...(input.stepIndex === undefined ? {} : { stepIndex: input.stepIndex }) } }
}

/** The note is deliberately absent: only the kind and the correction make a mark a repeat. */
export function isIdenticalRepeat(prior: MarkReceipt, input: RunsMarkInput): boolean {
  return prior.kind === input.kind && prior.correctedExpectation === input.correctedExpectation
    && canonicalJson(prior.correctedAction ?? null) === canonicalJson(input.correctedAction ?? null)
}

/** A read-time observation, not a lock: the writer re-plans under its own transaction. */
export interface MarkPlanBasis { ledgerOrdinal: number; priorOrdinal?: number }
export type MarkLatest = { kind: 'first' } | { kind: 'supersedes'; markId: string; ordinal: number }
export interface MarkResolvedStep { stepIndex: number; reason: GoldenTrajectoryTarget['reason'] }
export interface MarkWithdrawal { proposalId: string; proposalKind: 'knowledge' | 'test-draft' }

export type MarkFeedbackPlan =
  | { kind: 'already-marked'; receipt: MarkReceipt; basis: MarkPlanBasis }
  | { kind: 'refused'; outcome: MarkPlanRefusal; basis: MarkPlanBasis }
  | { kind: 'quarantined'; class: MarkQuarantineClass; resolvedStep: MarkResolvedStep; latest: MarkLatest; basis: MarkPlanBasis }
  | { kind: 'effects'; targets: GoldenTrajectoryTarget[]; resolvedStep: MarkResolvedStep; decisionCount: number
    knowledge: { servedRecordIds: string[]; appendsEvidence: boolean }
    /** Only a mark that completes a new effect withdraws; repeats, refusals and quarantine never do. */
    withdraws?: MarkWithdrawal
    latest: MarkLatest; basis: MarkPlanBasis }

export interface PlanMarkFeedbackInput {
  input: RunsMarkInput
  handoff: CompletedRunHandoff
  member: MarkMember
  address: MarkAddress
  prior: MarkReceipt | undefined
  ledgerOrdinal: number
  curation: Pick<MarkPlanCuration, 'triageMark' | 'servedIdsOn'>
}

/** The writer's refusal order: repeat, unresolvable step, quarantine, then an ambiguous correction. */
export function planMarkFeedback({ input, handoff, member, address, prior, ledgerOrdinal, curation }: PlanMarkFeedbackInput): MarkFeedbackPlan {
  const basis: MarkPlanBasis = { ledgerOrdinal, ...(prior === undefined ? {} : { priorOrdinal: prior.ordinal }) }
  if (prior !== undefined && isIdenticalRepeat(prior, input)) return { kind: 'already-marked', receipt: prior, basis }
  const triage = curation.triageMark(member)
  const resolution = resolveMarkLabelTargets(handoff, address, input)
  if (resolution.kind === 'step-not-found') {
    // The outcome schema exposes the numeric address only.
    return { kind: 'refused', basis, outcome: { kind: 'step-not-found', runId: address.runId, testIndex: address.testIndex,
      stepIndex: input.stepIndex ?? 0, stepCount: resolution.stepCount } }
  }
  const target = resolution.targets[0]!
  const resolvedStep: MarkResolvedStep = { stepIndex: target.stepIndex, reason: target.reason }
  const latest: MarkLatest = prior === undefined ? { kind: 'first' } : { kind: 'supersedes', markId: prior.markId, ordinal: prior.ordinal }
  if (triage.kind === 'quarantined') return { kind: 'quarantined', class: triage.class, resolvedStep, latest, basis }
  if (resolution.kind === 'ambiguous-correction') {
    return { kind: 'refused', basis, outcome: { kind: 'ambiguous-correction', runId: input.runId,
      testIndex: member.testIndex, decisionCount: resolution.decisionCount } }
  }
  const servedRecordIds = resolution.targets.flatMap(item => curation.servedIdsOn(member.steps[item.stepIndex]!))
  return { kind: 'effects', targets: resolution.targets, resolvedStep, decisionCount: resolution.decisionCount,
    knowledge: { servedRecordIds, appendsEvidence: servedRecordIds.length > 0 || input.kind === 'false-pass' },
    ...(prior?.disposition.kind === 'drafted' ? { withdraws: { proposalId: prior.disposition.proposalId,
      proposalKind: prior.disposition.proposalKind } } : {}),
    latest, basis }
}

export async function readMarkDraftFacts(input: { reader: KnowledgeReaderPort
  curation: Pick<MarkPlanCuration, 'servedIdsOn' | 'procedureReadOn' | 'readFeedbackRecord'>
  knowledgeRoot: string; member: MarkMember; step: MarkStep }): Promise<{ served: ServedRecordFacts[]; procedure?: ServedRecordFacts }> {
  const { reader, curation, knowledgeRoot, member, step } = input
  const evidenceRef = step.subActions.find(action => action.decisionScreenshotRef !== undefined)?.decisionScreenshotRef
  const readFacts = async (recordId: string) => {
    // showRecord supplies the existing guarded read. The private capability adds only
    // fields needed to construct a draft; unresolved/corrupt records are not counted.
    if ((await reader.showRecord({ recordId })).kind !== 'found') return undefined
    return curation.readFeedbackRecord({ knowledgeRoot, recordId, evidenceRef })
  }
  const served = (await Promise.all(curation.servedIdsOn(step).map(readFacts))).filter(value => value !== undefined)
  const procedureId = curation.procedureReadOn(member, step.stepIndex)
  const procedure = procedureId === undefined ? undefined : await readFacts(procedureId)
  return { served, ...(procedure === undefined ? {} : { procedure }) }
}

type ApplyFeedbackInput = Parameters<MarkPlanCuration['applyFeedback']>[0]

export function markFeedbackInput(mark: ApplyFeedbackInput['mark'], input: { handoff: CompletedRunHandoff
  member: MarkMember; step: MarkStep; served: ServedRecordFacts[]; procedure?: ServedRecordFacts }): ApplyFeedbackInput {
  const { handoff, member, step, served, procedure } = input
  return { mark, handoff, resolvedStepIndex: step.stepIndex, served,
    ...(procedure === undefined ? {} : { procedure }),
    ...(member.filePath && member.testName ? { testRef: `${member.filePath}::${member.testName}` } : {}) }
}

export type MarkDraftDecision =
  | { kind: 'knowledge'; plan: Extract<ImprovementPlan, { kind: 'knowledge' }> }
  | { kind: 'test-edit'; plan: Extract<ImprovementPlan, { kind: 'test-edit' }> }
  | { kind: 'no-draftable-fix'; checked: NoDraftableFixChecked }

/** A test edit is drafted only by a host that can invoke the authoring edit; otherwise it records drift. */
export function decideMarkDraft(plan: ImprovementPlan, input: { servedRecords: number; procedureRead: boolean
  member: MarkMember; canDraftTestEdit: boolean }): MarkDraftDecision {
  if (plan.kind === 'knowledge') return { kind: 'knowledge', plan }
  if (plan.kind === 'test-edit' && input.canDraftTestEdit) return { kind: 'test-edit', plan }
  return { kind: 'no-draftable-fix', checked: plan.kind === 'no-draftable-fix' ? plan.checked
    : { servedRecords: input.servedRecords, procedureReads: input.procedureRead ? 1 : 0, assertionDrift: true,
      ...(input.member.rootCause === undefined ? {} : { rootCause: input.member.rootCause.class }) } }
}

export type MarkDraftPreview =
  | { kind: 'confirmed-bug' }
  | { kind: 'knowledge'; fix: Extract<ImprovementPlan, { kind: 'knowledge' }>['fix']; target: KnowledgeTargetRef }
  | { kind: 'test-edit'; testRef: string }
  | { kind: 'no-draftable-fix'; checked: NoDraftableFixChecked }

export type MarkConsequencePreview =
  | MarkTargetRefusal
  | MarkPlanRefusal
  | Extract<MarkFeedbackPlan, { kind: 'already-marked' | 'quarantined' }>
  | { kind: 'consequences'; resolvedStep: MarkResolvedStep; decisionCount: number
    groundTruth: MarkGroundTruthPreview[]; labels: MarkLabelPreviewItem[]
    knowledge: { servedRecordIds: string[]; appendsEvidence: boolean }
    draft: MarkDraftPreview; withdraws?: MarkWithdrawal; latest: MarkLatest; basis: MarkPlanBasis }

export interface MarkPreviewDeps {
  configPath: string
  agentQaRoot: string
  curation?: MarkPlanCuration
  reader?: KnowledgeReaderPort
  resolveTrustPriors?: ResolveTrustPriors
  /** Mirrors a writer host that binds invokeAuthoringDraftEdit; the preview never invokes it. */
  canDraftTestEdit?: boolean
}

// applyFeedback's plan schema requires a mark id. This planning-only value never leaves the
// preview: only the draft kind, fix and target are projected, never deltas or feedback sources.
const PLANNING_MARK_ID = 'mark_000000000000'

export async function previewMarkConsequences(deps: MarkPreviewDeps, raw: unknown): Promise<MarkConsequencePreview> {
  const input = RunsMarkInputSchema.parse(raw)
  const curation = deps.curation ?? LOCAL_CURATION_CAPABILITIES
  const target = loadMarkTarget(deps.agentQaRoot, input)
  if (target.kind !== 'target') return target
  const { handoff, member, address } = target
  const ledger = new FsMarkLedger({ root: deps.agentQaRoot, runId: input.runId })
  const plan = planMarkFeedback({ input, handoff, member, address, prior: ledger.latestFor(address),
    ledgerOrdinal: ledger.read().length, curation })
  if (plan.kind === 'refused') return plan.outcome
  if (plan.kind !== 'effects') return plan
  const labels = previewMarkLabels({ handoff, address, mark: input })
  if (labels.kind !== 'labels') throw new Error('mark label preview disagrees with the resolved mark plan')
  let draft: MarkDraftPreview = { kind: 'confirmed-bug' }
  if (input.kind !== 'confirmed-bug') {
    const session = await resolveEvalSession({ configPath: deps.configPath, keyOnly: true })
    const knowledgeRoot = resolveConfiguredKnowledgeRoot(session.config, dirname(resolve(deps.configPath)))
    const reader = deps.reader ?? createKnowledgeReader(() => knowledgeRoot, undefined, undefined,
      deps.resolveTrustPriors ?? trustPriorsForHost(deps).resolve)
    const step = member.steps[plan.resolvedStep.stepIndex]!
    const { served, procedure } = await readMarkDraftFacts({ reader, curation, knowledgeRoot, member, step })
    const improvement = curation.applyFeedback(markFeedbackInput({ markId: PLANNING_MARK_ID, runId: input.runId,
      runSlug: slugBranch(input.runId), testIndex: member.testIndex,
      ...(member.testId === undefined ? {} : { testId: member.testId }),
      ...(input.stepIndex === undefined ? {} : { stepIndex: input.stepIndex }),
      kind: input.kind, ...(input.note === undefined ? {} : { note: input.note }) },
    { handoff, member, step, served, ...(procedure === undefined ? {} : { procedure }) }))
    const decided = decideMarkDraft(improvement, { servedRecords: served.length, procedureRead: procedure !== undefined,
      member, canDraftTestEdit: deps.canDraftTestEdit === true })
    draft = decided.kind === 'knowledge' ? { kind: 'knowledge', fix: decided.plan.fix, target: decided.plan.target }
      : decided.kind === 'test-edit' ? { kind: 'test-edit', testRef: decided.plan.testRef }
        : { kind: 'no-draftable-fix', checked: decided.checked }
  }
  return { kind: 'consequences', resolvedStep: plan.resolvedStep, decisionCount: plan.decisionCount,
    groundTruth: labels.groundTruth, labels: labels.labels, knowledge: plan.knowledge, draft,
    ...(plan.withdraws === undefined ? {} : { withdraws: plan.withdraws }), latest: plan.latest, basis: plan.basis }
}
