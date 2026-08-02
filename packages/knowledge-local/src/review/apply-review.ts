// Apply: the ONE path a review verb's bytes change through (Phase 387, KREV-01 / D-17 · D-18).
//
// Five obligations, in this order, and the order is the contract:
//
//   1. CLAIM the proposal by atomic rename. The kernel picks one winner; the loser reads what the
//      winner recorded and receives it as a typed already-applied answer.
//   2. Route the claimed proposal's deltas through the Curator's `commit()` — the same epoch-fenced
//      path every curation write takes, with no second write vocabulary and no bypass. The deltas
//      are the ones a propose WROTE DOWN, read back off disk, never ones a caller handed in.
//   3. Assemble the receipt AROUND the commit, from the disposition outcome plus post-commit reads
//      (RESEARCH Pitfall 1: `commit()` returns `Promise<void>` today and this phase does not widen
//      it — that is 391's call, and assuming a `CommitReceipt` is the specific mistake the pitfall
//      names).
//   4. PUBLISH the applied record with its receipt, so the answer is durable: D-04 makes the forget
//      receipt the permanent content a forgotten entity's address resolves to.
//   5. On any failure, rename BACK to pending and rethrow. A failed apply leaves the proposal
//      exactly as applicable as it was — a half-consumed proposal is invisible data loss.
//
// LEASE ROUTING (D-18) is decided by `acquireWriterLease` itself rather than by a classification
// this module performs first. That is deliberate: a read-then-decide would have a window between
// the read and the acquire, and the primitive already refuses a fresh holder. So "the lease is
// held by somebody alive" arrives here as an ordinary `held` outcome, and the caller delegates.
// There is no code path in this file that acquires when a live holder exists, because there is no
// second acquisition primitive for one to use.

import type {
  Delta,
  ForgetReceiptV1,
  KnowledgeProjection,
  KnowledgeProposalV1,
} from '@vostride/agent-qa-schema'

import { deriveBundleTrust, loadBundle } from '../bundle-read.js'
import { enumerateBundleDirs } from '../bundle-scan.js'
import { createLocalKnowledgeStore } from '../curator/knowledge-store.js'
import { acquireWriterLease, releaseLease } from '../lease/writer-lease.js'
import type { WriterLease } from '../lease/writer-lease.js'
import { memoryStatusForBundle } from '../memory-status.js'
import { FORGET_SCRUBBED_PROJECTIONS } from './propose-review.js'
import {
  claimPendingProposal,
  publishAppliedProposal,
  restorePendingProposal,
} from './proposals-store.js'

/**
 * How long a delegating process waits for the leaseholder to finish an apply (D-18).
 *
 * PINNED, not configured, on the `LEASE_HEARTBEAT_TTL_MS` idiom. 30s is chosen as "longer than any
 * commit this store performs, shorter than a person's patience": a commit is a handful of file
 * appends plus one bundle re-projection, all local. RETUNE from an observed apply that legitimately
 * exceeded it — never from a flaky test, which is a symptom of a wedged holder rather than a slow
 * one, and the wedged holder is exactly what this bound exists to refuse rather than wait out.
 */
export const APPLY_DELEGATE_TIMEOUT_MS = 30_000

/** The typed refusal a bounded wait produces. Never a generic timeout, never a takeover. */
export class ApplyDelegateTimeoutError extends Error {
  constructor(readonly proposalId: string, readonly timeoutMs: number) {
    super(
      `The writer-lease holder did not answer the apply of ${proposalId} within ${timeoutMs}ms. ` +
        'The proposal is unchanged and still applicable; the lease was neither taken nor stolen.',
    )
    this.name = 'ApplyDelegateTimeoutError'
  }
}

/** The typed refusal when a live holder exists and this host was given no way to reach it. */
export class ApplyDelegateUnavailableError extends Error {
  constructor(readonly proposalId: string, readonly holder: WriterLease) {
    super(
      `The writer lease for this knowledge root is held by pid ${holder.pid} (lease ` +
        `${holder.leaseId}, epoch ${holder.epoch}) and this host has no delegate transport, so ` +
        `${proposalId} cannot be applied here. Lease-stealing is structurally refused (386 D-14).`,
    )
    this.name = 'ApplyDelegateUnavailableError'
  }
}

export class ProposalTargetVanishedError extends Error {
  constructor(readonly proposalId: string) {
    super(`The record ${proposalId} addresses is no longer in the store; nothing was committed.`)
    this.name = 'ProposalTargetVanishedError'
  }
}

export type ApplyOutcomeKind = 'applied' | 'already-applied'

export interface ApplyReviewResult {
  readonly outcome: ApplyOutcomeKind
  readonly proposal: KnowledgeProposalV1
  readonly forgetReceipt?: ForgetReceiptV1
}

/**
 * Hand the SAME apply envelope to the leaseholder and wait bounded for its answer (D-18).
 *
 * Injected as an optional operation rather than built here, on the 386-41 D-2 operations-bag
 * idiom: `knowledge-local` neither knows nor may know that a unix socket exists. The CLI host
 * supplies `invokeViaDaemon`; the daemon's own composition supplies NOTHING, which is what makes
 * delegation recursion impossible by construction rather than by a guard — the daemon holds the
 * lease, so its own applies always take the in-process branch.
 */
export type ApplyDelegate = (proposalId: string) => Promise<ApplyReviewResult>

export interface ApplyReviewInput {
  readonly agentQaRoot: string
  readonly knowledgeRoot: string
  readonly proposalId: string
  readonly executionContext?: 'local-interactive' | 'local-headless' | 'ci' | 'cloud'
  readonly delegate?: ApplyDelegate
  /**
   * The lease this caller ALREADY holds, when it is the holder (387-08 D-18).
   *
   * Required for the daemon, and the reason is structural rather than an optimisation: the writer
   * lease is exclusive, so a leaseholder asking `acquireWriterLease` for one is told `held` — by
   * ITSELF — and would then try to delegate to itself. Supplying the authority it already owns is
   * the only way a holder can commit, and it is also why a holder never delegates: this branch is
   * taken before any acquisition is attempted.
   */
  readonly writerAuthority?: { readonly leaseId: string; readonly epoch: number }
  readonly now?: () => number
  readonly delegateTimeoutMs?: number
}

/**
 * The delta kind a review verb emits when it means "this record stops standing".
 *
 * BOTH `reject` and `forget` emit it (propose-review.ts:183-195 — identical `Deprecate` deltas
 * differing only in the recorded reason), which is precisely why the already-tombstoned guard
 * below reads the DELTA rather than the verb. A guard scoped to one member of the emitting set
 * leaves the hazard reachable through every other member, and that is the root-cause shape this
 * round is closing in three places (CR-02 here; CR-04's status table in `memory-status.ts`).
 */
const DEPRECATE_DELTA_KIND = 'Deprecate'

/** Whether a proposal's deltas — as WRITTEN DOWN, read back off disk — deprecate anything. */
function deprecatesRecords(proposal: KnowledgeProposalV1): boolean {
  return proposal.deltas.some((delta) => delta.kind === DEPRECATE_DELTA_KIND)
}

function locateRecord(knowledgeRoot: string, recordId: string) {
  for (const entry of enumerateBundleDirs(knowledgeRoot)) {
    const outcome = loadBundle(entry.dir)
    if (outcome.kind !== 'loaded') continue
    if (outcome.bundle.manifest.id !== recordId) continue
    return {
      product: entry.product,
      status: deriveBundleTrust(outcome.bundle).status,
      provenance: outcome.bundle.provenance,
    }
  }
  return undefined
}

/**
 * Whether every record a deprecating proposal addresses is ALREADY tombstoned.
 *
 * `every`, not `some`: a bundle-grained verb over a partially-tombstoned set still has work to
 * do, and treating it as complete would be the silent partiality D-19 forbids.
 *
 * Judged through the SHARED mapping (387-11) rather than a table local to this module. The local
 * table this replaced named `withdrawn` and `retired` — neither is a `BundleStatus` member, so
 * both were dead weight — and the shared one is `satisfies Record<BundleStatus, …>`, which makes
 * a fifth member a compile error here instead of a status that silently reads as untombstoned.
 */
function alreadyTombstoned(knowledgeRoot: string, proposal: KnowledgeProposalV1): boolean {
  const ids = targetRecordIds(proposal)
  if (ids.length === 0) return false
  return ids.every((recordId) => {
    const located = locateRecord(knowledgeRoot, recordId)
    return located !== undefined && memoryStatusForBundle(located.status) === 'tombstoned'
  })
}

/** Every record id a proposal's deltas name — the enumeration a forget receipt is built over. */
function targetRecordIds(proposal: KnowledgeProposalV1): string[] {
  const ids = new Set<string>()
  for (const delta of proposal.deltas as readonly (Delta & { targetId?: string })[]) {
    if (typeof delta.targetId === 'string') ids.add(delta.targetId)
  }
  return [...ids].sort()
}

/**
 * Build the forget receipt from POST-COMMIT reads, never from the preview.
 *
 * The preview says what would happen; the receipt must say what did. Copying the preview forward
 * would have produced a receipt that is always right by construction and therefore evidence of
 * nothing — including in the one case that matters, where the commit tombstoned less than the
 * preview predicted.
 *
 * `projectionsScrubbed` is a PARAMETER for the same reason (WR-02). It used to be the constant
 * scrub set spliced in unconditionally, which made the receipt right by construction on the one
 * path where it was wrong: the short-circuit runs no commit, so no projection is rebuilt and no
 * recall row is removed, and a receipt naming three scrubs there asserts work nobody performed.
 * `scrubSetSchema` (schema/src/knowledge/proposal.ts:140-146) declares this field a SUBSET of the
 * scrub set with no minimum length, so the empty list is the honest, already-legal answer.
 */
function assembleForgetReceipt(
  knowledgeRoot: string,
  proposal: KnowledgeProposalV1,
  forgottenAt: number,
  projectionsScrubbed: readonly KnowledgeProjection[],
): ForgetReceiptV1 {
  const tombstonedRecords: ForgetReceiptV1['tombstonedRecords'] = []
  let resultingBundleStatus: ForgetReceiptV1['resultingBundleStatus'] = 'forgotten'
  for (const recordId of targetRecordIds(proposal)) {
    const located = locateRecord(knowledgeRoot, recordId)
    if (located === undefined) {
      // Tombstone-never-destroy (§7.7): the bundle file survives a forget, so a record that
      // cannot be read back after the commit is a fact about the STORE, not about this verb, and
      // reporting a tombstone for it would be the receipt asserting work nobody can verify.
      throw new ProposalTargetVanishedError(proposal.proposalId)
    }
    tombstonedRecords.push({ recordId, provenance: located.provenance })
    resultingBundleStatus = memoryStatusForBundle(located.status)
  }
  return {
    schemaVersion: 1,
    proposalId: proposal.proposalId,
    tombstonedRecords,
    projectionsScrubbed: [...projectionsScrubbed],
    resultingBundleStatus,
    forgottenAt,
  }
}

async function commitInProcess(
  input: ApplyReviewInput,
  proposal: KnowledgeProposalV1,
  lease: { readonly leaseId: string; readonly epoch: number },
): Promise<void> {
  const store = createLocalKnowledgeStore({
    knowledgeRoot: input.knowledgeRoot,
    auditBaseDir: input.agentQaRoot,
    executionContext: input.executionContext ?? 'local-interactive',
    epoch: lease.epoch,
    writerLeaseId: lease.leaseId,
  })
  // THE one write path. Not `proposeDeltas` (which is the propose-only disposition profile and
  // would commit nothing), not a direct append, not a projection call — `commit`, exactly as any
  // curation write reaches it.
  await store.commit([...proposal.deltas])
}

/**
 * Apply a minted proposal. Race-safe, idempotent, receipt-bearing.
 */
export async function applyReview(input: ApplyReviewInput): Promise<ApplyReviewResult> {
  const claim = claimPendingProposal(input.agentQaRoot, input.proposalId)
  if (claim.kind === 'already-applied') {
    return {
      outcome: 'already-applied',
      proposal: claim.record.proposal,
      ...(claim.record.forgetReceipt === undefined
        ? {}
        : { forgetReceipt: claim.record.forgetReceipt }),
    }
  }
  if (claim.kind === 'not-found') {
    // Not an error and not a receipt: the id names nothing this store ever minted, and every
    // arm above is about a proposal that exists.
    throw new Error(`No knowledge proposal is stored under id ${input.proposalId}`)
  }

  const { proposal } = claim
  if (input.writerAuthority !== undefined) {
    // This caller IS the holder. No acquisition, no delegation, no release — the lease it was
    // handed is one it owns for longer than this apply.
    return await commitAndPublish(input, proposal, input.writerAuthority)
  }

  const acquired = acquireWriterLease(input.knowledgeRoot)

  if (acquired.kind === 'held') {
    // D-18: somebody alive is writing. This host does NOT wait for the lease and does not take
    // it — it hands the same apply to the holder, or refuses. Restoring the claim first is what
    // lets the holder find the proposal pending.
    restorePendingProposal(input.agentQaRoot, input.proposalId)
    if (input.delegate === undefined) {
      throw new ApplyDelegateUnavailableError(input.proposalId, acquired.holder)
    }
    return await withBoundedWait(input, input.delegate)
  }
  if (acquired.kind !== 'acquired') {
    restorePendingProposal(input.agentQaRoot, input.proposalId)
    throw acquired.error
  }

  try {
    return await commitAndPublish(input, proposal, acquired)
  } finally {
    releaseLease({ knowledgeRoot: input.knowledgeRoot, leaseId: acquired.leaseId })
  }
}

/** The commit-and-receipt half, shared by the acquiring path and the already-holding one. */
async function commitAndPublish(
  input: ApplyReviewInput,
  proposal: KnowledgeProposalV1,
  authority: { readonly leaseId: string; readonly epoch: number },
): Promise<ApplyReviewResult> {
  try {
    // FUNC-04's adjacency edge, decided BEFORE the commit rather than hoped for after it — and
    // scoped to the DELTA KIND, which is what CR-02 cost us for scoping it to one verb.
    //
    // Deprecating an already-tombstoned record must be "a receipt naming the already-tombstoned
    // state, never a second destructive change". Committing the Deprecate anyway does not merely
    // no-op: the commit path publishes a fresh `candidate` bundle carrying the target's own
    // anchors, scope and summary, re-addressed under the review verb's `user` origin class —
    // a verbatim CLONE of the fact the reviewer just rejected, and `isEligibleCandidate`
    // (serving/brief-selection.ts:142-151) re-admits a `candidate` row into serving. So the
    // second rejection RESURRECTS what the first one rejected. Measured against reject→reject and
    // forget→reject alike, which is the whole point: `reject` and `forget` emit the SAME delta,
    // so a guard reading `proposal.verb` protected one caller and left the other exposed to a
    // sequence — reject the same record twice — that is the most ordinary mistake a review queue
    // invites. Idempotency lives here, over the target's STATE, not only over the proposal id.
    if (deprecatesRecords(proposal) && alreadyTombstoned(input.knowledgeRoot, proposal)) {
      const already: KnowledgeProposalV1 = { ...proposal, status: 'applied' }
      if (proposal.verb !== 'forget') {
        // reject carries no receipt on any path; the applied record is the whole answer.
        publishAppliedProposal(input.agentQaRoot, { proposal: already })
        return { outcome: 'applied', proposal: already }
      }
      // WR-02: no commit ran on this branch, so no projection was rebuilt and no recall row was
      // removed. The scrub list is EMPTY because that is what happened.
      const receipt = assembleForgetReceipt(
        input.knowledgeRoot,
        proposal,
        (input.now ?? Date.now)(),
        [],
      )
      publishAppliedProposal(input.agentQaRoot, { proposal: already, forgetReceipt: receipt })
      return { outcome: 'applied', proposal: already, forgetReceipt: receipt }
    }

    await commitInProcess(input, proposal, authority)
    const forgottenAt = (input.now ?? Date.now)()
    const forgetReceipt = proposal.verb === 'forget'
      ? assembleForgetReceipt(
          input.knowledgeRoot,
          proposal,
          forgottenAt,
          FORGET_SCRUBBED_PROJECTIONS,
        )
      : undefined
    const applied: KnowledgeProposalV1 = { ...proposal, status: 'applied' }
    publishAppliedProposal(input.agentQaRoot, {
      proposal: applied,
      ...(forgetReceipt === undefined ? {} : { forgetReceipt }),
    })
    return {
      outcome: 'applied',
      proposal: applied,
      ...(forgetReceipt === undefined ? {} : { forgetReceipt }),
    }
  } catch (error) {
    restorePendingProposal(input.agentQaRoot, input.proposalId)
    throw error
  }
}

/**
 * Wait bounded for the delegate, and REFUSE rather than hang.
 *
 * `Promise.race` against a timer rather than an abort signal, because the transport is injected and
 * this module cannot assume it is cancellable. The consequence is stated rather than hidden: a
 * wedged holder's answer may still arrive after the refusal, and it is discarded — the proposal is
 * pending either way, so the worst case is a retry that finds the work already done and receives
 * the already-applied receipt. A hang has no such worst case.
 */
async function withBoundedWait(
  input: ApplyReviewInput,
  delegate: ApplyDelegate,
): Promise<ApplyReviewResult> {
  const timeoutMs = input.delegateTimeoutMs ?? APPLY_DELEGATE_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      delegate(input.proposalId),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ApplyDelegateTimeoutError(input.proposalId, timeoutMs)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
