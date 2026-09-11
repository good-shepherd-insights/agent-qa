// 422-16 (D-20): harm emitted from FLIPPED pre-analysis evidence, independently of the class.
//
// The circularity arbiter answers one question per exposure — "was this served record the reason
// the step failed?" — by REMOVING the record and replaying. A `flipped` row is that question
// answered yes: the removal changed the outcome, so the memory was causal. 422-15 made a flip
// decide the VERDICT. This file is about the other half: a flip must also move TRUST, by the same
// harmed-outcome writer every other negative canary observation already goes through.
//
// WHY "INDEPENDENTLY OF THE CLASS" IS THE WHOLE REQUIREMENT. The emitter's existing suppression
// (418 D-11) drops attribution for `environment` / `timeout` / `flake` members, because those
// failures do not damn the record that rode along. That rule is right for CONTACT evidence — an
// anchor match is a coincidence until something else explains it. It is wrong for CAUSAL evidence:
// a removal cross-check that flipped is a measurement of causation, and a class word — produced
// by a model, a deterministic classifier, or a BYOM run with no evaluation root — cannot outrank
// it. The cells below hold the evidence fixed and vary the class across all eight, plus both
// producers, and require the emitted consequence to be byte-identical.
//
// NO PROVIDER CALLS. Every ablation capability is a scripted object, every handoff is composed
// here, and the one store cell publishes a bundle into a temporary directory.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  VERDICT_CLASSES,
  asEvidenceToken,
  asRecordId,
  asRef,
  asRunId,
  misdirectionSourceDigest,
  survivingOutcomeEvents,
  type Anchor,
  type CanaryOutcome,
  type CompletedRunHandoff,
  type CrossCheck,
  type ElementInfo,
  type MisdirectionRecordResult,
  type PerTestOutcome,
  type ScreenState,
  type StepEvidence,
  type SubActionEvidence,
  type Verdict,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lookupSpy = vi.hoisted(() => ({ anchorsById: new Map<string, Anchor[]>() }))

vi.mock('@vostride/agent-qa-knowledge-local', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vostride/agent-qa-knowledge-local')>()
  return {
    ...actual,
    readCanonicalBundleAnchors: vi.fn((input: { knowledgeRoot: string; bundleId: string }) => {
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
  acquireWriterLease,
  createLocalKnowledgeStore,
  deriveBundleTrust,
  loadBundle,
  publishBundleForTest,
  readGateReceipts,
} from '@vostride/agent-qa-knowledge-local'

import { emitCanaryOutcomes, projectCanaryOutcomes } from '../emit-canary-outcomes.js'
import { saveCompletedMisdirectionCheck } from '../misdirection-run-state.js'

const CANDIDATE = 'candidate-checkout'
const SIBLING = 'candidate-sibling'
const ORDINARY = 'candidate-ordinary'
const CHECKOUT_ANCHOR: Anchor = { t: 'el', role: 'button', name: 'checkout', ordinal: 0 }
const UNRELATED_ANCHOR: Anchor = { t: 'page', route: '/never-visited' }

// -------------------------------------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------------------------------------

interface BriefLineInput {
  readonly id: string
  readonly status?: 'candidate' | 'active'
  readonly servedAsCanary?: boolean
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

function screen(elements: ElementInfo[]): ScreenState {
  return {
    platform: 'web',
    tree: elements.map((entry) => `${entry.role} ${entry.name}`).join('\n'),
    elements,
    refMap: Object.fromEntries(
      elements.map((entry) => [entry.ref, { bounds: entry.bounds!, center: entry.center! }]),
    ),
    url: '/cart',
    timestamp: 1_750_000_000_000,
    metadata: {
      captureMode: 'textOnly',
      coordSpace: 'viewport',
      viewportWidth: 1_280,
      viewportHeight: 720,
      scroll: { offsetX: 0, offsetY: 0, contentWidth: 1_280, contentHeight: 1_440 },
    },
  }
}

function subAction(): SubActionEvidence {
  const elements = [element()]
  return {
    plan: 'Use checkout',
    exchanges: [],
    plannedAction: { type: 'click', ref: asRef('checkout') },
    stateBefore: screen(elements),
    stateAfter: screen(elements),
    result: { success: true },
  }
}

function step(
  input: {
    stepIndex?: number
    pass?: boolean
    lines?: readonly BriefLineInput[]
    anchorless?: true
  } = {},
): StepEvidence {
  const stepIndex = input.stepIndex ?? 0
  const lines = input.lines ?? [{ id: CANDIDATE, status: 'candidate', servedAsCanary: true }]
  return {
    stepIndex,
    stepText: `Step ${stepIndex}`,
    cacheStatus: 'miss',
    servedBrief: {
      scope: { tier: 'product', key: 'storefront' },
      asOfBuild: 42,
      budget: 1_000,
      truncation: 'none',
      channel1: lines.map((line) => ({
        id: asRecordId(line.id),
        kind: 'fact' as const,
        summary: `Line ${line.id}`,
        trust: 0.2,
        status: line.status ?? 'candidate',
        servedAsCanary: line.servedAsCanary ?? false,
        tier: 'L2' as const,
      })),
      channel2: [],
      channel3: [],
      briefDigest: `brief-digest-${stepIndex}`,
    },
    subActions: input.anchorless === true ? [] : [subAction()],
    verifierVerdict: {
      pass: input.pass ?? false,
      reasoning: input.pass === false ? 'Checkout did not open' : 'Checkout opened',
    },
  }
}

function rootCause(
  kind: Verdict['class'],
  producer: Verdict['producer'] = 'deterministic-classifier',
  perTest = 0,
): Verdict {
  return {
    class: kind,
    producer,
    confidence: 1,
    evidence: {
      citedSteps: [0],
      citedAnchors: [{ t: 'flow', name: 'checkout' }],
      citedArtifacts: [],
      rationale: `${kind} failure`,
    },
    memoryMisdirectionRuledOut: true,
    perTest,
  }
}

function handoff(steps: StepEvidence[], cause?: Verdict): CompletedRunHandoff {
  const aggregateVerdict = steps.every((entry) => entry.verifierVerdict.pass) ? 'passed' : 'failed'
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
    runId: asRunId('run-misdirection-1'),
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

function evidenceRow(
  source: CompletedRunHandoff,
  input: {
    recordId?: string
    perTest?: number
    stepIndex?: number
    decisionOrdinal?: number
    crossCheck?: CrossCheck
    runId?: string
    handoffBaseDigest?: string
  } = {},
): MisdirectionRecordResult {
  const stepIndex = input.stepIndex ?? 0
  return {
    runId: input.runId ?? String(source.runId),
    perTest: input.perTest ?? 0,
    stepIndex,
    decisionOrdinal: input.decisionOrdinal ?? 0,
    recordId: asRecordId(input.recordId ?? CANDIDATE),
    handoffBaseDigest: input.handoffBaseDigest ?? misdirectionSourceDigest(source),
    briefDigest: `brief-digest-${stepIndex}`,
    corpusDigest: 'a'.repeat(64),
    profileDigest: 'b'.repeat(64),
    crossCheck: input.crossCheck ?? 'flipped',
    seedHonored: true,
    samples: { k: 3, seeds: [11, 12, 13], modelCalls: 3 },
  }
}

function withEvidence(
  source: CompletedRunHandoff,
  rows: readonly MisdirectionRecordResult[],
): CompletedRunHandoff {
  return { ...source, misdirectionEvidence: rows }
}

/** The pure projection, with anchors resolved from the per-cell table. */
function project(source: CompletedRunHandoff): CanaryOutcome[] {
  return projectCanaryOutcomes({
    handoff: source,
    resolveCandidateAnchors: (id) => {
      const anchors = lookupSpy.anchorsById.get(id)
      return anchors === undefined
        ? { kind: 'unresolved', reason: 'not-found' }
        : { kind: 'resolved', anchors }
    },
  })
}

/** A scripted eval root: one corpus digest, never a replay, never a provider call. */
function evalRoot(corpusDigest = 'c'.repeat(64)) {
  return {
    isNovel: vi.fn(async () => false),
    stage: vi.fn(async () => ({ kind: 'no-eval-root' as const })),
    ablate: vi.fn(async () => ({ kind: 'no-eval-root' as const })),
    corpusDigest: vi.fn(async () => ({ kind: 'digest' as const, corpusDigest })),
  }
}

// -------------------------------------------------------------------------------------------

describe('422-16 D-20 — flipped evidence emits harm independently of the class', () => {
  let runDir: string

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), 'agent-qa-422-16-harm-'))
    lookupSpy.anchorsById.clear()
    lookupSpy.anchorsById.set(CANDIDATE, [CHECKOUT_ANCHOR])
    lookupSpy.anchorsById.set(SIBLING, [CHECKOUT_ANCHOR])
    lookupSpy.anchorsById.set(ORDINARY, [UNRELATED_ANCHOR])
  })
  afterEach(() => rmSync(runDir, { recursive: true, force: true }))

  it('emits ONE identical harmed consequence for every one of the eight classes and both producers', async () => {
    const emissions: CanaryOutcome[][] = []
    for (const verdictClass of VERDICT_CLASSES) {
      for (const producer of ['deterministic-classifier', 'analyze-run'] as const) {
        const base = handoff([step({ pass: false })], rootCause(verdictClass, producer))
        const input = withEvidence(base, [evidenceRow(base)])
        const emit = vi.fn()
        const report = await emitCanaryOutcomes({
          handoff: input,
          knowledgeRoot: '/tmp/agent-qa-knowledge',
          runDir,
          emit,
          credit: { maxAblations: 1, ablation: evalRoot() },
        })
        expect(report.emitted, `${verdictClass}/${producer} emitted`).toBe(1)
        expect(report.refused).toBe(0)
        expect(report.unresolved).toBe(0)
        expect(report.canary.nonSignal, `${verdictClass}/${producer} suppression`).toEqual({
          environment: 0,
          timeout: 0,
          flake: 0,
        })
        emissions.push(emit.mock.calls.map(([outcome]) => outcome as CanaryOutcome))
      }
    }
    expect(emissions).toHaveLength(16)
    for (const emitted of emissions) {
      expect(emitted).toEqual(emissions[0])
      expect(emitted[0]).toMatchObject({
        candidateId: CANDIDATE,
        runOutcome: 'negative',
        benefit: 'exercised-harmed',
        corpusDigest: 'c'.repeat(64),
        testIndex: 0,
        stepIndex: 0,
      })
    }
  })

  it('names the EXACT flipped record and leaves a held sibling to the class it always had', async () => {
    const base = handoff(
      [
        step({
          pass: false,
          lines: [
            { id: CANDIDATE, status: 'candidate', servedAsCanary: true },
            { id: SIBLING, status: 'candidate', servedAsCanary: true },
          ],
        }),
      ],
      rootCause('flake'),
    )
    const input = withEvidence(base, [
      evidenceRow(base, { recordId: CANDIDATE, crossCheck: 'flipped' }),
      evidenceRow(base, { recordId: SIBLING, crossCheck: 'held', decisionOrdinal: 1 }),
    ])
    const emit = vi.fn()
    const report = await emitCanaryOutcomes({
      handoff: input,
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      runDir,
      emit,
      credit: { maxAblations: 1, ablation: evalRoot() },
    })
    // The exact set, never a count: the flipped record and nothing else.
    expect(emit.mock.calls.map(([outcome]) => (outcome as CanaryOutcome).candidateId)).toEqual([
      CANDIDATE,
    ])
    expect(report.canary.nonSignal.flake).toBe(1)
    expect(
      report.details.map((row) => [row.candidateId, row.outcome.kind]),
    ).toEqual([
      [CANDIDATE, 'emitted'],
      [SIBLING, 'non-signal'],
    ])
  })

  it('covers an ORDINARY candidate exposure that was never served as a canary', async () => {
    const base = handoff(
      [step({ pass: false, lines: [{ id: ORDINARY, status: 'candidate' }] })],
      rootCause('environment'),
    )
    const input = withEvidence(base, [evidenceRow(base, { recordId: ORDINARY })])
    const emit = vi.fn()
    const report = await emitCanaryOutcomes({
      handoff: input,
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      runDir,
      emit,
      credit: { maxAblations: 1, ablation: evalRoot() },
    })
    expect(report.emitted).toBe(1)
    // The anchor is the record's own first canonical anchor: causal proof is direct exercise,
    // so it is never gated on the contact match Pin 1 requires.
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        candidateId: ORDINARY,
        runOutcome: 'negative',
        exercisedAnchor: UNRELATED_ANCHOR,
      }),
    )
  })

  it.each(['held', 'inconclusive', 'not-run'] as const)(
    'moves no trust for a %s record under a suppressed class',
    async (crossCheck) => {
      const base = handoff([step({ pass: false })], rootCause('timeout'))
      const input = withEvidence(base, [evidenceRow(base, { crossCheck })])
      const emit = vi.fn()
      const report = await emitCanaryOutcomes({
        handoff: input,
        knowledgeRoot: '/tmp/agent-qa-knowledge',
        runDir,
        emit,
        credit: { maxAblations: 1, ablation: evalRoot() },
      })
      expect(emit).not.toHaveBeenCalled()
      expect(report.emitted).toBe(0)
      expect(report.canary.nonSignal.timeout).toBe(1)
    },
  )

  it.each(['foreign run', 'foreign identity', 'unexposed step'] as const)(
    'mints nothing from a row with a %s',
    (defect) => {
      const base = handoff([step({ pass: false })], rootCause('flake'))
      const row = evidenceRow(base, {
        ...(defect === 'foreign run' ? { runId: 'run-somebody-else' } : {}),
        ...(defect === 'foreign identity' ? { handoffBaseDigest: 'd'.repeat(64) } : {}),
        ...(defect === 'unexposed step' ? { stepIndex: 7 } : {}),
      })
      expect(project(withEvidence(base, [row]))).toEqual([])
    },
  )

  it('refuses a second, conflicting row for one exposure rather than believing the flip', () => {
    const base = handoff([step({ pass: false })], rootCause('flake'))
    const input = withEvidence(base, [
      evidenceRow(base, { crossCheck: 'flipped' }),
      evidenceRow(base, { crossCheck: 'held', decisionOrdinal: 1 }),
    ])
    expect(project(input)).toEqual([])
  })

  it('never inverts a PASSED step, however the arbiter answered', () => {
    const base = handoff([step({ pass: true })], undefined)
    const outcomes = project(withEvidence(base, [evidenceRow(base)]))
    expect(outcomes.map((outcome) => outcome.runOutcome)).toEqual(['positive'])
  })

  it('keeps a rerun member excluded even when its record flipped', async () => {
    const base = handoff([step({ pass: false })], rootCause('flake'))
    base.tests[0] = { ...base.tests[0]!, isRerun: true, rerunAttempt: 2 }
    const emit = vi.fn()
    const report = await emitCanaryOutcomes({
      handoff: withEvidence(base, [evidenceRow(base)]),
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      runDir,
      emit,
      credit: { maxAblations: 1, ablation: evalRoot() },
    })
    expect(emit).not.toHaveBeenCalled()
    expect(report.canary.rerunExcluded).toBe(1)
  })

  it('reads the run-owned durable completions when the handoff carries NO sidecar', async () => {
    const base = handoff([step({ pass: false })], rootCause('environment'))
    saveCompletedMisdirectionCheck(runDir, evidenceRow(base))
    const emit = vi.fn()
    const report = await emitCanaryOutcomes({
      handoff: base,
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      runDir,
      emit,
      credit: { maxAblations: 1, ablation: evalRoot() },
    })
    expect(report.emitted).toBe(1)
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ candidateId: CANDIDATE, runOutcome: 'negative' }),
    )
  })

  it('treats an EMPTY sidecar as the arbiter answering nothing, never as a reason to look again', async () => {
    const base = handoff([step({ pass: false })], rootCause('environment'))
    saveCompletedMisdirectionCheck(runDir, evidenceRow(base))
    const emit = vi.fn()
    const report = await emitCanaryOutcomes({
      handoff: withEvidence(base, []),
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      runDir,
      emit,
      credit: { maxAblations: 1, ablation: evalRoot() },
    })
    expect(emit).not.toHaveBeenCalled()
    expect(report.emitted).toBe(0)
    expect(report.canary.nonSignal.environment).toBe(1)
  })
})

describe('422-16 — the harmed outcome through the ACTUAL writer', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  async function seedStore() {
    const root = mkdtempSync(join(tmpdir(), 'agent-qa-422-16-store-'))
    roots.push(root)
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    const auditBaseDir = join(root, '.agent-qa')
    const appendConfig = {
      knowledgeRoot,
      auditBaseDir,
      productKey: 'storefront',
      commitArtifacts: 'none' as const,
      writerLeaseId: 'fixture',
    }
    const published = publishBundleForTest(appendConfig, {
      draft: {
        kind: 'fact',
        subtype: 'selector',
        scope: { tier: 'product', key: 'storefront' },
        anchors: [CHECKOUT_ANCHOR],
        summary: 'checkout selector',
        body: 'Use the verified checkout button.',
        originStage: 'run-curation',
        distilledEvidenceRef: { id: 'evidence-checkout', sha: 'a'.repeat(64) },
      },
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'button', name: 'checkout' },
      },
      originClass: 'agent-verified',
      createdAtOrdinal: 1,
      screenStates: [],
      relations: [],
      artifacts: [],
      initialEvents: [
        {
          type: 'confirmed',
          evidenceToken: asEvidenceToken('confirm-checkout'),
          curationJobId: 'confirm-checkout',
          buildOrdinal: 1,
        },
      ],
      provenance: {
        mode: 'run-linked',
        runId: 'seed-checkout',
        testId: 'seed-checkout',
        stepIndex: 0,
        curationJobId: 'seed-checkout',
        sourceBuildOrdinal: 1,
      },
      evidenceMarkdown: 'Verified selector evidence.\n',
      distilledObservations: [
        {
          schemaVersion: 1,
          step: { naturalKey: 'checkout', ordinal: 0 },
          platform: 'web',
          element: { naturalKey: 'button:checkout:0' },
          observedAtOrdinal: 1,
        },
      ],
    })
    if (published.kind !== 'published') throw new Error(published.kind)
    const lease = acquireWriterLease(knowledgeRoot)
    if (lease.kind !== 'acquired') throw new Error(lease.kind)
    const store = createLocalKnowledgeStore({
      knowledgeRoot,
      auditBaseDir,
      executionContext: 'local-interactive',
      epoch: lease.epoch,
      writerLeaseId: lease.leaseId,
      sourceBuildOrdinal: 42,
    })
    const read = () => {
      const loaded = loadBundle(published.dir)
      if (loaded.kind !== 'loaded') throw new Error(loaded.kind)
      return loaded.bundle
    }
    return { knowledgeRoot, published, store, read }
  }

  it('lands exactly one contradicted event and one Gate-2 fail receipt, and promotes nothing', async () => {
    const seeded = await seedStore()
    const runDir = mkdtempSync(join(tmpdir(), 'agent-qa-422-16-run-'))
    roots.push(runDir)
    lookupSpy.anchorsById.clear()
    lookupSpy.anchorsById.set(seeded.published.id, [CHECKOUT_ANCHOR])

    const base = handoff(
      [step({ pass: false, lines: [{ id: seeded.published.id, status: 'candidate' }] })],
      rootCause('environment'),
    )
    const emitted: CanaryOutcome[] = []
    const report = await emitCanaryOutcomes({
      handoff: withEvidence(base, [evidenceRow(base, { recordId: seeded.published.id })]),
      knowledgeRoot: seeded.knowledgeRoot,
      runDir,
      emit: (outcome) => emitted.push(outcome),
      credit: { maxAblations: 1, ablation: evalRoot() },
    })
    expect(report.emitted).toBe(1)
    expect(emitted[0]).toMatchObject({ runOutcome: 'negative', benefit: 'exercised-harmed' })

    await seeded.store.recordCanaryOutcome(emitted[0]!)

    const events = survivingOutcomeEvents(seeded.read().events)
    expect(events.filter((event) => event.type === 'contradicted')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'promoted')).toHaveLength(0)
    const gate2 = (readGateReceipts(seeded.published.dir, seeded.published.id) ?? []).filter(
      (row) => 'gate' in row && row.gate === 2,
    )
    expect(gate2).toHaveLength(1)
    expect(gate2[0]).toMatchObject({ verdict: 'fail', benefit: 'exercised-harmed' })
    expect(deriveBundleTrust(seeded.read()).status).toBe('candidate')
  })
})
