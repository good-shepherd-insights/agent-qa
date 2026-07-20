import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { HANDOFF_FILE, loadCompletedRunHandoff } from '@vostride/agent-qa-runner-local'
import {
  asRecordId,
  asRef,
  asRunId,
  normalizeAnchor,
  type Anchor,
  type CompletedRunHandoff,
  type ElementInfo,
  type PerTestOutcome,
  type ScreenState,
  type StepEvidence,
  type StepPlanSource,
  type SubActionEvidence,
  type Verdict,
} from '@vostride/agent-qa-schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const lookupSpy = vi.hoisted(() => ({
  anchorsById: new Map<string, Anchor[]>(),
  invalidById: new Map<string, string>(),
  openCalls: [] as string[],
}))

vi.mock('@vostride/agent-qa-knowledge-local', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@vostride/agent-qa-knowledge-local')
  >()
  return {
    ...actual,
    readCanonicalBundleAnchors: vi.fn((input: { knowledgeRoot: string; bundleId: string }) => {
      lookupSpy.openCalls.push(input.knowledgeRoot)
      const invalid = lookupSpy.invalidById.get(input.bundleId)
      if (invalid !== undefined) {
        return { kind: 'unresolved' as const, reason: 'invalid' as const, detail: invalid }
      }
      const anchors = lookupSpy.anchorsById.get(input.bundleId)
      return anchors === undefined
        ? { kind: 'unresolved' as const, reason: 'not-found' as const }
        : {
            kind: 'resolved' as const,
            bundleId: asRecordId(input.bundleId),
            product: 'storefront',
            anchors,
          }
    }),
  }
})

import {
  emitCanaryOutcomes,
  projectCanaryOutcomes,
} from '../emit-canary-outcomes.js'

const CANDIDATE = asRecordId('candidate-checkout')
const OTHER_CANDIDATE = asRecordId('candidate-other')
const PROCEDURE = asRecordId('procedure-sign-in')
const PROCEDURE_ANCHORS: Anchor[] = [
  { t: 'flow', name: 'Sign in flow' },
  { t: 'page', route: '/login' },
]

type GuardMissReason = NonNullable<
  Extract<StepPlanSource, { kind: 'procedure-replay' }>['guard']['miss']
>['reason']

function replaySource(miss?: GuardMissReason): StepPlanSource {
  return {
    kind: 'procedure-replay',
    procedureId: PROCEDURE,
    guard: {
      checksPassed: miss === undefined ? 3 : 1,
      total: 3,
      ...(miss === undefined
        ? {}
        : { miss: { procedureStepIndex: 1, reason: miss } }),
    },
  }
}

function replayExecutionFailureSource(procedureStepIndex = 0): StepPlanSource {
  return {
    kind: 'procedure-replay',
    procedureId: PROCEDURE,
    guard: {
      checksPassed: 0,
      total: 3,
      executionFailure: { procedureStepIndex },
    },
  }
}

function replayVerifierRejectionSource(procedureStepIndex = 0): StepPlanSource {
  return {
    kind: 'procedure-replay',
    procedureId: PROCEDURE,
    guard: {
      checksPassed: procedureStepIndex + 1,
      total: 3,
      verifierRejection: { procedureStepIndex },
    },
  }
}

function replayIncompleteSource(checksPassed = 1): StepPlanSource {
  return {
    kind: 'procedure-replay',
    procedureId: PROCEDURE,
    guard: { checksPassed, total: 3 },
  }
}

function element(ref = 'checkout'): ElementInfo {
  return {
    ref: asRef(ref),
    role: 'button',
    name: 'Checkout',
    nameNormalized: 'checkout',
    bounds: { x: 10, y: 20, width: 100, height: 40 },
    center: { x: 60, y: 40 },
    state: { enabled: true, focused: false, visible: true, clickable: true },
    labels: { ariaLabel: 'Checkout' },
    attributes: { 'data-testid': ref },
  }
}

function screen(elements: ElementInfo[], url?: string): ScreenState {
  return {
    platform: 'web',
    tree: elements.map((entry) => `${entry.role} ${entry.name}`).join('\n'),
    elements,
    refMap: Object.fromEntries(elements.map((entry) => [entry.ref, {
      bounds: entry.bounds!,
      center: entry.center!,
    }])),
    ...(url === undefined ? {} : { url }),
    timestamp: 1_750_000_000_000,
    metadata: {
      captureMode: 'textOnly',
      coordSpace: 'viewport',
      viewportWidth: 1_280,
      viewportHeight: 720,
      scroll: {
        offsetX: 0,
        offsetY: 0,
        contentWidth: 1_280,
        contentHeight: 1_440,
      },
    },
  }
}

function subAction(input: {
  ref?: string
  beforeUrl?: string
  afterUrl?: string
} = {}): SubActionEvidence {
  const elements = input.ref === undefined ? [] : [element(input.ref)]
  return {
    plan: input.ref === undefined ? 'Navigate' : `Use ${input.ref}`,
    plannedAction: input.ref === undefined
      ? { type: 'navigate', to: 'reload' }
      : { type: 'click', ref: asRef(input.ref) },
    stateBefore: screen(elements, input.beforeUrl),
    stateAfter: screen(elements, input.afterUrl ?? input.beforeUrl),
    result: { success: true },
  }
}

function step(input: {
  stepIndex?: number
  pass?: boolean
  candidateIds?: readonly string[]
  subActions?: SubActionEvidence[]
  planSource?: StepPlanSource
} = {}): StepEvidence {
  const stepIndex = input.stepIndex ?? 0
  return {
    ...(input.planSource === undefined ? {} : { planSource: input.planSource }),
    stepIndex,
    stepText: `Step ${stepIndex}`,
    cacheStatus: 'miss',
    servedBrief: {
      scope: { tier: 'product', key: 'storefront' },
      asOfBuild: 42,
      budget: 1_000,
      truncation: 'none',
      channel1: (input.candidateIds ?? [CANDIDATE]).map((id) => ({
        id: asRecordId(id),
        kind: 'fact',
        summary: `Canary ${id}`,
        trust: 0.2,
        status: 'candidate',
        servedAsCanary: true,
        tier: 'L2',
      })),
      channel2: [],
      channel3: [],
      briefDigest: `brief-digest-${stepIndex}`,
    },
    subActions: input.subActions ?? [subAction({ ref: 'checkout', beforeUrl: '/cart' })],
    verifierVerdict: {
      pass: input.pass ?? true,
      reasoning: input.pass === false ? 'Checkout did not open' : 'Checkout opened',
    },
  }
}

function rootCause(kind: Verdict['class']): Verdict {
  return {
    class: kind,
    producer: 'deterministic-classifier',
    confidence: 1,
    evidence: {
      citedSteps: [0],
      citedAnchors: [{ t: 'flow', name: 'checkout' }],
      citedArtifacts: [],
      rationale: `${kind} failure`,
    },
    memoryMisdirectionRuledOut: true,
    perTest: 0,
  }
}

function handoff(steps: StepEvidence[], cause?: Verdict): CompletedRunHandoff {
  const aggregateVerdict = steps.every((entry) => entry.verifierVerdict.pass)
    ? 'passed'
    : 'failed'
  const test: PerTestOutcome = {
    testId: 'checkout::happy-path',
    testName: 'Checkout happy path',
    filePath: 'checkout.spec.yaml',
    testIndex: 0,
    outcome: aggregateVerdict,
    steps,
    ...(cause === undefined ? {} : { rootCause: cause }),
  }
  return {
    schemaVersion: 3,
    runId: asRunId('run-canary-1'),
    scope: { tier: 'product', key: 'storefront' },
    buildOrdinal: 42,
    executionContext: 'local-interactive',
    aggregateVerdict,
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1_750_000_000_000,
    endedAt: 1_750_000_001_000,
    tests: [test],
  }
}

function project(
  input: CompletedRunHandoff,
  anchorsById: ReadonlyMap<string, Anchor[]>,
) {
  return projectCanaryOutcomes({
    handoff: input,
    resolveCandidateAnchors: (id) => {
      const anchors = anchorsById.get(id)
      return anchors === undefined
        ? { kind: 'unresolved', reason: 'not-found' }
        : { kind: 'resolved', anchors }
    },
  })
}

describe('projectCanaryOutcomes (PROM-02/D-21)', () => {
  it('attributes a normalized resolved-element contact to one positive step outcome', () => {
    const outcomes = project(handoff([step()]), new Map([[CANDIDATE, [{
      t: 'el',
      role: ' Button ',
      name: ' CHECKOUT ',
      ordinal: 0,
    }]]]))

    expect(outcomes).toEqual([{
      candidateId: CANDIDATE,
      runOutcome: 'positive',
      runId: 'run-canary-1',
      testId: 'checkout::happy-path',
      testIndex: 0,
      buildOrdinal: 42,
      stepIndex: 0,
      briefDigest: 'brief-digest-0',
      attribution: expect.stringContaining('candidate-checkout'),
      exercisedAnchor: { t: 'el', role: 'button', name: 'checkout', ordinal: 0 },
    }])
  })

  it('produces no outcome when a served canary never contacts a matching anchor', () => {
    const outcomes = project(handoff([step()]), new Map([[CANDIDATE, [{
      t: 'el',
      role: 'button',
      name: 'place order',
      ordinal: 0,
    }]]]))

    expect(outcomes).toEqual([])
  })

  it('uses the live grounding resolution instead of a stale planned ref', () => {
    const grounded = subAction({ ref: 'stale', beforeUrl: '/cart' })
    grounded.stateBefore = screen([element('checkout'), element('stale')], '/cart')
    grounded.grounding = {
      descriptor: { role: 'button', name: 'Checkout' },
      attempts: [{ stage: 'tree-search', outcome: 'resolved', resolvedRef: asRef('checkout') }],
    }
    const outcomes = project(
      handoff([step({ subActions: [grounded] })]),
      new Map([[CANDIDATE, [{
        t: 'el',
        role: 'button',
        name: 'checkout',
        ordinal: 0,
      }]]]),
    )

    expect(outcomes).toEqual([
      expect.objectContaining({
        candidateId: CANDIDATE,
        exercisedAnchor: { t: 'el', role: 'button', name: 'checkout', ordinal: 0 },
      }),
    ])
  })

  it('excludes environment, timeout, and flake failures but attributes other failures', () => {
    const candidateAnchors = new Map([[CANDIDATE, [{
      t: 'el' as const,
      role: 'button',
      name: 'checkout',
      ordinal: 0,
    }]]])

    for (const excluded of ['environment', 'timeout', 'flake'] as const) {
      expect(project(handoff([step({ pass: false })], rootCause(excluded)), candidateAnchors))
        .toEqual([])
    }

    for (const cause of [undefined, rootCause('app_bug')]) {
      const outcomes = project(handoff([step({ pass: false })], cause), candidateAnchors)
      expect(outcomes).toEqual([
        expect.objectContaining({ candidateId: CANDIDATE, runOutcome: 'negative' }),
      ])
    }
  })

  it('attributes a candidate whose page anchor matches the classified route', () => {
    const routeStep = step({
      subActions: [subAction({ beforeUrl: '/cart', afterUrl: '/Checkout/?Mode=FAST#receipt' })],
    })
    const outcomes = project(handoff([routeStep]), new Map([[CANDIDATE, [{
      t: 'page',
      route: ' /checkout/?mode=fast ',
    }]]]))

    expect(outcomes).toEqual([
      expect.objectContaining({
        runOutcome: 'positive',
        exercisedAnchor: { t: 'page', route: '/checkout?mode=fast' },
      }),
    ])
  })

  it('is byte-deterministic and emits once per candidate and exercised step', () => {
    const firstStep = step({
      stepIndex: 0,
      candidateIds: [CANDIDATE, CANDIDATE],
    })
    const secondStep = step({ stepIndex: 1 })
    const input = handoff([firstStep, secondStep])
    const anchors = new Map([[CANDIDATE, [{
      t: 'el' as const,
      role: 'button',
      name: 'checkout',
      ordinal: 0,
    }]]])

    const first = project(input, anchors)
    const second = project(input, anchors)

    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(first).toHaveLength(2)
    expect(first.map((outcome) => outcome.stepIndex)).toEqual([0, 1])
  })

  it('keeps same-index steps from different tests independently attributable', () => {
    const input = handoff([step({ stepIndex: 0 })])
    input.aggregateVerdict = 'failed'
    input.tests.push({
      testId: 'checkout::declined-card',
      testName: 'Checkout with a declined card',
      filePath: 'checkout.spec.yaml',
      testIndex: 1,
      outcome: 'failed',
      steps: [step({ stepIndex: 0, pass: false })],
    })
    const outcomes = project(input, new Map([[CANDIDATE, [{
      t: 'el',
      role: 'button',
      name: 'checkout',
      ordinal: 0,
    }]]]))

    expect(outcomes).toEqual([
      expect.objectContaining({
        testId: 'checkout::happy-path',
        testIndex: 0,
        stepIndex: 0,
        runOutcome: 'positive',
      }),
      expect.objectContaining({
        testId: 'checkout::declined-card',
        testIndex: 1,
        stepIndex: 0,
        runOutcome: 'negative',
      }),
    ])
    expect(outcomes[0]?.attribution).toContain('test 0 (checkout::happy-path) step 0')
    expect(outcomes[1]?.attribution).toContain('test 1 (checkout::declined-card) step 0')
  })
})

describe('emitCanaryOutcomes', () => {
  beforeEach(() => {
    lookupSpy.anchorsById.clear()
    lookupSpy.invalidById.clear()
    lookupSpy.openCalls.length = 0
  })

  it('resolves stored anchors and isolates a failed emit from the remaining projections', () => {
    lookupSpy.anchorsById.set(CANDIDATE, [{
      t: 'el',
      role: 'button',
      name: 'checkout',
      ordinal: 0,
    }])
    const emitted: number[] = []
    const input = handoff([step({ stepIndex: 0 }), step({ stepIndex: 1 })])

    const report = emitCanaryOutcomes({
      handoff: input,
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      runDir: '/tmp/runs/run-canary-1',
      emit(outcome) {
        if (outcome.stepIndex === 0) throw new Error('simulated queue failure')
        emitted.push(outcome.stepIndex)
      },
    })

    expect(lookupSpy.openCalls).toEqual([
      '/tmp/agent-qa-knowledge',
    ])
    expect(emitted).toEqual([1])
    expect(report).toEqual({
      emitted: 1,
      refused: 1,
      unresolved: 0,
      procedure: { emitted: 0, refused: 0, unresolved: 0 },
      details: [
        {
          candidateId: CANDIDATE,
          testId: 'checkout::happy-path',
          testIndex: 0,
          stepIndex: 0,
          outcome: { kind: 'refused', reason: 'emit-error' },
        },
        {
          candidateId: CANDIDATE,
          testId: 'checkout::happy-path',
          testIndex: 0,
          stepIndex: 1,
          outcome: { kind: 'emitted' },
        },
      ],
    })
  })

  it('guards both host paths before opening the reader', () => {
    const input = handoff([step()])
    const base = {
      handoff: input,
      emit: vi.fn(),
    }

    expect(() => emitCanaryOutcomes({
      ...base,
      knowledgeRoot: 'relative-knowledge',
      runDir: '/tmp/runs/run-canary-1',
    })).toThrow(new TypeError('knowledgeRoot must be absolute'))
    expect(() => emitCanaryOutcomes({
      ...base,
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      runDir: 'relative-run',
    })).toThrow(new TypeError('runDir must be absolute'))
    expect(lookupSpy.openCalls).toEqual([])
  })

  it.each([
    ['missing', 'not-found', undefined],
    ['corrupt', 'invalid', 'record.md: content hash mismatch'],
  ] as const)(
    'reports a %s served record as unresolved instead of certifying a zero/zero success',
    (_condition, reason, detail) => {
      if (detail !== undefined) lookupSpy.invalidById.set(OTHER_CANDIDATE, detail)
      const report = emitCanaryOutcomes({
        handoff: handoff([step({ candidateIds: [OTHER_CANDIDATE] })]),
        knowledgeRoot: '/tmp/agent-qa-knowledge',
        runDir: '/tmp/runs/run-canary-1',
        emit: vi.fn(),
      })

      expect(report).toEqual({
        emitted: 0,
        refused: 0,
        unresolved: 1,
        procedure: { emitted: 0, refused: 0, unresolved: 0 },
        details: [{
          candidateId: OTHER_CANDIDATE,
          testId: 'checkout::happy-path',
          testIndex: 0,
          stepIndex: 0,
          outcome: {
            kind: 'unresolved',
            reason,
            ...(detail === undefined ? {} : { detail }),
          },
        }],
      })
    },
  )
})

describe('projectCanaryOutcomes planSource attribution (PROC-02/D-11/D-12)', () => {
  const procedureAnchors = new Map([[PROCEDURE, PROCEDURE_ANCHORS]])

  it('projects a positive procedure outcome for a verified-PASS replayed step', () => {
    const outcomes = project(
      handoff([step({ candidateIds: [], planSource: replaySource() })]),
      procedureAnchors,
    )

    expect(outcomes).toEqual([{
      candidateId: PROCEDURE,
      runOutcome: 'positive',
      runId: 'run-canary-1',
      testId: 'checkout::happy-path',
      testIndex: 0,
      buildOrdinal: 42,
      stepIndex: 0,
      briefDigest: 'brief-digest-0',
      attribution: expect.stringContaining('procedure-sign-in'),
      exercisedAnchor: normalizeAnchor({ t: 'flow', name: 'Sign in flow' }),
    }])
  })

  it('projects only a positive procedure outcome for a clean navigating replay', () => {
    // Contract pin: navigation in the completed evidence is not a staleness signal when the
    // pre-action replay guard passed cleanly.
    const navigating = subAction({
      ref: 'checkout',
      beforeUrl: '/login',
      afterUrl: '/dashboard',
    })
    expect(navigating.stateAfter?.url).not.toBe(navigating.stateBefore.url)

    const outcomes = project(
      handoff([step({
        candidateIds: [],
        planSource: replaySource(),
        subActions: [navigating],
      })]),
      procedureAnchors,
    )

    expect(outcomes.filter(({ runOutcome }) => runOutcome === 'positive')).toHaveLength(1)
    expect(outcomes.filter(({ runOutcome }) => runOutcome === 'negative')).toHaveLength(0)
    expect(outcomes).toEqual([
      expect.objectContaining({
        candidateId: PROCEDURE,
        runOutcome: 'positive',
      }),
    ])
  })

  it('never projects a positive procedure outcome after replay execution failed', () => {
    const outcomes = project(
      handoff([step({
        candidateIds: [],
        pass: true,
        planSource: replayExecutionFailureSource(),
      })]),
      procedureAnchors,
    )

    expect(outcomes.filter(({ runOutcome }) => runOutcome === 'positive')).toHaveLength(0)
    expect(outcomes).toEqual([
      expect.objectContaining({ candidateId: PROCEDURE, runOutcome: 'negative' }),
    ])
  })

  it('projects an execution-failed replay as negative for an attributable failed run', () => {
    const outcomes = project(
      handoff(
        [step({
          candidateIds: [],
          pass: false,
          planSource: replayExecutionFailureSource(),
        })],
        rootCause('app_bug'),
      ),
      procedureAnchors,
    )

    expect(outcomes).toEqual([
      expect.objectContaining({ candidateId: PROCEDURE, runOutcome: 'negative' }),
    ])
  })

  it('keeps execution-failed replays behind the non-attributable classifier gate', () => {
    for (const excluded of ['environment', 'timeout', 'flake'] as const) {
      expect(project(
        handoff(
          [step({
            candidateIds: [],
            pass: false,
            planSource: replayExecutionFailureSource(),
          })],
          rootCause(excluded),
        ),
        procedureAnchors,
      )).toEqual([])
    }
  })

  it('attributes a verifier-rejected replay negatively even after live recovery passes', () => {
    const outcomes = project(
      handoff([step({
        candidateIds: [],
        pass: true,
        planSource: replayVerifierRejectionSource(),
      })]),
      procedureAnchors,
    )

    expect(outcomes).toEqual([
      expect.objectContaining({ candidateId: PROCEDURE, runOutcome: 'negative' }),
    ])
  })

  it('keeps verifier-rejected replays behind the non-attributable classifier gate', () => {
    for (const excluded of ['environment', 'timeout', 'flake'] as const) {
      expect(project(
        handoff(
          [step({
            candidateIds: [],
            pass: false,
            planSource: replayVerifierRejectionSource(),
          })],
          rootCause(excluded),
        ),
        procedureAnchors,
      )).toEqual([])
    }
  })

  it('does not certify a clean incomplete replay from a later passing verdict', () => {
    expect(project(
      handoff([step({
        candidateIds: [],
        pass: true,
        planSource: replayIncompleteSource(),
      })]),
      procedureAnchors,
    )).toEqual([])
  })

  it('keeps clean incomplete replay failures on the existing classifier path', () => {
    const outcomes = project(
      handoff(
        [step({
          candidateIds: [],
          pass: false,
          planSource: replayIncompleteSource(),
        })],
        rootCause('app_bug'),
      ),
      procedureAnchors,
    )

    expect(outcomes).toEqual([
      expect.objectContaining({ candidateId: PROCEDURE, runOutcome: 'negative' }),
    ])
  })

  it('gates failed replayed steps behind the shared root-cause classifier', () => {
    for (const excluded of ['environment', 'timeout', 'flake'] as const) {
      expect(project(
        handoff(
          [step({ candidateIds: [], pass: false, planSource: replaySource() })],
          rootCause(excluded),
        ),
        procedureAnchors,
      )).toEqual([])
    }

    const outcomes = project(
      handoff(
        [step({ candidateIds: [], pass: false, planSource: replaySource() })],
        rootCause('app_bug'),
      ),
      procedureAnchors,
    )
    expect(outcomes).toEqual([
      expect.objectContaining({ candidateId: PROCEDURE, runOutcome: 'negative' }),
    ])
  })

  it('attributes staleness guard misses as negatives even when the step passed via planning', () => {
    const reasons = [
      'descriptor-ambiguous',
      'descriptor-missing',
      'page-anchor-mismatch',
    ] as const
    for (const reason of reasons) {
      const outcomes = project(
        handoff([step({
          candidateIds: [],
          planSource: replaySource(reason),
          subActions: [subAction()],
        })]),
        procedureAnchors,
      )
      expect(outcomes).toEqual([
        expect.objectContaining({ candidateId: PROCEDURE, runOutcome: 'negative' }),
      ])
    }
  })

  it('never attributes policy-wall guard misses', () => {
    for (const reason of ['gate-refused', 'non-replayable-action'] as const) {
      expect(project(
        handoff([step({ candidateIds: [], planSource: replaySource(reason) })]),
        procedureAnchors,
      )).toEqual([])
    }
  })

  it('keeps the classifier gate over staleness misses on non-attributable failures', () => {
    for (const excluded of ['environment', 'timeout', 'flake'] as const) {
      expect(project(
        handoff(
          [step({
            candidateIds: [],
            pass: false,
            planSource: replaySource('descriptor-missing'),
          })],
          rootCause(excluded),
        ),
        procedureAnchors,
      )).toEqual([])
    }
  })

  it('projects channel1 and planSource outcomes independently from one step (Pin 1)', () => {
    const outcomes = project(
      handoff([step({ planSource: replaySource() })]),
      new Map<string, Anchor[]>([
        [CANDIDATE, [{ t: 'el', role: 'button', name: 'checkout', ordinal: 0 }]],
        [PROCEDURE, PROCEDURE_ANCHORS],
      ]),
    )

    expect(outcomes).toEqual([
      expect.objectContaining({
        candidateId: CANDIDATE,
        runOutcome: 'positive',
        exercisedAnchor: { t: 'el', role: 'button', name: 'checkout', ordinal: 0 },
      }),
      expect.objectContaining({
        candidateId: PROCEDURE,
        runOutcome: 'positive',
        exercisedAnchor: normalizeAnchor({ t: 'flow', name: 'Sign in flow' }),
      }),
    ])
  })

  it('records nothing for procedure-hint exposure', () => {
    expect(project(
      handoff([step({
        candidateIds: [],
        planSource: { kind: 'procedure-hint', procedureId: PROCEDURE },
      })]),
      procedureAnchors,
    )).toEqual([])
  })
})

/**
 * F-381-51-1 observation 3 (Plan 381-53, G-381-2 round 13): the FAILED round-12 rung-D
 * run r_meng-mater-con-seit-acle-lade-gor-craft-abies-extern still recorded a POSITIVE
 * `confirmed` canary event (buildOrdinal 31) because step 0's verifier passed before the
 * test died at step 1. The fixture is the VERBATIM handoff of that run (byte-identical
 * copy, digest-asserted below). The rows assert the DESIRED contract — positive
 * procedure-replay canaries adopt D-01's per-trajectory passing gate — so the
 * failed-test row is RED on the shipped build. Polarity pins P1-P5 pin what must NOT
 * change: per-step positives on passing tests (380 D-21), guard-earned negatives and
 * the root-cause classifier gate (D-11), the PROC-01 zero-replay empty projection, and
 * Pin 1 (served-brief) attribution.
 */
describe('F-381-51-1 obs 3: verdict-gated positive procedure canaries (381-53)', () => {
  const FIXTURE_PROCEDURE = asRecordId(
    'procedure-flow-t-posing-clock-inject-pill-adds-i-29ff61a3638ac355',
  )
  const FIXTURE_PAGE_FACT = asRecordId(
    'fact-page-http-127-0-0-1-8931-received-html-user-2a650b89fd403728',
  )
  const FIXTURE_EL_FACT = asRecordId('fact-el-textbox-username-20f5876cc5299c11')
  const FIXTURE_RECEIVED_URL =
    'http://127.0.0.1:8931/received.html?username=qa.user%2B381%40example.com'
  /**
   * sha-256 of the failed live run's handoff.json bytes at
   * demo/init/.agent-qa/runs/r_meng-mater-con-seit-acle-lade-gor-craft-abies-extern/,
   * computed at authoring time (the 381-49 fixture-fidelity discipline).
   */
  const FIXTURE_HANDOFF_SHA256 =
    '102c24ced726af7a561bf2474dc500a333dd562fe2ea7feba2836ae62f417c1c'

  const fixturePath = join(
    dirname(fileURLToPath(import.meta.url)),
    'fixtures',
    'f-381-51-1-run',
    HANDOFF_FILE,
  )

  function fixtureAnchors(): Map<string, Anchor[]> {
    return new Map<string, Anchor[]>([
      [FIXTURE_PROCEDURE, [{ t: 'flow', name: 'form::submit-username' }]],
      [FIXTURE_PAGE_FACT, [{ t: 'page', route: FIXTURE_RECEIVED_URL }]],
      [FIXTURE_EL_FACT, [{ t: 'el', role: 'textbox', name: 'username', ordinal: 0 }]],
    ])
  }

  it('fixture faithfulness: handoff bytes are the failed live run bytes', () => {
    const digest = createHash('sha256')
      .update(readFileSync(fixturePath))
      .digest('hex')
    expect(digest).toBe(FIXTURE_HANDOFF_SHA256)

    const fixture = loadCompletedRunHandoff(fixturePath)
    expect(fixture.aggregateVerdict).toBe('failed')
    expect(fixture.tests[0]?.outcome).toBe('failed')
    const stepZero = fixture.tests[0]?.steps[0]
    expect(stepZero?.verifierVerdict.pass).toBe(true)
    expect(stepZero?.planSource).toMatchObject({
      kind: 'procedure-replay',
      procedureId: FIXTURE_PROCEDURE,
      guard: { checksPassed: 2, total: 2 },
    })
  })

  it('a failed test projects no positive procedure canary from its verified-PASS replayed steps', () => {
    const fixture = loadCompletedRunHandoff(fixturePath)
    const outcomes = project(fixture, fixtureAnchors())

    const testsByIndex = new Map(fixture.tests.map((test) => [test.testIndex, test]))
    const positivesFromUnpassedTests = outcomes.filter((outcome) => {
      if (outcome.runOutcome !== 'positive') return false
      const test = testsByIndex.get(outcome.testIndex)
      const evidence = test?.steps.find((entry) => entry.stepIndex === outcome.stepIndex)
      return test?.outcome !== 'passed' && evidence?.planSource?.kind === 'procedure-replay'
    })
    expect(positivesFromUnpassedTests).toEqual([])
    // Suppression, never inversion (D-11): the withheld positive must not surface as a
    // negative either — the failed run contributes NOTHING to the confirmation counter.
    expect(outcomes.filter(({ candidateId }) => candidateId === FIXTURE_PROCEDURE))
      .toEqual([])
  })

  it('P1: a passing test keeps one positive per verified-PASS replayed step (380 D-21)', () => {
    const outcomes = project(
      handoff([
        step({ stepIndex: 0, candidateIds: [], planSource: replaySource() }),
        step({ stepIndex: 1, candidateIds: [], planSource: replaySource() }),
      ]),
      new Map([[PROCEDURE, PROCEDURE_ANCHORS]]),
    )

    expect(outcomes).toEqual([
      expect.objectContaining({
        candidateId: PROCEDURE,
        runOutcome: 'positive',
        stepIndex: 0,
      }),
      expect.objectContaining({
        candidateId: PROCEDURE,
        runOutcome: 'positive',
        stepIndex: 1,
      }),
    ])
  })

  it('P2: a staleness miss in a failed test still projects a negative (D-11)', () => {
    const outcomes = project(
      handoff(
        [step({
          candidateIds: [],
          pass: false,
          planSource: replaySource('descriptor-missing'),
        })],
        rootCause('app_bug'),
      ),
      new Map([[PROCEDURE, PROCEDURE_ANCHORS]]),
    )

    expect(outcomes).toEqual([
      expect.objectContaining({ candidateId: PROCEDURE, runOutcome: 'negative' }),
    ])
  })

  it('P3: the classifier gate keeps misses silent on non-attributable failures', () => {
    for (const excluded of ['environment', 'timeout', 'flake'] as const) {
      expect(project(
        handoff(
          [step({
            candidateIds: [],
            pass: false,
            planSource: replaySource('descriptor-missing'),
          })],
          rootCause(excluded),
        ),
        new Map([[PROCEDURE, PROCEDURE_ANCHORS]]),
      )).toEqual([])
    }
  })

  it('P4: zero procedure-replay steps project zero procedure attributions (PROC-01 empty edge)', () => {
    const outcomes = project(
      handoff([step({ stepIndex: 0 }), step({ stepIndex: 1, pass: false })]),
      new Map<string, Anchor[]>([
        [CANDIDATE, [{ t: 'el', role: 'button', name: 'checkout', ordinal: 0 }]],
        [PROCEDURE, PROCEDURE_ANCHORS],
      ]),
    )

    expect(outcomes.filter(({ candidateId }) => candidateId === PROCEDURE)).toEqual([])
    // Pin 1 stays verdict-ungated by construction: the served-brief lane keeps
    // attributing per-step outcomes even inside this failed test.
    expect(outcomes.filter(({ candidateId }) => candidateId === CANDIDATE))
      .toHaveLength(2)
  })

  it('P5: served-brief (Pin 1) attribution over the verbatim fixture keeps its exact counts', () => {
    const fixture = loadCompletedRunHandoff(fixturePath)
    const outcomes = project(fixture, fixtureAnchors())

    const briefOutcomes = outcomes.filter(
      ({ candidateId }) => candidateId !== FIXTURE_PROCEDURE,
    )
    // Step 0 serves no canaries (empty channel1); step 1 serves two, of which only the
    // page fact contacts an exercised anchor — one attributable negative, byte-unchanged.
    expect(briefOutcomes).toEqual([
      expect.objectContaining({
        candidateId: FIXTURE_PAGE_FACT,
        runOutcome: 'negative',
        testIndex: 0,
        stepIndex: 1,
      }),
    ])
  })
})

describe('emitCanaryOutcomes procedure counters', () => {
  beforeEach(() => {
    lookupSpy.anchorsById.clear()
    lookupSpy.invalidById.clear()
    lookupSpy.openCalls.length = 0
  })

  it('splits procedure-source counters beside the shared totals', () => {
    lookupSpy.anchorsById.set(CANDIDATE, [{
      t: 'el',
      role: 'button',
      name: 'checkout',
      ordinal: 0,
    }])
    lookupSpy.anchorsById.set(PROCEDURE, PROCEDURE_ANCHORS)

    const report = emitCanaryOutcomes({
      handoff: handoff([step({ planSource: replaySource() })]),
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      runDir: '/tmp/runs/run-canary-1',
      emit: vi.fn(),
    })

    expect(report.emitted).toBe(2)
    expect(report.procedure).toEqual({ emitted: 1, refused: 0, unresolved: 0 })
    expect(report.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidateId: PROCEDURE, outcome: { kind: 'emitted' } }),
    ]))
  })

  it('reports an unresolved procedure without certifying a zero/zero success', () => {
    const report = emitCanaryOutcomes({
      handoff: handoff([step({ candidateIds: [], planSource: replaySource() })]),
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      runDir: '/tmp/runs/run-canary-1',
      emit: vi.fn(),
    })

    expect(report).toEqual({
      emitted: 0,
      refused: 0,
      unresolved: 1,
      procedure: { emitted: 0, refused: 0, unresolved: 1 },
      details: [{
        candidateId: PROCEDURE,
        testId: 'checkout::happy-path',
        testIndex: 0,
        stepIndex: 0,
        outcome: { kind: 'unresolved', reason: 'not-found' },
      }],
    })
  })
})
