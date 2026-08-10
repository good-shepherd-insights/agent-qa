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

import {
  chainJobIdsForRun,
  invokeFunction,
  renderAnalysisClusterBlock,
  RUNS_DIGEST_FUNCTION_ID,
  RUNS_POST_PROCESSING_FUNCTION_ID,
} from '@vostride/agent-qa-agent'
import type { JobModelCapability } from '@vostride/agent-qa-agent'
import { DRAIN_BUDGET_MS, LOCAL_DAEMON_CAPABILITIES } from '@vostride/agent-qa-agent-local'
import type { LocalAgentHost } from '@vostride/agent-qa-agent-local'
import { AnalyzeRunPayloadSchema } from '@vostride/agent-qa-schema'
import type {
  PostProcessingChips,
  PostProcessingStatus,
  RunDigest,
  RunNotification,
} from '@vostride/agent-qa-schema'

// 391-06: the clustered block layout moved to the ONE package that has two callers for it — the
// tail's print and `runs.digest`'s first section. Re-exported from where it used to live so the
// CLI's own suite still names it here, and so nothing in this package composes a second layout.
export { renderAnalysisClusterBlock }

import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../composition/local-agent-host.js'
import { nudgeDaemon } from '../daemon/client.js'
import { resolveCliJobModel } from '../llm-utils.js'
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
  /**
   * The pump spent its bound or its budget entirely on OTHER runs' work and never claimed any
   * member of this run's chain.
   *
   * Distinct from `budget-exhausted`, which says this run's own chain was mid-flight when the
   * clock ran out. The queue is a global FIFO, so a backlog of detached runs can consume the
   * whole budget before this run's `analyze-run` is reachable — and a report that called that
   * `drained` would tell a user their analysis is `pending` with no indication that anything
   * will ever pick it up (WR-01).
   */
  | 'backlog-exhausted'
  | 'retry-scheduled'
  | 'refused'
  /**
   * The drain raised and was caught by the tail's own catch (WR-10).
   *
   * A member rather than leaving the optimistic `'drained'` in place: the pre-loop assignment
   * is what a throw escapes past, so the report used to say `{drain: 'drained', jobsRun: 0}` —
   * byte-identical to the honest emptied-queue case, and there is no way for a reader to tell
   * a queue that had nothing to do from one that blew up on its first job.
   *
   * NOT a `ChainPumpExit`: that type enumerates how the loop ENDS, and a throw does not end
   * the loop, it leaves it. The two are deliberately separate domains.
   */
  | 'threw'

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
  /**
   * One run's DIGEST, through the ONE producer (`runs.digest`, 391 D-16/D-17).
   *
   * Same discipline as the status read above, and it replaced the 389 analysis read for a
   * reason that is D-17 rather than taste: the digest's first section IS the clustered verdict
   * block this tail used to print, and its other sections are the chain, the decisions waiting
   * on a human and the counts. Printing both would have been the same run's story told twice.
   *
   * Shaped as "ask this host's registry" so the tail can never compose a line of its own — the
   * bytes it prints are the op result's bytes, which are the barrel renderer's bytes, which are
   * what the `agent-qa digest` verb, M5's run page and 392's chat all serve.
   */
  readRunDigest(host: LocalAgentHost, runId: string): Promise<RunDigest>
  /** The one wall clock, read only at tail boundaries. */
  now(): number
}

export interface PostRunTailHostInput {
  readonly agentQaRoot: string
  readonly configPath: string
  /**
   * The run masker this tail was handed, if any — carried so `composeHost` can DERIVE the
   * posture from what the tail HAS rather than assert one it intends (388-10, UF-388-01).
   */
  readonly maskingContext?: RunCurationTailOptions['maskingContext']
  readonly curateRun: (input: {
    readonly runId: string
    readonly executionContext: unknown
    readonly deadlineMs?: number
  }) => Promise<{
    readonly curated: number
    readonly deprecated: number
    /** The fold's own completeness, carried rather than dropped (WR-03). */
    readonly complete: boolean
  }>
}

/**
 * The queue's model, resolved for real since 389-06 — the author swap (389-04) made
 * `analyze-run` author its unknown-verdict members through the QUEUE's model, so the 388-era
 * "never authors" stub would abort the very chain this tail drains.
 *
 * What survives from 388 is the DEGRADATION, moved from resolution time to generate time: a
 * project with no usable provider credentials must still get its chain (enqueue, the
 * deterministic floor, curation through the run's own author), so a failed model resolution
 * composes a capability that reports the failure only if the author actually reaches it —
 * "no LLM configured" still never means "no post-run chain", it means the honest
 * transport-throw path for the one job that genuinely needed a model.
 */
function resolvePostRunJobModel(configPath: string): Promise<JobModelCapability> {
  return resolveCliJobModel(configPath).catch((error: unknown) => ({
    modelId: 'unavailable:post-run-tail',
    generate: (): Promise<never> => {
      throw new Error(
        'The post-run tail could not resolve the configured job model: '
        + (error instanceof Error ? error.message : String(error)),
      )
    },
  }))
}

export function defaultPostRunTailOperations(): PostRunTailOperations {
  const curationDefaults = defaultCurationTailOperations()
  return {
    loadCompletedRunHandoff: curationDefaults.loadCompletedRunHandoff,
    resolveKnowledgeRoot: curationDefaults.resolveKnowledgeRoot,
    composeHost: (input) => composeCliLocalAgent({
      agentQaRoot: input.agentQaRoot,
      configPath: input.configPath,
      model: () => resolvePostRunJobModel(input.configPath),
      postRun: {
        curateRun: input.curateRun,
        // Derived from presence, never hard-coded (388-10): the tail declares what it HAS,
        // not what it intends. Both production sites in `run.ts` pass a masking context
        // unconditionally, so production behaviour is unchanged — and a harness that
        // composes the tail without one gets the claim deferral rather than a silent
        // unmasked emission. The LIMIT of the derivation: what is derived here is that A
        // masker is active, not that it is the folded run's. `curateRun` below folds the
        // JOB PAYLOAD's runId while passing `opts.maskingContext`, which is THIS run's
        // masker, and the pump runs whatever `runNextJob` returns, own row or foreign — so
        // a foreign run's row folded here is masked by the wrong masker. Pre-existing and
        // unscoped (T-388-30); this comment must not imply otherwise.
        candidateProse: input.maskingContext === undefined ? 'no-masker' : 'masker-active',
      },
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
    readRunDigest: async (host, runId) => await invokeFunction(
      host.registry,
      RUNS_DIGEST_FUNCTION_ID,
      { runId },
      CLI_FUNCTION_CALLER,
    ) as RunDigest,
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

/**
 * Every way the chain pump's loop can end NORMALLY. One spelling, one place to be read: the
 * loop variable ranges over it, and `PUMP_EXIT_STARVES_OWN_CHAIN` must classify every member.
 *
 * The qualifier is load-bearing and was missing (WR-10): a throw does not END this loop, it
 * LEAVES it, skipping the starvation classification below and landing in the drain's catch.
 * That path is outside this domain by construction, and it is reported by the separate
 * `PostRunDrainOutcome` member `'threw'` — not by a sixth exit here, which would imply the
 * classification runs on a path where it never does.
 */
type ChainPumpExit = 'bound' | 'budget' | 'empty' | 'aborted' | 'retry'

/**
 * Per exit: does reaching it WITHOUT having observed this run's own chain mean the chain was
 * starved (WR-01 / T-388-18b)?
 *
 * A `Record` over the named exit type rather than another condition, deliberately: a sixth
 * exit added to the pump fails to compile here until it is classified — the property the
 * shipped two-member disjunction lacked, which is how the `retry` exit fell through to a
 * bare `pending` for starved work.
 */
const PUMP_EXIT_STARVES_OWN_CHAIN: Record<ChainPumpExit, boolean> = {
  // The bound was spent entirely on other runs' rows before this run's chain was reachable.
  bound: true,
  // The budget was spent the same way: the clock ran out on foreign work.
  budget: true,
  // The same story with a different trigger: a foreign row's backoff broke the pump before
  // this run's chain was reachable — and 388-08's completeness gate made exactly that row
  // common, because `markRetryable` clears `claimed_at` without setting `status` and there
  // is no not-before column, so a retryable `curate-memory` stays the oldest claimable row.
  retry: true,
  // An emptied queue is not starvation: the rows are gone because somebody ran them.
  empty: false,
  // An abort is not starvation: the user stopped this process.
  aborted: false,
}

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
  /**
   * Did THIS process's pump run this run's `analyze-run` to `completed`? (389 D-12.)
   *
   * The sentence-block trigger, and deliberately NOT derived from `drainOutcome` or from a
   * chip status (the house rule above `renderPostProcessingSummaryLine`): a drain whose
   * budget ran out on `curate-memory` still completed analyze-run under the one budget, and
   * a drain that emptied an already-drained queue did not — only the pump's own observation
   * can tell those apart honestly.
   */
  let analyzeRunCompleted = false
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
    // WR-03: the fold already told us whether it wrote a receipt. Dropping `complete` here is
    // what let `incompleteWarning` print "curation incomplete; it will resume" while the
    // durable notification row recorded the same stage as `done`.
    return { curated: folded.curated, deprecated: folded.deprecated, complete: folded.complete }
  }

  const openHost = (): LocalAgentHost => {
    host ??= ops().composeHost({
      agentQaRoot: opts.agentQaRoot,
      configPath: opts.configPath,
      // The same conditional spread the fold is threaded with: composeHost derives the
      // posture from this value's PRESENCE, so the tail never asserts a masker it lacks.
      ...(opts.maskingContext === undefined ? {} : { maskingContext: opts.maskingContext }),
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
        // WTST-06 / 393 D-20: the analyze-run payload is MINTED here, schema-validated, and the
        // two run markers are COPIED onto it from the loaded handoff.
        //
        // Copied, never re-derived and never re-digested. `gateRun` and `excludedFromOutcomes`
        // already live inside the handoff whose bytes `handoffDigest` pins, so these fields add
        // no integrity guarantee whatsoever — what they add is the ability to see what a QUEUED
        // job is without loading the handoff it points at, which is WTST-06's ratified sentence
        // taken literally. Anyone who needs the authoritative answer reads the handoff.
        //
        // The conditional spread is the `runs-start.ts:67` idiom, and it is load-bearing twice
        // over: the carriers are `?: true`, so an unconditional copy would write `undefined`
        // into the payload for every ordinary run, and `AnalyzeRunPayloadSchema` refuses a
        // literal `false` — a producer may not half-express a marker. The two flags are DISTINCT
        // axes (C8): a gate run still feeds curation, so each is copied on its own condition.
        const payload = AnalyzeRunPayloadSchema.parse({
          runId: opts.runId,
          // D-20/D-06: the digest is minted ONCE per run and shared with the receipt. A
          // second mint here would be a second answer to "which bytes were analysed".
          handoffDigest: curationTailHandoffDigest(handoff),
          handoffSchemaVersion: handoff.schemaVersion,
          executionContext: handoff.executionContext,
          ...(handoff.gateRun === undefined ? {} : { gateRun: handoff.gateRun }),
          ...(handoff.excludedFromOutcomes === undefined
            ? {}
            : { excludedFromOutcomes: handoff.excludedFromOutcomes }),
        })
        const outcome = await jobs.queue.enqueue('analyze-run', payload, opts.runId)
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
        const jobs = await host.jobs()
        /**
         * This run's chain ids, derived ONCE per drain, from the queue's OWN id source.
         *
         * The same `chainJobIdsForRun` the read op derives from (`runs-post-processing.ts`), and
         * the same `idSource` the enqueue above minted with — so the push half of this run's chip
         * trail and the pull half of its status cannot address different rows. The array is a
         * local because two readers need exactly this value: the emitter's drop-guard and the
         * pump's own-chain tracker. Re-deriving for the second reader would be a second answer to
         * a question with one.
         */
        const chainIds = chainJobIdsForRun(opts.runId, jobs.idSource)
        const ownChainJobIds = [
          String(chainIds.analyzeRun),
          String(chainIds.curateMemory),
          String(chainIds.triageIssues),
        ]
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
          chainJobIds: ownChainJobIds,
          // The run's own masker, spread on the same conditional idiom the fold is threaded
          // with above: the chip's error text crosses the same disclosure boundary the fold's
          // does, and it may not be the one output that skipped the masker (WR-08).
          ...(opts.maskingContext === undefined ? {} : { maskingContext: opts.maskingContext }),
          now: () => ops().now(),
        })
        // Pitfall 7, the daemon's sequence verbatim (host.ts:1759): adopt the epoch the lease
        // just minted, then reclaim rows a dead holder left claimed. Both are safe here for
        // the same reason they are safe there — exactly one fence-holder exists at a time.
        const fence = await jobs.store.adoptEpoch(acquired.epoch)
        await jobs.queue.recoverAbandonedClaims({ fence })
        drainOutcome = 'drained'
        /**
         * Did the pump ever reach a member of THIS run's chain?
         *
         * Read from the same `ownChainJobIds` the emitter's drop-guard reads — one derivation per
         * drain, two readers. A second spelling here would be a second answer to "is this our
         * work", and the posture the user is told would be free to disagree with the trail.
         */
        let ownChainObserved = false
        /**
         * How the pump left the loop. Whether an exit means this run's chain was starved is
         * declared once, per member, in `PUMP_EXIT_STARVES_OWN_CHAIN` — this doc's job is to
         * point there, not to re-enumerate a subset of the domain.
         */
        let pumpExit: ChainPumpExit = 'bound'
        for (let pumped = 0; pumped < CHAIN_PUMP_BOUND; pumped += 1) {
          if (ops().now() >= drainDeadlineMs) {
            drainOutcome = 'budget-exhausted'
            pumpExit = 'budget'
            break
          }
          if (opts.signal?.aborted === true) {
            pumpExit = 'aborted'
            break
          }
          const outcome = await jobs.queue.runNextJob({ fence })
          if (!outcome.ran) {
            pumpExit = 'empty'
            break
          }
          // Emitted from the outcome the pump just RECEIVED, before anything is decided about
          // it: the chip says what the queue durably did, not what this loop does next.
          chips.observe(outcome)
          if (ownChainJobIds.includes(String(outcome.job.id))) ownChainObserved = true
          if (
            String(outcome.job.id) === String(chainIds.analyzeRun)
            && outcome.disposition === 'completed'
          ) {
            // The D-12 trigger, recorded at the one place it is observable: a failed or
            // retry-scheduled analyze-run is NOT a completed one, and no later leg may
            // infer completion from a status word this process did not witness.
            analyzeRunCompleted = true
          }
          jobsRun += 1
          if (outcome.disposition === 'retry-scheduled') {
            // Never sleep the run process on a backoff. The row stays queued and whoever
            // holds the lease next — the daemon, or the next run's tail — picks it up.
            drainOutcome = 'retry-scheduled'
            pumpExit = 'retry'
            break
          }
        }
        // WR-01 / T-388-18b: the pump ended without ever reaching this run's chain, on an exit
        // the table classifies as starvation. The user is owed the reason their work is still
        // pending, not just the fact. No condition on `drainOutcome` here, deliberately: every
        // exit the table marks as starvation is reachable only inside the pump, where the drain
        // outcome is necessarily one of the three values the pump itself sets — the handed-off,
        // refused, detached and not-attempted postures all return before the loop is entered —
        // and widening a hand-written subset would reintroduce the same defect one line down.
        if (!ownChainObserved && PUMP_EXIT_STARVES_OWN_CHAIN[pumpExit]) {
          drainOutcome = 'backlog-exhausted'
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
        // The report may not keep the optimistic `'drained'` set before the pump (WR-10).
        // Assigned here rather than cleared in `finally`, because `finally` also runs on the
        // paths that legitimately drained.
        drainOutcome = 'threw'
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
      /**
       * ONE digest read per tail, whichever arm consumes it (391 D-17).
       *
       * Read lazily and memoised, because exactly one of the two arms below needs it and both
       * need it at most once: the block prints its lines, the exit line points at it and
       * carries its pending count. Two reads would be two projections of one run — cheap,
       * durable and still two answers to a question with one.
       *
       * A failed read costs the digest and nothing else. The warning names the SAME fetch
       * command the exit line would have carried, so the reader's next step is identical
       * whichever way the digest failed to arrive (JOBQ-06: the exit code froze long ago).
       */
      let digestRead: { value: RunDigest | undefined } | undefined
      const readDigest = async (openedHost: LocalAgentHost): Promise<RunDigest | undefined> => {
        if (digestRead === undefined) {
          try {
            digestRead = { value: await ops().readRunDigest(openedHost, opts.runId) }
          } catch (error) {
            opts.log.warn(digestReadFailureWarning(opts.runId, error))
            digestRead = { value: undefined }
          }
        }
        return digestRead.value
      }
      /**
       * The D-17 digest block, printed AFTER whichever exit line rendered — and only when this
       * process's own pump completed analyze-run (never a wait, never a poll: the chain either
       * finished under the one budget or the exit line carries the fetch command instead).
       *
       * It REPLACED the 389 sentence block rather than joining it. The digest's first section
       * is that same clustered block, rendered by the same relocated function from the same op
       * result, so printing both would have told one run's story twice — which is exactly the
       * "nothing printed twice" half of D-17.
       */
      const printDigestBlock = async (openedHost: LocalAgentHost): Promise<void> => {
        if (!analyzeRunCompleted) return
        const digest = await readDigest(openedHost)
        if (digest === undefined || digest.lines.length === 0) return
        opts.log.info?.(digest.lines.join('\n'))
      }
      try {
        // Nothing was composed ⇒ the enqueue never got as far as a host, which means nothing
        // is queued and the D-07 warning has already said everything true about this run.
        if (host === undefined || enqueueOutcome === 'failed') return
        const status = await ops().readPostProcessingStatus(host, opts.runId)
        if (status.notification !== undefined && drainOutcome === 'drained') {
          // D-09: this process ran the chain to its terminal, so the human line is the honest
          // close-out — it reports what HAPPENED, where the summary reports what is pending.
          // Rendered from the row and NOTHING else, so the fetch command never grafts onto
          // it; the digest itself follows when this process authored the analysis.
          opts.log.info?.(renderChainTerminalLine(status.notification))
          await printDigestBlock(host)
          return
        }
        // D-08: work stays queued. The statuses are durable; the parenthetical is posture —
        // and so is the D-17 suffix: when THIS process did not complete analyze-run, the line
        // gains the pending-proposal count and the exact fetch command (the whole digest is
        // one copy-paste away); when it did, the digest prints one line down and a pointer
        // would be noise. EITHER/OR, one story.
        opts.log.info?.(
          renderPostProcessingSummaryLine(status, postureOf(drainOutcome))
          + (analyzeRunCompleted
            ? ''
            : renderDigestPointer(opts.runId, await readDigest(host))),
        )
        await printDigestBlock(host)
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
 * What THIS process knows about a pending stage's future — the only thing durable state cannot
 * say for itself.
 *
 * `none` is the honest answer for `--detach`, a refusal and a drain that simply ended: nobody in
 * this process promised anything, so nothing is promised on their behalf.
 */
export type PostRunPendingPosture = 'handed-off' | 'backlog-exhausted' | 'none'

/**
 * Which hosts may drain a stage's kind — read off 388-10's posture contract rather than
 * restated as a condition.
 *
 * `curate-memory` is unclaimable by a host that folds with no masker active
 * (`UNCLAIMABLE_BY_PROSE_POSTURE`), and the production daemon declares exactly that posture,
 * so no daemon will ever drain curation. The parenthetical used to be chosen by POSTURE
 * alone and pasted onto every pending stage, which is how a handed-off leg came to promise a
 * daemon drain for the one kind a daemon may not claim (WR-09).
 */
type StageDrainer = 'any-host' | 'masked-leg-only'

/**
 * A `Record` over the chip set rather than a condition on the curation stage: the chips are
 * closed and ratified, so a fourth stage must classify its drainer HERE instead of inheriting
 * a promise from a fall-through — the same defect class this phase already named twice.
 */
const STAGE_DRAINER: Record<keyof PostProcessingChips, StageDrainer> = {
  analysis: 'any-host',
  curation: 'masked-leg-only',
  issues: 'any-host',
}

/**
 * What the parenthetical says, per drainer and posture. `none` says nothing, deliberately.
 *
 * The `masked-leg-only` column names a later LOCAL run rather than a daemon because that is
 * the only host that can claim the kind — and it says "local run" rather than promising a
 * time, because a daemon holding the writer lease for its whole lifetime is exactly what a
 * masked leg has to wait out.
 */
const PENDING_POSTURE_SUFFIX: Record<StageDrainer, Record<PostRunPendingPosture, string>> = {
  'any-host': {
    'handed-off': ' (daemon will drain)',
    'backlog-exhausted': ' (queued behind other runs; the daemon or a later run will drain)',
    none: '',
  },
  'masked-leg-only': {
    'handed-off': ' (deferred to a later local run)',
    'backlog-exhausted': ' (queued behind other runs; a later local run will drain)',
    none: '',
  },
}

/**
 * Total over the drain-outcome union, deliberately: a new outcome must choose its posture HERE
 * rather than inherit one from a fall-through — which is precisely how G-388-3 shipped.
 */
const DRAIN_OUTCOME_POSTURE: Record<PostRunDrainOutcome, PostRunPendingPosture> = {
  'not-attempted': 'none',
  detached: 'none',
  'handed-off': 'handed-off',
  drained: 'none',
  'budget-exhausted': 'none',
  'backlog-exhausted': 'backlog-exhausted',
  'retry-scheduled': 'none',
  refused: 'none',
  // Nobody promised anything: the drain blew up. Whatever is still `pending` is pending for a
  // reason the warning already named, one line above the status.
  threw: 'none',
}

function postureOf(outcome: PostRunDrainOutcome): PostRunPendingPosture {
  return DRAIN_OUTCOME_POSTURE[outcome]
}

/**
 * The D-08 exit summary — ONE line, in the ONE chip vocabulary (D-14).
 *
 * Two rules, and the second is the whole reason this takes two arguments:
 *
 *   - Every status word comes from `runs.postprocessing`, verbatim. Not a synonym, not a
 *     control-flow word from `PostRunTailReport`, not "queued" where the vocabulary says
 *     `pending`. A surface that re-spells one of five words is a surface that will eventually
 *     disagree with the dashboard about a row neither of them got wrong.
 *   - The parenthetical is NOT in the DTO and cannot be. `pending` honestly means "no work has
 *     happened", and durable state has no way to know whether a daemon is about to change that,
 *     whether a backlog is in the way, or whether nobody ever will. That fact lives in THIS
 *     process's POSTURE — it handed the chain off and nudged, or it spent its whole budget on
 *     other runs' jobs — so it is rendered from `posture` and never derived from a status, in
 *     either direction.
 *
 * The parenthetical attaches per STAGE rather than per line: whichever stages are still
 * `pending` are the ones somebody will drain, and a stage that already finished must not be
 * annotated with a future.
 */
export function renderPostProcessingSummaryLine(
  status: PostProcessingStatus,
  posture: PostRunPendingPosture,
): string {
  const stage = (label: keyof PostProcessingChips, chip: string): string => {
    const suffix = chip === 'pending' ? PENDING_POSTURE_SUFFIX[STAGE_DRAINER[label]][posture] : ''
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
 * The exact fetch command the extended exit line carries (391 D-17).
 *
 * The REAL `agent-qa digest` invocation, byte-for-byte — a positional runId is the shape
 * `commands/digest.ts` parses, and the id rides `JSON.stringify` so one needing quoting cannot
 * silently produce a command that fails on paste. It points at the VERB rather than at
 * `agent-qa fn runs.digest`, because the verb is what a person was given to type; the two reach
 * the same op, and offering the lower-level one here would be an invitation to learn the
 * function layer in order to read a run.
 *
 * It replaced the 389 `analysis.get` pointer rather than joining it. The digest CONTAINS the
 * clustered sentences that pointer fetched, so keeping both would have offered a strictly
 * narrower second command for the same content — two stories about one run, which is the
 * thing D-17's either/or exists to prevent.
 */
export function digestFetchCommand(runId: string): string {
  return `agent-qa digest ${JSON.stringify(runId)}`
}

/**
 * The exit line's D-17 suffix: what is waiting on a human, and the one command that shows it.
 *
 * The COUNT is dropped when the digest could not be read, and the pointer is not. Printing a
 * fabricated `0 pending` would be the one wrong answer that makes a person stop checking their
 * inbox; printing the command regardless is honest, because it is exactly what they should run
 * to find out. The failure itself was already warned about one line up.
 */
export function renderDigestPointer(runId: string, digest: RunDigest | undefined): string {
  const pending = digest === undefined
    ? ''
    : `proposals: ${digest.pendingProposalCount} pending${SUMMARY_SEPARATOR}`
  return `${SUMMARY_SEPARATOR}${pending}digest: ${digestFetchCommand(runId)}`
}

/**
 * A failed digest read costs the DIGEST and nothing else.
 *
 * Same posture as `summaryFailureWarning`: warned so the block's absence is attributable,
 * never thrown (the exit code froze long ago — JOBQ-06), and the warning carries the same
 * fetch command the extended exit line would have, so the reader's next step is identical
 * whichever way the digest failed to print.
 */
function digestReadFailureWarning(runId: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `The digest for ${runId} could not be read for printing (${detail}); it remains `
    + `readable via ${digestFetchCommand(runId)}.`
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
