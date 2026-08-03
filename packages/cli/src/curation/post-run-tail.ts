// The one post-run tail (Phase 388 plan 02, D-01 / D-03 / D-05 / D-07).
//
// Both of `run.ts`'s tail call sites end here. What the run process owes the post-run chain is
// two separable things, and separating them is the whole design:
//
//   1. ENQUEUE — a durable record that this run has analysis waiting. Idempotent by `runId`,
//      fence-free (385 D-02), and performed even under `--detach`, because detaching asks this
//      process not to SPEND itself on the work, never to forget the work exists (Pitfall 3).
//   2. DRAIN OR HAND OFF — spending this process on the chain when nothing else can. If the
//      writer lease is free, pump the chain here under the ONE budget; if a daemon holds it,
//      nudge and return immediately. The run process never waits on the daemon (D-03).
//
// Everything below is warn-only. The exit code was frozen by `mapVerdictToExitCode` before this
// file is reached, and `runVerdictFirstCurationTail` returns it whatever happens here (JOBQ-06).
// A failure to enqueue costs this run its analysis and nothing else — no retry file, no second
// durable medium for a fact the queue owns (D-07).

// Import discipline (FUNC-02): this file is CLI surface code written after the firewall was
// armed, so it may name only `agent`, `agent-local` and `schema` across package boundaries —
// never `core`, `knowledge-local`, `runner-local` or `safety`. Everything it needs from those
// arrives through the one composition edge (`LOCAL_DAEMON_CAPABILITIES`, `DRAIN_BUDGET_MS`) or
// through `curation-tail.ts`, which is ledgered for exactly those specifiers. That is not
// ceremony: it is what keeps the run tail's reach identical to the reach the tail already had.

import { invokeFunction, RUNS_POST_PROCESSING_FUNCTION_ID } from '@vostride/agent-qa-agent'
import type { JobModelCapability } from '@vostride/agent-qa-agent'
import { DRAIN_BUDGET_MS, LOCAL_DAEMON_CAPABILITIES } from '@vostride/agent-qa-agent-local'
import type { LocalAgentHost } from '@vostride/agent-qa-agent-local'
import type { PostProcessingStatus, RunNotification } from '@vostride/agent-qa-schema'

import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../composition/local-agent-host.js'
import { nudgeDaemon } from '../daemon/client.js'
import {
  completedRunDir,
  completedRunHandoffPath,
  curateCompletedRun,
  curationTailHandoffDigest,
  defaultCurationTailOperations,
  runCurationTail,
  type CurationTailOperations,
  type CurationWriterAuthority,
  type RunCurationTailOptions,
} from './curation-tail.js'
import { createPostRunChipEmitter } from './post-run-chip-emitter.js'

/**
 * What became of the durable hand-off.
 *
 * `deduped` is a SUCCESS, not a lesser one: the second tail run for a run id is exactly what
 * the `(kind, idempotency_key)` unique index exists to absorb, and reporting it as a failure
 * would make the store's guarantee look like an error to every reader of this report.
 */
export type PostRunEnqueueOutcome = 'enqueued' | 'deduped' | 'failed' | 'skipped'

/** What became of the in-process chain pump. */
export type PostRunDrainOutcome =
  | 'not-attempted'
  | 'detached'
  | 'handed-off'
  | 'drained'
  | 'budget-exhausted'
  | 'retry-scheduled'
  | 'refused'

/**
 * Control flow only.
 *
 * Deliberately NOT the user-facing vocabulary: the D-08 summary line is rendered by plan 04
 * from DURABLE job state, because a report built in this process cannot know what the daemon
 * did after this process returned, and a line built from it would be a confident lie the
 * moment the two disagreed.
 */
export interface PostRunTailReport {
  readonly enqueue: PostRunEnqueueOutcome
  readonly drain: PostRunDrainOutcome
  /** Chain jobs this process actually ran to a disposition. */
  readonly jobsRun: number
}

/**
 * Every side effect this tail performs, in one table (the `CurationTailOperations` idiom).
 *
 * It is also the JOBQ-06 induced-failure seam plan 05 uses, and the answer to Pitfall 12: the
 * dynamic `mapVerdictToExitCode` imports stay at the call sites and nothing here closes over
 * one site's module graph.
 */
export interface PostRunTailOperations {
  loadCompletedRunHandoff: CurationTailOperations['loadCompletedRunHandoff']
  resolveKnowledgeRoot: CurationTailOperations['resolveKnowledgeRoot']
  composeHost(input: PostRunTailHostInput): LocalAgentHost
  acquireWriterLease: typeof LOCAL_DAEMON_CAPABILITIES.acquireWriterLease
  releaseLease: typeof LOCAL_DAEMON_CAPABILITIES.releaseLease
  nudgeDaemon: typeof nudgeDaemon
  curateCompletedRun: typeof curateCompletedRun
  runCurationTail: typeof runCurationTail
  createChipEmitter: typeof createPostRunChipEmitter
  /**
   * Durable chip truth, through the ONE read op (D-14).
   *
   * Named on the table so a test can answer it without a store, and shaped as "ask this host's
   * registry" so production has no second way to answer it. The CLI never opens the queue
   * database for status: three surfaces render these five words and a second producer is how
   * the dashboard and the CLI end up saying different true-looking things about one row.
   */
  readPostProcessingStatus(host: LocalAgentHost, runId: string): Promise<PostProcessingStatus>
  /** The one wall clock, read only at tail boundaries. */
  now(): number
}

export interface PostRunTailHostInput {
  readonly agentQaRoot: string
  readonly configPath: string
  readonly curateRun: (input: {
    readonly runId: string
    readonly executionContext: unknown
    readonly deadlineMs?: number
  }) => Promise<{ readonly curated: number; readonly deprecated: number }>
}

/**
 * The post-run chain never authors through the QUEUE's model.
 *
 * `analyze-run` projects verdicts the runner already persisted and `curate-memory` authors
 * through the curation author built from the run's own `modelDeps` — so a project with no
 * usable provider credentials must still get its chain. Resolving the CLI job model eagerly
 * here would have made "no LLM configured" mean "no post-run analysis ever", which is a
 * regression against a tail that has always run model-free.
 */
const POST_RUN_MODEL_UNAVAILABLE: JobModelCapability = {
  modelId: 'unavailable:post-run-tail',
  generate: () => {
    throw new Error(
      'The post-run tail composes no provider: analyze-run projects persisted verdicts and '
      + 'curate-memory authors through the run\'s own curation model.',
    )
  },
}

export function defaultPostRunTailOperations(): PostRunTailOperations {
  const curationDefaults = defaultCurationTailOperations()
  return {
    loadCompletedRunHandoff: curationDefaults.loadCompletedRunHandoff,
    resolveKnowledgeRoot: curationDefaults.resolveKnowledgeRoot,
    composeHost: (input) => composeCliLocalAgent({
      agentQaRoot: input.agentQaRoot,
      configPath: input.configPath,
      model: () => POST_RUN_MODEL_UNAVAILABLE,
      postRun: { curateRun: input.curateRun },
    }),
    acquireWriterLease: LOCAL_DAEMON_CAPABILITIES.acquireWriterLease,
    releaseLease: LOCAL_DAEMON_CAPABILITIES.releaseLease,
    nudgeDaemon,
    curateCompletedRun,
    runCurationTail,
    createChipEmitter: createPostRunChipEmitter,
    readPostProcessingStatus: async (host, runId) => await invokeFunction(
      host.registry,
      RUNS_POST_PROCESSING_FUNCTION_ID,
      { runId },
      CLI_FUNCTION_CALLER,
    ) as PostProcessingStatus,
    now: Date.now,
  }
}

/**
 * The tail's inputs, taken FROM the v51 tail's own option type.
 *
 * `Pick` rather than a restatement: every one of these fields is handed straight through to
 * the per-run fold, and a second declaration of them would be a second place for `auditSink`
 * or `policy` to drift from what the fold actually consumes.
 */
export interface RunPostRunTailOptions extends Pick<
  RunCurationTailOptions,
  | 'runId'
  | 'agentQaRoot'
  | 'knowledgeConfig'
  | 'configDir'
  | 'auditSink'
  | 'maskingContext'
  | 'modelDeps'
  | 'policy'
  | 'signal'
  | 'log'
> {
  /** The resolved project config file; the composition resolves everything else from it. */
  configPath: string
  /** Focused test seam. Production callers omit it. */
  operations?: Partial<PostRunTailOperations>
}

/**
 * The two legs of the tail, handed to the verdict-first wrapper separately.
 *
 * Two callables rather than one call because the wrapper gates them differently and that gate
 * is the D-03 decision itself: `enqueue` runs before the `--detach` short-circuit, `drain`
 * after it. Folding them into one function would have forced the wrapper to learn what detach
 * means for each half, which is precisely the knowledge this file owns.
 */
export interface PostRunTailHandle {
  enqueue(): Promise<void>
  drain(): Promise<void>
  /**
   * The user-facing close-out, run on EVERY leg — including the one `--detach` short-circuits.
   *
   * A third callable rather than a tail of `drain()` for the same reason there are two legs at
   * all: the one posture that most needs a line about queued work is the posture where `drain`
   * is never called. The wrapper is the only thing that knows which gate it applied, so it says
   * so here rather than the tail guessing from a report that would read `not-attempted` for
   * both "detached" and "the enqueue never got that far".
   */
  finish(input?: { readonly detached?: boolean }): Promise<void>
  /** Read after every leg has settled. */
  report(): PostRunTailReport
}

/** How many pump iterations are a bug rather than a chain. Three chain members plus slack. */
const CHAIN_PUMP_BOUND = 16

export function runPostRunTail(opts: RunPostRunTailOptions): PostRunTailHandle {
  /**
   * Resolved on first use, INSIDE a leg's own try (JOBQ-06).
   *
   * Constructing the table reads the shipped modules, and a build where one of those reads
   * throws — a partially-stubbed module graph is the real case that found this — would send
   * the exception straight past `runVerdictFirstCurationTail` into the command's framework
   * catch, turning a passing run into exit 2. Post-processing may cost the analysis; it may
   * never cost the verdict, so the tail does no work at all until a leg is awaited.
   */
  let resolvedOperations: PostRunTailOperations | undefined
  const ops = (): PostRunTailOperations => (resolvedOperations ??= {
    ...defaultPostRunTailOperations(),
    ...opts.operations,
  })

  let enqueueOutcome: PostRunEnqueueOutcome = 'skipped'
  let drainOutcome: PostRunDrainOutcome = 'not-attempted'
  let jobsRun = 0
  let host: LocalAgentHost | undefined
  let knowledgeRoot: string | undefined
  /**
   * The lease the pump holds, read by `curateRun` at CLAIM time rather than at composition
   * time. The host is composed before the lease is acquired — the enqueue must not wait on a
   * lease it does not need (385 D-02) — so a value captured at composition would always be
   * `undefined` and every fold would try to acquire a lease this process already holds.
   */
  let heldAuthority: CurationWriterAuthority | undefined
  /** The one budget's absolute stop point, fixed when the drain leg begins (D-03). */
  let drainDeadlineMs: number | undefined

  const curateRun: PostRunTailHostInput['curateRun'] = async (input) => {
    if (knowledgeRoot === undefined) {
      throw new Error('the post-run tail resolved no knowledge root to curate against')
    }
    const curatedRunDir = completedRunDir(opts.agentQaRoot, input.runId)
    const handoff = ops().loadCompletedRunHandoff(
      completedRunHandoffPath(opts.agentQaRoot, input.runId),
    )
    const deadlineMs = input.deadlineMs ?? drainDeadlineMs
    const folded = await ops().curateCompletedRun({
      runDir: curatedRunDir,
      handoff,
      knowledgeRoot,
      agentQaRoot: opts.agentQaRoot,
      auditSink: opts.auditSink,
      ...(opts.maskingContext === undefined ? {} : { maskingContext: opts.maskingContext }),
      policy: opts.policy,
      ...(opts.modelDeps === undefined ? {} : { modelDeps: opts.modelDeps }),
      ...(heldAuthority === undefined ? {} : { authority: heldAuthority }),
      ...(deadlineMs === undefined ? {} : { deadlineMs }),
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      log: opts.log,
    })
    return { curated: folded.curated, deprecated: folded.deprecated }
  }

  const openHost = (): LocalAgentHost => {
    host ??= ops().composeHost({
      agentQaRoot: opts.agentQaRoot,
      configPath: opts.configPath,
      curateRun,
    })
    return host
  }

  return {
    async enqueue(): Promise<void> {
      try {
        const handoff = ops().loadCompletedRunHandoff(
          completedRunHandoffPath(opts.agentQaRoot, opts.runId),
        )
        knowledgeRoot = ops().resolveKnowledgeRoot(opts.knowledgeConfig, opts.configDir)
        const jobs = await openHost().jobs()
        const outcome = await jobs.queue.enqueue(
          'analyze-run',
          {
            runId: opts.runId,
            // D-20/D-06: the digest is minted ONCE per run and shared with the receipt. A
            // second mint here would be a second answer to "which bytes were analysed".
            handoffDigest: curationTailHandoffDigest(handoff),
            handoffSchemaVersion: handoff.schemaVersion,
            executionContext: handoff.executionContext,
          },
          opts.runId,
        )
        enqueueOutcome = outcome.deduped ? 'deduped' : 'enqueued'
      } catch (error) {
        enqueueOutcome = 'failed'
        opts.log.warn(enqueueFailureWarning(
          opts.runId,
          completedRunHandoffPath(opts.agentQaRoot, opts.runId),
          error,
        ))
      }
    },

    async drain(): Promise<void> {
      if (knowledgeRoot === undefined || host === undefined) {
        // The enqueue leg never got far enough to know where knowledge lives. Draining would
        // mean re-deriving it here and drifting from what the enqueue used.
        drainOutcome = 'not-attempted'
        return
      }
      const root = knowledgeRoot
      let acquiredLeaseId: string | undefined
      try {
        drainDeadlineMs = ops().now() + DRAIN_BUDGET_MS
        const acquired = ops().acquireWriterLease(root)
        if (acquired.kind === 'held') {
          // Pitfall 8: the SHIPPED envelope, verbatim. Its handler already calls both
          // `requestDrain` and `jobDispatcher.wake()`, so reusing it wakes the agent-job
          // pump with zero protocol change — and a nudge that never lands is invisible by
          // design, because the daemon's 5s poll is the backstop (386 D-13).
          void ops().nudgeDaemon(opts.agentQaRoot, { knowledgeRoot: root })
            .catch(() => undefined)
          drainOutcome = 'handed-off'
          return
        }
        if (acquired.kind !== 'acquired') {
          drainOutcome = 'refused'
          return
        }
        acquiredLeaseId = acquired.leaseId
        heldAuthority = { leaseId: acquired.leaseId, epoch: acquired.epoch }
        /**
         * The ONLY construction site (D-13).
         *
         * Inside the acquired-lease branch, after the hand-off and refusal legs have already
         * returned, because this is the one branch that observes `runNextJob` outcomes at all.
         * A detached run never reaches `drain`; a handed-off run returned above; a refused
         * lease returned above. So "the daemon emits nothing" is not a rule this file checks —
         * it is a consequence of where this line sits.
         */
        const chips = ops().createChipEmitter({
          agentQaRoot: opts.agentQaRoot,
          runId: opts.runId,
          now: () => ops().now(),
        })
        const jobs = await host.jobs()
        // Pitfall 7, the daemon's sequence verbatim (host.ts:1759): adopt the epoch the lease
        // just minted, then reclaim rows a dead holder left claimed. Both are safe here for
        // the same reason they are safe there — exactly one fence-holder exists at a time.
        const fence = await jobs.store.adoptEpoch(acquired.epoch)
        await jobs.queue.recoverAbandonedClaims({ fence })
        drainOutcome = 'drained'
        for (let pumped = 0; pumped < CHAIN_PUMP_BOUND; pumped += 1) {
          if (ops().now() >= drainDeadlineMs) {
            drainOutcome = 'budget-exhausted'
            break
          }
          if (opts.signal?.aborted === true) break
          const outcome = await jobs.queue.runNextJob({ fence })
          if (!outcome.ran) break
          // Emitted from the outcome the pump just RECEIVED, before anything is decided about
          // it: the chip says what the queue durably did, not what this loop does next.
          chips.observe(outcome)
          jobsRun += 1
          if (outcome.disposition === 'retry-scheduled') {
            // Never sleep the run process on a backoff. The row stays queued and whoever
            // holds the lease next — the daemon, or the next run's tail — picks it up.
            drainOutcome = 'retry-scheduled'
            break
          }
        }
        // The prior-run janitor, under the REMAINder of the same budget and the same lease
        // (Pitfall 11). This run's own directory is already receipted by the fold the chain
        // just ran, so the sweep skips it rather than folding it twice.
        await ops().runCurationTail({
          runId: opts.runId,
          agentQaRoot: opts.agentQaRoot,
          knowledgeConfig: opts.knowledgeConfig,
          configDir: opts.configDir,
          auditSink: opts.auditSink,
          ...(opts.maskingContext === undefined ? {} : { maskingContext: opts.maskingContext }),
          ...(opts.modelDeps === undefined ? {} : { modelDeps: opts.modelDeps }),
          policy: opts.policy,
          ...(opts.signal === undefined ? {} : { signal: opts.signal }),
          log: opts.log,
          authority: heldAuthority,
          deadlineMs: drainDeadlineMs,
        })
      } catch (error) {
        opts.log.warn(drainFailureWarning(opts.runId, error))
      } finally {
        heldAuthority = undefined
        if (acquiredLeaseId !== undefined) {
          try {
            ops().releaseLease({ knowledgeRoot: root, leaseId: acquiredLeaseId })
          } catch {
            // A lease this process cannot release expires on its own TTL; failing the tail
            // over it would spend the verdict-first guarantee on cleanup.
          }
        }
        try {
          await host.close()
        } catch {
          // Same posture: a store handle that will not close is the process's problem, and
          // the process is about to exit.
        }
      }
    },

    async finish(input: { readonly detached?: boolean } = {}): Promise<void> {
      if (input.detached === true && drainOutcome === 'not-attempted') {
        // The one place `detached` is ever produced. `drain()` was never called, so nothing
        // else in this file could have said so — and a report that called the detach posture
        // `not-attempted` would be indistinguishable from an enqueue that failed first.
        drainOutcome = 'detached'
      }
      try {
        // Nothing was composed ⇒ the enqueue never got as far as a host, which means nothing
        // is queued and the D-07 warning has already said everything true about this run.
        if (host === undefined || enqueueOutcome === 'failed') return
        const status = await ops().readPostProcessingStatus(host, opts.runId)
        if (status.notification !== undefined && drainOutcome === 'drained') {
          // D-09: this process ran the chain to its terminal, so the human line is the honest
          // close-out — it reports what HAPPENED, where the summary reports what is pending.
          opts.log.info?.(renderChainTerminalLine(status.notification))
          return
        }
        // D-08: work stays queued. The statuses are durable; the parenthetical is posture.
        opts.log.info?.(
          renderPostProcessingSummaryLine(status, drainOutcome === 'handed-off'),
        )
      } catch (error) {
        opts.log.warn(summaryFailureWarning(opts.runId, error))
      } finally {
        try {
          // Idempotent, and the detach leg's only close: `enqueue` opens the store and the
          // drain that would have closed it never ran.
          await host?.close()
        } catch {
          // The process is about to exit; a handle that will not close is not worth the
          // verdict-first guarantee.
        }
      }
    },

    report(): PostRunTailReport {
      return { enqueue: enqueueOutcome, drain: drainOutcome, jobsRun }
    },
  }
}

/** The chip words joined by the separator D-08 pinned, in chain order. */
const SUMMARY_SEPARATOR = ' · '

/**
 * The D-08 exit summary — ONE line, in the ONE chip vocabulary (D-14).
 *
 * Two rules, and the second is the whole reason this takes two arguments:
 *
 *   - Every status word comes from `runs.postprocessing`, verbatim. Not a synonym, not a
 *     control-flow word from `PostRunTailReport`, not "queued" where the vocabulary says
 *     `pending`. A surface that re-spells one of five words is a surface that will eventually
 *     disagree with the dashboard about a row neither of them got wrong.
 *   - "(daemon will drain)" is NOT in the DTO and cannot be. `pending` honestly means "no work
 *     has happened", and durable state has no way to know whether a daemon is about to change
 *     that or whether nobody ever will. That fact lives in THIS process's posture — it handed
 *     the chain off and nudged — so it is rendered from `handedOff` and never derived from a
 *     status, in either direction.
 *
 * The parenthetical attaches per STAGE rather than per line: whichever stages are still
 * `pending` are the ones the daemon will drain, and a stage that already finished must not be
 * annotated with a future.
 */
export function renderPostProcessingSummaryLine(
  status: PostProcessingStatus,
  handedOff: boolean,
): string {
  const stage = (label: string, chip: string): string => {
    const suffix = handedOff && chip === 'pending' ? ' (daemon will drain)' : ''
    return `${label}: ${chip}${suffix}`
  }
  return `post-processing — ${[
    stage('analysis', status.chips.analysis),
    stage('curation', status.chips.curation),
    stage('issues', status.chips.issues),
  ].join(SUMMARY_SEPARATOR)}`
}

/**
 * The D-09 human line, rendered from the chain-terminal row and nothing else.
 *
 * Fires on ANY terminal — done or failed (D-12) — because a failure is exactly when the user
 * most needs to be told. Counts come from the row rather than from the drain that produced it:
 * the row is what 392's chat and M5's dashboard will render, and a CLI line built from a
 * live-process value would be a second, quieter answer to the same question.
 *
 * Absent curation counts print as no counts at all (D-11): a stage that never committed a
 * bundle reports its status, and a `0 curated` would say it curated nothing, which is a
 * different claim from never having got that far.
 */
export function renderChainTerminalLine(notification: RunNotification): string {
  const { verdictSummary, stages } = notification
  const classes = Object.entries(verdictSummary.byClass)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([className, count]) => `${className} ${count}`)
  const verdicts = `verdicts ${verdictSummary.total}`
    + (classes.length === 0 ? '' : ` (${classes.join(', ')})`)
  const counts = [
    ...(stages.curation.curated === undefined ? [] : [`${stages.curation.curated} curated`]),
    ...(stages.curation.deprecated === undefined
      ? []
      : [`${stages.curation.deprecated} deprecated`]),
  ]
  return `post-processing ${notification.outcome} for ${notification.runId} — ${[
    verdicts,
    `analysis: ${stages.analysis.status}`,
    `curation: ${stages.curation.status}`
      + (counts.length === 0 ? '' : ` (${counts.join(', ')})`),
    `issues: ${stages.issues.status}`,
  ].join(SUMMARY_SEPARATOR)}`
}

/**
 * The D-07 warning, final wording. ONE line, and every clause in it is load-bearing.
 *
 * It names the RUN so the loss is attributable; it says the verdict and exit code are
 * unaffected so nobody reads a post-processing warning as a test result (JOBQ-06 in the one
 * place a user actually meets it); and it names the handoff's PATH, because "the handoff
 * remains on disk" is only actionable if the reader is told where on disk. The handoff is the
 * whole input the analysis needs, so that path IS the manual re-queue path — there is no
 * retry file and no reconciliation sweep in this build (D-07), by decision.
 */
function enqueueFailureWarning(runId: string, handoffPath: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `Post-run analysis was not queued for ${runId} (${detail}); the verdict and exit code `
    + `are unaffected. The run handoff is still on disk at ${handoffPath}, so the analysis can `
    + 'be queued again from there.'
}

/**
 * A status read that fails costs the CLOSE-OUT LINE and nothing else.
 *
 * Warned rather than swallowed, because a line that silently disappears is how a user learns
 * to distrust the ones that do print; and warned rather than thrown, because the exit code was
 * frozen long before this file ran (JOBQ-06).
 */
function summaryFailureWarning(runId: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `Post-run status for ${runId} could not be read (${detail}); the queued work is `
    + 'unaffected and is readable later through the runs post-processing status.'
}

function drainFailureWarning(runId: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `Post-run processing stopped early for ${runId} (${detail}); queued work will resume `
    + 'on the next run or when the daemon drains it.'
}
