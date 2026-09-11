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

import { curateCompletedRun, type CurationTailOperations } from '../curation-tail.js'
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

/**
 * A scripted eval root: one corpus digest, never a replay, never a provider call.
 *
 * `'no-eval-root'` is the BYOM / absent-root shape — the capability answers `no-eval-root`, so
 * the emitted outcome carries no corpus digest and the writer has nothing to mint a Gate-2
 * receipt from. The harmed OUTCOME is emitted either way. (A literal rather than `undefined`,
 * which a default parameter would silently read as "give me the default".)
 */
function evalRoot(corpusDigest: string | 'no-eval-root' = 'c'.repeat(64)) {
  return {
    isNovel: vi.fn(async () => false),
    stage: vi.fn(async () => ({ kind: 'no-eval-root' as const })),
    ablate: vi.fn(async () => ({ kind: 'no-eval-root' as const })),
    corpusDigest: vi.fn(async () =>
      corpusDigest === 'no-eval-root'
        ? ({ kind: 'no-eval-root' } as const)
        : ({ kind: 'digest', corpusDigest } as const),
    ),
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

  it('marks the causal rows on the emit detail and names them at the tail, class and all', async () => {
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
    const info = vi.fn()
    const { defaultGuardrailPolicyInput, loadGuardrailPolicy } = await import(
      '@vostride/agent-qa-safety'
    )
    const operations: Partial<CurationTailOperations> = {
      runSafetyScope: (_scope, fn) => fn(),
      emitCurationCandidates: () => ({
        enqueued: 0,
        coalesced: 0,
        refused: 0,
        capExceeded: 0,
        details: [],
      }),
      openKnowledgeReader: () =>
        ({ emitCanaryOutcome: () => undefined }) as unknown as ReturnType<
          CurationTailOperations['openKnowledgeReader']
        >,
      foldRunOutcomes: () => ({
        kind: 'applied',
        tests: 1,
        quarantine: { kind: 'not-evaluated', reason: 'not-requested' },
      }),
      drainQueue: async () => ({
        kind: 'drained', jobsProcessed: 0, committed: 0, inconsistenciesFiled: 0,
        downgraded: 0, withheld: 0, quarantined: 0, requeued: 0, failures: 0,
        failureDetails: [], noops: 0, noopDetails: [], remaining: 0,
        remainingWork: { queued: 0, claimedNonterminal: 0, quarantined: 0 },
        reconcile: undefined, writerPass: { kind: 'not-requested' }, gc: { kind: 'not-run' },
      }),
    }
    await curateCompletedRun({
      handoff: input,
      runDir,
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      agentQaRoot: runDir,
      auditSink: { appendGuardrailAudit: () => undefined, appendExecutionAudit: () => undefined },
      policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
      operations,
      log: { warn: vi.fn(), info },
    })
    const line = info.mock.calls.map(([message]) => String(message)).find((message) =>
      message.startsWith('Misdirection harm for'),
    )
    expect(line).toContain('1 harmed outcome(s) emitted from flipped cross-check evidence')
    expect(line).toContain('regardless of verdict class')
    expect(line).toContain(CANDIDATE)
    expect(line).not.toContain(SIBLING)
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

// -------------------------------------------------------------------------------------------
// 422-16-T2 — idempotence, mixed records, and the blast radius of the new precedence
// -------------------------------------------------------------------------------------------

describe('422-16 D-20 — only the flipped rows move, and they move exactly once', () => {
  let runDir: string

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), 'agent-qa-422-16-once-'))
    lookupSpy.anchorsById.clear()
    lookupSpy.anchorsById.set(CANDIDATE, [CHECKOUT_ANCHOR])
    lookupSpy.anchorsById.set(SIBLING, [CHECKOUT_ANCHOR])
    lookupSpy.anchorsById.set(ORDINARY, [UNRELATED_ANCHOR])
  })
  afterEach(() => rmSync(runDir, { recursive: true, force: true }))

  it('leaves a NON-causal sibling exactly where it was on a step with no exercised anchors', async () => {
    // The pre-422-16 emitter returned before touching the anchor store when a step exercised
    // nothing, so an unresolvable sibling on such a step reported nothing at all. A causal
    // record on the same step must not drag that sibling into a lookup it never faced: an
    // `unresolved` row is what withholds the tail's receipt and refolds the run.
    const anchorless = step({
      pass: false,
      anchorless: true,
      lines: [
        { id: CANDIDATE, status: 'candidate', servedAsCanary: true },
        { id: 'candidate-never-published', status: 'candidate', servedAsCanary: true },
      ],
    })
    const base = handoff([anchorless], rootCause('app_bug'))
    const emit = vi.fn()
    const withFlip = await emitCanaryOutcomes({
      handoff: withEvidence(base, [evidenceRow(base, { recordId: CANDIDATE })]),
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      runDir,
      emit,
      credit: { maxAblations: 1, ablation: evalRoot() },
    })
    const without = await emitCanaryOutcomes({
      handoff: base,
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      runDir,
      emit: vi.fn(),
      credit: { maxAblations: 1, ablation: evalRoot() },
    })
    expect(withFlip.emitted).toBe(1)
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ candidateId: CANDIDATE, runOutcome: 'negative' }),
    )
    // The sibling's treatment is IDENTICAL with and without the ledger — that is the claim.
    expect(withFlip.unresolved).toBe(without.unresolved)
    expect(withFlip.unresolved).toBe(0)
    expect(withFlip.details.filter((row) => row.misdirectionFlipped !== true)).toEqual(
      without.details,
    )
  })

  it('emits ONE row for a record both emitters select, and names the cross-check in it', async () => {
    // `app_bug` is attributable, so the served-canary path would already have produced a
    // negative for this record. The causal path must take it over rather than duplicate it.
    const base = handoff([step({ pass: false })], rootCause('app_bug'))
    const emit = vi.fn()
    const report = await emitCanaryOutcomes({
      handoff: withEvidence(base, [evidenceRow(base)]),
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      runDir,
      emit,
      credit: { maxAblations: 1, ablation: evalRoot() },
    })
    expect(report.details).toHaveLength(1)
    expect(report.details[0]).toMatchObject({ candidateId: CANDIDATE, misdirectionFlipped: true })
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        candidateId: CANDIDATE,
        runOutcome: 'negative',
        attribution: expect.stringContaining('after the misdirection cross-check flipped'),
      }),
    )
  })

  it('moves the flipped record and leaves a held and a not-run sibling exactly as they were', async () => {
    const lines = [
      { id: CANDIDATE, status: 'candidate' as const, servedAsCanary: true },
      { id: SIBLING, status: 'candidate' as const, servedAsCanary: true },
      { id: ORDINARY, status: 'candidate' as const, servedAsCanary: true },
    ]
    const base = handoff([step({ pass: false, lines })], rootCause('environment'))
    const emit = vi.fn()
    const report = await emitCanaryOutcomes({
      handoff: withEvidence(base, [
        evidenceRow(base, { recordId: CANDIDATE, crossCheck: 'flipped' }),
        evidenceRow(base, { recordId: SIBLING, crossCheck: 'held', decisionOrdinal: 1 }),
        evidenceRow(base, { recordId: ORDINARY, crossCheck: 'not-run', decisionOrdinal: 2 }),
      ]),
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      runDir,
      emit,
      credit: { maxAblations: 1, ablation: evalRoot() },
    })
    // Exact sets on both sides of the line, never counts.
    expect(report.details.filter((row) => row.outcome.kind === 'emitted').map((row) => row.candidateId))
      .toEqual([CANDIDATE])
    expect(report.details.filter((row) => row.outcome.kind === 'non-signal').map((row) => row.candidateId))
      .toEqual([SIBLING, ORDINARY])
    expect(report.canary.nonSignal.environment).toBe(2)
  })

  it('keeps two failing steps as two supported observations of one record', async () => {
    const lines = [{ id: CANDIDATE, status: 'candidate' as const, servedAsCanary: true }]
    const base = handoff(
      [step({ pass: false, lines }), step({ stepIndex: 1, pass: false, lines })],
      rootCause('timeout'),
    )
    const emit = vi.fn()
    await emitCanaryOutcomes({
      handoff: withEvidence(base, [
        evidenceRow(base, { stepIndex: 0 }),
        evidenceRow(base, { stepIndex: 1 }),
      ]),
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      runDir,
      emit,
      credit: { maxAblations: 1, ablation: evalRoot() },
    })
    expect(emit.mock.calls.map(([outcome]) => (outcome as CanaryOutcome).stepIndex)).toEqual([0, 1])
  })

  it('answers per MEMBER: a flip on one member never accuses the same record on another', async () => {
    const lines = [{ id: CANDIDATE, status: 'candidate' as const, servedAsCanary: true }]
    const base = handoff([step({ pass: false, lines })], rootCause('flake'))
    base.tests.push({
      ...base.tests[0]!,
      testIndex: 1,
      testId: 'checkout::sibling-member',
      rootCause: rootCause('flake', 'deterministic-classifier', 1),
      steps: [step({ pass: false, lines })],
    })
    const emit = vi.fn()
    await emitCanaryOutcomes({
      handoff: withEvidence(base, [evidenceRow(base, { perTest: 0 })]),
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      runDir,
      emit,
      credit: { maxAblations: 1, ablation: evalRoot() },
    })
    expect(emit.mock.calls.map(([outcome]) => (outcome as CanaryOutcome).testIndex)).toEqual([0])
  })

  it('spends no ablation allowance: a capped positive sibling is exactly as capped as before', async () => {
    const base = handoff(
      [
        step({
          pass: true,
          lines: [
            { id: SIBLING, status: 'candidate', servedAsCanary: true },
            { id: ORDINARY, status: 'candidate', servedAsCanary: true },
          ],
        }),
        step({ stepIndex: 1, pass: false }),
      ],
      rootCause('environment', 'deterministic-classifier'),
    )
    lookupSpy.anchorsById.set(ORDINARY, [CHECKOUT_ANCHOR])
    const ablation = evalRoot()
    ablation.isNovel = vi.fn(async () => false)
    const emit = vi.fn()
    const report = await emitCanaryOutcomes({
      handoff: withEvidence(base, [evidenceRow(base, { stepIndex: 1 })]),
      knowledgeRoot: '/tmp/agent-qa-knowledge',
      runDir,
      emit,
      credit: {
        maxAblations: 1,
        ablation,
        readBundleStateDigests: () => ({ kind: 'not-found' }),
      },
    })
    // The causal harm is a NEGATIVE row, and negatives are never replayed — the arbiter
    // already did the removal. So the Gate-2 allowance is untouched by it.
    for (const call of ablation.ablate.mock.calls) {
      expect(call[0]).not.toMatchObject({ candidateId: CANDIDATE, stepIndex: 1 })
    }
    expect(
      report.details.filter((row) => row.misdirectionFlipped === true).map((row) => row.candidateId),
    ).toEqual([CANDIDATE])
    expect(report.details.filter((row) => row.misdirectionFlipped !== true)).toHaveLength(2)
  })
})

describe('422-16 — the harmed outcome through the ACTUAL writer', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function seedStore() {
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
    const seed = (name: string) => {
      const published = publishBundleForTest(appendConfig, {
        draft: {
          kind: 'fact',
          subtype: 'selector',
          scope: { tier: 'product', key: 'storefront' },
          anchors: [{ t: 'el', role: 'button', name, ordinal: 0 }],
          summary: `${name} selector`,
          body: `Use the verified ${name} button.`,
          originStage: 'run-curation',
          distilledEvidenceRef: { id: `evidence-${name}`, sha: 'a'.repeat(64) },
        },
        discriminant: {
          kind: 'fact',
          subtype: 'selector',
          elementRef: { role: 'button', name },
        },
        originClass: 'agent-verified',
        createdAtOrdinal: 1,
        screenStates: [],
        relations: [],
        artifacts: [],
        initialEvents: [
          {
            type: 'confirmed',
            evidenceToken: asEvidenceToken(`confirm-${name}`),
            curationJobId: `confirm-${name}`,
            buildOrdinal: 1,
          },
        ],
        provenance: {
          mode: 'run-linked',
          runId: `seed-${name}`,
          testId: `seed-${name}`,
          stepIndex: 0,
          curationJobId: `seed-${name}`,
          sourceBuildOrdinal: 1,
        },
        evidenceMarkdown: 'Verified selector evidence.\n',
        distilledObservations: [
          {
            schemaVersion: 1,
            step: { naturalKey: name, ordinal: 0 },
            platform: 'web',
            element: { naturalKey: `button:${name}:0` },
            observedAtOrdinal: 1,
          },
        ],
      })
      if (published.kind !== 'published') throw new Error(published.kind)
      lookupSpy.anchorsById.set(published.id, [CHECKOUT_ANCHOR])
      return published
    }
    const control = seed('control')
    const arm = seed('arm')
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
    /** Everything the writer durably did to one bundle, as comparable data. */
    const consequences = (published: { dir: string; id: string }) => {
      const loaded = loadBundle(published.dir)
      if (loaded.kind !== 'loaded') throw new Error(loaded.kind)
      return {
        events: survivingOutcomeEvents(loaded.bundle.events).map((event) => event.type),
        gate2: (readGateReceipts(published.dir, published.id) ?? [])
          .filter((row) => 'gate' in row && row.gate === 2)
          .map((row) => ({
            verdict: row.verdict,
            benefit: 'benefit' in row ? row.benefit : undefined,
            stateValidity: 'stateValidity' in row ? row.stateValidity : undefined,
          })),
        status: deriveBundleTrust(loaded.bundle).status,
      }
    }
    return { knowledgeRoot, control, arm, store, consequences }
  }

  async function harmOnce(
    seeded: ReturnType<typeof seedStore>,
    leg: 'control' | 'arm',
    overrides: {
      ablation?: ReturnType<typeof evalRoot>
      readBundleStateDigests?: () => { kind: 'found'; digests: string[] } | { kind: 'not-found' }
    } = {},
  ): Promise<CanaryOutcome[]> {
    const runDir = mkdtempSync(join(tmpdir(), `agent-qa-422-16-${leg}-`))
    roots.push(runDir)
    const published = seeded[leg]
    // The two legs differ in EXACTLY two things: the class the run resolved, and whether the
    // arbiter's ledger names the record. `app_bug` is attributable today, so the control is the
    // harm law as it already stands; `environment` is suppressed today, so the arm reaches the
    // writer only through D-20's causal precedence.
    const base = {
      ...handoff(
        [step({ pass: false, lines: [{ id: published.id, status: 'candidate', servedAsCanary: true }] })],
        rootCause(leg === 'control' ? 'app_bug' : 'environment'),
      ),
      runId: asRunId(`run-misdirection-${leg}`),
    }
    const emitted: CanaryOutcome[] = []
    const report = await emitCanaryOutcomes({
      handoff:
        leg === 'control'
          ? base
          : withEvidence(base, [evidenceRow(base, { recordId: published.id })]),
      knowledgeRoot: seeded.knowledgeRoot,
      runDir,
      emit: (outcome) => emitted.push(outcome),
      credit: {
        maxAblations: 1,
        ablation: overrides.ablation ?? evalRoot(),
        ...(overrides.readBundleStateDigests === undefined
          ? {}
          : { readBundleStateDigests: overrides.readBundleStateDigests }),
      },
    })
    expect(report.emitted, `${leg} emitted`).toBe(1)
    expect(emitted[0]).toMatchObject({ runOutcome: 'negative', benefit: 'exercised-harmed' })
    return emitted
  }


  it('lands one contradicted event and one Gate-2 fail receipt, and introduces nothing the existing harm law does not', async () => {
    const seeded = seedStore()
    const control = await harmOnce(seeded, 'control')
    const arm = await harmOnce(seeded, 'arm')

    await seeded.store.recordCanaryOutcome(control[0]!)
    await seeded.store.recordCanaryOutcome(arm[0]!)

    const armConsequences = seeded.consequences(seeded.arm)
    expect(armConsequences.events.filter((type) => type === 'contradicted')).toHaveLength(1)
    expect(armConsequences.gate2).toEqual([
      { verdict: 'fail', benefit: 'exercised-harmed', stateValidity: 'unknown' },
    ])
    // The whole claim of "no new trust motion": what the arm did to its bundle is what the
    // pre-existing attributable path did to its own, event for event and receipt for receipt.
    //
    // The shared consequence is stated rather than merely compared, so a change to EITHER side
    // is visible here. The `promoted` line is this fixture's own promotion gate, not this
    // plan's: the 418 negative arm re-evaluates promotion after writing the fail receipt, and
    // these bundles carry a `confirmed` event with no `resolvePromotionPosture` bound to refuse
    // them. It is present on the CONTROL leg too, which is the point — the causal path adds no
    // promotion the class-attributable path was not already producing.
    expect(armConsequences).toEqual({
      events: ['confirmed', 'contradicted', 'promoted'],
      gate2: [{ verdict: 'fail', benefit: 'exercised-harmed', stateValidity: 'unknown' }],
      status: 'active',
    })
    expect(armConsequences).toEqual(seeded.consequences(seeded.control))
  })

  it('survives a REPEATED drain: the same observation lands one event and one receipt', async () => {
    const seeded = seedStore()
    // Two folds of the same run produce the same bytes (the emitter is a pure projection over
    // the handoff), so the second drain hands the writer an outcome it has already recorded.
    const first = await harmOnce(seeded, 'arm')
    const second = await harmOnce(seeded, 'arm')
    expect(second).toEqual(first)

    await seeded.store.recordCanaryOutcome(first[0]!)
    await seeded.store.recordCanaryOutcome(second[0]!)

    const consequences = seeded.consequences(seeded.arm)
    expect(consequences.events.filter((type) => type === 'contradicted')).toHaveLength(1)
    expect(consequences.gate2).toEqual([
      { verdict: 'fail', benefit: 'exercised-harmed', stateValidity: 'unknown' },
    ])
  })

  it('completes a receipt the first attempt never wrote, without duplicating the event', async () => {
    const seeded = seedStore()
    // The retry window this exercises: the outcome event is durable and the Gate-2 receipt is
    // not, because the first attempt ran against a root that could answer no corpus digest.
    // The recovery attempt has one, and must add the receipt WITHOUT a second contradiction.
    const rootless = await harmOnce(seeded, 'arm', { ablation: evalRoot('no-eval-root') })
    expect(rootless[0]).not.toHaveProperty('corpusDigest')
    await seeded.store.recordCanaryOutcome(rootless[0]!)
    const partial = seeded.consequences(seeded.arm)
    expect(partial.events.filter((type) => type === 'contradicted')).toHaveLength(1)
    expect(partial.gate2).toEqual([])

    const recovered = await harmOnce(seeded, 'arm')
    expect(recovered[0]).toMatchObject({ corpusDigest: 'c'.repeat(64) })
    await seeded.store.recordCanaryOutcome(recovered[0]!)

    const consequences = seeded.consequences(seeded.arm)
    expect(consequences.events.filter((type) => type === 'contradicted')).toHaveLength(1)
    expect(consequences.gate2).toEqual([
      { verdict: 'fail', benefit: 'exercised-harmed', stateValidity: 'unknown' },
    ])
  })

  it('keeps 418 stale policy: a STALE observation abstains rather than contradicting', async () => {
    const seeded = seedStore()
    // Not a carve-out this plan added — the existing negative arm holds a stale observation at
    // `abstain` until enough independent runs agree (418 D-08/D-12). Causal precedence decides
    // WHETHER the harmed outcome is emitted; it never decides what the writer does with it.
    const stale = await harmOnce(seeded, 'arm', {
      readBundleStateDigests: () => ({ kind: 'found', digests: ['f'.repeat(64)] }),
    })
    expect(stale[0]).toMatchObject({ stateValidity: 'stale' })
    await seeded.store.recordCanaryOutcome(stale[0]!)

    const consequences = seeded.consequences(seeded.arm)
    expect(consequences.events.filter((type) => type === 'contradicted')).toHaveLength(0)
    expect(consequences.gate2).toEqual([
      { verdict: 'abstain', benefit: 'exercised-harmed', stateValidity: 'stale' },
    ])
  })
})
