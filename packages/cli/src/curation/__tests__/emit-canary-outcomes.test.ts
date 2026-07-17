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

const readerSpy = vi.hoisted(() => ({
  anchorsById: new Map<string, Anchor[]>(),
  openCalls: [] as string[],
}))

vi.mock('@vostride/agent-qa-knowledge-local', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@vostride/agent-qa-knowledge-local')
  >()
  return {
    ...actual,
    openKnowledgeReader: vi.fn((config: { knowledgeRoot: string }) => {
      readerSpy.openCalls.push(config.knowledgeRoot)
      return {
        read(id: string) {
          const anchors = readerSpy.anchorsById.get(id)
          if (anchors === undefined) throw new Error(`missing record: ${id}`)
          return {
            id: asRecordId(id),
            title: id,
            body: '',
            anchors,
            evidenceDigest: `digest:${id}`,
            relations: [],
          }
        },
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
  const test: PerTestOutcome = {
    testId: 'checkout::happy-path',
    testIndex: 0,
    outcome: steps.every((entry) => entry.verifierVerdict.pass) ? 'passed' : 'failed',
    steps,
    ...(cause === undefined ? {} : { rootCause: cause }),
  }
  return {
    schemaVersion: 3,
    runId: asRunId('run-canary-1'),
    scope: { tier: 'product', key: 'storefront' },
    buildOrdinal: 42,
    executionContext: 'local-interactive',
    aggregateVerdict: test.outcome,
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
    resolveCandidateAnchors: (id) => anchorsById.get(id),
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
})

describe('emitCanaryOutcomes', () => {
  beforeEach(() => {
    readerSpy.anchorsById.clear()
    readerSpy.openCalls.length = 0
  })

  it('resolves stored anchors and isolates a failed emit from the remaining projections', () => {
    readerSpy.anchorsById.set(CANDIDATE, [{
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

    expect(readerSpy.openCalls).toEqual(['/tmp/agent-qa-knowledge'])
    expect(emitted).toEqual([1])
    expect(report).toEqual({
      emitted: 1,
      refused: 1,
      details: [
        {
          candidateId: CANDIDATE,
          stepIndex: 0,
          outcome: { kind: 'refused', reason: 'emit-error' },
        },
        {
          candidateId: CANDIDATE,
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
    expect(readerSpy.openCalls).toEqual([])
  })

  it('does not move trust when a served record cannot be resolved from the store', () => {
    const report = emitCanaryOutcomes({
      handoff: handoff([step({ candidateIds: [OTHER_CANDIDATE] })]),
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      runDir: '/tmp/runs/run-canary-1',
      emit: vi.fn(),
    })

    expect(report).toEqual({ emitted: 0, refused: 0, details: [] })
  })
})
