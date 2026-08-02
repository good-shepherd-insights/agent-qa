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

import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { KnowledgeProposalV1Schema, ForgetReceiptV1Schema } from '@vostride/agent-qa-schema'
import type { ForgetReceiptV1, KnowledgeProposalV1 } from '@vostride/agent-qa-schema'
import { z } from 'zod'

import { durableRename, fsyncDirectory, fsyncFile } from '../durable-fs.js'

/** The one directory name proposals live under, beneath the agent-qa runtime root. */
export const PROPOSALS_DIR_NAME = 'proposals'

/**
 * The applied file carries the proposal AND what applying it produced.
 *
 * Storing the receipt beside the applied proposal rather than deriving it again is what makes
 * the already-applied answer honest: a second apply reports what the FIRST one did, read off
 * the durable record, instead of recomputing an answer over a store that has since moved on.
 */
export const AppliedProposalRecordSchema = z.object({
  proposal: KnowledgeProposalV1Schema,
  forgetReceipt: ForgetReceiptV1Schema.optional(),
}).strict()

export type AppliedProposalRecord = z.infer<typeof AppliedProposalRecordSchema>

/** Thrown when a proposal id names nothing this store has ever written. */
export class ProposalNotFoundError extends Error {
  constructor(readonly proposalId: string) {
    super(`No knowledge proposal is stored under id ${proposalId}`)
    this.name = 'ProposalNotFoundError'
  }
}

export function proposalsDir(agentQaRoot: string): string {
  return join(agentQaRoot, PROPOSALS_DIR_NAME)
}

function pendingPath(agentQaRoot: string, proposalId: string): string {
  return join(proposalsDir(agentQaRoot), `${proposalId}.json`)
}

function appliedPath(agentQaRoot: string, proposalId: string): string {
  return join(proposalsDir(agentQaRoot), `${proposalId}.applied.json`)
}

function readJsonIfPresent(path: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
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
): void {
  const directory = proposalsDir(agentQaRoot)
  mkdirSync(directory, { recursive: true })
  const validated = KnowledgeProposalV1Schema.parse(proposal)
  writeFileAtomically(
    pendingPath(agentQaRoot, validated.proposalId),
    `${JSON.stringify(validated, undefined, 2)}\n`,
  )
  fsyncDirectory(directory)
}

/** The pending proposal under this id, or `undefined` if it is absent or already applied. */
export function readPendingProposal(
  agentQaRoot: string,
  proposalId: string,
): KnowledgeProposalV1 | undefined {
  const raw = readJsonIfPresent(pendingPath(agentQaRoot, proposalId))
  if (raw === undefined) return undefined
  return KnowledgeProposalV1Schema.parse(raw)
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
}

export type ConsumeProposalOutcome =
  | { kind: 'consumed'; proposal: KnowledgeProposalV1 }
  | { kind: 'already-applied'; record: AppliedProposalRecord }
  /**
   * SOMEBODY ELSE HOLDS THE CLAIM AND IS MID-APPLY. Distinct from `not-found`, and the
   * distinction is the whole arm.
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
  | { kind: 'apply-in-flight' }
  | { kind: 'not-found' }

/**
 * Whether SOME process has this exact proposal parked under a claim name right now.
 *
 * A POINT LOOKUP FOR ONE ID, not an inbox. It reads the directory because that is the only way
 * to see a claim whose suffix is another process's pid, but it answers one question about one
 * id and returns a boolean — there is deliberately no way to get a LIST out of it, because
 * enumeration is 391's (D-17) and a listing verb that arrived here by accident would be the
 * substrate quietly growing the surface it was scoped out of.
 *
 * The prefix is `<proposalId>.json.claimed.`, which cannot collide with two neighbours it sits
 * beside: `<proposalId>.applied.json` does not start with it, and the `.json` separator means a
 * proposal id of `p1` cannot match `p12`'s claim.
 */
function claimMarkerPresent(agentQaRoot: string, proposalId: string): boolean {
  const prefix = `${proposalId}.json.claimed.`
  try {
    return readdirSync(proposalsDir(agentQaRoot)).some((entry) => entry.startsWith(prefix))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
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
): ConsumeProposalOutcome {
  const claimed = `${pendingPath(agentQaRoot, proposalId)}.claimed.${process.pid}`
  try {
    renameSync(pendingPath(agentQaRoot, proposalId), claimed)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // ORDER: applied → claim marker → applied AGAIN → not-found.
    //
    // The second applied read is not belt-and-braces. `publishAppliedProposal` writes the applied
    // file and only THEN retires the claim marker, so a winner that publishes between the first
    // read and the scan leaves both a missing applied (as this caller saw it) and a still-present
    // marker — and answering `apply-in-flight` there would make a completed apply look ongoing,
    // sending the caller into a wait for work that is already durable. Re-reading closes that
    // sliver in the only direction that can be wrong.
    const applied = readAppliedProposal(agentQaRoot, proposalId)
    if (applied !== undefined) return { kind: 'already-applied', record: applied }
    if (claimMarkerPresent(agentQaRoot, proposalId)) {
      const published = readAppliedProposal(agentQaRoot, proposalId)
      if (published !== undefined) return { kind: 'already-applied', record: published }
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
  return { kind: 'consumed', proposal: KnowledgeProposalV1Schema.parse(raw) }
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
