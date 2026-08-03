// The post-run chip emitter (Phase 388 plan 04, D-13 / D-16).
//
// The push half of ANLZ-05. When THIS process drains the chain, the transitions it observes are
// appended to the run's own `events.jsonl`, continuing the seq order `runFinished` left off at,
// so a live view attached to that log sees analysis and curation move without polling.
//
// Two rules make the trail honest, and neither is a matter of taste:
//
//   1. OBSERVED OUTCOMES ONLY. Every envelope here is built from a `runNextJob` outcome the
//      pump actually received — never from an intention, never from a status somebody expects
//      the row to reach. A chip that announced a stage before the queue durably said so would
//      be a claim `runs.postprocessing` could contradict a millisecond later, and a surface
//      that can be told two different things about one row has no truth to render (T-388-14).
//   2. IN-PROCESS ONLY. The emitter is constructed on the acquired-lease drain leg and nowhere
//      else. When the daemon drains instead, nothing is emitted and durable job state is the
//      only truth — a second process never writes a finished run's log (386 D-16). That is
//      expressed as control flow rather than as a condition re-checked here: a leg that never
//      builds an emitter cannot forget to guard one.
//   3. RUN-SCOPED. The pump this emitter listens to is a GLOBAL FIFO: it claims the oldest
//      queued job in the store, which is routinely another run's. A claimed job whose id is not
//      in `chainJobIds` — the three ids THIS run's chain addresses, derived by the tail through
//      the one shared derivation the read op also uses — yields ZERO envelopes here. The
//      membership set is the only scoping input: never the kind, never the payload, never a
//      pattern over a field of the outcome being guarded. Kind alone cannot answer "whose chain
//      was that", and an emitter that guesses would put another run's transitions into this
//      run's log while durable state said otherwise (T-388-16).
//
// It appends DIRECTLY, and never through the run bus or its subscribers. By the time a chip
// exists the bus has published `runFinished`, every subscriber has been flushed and the exit
// code is frozen (D-16, Pitfall 6/8) — so the bus is not a slower path to the same file, it is
// a closed producer. The append discipline is `FsEventLog`'s verbatim: synchronous, fsync-free,
// exactly one JSON line per envelope, crash-safe up to the last completed append.

import { appendFileSync, readFileSync } from 'node:fs'

import type {
  ChipEventPayload,
  JobKind,
  MaskingContext,
  RunEventEnvelope,
  RunEventType,
} from '@vostride/agent-qa-schema'

import { completedRunEventsPath } from './curation-tail.js'

/**
 * The three chip kinds one chain stage can publish.
 *
 * A `Record` over the chain kinds rather than a lookup with a default, so a chain that grows a
 * member is a compile error here instead of a stage that silently emits nothing.
 */
interface StageChipKinds {
  readonly started: RunEventType
  readonly completed: RunEventType
  readonly failed: RunEventType
}

/**
 * Which job kind speaks through which chip.
 *
 * `triage-issues` is mapped even though 388 never enqueues one (D-04/D-15). The mapping is what
 * the stage WOULD emit if a triage job ran, and no envelope is ever built from it because the
 * emitter only speaks about outcomes it observed — so the reserved slot costs a table row here
 * and nothing on disk. Pinning it to "no chips ever" instead would mean the day the issue
 * engine lands, the one stage with a live producer is the one with no push path.
 *
 * `notify` is absent because it is not a job kind at all: the chain terminal is a function-layer
 * emission over a durable row (D-09), not a queue member, and it is not a chip.
 */
const STAGE_CHIPS: Partial<Record<JobKind, StageChipKinds>> = {
  'analyze-run': {
    started: 'analysisStarted',
    completed: 'analysisCompleted',
    failed: 'analysisFailed',
  },
  'curate-memory': {
    started: 'curationStarted',
    completed: 'curationCompleted',
    failed: 'curationFailed',
  },
  'triage-issues': {
    started: 'issuesStarted',
    completed: 'issuesCompleted',
    failed: 'issuesFailed',
  },
}

/**
 * The shape of a pump outcome this emitter reads.
 *
 * Structural rather than the engine's `RunNextJobOutcome` itself, and the narrowing is the
 * point: what a chip may say is derived from four fields, so a future disposition that carries
 * new information cannot leak into a chip without somebody widening this type on purpose.
 */
export interface ObservedJobOutcome {
  readonly ran: boolean
  /**
   * The job AS CLAIMED — its id as well as its kind.
   *
   * The id is the only discriminator that answers "whose chain did the pump just watch". It was
   * absent for exactly one round, and the emitter dispatched on kind alone: enough to pick a
   * chip, never enough to pick a run.
   */
  readonly job?: { readonly id: string; readonly kind: JobKind }
  readonly disposition?: 'completed' | 'retry-scheduled' | 'cancelled' | 'failed'
  readonly handlerInvoked?: boolean
  readonly reason?: string
}

export interface PostRunChipEmitter {
  /** Turn one observed pump outcome into its chip transitions and append them. */
  observe(outcome: ObservedJobOutcome): void
  /** How many envelopes this emitter has appended. */
  emitted(): number
}

export interface CreatePostRunChipEmitterOptions {
  readonly agentQaRoot: string
  readonly runId: string
  /**
   * The three ids THIS run's chain addresses; anything else is another run's work.
   *
   * Arrives as DATA rather than as a derivation performed here, and that is the whole shape of
   * the fix: the tail derives it once through `chainJobIdsForRun` — the same function the read
   * op derives from — and hands it down. Two copies of the hash input would be two chains that
   * review identically and address different rows, which is the failure the shared derivation
   * exists to make impossible.
   */
  readonly chainJobIds: readonly string[]
  /**
   * The run's own masker, the same one the fold is threaded with.
   *
   * OPTIONAL because a tail may legitimately carry none, and the bound below still applies —
   * absence must degrade the redaction, never the discipline.
   */
  readonly maskingContext?: MaskingContext
  /** The tail's one wall clock, so envelope stamps and budget arithmetic share a source. */
  readonly now?: () => number
}

/**
 * How much of a failure reason a chip may carry.
 *
 * The chip's `error` is a diagnostic POINTER, not a transcript: it exists so a surface can say
 * which stage failed and roughly why, and the full text is already in the tail's warn log where
 * a human is looking when they care. A constant with a stated reason rather than a knob (386
 * D-15): the number that matters is "short enough that a runaway exception cannot flood a log
 * every attached surface streams", and no project's answer to that differs. Retune here if a
 * real diagnosis is ever found truncated — 500 is roughly five lines of message.
 */
const CHIP_ERROR_MAX_LENGTH = 500

/**
 * The seq the run's log stopped at.
 *
 * Read from the file rather than carried in memory because the process that WROTE those lines
 * has already closed its bus — `finalSeq` lives on the last line and nowhere else this side of
 * the verdict. A torn or absent log yields 0, which makes the first chip seq 1: the same number
 * the bus itself starts at, so a chip trail over a lost log is still internally ordered rather
 * than anchored to a seq nobody can see.
 */
function lastRecordedSeq(eventsPath: string): number {
  let raw: string
  try {
    raw = readFileSync(eventsPath, 'utf8')
  } catch {
    return 0
  }
  const lines = raw.split('\n').filter((line) => line.length > 0)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]!) as { seq?: unknown }
      if (typeof parsed.seq === 'number' && Number.isFinite(parsed.seq)) return parsed.seq
    } catch {
      // The reader never throws on garbage (runner-local D-07): a torn final line is skipped
      // and the seq is taken from the last line that parses.
      continue
    }
  }
  return 0
}

export function createPostRunChipEmitter(
  options: CreatePostRunChipEmitterOptions,
): PostRunChipEmitter {
  const eventsPath = completedRunEventsPath(options.agentQaRoot, options.runId)
  const now = options.now ?? Date.now
  /**
   * The one free-form-text field this file writes to disk, masked THEN bounded.
   *
   * Masked first and bounded second, in that order and not the other: a slice applied first
   * could cut a secret in half and hand the masker a token it no longer recognises, which is the
   * quiet way a redaction stops firing. `handler-threw: ${error.message}` (engine.ts) is text
   * from anywhere inside the curation drain, the knowledge store or a provider client — the
   * whole rest of a chip payload is counts and identifiers (D-11), and this joins that
   * discipline rather than being the exception to it (T-388-17 / WR-08).
   */
  const chipError = (reason: string): string =>
    (options.maskingContext?.mask(reason) ?? reason).slice(0, CHIP_ERROR_MAX_LENGTH)
  // Read ONCE, at construction: the emitter is the only writer of this file from here on, so
  // re-reading per append would be asking a file what this object already knows — and would
  // make the trail's ordering depend on nobody else appending, which is the assumption the
  // in-process-only rule already guarantees.
  let nextSeq = lastRecordedSeq(eventsPath) + 1
  let emitted = 0

  const append = (type: RunEventType, payload: ChipEventPayload): void => {
    const envelope: RunEventEnvelope = {
      seq: nextSeq,
      ts: now(),
      runId: options.runId,
      type,
      payload,
    }
    nextSeq += 1
    emitted += 1
    appendFileSync(eventsPath, `${JSON.stringify(envelope)}\n`)
  }

  return {
    observe(outcome: ObservedJobOutcome): void {
      if (!outcome.ran) return
      const job = outcome.job
      // An outcome that cannot be ATTRIBUTED must not be emitted. Silence here is a stage whose
      // durable row still answers for it; a chip is a claim, and a claim with no claimant is the
      // one thing this file may never append.
      if (job === undefined) return
      // Rule 3. The pump is a global FIFO, so this is the common case rather than the odd one.
      if (!options.chainJobIds.includes(String(job.id))) return
      const kind = job.kind
      if (kind === undefined) return
      const chips = STAGE_CHIPS[kind]
      // A kind outside the chain — `chat`, `consolidate`, `propose-improvements` — is not a
      // post-processing stage and has no chip to move. The pump can legitimately run one.
      if (chips === undefined) return

      // `handlerInvoked: false` means the attempt bound was already spent at claim time and the
      // driver failed the job WITHOUT handing it to its handler (385 D-18). Emitting `started`
      // there would announce a start that provably never happened — the one lie this emitter
      // is shaped to be unable to tell.
      if (outcome.handlerInvoked !== false) {
        append(chips.started, { runId: options.runId })
      }

      if (outcome.disposition === 'completed') {
        append(chips.completed, { runId: options.runId })
        return
      }
      // `cancelled` joins the failure chip deliberately, matching `projectPostProcessingChips`:
      // both are terminal states in which the stage's work did not happen, and a push event
      // that told them apart would disagree with the durable projection of the same row.
      const willRetry = outcome.disposition === 'retry-scheduled'
      append(chips.failed, {
        runId: options.runId,
        ...(outcome.reason === undefined ? {} : { error: chipError(outcome.reason) }),
        ...(willRetry ? { willRetry: true } : {}),
      })
    },

    emitted(): number {
      return emitted
    },
  }
}
