// The circularity evidence's ARTIFACT leg (Phase 422, plan 12 — D-17).
//
// `analysis.json` is where an authored verdict goes to be read back by somebody else: the run
// page, chat, eval, and the canary fold all reach a verdict through `guardRunAnalysisArtifact`
// and then `resolveRunVerdicts`. Two failures would be invisible at that boundary and are
// asserted against here.
//
//   1. SILENT STRIPPING. A malformed present evidence block that the guard drops rather than
//      refuses leaves a reader looking at a verdict whose claim has disappeared — which reads
//      exactly like a verdict that never made the claim. The block exists to make a claim
//      visible, so a broken one is refused.
//
//   2. FABRICATED BACKING. The deterministic floor mints an `unknown` verdict for a failed
//      member with no persisted root cause. That minted verdict must carry NO evidence block at
//      all. A floor that minted `{crossCheck: 'held'}` would be the build asserting a
//      cross-check nobody ran, on the exact population where nothing is known.
//
// `resolveVerdictMisdirection` is the three-way reading those consumers need, and its arms are
// deliberately not two: `not-recorded` (nothing was ever written — every pre-422 verdict),
// `declared-only` (D-19's absent evaluation root, the author's word and an explicit marker that
// it is only the author's word) and `measured` (a real per-record ledger). Collapsing
// `not-recorded` into `declared-only` would hand a pre-422 verdict a backing claim it never
// made; collapsing it into `measured` would be worse.

import { describe, expect, it } from 'vitest'

import type { BriefLine, ServedBrief } from '../../brief/served-brief'
import type { CompletedRunHandoff } from '../../handoff/completed-run-handoff'
import type { PerTestOutcome } from '../../handoff/per-test-outcome'
import type { StepEvidence } from '../../handoff/step-evidence'
import { asRecordId } from '../../ids/record-id'
import { asRef } from '../../primitives/ref'
import { asRunId } from '../../run/run-id'
import {
  admitAnalysisArtifactForRun,
  ANALYSIS_MIGRATIONS,
  CURRENT_ANALYSIS_SCHEMA_VERSION,
  guardRunAnalysisArtifact,
} from '../analysis-artifact'
import type { RunAnalysisArtifact } from '../analysis-artifact'
import { MISDIRECTION_BACKINGS, misdirectionSourceDigest } from '../misdirection-evidence'
import type { MisdirectionRecordResult } from '../misdirection-evidence'
import { resolveRunVerdicts, resolveVerdictMisdirection } from '../resolved-verdicts'
import { VERDICT_CLASSES } from '../verdict'
import type { Verdict } from '../verdict'

const RUN_ID = 'run-misdirection-artifact'
const CANDIDATE_RECORD = asRecordId('rec_mem_candidate')
const CANARY_RECORD = asRecordId('rec_mem_canary')

function briefLine(overrides: Partial<BriefLine> = {}): BriefLine {
  return {
    id: CANDIDATE_RECORD,
    kind: 'fact',
    summary: 'the checkout form autosaves',
    trust: 0.4,
    status: 'candidate',
    servedAsCanary: false,
    tier: 'L2',
    ...overrides,
  }
}

function servedBrief(lines: BriefLine[]): ServedBrief {
  return {
    scope: { tier: 'product', key: 'misdirection-artifact' },
    asOfBuild: 1,
    budget: 0,
    truncation: 'none',
    channel1: lines,
    channel2: [],
    channel3: [],
    briefDigest: 'brief-digest-1',
  }
}

function failingStep(stepIndex: number): StepEvidence {
  return {
    stepIndex,
    stepText: 'click the Submit button on the checkout screen',
    cacheStatus: 'miss',
    servedBrief: servedBrief([
      briefLine(),
      briefLine({ id: CANARY_RECORD, status: 'active', servedAsCanary: true, trust: 0.6 }),
    ]),
    subActions: [
      {
        plan: 'click the Submit button',
        plannedAction: { type: 'click', ref: asRef('e1') },
        stateBefore: {
          platform: 'web',
          tree: '',
          elements: [],
          refMap: {},
          url: '/checkout',
          timestamp: 1,
          metadata: {
            coordSpace: 'viewport',
            viewportWidth: 1280,
            viewportHeight: 720,
            scroll: { offsetX: 0, offsetY: 0, contentWidth: 1280, contentHeight: 720 },
            captureMode: 'textOnly',
          },
        },
        result: { success: false, error: 'Error: element "Submit" not found' },
      },
    ],
    verifierVerdict: { pass: false, reasoning: 'the submit button never appeared' },
  }
}

function member(testIndex: number, rootCause?: Verdict): PerTestOutcome {
  return {
    testId: `t_${testIndex}`,
    testName: `member ${testIndex}`,
    filePath: `tests/member-${testIndex}.yaml`,
    testIndex,
    outcome: 'failed',
    steps: [failingStep(0)],
    ...(rootCause === undefined ? {} : { rootCause }),
  }
}

function handoffWith(tests: PerTestOutcome[]): CompletedRunHandoff {
  return {
    schemaVersion: 7,
    runId: asRunId(RUN_ID),
    scope: { tier: 'product', key: 'misdirection-artifact' },
    buildOrdinal: 3,
    executionContext: 'local-headless',
    aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
    startedAt: 1,
    endedAt: 2,
    tests,
  }
}

const BASE_DIGEST = misdirectionSourceDigest(handoffWith([]))

function row(overrides: Partial<MisdirectionRecordResult> = {}): MisdirectionRecordResult {
  return {
    runId: RUN_ID,
    perTest: 0,
    stepIndex: 0,
    decisionOrdinal: 0,
    recordId: CANDIDATE_RECORD,
    handoffBaseDigest: BASE_DIGEST,
    briefDigest: 'brief-digest-1',
    corpusDigest: 'corpus-digest-1',
    profileDigest: 'profile-digest-1',
    crossCheck: 'held',
    seedHonored: true,
    ...overrides,
  }
}

const HELD_ROWS: MisdirectionRecordResult[] = [
  row({ samples: { k: 2, seeds: [4, 5], modelCalls: 2 } }),
  row({ recordId: CANARY_RECORD, stepIndex: 1 }),
]

const FLIPPED_ROWS: MisdirectionRecordResult[] = [
  row({ crossCheck: 'flipped', reason: 'removing the record made the step pass' }),
  row({ recordId: CANARY_RECORD, stepIndex: 1 }),
]

/** A verdict that DECLARES the two on-path records and carries a real per-record ledger. */
function measuredVerdict(
  results: MisdirectionRecordResult[],
  overrides: Partial<Verdict> = {},
): Verdict {
  return {
    class: 'app_bug',
    producer: 'analyze-run',
    confidence: 0.8,
    evidence: {
      citedSteps: [0],
      citedAnchors: [],
      citedArtifacts: [],
      rationale: 'the submit endpoint returned 500',
    },
    attribution: { records: [CANDIDATE_RECORD], anchors: [] },
    memoryMisdirectionRuledOut: true,
    perTest: 0,
    memoryOnPath: [
      { recordId: CANDIDATE_RECORD, trust: 'candidate' },
      { recordId: CANARY_RECORD, trust: 'low-trust-active' },
    ],
    misdirectionRuledOut: { crossCheck: results[0]!.crossCheck, results },
    ...overrides,
  } as Verdict
}

/** D-19's one exemption: no evaluation root existed, so the author's word is all there is. */
function declaredOnlyVerdict(): Verdict {
  return measuredVerdict(HELD_ROWS, {
    misdirectionRuledOut: { crossCheck: 'not-run', results: [], backing: 'declared-only' },
  })
}

/** A pre-422 verdict: the frozen boolean and nothing beside it. */
function historicalVerdict(): Verdict {
  const { memoryOnPath: _a, misdirectionRuledOut: _b, ...rest } = measuredVerdict(HELD_ROWS)
  return rest as Verdict
}

function artifactWith(verdicts: Verdict[]): RunAnalysisArtifact {
  return {
    schemaVersion: CURRENT_ANALYSIS_SCHEMA_VERSION,
    runId: RUN_ID,
    verdicts,
    parts: [],
  }
}

function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

describe('guardRunAnalysisArtifact with circularity evidence (422 D-17)', () => {
  it('round-trips a verdict carrying both members, every row, and its attribution', () => {
    const guarded = guardRunAnalysisArtifact(wire(artifactWith([measuredVerdict(HELD_ROWS)])))
    const verdict = guarded.verdicts[0]

    expect(verdict?.misdirectionRuledOut?.results).toEqual(HELD_ROWS)
    expect(verdict?.misdirectionRuledOut?.results[0]?.samples).toEqual({
      k: 2,
      seeds: [4, 5],
      modelCalls: 2,
    })
    expect(verdict?.memoryOnPath).toEqual([
      { recordId: CANDIDATE_RECORD, trust: 'candidate' },
      { recordId: CANARY_RECORD, trust: 'low-trust-active' },
    ])
    expect(verdict?.attribution).toEqual({ records: [CANDIDATE_RECORD], anchors: [] })
  })

  it('preserves the declared-only backing marker exactly', () => {
    const guarded = guardRunAnalysisArtifact(wire(artifactWith([declaredOnlyVerdict()])))

    expect(guarded.verdicts[0]?.misdirectionRuledOut?.backing).toBe('declared-only')
    expect(guarded.verdicts[0]?.misdirectionRuledOut?.results).toEqual([])
  })

  it('reads a historical artifact with both members absent and invents no backing', () => {
    const guarded = guardRunAnalysisArtifact(wire(artifactWith([historicalVerdict()])))
    const verdict = guarded.verdicts[0]

    expect(verdict?.memoryMisdirectionRuledOut).toBe(true)
    expect(verdict === undefined ? true : 'memoryOnPath' in verdict).toBe(false)
    expect(verdict === undefined ? true : 'misdirectionRuledOut' in verdict).toBe(false)
  })

  it('refuses a malformed misdirectionRuledOut rather than stripping it', () => {
    expect(() =>
      guardRunAnalysisArtifact(
        wire(artifactWith([measuredVerdict(HELD_ROWS, { misdirectionRuledOut: {} as never })])),
      ),
    ).toThrow()
    expect(() =>
      guardRunAnalysisArtifact(
        wire(
          artifactWith([
            measuredVerdict(HELD_ROWS, {
              misdirectionRuledOut: {
                crossCheck: 'held',
                results: [{ ...row(), recordId: '' }],
              } as never,
            }),
          ]),
        ),
      ),
    ).toThrow()
  })

  it('refuses a backing word outside the closed vocabulary', () => {
    expect(MISDIRECTION_BACKINGS).toEqual(['declared-only'])
    expect(() =>
      guardRunAnalysisArtifact(
        wire(
          artifactWith([
            measuredVerdict(HELD_ROWS, {
              misdirectionRuledOut: { crossCheck: 'held', results: [], backing: 'measured' } as never,
            }),
          ]),
        ),
      ),
    ).toThrow()
  })

  it('refuses a memoryOnPath outside the closed two-word trust vocabulary', () => {
    expect(() =>
      guardRunAnalysisArtifact(
        wire(
          artifactWith([
            measuredVerdict(HELD_ROWS, {
              memoryOnPath: [{ recordId: CANDIDATE_RECORD, trust: 'canary' }] as never,
            }),
          ]),
        ),
      ),
    ).toThrow()
    expect(() =>
      guardRunAnalysisArtifact(
        wire(
          artifactWith([
            measuredVerdict(HELD_ROWS, { memoryOnPath: { recordId: CANDIDATE_RECORD } as never }),
          ]),
        ),
      ),
    ).toThrow()
  })

  it('keeps the artifact version at 1, its empty ladder, and the eight-class union', () => {
    expect(CURRENT_ANALYSIS_SCHEMA_VERSION).toBe(1)
    expect(Object.keys(ANALYSIS_MIGRATIONS)).toEqual([])
    expect(VERDICT_CLASSES).toHaveLength(8)
  })

  it('still refuses a foreign run whole, evidence and all', () => {
    const artifact = guardRunAnalysisArtifact(wire(artifactWith([measuredVerdict(HELD_ROWS)])))
    const admission = admitAnalysisArtifactForRun(artifact, 'run-somebody-else')

    expect(admission.kind).toBe('run-mismatch')
  })
})

describe('resolveRunVerdicts retains the evidence it resolves (422 D-17)', () => {
  it('serves the authored verdicts whole when the artifact is present', () => {
    const artifact = guardRunAnalysisArtifact(wire(artifactWith([measuredVerdict(HELD_ROWS)])))
    const resolved = resolveRunVerdicts(artifact, handoffWith([member(0)]))

    expect(resolved[0]?.misdirectionRuledOut?.results).toEqual(HELD_ROWS)
    expect(resolved[0]?.memoryOnPath).toHaveLength(2)
    expect(resolved[0]?.attribution?.records).toEqual([CANDIDATE_RECORD])
  })

  it('never softens a flipped row into a held one on the way through', () => {
    const artifact = guardRunAnalysisArtifact(wire(artifactWith([measuredVerdict(FLIPPED_ROWS)])))
    const resolved = resolveRunVerdicts(artifact, handoffWith([member(0)]))

    expect(resolved[0]?.misdirectionRuledOut?.results[0]?.crossCheck).toBe('flipped')
    expect(resolved[0]?.misdirectionRuledOut?.results[0]?.reason).toBe(
      'removing the record made the step pass',
    )
  })

  it('carries the deterministic floor’s persisted evidence when no artifact exists', () => {
    const persisted = measuredVerdict(HELD_ROWS, { producer: 'deterministic-classifier' })
    const resolved = resolveRunVerdicts(undefined, handoffWith([member(0, persisted)]))

    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.misdirectionRuledOut?.results).toEqual(HELD_ROWS)
  })

  it('mints an unknown with NO evidence block for a failed member that persisted none', () => {
    const resolved = resolveRunVerdicts(undefined, handoffWith([member(0)]))
    const minted = resolved[0]

    expect(minted?.class).toBe('unknown')
    expect(minted === undefined ? true : 'misdirectionRuledOut' in minted).toBe(false)
    expect(minted === undefined ? true : 'memoryOnPath' in minted).toBe(false)
  })
})

describe('resolveVerdictMisdirection (422 D-17/D-19 three-way reading)', () => {
  it('reports a real per-record ledger as measured, with the declaration beside it', () => {
    const view = resolveVerdictMisdirection(measuredVerdict(HELD_ROWS))

    expect(view.state).toBe('measured')
    expect(view.state === 'measured' ? view.evidence.results : []).toEqual(HELD_ROWS)
    expect(view.state === 'measured' ? view.memoryOnPath : undefined).toHaveLength(2)
  })

  it('reports the absent-root posture as declared-only, never as measured', () => {
    const view = resolveVerdictMisdirection(declaredOnlyVerdict())

    expect(view.state).toBe('declared-only')
    expect(view.state === 'declared-only' ? view.evidence.backing : undefined).toBe('declared-only')
  })

  it('reports a pre-422 verdict as not-recorded — never held, never declared-only', () => {
    const view = resolveVerdictMisdirection(historicalVerdict())

    expect(view.state).toBe('not-recorded')
  })

  it('reports the minted floor unknown as not-recorded', () => {
    const minted = resolveRunVerdicts(undefined, handoffWith([member(0)]))[0]!

    expect(resolveVerdictMisdirection(minted).state).toBe('not-recorded')
  })

  it('keeps an ABSENT memoryOnPath absent on a measured verdict, never an empty array', () => {
    const { memoryOnPath: _dropped, ...withoutDeclaration } = measuredVerdict(HELD_ROWS)
    const view = resolveVerdictMisdirection(withoutDeclaration as Verdict)

    expect(view.state).toBe('measured')
    expect(view.state === 'measured' ? 'memoryOnPath' in view : true).toBe(false)
  })
})
