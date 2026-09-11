// The circularity guard, switched ON at the one seam that authors a run's verdicts
// (Phase 422, plan 15 — D-17/D-18/D-19/D-20).
//
// Four plans built this seam against a producer that did not exist. 422-11 shipped the evidence
// contract with BOTH validator options defaulting fail-closed, 422-12 made the rows survive four
// persisted boundaries, 422-13 shipped the removal gate and 422-14 finally produced the rows —
// and every one of them recorded the same residual: no reader stamps a `Verdict.misdirectionRuledOut`
// block anywhere, so the gated arm is proven by the validator's own cells rather than by a live
// analyze-run round trip. This file is that round trip.
//
// THE RISKIEST EDIT IN THE PHASE IS TURNING A FAIL-CLOSED DEFAULT ON, so the transition is
// asserted in BOTH directions rather than only the new one:
//
//   - A run whose arbiter never ran (no `misdirectionEvidence` member on the handoff at all —
//     every run written before 422-14) must reach the validator with the HISTORICAL options and
//     leave with byte-identical verdicts. If turning the arm on moved a verdict for a run that
//     carries no evidence, that is a defect, not a feature.
//   - A run that DOES carry evidence must be validated against it: a held ledger keeps the
//     authored class, a flipped one refuses it, and an incomplete one refuses it too.
//
// THE ORDERING CLAIM IS MEASURED FROM INSIDE THE CALL, never after it. `validateAnalysisAgainstHandoff`
// is wrapped (delegating unchanged) so the cells can read the artifact and the options it was
// HANDED — a stamp applied after validation is invisible to any after-the-fact inspection of the
// persisted artifact, because the persisted artifact carries it either way. The second, independent
// interruption proof is the repair round-trip: the validator's reject reason for a stamped block
// ("the misdirection cross-check FLIPPED for …") and for an unstamped one ("no misdirectionRuledOut
// evidence accompanies the claim") are DIFFERENT sentences, and the author hands that sentence
// verbatim to the model. Reading it off the repair request is reading what the validator saw at the
// instant it decided.
//
// Nothing here makes a network call: the model is a scripted object, the handoff is synthetic, and
// the arbiter's rows are composed in the test. What is proven is the stamping, the ordering, the
// honest floor and the per-member independence — not that a real eval root returns the right
// cross-check, which stays Plans 24/25's proof.

import type {
  CompletedRunHandoff,
  Job,
  JobHandlerOutcome,
  MisdirectionRecordResult,
  PerTestOutcome,
  RunAnalysisArtifact,
  StepEvidence,
  Verdict,
} from '@vostride/agent-qa-schema'
import {
  asRecordId,
  canonicalJson,
  misdirectionSourceDigest,
  sha256hex,
  validateAnalysisAgainstHandoff,
} from '@vostride/agent-qa-schema'
import { deterministicVerdict } from '@vostride/agent-qa-runner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Observe the two-document boundary at the instant it decides. The wrapper delegates to the real
// validator unchanged — every other cell in this file therefore sees production behaviour — and the
// ordering cells read `mock.calls` for the artifact and options the validator was actually handed.
vi.mock('@vostride/agent-qa-schema', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vostride/agent-qa-schema')>()
  return { ...actual, validateAnalysisAgainstHandoff: vi.fn(actual.validateAnalysisAgainstHandoff) }
})

import { stampVerdictMisdirectionEvidence } from '../analyze-run-author.js'
import { createRealJobKindRegistry } from '../kinds.js'
import type { PostRunJobCapabilities } from '../kinds.js'
import type { JobHandlerContext } from '../kind-registry.js'
import type { JobModelRequest } from '../record-llm-authorship.js'
import { buildSyntheticHandoff } from './fixtures/synthetic-handoff.js'

const RUN_ID = 'run-422-15-misdirection'
const EVIDENCE_TEXT = 'Error: element "Submit" not found'
const ALPHA = asRecordId('rec-alpha')
const BETA = asRecordId('rec-beta')

// ---------------------------------------------------------------------------------------
// Fixtures: a handoff whose failing step actually SERVED low-trust memory.
//
// `buildSyntheticHandoff` mints an empty `channel1`, which is the right default for every
// pre-422 suite that uses it — a brief that served nothing puts nothing on the path and the
// gate never engages. These helpers put records on the path WITHOUT editing the shared
// fixture, so no sibling suite's bytes move.
// ---------------------------------------------------------------------------------------

interface ServedRecord {
  readonly id: ReturnType<typeof asRecordId>
  readonly status?: string
  readonly servedAsCanary?: boolean
}

function briefLinesOf(records: readonly ServedRecord[]) {
  return records.map((record) => ({
    id: record.id,
    kind: 'fact',
    summary: `served record ${String(record.id)}`,
    trust: 0.2,
    status: record.status ?? 'candidate',
    servedAsCanary: record.servedAsCanary ?? false,
    tier: 'L1',
  }))
}

/** Put `records` on ONE step of ONE member, leaving every other byte of the handoff alone. */
function withServedRecords(
  handoff: CompletedRunHandoff,
  sites: readonly { perTest: number; stepIndex: number; records: readonly ServedRecord[] }[],
): CompletedRunHandoff {
  const tests: PerTestOutcome[] = handoff.tests.map((test) => {
    const forTest = sites.filter((site) => site.perTest === test.testIndex)
    if (forTest.length === 0) return test
    const steps: StepEvidence[] = test.steps.map((step) => {
      const site = forTest.find((candidate) => candidate.stepIndex === step.stepIndex)
      if (site === undefined) return step
      return {
        ...step,
        servedBrief: { ...step.servedBrief, channel1: briefLinesOf(site.records) },
      }
    })
    return { ...test, steps }
  })
  return { ...handoff, tests }
}

/** One cross-check row, bound to THIS handoff's source identity (never its final digest). */
function rowFor(
  handoff: CompletedRunHandoff,
  overrides: Partial<MisdirectionRecordResult> = {},
): MisdirectionRecordResult {
  return {
    runId: String(handoff.runId),
    perTest: 0,
    stepIndex: 0,
    decisionOrdinal: 0,
    recordId: ALPHA,
    handoffBaseDigest: misdirectionSourceDigest(handoff),
    briefDigest: 'brief-digest',
    corpusDigest: 'corpus-digest',
    profileDigest: 'profile-digest',
    crossCheck: 'held',
    seedHonored: true,
    ...overrides,
  }
}

/** A handoff that published a sidecar — the 422-14 producer's output, as this job receives it. */
function withEvidence(
  handoff: CompletedRunHandoff,
  rows: (base: CompletedRunHandoff) => readonly MisdirectionRecordResult[],
): CompletedRunHandoff {
  return { ...handoff, misdirectionEvidence: [...rows(handoff)] }
}

function handoffDigestOf(handoff: CompletedRunHandoff): string {
  return sha256hex(canonicalJson(handoff))
}

// ---------------------------------------------------------------------------------------
// The harness: the REAL analyze-run handler, driven through the real registry.
// ---------------------------------------------------------------------------------------

interface AuthoredEntryOverrides {
  readonly [key: string]: unknown
}

function authoredEntry(testIndex: number, overrides: AuthoredEntryOverrides = {}) {
  return {
    testIndex,
    class: 'app_bug',
    confidence: 0.85,
    memoryMisdirectionRuledOut: true,
    citedSteps: [0],
    citedArtifacts: [],
    rationale: 'the submit control is gone from the checkout DOM',
    groundingQuote: { stepIndex: 0, quote: EVIDENCE_TEXT },
    discriminator: 'the same step passed on the previous build',
    nextAction: 'file the failure against the application with the quoted evidence',
    links: [],
    ...overrides,
  }
}

function outputOf(entries: readonly Record<string, unknown>[]): string {
  return JSON.stringify({ tests: entries })
}

interface HandlerRun {
  readonly outcome: JobHandlerOutcome
  readonly persisted: RunAnalysisArtifact | undefined
  readonly requests: readonly JobModelRequest[]
  readonly modelCalls: number
}

async function runAnalyzeRun(options: {
  readonly handoff: CompletedRunHandoff
  readonly outputs?: readonly string[]
  readonly capabilities?: Partial<PostRunJobCapabilities>
  readonly payload?: Record<string, unknown>
  readonly recordedValue?: unknown
}): Promise<HandlerRun> {
  const requests: JobModelRequest[] = []
  let modelCalls = 0
  let persisted: RunAnalysisArtifact | undefined

  const capabilities: PostRunJobCapabilities = {
    loadCompletedRunHandoff: () => options.handoff,
    curateRun: async () => ({ curated: 0, deprecated: 0, complete: true }),
    persistAnalysis: (artifact) => {
      persisted = artifact
    },
    ...options.capabilities,
  }

  const job = {
    id: 'job_analyze_misdirection',
    kind: 'analyze-run',
    status: 'queued',
    summary: 'fixture',
    attempts: 1,
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z',
  } as unknown as Job

  const context: JobHandlerContext = {
    job,
    payload: {
      runId: String(options.handoff.runId),
      handoffDigest: handoffDigestOf(options.handoff),
      handoffSchemaVersion: options.handoff.schemaVersion,
      executionContext: 'local-headless',
      ...(options.handoff.misdirectionEvidence === undefined
        ? {}
        : { misdirectionEvidence: options.handoff.misdirectionEvidence }),
      ...options.payload,
    },
    publishCheckpoint: async () => {},
    recordLlmAuthorship: (async (
      _checkpointId: string,
      author: (model: unknown) => Promise<unknown>,
    ) => {
      // The engine's memoization, emulated: a recorded value means the author is NEVER reached.
      if (options.recordedValue !== undefined) return options.recordedValue
      return author({
        modelId: 'scripted-author',
        async generate(request: JobModelRequest) {
          requests.push(request)
          const text = (options.outputs ?? [])[modelCalls]
          modelCalls += 1
          if (text === undefined) throw new Error(`no scripted output for call ${modelCalls}`)
          return { text }
        },
      })
    }) as unknown as JobHandlerContext['recordLlmAuthorship'],
  }

  const outcome = await createRealJobKindRegistry(capabilities)
    .require('analyze-run')
    .handler(context)
  return { outcome, persisted, requests, modelCalls }
}

function verdictOf(run: HandlerRun, perTest: number): Verdict {
  const verdict = run.persisted?.verdicts.find((candidate) => candidate.perTest === perTest)
  if (verdict === undefined) throw new Error(`no persisted verdict for member ${perTest}`)
  return verdict
}

beforeEach(() => {
  vi.mocked(validateAnalysisAgainstHandoff).mockClear()
})

// ---------------------------------------------------------------------------------------

describe('422-15 the arm switches on only for a run that carries evidence', () => {
  it('leaves a run whose arbiter NEVER RAN byte-identical, and validates it historically', async () => {
    // The transition cell. Every handoff written before 422-14 has NO `misdirectionEvidence`
    // member at all, and low-trust memory on the failing path is exactly the population the new
    // arm would move. It must not move: absence means the arbiter never ran, and a claim nobody
    // measured is not a claim this job may refuse.
    const handoff = withServedRecords(buildSyntheticHandoff({ failureCount: 1 }), [
      { perTest: 0, stepIndex: 0, records: [{ id: ALPHA }] },
    ])
    expect(handoff.misdirectionEvidence).toBeUndefined()

    const run = await runAnalyzeRun({ handoff, outputs: [outputOf([authoredEntry(0)])] })

    const verdict = verdictOf(run, 0)
    expect(verdict.class).toBe('app_bug')
    expect(verdict.producer).toBe('analyze-run')
    // Nothing stamped: no block, no declaration, no attribution.
    expect(verdict.misdirectionRuledOut).toBeUndefined()
    expect(verdict.memoryOnPath).toBeUndefined()
    // And the validator was handed the HISTORICAL posture, measured from inside the call.
    for (const call of vi.mocked(validateAnalysisAgainstHandoff).mock.calls) {
      expect(call[2]?.gatedProducerEvidence).not.toBe(true)
    }
  })

  it('validates a run that DOES carry evidence under the gated posture, with the block attached', async () => {
    const base = withServedRecords(buildSyntheticHandoff({ failureCount: 1 }), [
      { perTest: 0, stepIndex: 0, records: [{ id: ALPHA }] },
    ])
    const handoff = withEvidence(base, (self) => [rowFor(self, { crossCheck: 'held' })])

    const run = await runAnalyzeRun({ handoff, outputs: [outputOf([authoredEntry(0)])] })

    const verdict = verdictOf(run, 0)
    expect(verdict.class).toBe('app_bug')
    expect(verdict.misdirectionRuledOut?.crossCheck).toBe('held')
    expect(verdict.misdirectionRuledOut?.results.map((row) => row.recordId)).toEqual([ALPHA])
    expect(verdict.memoryOnPath).toEqual([{ recordId: ALPHA, trust: 'candidate' }])
    const gated = vi
      .mocked(validateAnalysisAgainstHandoff)
      .mock.calls.filter((call) => call[2]?.gatedProducerEvidence === true)
    expect(gated.length).toBeGreaterThan(0)
    expect(gated[0]?.[2]?.rootPosture).toBe('eval-root')
  })

  it('a run with evidence but NOTHING on the path keeps its authored class and stamps no block', async () => {
    // The producer leaves an absent sidecar for a run with nothing to check, but a run can also
    // carry rows for OTHER members. A member with no exposure has no claim to back.
    const base = buildSyntheticHandoff({ failureCount: 1 })
    const handoff = withEvidence(base, () => [])

    const run = await runAnalyzeRun({ handoff, outputs: [outputOf([authoredEntry(0)])] })

    const verdict = verdictOf(run, 0)
    expect(verdict.class).toBe('app_bug')
    expect(verdict.misdirectionRuledOut).toBeUndefined()
    expect(verdict.memoryOnPath).toBeUndefined()
  })
})

describe('422-15 the honest floor: a claim the evidence does not support is refused', () => {
  it('answers unknown with causal attribution when the cross-check FLIPPED, after ONE repair', async () => {
    const base = withServedRecords(buildSyntheticHandoff({ failureCount: 1 }), [
      { perTest: 0, stepIndex: 0, records: [{ id: ALPHA }] },
    ])
    const handoff = withEvidence(base, (self) => [rowFor(self, { crossCheck: 'flipped' })])
    // The model answers `environment` twice — a no-trust-change class, persistently. One
    // evidence-informed repair, then the floor.
    const persistent = outputOf([
      authoredEntry(0, { class: 'environment', rationale: 'the checkout host was unreachable' }),
    ])

    const run = await runAnalyzeRun({ handoff, outputs: [persistent, persistent] })

    expect(run.modelCalls).toBe(2)
    const verdict = verdictOf(run, 0)
    expect(verdict.class).toBe('unknown')
    // Causal attribution names the flipped record and nothing else.
    expect(verdict.attribution?.records).toEqual([ALPHA])
    // All exposure retained, whatever the cross-check said about it.
    expect(verdict.memoryOnPath).toEqual([{ recordId: ALPHA, trust: 'candidate' }])
    expect(verdict.misdirectionRuledOut?.crossCheck).toBe('flipped')
    expect(verdict.memoryMisdirectionRuledOut).toBe(false)
  })

  it('hands the repair the FLIP BY NAME — the stamp was on the artifact the validator saw', async () => {
    // The interruption proof. A validator handed an UNSTAMPED verdict rejects with "no
    // misdirectionRuledOut evidence accompanies the claim"; one handed the stamped verdict
    // rejects with "the misdirection cross-check FLIPPED for …". The author copies that reason
    // verbatim into the repair request, so reading it off the request is reading what the
    // validator decided at the instant it decided — not what the artifact looks like afterwards.
    const base = withServedRecords(buildSyntheticHandoff({ failureCount: 1 }), [
      { perTest: 0, stepIndex: 0, records: [{ id: ALPHA }] },
    ])
    const handoff = withEvidence(base, (self) => [rowFor(self, { crossCheck: 'flipped' })])
    const flake = outputOf([authoredEntry(0, { class: 'flake' })])

    const run = await runAnalyzeRun({ handoff, outputs: [flake, flake] })

    const repair = run.requests[1] as JobModelRequest
    expect(repair.prompt).toContain('FLIPPED')
    expect(repair.prompt).toContain(String(ALPHA))
    expect(repair.prompt).not.toContain('no misdirectionRuledOut evidence accompanies')
  })

  it('accepts the repair when the model moves to a trust-moving class', async () => {
    const base = withServedRecords(buildSyntheticHandoff({ failureCount: 1 }), [
      { perTest: 0, stepIndex: 0, records: [{ id: ALPHA }] },
    ])
    const handoff = withEvidence(base, (self) => [rowFor(self, { crossCheck: 'flipped' })])

    const run = await runAnalyzeRun({
      handoff,
      outputs: [
        outputOf([authoredEntry(0, { class: 'app_bug' })]),
        outputOf([authoredEntry(0, { class: 'test_bug' })]),
      ],
    })

    expect(run.modelCalls).toBe(2)
    const verdict = verdictOf(run, 0)
    // `test_bug` moves trust, so the circularity gate never applies to it.
    expect(verdict.class).toBe('test_bug')
    expect(verdict.producer).toBe('analyze-run')
  })

  it('refuses an INCOMPLETE ledger: a covered record beside an unchecked sibling is not held', async () => {
    const base = withServedRecords(buildSyntheticHandoff({ failureCount: 1 }), [
      { perTest: 0, stepIndex: 0, records: [{ id: ALPHA }, { id: BETA }] },
    ])
    // Only ALPHA was checked. BETA has no row at all.
    const handoff = withEvidence(base, (self) => [rowFor(self, { crossCheck: 'held' })])
    const output = outputOf([authoredEntry(0)])

    const run = await runAnalyzeRun({ handoff, outputs: [output, output] })

    const verdict = verdictOf(run, 0)
    expect(verdict.class).toBe('unknown')
    // Both exposures stay visible; BETA is disclosed, never accused.
    expect(verdict.memoryOnPath?.map((entry) => entry.recordId).sort()).toEqual([ALPHA, BETA])
    expect(verdict.attribution).toBeUndefined()
  })
})

describe('422-15 deterministic verdicts are guarded identically', () => {
  it('downgrades a DETERMINISTIC app_bug whose cross-check flipped, with attribution', async () => {
    // The deterministic classifier never reaches the author, so before this plan its verdict was
    // persisted unvalidated. A code-owned ledger that flipped refuses it exactly as it refuses an
    // authored one — otherwise the guard has a hole the size of the classifier.
    const appBug = deterministicVerdict('app_bug', 'HTTP 500 from the checkout API', [0], 0)
    const base = withServedRecords(
      buildSyntheticHandoff({ failureCount: 1, rootCauseFor: () => appBug }),
      [{ perTest: 0, stepIndex: 0, records: [{ id: ALPHA }] }],
    )
    const handoff = withEvidence(base, (self) => [rowFor(self, { crossCheck: 'flipped' })])

    // No unknown member, so the author is never invoked at all: zero model calls.
    const run = await runAnalyzeRun({ handoff, outputs: [] })

    expect(run.modelCalls).toBe(0)
    const verdict = verdictOf(run, 0)
    expect(verdict.class).toBe('unknown')
    expect(verdict.producer).toBe('deterministic-classifier')
    expect(verdict.attribution?.records).toEqual([ALPHA])
    expect(verdict.misdirectionRuledOut?.crossCheck).toBe('flipped')
  })

  it('keeps a DETERMINISTIC app_bug whose cross-check HELD, and stamps its backing', async () => {
    const appBug = deterministicVerdict('app_bug', 'HTTP 500 from the checkout API', [0], 0)
    const base = withServedRecords(
      buildSyntheticHandoff({ failureCount: 1, rootCauseFor: () => appBug }),
      [{ perTest: 0, stepIndex: 0, records: [{ id: ALPHA }] }],
    )
    const handoff = withEvidence(base, (self) => [rowFor(self, { crossCheck: 'held' })])

    const run = await runAnalyzeRun({ handoff, outputs: [] })

    const verdict = verdictOf(run, 0)
    expect(verdict.class).toBe('app_bug')
    expect(verdict.misdirectionRuledOut?.crossCheck).toBe('held')
    expect(verdict.memoryOnPath).toEqual([{ recordId: ALPHA, trust: 'candidate' }])
  })

  it('leaves a deterministic verdict with a PRE-EXISTING reject exactly where it was', async () => {
    // The arm must change behaviour ONLY where the gated posture differs from the historical one.
    // A deterministic verdict citing a step that does not exist is refused under BOTH postures, so
    // it is not this arm's business and is persisted exactly as it was before.
    const bad = deterministicVerdict('test_bug', 'the assertion never ran', [41], 0)
    const base = buildSyntheticHandoff({ failureCount: 1, rootCauseFor: () => bad })
    const handoff = withEvidence(base, () => [])

    const run = await runAnalyzeRun({ handoff, outputs: [] })

    const verdict = verdictOf(run, 0)
    expect(verdict.class).toBe('test_bug')
    expect(verdict.evidence.citedSteps).toEqual([41])
  })
})

describe('422-15 an authored copy can never become authority', () => {
  it('discards a model-declared memoryOnPath and stamps the recomputed set', async () => {
    const base = withServedRecords(buildSyntheticHandoff({ failureCount: 1 }), [
      { perTest: 0, stepIndex: 0, records: [{ id: ALPHA }] },
    ])
    const handoff = withEvidence(base, (self) => [rowFor(self, { crossCheck: 'held' })])
    // The model tries to name a set the briefs never recorded, and to ship its own ledger.
    const forged = outputOf([
      authoredEntry(0, {
        memoryOnPath: [{ recordId: 'rec-invented', trust: 'candidate' }],
        misdirectionRuledOut: { crossCheck: 'held', results: [] },
      }),
    ])

    const run = await runAnalyzeRun({ handoff, outputs: [forged] })

    const verdict = verdictOf(run, 0)
    expect(verdict.memoryOnPath).toEqual([{ recordId: ALPHA, trust: 'candidate' }])
    expect(verdict.misdirectionRuledOut?.results.map((row) => row.recordId)).toEqual([ALPHA])
  })

  it('replaces a forged block on the stamp itself — the guard is the function, not the wire', async () => {
    const base = withServedRecords(buildSyntheticHandoff({ failureCount: 1 }), [
      { perTest: 0, stepIndex: 0, records: [{ id: ALPHA }] },
    ])
    const rows = [rowFor(base, { crossCheck: 'flipped' })]
    const forged = {
      ...deterministicVerdict('app_bug', 'a signal', [0], 0),
      memoryOnPath: [{ recordId: BETA, trust: 'candidate' as const }],
      misdirectionRuledOut: { crossCheck: 'held' as const, results: [] },
    }

    const stamped = stampVerdictMisdirectionEvidence({
      verdict: forged,
      parts: undefined,
      test: base.tests[0],
      evidence: rows,
      rootPosture: 'eval-root',
    })

    expect(stamped.memoryOnPath).toEqual([{ recordId: ALPHA, trust: 'candidate' }])
    expect(stamped.misdirectionRuledOut?.crossCheck).toBe('flipped')
    expect(stamped.misdirectionRuledOut?.results).toEqual(rows)
  })

  it('is a NO-OP when the arbiter never ran, whatever the verdict declares', async () => {
    const base = withServedRecords(buildSyntheticHandoff({ failureCount: 1 }), [
      { perTest: 0, stepIndex: 0, records: [{ id: ALPHA }] },
    ])
    const verdict = deterministicVerdict('app_bug', 'a signal', [0], 0)

    const stamped = stampVerdictMisdirectionEvidence({
      verdict,
      parts: undefined,
      test: base.tests[0],
      evidence: undefined,
      rootPosture: 'eval-root',
    })

    expect(canonicalJson(stamped)).toBe(canonicalJson(verdict))
  })
})

describe('422-15 the stamped path is the validator’s path', () => {
  it('covers the ACTUAL failing step even when the author cited a clean neighbour', async () => {
    // 422-11 widened the gated step set to the real failing step through `failingStepOf`. The
    // stamp must use the SAME rule or the declaration it writes would disagree with the
    // recomputation the validator performs — and this cell measures that against the real
    // validator rather than restating the rule.
    const base = withServedRecords(
      buildSyntheticHandoff({ failureCount: 1, passingStepsBefore: 1 }),
      [{ perTest: 0, stepIndex: 1, records: [{ id: ALPHA }] }],
    )
    const handoff = withEvidence(base, (self) => [
      rowFor(self, { stepIndex: 1, crossCheck: 'held' }),
    ])
    // The author cites step 0 (the clean neighbour) and quotes it — never step 1.
    const cited = outputOf([
      authoredEntry(0, {
        citedSteps: [0],
        groundingQuote: { stepIndex: 0, quote: 'neighbor step 0' },
      }),
    ])

    const run = await runAnalyzeRun({ handoff, outputs: [cited] })

    const verdict = verdictOf(run, 0)
    expect(verdict.class).toBe('app_bug')
    expect(verdict.memoryOnPath).toEqual([{ recordId: ALPHA, trust: 'candidate' }])
    // The persisted artifact validates clean under the same gated posture it was stamped for.
    const artifact = run.persisted as RunAnalysisArtifact
    expect(
      validateAnalysisAgainstHandoff(artifact, handoff, {
        gatedProducerEvidence: true,
        rootPosture: 'eval-root',
      }),
    ).toEqual({ ok: true })
  })
})

describe('422-15 repair calls and token use are recorded once and capped', () => {
  it('never exceeds one evidence-informed repair, however persistent the answer', async () => {
    const base = withServedRecords(buildSyntheticHandoff({ failureCount: 1 }), [
      { perTest: 0, stepIndex: 0, records: [{ id: ALPHA }] },
    ])
    const handoff = withEvidence(base, (self) => [rowFor(self, { crossCheck: 'flipped' })])
    const persistent = outputOf([authoredEntry(0, { class: 'config_error' })])

    // THREE outputs scripted. A third call would consume one and still be refused; the cap has to
    // stop at two.
    const run = await runAnalyzeRun({
      handoff,
      outputs: [persistent, persistent, persistent],
    })

    expect(run.modelCalls).toBe(2)
    expect(verdictOf(run, 0).class).toBe('unknown')
  })

  it('spends NOTHING on a resumed attempt — the authorship checkpoint already holds the answer', async () => {
    // "Recorded once across the existing job retry path" is a property of control flow: a recorded
    // value means the author callback is never reached, so neither the repair nor the token spend
    // can happen a second time.
    const base = withServedRecords(buildSyntheticHandoff({ failureCount: 1 }), [
      { perTest: 0, stepIndex: 0, records: [{ id: ALPHA }] },
    ])
    const handoff = withEvidence(base, (self) => [rowFor(self, { crossCheck: 'flipped' })])

    const run = await runAnalyzeRun({
      handoff,
      outputs: [],
      recordedValue: { runId: String(handoff.runId), verdicts: [] },
    })

    expect(run.modelCalls).toBe(0)
    expect(run.persisted).toBeUndefined()
    expect(run.outcome.status).toBe('complete')
  })
})
