// `config.proposal.apply` — the ONE op through which committed configuration can change
// (Phase 395, D-01 · CFGM-03). The twin of `knowledge.proposal.apply`, and its header's laws hold
// here word for word.
//
// IT TAKES AN ID AND NEVER A PROPOSAL DOCUMENT. A caller that could hand back an edited proposal
// would be able to commit bytes nothing ever rendered and nobody ever reviewed — which is the whole
// reason propose and apply are two steps. The bytes that get committed are the ones a construction
// wrote down and a person looked at, read back off the durable store by the process doing the
// commit.
//
// ALREADY-APPLIED IS AN ARM OF THE RESULT, NEVER A THROW, and it carries the ORIGINAL receipt. A
// retrying surface — a dropped socket, a re-issued MCP call, an operator pressing the key twice —
// must be able to learn that its apply already happened AND what it did; a throw would say the first
// half while discarding the receipt, which is the one thing the caller asked for. That is CFGM-03's
// idempotency edge, and the port answers it by finding its own commit in the person's git history
// rather than by keeping a second ledger of what it has done.
//
// WHY THE RAISE TO `mutating-shared`. `mutating-local` allows in EVERY execution context by ratified
// spec, so this op — the one place committed config changes — would never be asked about, and a
// standing approval can only ever satisfy an ASK. It is also the honest classification on its own:
// committed configuration travels in pull requests to everyone sharing the repository. It is not
// this machine's business alone. The cost, stated rather than discovered: in a fail-closed context —
// every context except an interactive terminal — an apply with no covering grant and no credential
// DENIES. The ways through are a recorded standing approval, an interactive confirmation, or session
// trust.
//
// ITS CLASS IS GRANTABLE, unlike the test-draft and finding kinds. `fn:config.proposal.apply` is a
// registered op's own `risk.name` and is NOT a member of the closed protected set, so a person may
// accept-with-always over config applies — which is D-02's design: the per-proposal `crossBoundary`
// flag, not the class, is what a flagged proposal is refused by.
//
// WHICH MAKES THIS FILE THE READ HALF OF D-02 (395-07), and the placement is the decision. The gate
// compares `grant.actionClass === action.name` and is never handed a proposal, so the per-value
// flag cannot reach `resolveAsk` without widening the safety package's contract. What CAN reach it
// is this op, which holds the envelope one layer down — so the filter is applied here, to the
// answer rather than to the question: a covering grant is treated as NOT matching when the proposal
// it would authorize is flagged, and the apply refuses by name instead.
//
// IT IS THE ONLY PLACE THE FILTER BELONGS, because it is the only class a grant can cover on this
// road. `proposals.accept` — the surface a person actually uses — carries `fn:proposals.accept`,
// which is in the closed protected set, so `grantsFor` refuses to return a covering line for it at
// all and its config route already requires an individual human decision by construction. A second
// copy of this filter there would guard a consultation that never happens.
//
// AND THE TWO HALVES ARE INDEPENDENT, which is the whole argument for spending two guards on one
// rule (391 D-05's own words, one contract over). The MINT half in `proposals-accept.ts` stops a
// flagged proposal from AUTHORING a standing approval. It cannot stop a grant that is already in
// the file — one minted from a perfectly ordinary in-scope proposal covers the class, and
// `grants.jsonl` is a committed artifact anything with write access to a checkout can append to by
// hand. This half is what refuses at the moment such a line would authorize something.

import { ConfigApplyOutcomeSchema, ConfigProposalApplyInputSchema } from '@vostride/agent-qa-schema'
import type {
  ConfigApplyOutcome,
  ConfigProposalApplyInput,
  CrossBoundaryReason,
} from '@vostride/agent-qa-schema'

import { applyablePayload } from '../../config-mutation/construct.js'
import { FunctionNotBoundError } from '../spec.js'
import type { FunctionDeps, FunctionSpec } from '../spec.js'

export const CONFIG_PROPOSAL_APPLY_FUNCTION_ID = 'config.proposal.apply'

/**
 * The proposal is not a config proposal, or is not there to apply.
 *
 * NAMED rather than folded into a generic parse failure: an id that addresses a knowledge proposal
 * is a person or a script pointing the wrong verb at the right artifact, and the message that helps
 * them says which kind they actually named.
 */
export class ConfigProposalNotApplicableError extends Error {
  constructor(readonly proposalId: string, readonly found: string) {
    super(
      `refusing to apply ${JSON.stringify(proposalId)} as a config proposal: ${found}. `
      + 'Config applies commit configuration files; use the verb that matches the proposal\'s kind.',
    )
    this.name = 'ConfigProposalNotApplicableError'
  }
}

/**
 * A standing approval covering this class was in force, and the proposal crosses a boundary
 * no standing approval may span (D-02, read half).
 *
 * NAMES BOTH FACTS AND THE WAY THROUGH. "Denied" alone would send a person to look for a policy
 * they cannot find; what they need to read is that their grant is fine, this proposal is not
 * covered by it, and the individual decision is one verb away. The recovery names
 * `proposals accept` because that verb's own class is protected — it is the surface where a
 * cross-boundary change gets the individual human decision D-02 requires, and it cannot be
 * pre-approved either.
 */
export class CrossBoundaryConfigApplyError extends Error {
  constructor(
    readonly proposalId: string,
    readonly reasons: readonly CrossBoundaryReason[],
    readonly actionClass: string,
  ) {
    super(
      `refusing to apply ${JSON.stringify(proposalId)} under a standing approval: this proposal `
      + `crosses a boundary a standing approval may not cover (${
        reasons.length === 0 ? 'no reason recorded' : reasons.join(', ')
      }). The approval in force over ${actionClass} is unaffected and still covers in-scope config `
      + 'changes; this one needs an individual decision — run `agent-qa proposals accept '
      + `${proposalId}\` and confirm it.`,
    )
    this.name = 'CrossBoundaryConfigApplyError'
  }
}

/**
 * Is a standing approval covering this class in force right now?
 *
 * READ THROUGH THE PORT, NOT THROUGH THE GATE'S READER, and the two are the same committed file:
 * `createGrantOperations` and `createStandingApprovalReader` both fold `grants.jsonl` under the one
 * knowledge root. Reading it here rather than being told by the gate is what makes this half hold
 * against a line nobody minted — the hand-edited case the mint half structurally cannot see.
 *
 * MATCHED ON THE ACTION CLASS ALONE, deliberately, and the asymmetry with `grantCovers` is in the
 * safe direction. The gate additionally requires the grant's scope to match the action scope; a
 * grant whose scope did NOT match would be one the gate ignored, and treating it as covering here
 * only ever refuses more. Re-spelling the scope rule in this package would be a second judgement
 * about whether an approval applies, which is exactly what `reader.ts` refuses to do in the other
 * direction.
 *
 * A HOST THAT BINDS NO GRANTS PORT HAS NO LEDGER TO READ, and answers `false`. That is the honest
 * reading — there are no standing approvals on such a host — and it is why the production
 * composition binding both the port and the gate's reader is asserted rather than assumed.
 */
async function coveringGrantInForce(
  deps: FunctionDeps,
  actionClass: string,
): Promise<boolean> {
  const grants = deps.standingGrants
  if (grants === undefined) return false
  const { grants: active } = await grants.list()
  return active.some((grant) => grant.actionClass === actionClass)
}

/**
 * Read the envelope, narrow it to a config proposal, and commit it through the port.
 *
 * SHARED WITH `proposals.accept`'s route, which is why it is a function rather than inlined. The
 * accept has ALREADY read the envelope and hands its payload straight to the port; this verb was
 * given only an id, so it does the one read itself. Both then reach the SAME port — never each
 * other — because op-calling-op would put a second gate evaluation and a second audit row in front
 * of one human decision.
 */
export async function applyConfigProposalById(
  deps: FunctionDeps,
  functionId: string,
  proposalId: string,
): Promise<ConfigApplyOutcome> {
  const inbox = deps.proposalsInbox
  const configApply = deps.configApply
  if (inbox === undefined || configApply === undefined) throw new FunctionNotBoundError(functionId)

  const shown = await inbox.show({ proposalId })
  if (shown.kind === 'not-found') {
    throw new ConfigProposalNotApplicableError(proposalId, 'no proposal with that id exists')
  }
  const { envelope } = shown.entry
  if (envelope.kind !== 'config') {
    throw new ConfigProposalNotApplicableError(proposalId, `it is a ${envelope.kind} proposal`)
  }

  // D-02's READ HALF, above every mutation and above the payload funnel (395-07).
  //
  // NARROWED ON THE PAYLOAD'S OWN DISCRIMINANT, at the kind that has one — the same narrowing
  // `proposals.accept`'s blocked arm takes, for the same reason: a check keyed on anything else
  // would be a second classification of one value, free to disagree with the one `applyablePayload`
  // takes on the very next line.
  //
  // THE LEDGER IS READ ONLY WHEN THE PROPOSAL IS FLAGGED. An in-scope proposal is grantable, so its
  // apply must not pay a file read to be told so — and, more to the point, must not acquire a
  // dependency on a ledger it has no question about.
  if (envelope.payload.payloadKind === 'applyable' && envelope.payload.crossBoundary) {
    const actionClass = configProposalApplySpec.risk.name
    if (await coveringGrantInForce(deps, actionClass)) {
      throw new CrossBoundaryConfigApplyError(
        proposalId,
        envelope.payload.crossBoundaryReasons,
        actionClass,
      )
    }
  }

  return await configApply.apply({ proposalId, payload: applyablePayload(envelope.payload) })
}

export const configProposalApplySpec: FunctionSpec<ConfigProposalApplyInput, ConfigApplyOutcome> = {
  id: CONFIG_PROPOSAL_APPLY_FUNCTION_ID,
  summary: 'Apply an accepted configuration proposal as one commit in this repository.',
  requiredScopes: ['config-write'],
  resultKind: 'unary',
  input: ConfigProposalApplyInputSchema,
  output: ConfigApplyOutcomeSchema,
  boundThrough: 'configApply',
  risk: {
    name: `fn:${CONFIG_PROPOSAL_APPLY_FUNCTION_ID}`,
    recognized: true,
    readOnly: false,
    declaredTier: 'mutating-shared',
  },
  invoke(input, deps: FunctionDeps): Promise<ConfigApplyOutcome> {
    return applyConfigProposalById(deps, CONFIG_PROPOSAL_APPLY_FUNCTION_ID, input.proposalId)
  },
}
