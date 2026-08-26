// The post-verdict step the runner shell awaits (Phase 404 plan 01, D-09 / D-10 / D-11).
//
// WHAT THIS FILE OWNS. Three things and no fourth:
//
//   1. `dispositionOf` — the D-09 DECISION FUNCTION. One total mapping from "what did the writer
//      lease say" to the posture `runFinished.disposition` publishes. It is pure, it is the only
//      place the three wire values are chosen, and it is total over the lease outcome's `kind`
//      domain so a new refusal arm cannot silently fall through to a value nobody picked.
//   2. THE ONE LEASE ACQUISITION per run. `acquireWriterLease` is called exactly once inside
//      `run()`, on the run's own knowledge root, and never again by anything downstream.
//   3. THE HANDOFF BOX. What that acquisition produced leaves through `takeAcquiredLease()`, ONCE,
//      to whoever will actually pump the chain.
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
// acquisition happens here exactly once and travels to the pump as a value, rather than each leg
// consulting the lease for itself. `takeAcquiredLease()` is take-ONCE for the same reason from the
// other direction: two callers each believing they hold the lease is the same defect wearing a
// different hat, and the second caller gets `undefined` instead of a duplicate authority.
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
 */
export interface PostVerdictStepOperations {
  acquireWriterLease: typeof LOCAL_DAEMON_CAPABILITIES.acquireWriterLease
  releaseLease: typeof LOCAL_DAEMON_CAPABILITIES.releaseLease
  nudgeDaemon: typeof nudgeDaemon
}

/** What one lease consult answered — the union `dispositionOf` is total over. */
export type WriterLeaseOutcome = ReturnType<PostVerdictStepOperations['acquireWriterLease']>

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
   * The authority this step acquired, ONCE. A second call answers `undefined`, whether or not the
   * first caller did anything with it — see the Pitfall 3 note in this file's header.
   */
  takeAcquiredLease(): CurationWriterAuthority | undefined
}

/** The named degrade codes this step can carry to the shell's `runWarning` channel (D-11). */
const WRITER_LEASE_REFUSED = 'writer-lease-refused'
const POST_PROCESSING_UNBOUND = 'post-processing-unbound'

function defaultOperations(): PostVerdictStepOperations {
  return {
    acquireWriterLease: LOCAL_DAEMON_CAPABILITIES.acquireWriterLease,
    releaseLease: LOCAL_DAEMON_CAPABILITIES.releaseLease,
    nudgeDaemon,
  }
}

/**
 * The D-09 decision: lease state at the verdict → the posture the wire publishes.
 *
 * TOTAL OVER `kind`, deliberately as a `switch` with no `default`. `AcquireWriterLeaseOutcome`
 * grows refusal arms over time (three at the time of writing); a `default` would absorb a new one
 * into whatever value happened to be adjacent, and this is the field 408's embed and every thin
 * client parse.
 *
 * The three undecidable inputs are NOT one case wearing three names:
 *   - `leaseSkipped` — a deliberate skip (404-04 grows the gate-run and `--detach` producers).
 *     `detached` with NO warning: nothing went wrong, so nothing is worth waking anyone for.
 *   - `lease === undefined` and not skipped — no lease capability composed on this host at all.
 *     `post-processing-unbound`: the honest "nothing will be drained from here, and here is why".
 *   - `kind: 'refused'` — a lease that exists and could not be evaluated. `writer-lease-refused`
 *     carrying the refusal's own `reason`, which is the vocabulary every other lease consumer
 *     already renders.
 */
export function dispositionOf(input: {
  readonly lease?: WriterLeaseOutcome
  readonly leaseSkipped: boolean
}): PostVerdictOutcome {
  if (input.leaseSkipped) return { disposition: 'detached' }
  const lease = input.lease
  if (lease === undefined) {
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
  switch (lease.kind) {
    case 'held':
      // Somebody else holds a CURRENT-epoch lease and will pump. `handedOff` is a promise about
      // who owns the work, never a claim that the work succeeded (D-09).
      return { disposition: 'handedOff' }
    case 'acquired':
      // Nobody held it and this process took it, so this process WILL pump under it.
      return { disposition: 'drained' }
    case 'refused':
      return {
        disposition: 'detached',
        warning: {
          code: WRITER_LEASE_REFUSED,
          message:
            `The writer lease could not be evaluated (${lease.reason}), so this run's `
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
  let decided: PostVerdictOutcome | undefined

  const port: PostVerdictPort = {
    async run(): Promise<PostVerdictOutcome> {
      const root = options.knowledgeRoot
      // THE one acquisition (see this file's header). Synchronous by contract — the lease API does
      // its own bounded contention internally, and the shell bounds the whole step besides.
      const lease = ops().acquireWriterLease(root)
      if (lease.kind === 'held') {
        // The SHIPPED nudge envelope, verbatim from the tail's own hand-off leg: its handler
        // already calls `requestDrain` and wakes the job dispatcher, and a nudge that never lands
        // is invisible by design because the daemon's own poll is the backstop. Fire-and-forget:
        // this step may not spend the verdict's milliseconds waiting for a daemon to answer.
        void ops().nudgeDaemon(options.agentQaRoot, { knowledgeRoot: root }).catch(() => undefined)
      }
      if (lease.kind === 'acquired') {
        acquired = { leaseId: lease.leaseId, epoch: lease.epoch }
      }
      // `leaseSkipped` has no producer in 404-01 — the gate-run (D-08) and `--detach` skips are
      // 404-04's, which is also where the enqueue moves in ahead of this consult. The parameter
      // exists now because the decision function must be TOTAL before anything reads its answer
      // off a frozen wire field, and it is pinned on both arms by `post-verdict-step.test.ts`.
      const outcome = dispositionOf({ lease, leaseSkipped: false })
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
 * The structural no-leak rule for a door whose tail never ran: the step acquires because a pump was
 * expected, and if no pump claimed the authority it must not be left to expire on its TTL while
 * every other process reads the run as `handedOff` to a holder that is not pumping. Warn-only —
 * the exit code froze long before this line, and a lease this process cannot release expires on
 * its own.
 */
export function releaseUntakenPostVerdictLease(input: {
  readonly handoff: PostVerdictHandoff
  readonly knowledgeRoot: string
  readonly runId: string
  readonly log: { warn(message: string): void }
  readonly operations?: Partial<Pick<PostVerdictStepOperations, 'releaseLease'>>
}): void {
  const authority = input.handoff.takeAcquiredLease()
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
