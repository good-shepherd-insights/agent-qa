// 2026-09-15, 423 D-19: the read-only half of the feedback host. It reads the mark ledger and
// observes each drafted proposal through the store's classifier, and never takes the run lock,
// reaps a claim, touches an in-flight intent or creates a directory.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LOCAL_KNOWLEDGE_PROBES } from '@vostride/agent-qa-agent-local'
import type { FeedbackReadsPort, MarkHistoryReadEntry, MarkProposalCurrent, MarkReceipt } from '@vostride/agent-qa-schema'
import { FsMarkLedger, HANDOFF_FILE, MarkLedgerCorruptError, RUNS_SUBDIR, slugBranch } from '../eval-session-composition.js'

export interface FeedbackReadsHostDeps {
  agentQaRoot: string
  now?: () => number
  isProcessAlive?: (pid: number) => boolean
}

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

  return {
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
