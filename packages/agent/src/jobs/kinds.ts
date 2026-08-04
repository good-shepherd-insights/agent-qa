// The six real agent job kinds (Phase 385, D-09 / D-17 / D-18 / D-20).
//
// The kind set is closed and shipped, and this module declares every member of it. The
// declarations are the CONTRACT this phase ships; the handler bodies are deterministic
// stand-ins, and the two are not the same kind of thing. Real semantics for analyze-run and
// curate-memory arrive with the phases that own them — what has to exist now is a complete,
// registry-driven description of how each kind checkpoints, chains, retries and gives up,
// because the crash matrix iterates THAT rather than a list of its own.
//
// The stand-ins are scripted by payload, in the style of the v51 drain fixture's scripted
// author: a handler publishes its own declared schedule with its own bytes and then does
// exactly what the payload asked for. That matters for two separate reasons. Distinguishable
// bytes mean a matrix comparing six recovered histories is comparing six different things
// rather than six copies of one. Scriptable outcomes mean the adversarial legs — a chain, a
// retryable report, a permanent one — can be driven through the REAL kinds instead of through
// a synthetic stand-in that a later refactor could leave behind.
//
// Deliberately absent from every published byte: the attempt number and any timestamp. A
// checkpoint whose bytes changed with the attempt that wrote it would make an interrupted
// history differ from an uninterrupted one for a reason that has nothing to do with recovery,
// and the usual repair for a failing equality assertion is to loosen it.

import type {
  ChainedJobRequest,
  CompletedRunHandoff,
  ExecutionContext,
  JobHandlerOutcome,
  JobKind,
  PerTestOutcome,
  RunAnalysisArtifact,
  Verdict,
  VerdictGroundingQuote,
  VerdictSentenceParts,
} from '@vostride/agent-qa-schema'
import {
  canonicalJson,
  CURRENT_ANALYSIS_SCHEMA_VERSION,
  sha256hex,
} from '@vostride/agent-qa-schema'
import { deterministicVerdict, UNKNOWN_SIGNAL_RATIONALE } from '@vostride/agent-qa-runner'

import { UNKNOWN_VERDICTS_MARKER } from './chain-identity.js'
import { createJobKindRegistry } from './kind-registry.js'
import type {
  FallbackContinuationInput,
  JobHandler,
  JobKindDeclaration,
  JobKindRegistry,
} from './kind-registry.js'

/**
 * What a stand-in handler will do, as read off the payload it was handed.
 *
 * Every field is optional and an absent field means the ordinary path, so a caller that knows
 * nothing about this module gets a job that publishes its schedule and completes.
 */
export interface StandInJobScript {
  /** Chain to every successor the kind declares. */
  readonly chain?: boolean
  /** Report a failure instead of completing. */
  readonly fail?: 'retryable' | 'permanent'
  readonly reason?: string
}

function readScript(payload: unknown): StandInJobScript {
  if (typeof payload !== 'object' || payload === null) return {}
  const record = payload as Record<string, unknown>
  const fail = record.fail === 'retryable' || record.fail === 'permanent' ? record.fail : undefined
  return {
    chain: record.chain === true,
    fail,
    reason: typeof record.reason === 'string' ? record.reason : undefined,
  }
}

/**
 * The successor instances a kind produces, derived from the predecessor's id.
 *
 * The key is derived rather than minted so the same logical continuation carries the same key
 * in every process and on every replay — which is what makes re-running a chain after a crash
 * a dedupe instead of a second job.
 */
function successorsOf(
  declaration: Pick<JobKindDeclaration, 'kind' | 'allowedSuccessors'>,
  jobId: string,
  extra: Record<string, unknown> = {},
): readonly ChainedJobRequest[] {
  return declaration.allowedSuccessors.map((successor) => ({
    kind: successor,
    payload: { from: declaration.kind, predecessor: jobId, ...extra },
    idempotencyKey: `${jobId}->${successor}`,
  }))
}

function standInHandler(
  kind: JobKind,
  checkpointSchedule: readonly string[],
  allowedSuccessors: readonly JobKind[],
): JobHandler {
  return async (context) => {
    const script = readScript(context.payload)
    let step = 0
    for (const checkpointId of checkpointSchedule) {
      await context.publishCheckpoint(checkpointId, {
        kind,
        checkpointId,
        step,
        jobId: String(context.job.id),
      })
      step += 1
    }
    if (script.fail !== undefined) {
      return { status: script.fail, reason: script.reason ?? `${kind} stand-in scripted failure` }
    }
    return {
      status: 'complete',
      next: script.chain === true ? [...successorsOf({ kind, allowedSuccessors }, String(context.job.id))] : [],
    }
  }
}

/**
 * analyze-run's ratified disposition: the chain proceeds with unknown verdicts (spec §1.2).
 *
 * Its downstream jobs must never wait on a dead head, so a permanently failed analysis hands
 * them the same successors a successful one would, marked as carrying no verdicts. Nothing
 * here reaches a model, and nothing here can: what it is given is the failed job, the payload
 * that job was handed, and the reason.
 *
 * "The same successors a successful one would" is now load-bearing rather than incidental
 * (388 D-04). It maps over the PRODUCED set, not the declared one — the shipped 385 version
 * mapped over the declaration, which meant a dead analysis was the one case that enqueued a
 * triage job. That build's issues chip would have read `reserved` while a triage job existed
 * and ran, and the chain-terminal check would have waited on a job D-04 says never exists —
 * on exactly the runs whose analysis had already failed.
 *
 * The extra carries the run's identity and posture forward for the same reason the success
 * path does (Pitfall 6): the successor may be claimed by the daemon, which resolves posture
 * from `payload.executionContext` (386 D-09/D-12), and curation cannot fold a run directory
 * it was never told about. The unknown-verdicts marker travels with them so the chain
 * terminal can report the analysis stage honestly from a job that succeeded afterwards.
 */
function analyzeRunFallback(input: FallbackContinuationInput): readonly ChainedJobRequest[] {
  const payload = asRecord(input.payload)
  return successorsOf(
    { kind: 'analyze-run', allowedSuccessors: ANALYZE_RUN_PRODUCED_SUCCESSORS },
    String(input.job.id),
    {
      ...(typeof payload.runId === 'string' ? { runId: payload.runId } : {}),
      ...(payload.executionContext === undefined
        ? {}
        : { executionContext: payload.executionContext }),
      verdicts: UNKNOWN_VERDICTS_MARKER,
      failureReason: input.reason,
    },
  )
}

const ANALYZE_RUN_SUCCESSORS: readonly JobKind[] = ['curate-memory', 'triage-issues']

/**
 * The successors 388's analyze-run actually PRODUCES (D-04).
 *
 * Deliberately not the same list as the declaration above, and the difference is the whole
 * of D-04: the topology declares what MAY be chained and stays auditable in one place, while
 * the handler returns the instances that exist. `triage-issues` is reserved — declared, so
 * the issue engine can fill it without a topology change, and never enqueued, so the issues
 * chip's `reserved` status is structurally true rather than a promise.
 */
const ANALYZE_RUN_PRODUCED_SUCCESSORS: readonly JobKind[] = ['curate-memory']

/**
 * The host powers the two real post-run handlers need, injected by the composition (D-01).
 *
 * Both are things `agent` cannot do and must never learn to: reading a file is a host API in
 * a storageNeutral package, and the curation drain lives two packages away behind the writer
 * lease. Passing them as capabilities is what lets the handler bodies be real here while the
 * bindings stay where the ownership is — and it is also the seam a test uses to drive the
 * chain without a knowledge root.
 *
 * The whole interface is OPTIONAL at construction. A registry built without it keeps the
 * scripted stand-ins byte-identically, because several shipped suites — engine semantics,
 * kind registry, the kill matrix — drive the REAL kinds by scripting their payloads, and a
 * build where those kinds could only do real work would have no way to express "chain here,
 * fail permanently there" without a knowledge root and a run directory per case.
 */
export interface PostRunJobCapabilities {
  /**
   * The run's persisted handoff, addressed by `runId` alone.
   *
   * Hard-fails typed on a missing or malformed document rather than answering `undefined`:
   * D-06 makes the PATH derived and the BYTES pinned, so "there is no handoff for this run"
   * is a permanent condition of that run, never a transient one worth retrying.
   */
  loadCompletedRunHandoff(runId: string): CompletedRunHandoff
  /**
   * The per-run fold, and the fold's own report of whether it FINISHED (WR-03).
   *
   * `complete` is not a nicety on the side of the counts: the v51 fold answers `false` for
   * candidate refusals, a cap exceeded, unresolved canaries, a failed outcome projection and
   * requeues, and in every one of those cases it writes NO receipt so the run refolds later.
   * Both production bindings used to return the counts alone, which is how a fold that refused
   * became a stage the durable notification row called `done` — the one place in this phase
   * where the record overstated what happened. It is part of the contract precisely so a
   * binding cannot drop it silently: omit it and the binding stops typechecking.
   */
  curateRun(input: {
    readonly runId: string
    readonly executionContext: unknown
    readonly deadlineMs?: number
  }): Promise<{
    readonly curated: number
    readonly deprecated: number
    readonly complete: boolean
  }>
  /**
   * Put one run's analysis artifact durably on disk (389 D-09).
   *
   * Called INSIDE the author callback, before the verdicts-authored value is recorded — the
   * authorship primitive records only after the callback returns, so by the time any chip can
   * read `done` the sentence is already fetchable. Authored never overstates. The binding is
   * the host's (`agent-local` derives the path from `runId` the same way it derives the
   * handoff's — a job payload never carries a path); a synchronous throw here propagates out
   * of the author, no checkpoint is recorded, and the declared bound adjudicates the retry.
   */
  persistAnalysis(artifact: RunAnalysisArtifact): void
}

/** The claim shape analyze-run is enqueued with (D-06). Anything else is unreadable input. */
interface AnalyzeRunPayload {
  readonly runId: string
  readonly handoffDigest: string
  readonly handoffSchemaVersion: number
  readonly executionContext: ExecutionContext | undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readAnalyzeRunPayload(value: unknown): AnalyzeRunPayload | undefined {
  const record = asRecord(value)
  if (typeof record.runId !== 'string' || record.runId === '') return undefined
  if (typeof record.handoffDigest !== 'string' || record.handoffDigest === '') return undefined
  if (typeof record.handoffSchemaVersion !== 'number') return undefined
  return {
    runId: record.runId,
    handoffDigest: record.handoffDigest,
    handoffSchemaVersion: record.handoffSchemaVersion,
    executionContext:
      typeof record.executionContext === 'string'
        ? (record.executionContext as ExecutionContext)
        : undefined,
  }
}

/**
 * A permanent report, phrased once.
 *
 * Every unreadable-input path below is PERMANENT rather than retryable, and that is A1 rather
 * than pessimism: a payload whose shape is wrong, a handoff that is not there, bytes that
 * drifted — none of them becomes right on a second attempt, and retrying them would spend a
 * bound the poison-job case needs.
 */
function permanently(reason: string): JobHandlerOutcome {
  return { status: 'permanent', reason }
}

/**
 * Members whose outcome is worth a root-cause verdict.
 *
 * The complement of the runner's own presence rule (373-07): clean passes, skipped and
 * cancelled members are not failures to explain. Everything else gets a verdict, which is
 * what keeps the checkpoint's array in step with what the analysis chip claims to cover.
 */
function needsVerdict(test: PerTestOutcome): boolean {
  return test.outcome !== 'passed' && test.outcome !== 'skipped' && test.outcome !== 'cancelled'
}

/**
 * The D-02 bridge: PROJECT the verdicts the runner already persisted; never re-classify.
 *
 * Re-running the classifier here is not merely redundant, it is impossible to do faithfully —
 * it reads `TestResult.retryCount`, which `PerTestOutcome` deliberately does not carry, so a
 * handler that "re-classified" would be classifying from strictly less evidence and quietly
 * disagreeing with the verdict already on disk. An absent verdict is filled with the same
 * 'unknown' the classifier itself mints, so the array covers every failed member and 389 can
 * supersede exactly the ones that carry no signal.
 */
function projectHandoffVerdicts(handoff: CompletedRunHandoff): Verdict[] {
  return handoff.tests
    .filter(needsVerdict)
    .map((test) => test.rootCause ?? deterministicVerdict(
      'unknown',
      UNKNOWN_SIGNAL_RATIONALE,
      [],
      test.testIndex,
    ))
}

/** Per-class counts, carried forward so the chain terminal can report them without a re-read. */
function summarizeVerdicts(verdicts: readonly Verdict[]): {
  total: number
  byClass: Partial<Record<Verdict['class'], number>>
} {
  const byClass: Partial<Record<Verdict['class'], number>> = {}
  for (const verdict of verdicts) {
    byClass[verdict.class] = (byClass[verdict.class] ?? 0) + 1
  }
  return { total: verdicts.length, byClass }
}

/**
 * The one concrete next action a template sentence names, total over the verdict union
 * (389 D-06). A `Record` rather than an if-chain so an added class is a compile error here,
 * not an uncovered row — the 388-11 `postureOf` discipline.
 */
const TEMPLATE_NEXT_ACTION: Record<Verdict['class'], string> = {
  test_bug: 'update the test to match the behaviour the app now has',
  app_bug: 'file the failure against the application with the quoted evidence',
  environment: 'check the environment or infrastructure dependency the run relied on',
  flake: 'watch for recurrence before changing the test or the app',
  config_error: 'fix the run configuration the signal names',
  llm_error: 'retry the run; the failure originated in the model pipeline, not the app',
  unknown: 'inspect the run manually — no deterministic signal matched',
  timeout: 'investigate the slow dependency or raise the step timeout deliberately',
}

/**
 * A verbatim quote of captured evidence for one member test (389 D-06).
 *
 * Precedence inside the first failed step (else the last step): the first sub-action error
 * text, else the verifier's own reasoning. A test that captured ZERO steps quotes its
 * test-level outcome through the typed no-step arm — never a fabricated stepIndex. Every
 * branch quotes bytes the run actually recorded; templates assemble around the quote, the
 * quote itself is never authored.
 */
function templateGroundingQuote(test: PerTestOutcome | undefined): VerdictGroundingQuote {
  if (test === undefined || test.steps.length === 0) {
    return { source: 'test-outcome', quote: test?.outcome ?? 'failed' }
  }
  const step = test.steps.find((candidate) => !candidate.verifierVerdict.pass)
    ?? test.steps[test.steps.length - 1] as (typeof test.steps)[number]
  const subActionError = step.subActions
    .map((subAction) => subAction.result.error)
    .find((error): error is string => typeof error === 'string' && error !== '')
  return {
    stepIndex: step.stepIndex,
    quote: subActionError ?? step.verifierVerdict.reasoning,
  }
}

/**
 * Producer-keyed template parts for one floor verdict (389 D-06).
 *
 * Deterministic classes get code-authored parts derived from the hard signal that minted the
 * class — the classifier's rationale IS that signal, so the discriminator carries it.
 * `unknown` gets the honest "root cause undetermined" discriminator and the manual-inspection
 * next action; plan 04's LLM upgrade replaces exactly those members through the same author
 * callback, and nothing else changes shape.
 *
 * Exported (module-level, NOT on the package barrel) for the `analysis.get` op's floor leg:
 * a run with no artifact renders honest parts through THIS same rule — a second spelling of
 * the template inside the op would be exactly the D-06 drift the one-rule law forbids.
 */
export function templateSentenceParts(
  verdict: Verdict,
  handoff: CompletedRunHandoff,
): VerdictSentenceParts {
  const test = handoff.tests.find((candidate) => candidate.testIndex === verdict.perTest)
  return {
    perTest: verdict.perTest,
    groundingQuote: templateGroundingQuote(test),
    discriminator:
      verdict.class === 'unknown'
        ? 'root cause undetermined'
        : `${verdict.class}: ${verdict.evidence.rationale}`,
    nextAction: TEMPLATE_NEXT_ACTION[verdict.class],
    links: [],
  }
}

/**
 * The real analyze-run body (D-02 / D-06 / 389 D-09).
 *
 * Reads the run's handoff through the injected capability, refuses anything that is not the
 * document the enqueuer measured, authors the verdicts through `recordLlmAuthorship`, and
 * hands curation the one successor D-04 allows. The recorded SHAPE — `{runId, verdicts}` —
 * is the frozen 388 D-02 byte-shape; sentence parts live in the analysis artifact the author
 * persists BEFORE its value is recorded, never on the checkpoint.
 */
function realAnalyzeRunHandler(capabilities: PostRunJobCapabilities): JobHandler {
  return async (context) => {
    const payload = readAnalyzeRunPayload(context.payload)
    if (payload === undefined) {
      return permanently(
        'the analyze-run payload does not name a run, a handoff digest and a handoff schema ' +
          'version, so there is nothing for this job to analyse',
      )
    }

    let handoff: CompletedRunHandoff
    try {
      handoff = capabilities.loadCompletedRunHandoff(payload.runId)
    } catch (error) {
      return permanently(
        `the handoff for ${payload.runId} could not be read: ` +
          (error instanceof Error ? error.message : String(error)),
      )
    }

    if (handoff.schemaVersion !== payload.handoffSchemaVersion) {
      return permanently(
        `the handoff for ${payload.runId} declares schema version ` +
          `${String(handoff.schemaVersion)} and the job was enqueued against ` +
          String(payload.handoffSchemaVersion),
      )
    }
    // D-06's bytes-drifted rule. The digest is the whole reason the payload carries no path:
    // it pins that the bytes being analysed are the bytes the tail measured, whoever rewrote
    // the file in between.
    if (sha256hex(canonicalJson(handoff)) !== payload.handoffDigest) {
      return permanently(
        `the handoff for ${payload.runId} no longer digests to the bytes this job was ` +
          'enqueued against, so analysing it would answer about a different run',
      )
    }

    // The author swap (389 D-09/JOBQ-03). On a fresh pass the callback runs exactly once:
    // floor projected, template parts authored, the artifact made durable through
    // `persistAnalysis`, and only THEN is the returned value recorded on the declared
    // checkpoint — the primitive awaits the record before handing the value back, so the
    // artifact-before-checkpoint ordering is structural, not scheduled. On a resume with a
    // recorded value, control never reaches this callback: the author is not re-invoked and
    // the artifact is not rewritten (the recorded-value path).
    const authored = await context.recordLlmAuthorship(
      'verdicts-authored',
      // Plan 04 upgrades the `unknown` members with the model capability this callback
      // receives as its argument; signature, artifact-write position and returned shape are
      // final here.
      async () => {
        const verdicts = projectHandoffVerdicts(handoff)
        const parts = verdicts.map((verdict) => templateSentenceParts(verdict, handoff))
        capabilities.persistAnalysis({
          schemaVersion: CURRENT_ANALYSIS_SCHEMA_VERSION,
          runId: payload.runId,
          verdicts,
          parts,
        })
        return { runId: payload.runId, verdicts }
      },
    )
    const verdicts = authored.verdicts

    return {
      status: 'complete',
      next: [
        ...successorsOf(
          { kind: 'analyze-run', allowedSuccessors: ANALYZE_RUN_PRODUCED_SUCCESSORS },
          String(context.job.id),
          {
            // Pitfall 6: a successor payload without these two is the DAEM-02 bug class — the
            // daemon resolves a claimed job's posture from `payload.executionContext` (386
            // D-09/D-12), and curation cannot find a run directory it was never told about.
            runId: payload.runId,
            executionContext: payload.executionContext ?? handoff.executionContext,
            verdictSummary: summarizeVerdicts(verdicts),
          },
        ),
      ],
    }
  }
}

/**
 * The real curate-memory body (D-01).
 *
 * The v51 curation fold runs INSIDE this job rather than beside it, which is what makes one
 * canonical pipeline out of two — and what makes the curation chip incapable of lying about
 * who did the work. The drain itself arrives as a capability: it needs the writer lease, a
 * knowledge root and a run directory, none of which this package may name.
 *
 * A capability that throws is reported as nothing at all: the engine catches it, spends an
 * attempt, and decides between a retry and a permanent failure from the declared bound. That
 * asymmetry is deliberate — this handler cannot know whether a drain failure is transient.
 */
function realCurateMemoryHandler(capabilities: PostRunJobCapabilities): JobHandler {
  return async (context) => {
    const record = asRecord(context.payload)
    if (typeof record.runId !== 'string' || record.runId === '') {
      return permanently(
        'the curate-memory payload names no run, so there is no run directory to fold and no ' +
          'receipt to write',
      )
    }
    await context.publishCheckpoint('candidates-authored', { runId: record.runId })
    const counts = await capabilities.curateRun({
      runId: record.runId,
      executionContext: record.executionContext,
    })
    // WR-03. The gate sits BEFORE the publish, not after it: `bundle-committed` is named for an
    // event, and a fold that refused wrote no bundle. Publishing it and then reporting the
    // failure would leave the chain terminal reading counts off a checkpoint whose event never
    // happened. Retryable rather than permanent because the fold's own recovery IS a refold —
    // it withheld the receipt precisely so the run folds again — and the declared bound
    // (maxAttempts: 3, onPermanentFailure: 'halt-chain') is what decides when refolding stops.
    if (!counts.complete) {
      return {
        status: 'retryable',
        reason: 'the curation fold did not complete and wrote no receipt; the stage will retry '
          + 'under its declared bound',
      }
    }
    await context.publishCheckpoint('bundle-committed', {
      runId: record.runId,
      curated: counts.curated,
      deprecated: counts.deprecated,
    })
    return { status: 'complete', next: [] }
  }
}

/**
 * Every kind, keyed by itself.
 *
 * `satisfies Record<JobKind, JobKindDeclaration>` is the compile-time half of D-09's
 * completeness: a seventh kind added to the shipped vocabulary fails to typecheck here until
 * it is declared. The registry-driven conformance test is the runtime half, and the two catch
 * different drifts — a missing entry versus an entry whose own `kind` field disagrees with
 * the slot it sits in.
 */
function declarationsFor(capabilities?: PostRunJobCapabilities) {
  return {
  // JOBQ-04 / C9. Chat is NOT a checkpointed job and never becomes one: its state of record
  // is the append-only session log, and the queue's checkpoint discipline covers background
  // work only. One attempt, because there is no durable progress for a second one to resume.
  chat: {
    kind: 'chat',
    checkpointed: false,
    checkpointSchedule: [],
    allowedSuccessors: [],
    maxAttempts: 1,
    backoff: { kind: 'none' },
    onPermanentFailure: 'halt-chain',
    handler: standInHandler('chat', [], []),
  },

  // The chain's head. Its verdicts feed curate-memory and triage-issues in parallel, so both
  // are declared successors, and its permanent failure proceeds with unknown verdicts.
  'analyze-run': {
    kind: 'analyze-run',
    checkpointed: true,
    checkpointSchedule: ['verdicts-authored'],
    allowedSuccessors: ANALYZE_RUN_SUCCESSORS,
    maxAttempts: 3,
    backoff: { kind: 'exponential', initialDelayMs: 1_000, factor: 2, maxDelayMs: 30_000 },
    onPermanentFailure: analyzeRunFallback,
    handler: capabilities === undefined
      ? standInHandler('analyze-run', ['verdicts-authored'], ANALYZE_RUN_SUCCESSORS)
      : realAnalyzeRunHandler(capabilities),
  },

  // Two checkpoints, mirroring the v51 curation lifecycle: candidates are authored, then the
  // bundle is committed. The second is the one whose recovery actually matters.
  'curate-memory': {
    kind: 'curate-memory',
    checkpointed: true,
    checkpointSchedule: ['candidates-authored', 'bundle-committed'],
    allowedSuccessors: [],
    maxAttempts: 3,
    backoff: { kind: 'exponential', initialDelayMs: 1_000, factor: 2, maxDelayMs: 30_000 },
    onPermanentFailure: 'halt-chain',
    handler: capabilities === undefined
      ? standInHandler('curate-memory', ['candidates-authored', 'bundle-committed'], [])
      : realCurateMemoryHandler(capabilities),
  },

  'triage-issues': {
    kind: 'triage-issues',
    checkpointed: true,
    checkpointSchedule: ['issues-drafted'],
    allowedSuccessors: [],
    maxAttempts: 2,
    backoff: { kind: 'fixed', delayMs: 5_000 },
    onPermanentFailure: 'halt-chain',
    handler: standInHandler('triage-issues', ['issues-drafted'], []),
  },

  consolidate: {
    kind: 'consolidate',
    checkpointed: true,
    checkpointSchedule: ['consolidation-authored'],
    allowedSuccessors: [],
    maxAttempts: 2,
    backoff: { kind: 'fixed', delayMs: 5_000 },
    onPermanentFailure: 'halt-chain',
    handler: standInHandler('consolidate', ['consolidation-authored'], []),
  },

  'propose-improvements': {
    kind: 'propose-improvements',
    checkpointed: true,
    checkpointSchedule: ['proposals-authored'],
    allowedSuccessors: [],
    maxAttempts: 2,
    backoff: { kind: 'fixed', delayMs: 5_000 },
    onPermanentFailure: 'halt-chain',
    handler: standInHandler('propose-improvements', ['proposals-authored'], []),
  },
  } satisfies Record<JobKind, JobKindDeclaration>
}

/**
 * The six declarations as a list, in the order the kind vocabulary declares them.
 *
 * The NO-CAPABILITY set: analyze-run and curate-memory carry their scripted stand-ins here,
 * byte-identically to what 385 shipped. Everything registry-driven that does not compose a
 * host — the conformance suite, the crash matrix, the kill matrix's adversarial legs — reads
 * this list, and every one of them scripts those two kinds by payload.
 */
export const REAL_JOB_KIND_DECLARATIONS: readonly JobKindDeclaration[] = Object.freeze(
  Object.values(declarationsFor()) as readonly JobKindDeclaration[],
)

/**
 * A registry over exactly the six real kinds.
 *
 * A fresh registry per call rather than a module-level singleton: a registry is a small,
 * cheap value, and one shared instance is how a test that registers something extra ends up
 * changing what every other test in the process sees.
 *
 * With `capabilities`, analyze-run and curate-memory dispatch their REAL bodies (388 D-01 /
 * D-02); without, they keep the scripted stand-ins. The stand-ins are the HARNESS affordance,
 * not a shipped posture: both production compositions bind capabilities — `composeLocalAgent`
 * when the run tail supplies its curation drain (plan 02), and the daemon's own composition
 * through the same input. A caller that gets a stand-in is a caller that asked for one.
 *
 * The DECLARATIONS are identical in both cases. Only the two handler slots move, so a matrix
 * that derives its crash points from the declared schedule covers the real bodies with no
 * harness change at all — which is the design intent 385 D-09 stated and this is the phase
 * that spends it.
 */
export function createRealJobKindRegistry(
  capabilities?: PostRunJobCapabilities,
): JobKindRegistry {
  return createJobKindRegistry(
    capabilities === undefined
      ? REAL_JOB_KIND_DECLARATIONS
      : (Object.values(declarationsFor(capabilities)) as readonly JobKindDeclaration[]),
  )
}
