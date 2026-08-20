// `grants.revoke` — taking back what was granted (Phase 391, D-03 · D-05 · D-06).
//
// Ships beside `grants.list` and in the same phase as the mint, because an approval that can be
// given and not withdrawn is not an approval, it is a one-way door. One committed `revoke` event,
// addressed by the grant's durable id and nothing else — the ledger's own rule, so a revoke cannot
// miss the grant it was written for by re-deriving a match.
//
// `requiresHumanOrigin: true`, and this is the second shipped client of the 391-02 mechanism. The
// reasoning is the mirror of `proposals.accept`'s rather than a copy of it: an agent that could
// revoke could not widen its own autonomy, but it could REMOVE the record of a widening — and the
// committed ledger's whole value is that a pull request shows every change to what the agent may do
// unasked. A session that could quietly retire lines from that file would be curating the evidence
// a human reviews. Refused as DATA on the op, checked once at the single dispatch pipeline, never
// as a branch on which surface called.
//
// `approval-write`, on 391-02's argument: the power to change what the system LEARNED is not the
// power to change what it may do WITHOUT ASKING, and this verb changes only the second.
//
// `declaredTier: 'mutating-shared'` — an ASK, deliberately, and the cost is stated rather than
// discovered. This writes the COMMITTED knowledge tree, which travels in pull requests to everyone
// sharing the repository, so it is not this machine's business alone; and unlike a reject, it is
// not reversible by re-proposing — the approval it withdraws has to be granted again through a new
// decision. In a fail-closed context (which is every context except an interactive terminal) a
// revoke with no covering credential therefore denies, and the way through is an interactive
// confirmation or session trust.
//
// AND IT CAN NEVER BE A STANDING GRANT'S WAY THROUGH. `fn:grants.revoke` is a member of the closed
// PROTECTED set (D-05), so the ask this tier raises is one no approval may ever satisfy — a session
// that could pre-approve revocation would have talked its way out of the constraint by removing it.
// That is the self-reference D-06 and D-05 close TOGETHER, and it is why this op carries both the
// origin requirement and a protected class rather than either alone.

import { GrantsRevokeInputSchema, GrantsRevokeOutputSchema } from '@vostride/agent-qa-schema'
import type { GrantsRevokeInput, GrantsRevokeOutput } from '@vostride/agent-qa-schema'

import { FunctionNotBoundError } from '../spec.js'
import type { ClauseVerdict, FunctionDeps, FunctionSpec } from '../spec.js'

/** The literal appears here once; every surface names the constant (384 D-15). */
export const GRANTS_REVOKE_FUNCTION_ID = 'grants.revoke'

export const grantsRevokeSpec: FunctionSpec<GrantsRevokeInput, GrantsRevokeOutput> = {
  id: GRANTS_REVOKE_FUNCTION_ID,
  summary: 'Withdraw one standing approval, recording the withdrawal permanently.',
  requiredScopes: ['approval-write'],
  requiresHumanOrigin: true,
  resultKind: 'unary',
  boundThrough: 'standingGrants',
  input: GrantsRevokeInputSchema,
  output: GrantsRevokeOutputSchema,
  risk: {
    name: `fn:${GRANTS_REVOKE_FUNCTION_ID}`,
    recognized: true,
    readOnly: false,
    declaredTier: 'mutating-shared',
  },
  /**
   * `no-grant` IS AN ORDINARY ANSWER — the contract says so in its own header (399.1 D-01).
   *
   * "An id pasted out of a stale listing, a second click, a grant somebody else already withdrew."
   * None of those is a control declining an act; each is the ledger reporting what the caller
   * found. Both arms are `executed`, and the outcome says which.
   */
  classify(output): ClauseVerdict {
    switch (output.outcome) {
      case 'revoked':
        return { status: 'executed', outcome: `revoked ${output.grant.grantId}` }
      case 'no-grant':
        return { status: 'executed', outcome: `no-grant: ${output.grantId}` }
      default:
        return output satisfies never
    }
  },
  async invoke(input, deps: FunctionDeps) {
    const grants = deps.standingGrants
    if (grants === undefined) {
      // An unbound WRITE verb must refuse loudly. A silent no-op would tell an operator their
      // revoke landed while the approval stayed in force, and the next unasked commit would be the
      // first sign otherwise.
      throw new FunctionNotBoundError(GRANTS_REVOKE_FUNCTION_ID)
    }

    // NO-GRANT IS AN ARM, never a throw — the same posture the inbox's decision verbs take. An id
    // pasted out of a stale listing, a second click, or a grant a colleague already withdrew are
    // all ordinary, and each is answered with what actually happened.
    return await grants.revoke(input)
  },
}
