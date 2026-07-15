import {
  asRef,
  asRunId,
  type CompletedRunHandoff,
  type ElementInfo,
  type PerTestOutcome,
  type ScreenState,
  type StepEvidence,
  type SubActionEvidence,
  type Verdict,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import {
  LEARNABLE_CAUTION_ROOT_CAUSES,
  projectCurationCandidates,
} from '../curation/emit-candidates.js'

const ARTIFACT_SHA = 'a'.repeat(64)

function element(ref: string, name: string, attributes: Record<string, string> = {}): ElementInfo {
  return {
    ref: asRef(ref),
    role: 'button',
    name,
    nameNormalized: name.toLowerCase(),
    bounds: { x: 10, y: 20, width: 100, height: 40 },
    center: { x: 60, y: 40 },
    state: { enabled: true, focused: false, visible: true, clickable: true },
    labels: { ariaLabel: name },
    attributes,
  }
}

function screen(elements: ElementInfo[], url = 'https://shop.example/cart'): ScreenState {
  return {
    platform: 'web',
    tree: elements.map((entry) => `${entry.role} ${entry.name}`).join('\n'),
    elements,
    refMap: Object.fromEntries(
      elements.map((entry) => [
        entry.ref,
        { bounds: entry.bounds!, center: entry.center! },
      ]),
    ),
    url,
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

function subAction(
  elements: ElementInfo[],
  ref?: string,
  afterUrl = 'https://shop.example/cart',
): SubActionEvidence {
  const stateBefore = screen(elements)
  return {
    plan: ref === undefined ? 'Inspect the current page' : `Use ${ref}`,
    plannedAction:
      ref === undefined
        ? { type: 'navigate', to: 'reload' }
        : { type: 'click', ref: asRef(ref) },
    stateBefore,
    stateAfter: screen(elements, afterUrl),
    result: { success: true },
    artifactRefs: [{ id: `decision-screenshot:${ARTIFACT_SHA}`, sha: ARTIFACT_SHA }],
  }
}

function step(
  overrides: Partial<StepEvidence> = {},
  subActions: SubActionEvidence[] = [
    subAction([element('checkout', 'Checkout', { 'data-testid': 'checkout' })], 'checkout'),
  ],
): StepEvidence {
  return {
    stepIndex: 0,
    stepText: 'Open checkout',
    cacheStatus: 'miss',
    servedBrief: {
      scope: { tier: 'product', key: 'storefront' },
      asOfBuild: 42,
      budget: 1_000,
      truncation: 'none',
      channel1: [],
      channel2: [],
      channel3: [],
      briefDigest: 'brief-digest',
    },
    subActions,
    verifierVerdict: { pass: true, reasoning: 'Checkout opened' },
    ...overrides,
  }
}

function rootCause(kind: Verdict['class'], testIndex: number): Verdict {
  return {
    class: kind,
    producer: 'deterministic-classifier',
    confidence: 1,
    evidence: {
      citedSteps: [0],
      citedAnchors: [{ t: 'flow', name: `failure-${kind}` }],
      citedArtifacts: [],
      rationale: `${kind} failure`,
    },
    memoryMisdirectionRuledOut: true,
    perTest: testIndex,
  }
}

function testOutcome(
  overrides: Partial<PerTestOutcome> = {},
  steps: StepEvidence[] = [step()],
): PerTestOutcome {
  return {
    testId: 'checkout::happy-path',
    testIndex: 0,
    outcome: 'passed',
    steps,
    ...overrides,
  }
}

function handoff(
  tests: PerTestOutcome[] = [testOutcome()],
  overrides: Partial<CompletedRunHandoff> = {},
): CompletedRunHandoff {
  return {
    schemaVersion: 3,
    runId: asRunId('run-emit-1'),
    scope: { tier: 'product', key: 'storefront' },
    buildOrdinal: 42,
    executionContext: 'local-interactive',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1_750_000_000_000,
    endedAt: 1_750_000_001_000,
    tests,
    ...overrides,
  }
}

describe('projectCurationCandidates (CUR-04/SAFE-01)', () => {
  it('projects one PASS-verified resolved element into a selector fact and observation', () => {
    const [candidate] = projectCurationCandidates(handoff())

    expect(candidate).toMatchObject({
      kind: 'fact',
      subtype: 'selector',
      executionContext: 'local-interactive',
      scope: { tier: 'product', key: 'storefront' },
      buildOrdinal: 42,
      secretFlagged: false,
      injectionFlagged: false,
      attributingObservationId: 'run-emit-1:test-0:step-0',
    })
    expect(candidate?.candidateId).toMatch(/^[0-9a-f]{64}$/)
    expect(candidate?.distilledObservations).toEqual([
      expect.objectContaining({
        step: { naturalKey: 'run-emit-1:test-0:step-0', ordinal: 0 },
        platform: 'web',
        test: { id: 'checkout::happy-path' },
        element: { naturalKey: 'button:checkout:0' },
        locator: { selector: '[data-testid="checkout"]' },
        observedAtOrdinal: 42,
      }),
    ])
  })

  it('enforces PASS plus exactly one resolved element for leaf facts', () => {
    const first = element('first', 'First')
    const second = element('second', 'Second')
    const zeroResolved = step({}, [subAction([first])])
    const multipleResolved = step({}, [
      subAction([first, second], 'first'),
      subAction([first, second], 'second'),
    ])
    const failed = step({ verifierVerdict: { pass: false, reasoning: 'Did not open' } })

    for (const candidateHandoff of [
      handoff([testOutcome({}, [zeroResolved])]),
      handoff([testOutcome({}, [multipleResolved])]),
      handoff([testOutcome({ outcome: 'failed' }, [failed])]),
    ]) {
      expect(projectCurationCandidates(candidateHandoff).filter((row) => row.kind === 'fact'))
        .toEqual([])
    }
  })

  it('projects verified reported and asserted values as measurement facts', () => {
    const reported = step(
      { reportedValue: { value: '187 ms' } },
      [subAction([], undefined)],
    )
    const asserted = step(
      {
        stepIndex: 1,
        stepText: 'Check the cart count',
        assertOutcome: {
          source: 'storage',
          op: 'equals',
          expected: '3',
          actual: '3',
          passed: true,
        },
      },
      [subAction([], undefined)],
    )

    const candidates = projectCurationCandidates(
      handoff([testOutcome({}, [reported, asserted])]),
    ).filter((row) => row.subtype === 'measurement')

    expect(candidates).toHaveLength(2)
    expect(candidates.map((row) => row.bodySeed)).toEqual([
      expect.stringContaining('187 ms'),
      expect.stringContaining('3'),
    ])
  })

  it('mints cautions only for the bounded deterministic root-cause classes', () => {
    expect(LEARNABLE_CAUTION_ROOT_CAUSES).toEqual(['environment', 'timeout', 'flake'])
    const learnable = LEARNABLE_CAUTION_ROOT_CAUSES.map((kind, index) =>
      testOutcome(
        {
          testId: `failure-${kind}`,
          testIndex: index,
          outcome: kind === 'flake' ? 'passed' : kind === 'timeout' ? 'timeout' : 'failed',
          rootCause: rootCause(kind, index),
        },
        [],
      ),
    )
    const cautionCandidates = projectCurationCandidates(handoff(learnable))
    expect(cautionCandidates).toHaveLength(3)
    expect(cautionCandidates.every((candidate) => candidate.kind === 'caution')).toBe(true)

    const unknownOnly = handoff([
      testOutcome(
        {
          outcome: 'failed',
          rootCause: rootCause('unknown', 0),
        },
        [],
      ),
    ])
    expect(projectCurationCandidates(unknownOnly)).toEqual([])
  })

  it('stamps handoff posture and bypass secrecy while remaining deeply deterministic', () => {
    const input = handoff(
      [testOutcome({}, [step({ cacheStatus: 'bypass' })])],
      { executionContext: 'ci' },
    )

    const first = projectCurationCandidates(input)
    const second = projectCurationCandidates(input)

    expect(second).toEqual(first)
    expect(first).not.toHaveLength(0)
    expect(first.every((candidate) => candidate.executionContext === 'ci')).toBe(true)
    expect(first.every((candidate) => candidate.secretFlagged)).toBe(true)
  })
})
