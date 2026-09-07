// The durable proposals store (Phase 387, KREV-01 / D-17 · D-18).
//
// A proposal is minted by one process and applied by another — the whole point of the two-step
// is that a human (or a surface, or 391's engine) gets to look at it in between — so it cannot
// live in memory. It lives as one `<proposalId>.json` file under `<agentQaRoot>/proposals/`,
// beside the addressing ledger, written atomically.
//
// CONSUMPTION IS AN ATOMIC RENAME, and that is the concurrency design rather than an
// implementation detail. `<id>.json` → `<id>.applied.json` is a single filesystem operation
// with exactly one winner: the loser of two racing applies gets ENOENT, reads the applied file,
// and returns the WINNER'S receipt as a typed already-applied refusal. No lock is taken, no
// lease is involved, and there is no window in which both callers believe they may commit. A
// check-then-write ("does the applied file exist? no? write it") would have had exactly that
// window, and the window is measured in this module's suite by removing the rename.
//
// PROPOSALS ARE RETAINED after apply — the applied file is never deleted. D-04 gives the forget
// receipt a second life as the permanent content a forgotten entity's address resolves to, and
// an address that resolves to a file somebody garbage-collected is the dead link D-04 forbids.
// The store is therefore append-only in effect, and there is deliberately NO listing verb here:
// D-17 scopes the proposals INBOX to Phase 391, which owns enumeration, reaping and the standing
// grants that make an inbox meaningful. 391 is the owner; this module is the substrate.
//
// ONE DIRECTORY, KIND-DISCRIMINATED (394-18, closing WINDOWS 99). Until this plan the module said
// a non-knowledge record was "stored elsewhere", and there was no elsewhere: `ProposalRecordSchema`
// had carried `test-draft` and `finding` since 394-06 and nothing on any host could persist one, so
// the loop's two terminal artifacts were things it could produce and no inbox could hold. Every
// kind the envelope discriminates now lives HERE, under the same five durable name shapes, read
// back through the same classifier. What did NOT change is the retention contract: the arms are
// parsed through the envelope's own schema per kind, 387-era bare `KnowledgeProposalV1` documents
// are still absorbed AS DATA and left byte-identical, and the only refusal the widening leaves
// standing is for a kind NO schema in this build knows — which stays a named `TypeError`, because
// a document nothing can parse is not a proposal and guessing at it is how an inbox loses one.

import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
  KnowledgeProposalV1Schema,
  ProposalIdSchema,
  ProposalRecordSchema,
  computeProposalEnvelopeStatus,
} from '@vostride/agent-qa-schema'
import type {
  ForgetReceiptV1,
  KnowledgeProposalV1,
  ProposalDecision,
  ProposalDecisionRecord,
  ProposalDurableState,
  ProposalEnvelope,
  ProposalEvidenceRef,
  ProposalKind,
  ProposalOrigin,
  ProposalRecord,
} from '@vostride/agent-qa-schema'

import { durableRename, fsyncDirectory, fsyncFile } from '../durable-fs.js'

import { PROPOSALS_DIR_NAME, PENDING_SUFFIX, APPLIED_SUFFIX, REJECTED_SUFFIX, CLAIM_INFIX, RETIRED_CLAIM_SUFFIX, TEMP_SUFFIX, AppliedProposalRecordSchema, RejectedProposalRecordSchema, DecidedProposalRecordSchema, proposalsDir, pendingPath, appliedPath, rejectedPath, extractStoredProposal, extractStoredKnowledgeProposal, readJsonIfPresent } from './proposals-data.js'
import type { AppliedProposalRecord, RejectedProposalRecord, DecidedProposalRecord, StoredProposal, StoredKnowledgeProposal } from './proposals-data.js'
export { PROPOSALS_DIR_NAME, AppliedProposalRecordSchema, RejectedProposalRecordSchema, DecidedProposalRecordSchema, proposalsDir, extractStoredProposal, extractStoredKnowledgeProposal } from './proposals-data.js'
export type { AppliedProposalRecord, RejectedProposalRecord, DecidedProposalRecord, StoredProposal, StoredKnowledgeProposal } from './proposals-data.js'

/** Thrown when a proposal id names nothing this store has ever written. */
export class ProposalNotFoundError extends Error {
  constructor(readonly proposalId: string) {
    super(`No knowledge proposal is stored under id ${proposalId}`)
    this.name = 'ProposalNotFoundError'
  }
}

/**
 * Write bytes into `path` atomically: full content to a sibling temp name, fsync, rename.
 *
 * The temp name carries the pid so two processes minting at the same instant cannot scribble
 * over each other's partial file — a shared temp name would make the atomicity of the rename
 * irrelevant, because the bytes being renamed could be half of somebody else's document.
 */
function writeFileAtomically(path: string, contents: string): void {
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, contents, 'utf8')
  fsyncFile(temp)
  durableRename(temp, path)
}

/**
 * Persist a freshly minted proposal in its `pending` state.
 *
 * Validated on the way OUT as well as on the way in. A proposal is read back by a different
 * process, so the boundary that matters is the file — and a schema check performed only on read
 * would let a malformed document be written today and discovered by whoever applies it.
 */
export function writePendingProposal(
  agentQaRoot: string,
  proposal: KnowledgeProposalV1,
  /**
   * Who emitted this proposal (391 D-08). OPTIONAL, and the optionality is the whole
   * no-fabrication rule rather than a convenience: supplying it makes this mint write the
   * envelope's `ProposalRecord` wrapper, and omitting it writes the bare 387 document, because
   * `ProposalOriginSchema` requires an `emittedBy` and there is no honest value for a caller
   * that does not know one. A default would have put a guess on every proposal in the store.
   */
  origin?: ProposalOrigin,
): void {
  const directory = proposalsDir(agentQaRoot)
  mkdirSync(directory, { recursive: true })
  const validated = KnowledgeProposalV1Schema.parse(proposal)
  // IN-03. See the note at `claimPendingProposal`; this is the write half of the same boundary.
  // Redundant TODAY by one schema field — `KnowledgeProposalV1Schema.proposalId` is this same
  // refinement — and kept because the redundancy is a fact about a neighbouring schema rather
  // than about this module. The id becomes a path on the line below either way.
  ProposalIdSchema.parse(validated.proposalId)
  if (origin === undefined) {
    // The BARE 387 document, written exactly as 387 wrote it. It cannot go through
    // `writePendingProposalRecord` below, because the wrapper REQUIRES an origin and there is no
    // honest value for a caller that does not know one — which is the whole of the optionality.
    writeFileAtomically(
      pendingPath(agentQaRoot, validated.proposalId),
      `${JSON.stringify(validated, undefined, 2)}\n`,
    )
    fsyncDirectory(directory)
    return
  }
  writePendingProposalRecord(agentQaRoot, ProposalRecordSchema.parse({
    schemaVersion: CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
    id: validated.proposalId,
    kind: 'knowledge',
    origin,
    payload: validated,
  }))
}

/**
 * Persist a freshly minted proposal of ANY kind, in its `pending` state (394-18).
 *
 * THE KIND-GENERIC WRITE, and the one place a wrapper document is produced. It exists beside
 * {@link writePendingProposal} rather than replacing it because that verb carries a contract this
 * one cannot: an ABSENT origin means the bare 387 document, and only `knowledge` has such a shape.
 * Everything else — the directory, the suffix, the atomic write, the validate-on-the-way-out rule —
 * is shared, so there is exactly one recipe for what a pending proposal file is.
 *
 * Validated on the way OUT as well as on the way in, for the reason its knowledge sibling states:
 * a proposal is read back by a different process, so the boundary that matters is the file.
 */
export function writePendingProposalRecord(agentQaRoot: string, record: ProposalRecord): void {
  const directory = proposalsDir(agentQaRoot)
  mkdirSync(directory, { recursive: true })
  const validated = ProposalRecordSchema.parse(record)
  // IN-03. The id becomes a path on the line below, so the shape check lives where the joining
  // happens — the same law `claimPendingProposal` and `rejectPendingProposal` are under.
  ProposalIdSchema.parse(validated.id)
  writeFileAtomically(
    pendingPath(agentQaRoot, validated.id),
    `${JSON.stringify(validated, undefined, 2)}\n`,
  )
  fsyncDirectory(directory)
}

/**
 * The pending KNOWLEDGE proposal under this id, or `undefined` if it is absent or already applied.
 *
 * Narrowed rather than widened: every caller of this verb commits through the knowledge apply, and
 * a signature answering the payload union would have made each of them re-narrow — or, worse, read
 * a draft's fields off a value typed as a knowledge proposal. A pending proposal of another kind
 * refuses BY NAME here. {@link pendingProposalExists} is the kind-agnostic presence question.
 */
export function readPendingProposal(
  agentQaRoot: string,
  proposalId: string,
): KnowledgeProposalV1 | undefined {
  const raw = readJsonIfPresent(pendingPath(agentQaRoot, proposalId))
  if (raw === undefined) return undefined
  return extractStoredKnowledgeProposal(raw).payload
}

/**
 * Is a pending file on disk under this id, whatever kind it holds?
 *
 * The presence question, separated from the read (394-18). `resolveClaim`'s restored-pending arm
 * asks whether a name came BACK — it does not read the document — and answering that through a
 * knowledge-narrowed read would have made the claim resolution throw on a directory that holds a
 * draft, which is a listing failure wearing a race's clothes.
 */
export function pendingProposalExists(agentQaRoot: string, proposalId: string): boolean {
  return readJsonIfPresent(pendingPath(agentQaRoot, proposalId)) !== undefined
}

/** As {@link readPendingProposal}, keeping the attribution the file carried. */
export function readPendingStoredProposal(
  agentQaRoot: string,
  proposalId: string,
): StoredProposal | undefined {
  const raw = readJsonIfPresent(pendingPath(agentQaRoot, proposalId))
  if (raw === undefined) return undefined
  return extractStoredProposal(raw)
}

/** The rejected record under this id, or `undefined` if this proposal was not rejected. */
export function readRejectedProposal(
  agentQaRoot: string,
  proposalId: string,
): RejectedProposalRecord | undefined {
  const raw = readJsonIfPresent(rejectedPath(agentQaRoot, proposalId))
  if (raw === undefined) return undefined
  return RejectedProposalRecordSchema.parse(raw)
}

/** The applied record under this id, or `undefined` if this proposal has not been applied. */
export function readAppliedProposal(
  agentQaRoot: string,
  proposalId: string,
): AppliedProposalRecord | undefined {
  const raw = readJsonIfPresent(appliedPath(agentQaRoot, proposalId))
  if (raw === undefined) return undefined
  return AppliedProposalRecordSchema.parse(raw)
}

/** Either state, for a caller that only wants to know what a proposal id names. */
export function readProposal(
  agentQaRoot: string,
  proposalId: string,
): KnowledgeProposalV1 | undefined {
  return readPendingProposal(agentQaRoot, proposalId)
    ?? readAppliedProposal(agentQaRoot, proposalId)?.proposal
    ?? readRejectedProposal(agentQaRoot, proposalId)?.proposal
}

export type ConsumeProposalOutcome =
  | { kind: 'consumed'; proposal: KnowledgeProposalV1; origin?: ProposalOrigin }
  | { kind: 'already-applied'; record: AppliedProposalRecord }
  /**
   * A HUMAN DECLINED THIS PROPOSAL (391 D-12), and it is a separate arm from `not-found` for
   * exactly the reason `apply-in-flight` is.
   *
   * Before rejection existed, an apply reaching a proposal nobody could claim had two honest
   * explanations and 387 covered both. Rejection adds a third, and folding it into `not-found`
   * would have made the store tell a caller that a proposal it can still read off disk "names
   * nothing this store has ever written" — a wrong answer wearing a correct one's clothes, on a
   * path whose whole design is about never guessing what a proposal said.
   */
  | { kind: 'already-rejected'; record: RejectedProposalRecord }
  /**
   * SOMEBODY ELSE IS HANDLING THIS PROPOSAL. Distinct from `not-found`, and the distinction is
   * the whole arm.
   *
   * Two states reach it, and the arm covers both because a caller acts identically on them: the
   * usual one is another process holding the claim mid-apply, and the second is that process
   * having just handed the claim BACK — the pending name reappeared after this resolution started
   * looking, so there is nothing to report as missing and nothing yet to take. Both are answered
   * by re-asking, which is what the wait loop above this module already does.
   *
   * `claimPath` names the parked file when there IS one, and is absent in the handed-back state
   * for the honest reason that no claim file exists to name (WR-06).
   *
   * The claim is taken by renaming the pending name away FIRST and the applied name is written
   * LAST, so for the entire duration of `store.commit()` neither name exists. Without this arm a
   * caller arriving in that window is told the id names nothing — which is exactly the confusion
   * `restorePendingProposal` below says the design exists to prevent, arriving through a
   * different door.
   *
   * An ORPHANED claim — a winner that crashed mid-commit — surfaces here too, and keeps
   * surfacing here until somebody restores or publishes it. That is deliberate: a loud typed
   * state a caller can name beats a silent reversion to `not-found`, which would invite a second
   * commit of work that may already be half done. Reaping such a claim needs enumeration and a
   * liveness model, which D-17 scopes to Phase 391 (the orphaned-claim reaper is WR-03); this
   * arm is the substrate 391 reaps against, not a substitute for it.
   */
  | { kind: 'apply-in-flight'; claimPath?: string }
  | { kind: 'not-found' }

/**
 * The path SOME process has this exact proposal parked at right now, or `undefined`.
 *
 * A POINT LOOKUP FOR ONE ID, not an inbox. It reads the directory because that is the only way
 * to see a claim whose suffix is another process's pid, but it answers one question about one
 * id and returns at most ONE path — there is deliberately no way to get a LIST out of it, because
 * enumeration is 391's (D-17) and a listing verb that arrived here by accident would be the
 * substrate quietly growing the surface it was scoped out of.
 *
 * It returns the path rather than a boolean for one reason: the typed refusal an orphaned claim
 * produces has to be actionable, and until 391's reaper exists the recovery is a human renaming
 * that file back. A refusal that made an operator derive the naming scheme by reading this module
 * is a disclosure in name only (WR-06).
 *
 * The prefix is `<proposalId>.json.claimed.`, which cannot collide with two neighbours it sits
 * beside: `<proposalId>.applied.json` does not start with it, and the `.json` separator means a
 * proposal id of `p1` cannot match `p12`'s claim. Nor does it match a RETIRED marker
 * (`<proposalId>.applied.json.claim`), which is why a scan can see nothing where a publish just
 * happened — the fact the resolution below is built around.
 */
function findClaimMarker(agentQaRoot: string, proposalId: string): string | undefined {
  const prefix = `${proposalId}.json.claimed.`
  try {
    const entry = readdirSync(proposalsDir(agentQaRoot)).find((name) => name.startsWith(prefix))
    return entry === undefined ? undefined : join(proposalsDir(agentQaRoot), entry)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * The test seam on the claim resolution. It has two positions and each was demanded by a
 * measurement rather than added for symmetry.
 *
 * `onAfterFirstRead` runs between the resolution's first applied read and its claim scan — the
 * exact window a racing winner publishes into. Everything about that window is otherwise
 * syscall-width, so no test could stand inside it, and round 2's verifier measured the
 * consequence: deleting the arm that serves the window left both review suites fully green. AN
 * UNDRIVABLE WINDOW ARM IS AN UNPINNABLE ONE, and the seam is the cheapest way to make it
 * drivable without a second implementation of the resolution living in the tests.
 *
 * `onAfterClaimScan` runs between the scan and the re-reads below it, and it exists on the same
 * ground one round later. The interleave that defeats the re-reads needs THREE participants — a
 * winner handing the proposal back, then a third participant claiming the restored pending name
 * before the re-reads get to it — and its only event sits in that gap. No existing position can
 * express it: `onAfterFirstRead` fires before the scan, so an event placed there is a state the
 * scan itself observes. Without this position the re-entry below is one more arm no corpus can
 * redden, which is precisely the defect the first position was added to end.
 *
 * TWO IS WHERE IT STOPS, and the bound is the window's own shape rather than restraint: a
 * resolution that runs first-read · scan · re-reads has exactly two gaps a third party can rename
 * into. An injected filesystem would cover these and everything else, at the price of a second
 * implementation of this resolution living in the tests — the thing the seam exists to avoid.
 *
 * BOTH FIRE ONCE PER PASS, and the resolution below runs up to two passes. A caller that needs a
 * one-shot event disarms its own hook (the corpus cases do, and then assert the invocation count
 * is 2 while the action count is 1 — which is the visible evidence that a second pass ran with no
 * fixture event inside it).
 *
 * Production callers pass nothing. The parameters are optional and the hooks are invoked through
 * optional chaining, so the shipped path is the same sequence of syscalls it was without them.
 */
export interface ClaimResolutionHooks {
  readonly onAfterFirstRead?: () => void
  readonly onAfterClaimScan?: () => void
}

/**
 * Claim a pending proposal by renaming it out of the pending name — the race resolver.
 *
 * `renameSync` is the whole mechanism. The kernel decides; the loser gets `ENOENT` and reads
 * what the winner recorded. Because the claim and the disappearance of the pending name are the
 * SAME operation, there is no instant at which two callers can both hold a claim, and no lock is
 * required for a property a lock would only approximate.
 *
 * The claimed bytes land under a per-claim `.claimed` name rather than directly under the final
 * `.applied.json`, because the receipt is not known yet: publishing the applied file before the
 * commit succeeds would make a crash mid-commit look like a completed apply, and the whole
 * failure-path contract (rename BACK to pending) rests on the applied name meaning "this
 * finished".
 */
export function claimPendingProposal(
  agentQaRoot: string,
  proposalId: string,
  hooks?: ClaimResolutionHooks,
): ConsumeProposalOutcome {
  // IN-03. THE SHAPE CHECK LIVES WHERE THE JOINING HAPPENS. `join()` below turns this string into
  // a `renameSync` target, so an id carrying `../` is a caller-supplied arbitrary-path primitive;
  // executed against the unguarded store, `../../escaped` renamed a file two directories up and
  // returned its contents as a consumed proposal. `knowledge.proposal.apply` already refuses such
  // an id at the function layer — one package away, on ONE of the paths a caller can reach this
  // module by, and this module is the one that does the joining. Before any syscall, so a refused
  // id leaves no probe behind either.
  ProposalIdSchema.parse(proposalId)
  const first = resolveClaim(agentQaRoot, proposalId, hooks)
  if (first.kind !== 'not-found') return first
  // THE BOUNDED RE-ENTRY, and the bound is structural rather than a counter somebody could raise:
  // there is one extra call here and no loop, so "exactly one re-entry" is a fact about the
  // control flow instead of a value to keep in step with a comment. Read the ORDER note inside
  // `resolveClaim` for what the second pass buys and what it does not.
  return resolveClaim(agentQaRoot, proposalId, hooks)
}

/**
 * ONE full pass of the claim resolution: the atomic rename, and — if it lost — the four exits.
 *
 * Split out of `claimPendingProposal` only so the not-found exit can be re-entered from the top.
 * The public signature is unchanged and no caller can reach a single pass: an outcome this
 * function returns as `not-found` is a proposal `claimPendingProposal` has not answered about yet.
 */
function resolveClaim(
  agentQaRoot: string,
  proposalId: string,
  hooks?: ClaimResolutionHooks,
): ConsumeProposalOutcome {
  const claimed = `${pendingPath(agentQaRoot, proposalId)}.claimed.${process.pid}`
  try {
    renameSync(pendingPath(agentQaRoot, proposalId), claimed)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // ORDER: applied → claim scan → BOTH durable names again → not-found, and not-found ONLY
    // AFTER THIS WHOLE PASS HAS RUN TWICE.
    //
    // Two claims live here and they are different sizes. They are kept apart on purpose, because
    // running them together is what shipped a false conclusion at this site for three rounds.
    //
    // (1) SINGLE-RETIREMENT TOTALITY. The ground is not an enumeration of interleaves — it is a
    // property of the only two renames in this module that retire a claim marker.
    //
    //   `publishAppliedProposal` makes the applied file durable BEFORE it retires the marker.
    //   `restorePendingProposal` retires the marker and lands the pending name in ONE rename.
    //
    // So a scan that sees no marker has seen a marker that was either never there or retired —
    // and every retirement leaves one of the two durable names already on disk at the instant the
    // scan runs. Re-reading BOTH names AFTER the scan therefore cannot miss a proposal that ONE
    // retirement moved. A future rename that retires markers inherits the property only by making
    // its own durable name land first, which is the rule to keep.
    //
    // The re-reads sit below the scan and serve EVERY exit under it, not just one. The previous
    // shape put a re-read inside the marker-present arm alone and its comment claimed that closed
    // the sliver in the one direction that could be wrong; there were two directions, one served,
    // and the arm had no test that could redden it (WR-05, measured).
    //
    // (2) WHAT (1) DOES NOT GIVE. The scan is not atomic with the re-reads, so a name that IS on
    // disk when the scan runs can be consumed before a re-read reaches it. Concretely, with three
    // participants: the winner hands the proposal back (marker retired, pending name landed), so
    // the scan finds no marker; a third participant then claims that restored pending name; both
    // re-reads find nothing. (1) is still true, and the universal conclusion drawn from it at this
    // site for three rounds — that no interleaving at all could hide a proposal that exists — does
    // not follow from it.
    //
    // THE ANSWER IS A MECHANISM, NOT A SENTENCE: `claimPendingProposal` re-enters this entire
    // function once and answers not-found only if the SECOND pass also finds nothing. Pass 2
    // cannot be told pass 1's stale story, because it re-derives every fact from disk: if the
    // pending name came back it CLAIMS it (consumed); if somebody holds it the scan finds their
    // marker (apply-in-flight); if the winner published, the first read finds the applied file
    // (already-applied). That covers a marker-retiring rename NOBODY HAS WRITTEN YET by
    // construction rather than by census, which is the difference between (1) and (2) as a rule a
    // future reader can apply — and it is a MEASURED difference: deleting the re-entry reds the
    // three-participant case with the not-found answer and leaves every case (1) owns green.
    //
    // WHAT IS NOT MEASURED, SEPARATED OUT RATHER THAN BUNDLED IN. Each pass is headed by the
    // rename above — the only atomic operation on this path — so pass 2 TAKES the pending name
    // instead of checking for it and acting later. That is the right shape for real concurrency
    // and it is a HYPOTHESIS here, not a tested claim: making the re-entry skip the rename and
    // start at the first applied read leaves this module's whole corpus green, measured. It has
    // to. Pass 2 runs only when pass 1's last read found no pending name, and no event can occur
    // between that read and this rename, so in ONE process pass 2's rename can only ever throw
    // ENOENT. Its value is across real elapsed time between two processes, which this suite's
    // stated in-process limit puts outside what it measures. Keep the rename — a read-only second
    // pass would be check-then-act where this is take — and do not read it as pinned.
    //
    // (3) THE RESIDUAL, WRITTEN AS THE HYPOTHESIS IT IS. A schedule that renames into the gaps of
    // BOTH passes can still produce a false not-found. Nothing here rules that out and no test
    // here measures it; the honest status is unproven-and-believed-rare, not closed. It costs no
    // data — the proposal is on disk under some name and re-invoking apply resolves it — which is
    // why it ships disclosed. The case that reds this mechanism if it is removed is the
    // three-participant interleave in `propose-apply.test.ts` (search `onAfterClaimScan`); a
    // further narrowing needs a further pass and a case that drives it, not another sentence here.
    //
    // THE REJECTED NAME IS READ WHEREVER THE APPLIED NAME IS, and for the same reason: 391's
    // reject lands its durable name BEFORE it retires the claim marker, exactly as the publish
    // above does, so it inherits the single-retirement-totality property rather than needing a
    // new argument. A pass that read only the applied name would satisfy that property and still
    // answer `not-found` about a proposal sitting on disk under the other decided name.
    const decided = readDecidedProposal(agentQaRoot, proposalId)
    if (decided !== undefined) return decided
    hooks?.onAfterFirstRead?.()
    const marker = findClaimMarker(agentQaRoot, proposalId)
    hooks?.onAfterClaimScan?.()
    const published = readDecidedProposal(agentQaRoot, proposalId)
    if (published !== undefined) return published
    if (marker !== undefined) return { kind: 'apply-in-flight', claimPath: marker }
    // No marker and no applied file: if the pending name is back, the retirement was a RESTORE
    // and this proposal is applicable again. Answering `apply-in-flight` hands it to the caller's
    // existing bounded retry loop, which re-asks and takes the claim on its next poll — rather
    // than growing a second recovery mechanism in here beside the one that already works.
    if (pendingProposalExists(agentQaRoot, proposalId)) {
      return { kind: 'apply-in-flight' }
    }
    return { kind: 'not-found' }
  }
  const raw = readJsonIfPresent(claimed)
  if (raw === undefined) {
    // The claim succeeded and the bytes vanished — nothing in this module can produce that, and
    // guessing what the proposal said is exactly the thing propose+apply exists to prevent.
    throw new ProposalNotFoundError(proposalId)
  }
  // THE KNOWLEDGE NARROW, and it is the claim PATH's rule rather than the store's: what this
  // resolution hands back is committed by `publishAppliedProposal`, whose record schema carries a
  // `KnowledgeProposalV1`. A draft claimed here would produce an applied file nothing can read.
  const stored = extractStoredKnowledgeProposal(raw)
  return {
    kind: 'consumed',
    proposal: stored.payload,
    ...(stored.origin === undefined ? {} : { origin: stored.origin }),
  }
}

/**
 * EITHER decided name under this id, as the outcome arm that names it — or `undefined`.
 *
 * One reader for both decisions, so the two reads in `resolveClaim` cannot drift into checking
 * different sets of names at different points of the same pass.
 */
function readDecidedProposal(
  agentQaRoot: string,
  proposalId: string,
): ConsumeProposalOutcome | undefined {
  const applied = readAppliedProposal(agentQaRoot, proposalId)
  if (applied !== undefined) return { kind: 'already-applied', record: applied }
  const rejected = readRejectedProposal(agentQaRoot, proposalId)
  if (rejected !== undefined) return { kind: 'already-rejected', record: rejected }
  return undefined
}

/** The path a claim parked the proposal at. Exported only so the two halves agree on it. */
export function claimedProposalPath(agentQaRoot: string, proposalId: string): string {
  return `${pendingPath(agentQaRoot, proposalId)}.claimed.${process.pid}`
}

/**
 * Publish the applied record and retire the claim. The proposal is now permanently readable.
 */
export function publishAppliedProposal(
  agentQaRoot: string,
  record: AppliedProposalRecord,
): void {
  const validated = AppliedProposalRecordSchema.parse({
    ...record,
    proposal: { ...record.proposal, status: 'applied' },
  })
  const id = validated.proposal.proposalId
  writeFileAtomically(
    appliedPath(agentQaRoot, id),
    `${JSON.stringify(validated, undefined, 2)}\n`,
  )
  // The claim is renamed away only AFTER the applied file is durable, so a crash between the two
  // leaves a claim to recover rather than a proposal that exists in neither name.
  try {
    renameSync(claimedProposalPath(agentQaRoot, id), `${appliedPath(agentQaRoot, id)}.claim`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  fsyncDirectory(proposalsDir(agentQaRoot))
}

/**
 * Put a claimed proposal BACK under its pending name.
 *
 * The failure path, and it is not a nicety. A commit that refuses — a held lease, a gate hold, a
 * malformed delta — must leave the proposal exactly as applicable as it was before the attempt.
 * A half-consumed proposal is invisible data loss: the caller sees an error, retries, and is told
 * the id names nothing — unable to tell a failed apply apart from one that already happened.
 *
 * (Phrased without the quoted-x-then-quoted-y shape on purpose. `validate:arch`'s import
 * extractor matches that shape anywhere in a file, comment prose included, and reports the
 * quoted words as an undeclared package. It fired here, exactly as it fired on 387-02.)
 */
export function restorePendingProposal(agentQaRoot: string, proposalId: string): void {
  try {
    durableRename(claimedProposalPath(agentQaRoot, proposalId), pendingPath(agentQaRoot, proposalId))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** Mint a proposal id in the shape `ProposalIdSchema` refines for. */
export function mintProposalId(randomUuid: () => string): string {
  return `prop_${randomUuid().toLowerCase()}`
}

// ---- 391: the decision half and the inbox (PROP-03 · D-10 · D-12) ----------------------------

/** What a reject did, or why it did nothing. Every arm is a RESULT; none is a throw. */
export type RejectProposalOutcome =
  | { kind: 'rejected'; record: RejectedProposalRecord | DecidedProposalRecord }
  | { kind: 'already-applied'; record: AppliedProposalRecord | DecidedProposalRecord }
  | { kind: 'already-rejected'; record: RejectedProposalRecord | DecidedProposalRecord }
  | { kind: 'apply-in-flight'; claimPath?: string }
  | { kind: 'not-found' }

/**
 * Decline a pending proposal, permanently and with a trail (D-10, D-12).
 *
 * THE RACE RESOLVER IS THE SAME RENAME the apply path uses, deliberately reusing the claim
 * marker rather than minting a sixth name shape. Two rejects, or a reject racing an apply,
 * therefore resolve exactly as two applies do: `renameSync` has one winner, the loser gets
 * ENOENT and is told what the winner recorded. A check-then-write here — "is there a pending
 * file? yes? write the rejection" — would have had a window in which both callers believed they
 * were deciding, and the second decision would have overwritten the first's timestamp and reason
 * while both callers were told they had succeeded.
 *
 * THE ORDER IS THE PUBLISH ORDER, and it is load-bearing rather than symmetric. The durable
 * `.rejected.json` name lands and is fsynced BEFORE the claim marker is retired, which is the
 * property `resolveClaim`'s ORDER note names as the rule a future marker-retiring rename must
 * inherit: a scan that sees no marker has seen one that was retired, and every retirement leaves
 * a durable name already on disk. A crash between the two leaves a claim to recover, never a
 * proposal that exists under no name at all.
 */
export function rejectPendingProposal(
  agentQaRoot: string,
  proposalId: string,
  decision: { readonly at: number; readonly reason?: string },
): RejectProposalOutcome {
  const outcome = decidePendingProposal(agentQaRoot, proposalId, {
    decision: 'rejected',
    at: decision.at,
    ...(decision.reason === undefined ? {} : { reason: decision.reason }),
  })
  // The two vocabularies differ by ONE word and the rename happens here rather than in the generic
  // verb, because `rejected` is what 391's port, op and surfaces have always called this arm and
  // renaming it would have been a wire change for an internal refactor.
  return outcome.kind === 'decided' ? { kind: 'rejected', record: outcome.record } : outcome
}

/** What a decision did, or why it did nothing. Every arm is a RESULT; none is a throw. */
export type DecideProposalOutcome =
  | { kind: 'decided'; record: RejectedProposalRecord | DecidedProposalRecord }
  | { kind: 'already-applied'; record: AppliedProposalRecord | DecidedProposalRecord }
  | { kind: 'already-rejected'; record: RejectedProposalRecord | DecidedProposalRecord }
  | { kind: 'apply-in-flight'; claimPath?: string }
  | { kind: 'not-found' }

/**
 * Close a pending proposal of ANY kind with a human's decision (394-18 · D-05 / D-11 / D-12).
 *
 * THE ONE DECISION PATH FOR THE KIND 394 MINTS, and the generalisation of 391's reject rather
 * than a second mechanism beside it: the same claim rename resolves the race, the same durable name
 * shapes record the answer, and the durable file lands BEFORE the claim marker is retired, so this
 * verb inherits `resolveClaim`'s single-retirement-totality property instead of needing a new
 * argument for it.
 *
 * WHY THE KNOWLEDGE APPLY IS REFUSED HERE BY NAME. Applying a knowledge proposal is not a decision
 * this module can record on its own: it commits deltas and produces a forget receipt, which is what
 * `AppliedProposalRecordSchema` carries and what `apply-review.ts` claims and publishes. A second
 * way to mark a knowledge proposal applied — one that recorded the decision and committed nothing —
 * is exactly the half-applied state the two-step design exists to prevent. Rejecting a knowledge
 * proposal is unaffected, because a rejection commits nothing by definition.
 *
 * THE KNOWLEDGE REJECTION KEEPS ITS 391 SHAPE, byte for byte. A `test-draft` has no
 * `KnowledgeProposalV1` to put in that wrapper's `proposal` field, so it lands as
 * {@link DecidedProposalRecordSchema} — and the classifier tells the two apart structurally.
 */
export function decidePendingProposal(
  agentQaRoot: string,
  proposalId: string,
  decision: {
    readonly decision: ProposalDecision
    readonly at: number
    readonly reason?: string
  },
): DecideProposalOutcome {
  // IN-03, extended to the new verb: the shape check lives where the joining happens, and the
  // joining is a few lines below. Before any syscall, so a refused id leaves no probe behind.
  ProposalIdSchema.parse(proposalId)

  // Asked BEFORE the claim, so a refused decision leaves the proposal exactly as applicable as it
  // was. The read is non-destructive and the answer cannot go stale in the wrong direction: a kind
  // is a fact about a file that no rename changes.
  if (decision.decision === 'applied') {
    const pending = readJsonIfPresent(pendingPath(agentQaRoot, proposalId))
    if (pending !== undefined && extractStoredProposal(pending).kind === 'knowledge') {
      throw new TypeError(
        `proposal ${proposalId} is a knowledge proposal: applying one commits deltas and produces `
          + 'a forget receipt, so it is claimed and published through the knowledge apply rather '
          + 'than recorded here',
      )
    }
  }

  const claimed = claimedProposalPath(agentQaRoot, proposalId)
  try {
    renameSync(pendingPath(agentQaRoot, proposalId), claimed)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const decided = readAnyDecidedProposal(agentQaRoot, proposalId)
    if (decided !== undefined) return decided
    const marker = findClaimMarker(agentQaRoot, proposalId)
    if (marker !== undefined) return { kind: 'apply-in-flight', claimPath: marker }
    return { kind: 'not-found' }
  }

  const stored = extractStoredProposal(readJsonIfPresent(claimed))
  const decisionRecord = {
    decision: decision.decision,
    at: decision.at,
    ...(decision.reason === undefined ? {} : { reason: decision.reason }),
  }
  const record: RejectedProposalRecord | DecidedProposalRecord =
    stored.kind === 'knowledge' && decision.decision === 'rejected'
      ? RejectedProposalRecordSchema.parse({
          proposal: stored.payload,
          decision: decisionRecord,
          ...(stored.origin === undefined ? {} : { origin: stored.origin }),
        })
      : DecidedProposalRecordSchema.parse({
          record: {
            schemaVersion: CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
            id: stored.id,
            kind: stored.kind,
            origin: stored.origin,
            payload: stored.payload,
          },
          decision: decisionRecord,
        })
  const durablePath = decision.decision === 'applied'
    ? appliedPath(agentQaRoot, proposalId)
    : rejectedPath(agentQaRoot, proposalId)
  writeFileAtomically(durablePath, `${JSON.stringify(record, undefined, 2)}\n`)
  try {
    renameSync(claimed, `${durablePath}${RETIRED_CLAIM_SUFFIX}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  fsyncDirectory(proposalsDir(agentQaRoot))
  return { kind: 'decided', record }
}

/**
 * EITHER decided name under this id, in EITHER wrapper shape — the kind-generic loser read.
 *
 * `readDecidedProposal` above stays knowledge-typed because the claim resolution it serves hands
 * its record to a knowledge commit. This one serves the decision path, which is reachable for every
 * kind, so it must be able to read a decided draft without a parse failure that would report a
 * perfectly readable file as a proposal nobody can find.
 */
function readAnyDecidedProposal(
  agentQaRoot: string,
  proposalId: string,
): DecideProposalOutcome | undefined {
  const applied = readJsonIfPresent(appliedPath(agentQaRoot, proposalId))
  if (applied !== undefined) {
    return { kind: 'already-applied', record: parseAppliedFile(applied) }
  }
  const rejected = readJsonIfPresent(rejectedPath(agentQaRoot, proposalId))
  if (rejected !== undefined) {
    return { kind: 'already-rejected', record: parseRejectedFile(rejected) }
  }
  return undefined
}

/**
 * THE DISCRIMINANT BETWEEN THE WRAPPERS is the field name `record`, which neither 387/391 wrapper
 * can carry — both are `.strict()` — so telling the shapes apart needs no version field, no
 * migration and no re-read of a single retained file.
 */
function isGenericDecidedFile(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && 'record' in raw
}

/** One `.applied.json` file, in whichever wrapper wrote it. */
function parseAppliedFile(raw: unknown): AppliedProposalRecord | DecidedProposalRecord {
  return isGenericDecidedFile(raw)
    ? DecidedProposalRecordSchema.parse(raw)
    : AppliedProposalRecordSchema.parse(raw)
}

/** One `.rejected.json` file, in whichever wrapper wrote it. */
function parseRejectedFile(raw: unknown): RejectedProposalRecord | DecidedProposalRecord {
  return isGenericDecidedFile(raw)
    ? DecidedProposalRecordSchema.parse(raw)
    : RejectedProposalRecordSchema.parse(raw)
}

/**
 * Whether a pid names a process that still exists — the WR-03 reap's one dependency.
 *
 * `process.kill(pid, 0)` sends no signal; it asks the kernel the question and reports the answer
 * through `errno`. `ESRCH` is the one that means dead. `EPERM` means the process exists and
 * belongs to somebody else, which is ALIVE — reading it as dead would let this store reap a
 * claim held by a daemon running as another user and hand the same proposal to two appliers.
 *
 * PID REUSE IS THE KNOWN RESIDUAL, disclosed rather than papered over: a recycled pid reads as
 * alive and its orphaned claim survives one more enumeration, which costs nothing but a delay —
 * the opposite direction from the failure that matters. Closing it needs a start-time recorded
 * in the marker, which is a change to the name shape the apply path owns.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** One row of the inbox: the read-time envelope, plus the one fact only the store knows. */
export interface ProposalInboxEntry {
  readonly envelope: ProposalEnvelope
  /**
   * A LIVE claim marker sits beside this proposal: somebody is applying it right now.
   *
   * Deliberately NOT a `ProposalEnvelopeStatus` member. The envelope's four states are what has
   * become of the human DECISION, and an apply in flight has not changed that — the proposal is
   * still pending, it is simply also being acted on. Widening the lifecycle union with a
   * transient filesystem fact would have made every consumer of that union — the digest, the
   * grant machinery, 393-396's kinds — learn about claim markers.
   */
  readonly applyInFlight: boolean
}

export interface ProposalInboxReadOptions {
  /** Epoch milliseconds. Supplied by the caller; this module reads no clock (D-12). */
  readonly now: number
  /** Injected for the reap's corpus; production callers take {@link isProcessAlive}. */
  readonly isProcessAlive?: (pid: number) => boolean
}

/**
 * EVERY proposal this store holds, as read-time envelopes (PROP-03 — 391 is the owner).
 *
 * 387's substrate note said enumeration, reaping and the standing grants that make an inbox
 * meaningful belong to 391. This is the enumeration half, and the reaping rides inside it rather
 * than in a background process on purpose: nothing happens at the moment a proposal expires
 * (D-12), and an orphaned claim is only interesting to somebody looking at the inbox. A reaper
 * would be a second thing that has to be running for the store to be correct.
 *
 * NOTHING IS EVER DELETED. Expiry is computed from the payload's own `proposedAt` against the
 * supplied `now`; the expired file is not touched, and an inbox filtered to `pending` simply
 * stops showing it. The one write this function can perform is the WR-03 restore, which moves a
 * claim marker back to the pending name it came from — a recovery, not a collection.
 */
export function listProposalEnvelopes(
  agentQaRoot: string,
  options: ProposalInboxReadOptions,
): readonly ProposalInboxEntry[] {
  const directory = proposalsDir(agentQaRoot)
  let names: readonly string[]
  try {
    names = readdirSync(directory)
  } catch (error) {
    // AN EMPTY LISTING IS A RESULT (edge PROP-03/empty). A project that has never proposed
    // anything has an empty inbox, and it must read identically to one whose directory simply
    // has not been created yet — the two are the same fact about the same project.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const durable = new Map<string, { readonly state: ProposalDurableState; readonly path: string }>()
  const markers: { readonly id: string; readonly pid: number; readonly path: string }[] = []

  for (const name of names) {
    // Retired markers and in-flight temps are NOISE, not proposals: each sits beside a durable
    // name that is already in this listing, so counting them would double-report a proposal.
    if (name.endsWith(RETIRED_CLAIM_SUFFIX) || name.endsWith(TEMP_SUFFIX)) continue
    const claimAt = name.indexOf(CLAIM_INFIX)
    if (claimAt > 0) {
      const pid = Number(name.slice(claimAt + CLAIM_INFIX.length))
      // A marker whose suffix is not a pid is not a name this store writes. Left alone rather
      // than guessed at: reaping a file nobody can explain is how an inbox loses a proposal.
      if (Number.isInteger(pid) && pid > 0) {
        markers.push({ id: name.slice(0, claimAt), pid, path: join(directory, name) })
      }
      continue
    }
    if (name.endsWith(APPLIED_SUFFIX)) {
      durable.set(name.slice(0, -APPLIED_SUFFIX.length), {
        state: 'applied',
        path: join(directory, name),
      })
      continue
    }
    if (name.endsWith(REJECTED_SUFFIX)) {
      durable.set(name.slice(0, -REJECTED_SUFFIX.length), {
        state: 'rejected',
        path: join(directory, name),
      })
      continue
    }
    if (name.endsWith(PENDING_SUFFIX)) {
      durable.set(name.slice(0, -PENDING_SUFFIX.length), {
        state: 'pending',
        path: join(directory, name),
      })
    }
  }

  const alive = options.isProcessAlive ?? isProcessAlive
  const inFlight = new Set<string>()
  for (const marker of markers) {
    // A durable name already exists for this id: the marker's retirement was the winner's, and
    // the proposal is decided (or restored). Touching it would undo a completed decision.
    if (durable.has(marker.id)) continue
    if (alive(marker.pid)) {
      inFlight.add(marker.id)
      durable.set(marker.id, { state: 'pending', path: marker.path })
      continue
    }
    // WR-03, the reap. The holder is gone, so the proposal is applicable again — and it is put
    // back under the name a fresh apply CLAIMS, not merely reported as pending. A read-time
    // story would leave the next apply staring at the same orphaned marker forever, which is the
    // state 387's `apply-in-flight` arm says "keeps surfacing here until somebody restores it".
    try {
      durableRename(marker.path, pendingPath(agentQaRoot, marker.id))
      durable.set(marker.id, { state: 'pending', path: pendingPath(agentQaRoot, marker.id) })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  // EVERY KIND, as the generic entry (394-18). It was narrowed to the knowledge arm while that was
  // the only arm this store's files could hold and the ordering key was a field only that arm has;
  // the ordering key is now {@link mintedAtOf}, which answers for all three, so the narrow — and
  // the cast it would otherwise have needed at the sort — is gone rather than widened around.
  const entries: ProposalInboxEntry[] = []
  for (const [id, located] of durable) {
    const envelope = envelopeAt(located.path, located.state, options.now)
    if (envelope === undefined) continue
    entries.push({ envelope, applyInFlight: inFlight.has(id) })
  }

  // DETERMINISTIC ORDER (edge PROP-03/ordering): minted-at, then id. `readdirSync` order is a
  // filesystem fact and differs between machines and between two calls after a rename, so a
  // listing that inherited it would render two different tables from one store.
  return entries.sort((left, right) =>
    mintedAtOf(left.envelope) - mintedAtOf(right.envelope)
    || (left.envelope.id < right.envelope.id ? -1 : left.envelope.id > right.envelope.id ? 1 : 0),
  )
}

/**
 * WHEN a proposal was made, for every kind — the ordering key AND the expiry input, spelled once.
 *
 * A knowledge proposal records its own `proposedAt` and has since 387, including in the bare files
 * that carry no origin at all; the kind 394 mints records its own on the envelope's `origin.at`,
 * which its durable record REQUIRES. One function so the sort and the lifecycle rule cannot come
 * to different conclusions about the same file — the failure the envelope's own `status` note
 * describes, arriving through the ordering instead.
 */
function mintedAtOf(envelope: ProposalEnvelope): number {
  return envelope.kind === 'knowledge' ? envelope.payload.proposedAt : envelope.origin?.at ?? 0
}

/**
 * ONE proposal, in full — the envelope a human reads BEFORE deciding (PROP-03, D-15).
 *
 * Answered by filtering the enumeration rather than by three point reads, and that is the whole
 * reason it is written this way: `show` and `list` must agree about what a name shape means, and
 * the cheapest way to guarantee that is for there to be one classifier. A second, faster path
 * here would be free to disagree about an orphaned claim on exactly the proposal somebody is
 * looking at.
 */
export function showProposalEnvelope(
  agentQaRoot: string,
  proposalId: string,
  options: ProposalInboxReadOptions,
): ProposalInboxEntry | undefined {
  // IN-03: parsed before the enumeration compares it to anything, so a traversal id is refused
  // by the same law on this verb as on the other two.
  ProposalIdSchema.parse(proposalId)
  return listProposalEnvelopes(agentQaRoot, options)
    .find((entry) => entry.envelope.id === proposalId)
}

/** Read one durable file and project it into the read-time envelope its state implies. */
function envelopeAt(
  path: string,
  state: ProposalDurableState,
  now: number,
): ProposalEnvelope | undefined {
  const raw = readJsonIfPresent(path)
  if (raw === undefined) return undefined
  if (state === 'pending') return envelopeOf(extractStoredProposal(raw), 'pending', undefined, now)
  const record = state === 'applied' ? parseAppliedFile(raw) : parseRejectedFile(raw)
  if ('record' in record) {
    return envelopeOf(
      extractStoredProposal(record.record),
      state,
      record.decision,
      now,
    )
  }
  return envelopeOf(
    {
      id: record.proposal.proposalId,
      kind: 'knowledge',
      payload: record.proposal,
      ...(record.origin === undefined ? {} : { origin: record.origin }),
    },
    state,
    record.decision,
    now,
  )
}

function envelopeOf(
  stored: StoredProposal,
  durableState: ProposalDurableState,
  decision: ProposalDecisionRecord | undefined,
  now: number,
): ProposalEnvelope {
  const common = {
    id: stored.id,
    // The ONE lifecycle rule, computed by the schema's own function rather than re-derived from
    // the suffix this module happened to classify. A second spelling of "what does 30 days mean"
    // is how the inbox and the digest start disagreeing about the same file. `proposedAt` is
    // {@link mintedAtOf}'s answer, so the expiry and the ordering read one fact.
    status: computeProposalEnvelopeStatus({
      durableState,
      proposedAt: proposedAtOf(stored),
      now,
    }),
    ...(stored.origin === undefined ? {} : { origin: stored.origin }),
    evidenceRefs: evidenceRefsFor(stored),
    ...(decision === undefined ? {} : { decision }),
  }
  // The cast is on the CORRELATION rather than on the payload: `stored` is already discriminated
  // and its payload already parsed at its own arm, and TypeScript cannot see that spreading a
  // discriminated pair back into an object literal preserves the pairing. Every field above is
  // kind-independent by construction.
  return { ...common, kind: stored.kind, payload: stored.payload } as ProposalEnvelope
}

/** When the proposal was made — the same answer {@link mintedAtOf} gives, off the stored record. */
function proposedAtOf(stored: StoredProposal): number {
  return stored.kind === 'knowledge' ? stored.payload.proposedAt : stored.origin?.at ?? 0
}

/**
 * What to go and look at before deciding.
 *
 * Drawn from what the proposal itself addresses rather than assembled from a second source: the
 * target ref IS the thing a reviewer opens, and the run ref is present exactly when the mint
 * recorded one. The grains are the envelope's own three, and `record`/`bundle` are deliberately
 * the same two words `KnowledgeTargetRef` discriminates on, so a surface resolving a ref out of
 * the inbox resolves it the same way it resolves one out of the verb that proposed it.
 *
 * THE AUTHORING KIND ADDRESSES RUNS AND NOTHING ELSE (394-18), which is a fact about the grain
 * vocabulary rather than a gap: a draft's evidence is the runs the gates took, and neither a shelf
 * file nor a step index is a `record`, a `bundle` or a `run`. Inventing a fourth grain so this arm
 * could have more refs would put an address in an inbox that no surface in this build can resolve.
 * The draft's bytes stay one `proposals.show` away, which is the arm's own map-not-territory
 * posture.
 */
function evidenceRefsFor(stored: StoredProposal): readonly ProposalEvidenceRef[] {
  if (stored.kind === 'knowledge') {
    const refs: ProposalEvidenceRef[] = [
      stored.payload.targetRef.grain === 'record'
        ? { grain: 'record', ref: stored.payload.targetRef.recordId }
        : { grain: 'bundle', ref: stored.payload.targetRef.shortId },
    ]
    if (stored.origin?.runId !== undefined) refs.push({ grain: 'run', ref: stored.origin.runId })
    return refs
  }
  // DISTINCT run ids, kept a SET rather than reduced to the one field left after 411 removed the
  // second contributor: the mint records at most one attributable run per non-knowledge envelope
  // today, and the set is what keeps a second contributor from re-introducing the duplicate this
  // fold was written to collapse.
  const runIds = new Set<string>()
  if (stored.origin?.runId !== undefined) runIds.add(stored.origin.runId)
  return [...runIds].map((ref) => ({ grain: 'run', ref }))
}
