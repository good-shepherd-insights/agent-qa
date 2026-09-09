import { dirname, resolve } from 'node:path'
import { trustPriorsForHost, type ResolveTrustPriors } from '../curation/trust-priors.js'
import type { KnowledgeReaderPort } from '@vostride/agent-qa-agent'
import type { FeedbackPort } from '@vostride/agent-qa-schema'
import { chainJobIdsForRun, RUNS_MARK_FUNCTION_ID } from '@vostride/agent-qa-agent'
import { createKnowledgeReader, createKnowledgeReview, DIGEST_JOB_ID_SOURCE, LOCAL_CURATION_CAPABILITIES, type LocalCurationCapabilities } from '@vostride/agent-qa-agent-local'
import { RunsMarkInputSchema, type AuthoringDraftEditInput, type AuthoringDraftEditOutput, type CompletedRunHandoff, type MarkReceipt, type RunsMarkOutcome } from '@vostride/agent-qa-schema'
import { resolveConfiguredKnowledgeRoot } from '../config.js'
import { wordImprovementPlan } from './feedback-wording.js'
import { canonicalJson, resolveEvalSession, markedDecisionCount, resolveMarkedDecisions, resolveProductPartition, FsHandoffSource, FsMarkLedger, freezeGoldenTrajectory, slugBranch } from '../eval-session-composition.js'

export interface FeedbackHostDeps {
  resolveTrustPriors?: ResolveTrustPriors
  configPath: string
  agentQaRoot: string
  invokeAuthoringDraftEdit?: (input: AuthoringDraftEditInput) => Promise<AuthoringDraftEditOutput>
  curation?: Pick<LocalCurationCapabilities, 'appendMarkEvidence' | 'triageMark' | 'servedIdsOn' | 'procedureReadOn' | 'applyFeedback' | 'withdrawPendingProposal' | 'readFeedbackRecord' | 'fileMarkTestDraft'> & {
    maintenance: Pick<LocalCurationCapabilities['maintenance'], 'acquireWriterLease' | 'releaseLease'>
  }
  reader?: KnowledgeReaderPort
  now?: () => number
  randomUuid: () => string
  word?: typeof wordImprovementPlan
}

export class FeedbackFreezeRefusedError extends Error {
  constructor(readonly outcome: unknown) {
    super('Gold freeze refused; no mark receipt appended. Inspect the committed eval root before retrying: some gold cases may already have landed.')
    this.name = 'FeedbackFreezeRefusedError'
  }
}

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

/** One lazy host, shared by every function surface. Freeze/evidence stay under the run lock. */
export function createFeedbackPortForHost(deps: FeedbackHostDeps): FeedbackPort {
  const resolveTrustPriors = deps.resolveTrustPriors ?? trustPriorsForHost(deps).resolve
  const curation = deps.curation ?? LOCAL_CURATION_CAPABILITIES
  const ledgerFor = (runId: string) => new FsMarkLedger({ root: deps.agentQaRoot, runId })
  return {
    async marksFor(runId) { return ledgerFor(runId).latestPerAddress() },
    async mark(raw) {
      const input = RunsMarkInputSchema.parse(raw)
      let handoff: CompletedRunHandoff
      try { handoff = new FsHandoffSource({ root: deps.agentQaRoot, runId: input.runId }).load() }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'run-not-found', runId: input.runId }
        throw error
      }
      const resolved = resolveMarkMember(handoff, input.testId)
      if (resolved.kind !== 'member') return resolved
      const { member } = resolved
      const address = { runId: input.runId, testIndex: member.testIndex,
        ...(member.testId === undefined ? {} : { testId: member.testId }),
        ...(input.stepIndex === undefined ? {} : { stepIndex: input.stepIndex }) }
      const ledger = ledgerFor(input.runId)
      let refusal: RunsMarkOutcome | undefined
      const receipt = await ledger.transact(async ordinal => {
        const prior = ledger.latestFor(address)
        if (prior?.kind === input.kind && prior.correctedExpectation === input.correctedExpectation
          && canonicalJson(prior.correctedAction ?? null) === canonicalJson(input.correctedAction ?? null)) {
          refusal = { kind: 'already-marked', receipt: prior }
          return undefined
        }
        const triage = curation.triageMark(member)
        let mark: MarkReceipt = {
          schemaVersion: 1, ...input, ...address, runSlug: slugBranch(input.runId),
          markId: `mark_${deps.randomUuid().replace(/-/g, '').slice(0, 12)}`,
          origin: 'user', ordinal, markedAt: (deps.now ?? Date.now)(),
          gold: [], evidence: { confirmed: 0, overturned: 0 },
          disposition: { kind: 'confirmed-bug', confirmedRecords: 0 },
          ...(prior === undefined ? {} : { supersedes: prior.markId }),
          ...(member.rootCause === undefined ? {} : { rootCause: {
            class: member.rootCause.class, producer: member.rootCause.producer } }),
          ...(member.isRerun === true ? { isRerun: true } : {}),
        }
        const targets = resolveMarkedDecisions(handoff, address, input.kind)
        if ('refusal' in targets) {
          refusal = { kind: 'step-not-found', ...address, stepIndex: input.stepIndex ?? 0, stepCount: targets.stepCount }
          // The outcome schema exposes the numeric address only.
          delete (refusal as { testId?: string }).testId
          return undefined
        }
        if (triage.kind === 'quarantined') {
          mark.disposition = { kind: 'quarantined', class: triage.class }
          return mark
        }
        const decisionCount = markedDecisionCount(handoff, targets)
        if (input.correctedAction !== undefined && decisionCount !== 1) {
          refusal = { kind: 'ambiguous-correction', runId: input.runId, testIndex: member.testIndex, decisionCount }
          return undefined
        }
        let intent = ledger.prepareIntent(mark, deps.randomUuid())
        mark = intent.mark
        if (intent.stage !== 'drafted') {
        const session = await resolveEvalSession({ configPath: deps.configPath, keyOnly: true })
        const configDir = dirname(resolve(deps.configPath))
        const frozen = freezeGoldenTrajectory({ agentQaRoot: deps.agentQaRoot,
          committedRoot: resolve(configDir, 'agent-qa-eval'), product: resolveProductPartition(handoff.scope),
          mark, handoff, ...(prior === undefined ? {} : { priorGold: prior.gold }) })
        if (frozen.kind !== 'frozen' || frozen.census === 'write-conflict') throw new FeedbackFreezeRefusedError(frozen)
        mark.gold = frozen.cases
        const knowledgeRoot = resolveConfiguredKnowledgeRoot(session.config, configDir)
        const servedRecordIds = targets.flatMap(target => curation.servedIdsOn(member.steps[target.stepIndex]!))
        if (intent.stage === 'prepared' && (servedRecordIds.length > 0 || input.kind === 'false-pass')) {
          const lease = curation.maintenance.acquireWriterLease(knowledgeRoot)
          if (lease.kind !== 'acquired') throw new Error(`Mark evidence writer lease ${lease.kind}; gold landed, no mark receipt appended`)
          try {
            const evidence = await curation.appendMarkEvidence({ knowledgeRoot, auditBaseDir: deps.agentQaRoot,
              executionContext: session.executionContext, lease: { leaseId: lease.leaseId, epoch: lease.epoch },
              mark, servedRecordIds, handoff,
              includeAlreadyAppended: true,
              curationJobIds: [chainJobIdsForRun(input.runId, DIGEST_JOB_ID_SOURCE).curateMemory] })
            if (evidence.correlationIncomplete) throw new Error('Mark evidence correlation incomplete; gold/evidence may have landed, no receipt appended')
            mark.evidence = { confirmed: evidence.confirmed, overturned: evidence.overturned }
          } finally { curation.maintenance.releaseLease({ knowledgeRoot, leaseId: lease.leaseId }) }
        }
        intent = ledger.checkpointIntent({ ...intent, mark, stage: 'evidence' })
        if (input.kind === 'confirmed-bug') {
          mark.disposition = { kind: 'confirmed-bug', confirmedRecords: mark.evidence.confirmed }
        } else {
          const step = member.steps[targets[0]!.stepIndex]!
          const reader = deps.reader ?? createKnowledgeReader(() => knowledgeRoot, undefined, undefined, resolveTrustPriors)
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
          let plan = intent.plan ?? curation.applyFeedback({ mark, handoff, resolvedStepIndex: step.stepIndex, served,
            ...(procedure === undefined ? {} : { procedure }),
            ...(member.filePath && member.testName ? { testRef: `${member.filePath}::${member.testName}` } : {}) })
          if (intent.plan === undefined) plan = await (deps.word ?? wordImprovementPlan)({ plan, config: session.config,
            executionContext: session.executionContext,
            maskingContextFactory: async () => (await resolveEvalSession({ configPath: deps.configPath })).maskingContextFactory(),
            auditDir: resolve(deps.agentQaRoot, 'eval', 'audit', 'mark-wording', mark.markId) })
          intent = ledger.checkpointIntent({ ...intent, mark, plan })
          if (plan.kind === 'knowledge') {
            const review = createKnowledgeReview({ agentQaRoot: deps.agentQaRoot, resolveKnowledgeRoot: () => knowledgeRoot,
              resolveTrustPriors,
              proposalIdentity: { uuid: intent.proposalUuid, at: mark.markedAt } })
            const proposed = await review.propose({ verb: 'mark', input: { target: plan.target,
              mark: { runId: mark.runId, testIndex: mark.testIndex,
                ...(mark.stepIndex === undefined ? {} : { stepIndex: mark.stepIndex }),
                markId: mark.markId, kind: mark.kind, fix: plan.fix }, plan } },
            { emittedBy: RUNS_MARK_FUNCTION_ID, runId: mark.runId })
            if (proposed.kind !== 'proposed') throw new Error('Mark draft target disappeared; gold/evidence landed, no mark receipt appended')
            mark.disposition = { kind: 'drafted', fix: plan.fix, proposalId: proposed.proposal.proposalId, proposalKind: 'knowledge' }
          } else if (plan.kind === 'test-edit' && deps.invokeAuthoringDraftEdit !== undefined) {
            const edited = intent.testDraft ?? await deps.invokeAuthoringDraftEdit({ testRef: plan.testRef, intent: plan.intent })
            intent = ledger.checkpointIntent({ ...intent, mark, testDraft: edited })
            const proposalId = curation.fileMarkTestDraft({ agentQaRoot: deps.agentQaRoot, runId: mark.runId, proposal: edited.proposal,
              identity: { uuid: intent.proposalUuid, at: mark.markedAt } })
            mark.disposition = { kind: 'drafted', fix: 'test-edit', proposalId, proposalKind: 'test-draft' }
          } else {
            mark.disposition = { kind: 'no-draftable-fix', checked: plan.kind === 'no-draftable-fix' ? plan.checked
              : { servedRecords: served.length, procedureReads: procedure === undefined ? 0 : 1, assertionDrift: true,
                ...(member.rootCause === undefined ? {} : { rootCause: member.rootCause.class }) } }
          }
        }
        ledger.checkpointIntent({ ...intent, mark, stage: 'drafted' })
        }
        if (prior?.disposition.kind === 'drafted') {
          await curation.withdrawPendingProposal({ agentQaRoot: deps.agentQaRoot,
            proposalId: prior.disposition.proposalId, proposalKind: prior.disposition.proposalKind,
            reason: `superseded by ${mark.markId}` })
        }
        return mark
      })
      if (receipt !== undefined) return { kind: 'marked', receipt }
      if (refusal !== undefined) return refusal
      throw new Error('Mark transaction returned neither a receipt nor a refusal')
    },
  }
}
