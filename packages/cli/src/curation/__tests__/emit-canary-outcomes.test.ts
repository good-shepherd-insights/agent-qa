import {
  asRecordId,
  asRef,
  asRunId,
  type Anchor,
  type CompletedRunHandoff,
  type ElementInfo,
  type PerTestOutcome,
  type ScreenState,
  type StepEvidence,
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
} = {}): StepEvidence {
  const stepIndex = input.stepIndex ?? 0
  return {
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
