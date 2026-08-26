// The post-verdict step the runner shell awaits (Phase 404 plan 01, D-09 / D-10 / D-11).
//
// WHAT THIS FILE OWNS. Three things and no fourth:
//
//   1. `dispositionOf` — the D-09 DECISION FUNCTION. One total mapping from "what did the writer
//      lease say" to the posture `runFinished.disposition` publishes. It is pure, it is the only
//      place the three wire values are chosen, and it is total over the probe's `kind` domain so a
//      new arm cannot silently fall through to a value nobody picked.
//   2. THE ONE LEASE ACQUISITION per run. `acquireWriterLease` is called AT MOST ONCE for a run,
//      on the run's own knowledge root, and never again by anything downstream.
//   3. THE HANDOFF BOX. What that acquisition produced leaves through `takeAcquiredLease()`, ONCE,
//      to whoever will actually pump the chain.
//
// THE ACQUISITION IS LAZY, AND THAT IS THE POINT (2026-08-26).
//
// `run()` DECIDES the disposition; it does not mutate the lease. The decision is taken from a
// NON-ACQUIRING read — `readWriterLease` + `deriveWriterLeaseFreshness`, the same pair
// `classifyDaemonRegistration` classifies a holder from — and the actual `acquireWriterLease` is
// deferred to `takeAcquiredLease()`, i.e. to the moment a pump asks for the authority.
//
// It was eager first, and eager was measurably wrong. The shell awaits this step on EVERY run,
// including the runs that end above the tail: `in-process-run-execution.ts` re-throws
// `produced.takeFrameworkError()` before `options.afterVerdict`, so a run that dies on "browser
// support is not installed" never reaches `postRunTail.drain({ lease: … })`. Acquiring at the
// verdict therefore minted an epoch and a lease file for a chain nobody was going to pump, and the
// no-leak backstop below then released it and printed `post-run lease released untaken` on stderr
// — on ORDINARY runs, which is how `run-parity.e2e.test.ts` caught it. Acquiring nothing costs
// nothing to release and has nothing to warn about: the step that has no pump now leaves the
// lease file exactly as it found it.
//
// WHAT IT DOES NOT OWN. It publishes nothing on the bus — the shell is the single owner of the
// terminal sequence (RESEARCH Pitfall 7), so this file returns a VALUE and the shell decides what
// to say about it. It pumps nothing: the chain drain, its budget and its chip emitter stay with
// `post-run-tail.ts`. It resolves no knowledge root of its own — the producer already resolved the
// root this run used, and a second `resolveKnowledgeRoot` here would be a second answer to "where
// does this run's knowledge live" (the exact class of defect `chainJobIdsForRun` is centralised
// against). It enqueues nothing yet: the durable `analyze-run` enqueue relocates into this step in
// 404-04, which is also where the gate-run skip (D-08) and `--detach` grow arms on `dispositionOf`.
//
// RESEARCH PITFALL 3 BY NAME — TWO LEASE HOLDERS IN ONE PROCESS. A process that holds the writer
// lease and calls `acquireWriterLease` again is answered `held` — by ITSELF — and would hand its
// own work off to nobody: chips never move and the claimed row is left claimed. That is why the
// acquisition happens here at most once and travels to the pump as a value, rather than each leg
// consulting the lease for itself. `takeAcquiredLease()` is take-ONCE for the same reason from the
// other direction: two callers each believing they hold the lease is the same defect wearing a
// different hat, and the second caller gets `undefined` instead of a duplicate authority.
//
// WHAT LAZINESS COSTS, STATED. `drained` is the posture "nobody held this run's lease at the
// verdict, so this process will take it and pump" (D-09), and between the verdict and the pump's
// request a daemon may take it first. The pump then receives `undefined`, `drain()` falls back to
// its own consult, is answered `held`, and reports `handed-off` — the work still gets done by the
// holder, and the wire's `drained` is the posture that was true when it was published. D-09 already
// says the field is a posture and never a claim about what became of the chain; that is chip truth
// (`runs.postprocessing`). The reverse corner is the same size: an authority state that only the
// ACQUISITION can see refused (a mutation lock no contender can reclaim, or corrupt epoch bytes
// behind an absent lease file) reads `drained` on the wire and drains nothing. Both were already
// possible with the eager acquisition — a lease acquired at the verdict is no guarantee the pump
// runs — and neither is worth a stderr line on every ordinary run.
//
// Import discipline (FUNC-02): a CLI file may name only `agent`, `agent-local` and `schema` across
// package boundaries. The runner's port vocabulary therefore arrives through `agent-local`'s
// barrel, which re-exports it for exactly this hop, and the lease/daemon capabilities arrive
// through `LOCAL_DAEMON_CAPABILITIES` — the one composition edge that already publishes them.

import { LOCAL_DAEMON_CAPABILITIES } from '@vostride/agent-qa-agent-local'
import type { PostVerdictOutcome, PostVerdictPort } from '@vostride/agent-qa-agent-local'

import { nudgeDaemon } from '../daemon/client.js'
import type { CurationWriterAuthority } from './curation-tail.js'

/**
 * The capability table, stubbable per cell.
 *
 * Named through `LOCAL_DAEMON_CAPABILITIES`'s own members rather than re-declared, so a signature
 * change on the lease API is a compile error here rather than a drifted second spelling.
 *
 * `readWriterLease` + `deriveWriterLeaseFreshness` are the DECISION half and `acquireWriterLease`
 * is the MUTATION half, and they are separate members because the step calls them at different
 * moments: the first pair at the verdict, the second only if a pump asks.
 */
export interface PostVerdictStepOperations {
  acquireWriterLease: typeof LOCAL_DAEMON_CAPABILITIES.acquireWriterLease
  releaseLease: typeof LOCAL_DAEMON_CAPABILITIES.releaseLease
  readWriterLease: typeof LOCAL_DAEMON_CAPABILITIES.readWriterLease
  /**
   * CR-01/CR-08: the ONE three-valued freshness verdict. A surface that classified a holder from
   * the lease file alone would read "nobody holds it" out of an epoch it could not read, which is
   * the defect this derivation exists to make unreachable — so `unknown` is named below rather
   * than inherited.
   */
  deriveWriterLeaseFreshness: typeof LOCAL_DAEMON_CAPABILITIES.deriveWriterLeaseFreshness
  nudgeDaemon: typeof nudgeDaemon
  /** The one instant the freshness verdict is taken against. */
  now: () => number
}

/** What an ACQUISITION answered — the mutating half of the lease API. */
export type WriterLeaseOutcome = ReturnType<PostVerdictStepOperations['acquireWriterLease']>

/** What the non-mutating READ answered, before any freshness verdict is derived from it. */
export type WriterLeaseReadOutcome = ReturnType<PostVerdictStepOperations['readWriterLease']>

/**
 * The three answers a NON-ACQUIRING lease probe can give, and the domain `dispositionOf` is total
 * over.
 *
 * Deliberately not `AcquireWriterLeaseOutcome`: that union's `acquired` arm is a statement that a
 * lease file was rewritten, and this probe rewrites nothing. `free` is the honest name for what it
 * can observe — "no current-epoch holder is present" — which is a fact about the lease, not about
 * this process.
 */
export type WriterLeaseProbe =
  | { readonly kind: 'held' }
  | { readonly kind: 'free' }
  | { readonly kind: 'refused'; readonly reason: string }

export interface PostVerdictStepOptions {
  readonly runId: string
  /** `<configDir>/.agent-qa` — what `nudgeDaemon` addresses the daemon registration through. */
  readonly agentQaRoot: string
  /**
   * The run's ALREADY-RESOLVED knowledge root, from the producer that resolved it for the run
   * itself. Passed rather than re-derived: the enqueue, the drain and this consult must address
   * one root, and two derivations are free to disagree.
   */
  readonly knowledgeRoot: string
  readonly log: { warn(message: string): void }
  /** Focused test seam. Production callers omit it. */
  readonly operations?: Partial<PostVerdictStepOperations>
}

/**
 * The box the acquired lease travels in, from the step to whoever pumps.
 *
 * `outcome` is diagnostic only — the shell already published the posture; this is for a host that
 * wants to know what its own step decided without re-reading the wire.
 */
export interface PostVerdictHandoff {
  readonly outcome: PostVerdictOutcome | undefined
  /**
   * ACQUIRE (once) and hand over. This is the call a pump makes, and it is the only thing in this
   * file that mutates the lease file: a step whose run never reaches a pump acquires nothing at
   * all. A second call answers `undefined`, whether or not the first caller did anything with it —
   * see the Pitfall 3 note in this file's header. `undefined` also comes back when the acquisition
   * itself found a holder or refused, in which case the caller's own fallback consult decides.
   */
  takeAcquiredLease(): CurationWriterAuthority | undefined
  /**
   * Take whatever authority is ALREADY in the box, acquiring nothing.
   *
   * The no-leak backstop's accessor, and it is a different verb on purpose: a release path that
   * called `takeAcquiredLease()` would acquire a lease for the sole purpose of releasing it —
   * mint an epoch, rewrite the lease file, release it, and warn about it — which is the ordinary
   * run this step was making noisy in the first place.
   */
  takeUnclaimedLease(): CurationWriterAuthority | undefined
}

/** The named degrade codes this step can carry to the shell's `runWarning` channel (D-11). */
const WRITER_LEASE_REFUSED = 'writer-lease-refused'
const POST_PROCESSING_UNBOUND = 'post-processing-unbound'

function defaultOperations(): PostVerdictStepOperations {
  return {
    acquireWriterLease: LOCAL_DAEMON_CAPABILITIES.acquireWriterLease,
    releaseLease: LOCAL_DAEMON_CAPABILITIES.releaseLease,
    readWriterLease: LOCAL_DAEMON_CAPABILITIES.readWriterLease,
    deriveWriterLeaseFreshness: LOCAL_DAEMON_CAPABILITIES.deriveWriterLeaseFreshness,
    nudgeDaemon,
    now: () => Date.now(),
  }
}

/**
 * Is a CURRENT-EPOCH holder present? Answered without touching the lease file.
 *
 * TOTAL OVER THE FOUR READ KINDS, deliberately as a `switch` with no `default` and no trailing
 * return — `classifyDaemonRegistration`'s own shape, for the same reason: the line this idiom
 * replaces everywhere it appears is `if (read.kind !== 'parsed') …`, which folds "I could not read
 * the authority state" into "nobody holds it".
 *
 *   - `absent` / `malformed` — genuine recovery input. Nobody holds a lease anyone can honour, so
 *     an acquisition would succeed by reclaiming: `free`.
 *   - `unreadable` — a lease that EXISTS and could not be opened (EACCES, EIO, EMFILE). Never
 *     evidence that nobody holds it, and the acquisition refuses on this input with exactly this
 *     reason, so the probe reports the same refusal rather than promising a drain that cannot
 *     happen.
 *   - `parsed` — the freshness verdict decides, and its `unknown` arm answers `refused` for the
 *     same argument the acquisition's `corrupt-epoch-state` refusal is built on.
 */
export function probeWriterLease(input: {
  readonly knowledgeRoot: string
  readonly operations: Pick<
    PostVerdictStepOperations,
    'readWriterLease' | 'deriveWriterLeaseFreshness' | 'now'
  >
}): WriterLeaseProbe {
  const read: WriterLeaseReadOutcome = input.operations.readWriterLease(input.knowledgeRoot)
  switch (read.kind) {
    case 'absent':
    case 'malformed':
      return { kind: 'free' }
    case 'unreadable':
      return { kind: 'refused', reason: `unreadable-lease-state (${read.code})` }
    case 'parsed': {
      const verdict = input.operations.deriveWriterLeaseFreshness(
        input.knowledgeRoot,
        read.lease,
        input.operations.now(),
      )
      switch (verdict.kind) {
        case 'fresh':
          return { kind: 'held' }
        case 'reclaimable':
          // A stale holder, or one naming a superseded epoch: the acquisition below would reclaim
          // it, so nothing is holding this run's chain up.
          return { kind: 'free' }
        case 'unknown':
          return { kind: 'refused', reason: 'corrupt-epoch-state' }
      }
    }
  }
}

/**
 * The D-09 decision: lease state at the verdict → the posture the wire publishes.
 *
 * TOTAL OVER `kind`, deliberately as a `switch` with no `default`. `WriterLeaseProbe` grows arms
 * over time; a `default` would absorb a new one into whatever value happened to be adjacent, and
 * this is the field 408's embed and every thin client parse.
 *
 * The three undecidable inputs are NOT one case wearing three names:
 *   - `leaseSkipped` — a deliberate skip (404-04 grows the gate-run and `--detach` producers).
 *     `detached` with NO warning: nothing went wrong, so nothing is worth waking anyone for.
 *   - `probe === undefined` and not skipped — no lease capability composed on this host at all.
 *     `post-processing-unbound`: the honest "nothing will be drained from here, and here is why".
 *   - `kind: 'refused'` — an authority state that exists and could not be evaluated.
 *     `writer-lease-refused` carrying the probe's own `reason`, which is the vocabulary every
 *     other lease consumer already renders.
 */
export function dispositionOf(input: {
  readonly probe?: WriterLeaseProbe
  readonly leaseSkipped: boolean
}): PostVerdictOutcome {
  if (input.leaseSkipped) return { disposition: 'detached' }
  const probe = input.probe
  if (probe === undefined) {
    return {
      disposition: 'detached',
      warning: {
        code: POST_PROCESSING_UNBOUND,
        message:
          'No writer-lease capability is composed on this host, so this run\'s post-processing '
          + 'chain will not be drained from this process. The next local run or `agent-qa daemon` '
          + 'drains it.',
      },
    }
  }
  switch (probe.kind) {
    case 'held':
      // Somebody else holds a CURRENT-epoch lease and will pump. `handedOff` is a promise about
      // who owns the work, never a claim that the work succeeded (D-09).
      return { disposition: 'handedOff' }
    case 'free':
      // Nobody holds it, so this process is the one that will take it — when its pump asks.
      return { disposition: 'drained' }
    case 'refused':
      return {
        disposition: 'detached',
        warning: {
          code: WRITER_LEASE_REFUSED,
          message:
            `The writer lease could not be evaluated (${probe.reason}), so this run's `
            + 'post-processing chain will not be drained from this process.',
        },
      }
  }
}

/**
 * Compose this run's post-verdict step: the port the shell awaits, and the box its lease leaves in.
 *
 * `run()` NEVER throws for a lease refusal — that is a decided posture with a named warning, not a
 * failure. An UNEXPECTED throw (a capability that raised rather than returning a refusal) is
 * deliberately allowed to propagate, so the shell's own degrade path — `post-verdict-step-failed` —
 * is a live path rather than dead code nothing can reach.
 */
export function createPostVerdictStep(options: PostVerdictStepOptions): {
  readonly port: PostVerdictPort
  readonly handoff: PostVerdictHandoff
} {
  const ops = (): PostVerdictStepOperations => ({ ...defaultOperations(), ...options.operations })
  let acquired: CurationWriterAuthority | undefined
  let claimed = false
  let decided: PostVerdictOutcome | undefined
  /**
   * What `takeAcquiredLease()` should do when a pump finally asks.
   *
   * `run()` sets it and nothing else does. 404-04 adds the arm where the host SUPPLIES a writer
   * authority it already holds (the daemon door), which lands here as a third state rather than as
   * a second acquisition — the seam is this variable, not the call below.
   */
  let plan: 'acquire' | 'none' = 'none'

  const port: PostVerdictPort = {
    async run(): Promise<PostVerdictOutcome> {
      const root = options.knowledgeRoot
      // The DECISION read. Non-mutating by construction — see this file's header for why the
      // acquisition is not here.
      const probe = probeWriterLease({ knowledgeRoot: root, operations: ops() })
      if (probe.kind === 'held') {
        // The SHIPPED nudge envelope, verbatim from the tail's own hand-off leg: its handler
        // already calls `requestDrain` and wakes the job dispatcher, and a nudge that never lands
        // is invisible by design because the daemon's own poll is the backstop. Fire-and-forget:
        // this step may not spend the verdict's milliseconds waiting for a daemon to answer.
        void ops().nudgeDaemon(options.agentQaRoot, { knowledgeRoot: root }).catch(() => undefined)
      }
      if (probe.kind === 'free') {
        plan = 'acquire'
      }
      // `leaseSkipped` has no producer in 404-01 — the gate-run (D-08) and `--detach` skips are
      // 404-04's, which is also where the enqueue moves in ahead of this consult. The parameter
      // exists now because the decision function must be TOTAL before anything reads its answer
      // off a frozen wire field, and it is pinned on both arms by `post-verdict-step.test.ts`.
      const outcome = dispositionOf({ probe, leaseSkipped: false })
      decided = outcome
      return outcome
    },
  }

  return {
    port,
    handoff: {
      get outcome(): PostVerdictOutcome | undefined {
        return decided
      },
      takeAcquiredLease(): CurationWriterAuthority | undefined {
        if (claimed) return undefined
        claimed = true
        if (acquired === undefined && plan === 'acquire') {
          // THE one acquisition (see this file's header), made on behalf of the pump that just
          // asked for it. Synchronous by contract — the lease API does its own bounded contention
          // internally. A `held` or `refused` answer hands back `undefined`: the caller's own
          // consult is then the fallback, and this box never acquires again.
          const outcome = ops().acquireWriterLease(options.knowledgeRoot)
          if (outcome.kind === 'acquired') {
            acquired = { leaseId: outcome.leaseId, epoch: outcome.epoch }
          }
        }
        const held = acquired
        acquired = undefined
        return held
      },
      takeUnclaimedLease(): CurationWriterAuthority | undefined {
        if (claimed) return undefined
        claimed = true
        const held = acquired
        acquired = undefined
        return held
      },
    },
  }
}

/**
 * Release a lease nobody took, and say so.
 *
 * The structural no-leak rule for a door whose tail never ran: if an authority is sitting in the
 * box unclaimed it must not be left to expire on its TTL while every other process reads the run
 * as handed off to a holder that is not pumping. Warn-only — the exit code froze long before this
 * line, and a lease this process cannot release expires on its own.
 *
 * IT ACQUIRES NOTHING. Under the lazy step above, an ordinary run that never reaches a pump has an
 * empty box here, so this is a silent no-op rather than the `released untaken` line it used to
 * print on every framework-error exit. It stays wired into the drive's outermost `finally` because
 * the box CAN hold an unclaimed authority — a host that hands the step an authority it already
 * acquired (404-04's daemon door arm), or any future producer that fills the box ahead of a pump —
 * and a leaked writer lease is exactly the failure nobody notices until the next run is told the
 * chain is handed off to a process that has exited.
 */
export function releaseUntakenPostVerdictLease(input: {
  readonly handoff: PostVerdictHandoff
  readonly knowledgeRoot: string
  readonly runId: string
  readonly log: { warn(message: string): void }
  readonly operations?: Partial<Pick<PostVerdictStepOperations, 'releaseLease'>>
}): void {
  const authority = input.handoff.takeUnclaimedLease()
  if (authority === undefined) return
  const release = input.operations?.releaseLease ?? LOCAL_DAEMON_CAPABILITIES.releaseLease
  try {
    release({ knowledgeRoot: input.knowledgeRoot, leaseId: authority.leaseId })
  } catch {
    // Same posture as the tail's own release: a lease this process cannot release expires on its
    // TTL, and failing a finished run over cleanup would spend the verdict-first guarantee.
  }
  input.log.warn(
    `Run ${input.runId}: post-run lease released untaken — the post-verdict step acquired the `
    + 'writer lease but no post-run tail claimed it, so nothing was drained from this process.',
  )
}
