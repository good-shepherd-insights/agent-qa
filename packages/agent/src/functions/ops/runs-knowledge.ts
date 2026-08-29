// `runs.knowledge` — what ONE run used and learned (Phase 407, LERN-01 / LERN-02 · D-05 / D-06).
//
// THE PANEL'S ONE READ. D-05's posture is that the Knowledge tab is a thin client over a single
// registry verb, not a page composing N `knowledge.brief.why` calls: the browser, the CLI, MCP
// and chat all ask this one question and get the same bytes. That is the fourth-door law applied
// to a surface that would otherwise have been assembled client-side out of per-step reads whose
// answers could disagree with each other about one run.
//
// THE SUBSTRATE IS THE RUN'S HANDOFF, AND NOTHING ELSE (D-06). `deps.runs.get` resolves through
// the same `enumerate()` / `loadCompletedRunHandoff` version guard `readStepEvidence` uses, so
// this op and `knowledge.brief.why` can never disagree about what a run recorded. It is NOT the
// dashboard `run_steps` projection — those rows carry no served brief at all.
//
// IT ANSWERS ABOUT THEN. This op is handed no serving capability: there is no index handle in
// scope, so re-running retrieval to explain a brief is not a temptation it has to resist. A step
// whose trace was never captured answers `no-trace: pre-trace-run` — the honest absence — rather
// than a plausible trace computed against today's index (KREV-02's founding argument).
//
// A PRUNED HANDOFF IS A RESULT, NOT A THROW (D-06). `runs.digest` next door raises
// `RunNotFoundError` because a digest NAMES a run and a missing one is a bad question. Here the
// caller is a PAGE, and a page whose evidence has been garbage-collected has a legible state to
// render (406 D-17's `EvidenceIncomplete`); a refusal would make that state indistinguishable
// from a broken read.
//
// THE THREE SIBLING OPS ARE INVOKED, NOT REIMPLEMENTED (391's rule). The curation word is the
// same word `runs.postprocessing` serves, the change list is the same list
// `knowledge.records.diff` serves, and the proposal count is the same count `runs.digest` serves
// — by CALLING them with this call's deps rather than by a comment promising not to diverge. The
// specs are module-internal, so this is composition inside the layer and not a dispatch path
// around `invokeFunction`'s gate: every external caller still arrives through the pipeline.

import {
  NO_KNOWLEDGE_READER_TRUNCATION,
  RecordedRetrievalRungSchema,
  RunKnowledgeProjectionSchema,
  RunsKnowledgeInputSchema,
} from '@vostride/agent-qa-schema'
import type {
  BriefLine,
  CautionLine,
  CompletedRunHandoff,
  PostProcessingStatus,
  ReadTrace,
  RecordChange,
  RecordedRetrievalRung,
  RunKnowledgeCanaryAttribution,
  RunKnowledgeProjection,
  RunKnowledgeStep,
  RunKnowledgeTrace,
  RunsKnowledgeInput,
  StepEvidence,
} from '@vostride/agent-qa-schema'

import type { ClauseVerdict, FunctionDeps, FunctionSpec } from '../spec.js'
import { knowledgeRecordsDiffSpec } from './knowledge-records-diff.js'
import { runsDigestSpec } from './runs-digest.js'
import { projectPostProcessingChips, runsPostProcessingSpec } from './runs-post-processing.js'

/**
 * Lowercase dot taxonomy (384 D-15): the `runs` domain, one noun.
 *
 * `runs.knowledge` and not `knowledge.run`, for the reason `runs.postprocessing` is not
 * `postprocessing.get` — what this returns is a fact ABOUT A RUN. The literal appears here once;
 * every surface names the exported constant and the parity suite picks the id up from the
 * registry.
 */
export const RUNS_KNOWLEDGE_FUNCTION_ID = 'runs.knowledge'

/**
 * The recorded rung, read forward-compatibly (407-03 lands the evidence field).
 *
 * `StepEvidence.retrievalRung` is an ADDITIVE optional field 407-03 adds beside `retrievalTrace`;
 * this op ships first because D-05's whole argument is that the substrate is proven before the
 * surfaces are painted. Reading it through a narrow structural view rather than off the interface
 * keeps this file compiling across that seam in either order, and the value is VALIDATED rather
 * than cast: a handoff carrying a rung shape this build does not recognise projects no rung at
 * all, which is the same honest absence a pre-407 run gives.
 */
function recordedRungOf(evidence: StepEvidence): RecordedRetrievalRung | undefined {
  const candidate = (evidence as StepEvidence & { retrievalRung?: unknown }).retrievalRung
  if (candidate === undefined) return undefined
  const parsed = RecordedRetrievalRungSchema.safeParse(candidate)
  return parsed.success ? parsed.data : undefined
}

/**
 * Why this step's brief said what it said — `mapStepEvidenceToWhy`'s `found` arm, per step.
 *
 * The two arms and the `pre-trace-run` reason are the why-verb's own vocabulary rather than a
 * second spelling of it: the panel and `knowledge.brief.why` answer about the same step with the
 * same word. The lookup arms that verb also carries (`run-not-recorded`, `step-not-found`) cannot
 * arise here — a step reached through the loaded document exists by construction — so the panel's
 * evidence-gone state is the projection's own `evidence-incomplete` arm one level up.
 */
function traceArmOf(evidence: StepEvidence): RunKnowledgeTrace {
  const trace = evidence.retrievalTrace
  if (trace === undefined) {
    return { kind: 'no-trace', reason: 'pre-trace-run' }
  }
  return { kind: 'answered', trace }
}

// The three channel projections PICK named fields rather than spreading the producer's value, so
// a field added to the serving contract cannot silently reach a page (405's display posture).
function briefLine(line: BriefLine): RunKnowledgeStep['served']['channel1'][number] {
  return {
    id: String(line.id),
    kind: line.kind,
    summary: line.summary,
    trust: line.trust,
    status: line.status,
    servedAsCanary: line.servedAsCanary,
    tier: line.tier,
  }
}

function readTrace(entry: ReadTrace): RunKnowledgeStep['served']['channel2'][number] {
  return {
    id: String(entry.id),
    detailLevel: entry.detailLevel,
    bodyDigest: entry.bodyDigest,
  }
}

/** Anchors are deliberately dropped: the panel renders a caution's sentence and nothing else. */
function cautionLine(line: CautionLine): RunKnowledgeStep['served']['channel3'][number] {
  return { id: String(line.id), summary: line.summary }
}

function projectStep(
  testId: string,
  testIndex: number,
  evidence: StepEvidence,
): RunKnowledgeStep {
  const rung = recordedRungOf(evidence)
  return {
    testId,
    testIndex,
    stepIndex: evidence.stepIndex,
    stepText: evidence.stepText,
    served: {
      channel1: evidence.servedBrief.channel1.map(briefLine),
      channel2: evidence.servedBrief.channel2.map(readTrace),
      channel3: evidence.servedBrief.channel3.map(cautionLine),
    },
    trace: traceArmOf(evidence),
    // Spread-away absence, never a `null` and never a zero-fill: a step that replayed no
    // procedure carries NO `planSource` key, which is a different byte from one that carries an
    // empty source (the layer's own idiom).
    ...(evidence.planSource === undefined ? {} : { planSource: evidence.planSource }),
    ...(rung === undefined ? {} : { retrievalRung: rung }),
  }
}

/**
 * `unbound` means THIS PROJECT HAS NO KNOWLEDGE STORE, derived from durable bytes (D-16).
 *
 * The marker is the `truncation` sentence the runner writes when it serves a step with no reader
 * bound — the one durable fact that distinguishes "nothing was configured" from "retrieval ran
 * and served nothing", and one that cannot be recovered from an empty channel list. Derived from
 * the evidence rather than from the handoff version on purpose: a version says WHEN a run
 * happened, not what was bound to it.
 *
 * A run with zero steps reads `bound`, which is the conservative answer — it says nothing about
 * a store rather than reporting an absence nothing observed. A step carrying a recorded rung
 * reads `bound` even if its brief was empty, because a rung is only ever resolved when a reader
 * existed to resolve it against.
 */
function knowledgeStoreOf(steps: readonly StepEvidence[]): 'bound' | 'unbound' {
  if (steps.length === 0) return 'bound'
  const everyStepUnserved = steps.every(
    (evidence) => evidence.servedBrief.truncation === NO_KNOWLEDGE_READER_TRUNCATION,
  )
  const noRungRecorded = steps.every((evidence) => recordedRungOf(evidence) === undefined)
  return everyStepUnserved && noRungRecorded ? 'unbound' : 'bound'
}

function stepsOf(document: CompletedRunHandoff): readonly StepEvidence[] {
  return document.tests.flatMap((test) => test.steps)
}

export const runsKnowledgeSpec: FunctionSpec<RunsKnowledgeInput, RunKnowledgeProjection> = {
  id: RUNS_KNOWLEDGE_FUNCTION_ID,
  summary: "Project one run's used brief channels, serve-time traces, procedure use, recorded "
    + 'retrieval rung and curator deltas from its handoff.',
  requiredScopes: ['read'],
  resultKind: 'unary',
  // NO OPTIONAL-DEP BINDING KEY IS DECLARED ON THIS SPEC AT ALL, and the absence is a claim about
  // the op's substrate rather than an oversight. Its truth is the RUNS port, and that port is
  // REQUIRED — so, exactly like `knowledge.brief.why`, there is no composition that lists this
  // verb and then cannot run it. The three optional deps it consults (`postProcessing`,
  // `proposalsInbox`, and the reader's `canaryAttributions`) only ENRICH the Learned half; binding
  // this op to any of them would leave a host with no queue database unable to see what its own
  // runs used, which is the majority of this projection. Pinned by a cell, and by the grep in the
  // plan's own acceptance criteria — which is why the declaration keyword is not spelled anywhere
  // in this file, including in this comment.
  input: RunsKnowledgeInputSchema,
  output: RunKnowledgeProjectionSchema,
  risk: { name: `fn:${RUNS_KNOWLEDGE_FUNCTION_ID}`, recognized: true, readOnly: true },
  /**
   * COUNTS, NOT CONTENT (399.1 D-01 · 391 D-18's rule applied here).
   *
   * A receipt line names how much a run used and learned; the brief summaries, step text and
   * record ids themselves stay in `results[]` where a reader asked for them. Interpolating a
   * served summary here would put producer prose — possibly masked material — into an audit map.
   *
   * `evidence-incomplete` is `executed` and not a refusal, on `knowledge.brief.why`'s reasoning:
   * a pruned handoff is an answer this verb is proud of, not a control declining.
   */
  classify(output): ClauseVerdict {
    if (output.kind === 'evidence-incomplete') {
      return {
        status: 'executed',
        outcome: `knowledge for ${output.runId} — evidence incomplete`,
      }
    }
    const briefLines = output.steps.reduce(
      (total, step) => total + step.served.channel1.length,
      0,
    )
    return {
      status: 'executed',
      outcome: `knowledge for ${output.runId} — ${String(output.steps.length)} steps, `
        + `${String(briefLines)} brief lines served, `
        + `${String(output.learned.changes.length)} learned change(s)`,
    }
  },
  async invoke(input, deps: FunctionDeps) {
    const runId = String(input.runId)

    const document = await deps.runs.get(input.runId)
    if (document === undefined) {
      // D-06: a RESULT. The page renders the evidence-gone state; it does not catch anything.
      return { kind: 'evidence-incomplete', runId }
    }

    const steps = document.tests.flatMap((test) =>
      test.steps.map((evidence) => projectStep(test.testId, test.testIndex, evidence)))
    const evidence = stepsOf(document)

    // Run-constant by construction (D-13): the rung is resolved ONCE at composition and stamped
    // on every step, so the first step carrying one carries the run's. Reading it per step as
    // well is what lets a future producer change stay visible rather than silently averaged.
    const runRung = evidence.map(recordedRungOf).find((rung) => rung !== undefined)

    // Each optional dep is checked for PRESENCE rather than wrapped in a try/catch: swallowing
    // would also swallow a real failure inside a bound path, and "this host has no queue
    // database" is not the same fact as "the queue read threw" (runs-digest's rule).
    const status: PostProcessingStatus | undefined = deps.postProcessing === undefined
      ? undefined
      : await runsPostProcessingSpec.invoke({ runId: input.runId }, deps)
    const curationRow = status?.notification?.stages.curation
    // BOTH counts or neither (D-09/D-12). The frozen notification row omits them when curation
    // never committed a bundle, and a half-present pair rendered as `curated 3, deprecated 0`
    // would report a number nobody measured.
    const countsPresent = curationRow?.curated !== undefined
      && curationRow.deprecated !== undefined

    // Channel 1 only — a `ReadTrace` has no `servedAsCanary` authority (the pin
    // `emit-canary-outcomes.ts` already relies on), and the served line's own id IS the curation
    // candidate id.
    const tuples = document.tests.flatMap((test) =>
      test.steps.flatMap((step) =>
        step.servedBrief.channel1
          .filter((line) => line.servedAsCanary)
          .map((line) => ({
            candidateId: String(line.id),
            testId: test.testId,
            testIndex: test.testIndex,
            stepIndex: step.stepIndex,
          }))))

    const attribute = deps.knowledge.canaryAttributions
    const attributions = attribute === undefined || tuples.length === 0
      ? []
      : await attribute.call(deps.knowledge, { runId, tuples })
    const canaryAttributions: RunKnowledgeCanaryAttribution[] = attributions
      .filter((row) => row.outcome !== undefined)
      .map((row) => ({
        testIndex: row.testIndex,
        stepIndex: row.stepIndex,
        recordId: row.candidateId,
        observationId: row.observationId,
        // Narrowed by the filter above; the assertion states what the filter proved.
        outcome: row.outcome as NonNullable<typeof row.outcome>,
      }))

    // ATTRIBUTION, NOT A WINDOW (D-10). The since-ordinal only bounds how much the sibling op
    // reads; what makes a row THIS run's is the explicit link — the bundle provenance run id
    // 407-04 stamps, or an observation id recomputed from this run's own served-canary tuples.
    // A row carrying neither is DROPPED rather than guessed at: "this run deprecated that fact"
    // is a sentence a person acts on, and a neighbouring run's curation must never wear it.
    const observationIds = new Set(attributions.map((row) => row.observationId))
    const diff = await knowledgeRecordsDiffSpec.invoke(
      { sinceOrdinal: Math.max(0, document.buildOrdinal - 1) },
      deps,
    )
    const changes: RecordChange[] = diff.changes.filter((change) =>
      change.sourceRunId === runId
      || (change.observationId !== undefined && observationIds.has(change.observationId)))

    const digest = deps.proposalsInbox === undefined
      ? undefined
      : await runsDigestSpec.invoke({ runId: input.runId }, deps)

    return {
      kind: 'ready',
      runId,
      buildOrdinal: document.buildOrdinal,
      knowledgeStore: knowledgeStoreOf(evidence),
      ...(runRung === undefined ? {} : { retrievalRung: runRung }),
      steps,
      curation: {
        // `undefined` answers exactly as an empty chain does — nothing was enqueued for this run
        // — which is what a host with no queue database can honestly say (388's own note).
        status: status?.chips.curation ?? projectPostProcessingChips(undefined).curation,
        ...(countsPresent && curationRow !== undefined
          ? {
              counts: {
                curated: curationRow.curated as number,
                deprecated: curationRow.deprecated as number,
              },
            }
          : {}),
      },
      learned: { changes, canaryAttributions },
      ...(digest === undefined ? {} : { pendingProposalCount: digest.pendingProposalCount }),
    }
  },
}
