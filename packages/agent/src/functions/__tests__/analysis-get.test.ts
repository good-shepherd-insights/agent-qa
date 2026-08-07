// `analysis.get` — THE one producer of a run's analysis (Phase 389, D-10/D-11/D-14/D-15).
//
// Resolved verdicts, rendered sentences (live recurrence joins applied) and clusters, served
// through one op that every surface calls — plan 07's CLI print, M5's run page, 392's chat.
// Beside it, the `runs.get` rewire: the cheapest read lists class/producer/confidence through
// the SAME accessor and never renders a sentence (the cheapest-read law).
//
// Absence discipline throughout: an unbound analysis port refuses BY NAME; a bound port with
// no artifact on disk answers the handoff floor (honest parts, minted unknowns); a run with
// no failures answers empty lists. None of those is an error, because none of them is a lie.

import {
  canonicalJson,
  CURRENT_ANALYSIS_SCHEMA_VERSION,
  errorTextOf,
  exercisedAnchors,
  failingStepOf,
  failureFingerprint,
  FunctionScopeSchema,
  resolveRunVerdicts,
  slugBranch,
} from '@vostride/agent-qa-schema'
import type {
  AnalysisGetOutput,
  CompletedRunHandoff,
  FunctionCaller,
  RunAnalysisArtifact,
  RunDetail,
  Verdict,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { clusterVerdicts } from '../../analysis/cluster.js'
import type { RecurrenceProvider, RecurrenceQuery } from '../../analysis/render-sentence.js'
import { buildSyntheticHandoff } from '../../jobs/__tests__/fixtures/synthetic-handoff.js'
import { FunctionNotBoundError, invokeFunction } from '../invoke.js'
import { createFunctionRegistry } from '../registry.js'
import type { AnalysisArtifactReaderPort, FunctionDeps } from '../spec.js'
import { ANALYSIS_GET_FUNCTION_ID } from '../ops/analysis-get.js'
import { RUNS_GET_FUNCTION_ID } from '../ops/runs-get.js'

const CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'agent',
}

function upgradedAppBug(perTest: number): Verdict {
  return {
    class: 'app_bug',
    producer: 'analyze-run',
    confidence: 0.9,
    evidence: {
      citedSteps: [0],
      citedAnchors: [],
      citedArtifacts: [],
      rationale: 'the submit button never enabled after the cart update',
    },
    memoryMisdirectionRuledOut: true,
    perTest,
  }
}

function artifactFor(handoff: CompletedRunHandoff): RunAnalysisArtifact {
  return {
    schemaVersion: CURRENT_ANALYSIS_SCHEMA_VERSION,
    runId: String(handoff.runId),
    verdicts: [upgradedAppBug(0)],
    parts: [{
      perTest: 0,
      groundingQuote: { stepIndex: 0, quote: 'Error: element "Submit" not found' },
      discriminator: 'the submit button disappeared after the cart update',
      nextAction: 'file the failure against the application with the quoted evidence',
      links: ['agentqa://memory/MEM-001'],
    }],
  }
}

function deps(overrides: Partial<FunctionDeps> = {}): FunctionDeps {
  return {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }) =>
        Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId } as const),
    },
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    config: {
      getMasked: () => Promise.resolve({
        schemaVersion: 1,
        configPath: 'agent-qa.config.yaml',
        entries: [],
      }),
    },
    ...overrides,
  }
}

function registryWith(options: {
  handoff?: CompletedRunHandoff
  analysis?: AnalysisArtifactReaderPort
  recurrence?: RecurrenceProvider
}) {
  const { handoff } = options
  return createFunctionRegistry({
    deps: deps({
      runs: {
        list: () => Promise.resolve(handoff === undefined ? [] : [handoff]),
        get: (runId) => Promise.resolve(
          handoff !== undefined && String(runId) === String(handoff.runId)
            ? handoff
            : undefined,
        ),
        readEvents: () => Promise.resolve([]),
        readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
      },
      ...(options.analysis === undefined ? {} : { analysis: options.analysis }),
      ...(options.recurrence === undefined ? {} : { recurrence: options.recurrence }),
    }),
    resolveExecutionContext: () => 'local-headless',
    auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
  })
}

function readerOf(artifact: RunAnalysisArtifact | undefined): AnalysisArtifactReaderPort {
  return { getArtifact: () => artifact }
}

async function analysisOf(
  registry: ReturnType<typeof registryWith>,
  runId: string,
): Promise<AnalysisGetOutput> {
  return await invokeFunction(
    registry,
    ANALYSIS_GET_FUNCTION_ID,
    { runId },
    CALLER,
  ) as AnalysisGetOutput
}

describe('analysis.get — binding and refusal (D-09/D-11)', () => {
  it('lists unbound and refuses BY NAME in a composition with no analysis port', async () => {
    const handoff = buildSyntheticHandoff({ failureCount: 1 })
    const registry = registryWith({ handoff })

    expect(registry.list(CALLER).find((entry) => entry.id === ANALYSIS_GET_FUNCTION_ID))
      .toMatchObject({ requiredScopes: ['read'], resultKind: 'unary', bindingStatus: 'unbound' })

    const refusal = analysisOf(registry, String(handoff.runId))
    await expect(refusal).rejects.toBeInstanceOf(FunctionNotBoundError)
    await expect(refusal).rejects.toMatchObject({ functionId: ANALYSIS_GET_FUNCTION_ID })
  })

  it('throws the typed not-found refusal for a run nothing recorded', async () => {
    const registry = registryWith({ analysis: readerOf(undefined) })

    await expect(analysisOf(registry, 'run-never-happened')).rejects.toMatchObject({
      name: 'RunNotFoundError',
    })
  })
})

describe('analysis.get — the handoff floor (D-10)', () => {
  it('answers a bound port with NO artifact via the floor: minted unknowns, honest parts', async () => {
    const handoff = buildSyntheticHandoff({ failureCount: 2, passedCount: 1 })
    const registry = registryWith({ handoff, analysis: readerOf(undefined) })

    const output = await analysisOf(registry, String(handoff.runId))

    expect(output.runId).toBe(String(handoff.runId))
    expect(output.verdicts).toEqual([
      { perTest: 0, testId: 't_failed_0', class: 'unknown', producer: 'deterministic-classifier', confidence: 0 },
      { perTest: 1, testId: 't_failed_1', class: 'unknown', producer: 'deterministic-classifier', confidence: 0 },
    ])
    expect(output.sentences).toHaveLength(2)
    for (const entry of output.sentences) {
      expect(entry.sentence).toContain('root cause undetermined')
      // No recurrence dep bound: obligation c still renders, as the explicit no-history clause.
      expect(entry.sentence).toContain('no failure history is recorded for this test')
    }
    // One shared anchor, one class: the ANLZ-04 fold, with the representative's sentence.
    expect(output.clusters).toHaveLength(1)
    expect(output.clusters[0]!.count).toBe(2)
    expect(output.clusters[0]!.representative.sentence)
      .toBe(output.sentences.find((entry) => entry.perTest === 0)!.sentence)
  })

  it('answers a zero-failure run with empty sentences and clusters, never an error', async () => {
    const handoff = buildSyntheticHandoff({ failureCount: 0, passedCount: 2 })
    const registry = registryWith({ handoff, analysis: readerOf(undefined) })

    const output = await analysisOf(registry, String(handoff.runId))

    expect(output.verdicts).toEqual([])
    expect(output.sentences).toEqual([])
    expect(output.clusters).toEqual([])
  })
})

describe('analysis.get — the artifact leg and the one accessor (D-10/D-11)', () => {
  it('serves upgraded class/producer through BOTH ops, and sentences through ONE', async () => {
    const handoff = buildSyntheticHandoff({ failureCount: 1 })
    const artifact = artifactFor(handoff)
    const registry = registryWith({ handoff, analysis: readerOf(artifact) })

    const output = await analysisOf(registry, String(handoff.runId))
    expect(output.verdicts).toEqual([
      { perTest: 0, testId: 't_failed_0', class: 'app_bug', producer: 'analyze-run', confidence: 0.9 },
    ])
    expect(output.sentences[0]!.sentence)
      .toContain('the submit button disappeared after the cart update')
    expect(output.sentences[0]!.sentence).toContain('see: agentqa://memory/MEM-001')

    // The SAME upgrade is visible through runs.get — sourced from the same accessor…
    const detail = await invokeFunction(
      registry,
      RUNS_GET_FUNCTION_ID,
      { runId: String(handoff.runId) },
      CALLER,
    ) as RunDetail
    expect(detail.tests[0]!.rootCause).toMatchObject({
      class: 'app_bug',
      producer: 'analyze-run',
      confidence: 0.9,
    })
    // …and runs.get NEVER renders a sentence: the cheapest read stays the cheapest.
    const serialized = JSON.stringify(detail)
    expect(serialized).not.toContain('"sentence"')
    expect(serialized).not.toContain('observed (step')
  })

  it('joins recurrence LIVE through the optional dep, keyed the projection way', async () => {
    const handoff = buildSyntheticHandoff({ failureCount: 1 })
    const asked: RecurrenceQuery[] = []
    const recurrence: RecurrenceProvider = {
      failureRecurrence(query) {
        asked.push(query)
        return { kth: 3, windowBuilds: 5 }
      },
    }
    const registry = registryWith({
      handoff,
      analysis: readerOf(undefined),
      recurrence,
    })

    const output = await analysisOf(registry, String(handoff.runId))

    expect(output.sentences[0]!.sentence)
      .toContain('failure 3 of this test in the last 5 builds')
    // Identity is (product, filePath, testName) — the projection's own key, never testId —
    // and 390 D-07 adds the FINGERPRINT the recurrence windows are keyed by. Both travel:
    // the ladder join is identity-keyed, the occurrence count is fingerprint-keyed.
    expect(asked).toEqual([{
      product: slugBranch(handoff.scope.key),
      filePath: 'tests/failed-0.yaml',
      testName: 'stepped failure 0',
      fingerprint: failureFingerprint(
        {
          anchors: exercisedAnchors(failingStepOf(handoff.tests[0]!)!),
          errorText: errorTextOf(failingStepOf(handoff.tests[0]!), handoff.tests[0]!),
        },
        'unknown',
      ),
    }])
  })

  it('keys the fingerprint by the RESOLVED class — an upgraded verdict queries a different window', async () => {
    // The recipe folds the class in (389 D-13), so the same anchor failing as `unknown` and as
    // `app_bug` are two windows. The caller must therefore key from the resolved verdict, not
    // from the handoff's floor — which is exactly what the projection's writer does.
    const handoff = buildSyntheticHandoff({ failureCount: 1 })
    const asked: RecurrenceQuery[] = []
    const recurrence: RecurrenceProvider = {
      failureRecurrence(query) {
        asked.push(query)
        return { kth: 1, windowBuilds: 1 }
      },
    }
    const registry = registryWith({
      handoff,
      analysis: readerOf(artifactFor(handoff)),
      recurrence,
    })

    await analysisOf(registry, String(handoff.runId))

    expect(asked[0]!.fingerprint).toBe(
      failureFingerprint(
        {
          anchors: exercisedAnchors(failingStepOf(handoff.tests[0]!)!),
          errorText: errorTextOf(failingStepOf(handoff.tests[0]!), handoff.tests[0]!),
        },
        'app_bug',
      ),
    )
    // The floor's key is a DIFFERENT string — the control that makes the pin above load-bearing.
    expect(asked[0]!.fingerprint).not.toBe(
      failureFingerprint(
        {
          anchors: exercisedAnchors(failingStepOf(handoff.tests[0]!)!),
          errorText: errorTextOf(failingStepOf(handoff.tests[0]!), handoff.tests[0]!),
        },
        'unknown',
      ),
    )
  })

  it('queries a ZERO-STEP failure by identity with the fingerprint ABSENT — no fabricated key', async () => {
    // A member with no recorded steps has no failing step to key from. The query still goes out
    // (identity is enough for the per-test window and for the ladder join); the fingerprint leg
    // is OMITTED rather than filled with a stand-in, so `'fingerprint' in query` is false.
    const handoff = buildSyntheticHandoff({ failureCount: 0, steplessFailureCount: 1 })
    const asked: RecurrenceQuery[] = []
    const recurrence: RecurrenceProvider = {
      failureRecurrence(query) {
        asked.push(query)
        return undefined
      },
    }
    const registry = registryWith({ handoff, analysis: readerOf(undefined), recurrence })

    await analysisOf(registry, String(handoff.runId))

    expect(asked).toHaveLength(1)
    expect(asked[0]!.fingerprint).toBeUndefined()
    expect('fingerprint' in asked[0]!).toBe(false)
    expect(asked[0]).toMatchObject({
      product: slugBranch(handoff.scope.key),
      filePath: 'tests/stepless-0.yaml',
    })
  })

  it('returns clusters byte-identical to the pure fold — no re-derivation, no drift', async () => {
    const handoff = buildSyntheticHandoff({ failureCount: 5 })
    const registry = registryWith({ handoff, analysis: readerOf(undefined) })

    const first = await analysisOf(registry, String(handoff.runId))
    const second = await analysisOf(registry, String(handoff.runId))
    expect(canonicalJson(first)).toBe(canonicalJson(second))

    const pure = clusterVerdicts(resolveRunVerdicts(undefined, handoff), handoff)
    expect(first.clusters.map(({ fingerprint, count, members }) => ({ fingerprint, count, members })))
      .toEqual(pure.map(({ fingerprint, count, members }) => ({ fingerprint, count, members })))
    expect(first.clusters.map((cluster) => cluster.representative.testIndex))
      .toEqual(pure.map((cluster) => cluster.representative.testIndex))
  })
})
