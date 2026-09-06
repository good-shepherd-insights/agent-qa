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

import { relative } from 'node:path'

import type {
  Delta,
  ForgetReceiptV1,
  KnowledgeProjection,
  KnowledgeProposalV1,
  ProposalOrigin,
  ResolvePromotionPosture,
} from '@vostride/agent-qa-schema'

import { deriveBundleTrust, loadBundle } from '../bundle-read.js'
import { enumerateBundleDirs } from '../bundle-scan.js'
import { createLocalKnowledgeStore } from '../curator/knowledge-store.js'
import { acquireWriterLease, releaseLease } from '../lease/writer-lease.js'
import type { WriterLease } from '../lease/writer-lease.js'
import { memoryStatusForBundle } from '../memory-status.js'
import { FORGET_SCRUBBED_PROJECTIONS } from './propose-review.js'
import {
  ProposalNotFoundError,
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

/**
 * How long a caller waits out ANOTHER caller's in-progress apply of the SAME proposal (CR-03).
 *
 * PINNED, not configured, on the `APPLY_DELEGATE_TIMEOUT_MS` idiom above. 5s is chosen an order
 * of magnitude below the delegate bound because the two waits are waiting on different things:
 * the delegate bound waits on a whole other PROCESS with a transport in between, while this one
 * waits on a local `commit()` — a handful of appends and one bundle re-projection on the same
 * disk. RETUNE from an observed commit that legitimately exceeded it; never from a flaky test,
 * which points at a claim whose winner died rather than one that is slow, and a dead winner's
 * claim is what the typed refusal exists to REPORT rather than wait out.
 */
export const APPLY_IN_FLIGHT_WAIT_MS = 5_000

/**
 * How often the waiter re-asks. Short enough that the common case — a fast local commit — is not
 * paid for in latency, long enough that the wait is not a spin on `readdirSync`.
 */
export const APPLY_IN_FLIGHT_POLL_MS = 25

/**
 * The proposal was DECLINED by a human, so there is nothing here to apply (Phase 391, D-12).
 *
 * Distinct from `ProposalNotFoundError` because the two send an operator to different places: a
 * not-found means look for the mint, and this means look at the decision. The instant is carried
 * because the decision trail is the point of the rejected record — a refusal that made somebody
 * open the file to learn when it was declined would be a disclosure in name only (WR-06).
 */
export class ProposalRejectedError extends Error {
  constructor(readonly proposalId: string, readonly rejectedAt: number) {
    super(
      `Proposal ${proposalId} was rejected at ${new Date(rejectedAt).toISOString()} and cannot ` +
        'be applied. The proposal and the decision that declined it are both retained — nothing ' +
        'was deleted — so the record remains readable under this id.',
    )
    this.name = 'ProposalRejectedError'
  }
}

/**
 * The typed refusal when another caller holds the claim and has not finished (CR-03).
 *
 * THE CLAIM FILE IS NAMED, because the loudest reason to hit this refusal is an ORPHANED claim —
 * a winner that crashed mid-commit — whose only recovery until Phase 391's reaper lands is a
 * human renaming that file back (D-17, WR-03). An operator who has to read this package's source
 * to learn the naming scheme has been disclosed to in name only (WR-06).
 *
 * IT IS NAMED TWICE, IN TWO FORMS, and the split is the whole of IN-02. This message is what
 * crosses `knowledge.proposal.apply`'s function boundary uncaught, so it can be serialized into a
 * tool result a model provider reads — and an absolute path carries the host's home directory
 * and username there for no operator benefit whatsoever. So:
 *
 *   - `displayPath` — the claim relative to `agentQaRoot` — is what the MESSAGE renders. Same
 *     filename, same recovery instruction, nothing about this machine's layout.
 *   - `claimPath` — absolute — stays on the FIELD, unchanged, for tooling that has to open it.
 *
 * The relativization is done by `settleClaim`, which holds `agentQaRoot`, rather than taught to
 * this class: an error that knew about roots would need one supplied at every construction site,
 * and a second copy of "what is this path relative to" is exactly where a drift starts.
 */
export class ProposalApplyInFlightError extends Error {
  constructor(
    readonly proposalId: string,
    readonly waitedMs: number,
    readonly claimPath?: string,
    displayPath?: string,
  ) {
    const shown = displayPath ?? claimPath
    super(
      `Another process is mid-apply of ${proposalId} and did not finish within ${waitedMs}ms. ` +
        'Nothing was lost and nothing was applied twice: the proposal is claimed, not missing. ' +
        'Retrying returns the winner\'s receipt if the apply completed, or finds the proposal ' +
        'pending again if the winner refused and put it back.' +
        (shown === undefined
          ? ''
          : ` The claim is parked at ${shown}. A winner that died mid-commit leaves it there ` +
            `until Phase 391's reaper can decide the winner is gone; renaming it back to ` +
            `${proposalId}.json re-opens the proposal for apply.`),
    )
    this.name = 'ProposalApplyInFlightError'
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
  readonly resolvePromotionPosture?: ResolvePromotionPosture
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
  /**
   * Override for the apply-in-flight bound, mirroring `delegateTimeoutMs` and for the same
   * reason: a directed case must not have to sit out a production bound, and a case that DID
   * would be a flake waiting for a loaded CI box.
   */
  readonly inFlightWaitMs?: number
}

/**
 * The delta kind a review verb emits when it means "this record stops standing".
 *
 * BOTH `reject` and `forget` emit it (propose-review.ts:183-195 — identical `Deprecate` deltas
 * differing only in the recorded reason), so the guard below is keyed on the kind rather than on
 * either verb's name.
 *
 * WHAT THE GUARD BELOW IS, and the previous version of this comment got it wrong, so it is
 * stated plainly: it is an IDEMPOTENCY short-circuit. A deprecating proposal over an already
 * tombstoned target has nothing left to destroy, and the honest answer is a receipt naming the
 * state that already holds rather than a second destructive change (FUNC-04's adjacency edge,
 * D-19's "nothing silently partial").
 *
 * WHAT IT IS NOT: the owner of the unauthored-mint hazard. This comment used to claim the guard's
 * kind-scoping was what stopped a clone being minted, and round 1's verifier measured that claim
 * false by reproducing the identical mint through `accept` — which emits a `Confirm` and walks
 * straight past everything in this file. The hazard lives one layer down, at the curator's
 * `checkCitedIdIntegrity`, whose id domain is `deltaTargetIds` = cited ids ∪ target/victim/
 * conflict ids — strictly wider than `targetRecordIds` below, which reads only `delta.targetId`.
 * Every review delta of every verb passes through that one check funnel regardless of its kind,
 * which is why the closure had to land there and not here: see
 * `UserDeltaCitationIntegrityError` and the origin-keyed fallback table beside it in
 * `curator/disposition.ts`, where a user-authored delta whose citation cannot be honoured is
 * refused by type instead of degraded into minted content.
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
    ...(input.resolvePromotionPosture === undefined
      ? {}
      : { resolvePromotionPosture: input.resolvePromotionPosture }),
  })
  // THE one write path. Not `proposeDeltas` (which is the propose-only disposition profile and
  // would commit nothing), not a direct append, not a projection call — `commit`, exactly as any
  // curation write reaches it.
  await store.commit([...proposal.deltas])
}

/**
 * Resolve the claim to one of the two states an apply can proceed from, or refuse BY TYPE.
 *
 * The apply-in-flight arm is the only one that waits, and what it waits for is a WINDOW rather
 * than a lock: the winner's claim rename has happened, its applied publish has not, and both of
 * those are the winner's own doing. Three of the four ways that window can close are answers this
 * caller can act on, so the loop re-asks instead of refusing on sight:
 *
 *   already-applied → the winner finished; hand back the winner's record, do not commit.
 *   consumed        → the winner refused and restored the proposal; this caller legitimately
 *                     inherits the work. That is not a second commit — it is the first one.
 *   not-found       → the proposal was never minted, or was applied and then... nothing else can
 *                     produce it. Typed refusal.
 *
 * Only exhausting the bound produces `ProposalApplyInFlightError`, and that refusal is honest
 * about what it does NOT know: whether the winner is slow or dead. Deciding that requires a
 * liveness model over claims, which is the reaper D-17 scopes to Phase 391 (WR-03).
 */
async function settleClaim(
  input: ApplyReviewInput,
): Promise<
  Exclude<
    ReturnType<typeof claimPendingProposal>,
    { kind: 'apply-in-flight' | 'not-found' | 'already-rejected' }
  >
> {
  const waitMs = input.inFlightWaitMs ?? APPLY_IN_FLIGHT_WAIT_MS
  const deadline = Date.now() + waitMs
  for (;;) {
    const claim = claimPendingProposal(input.agentQaRoot, input.proposalId)
    if (claim.kind === 'consumed' || claim.kind === 'already-applied') return claim
    if (claim.kind === 'not-found') {
      // The id names nothing this store ever minted — a different fact from "somebody else is
      // applying it right now", and since 387-12 the two are told apart rather than merged.
      throw new ProposalNotFoundError(input.proposalId)
    }
    if (claim.kind === 'already-rejected') {
      // 391 D-12: a human declined this proposal, and that is a THIRD fact — not an absence and
      // not an in-flight apply. Told apart here for the reason the other two are: an operator
      // whose apply came back "no such proposal" would go looking for a mint that never
      // happened, when what actually happened is that somebody said no and the record saying so
      // is on disk under this id.
      throw new ProposalRejectedError(input.proposalId, claim.record.decision.at)
    }
    if (Date.now() >= deadline) {
      // The arm's own data reaches the refusal: whichever claim file the LAST resolution actually
      // found is the one an operator has to deal with, so it is read off the outcome rather than
      // reconstructed here where a second copy of the naming scheme could drift (WR-06). The
      // display form is derived from that same value — never re-derived from the proposal id —
      // for the same reason (IN-02).
      throw new ProposalApplyInFlightError(
        input.proposalId,
        waitMs,
        claim.claimPath,
        claim.claimPath === undefined
          ? undefined
          : relative(input.agentQaRoot, claim.claimPath),
      )
    }
    await new Promise((resolve) => setTimeout(resolve, APPLY_IN_FLIGHT_POLL_MS))
  }
}

/**
 * A leaseholder never delegates, and the input may not claim to be both (WR-04).
 *
 * The two fields are mutually exclusive by MEANING: `writerAuthority` says "I hold the lease and
 * will commit in this process", `delegate` says "somebody else holds it and here is how to reach
 * them". Supplying both was previously refused only by reading the code — the authority branch
 * is taken first and returns, so a caller that passed both silently got the in-process commit and
 * never learned its delegate was ignored. A source-scan-only rule is one refactor away from being
 * untrue; this makes it structural, and it fires BEFORE the claim so a rejected input never
 * renames a proposal it is not going to apply.
 */
function assertSingleWritePath(input: ApplyReviewInput): void {
  if (input.writerAuthority !== undefined && input.delegate !== undefined) {
    throw new TypeError(
      'applyReview received both `writerAuthority` and `delegate`. A leaseholder never ' +
        'delegates: holding the writer lease is exactly what makes an in-process commit the ' +
        'only available path, so supply one or the other and never both.',
    )
  }
}

/**
 * Apply a minted proposal. Race-safe, idempotent, receipt-bearing.
 */
export async function applyReview(input: ApplyReviewInput): Promise<ApplyReviewResult> {
  assertSingleWritePath(input)
  const claim = await settleClaim(input)
  if (claim.kind === 'already-applied') {
    return {
      outcome: 'already-applied',
      proposal: claim.record.proposal,
      ...(claim.record.forgetReceipt === undefined
        ? {}
        : { forgetReceipt: claim.record.forgetReceipt }),
    }
  }

  const { proposal } = claim
  // 391 D-08: the mint's attribution rides from the claimed bytes onto the applied record. Read
  // off the claim rather than re-read from disk — the pending name is gone by now, so a second
  // read would find nothing and the attribution would be lost exactly when it is needed.
  const origin = claim.origin
  if (input.writerAuthority !== undefined) {
    // This caller IS the holder. No acquisition, no delegation, no release — the lease it was
    // handed is one it owns for longer than this apply.
    return await commitAndPublish(input, proposal, input.writerAuthority, origin)
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
    return await commitAndPublish(input, proposal, acquired, origin)
  } finally {
    releaseLease({ knowledgeRoot: input.knowledgeRoot, leaseId: acquired.leaseId })
  }
}

/**
 * What the applied record carries about the DECISION this apply is (391 D-08 / D-12).
 *
 * Both fields are what the inbox reads back: `origin` says who proposed it, `decision` says when
 * somebody applied it. Assembled once here rather than at the three publish sites, because three
 * copies of "what does an apply record about itself" is three chances for one of them to stop
 * recording the timestamp and for nobody to notice until a decision trail comes back empty.
 *
 * The instant comes from the SAME `input.now` seam the forget receipt's `forgottenAt` uses, so a
 * test that pins a clock pins both, and a receipt and its decision cannot disagree about when the
 * apply happened.
 */
function decisionTrail(
  input: ApplyReviewInput,
  origin: ProposalOrigin | undefined,
): { origin?: ProposalOrigin; decision: { decision: 'applied'; at: number } } {
  return {
    ...(origin === undefined ? {} : { origin }),
    decision: { decision: 'applied', at: (input.now ?? Date.now)() },
  }
}

/** The commit-and-receipt half, shared by the acquiring path and the already-holding one. */
async function commitAndPublish(
  input: ApplyReviewInput,
  proposal: KnowledgeProposalV1,
  authority: { readonly leaseId: string; readonly epoch: number },
  origin: ProposalOrigin | undefined,
): Promise<ApplyReviewResult> {
  try {
    // FUNC-04's adjacency edge, decided BEFORE the commit rather than hoped for after it.
    //
    // Deprecating an already-tombstoned record must be "a receipt naming the already-tombstoned
    // state, never a second destructive change", and that is ALL this branch does. Idempotency
    // lives here, over the target's STATE rather than only over the proposal id, because
    // rejecting the same record twice is the most ordinary repetition a review queue invites.
    //
    // CORRECTED, because the earlier version of this comment claimed more than it delivers: this
    // branch is NOT what stops an unauthored clone being minted. It cannot be — it is reachable
    // only for a proposal that deprecates, and round 1's verifier reproduced the identical mint
    // through `accept`, whose `Confirm` never enters here. The mint is the curator's response to
    // a cited-id-integrity failure, and it is refused at that check now, for every review delta
    // of every kind, by `UserDeltaCitationIntegrityError`. What is true and worth keeping: the
    // clone really is a verbatim copy of the target's anchors, scope and summary republished as
    // a fresh `candidate`, which `isEligibleCandidate` (serving/brief-selection.ts:142-151)
    // re-admits into serving — that is why the refusal, not merely a no-op, is the right answer.
    if (deprecatesRecords(proposal) && alreadyTombstoned(input.knowledgeRoot, proposal)) {
      const already: KnowledgeProposalV1 = { ...proposal, status: 'applied' }
      if (proposal.verb !== 'forget') {
        // reject carries no receipt on any path; the applied record is the whole answer.
        publishAppliedProposal(input.agentQaRoot, {
          proposal: already,
          ...decisionTrail(input, origin),
        })
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
      publishAppliedProposal(input.agentQaRoot, {
        proposal: already,
        forgetReceipt: receipt,
        ...decisionTrail(input, origin),
      })
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
      ...decisionTrail(input, origin),
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
