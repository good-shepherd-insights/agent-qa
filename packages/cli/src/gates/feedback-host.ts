import { dirname, resolve } from 'node:path'
import { trustPriorsForHost, type ResolveTrustPriors } from '../curation/trust-priors.js'
import type { KnowledgeReaderPort } from '@vostride/agent-qa-agent'
import type { FeedbackPort } from '@vostride/agent-qa-schema'
import { RUNS_MARK_FUNCTION_ID } from '@vostride/agent-qa-agent'
import { createKnowledgeReader, createKnowledgeReview, LOCAL_CURATION_CAPABILITIES, type LocalCurationCapabilities } from '@vostride/agent-qa-agent-local'
import { RunsMarkInputSchema, type AuthoringDraftEditInput, type AuthoringDraftEditOutput, type MarkReceipt, type RunsMarkOutcome } from '@vostride/agent-qa-schema'
import { resolveConfiguredKnowledgeRoot } from '../config.js'
import { wordImprovementPlan } from './feedback-wording.js'
import { decideMarkDraft, loadMarkTarget, markEvidenceCurationJobIds, markFeedbackInput, planMarkFeedback, readMarkDraftFacts } from './feedback-plan.js'
import { resolveEvalSession, resolveProductPartition, FsMarkLedger, freezeGoldenTrajectory, slugBranch } from '../eval-session-composition.js'

export { resolveMarkMember } from './feedback-plan.js'

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

/** One lazy host, shared by every function surface. Freeze/evidence stay under the run lock. */
export function createFeedbackPortForHost(deps: FeedbackHostDeps): FeedbackPort {
  const resolveTrustPriors = deps.resolveTrustPriors ?? trustPriorsForHost(deps).resolve
  const curation = deps.curation ?? LOCAL_CURATION_CAPABILITIES
  const ledgerFor = (runId: string) => new FsMarkLedger({ root: deps.agentQaRoot, runId })
  return {
    async marksFor(runId) { return ledgerFor(runId).latestPerAddress() },
    async mark(raw) {
      const input = RunsMarkInputSchema.parse(raw)
      const target = loadMarkTarget(deps.agentQaRoot, input)
      if (target.kind !== 'target') return target
      const { handoff, member, address } = target
      const ledger = ledgerFor(input.runId)
      let refusal: RunsMarkOutcome | undefined
      const receipt = await ledger.transact(async ordinal => {
        const prior = ledger.latestFor(address)
        // The preview plans from these same facts; only this transaction's plan carries authority.
        const planned = planMarkFeedback({ input, handoff, member, address, prior, ledgerOrdinal: ordinal - 1, curation })
        if (planned.kind === 'already-marked') {
          refusal = { kind: 'already-marked', receipt: planned.receipt }
          return undefined
        }
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
        if (planned.kind === 'refused') {
          refusal = planned.outcome
          return undefined
        }
        if (planned.kind === 'quarantined') {
          mark.disposition = { kind: 'quarantined', class: planned.class }
          return mark
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
        const { servedRecordIds } = planned.knowledge
        if (intent.stage === 'prepared' && planned.knowledge.appendsEvidence) {
          const lease = curation.maintenance.acquireWriterLease(knowledgeRoot)
          if (lease.kind !== 'acquired') throw new Error(`Mark evidence writer lease ${lease.kind}; gold landed, no mark receipt appended`)
          try {
            const evidence = await curation.appendMarkEvidence({ knowledgeRoot, auditBaseDir: deps.agentQaRoot,
              executionContext: session.executionContext, lease: { leaseId: lease.leaseId, epoch: lease.epoch },
              mark, servedRecordIds, handoff,
              includeAlreadyAppended: true,
              curationJobIds: markEvidenceCurationJobIds(input.runId) })
            if (evidence.correlationIncomplete) throw new Error('Mark evidence correlation incomplete; gold/evidence may have landed, no receipt appended')
            mark.evidence = { confirmed: evidence.confirmed, overturned: evidence.overturned }
          } finally { curation.maintenance.releaseLease({ knowledgeRoot, leaseId: lease.leaseId }) }
        }
        intent = ledger.checkpointIntent({ ...intent, mark, stage: 'evidence' })
        if (input.kind === 'confirmed-bug') {
          mark.disposition = { kind: 'confirmed-bug', confirmedRecords: mark.evidence.confirmed }
        } else {
          const step = member.steps[planned.resolvedStep.stepIndex]!
          const reader = deps.reader ?? createKnowledgeReader(() => knowledgeRoot, undefined, undefined, resolveTrustPriors)
          const { served, procedure } = await readMarkDraftFacts({ reader, curation, knowledgeRoot, member, step })
          let plan = intent.plan ?? curation.applyFeedback(markFeedbackInput(mark,
            { handoff, member, step, served, ...(procedure === undefined ? {} : { procedure }) }))
          if (intent.plan === undefined) plan = await (deps.word ?? wordImprovementPlan)({ plan, config: session.config,
            executionContext: session.executionContext,
            maskingContextFactory: async () => (await resolveEvalSession({ configPath: deps.configPath })).maskingContextFactory(),
            auditDir: resolve(deps.agentQaRoot, 'eval', 'audit', 'mark-wording', mark.markId) })
          intent = ledger.checkpointIntent({ ...intent, mark, plan })
          const draft = decideMarkDraft(plan, { servedRecords: served.length, procedureRead: procedure !== undefined,
            member, canDraftTestEdit: deps.invokeAuthoringDraftEdit !== undefined })
          if (draft.kind === 'knowledge') {
            const knowledgePlan = draft.plan
            const review = createKnowledgeReview({ agentQaRoot: deps.agentQaRoot, resolveKnowledgeRoot: () => knowledgeRoot,
              resolveTrustPriors,
              proposalIdentity: { uuid: intent.proposalUuid, at: mark.markedAt } })
            const proposed = await review.propose({ verb: 'mark', input: { target: knowledgePlan.target,
              mark: { runId: mark.runId, testIndex: mark.testIndex,
                ...(mark.stepIndex === undefined ? {} : { stepIndex: mark.stepIndex }),
                markId: mark.markId, kind: mark.kind, fix: knowledgePlan.fix }, plan: knowledgePlan } },
            { emittedBy: RUNS_MARK_FUNCTION_ID, runId: mark.runId })
            if (proposed.kind !== 'proposed') throw new Error('Mark draft target disappeared; gold/evidence landed, no mark receipt appended')
            mark.disposition = { kind: 'drafted', fix: knowledgePlan.fix, proposalId: proposed.proposal.proposalId, proposalKind: 'knowledge' }
          } else if (draft.kind === 'test-edit') {
            // decideMarkDraft admits a test edit only when this host binds the authoring edit.
            const edited = intent.testDraft ?? await deps.invokeAuthoringDraftEdit!({ testRef: draft.plan.testRef, intent: draft.plan.intent })
            intent = ledger.checkpointIntent({ ...intent, mark, testDraft: edited })
            const proposalId = curation.fileMarkTestDraft({ agentQaRoot: deps.agentQaRoot, runId: mark.runId, proposal: edited.proposal,
              identity: { uuid: intent.proposalUuid, at: mark.markedAt } })
            mark.disposition = { kind: 'drafted', fix: 'test-edit', proposalId, proposalKind: 'test-draft' }
          } else {
            mark.disposition = { kind: 'no-draftable-fix', checked: draft.checked }
          }
        }
        ledger.checkpointIntent({ ...intent, mark, stage: 'drafted' })
        }
        if (planned.withdraws !== undefined) {
          await curation.withdrawPendingProposal({ agentQaRoot: deps.agentQaRoot,
            proposalId: planned.withdraws.proposalId, proposalKind: planned.withdraws.proposalKind,
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
