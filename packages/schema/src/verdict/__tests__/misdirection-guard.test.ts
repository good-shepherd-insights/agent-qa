// The circularity guard's evidence seam (Phase 422, plan 11 — D-17/D-19/D-20).
//
// A no-trust-change verdict ("the memory was not the problem") is exactly the sentence a
// misdirected author would write to shield the record that misled it. Phase 389 made the
// CLAIM checkable — a bare boolean had to be true when candidate or low-trust memory sat on
// the failing path. This plan makes the EVIDENCE checkable: which records were on the path is
// recomputed by code from the run's own served briefs (D-17), the claim is backed by a
// complete per-record cross-check whose every relevant row must have HELD (D-20), and the one
// posture that may keep the bare declared boolean is a run with no evaluation root at all
// (D-19) — a broken root is unbacked, never exempt.
//
// The three fixtures below are the three ways a gated verdict reaches this boundary, and they
// have three DISTINCT accepted outcomes on purpose: no-root + declared-only is admitted,
// broken-root + declared-only is refused as unbacked, and missing evidence under an ordinary
// root is refused for a different reason again. Collapsing any two of them would let one
// posture borrow another's exemption.

import { describe, expect, it } from 'vitest'

import type { BriefLine, ServedBrief } from '../../brief/served-brief'
import type { CompletedRunHandoff } from '../../handoff/completed-run-handoff'
import type { PerTestOutcome } from '../../handoff/per-test-outcome'
import type { StepEvidence } from '../../handoff/step-evidence'
import { asRecordId } from '../../ids/record-id'
import type { RecordId } from '../../ids/record-id'
import { asRef } from '../../primitives/ref'
import { asRunId } from '../../run/run-id'
import { CURRENT_ANALYSIS_SCHEMA_VERSION } from '../analysis-artifact'
import type { RunAnalysisArtifact } from '../analysis-artifact'
import {
  aggregateMisdirectionEvidence,
  deriveMemoryOnPath,
  deriveMemoryOnPathSites,
  guardMisdirectionEvidence,
  MEMORY_ON_PATH_TRUSTS,
  MISDIRECTION_BACKINGS,
  MISDIRECTION_ROOT_POSTURES,
  misdirectionSourceDigest,
  MisdirectionEvidenceError,
} from '../misdirection-evidence'
import { CROSS_CHECKS } from '../../knowledge/gate-receipt'
import { VERDICT_CLASSES } from '../verdict'
import type {
  MisdirectionEvidence,
  MisdirectionRecordResult,
} from '../misdirection-evidence'
import type { VerdictSentenceParts } from '../sentence-parts'
import { validateAnalysisAgainstHandoff } from '../validate-analysis'
import type { Verdict } from '../verdict'

// ---------------------------------------------------------------------------------------
// Fixture: one handoff, four member tests.
//   test 0  clean neighbour step then a failing step served a CANDIDATE record
//   test 1  failing step served TWO low-trust records (one candidate, one canary)
//   test 2  the citation-dodge posture: the verdict cites the clean step only, while the
//           ACTUAL failing step is the one that carried candidate memory
//   test 3  no low-trust memory anywhere — the ungated control
// ---------------------------------------------------------------------------------------

const CANDIDATE_RECORD = asRecordId('rec_mem_candidate')
const CANARY_RECORD = asRecordId('rec_mem_canary')
const CLEAN_RECORD = asRecordId('rec_mem_clean')

const STEP_TEXT = 'click the Submit button on the checkout screen'
const VERIFIER_REASONING = 'the submit button never appeared on the checkout screen'
const SUB_ACTION_PLAN = 'click the Submit button now that the cart is full'
const SUB_ACTION_ERROR = 'Error: element "Submit" not found after 3 grounding attempts'

function briefLine(overrides: Partial<BriefLine> = {}): BriefLine {
  return {
    id: CLEAN_RECORD,
    kind: 'fact',
    summary: 'the checkout form autosaves',
    trust: 0.9,
    status: 'active',
    servedAsCanary: false,
    tier: 'L2',
    ...overrides,
  }
}

const candidateLine = (): BriefLine =>
  briefLine({ id: CANDIDATE_RECORD, status: 'candidate', trust: 0.4 })
const canaryLine = (): BriefLine =>
  briefLine({ id: CANARY_RECORD, status: 'active', servedAsCanary: true, trust: 0.5 })

function servedBrief(lines: BriefLine[], briefDigest = 'brief-digest-1'): ServedBrief {
  return {
    scope: { tier: 'product', key: 'misdirection-guard' },
    asOfBuild: 1,
    budget: 0,
    truncation: 'none',
    channel1: lines,
    channel2: [],
    channel3: [],
    briefDigest,
  }
}

function screenState() {
  return {
    platform: 'web' as const,
    tree: '',
    elements: [],
    refMap: {},
    url: '/checkout',
    timestamp: 1,
    metadata: {
      coordSpace: 'viewport' as const,
      viewportWidth: 1280,
      viewportHeight: 720,
      scroll: { offsetX: 0, offsetY: 0, contentWidth: 1280, contentHeight: 720 },
      captureMode: 'textOnly' as const,
    },
  }
}

function passingStep(stepIndex: number, brief: ServedBrief): StepEvidence {
  return {
    stepIndex,
    stepText: `neighbor step ${stepIndex}`,
    cacheStatus: 'miss',
    servedBrief: brief,
    subActions: [
      {
        plan: `observe step ${stepIndex}`,
        plannedAction: { type: 'click', ref: asRef('e1') },
        stateBefore: screenState(),
        result: { success: true },
      },
    ],
    verifierVerdict: { pass: true, reasoning: `neighbor step ${stepIndex} verified` },
  }
}

function failingStep(stepIndex: number, brief: ServedBrief): StepEvidence {
  return {
    stepIndex,
    stepText: STEP_TEXT,
    cacheStatus: 'miss',
    servedBrief: brief,
    subActions: [
      {
        plan: SUB_ACTION_PLAN,
        plannedAction: { type: 'click', ref: asRef('e1') },
        stateBefore: screenState(),
        result: { success: false, error: SUB_ACTION_ERROR },
      },
    ],
    verifierVerdict: { pass: false, reasoning: VERIFIER_REASONING },
  }
}

function buildHandoff(): CompletedRunHandoff {
  const tests: PerTestOutcome[] = [
    {
      testId: 't_candidate',
      testName: 'candidate memory on the failing step',
      filePath: 'tests/candidate.yaml',
      testIndex: 0,
      outcome: 'failed',
      steps: [
        passingStep(0, servedBrief([briefLine()], 'brief-digest-clean')),
        failingStep(1, servedBrief([briefLine(), candidateLine()], 'brief-digest-1')),
      ],
    },
    {
      testId: 't_two_records',
      testName: 'two low-trust records on the failing step',
      filePath: 'tests/two-records.yaml',
      testIndex: 1,
      outcome: 'failed',
      steps: [failingStep(0, servedBrief([candidateLine(), canaryLine()], 'brief-digest-2'))],
    },
    {
      testId: 't_citation_dodge',
      testName: 'the verdict cites the clean step only',
      filePath: 'tests/citation-dodge.yaml',
      testIndex: 2,
      outcome: 'failed',
      steps: [
        passingStep(0, servedBrief([briefLine()], 'brief-digest-clean')),
        failingStep(1, servedBrief([candidateLine()], 'brief-digest-3')),
      ],
    },
    {
      testId: 't_clean',
      testName: 'no low-trust memory anywhere',
      filePath: 'tests/clean.yaml',
      testIndex: 3,
      outcome: 'failed',
      steps: [failingStep(0, servedBrief([briefLine()], 'brief-digest-clean'))],
    },
    {
      testId: 't_twice',
      testName: 'one record served on two steps',
      filePath: 'tests/twice.yaml',
      testIndex: 4,
      outcome: 'failed',
      steps: [
        passingStep(0, servedBrief([candidateLine()], 'brief-digest-4a')),
        failingStep(1, servedBrief([candidateLine(), canaryLine()], 'brief-digest-4b')),
      ],
    },
  ]
  return {
    schemaVersion: 7,
    runId: asRunId('run-misdirection-guard'),
    scope: { tier: 'product', key: 'misdirection-guard' },
    buildOrdinal: 1,
    executionContext: 'local-headless',
    aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1,
    endedAt: 2,
    tests,
  }
}

const HANDOFF = buildHandoff()
const BASE_DIGEST = misdirectionSourceDigest(HANDOFF)

function testAt(perTest: number): PerTestOutcome {
  const test = HANDOFF.tests[perTest]
  if (test === undefined) throw new Error(`fixture has no test ${perTest}`)
  return test
}

function result(
  overrides: Partial<MisdirectionRecordResult> & { recordId: RecordId },
): MisdirectionRecordResult {
  return {
    runId: 'run-misdirection-guard',
    perTest: 0,
    stepIndex: 1,
    decisionOrdinal: 0,
    handoffBaseDigest: BASE_DIGEST,
    briefDigest: 'brief-digest-1',
    corpusDigest: 'corpus-digest-1',
    profileDigest: 'profile-digest-1',
    crossCheck: 'held',
    seedHonored: true,
    ...overrides,
  }
}

function evidence(
  results: MisdirectionRecordResult[],
  overrides: Partial<MisdirectionEvidence> = {},
): MisdirectionEvidence {
  return {
    crossCheck: 'held',
    results,
    ...overrides,
  }
}

function verdictFor(perTest: number, overrides: Partial<Verdict> = {}): Verdict {
  return {
    class: 'app_bug',
    producer: 'analyze-run',
    confidence: 0.9,
    evidence: {
      citedSteps: perTest === 0 || perTest === 2 ? [1] : [0],
      citedAnchors: [],
      citedArtifacts: [],
      rationale: 'advisory self-trace, never the sentence',
    },
    memoryMisdirectionRuledOut: true,
    perTest,
    ...overrides,
  } as Verdict
}

function partsFor(
  perTest: number,
  overrides: Partial<VerdictSentenceParts> = {},
): VerdictSentenceParts {
  return {
    perTest,
    groundingQuote: {
      stepIndex: perTest === 0 || perTest === 2 ? 1 : 0,
      quote: SUB_ACTION_ERROR,
    },
    discriminator: 'the same step passed on the previous build',
    nextAction: 'file the failure against the application with the quoted evidence',
    links: ['agentqa://memory/MEM-001'],
    ...overrides,
  }
}

function artifactOf(verdicts: Verdict[], parts: VerdictSentenceParts[]): RunAnalysisArtifact {
  return {
    schemaVersion: CURRENT_ANALYSIS_SCHEMA_VERSION,
    runId: 'run-misdirection-guard',
    verdicts,
    parts,
  }
}

function reasonsOf(result_: ReturnType<typeof validateAnalysisAgainstHandoff>): string[] {
  if (result_.ok) return []
  return result_.rejects.map((reject) => reject.reason)
}

// ---------------------------------------------------------------------------------------
// The closed vocabularies, at runtime. The type-level halves live in
// `misdirection-contract.test-d.ts`; both directions are pinned there, and these cells pin
// the exact LISTS and their order. A one-sided pin is satisfied by a set that grew.
// ---------------------------------------------------------------------------------------

describe('the 422 evidence vocabularies are closed', () => {
  it('pins exactly two memory trust words', () => {
    expect(MEMORY_ON_PATH_TRUSTS).toEqual(['candidate', 'low-trust-active'])
  })

  it('pins exactly one backing word, and it is an absence marker', () => {
    expect(MISDIRECTION_BACKINGS).toEqual(['declared-only'])
  })

  it('pins the three evaluation-root postures', () => {
    expect(MISDIRECTION_ROOT_POSTURES).toEqual(['eval-root', 'no-eval-root', 'broken-eval-root'])
  })

  it('REUSES the four cross-check words rather than minting a fifth copy', () => {
    expect(CROSS_CHECKS).toEqual(['flipped', 'held', 'inconclusive', 'not-run'])
  })

  it('leaves the verdict class floor at exactly eight, hand-spelled', () => {
    expect(VERDICT_CLASSES).toEqual([
      'test_bug',
      'app_bug',
      'environment',
      'flake',
      'config_error',
      'llm_error',
      'unknown',
      'timeout',
    ])
    expect(VERDICT_CLASSES).toHaveLength(8)
  })
})

// ---------------------------------------------------------------------------------------
// D-17 — membership is RECOMPUTED from the run's own briefs
// ---------------------------------------------------------------------------------------

describe('deriveMemoryOnPath: code owns on-path membership', () => {
  it('names the candidate record served on the failing step, and only it', () => {
    expect(deriveMemoryOnPath(testAt(0).steps)).toEqual([
      { recordId: CANDIDATE_RECORD, trust: 'candidate' },
    ])
  })

  it('separates a pre-promotion candidate from a low-trust active canary', () => {
    expect(deriveMemoryOnPath(testAt(1).steps)).toEqual([
      { recordId: CANDIDATE_RECORD, trust: 'candidate' },
      { recordId: CANARY_RECORD, trust: 'low-trust-active' },
    ])
  })

  it('derives nothing from a brief that served only established memory', () => {
    expect(deriveMemoryOnPath(testAt(3).steps)).toEqual([])
  })

  it('keeps the step each exposure happened on', () => {
    expect(deriveMemoryOnPathSites(testAt(1).steps)).toEqual([
      { stepIndex: 0, recordId: CANDIDATE_RECORD, trust: 'candidate' },
      { stepIndex: 0, recordId: CANARY_RECORD, trust: 'low-trust-active' },
    ])
  })
})

// ---------------------------------------------------------------------------------------
// D-20 — a mixed cross-check never resolves to held
// ---------------------------------------------------------------------------------------

describe('aggregateMisdirectionEvidence: mixed rows never resolve to held', () => {
  const sites = deriveMemoryOnPathSites(testAt(1).steps)
  const base = {
    runId: 'run-misdirection-guard',
    perTest: 1,
    handoffBaseDigest: BASE_DIGEST,
    sites,
  }
  const rowFor = (recordId: RecordId, crossCheck: MisdirectionRecordResult['crossCheck']) =>
    result({ recordId, perTest: 1, stepIndex: 0, briefDigest: 'brief-digest-2', crossCheck })

  it('resolves to held only when every relevant row held', () => {
    expect(
      aggregateMisdirectionEvidence({
        ...base,
        results: [rowFor(CANDIDATE_RECORD, 'held'), rowFor(CANARY_RECORD, 'held')],
      }),
    ).toEqual({ outcome: 'held', records: [CANDIDATE_RECORD, CANARY_RECORD] })
  })

  it('held + flipped is flipped, never held', () => {
    const aggregate = aggregateMisdirectionEvidence({
      ...base,
      results: [rowFor(CANDIDATE_RECORD, 'held'), rowFor(CANARY_RECORD, 'flipped')],
    })
    expect(aggregate.outcome).toBe('flipped')
  })

  it('held + not-run is unknown with the unchecked sibling disclosed, never held', () => {
    const aggregate = aggregateMisdirectionEvidence({
      ...base,
      results: [rowFor(CANDIDATE_RECORD, 'held'), rowFor(CANARY_RECORD, 'not-run')],
    })
    expect(aggregate).toEqual({
      outcome: 'unknown',
      inconclusive: [],
      notRun: [CANARY_RECORD],
      unchecked: [],
    })
  })

  it('held + inconclusive is unknown with the inconclusive sibling disclosed', () => {
    const aggregate = aggregateMisdirectionEvidence({
      ...base,
      results: [rowFor(CANDIDATE_RECORD, 'held'), rowFor(CANARY_RECORD, 'inconclusive')],
    })
    expect(aggregate).toEqual({
      outcome: 'unknown',
      inconclusive: [CANARY_RECORD],
      notRun: [],
      unchecked: [],
    })
  })

  it('an omitted row leaves its record unchecked, and unchecked is never held', () => {
    const aggregate = aggregateMisdirectionEvidence({
      ...base,
      results: [rowFor(CANDIDATE_RECORD, 'held')],
    })
    expect(aggregate).toEqual({
      outcome: 'unknown',
      inconclusive: [],
      notRun: [],
      unchecked: [CANARY_RECORD],
    })
  })

  it('refuses a row for a record no brief put on the path', () => {
    const aggregate = aggregateMisdirectionEvidence({
      ...base,
      results: [
        rowFor(CANDIDATE_RECORD, 'held'),
        rowFor(CANARY_RECORD, 'held'),
        rowFor(asRecordId('rec_mem_absent'), 'held'),
      ],
    })
    expect(aggregate.outcome).toBe('evidence-refused')
  })

  it('refuses a row minted against a different run', () => {
    const aggregate = aggregateMisdirectionEvidence({
      ...base,
      results: [
        rowFor(CANDIDATE_RECORD, 'held'),
        { ...rowFor(CANARY_RECORD, 'held'), runId: 'run-somewhere-else' },
      ],
    })
    expect(aggregate.outcome).toBe('evidence-refused')
  })

  it('refuses a row whose source-digest identity is not this handoff base', () => {
    const aggregate = aggregateMisdirectionEvidence({
      ...base,
      results: [
        rowFor(CANDIDATE_RECORD, 'held'),
        { ...rowFor(CANARY_RECORD, 'held'), handoffBaseDigest: 'f'.repeat(64) },
      ],
    })
    expect(aggregate.outcome).toBe('evidence-refused')
  })

  it('refuses two conflicting rows for one exposure', () => {
    const aggregate = aggregateMisdirectionEvidence({
      ...base,
      results: [
        rowFor(CANDIDATE_RECORD, 'held'),
        rowFor(CANDIDATE_RECORD, 'flipped'),
        rowFor(CANARY_RECORD, 'held'),
      ],
    })
    expect(aggregate.outcome).toBe('evidence-refused')
  })
})

// ---------------------------------------------------------------------------------------
// The source-digest identity is NOT the final handoff digest (no self-hash cycle)
// ---------------------------------------------------------------------------------------

describe('misdirectionSourceDigest', () => {
  it('is a stable 64-hex digest of the run identity, not of the whole handoff', () => {
    expect(BASE_DIGEST).toMatch(/^[0-9a-f]{64}$/)
    expect(misdirectionSourceDigest(buildHandoff())).toBe(BASE_DIGEST)
  })

  it('does not move when a later-written member outcome changes', () => {
    const mutated: CompletedRunHandoff = {
      ...HANDOFF,
      tests: HANDOFF.tests.slice(0, 1),
      endedAt: 99,
    }
    expect(misdirectionSourceDigest(mutated)).toBe(BASE_DIGEST)
  })
})

// ---------------------------------------------------------------------------------------
// The guarded DTO
// ---------------------------------------------------------------------------------------

describe('guardMisdirectionEvidence', () => {
  it('admits a complete block', () => {
    const block = evidence([result({ recordId: CANDIDATE_RECORD })])
    expect(guardMisdirectionEvidence(block)).toEqual(block)
  })

  it('refuses a block whose results array is missing', () => {
    expect(() => guardMisdirectionEvidence({ crossCheck: 'held' })).toThrow(
      MisdirectionEvidenceError,
    )
  })

  it('refuses a cross-check word outside the four', () => {
    expect(() =>
      guardMisdirectionEvidence(evidence([result({ recordId: CANDIDATE_RECORD })], {
        crossCheck: 'unchecked' as MisdirectionEvidence['crossCheck'],
      })),
    ).toThrow(MisdirectionEvidenceError)
  })

  it('refuses a backing word outside the declared-only literal', () => {
    expect(() =>
      guardMisdirectionEvidence(
        evidence([result({ recordId: CANDIDATE_RECORD })], {
          backing: 'measured' as MisdirectionEvidence['backing'],
        }),
      ),
    ).toThrow(MisdirectionEvidenceError)
  })

  it('refuses an unknown member rather than dropping it', () => {
    expect(() =>
      guardMisdirectionEvidence({
        ...evidence([result({ recordId: CANDIDATE_RECORD })]),
        exonerated: true,
      }),
    ).toThrow(MisdirectionEvidenceError)
  })
})

// ---------------------------------------------------------------------------------------
// D-17 — the verdict guard: omission and forgery both fail closed
// ---------------------------------------------------------------------------------------

describe('validateAnalysisAgainstHandoff: memoryOnPath cannot be forged or omitted', () => {
  it('accepts a verdict whose declared memoryOnPath matches recomputation', () => {
    const artifact = artifactOf(
      [
        verdictFor(0, {
          memoryOnPath: [{ recordId: CANDIDATE_RECORD, trust: 'candidate' }],
          misdirectionRuledOut: evidence([result({ recordId: CANDIDATE_RECORD })]),
        }),
      ],
      [partsFor(0)],
    )
    expect(validateAnalysisAgainstHandoff(artifact, HANDOFF)).toEqual({ ok: true })
  })

  it('rejects a verdict that declares an empty memoryOnPath over a served candidate', () => {
    const artifact = artifactOf([verdictFor(0, { memoryOnPath: [] })], [partsFor(0)])
    expect(reasonsOf(validateAnalysisAgainstHandoff(artifact, HANDOFF)).join('\n')).toContain(
      'memoryOnPath',
    )
  })

  it('rejects a verdict that downgrades a candidate to low-trust-active', () => {
    const artifact = artifactOf(
      [verdictFor(0, { memoryOnPath: [{ recordId: CANDIDATE_RECORD, trust: 'low-trust-active' }] })],
      [partsFor(0)],
    )
    expect(validateAnalysisAgainstHandoff(artifact, HANDOFF).ok).toBe(false)
  })

  it('gates a verdict that cites only the clean step while the actual failing step carried memory', () => {
    const artifact = artifactOf(
      [verdictFor(2, { evidence: { citedSteps: [0], citedAnchors: [], citedArtifacts: [], rationale: 'r' } })],
      [partsFor(2, { groundingQuote: { stepIndex: 0, quote: 'neighbor step 0' } })],
    )
    const validation = validateAnalysisAgainstHandoff(artifact, HANDOFF, {
      gatedProducerEvidence: true,
    })
    expect(validation.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------
// D-19/D-20 — three gated postures, three distinct accepted outcomes
// ---------------------------------------------------------------------------------------

describe('validateAnalysisAgainstHandoff: the three gated postures', () => {
  const gated = { gatedProducerEvidence: true } as const

  it('admits a complete held cross-check under an ordinary evaluation root', () => {
    const artifact = artifactOf(
      [
        verdictFor(0, {
          memoryOnPath: [{ recordId: CANDIDATE_RECORD, trust: 'candidate' }],
          misdirectionRuledOut: evidence([result({ recordId: CANDIDATE_RECORD })]),
        }),
      ],
      [partsFor(0)],
    )
    expect(validateAnalysisAgainstHandoff(artifact, HANDOFF, gated)).toEqual({ ok: true })
  })

  it('admits the declared boolean with declared-only backing when there is NO evaluation root', () => {
    const artifact = artifactOf(
      [
        verdictFor(0, {
          memoryOnPath: [{ recordId: CANDIDATE_RECORD, trust: 'candidate' }],
          misdirectionRuledOut: evidence([], { crossCheck: 'not-run', backing: 'declared-only' }),
        }),
      ],
      [partsFor(0)],
    )
    expect(
      validateAnalysisAgainstHandoff(artifact, HANDOFF, {
        ...gated,
        rootPosture: 'no-eval-root',
      }),
    ).toEqual({ ok: true })
  })

  it('refuses the same declared-only backing when the evaluation root is BROKEN', () => {
    const artifact = artifactOf(
      [
        verdictFor(0, {
          memoryOnPath: [{ recordId: CANDIDATE_RECORD, trust: 'candidate' }],
          misdirectionRuledOut: evidence([], { crossCheck: 'not-run', backing: 'declared-only' }),
        }),
      ],
      [partsFor(0)],
    )
    const reasons = reasonsOf(
      validateAnalysisAgainstHandoff(artifact, HANDOFF, {
        ...gated,
        rootPosture: 'broken-eval-root',
      }),
    )
    expect(reasons.join('\n')).toContain('declared-only')
  })

  it('refuses a gated verdict carrying no evidence at all, for a different reason again', () => {
    const artifact = artifactOf([verdictFor(0)], [partsFor(0)])
    const reasons = reasonsOf(validateAnalysisAgainstHandoff(artifact, HANDOFF, gated))
    expect(reasons).toHaveLength(1)
    expect(reasons.join('\n')).toContain('misdirectionRuledOut')
    expect(reasons.join('\n')).not.toContain('declared-only')
  })

  it('the three gated postures produce three distinct reason sets', () => {
    const withBacking = artifactOf(
      [
        verdictFor(0, {
          misdirectionRuledOut: evidence([], { crossCheck: 'not-run', backing: 'declared-only' }),
        }),
      ],
      [partsFor(0)],
    )
    const noRoot = validateAnalysisAgainstHandoff(withBacking, HANDOFF, {
      ...gated,
      rootPosture: 'no-eval-root',
    })
    const brokenRoot = reasonsOf(
      validateAnalysisAgainstHandoff(withBacking, HANDOFF, {
        ...gated,
        rootPosture: 'broken-eval-root',
      }),
    )
    const missing = reasonsOf(
      validateAnalysisAgainstHandoff(artifactOf([verdictFor(0)], [partsFor(0)]), HANDOFF, gated),
    )
    expect(noRoot.ok).toBe(true)
    expect(brokenRoot).not.toEqual(missing)
    expect(brokenRoot).toHaveLength(1)
    expect(missing).toHaveLength(1)
  })

  it('refuses a flipped cross-check even when the declared boolean is true', () => {
    const artifact = artifactOf(
      [
        verdictFor(0, {
          misdirectionRuledOut: evidence(
            [result({ recordId: CANDIDATE_RECORD, crossCheck: 'flipped' })],
            { crossCheck: 'flipped' },
          ),
        }),
      ],
      [partsFor(0)],
    )
    expect(validateAnalysisAgainstHandoff(artifact, HANDOFF, gated).ok).toBe(false)
  })

  it('leaves an ungated class untouched — no memory on the path, no obligation', () => {
    const artifact = artifactOf([verdictFor(3)], [partsFor(3)])
    expect(validateAnalysisAgainstHandoff(artifact, HANDOFF, gated)).toEqual({ ok: true })
  })

  it('preserves boolean-only historical acceptance when no gated producer is declared', () => {
    const artifact = artifactOf([verdictFor(0)], [partsFor(0)])
    expect(validateAnalysisAgainstHandoff(artifact, HANDOFF)).toEqual({ ok: true })
  })

  it('refuses the SAME bytes once a current gated producer is declared', () => {
    const artifact = artifactOf([verdictFor(0)], [partsFor(0)])
    expect(validateAnalysisAgainstHandoff(artifact, HANDOFF).ok).toBe(true)
    expect(
      validateAnalysisAgainstHandoff(artifact, HANDOFF, { gatedProducerEvidence: true }).ok,
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------
// D-20 — one record, two exposures: the cross-check that clears it on one step says
// nothing about the other, and harm names only the records a flip actually supports
// ---------------------------------------------------------------------------------------

describe('aggregateMisdirectionEvidence: one record served on two steps', () => {
  const sites = deriveMemoryOnPathSites(testAt(4).steps)
  const base = {
    runId: 'run-misdirection-guard',
    perTest: 4,
    handoffBaseDigest: BASE_DIGEST,
    sites,
  }
  const rowAt = (
    stepIndex: number,
    recordId: RecordId,
    crossCheck: MisdirectionRecordResult['crossCheck'],
  ) =>
    result({
      recordId,
      perTest: 4,
      stepIndex,
      briefDigest: stepIndex === 0 ? 'brief-digest-4a' : 'brief-digest-4b',
      crossCheck,
    })

  it('records BOTH exposures of the twice-served record', () => {
    expect(sites).toEqual([
      { stepIndex: 0, recordId: CANDIDATE_RECORD, trust: 'candidate' },
      { stepIndex: 1, recordId: CANDIDATE_RECORD, trust: 'candidate' },
      { stepIndex: 1, recordId: CANARY_RECORD, trust: 'low-trust-active' },
    ])
  })

  it('folds the two exposures to one record-level entry', () => {
    expect(deriveMemoryOnPath(testAt(4).steps)).toEqual([
      { recordId: CANDIDATE_RECORD, trust: 'candidate' },
      { recordId: CANARY_RECORD, trust: 'low-trust-active' },
    ])
  })

  it('holds only when EVERY exposure is covered and held', () => {
    expect(
      aggregateMisdirectionEvidence({
        ...base,
        results: [
          rowAt(0, CANDIDATE_RECORD, 'held'),
          rowAt(1, CANDIDATE_RECORD, 'held'),
          rowAt(1, CANARY_RECORD, 'held'),
        ],
      }),
    ).toEqual({ outcome: 'held', records: [CANDIDATE_RECORD, CANARY_RECORD] })
  })

  it('retains two results for one record, so a second-step flip is not lost', () => {
    const aggregate = aggregateMisdirectionEvidence({
      ...base,
      results: [
        rowAt(0, CANDIDATE_RECORD, 'held'),
        rowAt(1, CANDIDATE_RECORD, 'flipped'),
        rowAt(1, CANARY_RECORD, 'held'),
      ],
    })
    expect(aggregate).toEqual({ outcome: 'flipped', suspect: [CANDIDATE_RECORD] })
  })

  it('attributes harm to the flipped record only, never to its held sibling', () => {
    const aggregate = aggregateMisdirectionEvidence({
      ...base,
      results: [
        rowAt(0, CANDIDATE_RECORD, 'held'),
        rowAt(1, CANDIDATE_RECORD, 'held'),
        rowAt(1, CANARY_RECORD, 'flipped'),
      ],
    })
    if (aggregate.outcome !== 'flipped') throw new Error('expected a flipped aggregate')
    expect(aggregate.suspect).toEqual([CANARY_RECORD])
    expect(aggregate.suspect).not.toContain(CANDIDATE_RECORD)
    // The held sibling is not causal, and it is still DISCLOSED as having been on the path.
    expect(deriveMemoryOnPath(testAt(4).steps).map((entry) => entry.recordId)).toContain(
      CANDIDATE_RECORD,
    )
  })

  it('leaves a record unchecked when only ONE of its two exposures was covered', () => {
    expect(
      aggregateMisdirectionEvidence({
        ...base,
        results: [rowAt(1, CANDIDATE_RECORD, 'held'), rowAt(1, CANARY_RECORD, 'held')],
      }),
    ).toEqual({
      outcome: 'unknown',
      inconclusive: [],
      notRun: [],
      unchecked: [CANDIDATE_RECORD],
    })
  })

  it('refuses a row naming an exposure the briefs never recorded', () => {
    const aggregate = aggregateMisdirectionEvidence({
      ...base,
      results: [
        rowAt(0, CANDIDATE_RECORD, 'held'),
        rowAt(1, CANDIDATE_RECORD, 'held'),
        rowAt(1, CANARY_RECORD, 'held'),
        rowAt(0, CANARY_RECORD, 'held'),
      ],
    })
    expect(aggregate.outcome).toBe('evidence-refused')
  })
})

// ---------------------------------------------------------------------------------------
// D-20 — the four no-trust-change classes are held-gated, and BOTH producers obey it
// ---------------------------------------------------------------------------------------

describe('the no-trust-change classes are held-gated for every producer', () => {
  const gated = { gatedProducerEvidence: true } as const
  const NO_TRUST_CHANGE = ['app_bug', 'flake', 'environment', 'config_error'] as const
  const PRODUCERS = ['deterministic-classifier', 'analyze-run'] as const
  const TRUST_MOVING = ['test_bug', 'llm_error', 'unknown', 'timeout'] as const

  const artifactWith = (
    verdictClass: string,
    producer: string,
    crossCheck: MisdirectionRecordResult['crossCheck'],
  ): RunAnalysisArtifact =>
    artifactOf(
      [
        verdictFor(0, {
          class: verdictClass,
          producer,
          misdirectionRuledOut: evidence(
            [result({ recordId: CANDIDATE_RECORD, crossCheck })],
            { crossCheck },
          ),
        } as Partial<Verdict>),
      ],
      [partsFor(0)],
    )

  for (const producer of PRODUCERS) {
    for (const verdictClass of NO_TRUST_CHANGE) {
      it(`${verdictClass} by ${producer}: held admits, flipped/inconclusive/not-run refuse`, () => {
        expect(
          validateAnalysisAgainstHandoff(artifactWith(verdictClass, producer, 'held'), HANDOFF, gated),
        ).toEqual({ ok: true })
        for (const crossCheck of ['flipped', 'inconclusive', 'not-run'] as const) {
          expect(
            validateAnalysisAgainstHandoff(
              artifactWith(verdictClass, producer, crossCheck),
              HANDOFF,
              gated,
            ).ok,
          ).toBe(false)
        }
      })
    }
  }

  for (const verdictClass of TRUST_MOVING) {
    it(`${verdictClass} moves trust, so it carries no cross-check obligation`, () => {
      const artifact = artifactOf(
        [verdictFor(0, { class: verdictClass, memoryMisdirectionRuledOut: false } as Partial<Verdict>)],
        [partsFor(0)],
      )
      expect(validateAnalysisAgainstHandoff(artifact, HANDOFF, gated)).toEqual({ ok: true })
    })
  }
})
