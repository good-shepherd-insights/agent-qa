// The three grant verbs, over the committed ledger (Phase 391, D-03/D-04/D-05/D-11).
//
// `StandingGrantsPort` is declared in schema and bound at `composeLocalAgent`; this module is its
// ONE implementation, and it owns exactly the three things the port contract deliberately does not:
// the instant every event is stamped with, the grant's durable identity, and the serialization the
// committed append rides. All three are host facts, and a port that accepted them as arguments
// would let a caller decide them — a caller-supplied `at` backdates the record of when autonomy was
// widened, and a caller-supplied `grantId` collides with an existing approval or forges a revoke
// target.
//
// THE MINT SIDE OF D-05 IS THE FIRST THING `record` DOES. Before the knowledge root is resolved,
// before a lease is taken and before a byte is read, a protected action class is refused with a
// typed DATA arm. The ordering is the point twice over: a refused mint costs the committed tree
// nothing and the next writer nothing, and — the load-bearing half — an accept-with-always whose
// apply succeeded and whose mint was refused must be able to report BOTH, which an exception
// thrown from inside a lease would not let it do.
//
// AND IT IS ONLY HALF THE RULE. The other half lives in `reader.ts`, where a grant whose class is
// protected is refused at MATCH time even though this mint would never have produced it. Neither
// side subsumes the other and each is pinned separately: this one guards what a producer can
// author, that one guards what a hand-edited COMMITTED file can authorize. A one-sided guard on a
// two-sided contract is a regression generator, twice measured in this repository.
//
// WALL-CLOCK PURITY BY ARGUMENT. `now` is REQUIRED, not defaulted: this module reads no clock at
// all, which is 391-01's ledger posture extended to the serving layer exactly as the quarantine
// verbs extended it to theirs. Each verb reads the injected clock ONCE and threads that one instant
// through the event stamp and the derived identity.
//
// COMMITTED-TRUTH READ POSTURE. Every verb folds the ledger before it decides anything, and a
// ledger this build cannot read PROPAGATES its typed error rather than degrading to an empty fold.
// Healing there would answer "no approvals are in force" about a file full of them — and then
// happily record a duplicate of one of them.
//
// WRITES ARE ALL-OR-NOTHING AND AUDITED. Every append goes through `appendGrantLedgerEvents`, whose
// committed-egress checkpoint runs before a byte reaches the file. That checkpoint answers a refusal
// as DATA; this port's contract has no blocked arm — `record` answers recorded|already-granted|
// protected-class and `revoke` answers revoked|no-grant — so a refusal is re-raised here as a typed
// error. The alternative would have been to answer `recorded` while the ledger recorded nothing,
// which tells a person a standing approval exists and leaves the next ask denying.
//
// SERIALIZATION IS THIS MODULE'S, taken through the ONE shared scope (`lease/under-writer-lease.ts`
// — lifted out of the quarantine verbs by this plan, because a serialization rule written twice is
// a serialization rule that agrees until it does not). `record` and `revoke` run their WHOLE
// read-fold-decide-append cycle inside the MRSW writer lease, or inside the authority a host that
// already holds it hands in — CHECKED, not believed. `list` acquires nothing: a reader that took
// the writer lease would queue every enumeration behind whatever drain is running, and "what may
// the agent currently do without asking" is a question a person asks while a drain is running.

import {
  canonicalJson,
  isProtectedActionClass,
  sha256hex16,
  CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
import type {
  ActiveStandingGrant,
  GrantLedgerEvent,
  GrantRecordInput,
  GrantRecordOutcome,
  GrantsRevokeInput,
  GrantsRevokeOutput,
  GuardrailPolicy,
  StandingGrantsPort,
  TrustScope,
} from '@vostride/agent-qa-schema'

import { underKnowledgeWriterLease } from '../lease/under-writer-lease.js'
import type { SynchronousDecision } from '../lease/under-writer-lease.js'
import type { WriterLease } from '../lease/writer-lease.js'
import { appendGrantLedgerEvents, foldActiveGrants, readGrantLedger } from './ledger.js'

/**
 * A grant write the committed-egress checkpoint refused.
 *
 * The port's result unions carry no blocked arm by design, so the refusal surfaces as a typed throw
 * naming what the detectors matched. The ledger is byte-unchanged when this is raised — the
 * checkpoint runs before any write. Same shape and same reasoning as the quarantine sibling; a
 * distinct class because the artifact and the operator's next step are different.
 */
export class GrantWriteBlockedError extends Error {
  constructor(readonly detections: readonly { label: string; detector: string }[]) {
    super(
      `the standing-grant ledger write was refused by the committed-egress checkpoint: ${
        detections.map((detection) => detection.detector).join(', ')
      }`,
    )
    this.name = 'GrantWriteBlockedError'
  }
}

/**
 * Another writer holds the MRSW lease, so the verb declined instead of writing beside it.
 *
 * The ledger is byte-unchanged when this is raised — the acquisition fails before the read, so
 * nothing was decided either. The holder is carried rather than merely named in the message,
 * because the operator's next question is always "who?" and the answer is a live pid a surface can
 * report without re-reading the lease file.
 *
 * WHICH ARM THIS IS. `acquireWriterLease` answers `held` — and therefore raises this — only when
 * the lease on disk parses AND is FRESH. Against a STALE holder nothing is raised at all: the
 * acquisition enters the standard MRSW path and RECLAIMS, exactly as the sibling verbs do. Against
 * a fresh holder this verb genuinely does not wait and does not delegate; a human-facing decision
 * verb that blocked for as long as a drain takes is a worse failure mode than one an operator
 * retries.
 */
export class GrantLeaseHeldError extends Error {
  constructor(readonly holder: WriterLease) {
    super(
      'the standing-grant ledger write was refused: the knowledge writer lease is held by pid '
        + `${holder.pid} (lease ${holder.leaseId}, epoch ${holder.epoch}). `
        + 'Retry once that writer finishes.',
    )
    this.name = 'GrantLeaseHeldError'
  }
}

export interface GrantOperationsOptions {
  /** The committed knowledge root. A FACTORY, because the CLI host resolves it asynchronously. */
  resolveKnowledgeRoot: () => Promise<string> | string
  /** Explicit audit location for the egress checkpoint; nothing resolves into a working directory. */
  auditBaseDir: string
  /** The ONLY way wall clock enters these verbs. Required — see the module head. */
  now: () => string
  /**
   * The writer lease THIS process already holds, when it holds one.
   *
   * Supplied by the daemon host, which acquires at startup and holds for its whole lifetime: a
   * holder that calls `acquireWriterLease` is answered `held` by itself. Absent on the CLI
   * in-process host, which holds nothing and therefore takes the lease per call. The value is
   * CHECKED against disk on every write verb, so what it answers is "is this process STILL the
   * holder?" rather than "did this process already serialize itself?".
   *
   * Reachable today only in principle: both grant-mutating verbs require a human-origin caller and
   * the daemon mints an agent-origin one, so the daemon cannot currently reach them. It is bound
   * anyway rather than omitted, because the arm that is unreachable is the arm nobody notices going
   * wrong the day a host mints differently.
   */
  resolveWriterAuthority?: () => { leaseId: string; epoch: number } | undefined
  policy?: GuardrailPolicy
}

/**
 * The durable identity a mint records, DERIVED rather than drawn at random.
 *
 * A random id would make the same decision, retried, mint two approvals — and the `already-granted`
 * arm below only closes that window while the first line is still in force. Deriving from the class,
 * the scope and the instant means a retry inside one clock tick addresses the SAME grant, and two
 * different classes can never collide. The prefix is human-legible in a committed diff and in the
 * revoke verb's argument, which is where these ids are read.
 */
function mintGrantId(actionClass: string, scope: TrustScope, at: string): string {
  return `grant_${sha256hex16(`${actionClass} ${canonicalJson(scope)} ${at}`)}`
}

/**
 * Whether an already-active grant covers exactly what a mint is asking for.
 *
 * `===` on the class and canonical bytes on the scope, which is the gate's own rule rather than a
 * looser neighbour of it: `grantCovers` demands an exact class and an exact scope, so anything this
 * treated as "already covered" that the gate would not match would leave a person told they had a
 * standing approval that never satisfies an ask.
 */
function covers(grant: ActiveStandingGrant, input: GrantRecordInput): boolean {
  return (
    grant.actionClass === input.actionClass
    && canonicalJson(grant.scope) === canonicalJson(input.scope)
  )
}

/**
 * The three verbs over one committed ledger.
 *
 * Each call is a full read-fold-decide-append cycle. Nothing is cached between calls, which is what
 * makes `grants.list` and the gate's own ask arm two readings of ONE live computation: an event
 * appended between two calls is visible to both.
 */
export function createGrantOperations(options: GrantOperationsOptions): StandingGrantsPort {
  /** One fold of the committed file — the whole state a verb decides on. */
  function readActive(knowledgeRoot: string): ActiveStandingGrant[] {
    // Typed refusals propagate — see the module head. `refusedLines` are the ledger's own
    // line-level damage report and do not stop the neighbours from folding.
    return foldActiveGrants(readGrantLedger(knowledgeRoot).events)
  }

  /** This composition's serialized section, over the ONE shared lease scope. */
  async function serialized<T>(
    knowledgeRoot: string,
    decide: () => T & SynchronousDecision<T>,
  ): Promise<T> {
    return await underKnowledgeWriterLease(
      knowledgeRoot,
      options.resolveWriterAuthority,
      decide,
      (holder: WriterLease) => new GrantLeaseHeldError(holder),
    )
  }

  function append(knowledgeRoot: string, events: readonly GrantLedgerEvent[]): void {
    const outcome = appendGrantLedgerEvents(knowledgeRoot, events, {
      auditBaseDir: options.auditBaseDir,
      ...(options.policy === undefined ? {} : { policy: options.policy }),
    })
    if (outcome.kind === 'egress-blocked') throw new GrantWriteBlockedError(outcome.detections)
  }

  return {
    async list() {
      // Acquisition-free ON PURPOSE — see the module head.
      //
      // UNFILTERED, including any grant whose class is protected. That is deliberate and it is the
      // one place this module and the reader answer differently: `list` is a REPORT about the file
      // and `grantsFor` is an AUTHORIZATION answer. A protected line that reached the committed
      // ledger by a hand-edit authorizes nothing, but it is exactly the line a reviewer has to be
      // able to find — and hiding it would leave `grants.revoke` unable to name the id.
      //
      // ONE read serves both halves: the fold and the damage report describe the same bytes, which
      // a second read of a committed file could not promise.
      const read = readGrantLedger(await options.resolveKnowledgeRoot())
      return { grants: foldActiveGrants(read.events), refusedLines: read.refusedLines }
    },

    async record(input: GrantRecordInput): Promise<GrantRecordOutcome> {
      // FIRST, before the root is resolved and before the lease is acquired: the D-05 mint half.
      // A class no grant may ever cover has no business taking a lock or opening a committed file,
      // and an input tripping BOTH this and a held lease answers THIS.
      if (isProtectedActionClass(input.actionClass)) {
        return { kind: 'protected-class', actionClass: input.actionClass }
      }

      const knowledgeRoot = await options.resolveKnowledgeRoot()
      return await serialized(knowledgeRoot, () => {
        const now = options.now()
        const active = readActive(knowledgeRoot)

        // Grants never accrete. A second accept-with-always on a class already covered records
        // nothing: two lines would need two revokes to undo one approval, and the second revoke is
        // the one nobody remembers to issue.
        const existing = active.find((grant) => covers(grant, input))
        if (existing !== undefined) return { kind: 'already-granted', grant: existing }

        const grant: ActiveStandingGrant = {
          grantId: mintGrantId(input.actionClass, input.scope, now),
          actionClass: input.actionClass,
          scope: input.scope,
          grantedAt: now,
          ...(input.proposalId === undefined ? {} : { proposalId: input.proposalId }),
        }

        append(knowledgeRoot, [{
          schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
          kind: 'grant',
          at: now,
          grantId: grant.grantId,
          actionClass: grant.actionClass,
          scope: grant.scope,
          ...(grant.proposalId === undefined ? {} : { proposalId: grant.proposalId }),
        }])

        // The grant as COMMITTED, so a caller reading `recorded` learns the id it would revoke
        // without a second read, and what it reports is what the next fold will answer.
        return { kind: 'recorded', grant }
      })
    },

    async revoke(input: GrantsRevokeInput): Promise<GrantsRevokeOutput> {
      const knowledgeRoot = await options.resolveKnowledgeRoot()
      return await serialized(knowledgeRoot, () => {
        const now = options.now()
        const grant = readActive(knowledgeRoot).find(
          (candidate) => candidate.grantId === input.grantId,
        )
        // Absent is an ordinary answer and appends nothing: an event recording the withdrawal of an
        // approval that was not in force would put a lie in committed history, and the fold's own
        // no-op arm exists precisely so it does not have to be invented here.
        if (grant === undefined) return { outcome: 'no-grant', grantId: input.grantId }

        append(knowledgeRoot, [{
          schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
          kind: 'revoke',
          at: now,
          // Identity ONLY. A revoke that re-stated the class and the scope would be a second copy
          // of the match rule, and two copies of a match rule is how a revoke starts missing the
          // grant it was written for (the ledger's own module head).
          grantId: grant.grantId,
        }])

        // What was withdrawn, as it stood — a surface says "you revoked the standing approval for
        // X" without going back to a file the revoke has already changed.
        return { outcome: 'revoked', grant }
      })
    },
  }
}
