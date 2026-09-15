// 2026-09-15, 423 D-19: the read-only half of the feedback host. It reads the mark ledger and
// observes each drafted proposal through the store's classifier, and never takes the run lock,
// reaps a claim, touches an in-flight intent or creates a directory.
// 2026-09-15, 423 D-16/D-17: preview runs runs.mark's shared plan with the same guarantees, and
// takes only read capabilities: no lease, ledger transaction, freeze, wording model or writer.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { KnowledgeReaderPort } from '@vostride/agent-qa-agent'
import { LOCAL_KNOWLEDGE_PROBES } from '@vostride/agent-qa-agent-local'
import { RunsMarkInputSchema, type FeedbackReadsPort, type MarkHistoryReadEntry, type MarkPreviewBasis, type MarkProposalCurrent, type MarkReceipt, type RunsMarkPreviewResult } from '@vostride/agent-qa-schema'
import type { ResolveTrustPriors } from '../curation/trust-priors.js'
import { FsMarkLedger, HANDOFF_FILE, MarkLedgerCorruptError, RUNS_SUBDIR, slugBranch } from '../eval-session-composition.js'
import { previewMarkConsequences, type MarkPlanBasis, type MarkPlanCuration } from './feedback-plan.js'

export interface FeedbackReadsHostDeps {
  agentQaRoot: string
  now?: () => number
  isProcessAlive?: (pid: number) => boolean
  /** The project config that locates the knowledge root. Without it the host binds history only. */
  configPath?: string
  /** Read halves only: the preview's type admits no append, withdrawal, draft filing or lease. */
  curation?: MarkPlanCuration
  reader?: KnowledgeReaderPort
  resolveTrustPriors?: ResolveTrustPriors
  /** Mirrors a writer host that binds the authoring draft edit; the preview never invokes it. */
  canDraftTestEdit?: boolean
}

const basisOf = (basis: MarkPlanBasis): MarkPreviewBasis => ({ ledgerOrdinal: basis.ledgerOrdinal,
  ...(basis.priorOrdinal === undefined ? {} : { priorMarkOrdinal: basis.priorOrdinal }) })

/** Only an unparseable file is a corrupt proposal; filesystem and host failures propagate. */
function isUnparseableProposal(error: unknown): boolean {
  return error instanceof SyntaxError || (error as Error | undefined)?.name === 'ZodError'
    // The store's named refusal for a kind no schema in this build can read.
    || (error instanceof TypeError && error.message.includes('proposal of unknown kind'))
}

export function createFeedbackReadsPortForHost(deps: FeedbackReadsHostDeps): FeedbackReadsPort {
  function proposalOf(receipt: MarkReceipt, now: number): MarkProposalCurrent | undefined {
    if (receipt.disposition.kind !== 'drafted') return undefined
    const { proposalId, proposalKind } = receipt.disposition
    let observed
    try {
      observed = LOCAL_KNOWLEDGE_PROBES.observeProposalEnvelope(deps.agentQaRoot, proposalId, {
        now, ...(deps.isProcessAlive === undefined ? {} : { isProcessAlive: deps.isProcessAlive }) })
    } catch (error) {
      if (!isUnparseableProposal(error)) throw error
      return { state: 'corrupt' }
    }
    if (observed === undefined) return { state: 'missing' }
    const { envelope, applyInFlight } = observed
    // An id that names a different kind of proposal is not the draft this receipt recorded.
    if (envelope.kind !== proposalKind) return { state: 'corrupt' }
    switch (envelope.status) {
      case 'pending':
      case 'expired':
        return { state: envelope.status, applyInFlight }
      case 'applied':
      case 'rejected':
        return { state: envelope.status, ...(envelope.decision === undefined ? {} : { decision: envelope.decision }) }
      default:
        return envelope.status satisfies never
    }
  }

  const configPath = deps.configPath
  async function preview(raw: unknown): Promise<RunsMarkPreviewResult> {
    const input = RunsMarkInputSchema.parse(raw)
    const previewed = await previewMarkConsequences({ configPath: configPath!, agentQaRoot: deps.agentQaRoot,
      ...(deps.curation === undefined ? {} : { curation: deps.curation }),
      ...(deps.reader === undefined ? {} : { reader: deps.reader }),
      ...(deps.resolveTrustPriors === undefined ? {} : { resolveTrustPriors: deps.resolveTrustPriors }),
      canDraftTestEdit: deps.canDraftTestEdit === true }, input)
    const prospective = { runId: input.runId, prospective: true as const, markKind: input.kind }
    switch (previewed.kind) {
      case 'run-not-found':
      case 'member-not-found':
      case 'ambiguous-address':
      case 'step-not-found':
      case 'ambiguous-correction':
        return previewed
      case 'already-marked': {
        const { receipt } = previewed
        return { kind: 'already-marked', runId: input.runId, basis: basisOf(previewed.basis), prior: {
          markId: receipt.markId, kind: receipt.kind, ordinal: receipt.ordinal, testIndex: receipt.testIndex,
          ...(receipt.testId === undefined ? {} : { testId: receipt.testId }),
          ...(receipt.stepIndex === undefined ? {} : { stepIndex: receipt.stepIndex }),
          disposition: receipt.disposition } }
      }
      case 'quarantined':
        return { kind: 'quarantined', ...prospective, member: previewed.member, resolvedStep: previewed.resolvedStep,
          class: previewed.class, latest: previewed.latest, basis: basisOf(previewed.basis) }
      case 'consequences':
        return { kind: 'consequences', ...prospective, member: previewed.member, resolvedStep: previewed.resolvedStep,
          markedDecisionCount: previewed.decisionCount,
          groundTruth: previewed.groundTruth.map(item => ({ testIndex: item.testIndex, stepIndex: item.stepIndex,
            verdict: item.verdict, recordedVerdict: { pass: item.recordedVerdict.pass, reasoning: item.recordedVerdict.reasoning },
            ...(item.correctedExpectation === undefined ? {} : { correctedExpectation: item.correctedExpectation }),
            correctedAction: item.correctedAction !== undefined })),
          // The overturned verdict and corrected content stay in groundTruth; a label reports its verdict only.
          labels: previewed.labels.map(label => ({ testIndex: label.testIndex, stepIndex: label.stepIndex,
            decisionOrdinal: label.decisionOrdinal, sourceCassetteId: label.sourceCassetteId, channel: label.channel,
            ...(label.correction === undefined ? {} : { correction: { verdict: label.correction.verdict } }) })),
          knowledge: previewed.knowledge, draft: previewed.draft,
          ...(previewed.withdraws === undefined ? {} : { withdraws: previewed.withdraws }),
          latest: previewed.latest, basis: basisOf(previewed.basis) }
      default:
        return previewed satisfies never
    }
  }

  return {
    ...(configPath === undefined ? {} : { preview }),
    async history(runId) {
      if (!existsSync(join(deps.agentQaRoot, RUNS_SUBDIR, slugBranch(runId), HANDOFF_FILE))) return { kind: 'run-not-found' }
      let receipts: MarkReceipt[]
      try {
        receipts = new FsMarkLedger({ root: deps.agentQaRoot, runId }).read()
      } catch (error) {
        if (error instanceof MarkLedgerCorruptError) return { kind: 'ledger-corrupt', line: error.line }
        return { kind: 'ledger-unavailable' }
      }
      const now = (deps.now ?? Date.now)()
      const entries: MarkHistoryReadEntry[] = receipts.map(receipt => {
        const proposal = proposalOf(receipt, now)
        return proposal === undefined ? { receipt } : { receipt, proposal }
      })
      return { kind: 'history', entries }
    },
  }
}
