// The three quarantine verbs, over the committed ledger (Phase 390, D-11/D-12/D-13).
//
// `QuarantineOperationsPort` is declared in schema and bound at `composeLocalAgent`; this module is
// its ONE implementation, and it owns exactly the three things the port contract deliberately does
// not: the D-12 triage-queue ordering, the pinned default lifetime an absent deadline takes, and
// the instant every event is stamped with. All three are host facts, and a port that accepted them
// as arguments would let a caller decide them.
//
// WALL-CLOCK PURITY BY ARGUMENT. `now` is REQUIRED, not defaulted: this module reads no clock at
// all (asserted by a source scan in its suite), which is 390-01's ledger posture extended to the
// serving layer exactly as 390-03 extended it to the authoring reader. Each verb reads the injected
// clock ONCE and threads that one instant through the fold, the event stamps and the derived
// deadline — two reads inside one call could land either side of a deadline and answer a state the
// caller never asked about.
//
// COMMITTED-TRUTH READ POSTURE. Every verb folds the ledger before it decides anything, and a
// ledger this build cannot read PROPAGATES its typed error rather than degrading to an empty fold.
// Healing there would answer "nothing is quarantined" about a file full of entries — silently
// un-quarantining every one of them, which is the exact silent flip this phase exists to prevent.
//
// WRITES ARE ALL-OR-NOTHING AND AUDITED. Every append goes through `appendQuarantineEvents`, whose
// committed-egress checkpoint runs before a byte reaches the file. That checkpoint answers a
// refusal as DATA; this port's own contract has no blocked arm — `add` answers entered|renewed and
// `release` answers released|no-entry — so a refusal is re-raised here as a typed error. The
// alternative would have been to answer `entered` while the ledger recorded nothing, which tells an
// operator a test is quarantined when the next run will fail on it.
//
// SERIALIZATION IS THIS MODULE'S, and it is taken here rather than assumed about a caller. `release`
// and `add` run their WHOLE read-fold-decide-append cycle inside the MRSW writer lease — acquired
// here, released here, on every exit — or inside the authority a host that already holds the lease
// hands in (`resolveWriterAuthority`; the daemon acquires at startup and would otherwise be told
// `held` by itself). Serializing only the append would leave the interesting race intact: two
// writers folding a ledger with no entry for a test would both decide `entered` and both append, so
// the DECISION is inside the scope and there is no await point between the read and the write.
// `list` acquires nothing — a reader that took the lease would queue every enumeration behind
// whatever drain is running.
//
// This replaces a claim that serialization was the caller's, "positionally". It was false, and
// statically so (390-09 / CR-03): nothing on the path from `invokeFunction('quarantine.add')` to
// `appendQuarantineEvents` held a lease. The two-OS-process byte-interleaving consequence is a
// separately filed human-verification item; what is enforced and pinned here is that a lease held
// by another writer refuses this verb typed, with the ledger byte-unchanged.

import {
  CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
  QUARANTINE_UNASSIGNED_OWNER,
  slugBranch,
} from '@vostride/agent-qa-schema'
import type {
  GuardrailPolicy,
  QuarantineAddInput,
  QuarantineAddOutput,
  QuarantineEntryState,
  QuarantineLedgerEvent,
  QuarantineOperationsPort,
  QuarantineReleaseInput,
  QuarantineReleaseOutput,
  VerdictClass,
} from '@vostride/agent-qa-schema'

import { acquireWriterLease, releaseLease } from '../lease/writer-lease.js'
import type { WriterLease } from '../lease/writer-lease.js'
import { QUARANTINE_DEFAULT_EXPIRY_DAYS } from './detection.js'
import {
  appendQuarantineEvents,
  foldQuarantineLedgerState,
  readQuarantineLedger,
} from './ledger.js'

const MS_PER_DAY = 86_400_000

/**
 * What a manually added window records where an auto-entry records the fingerprint that crossed.
 *
 * A human quarantining a known-broken test is not reporting a recurrence, so there is no window key
 * to carry — and the `entered` event REQUIRES one (an entry with no fingerprint would fail the
 * ledger's own shape guard). A typed literal that cannot be mistaken for a real key is the honest
 * answer: every computed fingerprint contains `::`, this one contains none.
 */
export const QUARANTINE_MANUAL_ENTRY_FINGERPRINT = 'manual-entry'

/**
 * The class a manual entry records: `unknown`, on the merits rather than for convenience.
 *
 * `unknown` is precisely "a failure carrying no verdict" — nothing classified this test, because a
 * human decided to suppress it rather than a detector deciding it recurred. Recording a made-up
 * `flake` would put an assertion nobody made into committed truth, and the detection ladder reads
 * the class of AUTO entries only, so no rule changes behaviour on the strength of this value.
 */
export const QUARANTINE_MANUAL_ENTRY_CLASS: VerdictClass = 'unknown'

/**
 * A write the committed-egress checkpoint refused.
 *
 * The port's result unions carry no blocked arm by design (390-04), so the refusal surfaces as a
 * typed throw naming what the detectors matched. The ledger is byte-unchanged when this is raised —
 * the checkpoint runs before any write.
 */
export class QuarantineWriteBlockedError extends Error {
  constructor(readonly detections: readonly { label: string; detector: string }[]) {
    super(
      `the quarantine ledger write was refused by the committed-egress checkpoint: ${
        detections.map((detection) => detection.detector).join(', ')
      }`,
    )
    this.name = 'QuarantineWriteBlockedError'
  }
}

/**
 * Another writer holds the MRSW lease, so the verb declined instead of writing beside it.
 *
 * Same shape and same reason as `QuarantineWriteBlockedError` above: the port's result unions carry
 * no lease arm by design (390-04), so a refusal that is not one of the named outcomes surfaces as a
 * typed throw. The ledger is byte-unchanged when this is raised — the acquisition fails before the
 * read, so nothing was decided either.
 *
 * The holder is carried, not just named in the message, because the operator's next question is
 * always "who?" and the answer is a live pid the CLI can report without re-reading the lease file.
 * This verb does NOT wait and does NOT delegate: an operator retrying by hand is a better failure
 * mode than a human-facing verb that blocks for as long as a drain takes.
 */
export class QuarantineLeaseHeldError extends Error {
  constructor(readonly holder: WriterLease) {
    super(
      'the quarantine ledger write was refused: the knowledge writer lease is held by pid '
        + `${holder.pid} (lease ${holder.leaseId}, epoch ${holder.epoch}). `
        + 'Retry once that writer finishes.',
    )
    this.name = 'QuarantineLeaseHeldError'
  }
}

export interface QuarantineOperationsOptions {
  /** The committed knowledge root. A FACTORY, because the CLI host resolves it asynchronously. */
  resolveKnowledgeRoot: () => Promise<string> | string
  /** Explicit audit location for the egress checkpoint; nothing resolves into a working directory. */
  auditBaseDir: string
  /** The ONLY way wall clock enters these verbs. Required — see the module head. */
  now: () => string
  /**
   * The writer lease THIS process already holds, when it holds one (387-08 D-18 / D-5).
   *
   * Supplied by the daemon host, which acquires at startup and holds for its whole lifetime: a
   * holder that calls `acquireWriterLease` is answered `held` by itself and, unlike the apply path,
   * has nobody to delegate to. Absent on the CLI in-process host, which holds nothing and therefore
   * takes the lease per call. The value is not consulted for fencing here — an append to the
   * committed ledger is one line through the egress checkpoint, not an index mutation — it answers
   * exactly one question: has this process already serialized itself?
   */
  resolveWriterAuthority?: () => { leaseId: string; epoch: number } | undefined
  policy?: GuardrailPolicy
}

/** The identity key the ledger is folded on: `(product, filePath, testName)`, never `testId`. */
function identityKey(identity: {
  product: string
  filePath: string
  testName: string
}): string {
  return JSON.stringify([identity.product, identity.filePath, identity.testName])
}

/**
 * D-12's triage order, spelled once.
 *
 * Unassigned entries FIRST because they are the queue a human works — an owned entry already has
 * somebody accountable for it. Then `enteredAt` ascending, so the oldest unclaimed suppression is
 * the first thing anyone sees. Ties break on identity bytes, which is what makes the answer a
 * function of the ledger's CONTENT rather than of the order events happened to be appended in: two
 * entries stamped in the same second must not swap places between two reads.
 *
 * The instant compared is the FOLDED entry's `enteredAt` — for a test that was released and crossed
 * again, that is its most recent entry, which is the one an operator is looking at.
 */
function triageOrder(left: QuarantineEntryState, right: QuarantineEntryState): number {
  const leftUnassigned = left.owner === QUARANTINE_UNASSIGNED_OWNER
  const rightUnassigned = right.owner === QUARANTINE_UNASSIGNED_OWNER
  if (leftUnassigned !== rightUnassigned) return leftUnassigned ? -1 : 1
  if (left.enteredAt !== right.enteredAt) return left.enteredAt < right.enteredAt ? -1 : 1
  const leftKey = identityKey(left)
  const rightKey = identityKey(right)
  if (leftKey === rightKey) return 0
  return leftKey < rightKey ? -1 : 1
}

/** The deadline an absent `expiresAt` takes (D-11), derived from the SUPPLIED instant. */
function defaultExpiry(now: string): string {
  return new Date(Date.parse(now) + QUARANTINE_DEFAULT_EXPIRY_DAYS * MS_PER_DAY).toISOString()
}

/**
 * The three verbs over one committed ledger.
 *
 * Each call is a full read-fold-decide-append cycle. Nothing is cached between calls, which is what
 * makes `quarantine.list` and the sentence's ladder clause two readings of ONE live computation
 * (SC4): an event appended between two calls is visible to both.
 */
export function createQuarantineOperations(
  options: QuarantineOperationsOptions,
): QuarantineOperationsPort {
  /** One read of the injected clock, one fold against it — the whole state a verb decides on. */
  function readState(knowledgeRoot: string): {
    now: string
    entries: QuarantineEntryState[]
  } {
    const now = options.now()
    // Typed refusals propagate — see the module head. `refusedLines` are the ledger's own
    // line-level damage report and do not stop the neighbours from folding.
    const { events } = readQuarantineLedger(knowledgeRoot)
    return { now, entries: foldQuarantineLedgerState(events, now) }
  }

  /**
   * The write verbs' serialized section — the whole read-fold-decide-append cycle, not the append.
   *
   * Serializing only the file write would leave the interesting race intact: two writers could both
   * fold a ledger with no entry for a test, both decide `entered`, and both append, producing two
   * opening events for one window. So `decide` runs INSIDE the scope and is deliberately synchronous
   * — there is no await point between the read and the append for another writer to be scheduled at.
   *
   * Three arms, and they are exhaustive over the acquisition outcome:
   *  - a handed-in authority means this process IS the holder; it acquires nothing and releases
   *    nothing, because the lease it was given outlives this call (the `applyReview` arm);
   *  - `held` refuses typed, having written nothing and having taken nothing from the holder;
   *  - every other non-`acquired` outcome rethrows the union's own error, which every refusal arm
   *    carries precisely so a new arm surfaces by name instead of being swallowed here.
   */
  async function underWriterLease<T>(knowledgeRoot: string, decide: () => T): Promise<T> {
    if (options.resolveWriterAuthority?.() !== undefined) return decide()

    const acquired = acquireWriterLease(knowledgeRoot)
    if (acquired.kind === 'held') throw new QuarantineLeaseHeldError(acquired.holder)
    if (acquired.kind !== 'acquired') throw acquired.error

    try {
      return decide()
    } finally {
      // Given back on EVERY exit, including the typed ledger refusals the read raises: a verb that
      // failed must not leave the next drain locked out of the knowledge root.
      releaseLease({ knowledgeRoot, leaseId: acquired.leaseId })
    }
  }

  function append(knowledgeRoot: string, events: readonly QuarantineLedgerEvent[]): void {
    const outcome = appendQuarantineEvents(knowledgeRoot, events, {
      auditBaseDir: options.auditBaseDir,
      ...(options.policy === undefined ? {} : { policy: options.policy }),
    })
    if (outcome.kind === 'egress-blocked') throw new QuarantineWriteBlockedError(outcome.detections)
  }

  function entryFor(
    entries: readonly QuarantineEntryState[],
    identity: { product: string; filePath: string; testName: string },
  ): QuarantineEntryState | undefined {
    const key = identityKey(identity)
    return entries.find((entry) => identityKey(entry) === key)
  }

  /**
   * The write verbs' ONE normalization, taken at the boundary before anything decides (WR-01).
   *
   * `product` reaches these verbs as whatever a human typed at `quarantine.add`, while every reader
   * of the ledger compares the SLUGGED partition — `resolveRunQuarantineSnapshot` filters on
   * `entry.product === slugBranch(input.product)`, and the detection path authors entries from
   * projection rows that are already partitioned that way. Storing the raw spelling therefore wrote
   * a real entry into a partition nothing reads: the verb answered `entered` and the quarantined
   * test kept failing every build.
   *
   * Normalizing (rather than refusing a mismatch) is the choice on the merits: a human exit-path
   * verb should DO what was meant, and the auto half already writes slugged bytes, so the ledger
   * keeps ONE vocabulary instead of two that agree only by convention. `slugBranch` is idempotent
   * on its own output, so an already-slugged product round-trips byte-identically and no existing
   * entry moves.
   *
   * Applied once, here, and threaded to all four places the identity is used — the fold lookup, the
   * authored event, the answered entry, and the release join. A slug applied at only one of them is
   * strictly worse than none: the write and the lookup would then disagree with each other as well
   * as with the reader.
   */
  function normalize(
    input: { product: string; filePath: string; testName: string },
  ): { product: string; filePath: string; testName: string } {
    return {
      product: slugBranch(input.product),
      filePath: input.filePath,
      testName: input.testName,
    }
  }

  return {
    async list(): Promise<readonly QuarantineEntryState[]> {
      // Acquisition-free ON PURPOSE: this reads and answers, and a reader that took the writer
      // lease would queue every enumeration behind whatever drain happens to be running.
      const { entries } = readState(await options.resolveKnowledgeRoot())
      // Every state, unfiltered (the op's own contract): an operator deciding what to release
      // needs the expired and released rows as much as the suppressing ones.
      return [...entries].sort(triageOrder)
    },

    async release(input: QuarantineReleaseInput): Promise<QuarantineReleaseOutput> {
      const knowledgeRoot = await options.resolveKnowledgeRoot()
      return await underWriterLease(knowledgeRoot, () => {
        const { now, entries } = readState(knowledgeRoot)
        const entry = entryFor(entries, normalize(input))
        // An OPEN window is one no release event has closed — `expired` counts, because D-11 keeps
        // an expired entry listed, renewable AND releasable; it stopped suppressing, it did not
        // vanish. Absent or already-closed answers the named arm and appends nothing: "that test is
        // not quarantined" is an ordinary answer, and an event recording a release that released
        // nothing would put a lie in committed history.
        if (entry === undefined || entry.state === 'released') return { kind: 'no-entry' }

        append(knowledgeRoot, [{
          schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
          kind: 'released-manual',
          at: now,
          product: entry.product,
          filePath: entry.filePath,
          testName: entry.testName,
        }])

        // The entry as it stands AFTER the release — a caller reading `released` learns what it
        // closed without a second read, and the state it reports is the post-write one.
        return { kind: 'released', entry: { ...entry, state: 'released' } }
      })
    },

    async add(input: QuarantineAddInput): Promise<QuarantineAddOutput> {
      const knowledgeRoot = await options.resolveKnowledgeRoot()
      return await underWriterLease(knowledgeRoot, () => {
        const { now, entries } = readState(knowledgeRoot)
        const identity = normalize(input)
        const entry = entryFor(entries, identity)
        const expiresAt = input.expiresAt ?? defaultExpiry(now)

        // An open window (suppressing OR lapsed) is EXTENDED rather than reopened, so the ledger
        // keeps one continuous window instead of two overlapping ones. A closed window re-enters —
        // D-10's "re-entry needs no special rule", and the repeated `entered` lines are the history
        // the event log was chosen to keep (390-05: the intended record, not duplication).
        if (entry !== undefined && entry.state !== 'released') {
          append(knowledgeRoot, [{
            schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
            kind: 'renewed',
            at: now,
            product: entry.product,
            filePath: entry.filePath,
            testName: entry.testName,
            expiresAt,
            // OMITTED when the caller named nobody: an absent owner leaves the existing claim (or
            // the unassigned literal) exactly as it was. Writing `unassigned` here would silently
            // UN-claim a window somebody had taken.
            ...(input.owner === undefined ? {} : { owner: input.owner }),
          }])
          return {
            kind: 'renewed',
            entry: {
              ...entry,
              owner: input.owner ?? entry.owner,
              expiresAt,
              // A renewal on a lapsed entry puts it back under suppression, which is the whole
              // point of keeping an expired entry renewable.
              state: 'quarantined',
            },
          }
        }

        const owner = input.owner ?? QUARANTINE_UNASSIGNED_OWNER
        append(knowledgeRoot, [{
          schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
          kind: 'entered',
          at: now,
          ...identity,
          fingerprint: QUARANTINE_MANUAL_ENTRY_FINGERPRINT,
          verdictClass: QUARANTINE_MANUAL_ENTRY_CLASS,
          owner,
          expiresAt,
        }])

        return {
          kind: 'entered',
          entry: {
            // The identity that was STORED, never the spelling the caller sent: an answer naming
            // the raw product would tell an operator a partition exists that does not.
            ...identity,
            fingerprint: QUARANTINE_MANUAL_ENTRY_FINGERPRINT,
            verdictClass: QUARANTINE_MANUAL_ENTRY_CLASS,
            owner,
            enteredAt: now,
            expiresAt,
            state: 'quarantined',
          },
        }
      })
    },
  }
}
