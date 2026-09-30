// A pre-432 knowledge proposal on disk, filed the way the retired `knowledge.*.propose` ops filed
// it (432-12, D-05).
//
// Since 432-12 the three knowledge changes apply in the call and nothing files a knowledge
// proposal. The inbox, `knowledge.proposal.apply` and `proposals.accept`/`reject` still read the
// records already on disk until 432-17 deletes them, so the suites that measure that path start
// from a record this helper writes through the same review port member the ops used to reach, with
// the same attribution (`emittedBy` is the retired op id, `runId` the caller's run).

import type { KnowledgeTargetRef } from '@vostride/agent-qa-schema'

import { createKnowledgeReview } from '../composition/compose-local-agent.js'

export type Pre432KnowledgeVerb = 'accept' | 'reject' | 'forget'

export interface FilePre432KnowledgeProposalInput {
  readonly agentQaRoot: string
  readonly knowledgeRoot: string
  readonly verb: Pre432KnowledgeVerb
  readonly target: KnowledgeTargetRef
  /** Required by a reject, as the retired op's input contract required it. */
  readonly reason?: string
  readonly runId?: string
}

/** File one pre-432 knowledge proposal and answer its id. Throws if the target names nothing. */
export async function filePre432KnowledgeProposal(input: FilePre432KnowledgeProposalInput): Promise<string> {
  const review = createKnowledgeReview({
    agentQaRoot: input.agentQaRoot,
    resolveKnowledgeRoot: () => input.knowledgeRoot,
  })
  const request = input.verb === 'reject'
    ? { verb: 'reject' as const, input: { target: input.target, reason: input.reason ?? 'rejected' } }
    : { verb: input.verb, input: { target: input.target } }
  const outcome = await review.propose(request, {
    emittedBy: `knowledge.${input.verb}.propose`,
    ...(input.runId === undefined ? {} : { runId: input.runId }),
  })
  if (outcome.kind !== 'proposed') throw new Error(`fixture propose failed: ${outcome.kind}`)
  return outcome.proposal.proposalId
}
