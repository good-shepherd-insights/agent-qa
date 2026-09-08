// Propose: compute everything, commit nothing (Phase 387, KREV-01 / D-17 · D-19).
//
// Every function in this module is a READ of the knowledge store plus a write to the PROPOSALS
// directory, and that division is the module's whole safety claim. Nothing here imports the
// curator, `commit`, `publishBundle`, `appendOutcomeEvent`, the index, or the writer lease —
// there is no handle in this file through which a byte of the knowledge store could change. The
// claim is asserted as a source scan in this module's suite with a planted-violation control,
// and measured behaviourally by hashing the whole knowledge root across a propose.
//
// Why a separate module from `apply-review.ts`: the two halves have opposite powers. Keeping
// them in one file would have put the one legal `commit` import in the same scope as the code
// whose contract is that it cannot reach one.

import { randomUUID } from 'node:crypto'

import { asRecordId, canonicalJson, KnowledgeMarkInputSchema } from '@vostride/agent-qa-schema'
import type {
  BundleProvenance,
  Delta,
  ForgetPreview,
  KnowledgeAcceptInput,
  KnowledgeForgetInput,
  KnowledgeMarkInput,
  KnowledgeProjection,
  KnowledgeProposalV1,
  KnowledgeRejectInput,
  KnowledgeTargetRef,
  ScopeKey,
} from '@vostride/agent-qa-schema'

import { deriveBundleTrust, loadBundle } from '../bundle-read.js'
import { enumerateBundleDirs } from '../bundle-scan.js'
import { mintProposalId, readProposal, writePendingProposal } from './proposals-store.js'

/**
 * The §7.7 projections a forget in THIS store actually scrubs, enumerated honestly.
 *
 * `KNOWLEDGE_PROJECTIONS` declares four — `fts`, `vec`, `graph`, `exemplar` — and a receipt
 * claiming all four would be a receipt nobody can trust. `scrubDeadRecallRows` (index-rebuild.ts)
 * deletes the FTS row, deletes the record from every materialised vec table, and deletes the
 * record's graph edges plus the nodes those edges orphaned. It does NOT touch the exemplar
 * ranking, and it should not: an exemplar in this system is a TEST reference drawn from the
 * run-outcome projection (`serving/get-authoring-brief.ts`), not a knowledge record, so a
 * forgotten record has no exemplar row to scrub. Listing `exemplar` anyway would be the receipt
 * asserting work nobody did — which is worse than a receipt that says less, because a shorter
 * true list can be lengthened and a false one cannot be believed.
 *
 * When the exemplar ranking gains knowledge-record rows, this constant is the one place that
 * fact is recorded, and the receipt widens with it.
 */
export const FORGET_SCRUBBED_PROJECTIONS: readonly KnowledgeProjection[] = ['fts', 'vec', 'graph']

/** Resolves a `MEM-` short-ID to the machine id it addresses, or `undefined` (D-01/D-04). */
export type ResolveBundleShortId = (shortId: string) => string | undefined

export interface ProposeReviewRequest {
  readonly verb: 'accept' | 'reject' | 'forget' | 'mark'
  readonly input: KnowledgeAcceptInput | KnowledgeRejectInput | KnowledgeForgetInput | KnowledgeMarkInput
}

export class MarkPlanIntegrityError extends Error {
  constructor(readonly recordId: string) {
    super('mark plan does not match its user-authored target and stamp')
    this.name = 'MarkPlanIntegrityError'
  }
}

export interface ProposeReviewInput {
  /** Where proposals are durable — `<configDir>/.agent-qa`. */
  readonly agentQaRoot: string
  readonly knowledgeRoot: string
  readonly request: ProposeReviewRequest
  /**
   * Injected rather than opened here, exactly as the D-01 sighting hook is: the addressing
   * ledger belongs to the composition root, and a review module that opened it would be a
   * second owner of the one durable store this system never rebuilds.
   */
  readonly resolveBundleShortId?: ResolveBundleShortId
  readonly now?: () => number
  readonly randomUuid?: () => string
  /**
   * WHO is emitting this proposal (391 D-08) — the function-op id, and the run when there is one.
   *
   * OPTIONAL, and the `at` field is deliberately NOT on it: this function already stamps
   * `proposedAt`, and a caller that could supply a second instant could make the envelope's
   * attribution disagree with the proposal's own timestamp about when the same act happened.
   * Absent means the mint writes the bare 387 document, which is what every direct caller of
   * this module did before the function layer had an id to name.
   */
  readonly origin?: {
    readonly emittedBy: string
    readonly runId?: string
  }
}

/**
 * What proposing produced, or the named absence.
 *
 * A target ref that names nothing is an ORDINARY reviewer mistake — an id pasted out of a stale
 * issue, a bundle forgotten between two reads — so it is a result arm rather than a throw, on
 * exactly the reasoning 387-06 D-1 applied to the show verb. The plan's own behaviour requires
 * "a typed not-found, never a throw"; the port signature 387-06 declared could not say it, so
 * this union is what the port now returns.
 */
export type ProposeReviewOutcome =
  | { readonly kind: 'proposed'; readonly proposal: KnowledgeProposalV1 }
  | { readonly kind: 'target-not-found'; readonly target: KnowledgeTargetRef }

interface ResolvedTarget {
  readonly recordId: string
  readonly product: string
  readonly scope: ScopeKey
  readonly provenance: BundleProvenance
  readonly status: string
  readonly summary: string
}

/**
 * Find the canonical record a target ref names.
 *
 * The two grains differ by ADDRESSING, not by cardinality: a `MEM-` short-ID goes through the
 * addressing ledger to a machine id, and a record id is that machine id already. In this store a
 * bundle directory's name IS its one canonical record id (`records` is keyed one row per
 * `bundle_id`), so "forgetting a bundle lists every member record" is total by construction here
 * rather than by an enumeration that could miss one — and the moment a bundle carries more than
 * one record, this function is where that enumeration lands.
 */
function resolveTarget(
  knowledgeRoot: string,
  target: KnowledgeTargetRef,
  resolveBundleShortId?: ResolveBundleShortId,
): ResolvedTarget | undefined {
  const machineId = target.grain === 'record'
    ? target.recordId
    : resolveBundleShortId?.(target.shortId)
  if (machineId === undefined) return undefined

  for (const entry of enumerateBundleDirs(knowledgeRoot)) {
    const outcome = loadBundle(entry.dir)
    if (outcome.kind !== 'loaded') continue
    // EXACT equality: this is addressing, never search.
    if (outcome.bundle.manifest.id !== machineId) continue
    return {
      recordId: outcome.bundle.manifest.id,
      product: entry.product,
      scope: outcome.bundle.frontmatter.scope,
      provenance: outcome.bundle.provenance,
      status: deriveBundleTrust(outcome.bundle).status,
      summary: outcome.bundle.summary,
    }
  }
  return undefined
}

/**
 * The deltas a verb WOULD commit.
 *
 * `origin: 'user'` on all three, and it is the load-bearing field rather than boilerplate: a
 * review verb exists because a PERSON decided something about a record, and `agent` origin is
 * downgraded by disposition's autonomy floor precisely so an agent cannot make this call for
 * itself. Attributing a human's accept to the agent would launder the decision.
 *
 * `authorship` is deliberately UNSET, and the reason is a real gap rather than a preference.
 * `CurationAuthorshipPath` is `llm | llm-repaired | deterministic-fallback` — there is no member
 * meaning "a person decided this". `deterministic-fallback` is the closest in spirit and is
 * REFUSED for `Deprecate` by `assertRestrictedFallbackDelta`, whose job is to stop model judgment
 * masquerading as deterministic authorship; measured, not assumed (`restricted-fallback`, both
 * mutating verbs). So the deltas carry no authorship and the bridge's own default applies, and
 * the human attribution lives where it is actually true: `origin: 'user'` plus the durable,
 * addressable proposal that records who decided what. Widening the authorship vocabulary is a
 * curator-contract change with a trust-fold blast radius; 391, which owns the review engine and
 * the standing-grant model, is where a `human` path belongs. Recorded in `.planning/WINDOWS.md`.
 *
 * Forget is a `Deprecate` and not a new delta kind. §7.7's law is tombstone-never-destroy plus
 * scrub-every-projection, and that is exactly what a deprecation already does in this store: the
 * outcome event is appended (history is never rewritten), the derived status becomes `deprecated`,
 * and the projection unit's `scrubDeadRecallRows` removes the lexical, dense and graph recall rows
 * on the next projection. A new kind would have been a SECOND write vocabulary reaching the same
 * machinery — and the destructive verb, `purgeRecord`, is D-14's true-delete exemption which
 * forget is explicitly not (D-19).
 */
function deltasFor(
  request: ProposeReviewRequest,
  resolved: ResolvedTarget,
  proposalId: string,
): Delta[] {
  const envelope = {
    origin: 'user' as const,
    scope: resolved.scope,
    citedIds: [asRecordId(resolved.recordId)],
  }
  switch (request.verb) {
    case 'mark': {
      const parsed = KnowledgeMarkInputSchema.safeParse(request.input)
      if (!parsed.success) throw new MarkPlanIntegrityError(resolved.recordId)
      const { plan, mark } = parsed.data
      if (plan.markId !== mark.markId || plan.fix !== mark.fix
        || plan.feedbackSource.runId !== mark.runId || plan.runTraceRef.runId !== mark.runId
        || plan.feedbackSource.testIndex !== mark.testIndex
        || plan.feedbackSource.stepIndex !== mark.stepIndex || plan.feedbackSource.kind !== mark.kind
        || canonicalJson(plan.target) !== canonicalJson(parsed.data.target)
        || plan.deltas.some((delta) => delta.origin !== 'user'
          || canonicalJson(delta.scope) !== canonicalJson(resolved.scope)
          || !delta.citedIds.includes(asRecordId(resolved.recordId)))) {
        throw new MarkPlanIntegrityError(resolved.recordId)
      }
      return plan.deltas
    }
    case 'accept':
      return [{
        ...envelope,
        kind: 'Confirm',
        targetId: asRecordId(resolved.recordId),
        // The evidence for a human accept IS the proposal: it is the durable, addressable record
        // of who decided what, and deriving the token from it makes the confirmation replay-safe
        // (a second apply of the same proposal is the same token, which the append dedups).
        evidenceToken: `review-accept:${proposalId}`,
      } as Delta]
    case 'reject':
      return [{
        ...envelope,
        kind: 'Deprecate',
        targetId: asRecordId(resolved.recordId),
        reason: (request.input as KnowledgeRejectInput).reason,
      } as Delta]
    case 'forget':
      return [{
        ...envelope,
        kind: 'Deprecate',
        targetId: asRecordId(resolved.recordId),
        reason: `forget:${proposalId}`,
      } as Delta]
  }
}

function forgetPreview(resolved: ResolvedTarget): ForgetPreview {
  return {
    tombstonedRecords: [{ recordId: resolved.recordId, provenance: resolved.provenance }],
    projectionsToScrub: [...FORGET_SCRUBBED_PROJECTIONS],
  }
}

/**
 * Compute a proposal, persist it, and return it — changing nothing in the knowledge store.
 */
export function proposeReview(input: ProposeReviewInput): ProposeReviewOutcome {
  const target = 'target' in input.request.input
    ? input.request.input.target
    : undefined
  if (target === undefined) {
    throw new TypeError('a knowledge review request must carry a target ref')
  }

  const resolved = resolveTarget(input.knowledgeRoot, target, input.resolveBundleShortId)
  if (resolved === undefined) return { kind: 'target-not-found', target }

  const proposalId = mintProposalId(input.randomUuid ?? randomUUID)
  const proposedAt = (input.now ?? Date.now)()
  const proposal: KnowledgeProposalV1 = {
    schemaVersion: 1,
    proposalId,
    verb: input.request.verb,
    targetRef: target,
    deltas: deltasFor(input.request, resolved, proposalId),
    ...(input.request.verb === 'mark' ? { mark: (input.request.input as KnowledgeMarkInput).mark,
      wording: (input.request.input as KnowledgeMarkInput).plan.wording } : {}),
    ...(input.request.verb === 'forget' ? { receiptPreview: forgetPreview(resolved) } : {}),
    proposedAt,
    status: 'pending',
  }
  if (proposal.verb === 'mark') {
    const existing = readProposal(input.agentQaRoot, proposalId)
    if (existing !== undefined) {
      if (canonicalJson({ ...existing, status: 'pending' }) !== canonicalJson(proposal)) {
        throw new MarkPlanIntegrityError(resolved.recordId)
      }
      return { kind: 'proposed', proposal: existing }
    }
  }

  // The envelope's `at` IS the proposal's `proposedAt`, read off the same value rather than
  // sampled a second time: two clock reads for one act is two answers to when it happened.
  writePendingProposal(
    input.agentQaRoot,
    proposal,
    input.origin === undefined ? undefined : { ...input.origin, at: proposedAt },
  )
  return { kind: 'proposed', proposal }
}
