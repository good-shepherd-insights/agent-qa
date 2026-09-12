// The post-run chain's derived facts (Phase 388, RESEARCH Pattern 2).
//
// Everything the chain needs to know about itself is COMPUTED from `runId`, and that is the
// mechanism the whole phase rests on rather than a convenience. Job ids are derived from
// `(kind, idempotencyKey)` through an injected source, and successor keys are derived from
// the predecessor's id — so given a run id alone, any process can name every job the chain
// would have enqueued without reading a row, without a chains table, and without parent
// pointers. The chip projection addresses exactly these ids; the chain-terminal check asks
// which of them exist and whether each is terminal.
//
// The alternative — recording chain membership as state — would need a second durable fact
// to be kept in step with the first, and the first thing a stale chain table does is report
// a chain complete because it never heard about the job that is still running.
//
// The derivation is stated ONCE, here, and imported by everything that needs it. Two copies
// of a hash input differing by a space are two different chains that look identical in
// review.

import type { JobId, JobKind, RunNotification, Verdict } from '@vostride/agent-qa-schema'
import { CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION } from '@vostride/agent-qa-schema'

import type { JobIdSource } from './engine.js'

/**
 * The kinds whose finish can BE the chain's terminal in this build.
 *
 * Every kind the chain derives an id for is a member, so this list IS the kind set
 * `chainJobIdsForRun` below asks the id source for — there is no declared-but-empty slot left
 * to ask about. `__tests__/chain-identity.test.ts` pins the two against each other by name, so
 * a chain that grows an id without extending this list, or extends this list without deriving
 * the id, reds there rather than reporting a terminal one job early.
 *
 * Membership does NOT mean "usually terminates the chain". `curate-memory` is a member because
 * its permanent failure halts the chain and its own finish is then the last thing that happens
 * to the run; on the ordinary path it chains onward and `chainTerminalFor` declines it on the
 * successors it produced. A kind is listed here when its finish CAN be the last one.
 *
 * 2026-09-01 (Phase 409): the third chain id left with the Issue-slot cleanup.
 * 2026-09-11 (Phase 422, D-13): a third stage returns — `propose-improvements`, a kind declared
 * since 385, reached by a new successor edge from `curate-memory`. The vocabulary of job kinds
 * is untouched at five; what grew is the topology and the id set that addresses it.
 */
export const POST_RUN_CHAIN_TERMINAL_KINDS: readonly JobKind[] = Object.freeze([
  'analyze-run',
  'curate-memory',
  'propose-improvements',
])

// 2026-09-12, 422-22 (RED skeleton): the key set, landed at the 409 width so the cells in
// `__tests__/422-chain-closed-sets.test.ts` fail on their named assertions rather than on a
// module-load error, which the #3770 gate classifies as INVALID_RED.
export const CHAIN_JOB_ID_KEYS = [
  'analyzeRun',
  'curateMemory',
] as const satisfies readonly (keyof ChainJobIds)[]

/** The three job ids one run's chain addresses, whether or not any of them exists. */
export interface ChainJobIds {
  readonly analyzeRun: JobId
  readonly curateMemory: JobId
  readonly proposeImprovements: JobId
}

/**
 * Every id the chain for `runId` would carry, from `runId` and the id source alone.
 *
 * The successor keys mirror `successorsOf` in kinds.ts verbatim — `${predecessorId}->${kind}`
 * — because they ARE the same keys: this function predicts what that function will ask for.
 * If the two ever disagree, the projection addresses rows that exist under other ids, which
 * is the failure the shared derivation exists to make impossible.
 *
 * The third id is addressed from the SECOND, not from the run: chaining is transitive and each
 * key is built from its own predecessor, so a chain whose head id source changed moves all
 * three together rather than leaving the tail addressing a row nobody minted (422 D-13). It is
 * deliberately not keyed by candidate: candidates are discovered by the fold and a chain whose
 * identity depended on them could not be predicted before the fold ran.
 */
export function chainJobIdsForRun(runId: string, idSource: JobIdSource): ChainJobIds {
  const analyzeRun = idSource.jobIdFor('analyze-run', runId)
  const curateMemory = idSource.jobIdFor(
    'curate-memory',
    `${String(analyzeRun)}->curate-memory`,
  )
  return {
    analyzeRun,
    curateMemory,
    proposeImprovements: idSource.jobIdFor(
      'propose-improvements',
      `${String(curateMemory)}->propose-improvements`,
    ),
  }
}

/**
 * The marker a permanently failed analysis leaves on the successors it hands on (D-20).
 *
 * Read by the notification builder to report the analysis stage honestly: the chain proceeded
 * with no verdicts, and the record has to say so even though the job that reports the
 * terminal is the one that succeeded afterwards.
 */
export const UNKNOWN_VERDICTS_MARKER = 'unknown'

export interface ChainTerminalNotificationInput {
  readonly runId: string
  /** The kind whose finish is landing the chain terminal. */
  readonly finishingKind: JobKind
  /** How that job itself ended. */
  readonly finished: 'done' | 'failed'
  /** The payload it was claimed with — the carrier of the upstream stages' provenance. */
  readonly payload: unknown
  /** The values this attempt published, by checkpoint id. Empty on a job that published none. */
  readonly publishedValues: ReadonlyMap<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * The verdict summary the analysis stage put on its successor's payload.
 *
 * Absent is not a failure and not a zero-filled guess — it is a chain whose analysis never
 * produced verdicts, which the fallback marker reports separately. An unreadable summary
 * degrades to the empty one rather than refusing: this record is written inside the
 * transaction that lands a job terminal, and a guard that threw here would trade a slightly
 * poorer notification for a rolled-back completion.
 *
 * Read from the payload ROOT first and from the forwarded upstream block second (422 D-13).
 * The two are the same fact carried by two generations of payload: a curate-memory job is
 * claimed with the summary at the root, and the propose-improvements job one edge further on
 * is claimed with it nested under `upstream`, because by then the root belongs to the fold.
 * Root-first rather than upstream-first so the nearer producer wins, which is also the reading
 * that makes a curate-memory terminal behave exactly as it did before this stage existed.
 */
function readVerdictSummary(payload: Record<string, unknown>): RunNotification['verdictSummary'] {
  const direct = asRecord(payload.verdictSummary)
  const summary = isCount(direct.total)
    ? direct
    : asRecord(asRecord(payload.upstream).verdictSummary)
  const byClassSource = asRecord(summary.byClass)
  if (!isCount(summary.total)) return { total: 0, byClass: {} }
  const byClass: Partial<Record<Verdict['class'], number>> = {}
  for (const [className, count] of Object.entries(byClassSource)) {
    if (isCount(count)) byClass[className as Verdict['class']] = count
  }
  return { total: summary.total, byClass }
}

/**
 * Assemble the record from what the engine holds at the terminal — nothing is read back.
 *
 * Every stage's outcome is derivable from three facts already in hand: which kind is
 * finishing, how it ended, and what its payload says about the stages upstream of it. That
 * matters because this runs immediately before the terminal transaction; a builder that
 * needed a query would be reading rows the same transaction is about to change.
 */
export function buildChainTerminalNotification(
  input: ChainTerminalNotificationInput,
): RunNotification {
  const payload = asRecord(input.payload)
  const upstream = asRecord(payload.upstream)

  // The fallback marker travels FORWARD on the successor payload, so a curate-memory job that
  // succeeded after a dead analysis still knows the analysis died. Without it the record
  // would report the only stage it watched and call the chain done.
  //
  // 422 D-13 adds the second carrier for the same fact, one edge further on: by the time the
  // proposal job is claimed the root marker belongs to the fold's own payload, so the fold
  // restates the analysis outcome under `upstream`. BOTH are read — a build that dropped the
  // root marker would stop reporting dead analyses on chains whose fold was reached by the
  // fallback, which is precisely the population where the report matters most.
  const analysisFailed =
    payload.verdicts === UNKNOWN_VERDICTS_MARKER ||
    asRecord(payload.upstream).analysisStatus === 'failed' ||
    (input.finishingKind === 'analyze-run' && input.finished === 'failed')

  // THE TERMINAL TRAP (422-PATTERNS A5), closed here. Before the third stage, the finishing job
  // WAS the curation job, so its published `bundle-committed` value was the counts and its own
  // disposition was the stage's outcome. A proposal job publishes neither: it is downstream of a
  // fold that already committed. Reading only what the finishing job published would have
  // reported every completed curation as a failure and lost its counts on every three-stage run.
  //
  // Reaching the proposal stage at all is itself the proof the fold completed: the successor is
  // produced only by `realCurateMemoryHandler`'s success path, and a permanently failed fold
  // halts the chain with no successor at all. So the STATUS is derived from the finishing kind
  // and only the COUNTS are read from the forwarded block — which is why a payload that lost its
  // counts degrades to a countless `done` rather than to a fabricated failure.
  const proposalTerminal = input.finishingKind === 'propose-improvements'
  const committed = proposalTerminal
    ? asRecord(upstream.curation)
    : asRecord(input.publishedValues.get('bundle-committed'))
  const curationSucceeded =
    proposalTerminal || (input.finishingKind === 'curate-memory' && input.finished === 'done')
  const curation: RunNotification['stages']['curation'] = curationSucceeded
    ? {
        status: 'done',
        // Counts only when a bundle was actually committed. Zeros on a stage that never got
        // there would claim it curated nothing, which is a different sentence.
        ...(isCount(committed.curated) ? { curated: committed.curated } : {}),
        ...(isCount(committed.deprecated) ? { deprecated: committed.deprecated } : {}),
      }
    : { status: 'failed' }

  // Present ONLY when the proposal job is the one landing the terminal, which is exactly when
  // the stage ran. A chain that halted at the fold omits the member, and the absence is read
  // downstream as "not recorded" rather than as a stage that failed (422 D-15).
  const authored = asRecord(input.publishedValues.get('proposals-authored'))
  const proposalsSucceeded = proposalTerminal && input.finished === 'done'
  const proposals: RunNotification['stages']['proposals'] | undefined = !proposalTerminal
    ? undefined
    : proposalsSucceeded
      ? {
          status: 'done',
          ...(isCount(authored.proposed) ? { proposed: authored.proposed } : {}),
          ...(isCount(authored.skipped) ? { skipped: authored.skipped } : {}),
        }
      : { status: 'failed' }

  return {
    schemaVersion: CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION,
    runId: input.runId,
    outcome:
      analysisFailed || !curationSucceeded || (proposalTerminal && !proposalsSucceeded)
        ? 'failed'
        : 'done',
    verdictSummary: readVerdictSummary(payload),
    stages: {
      analysis: { status: analysisFailed ? 'failed' : 'done' },
      curation,
      ...(proposals === undefined ? {} : { proposals }),
    },
  }
}
