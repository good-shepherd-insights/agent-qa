// Behavior tests for the §A8 evidence module (353-03, SCREEN-02 / D-14). Evidence is
// produced by construction as schema DTOs; the legacy trace is projected from it.
import { describe, it, expect } from 'vitest'
import { asRef, computeBriefDigest } from '@vostride/agent-qa-schema'
import type { Action, ArtifactRef, Decision, MaskingContext, ScopeKey, SubActionEvidence, VerifierVerdict } from '@vostride/agent-qa-schema'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import type { Action as PlatformAction, ActionResult as PlatformActionResult } from '../../platform.js'
import {
  EvidenceRecorder,
  collapseAnnotation,
  foldCacheStatus,
  makeEmptyServedBrief,
  projectLegacyTrace,
} from '../evidence.js'
import { executeStep } from '../index.js'
import { makeAdapter, makePlanner, makeStepContext, makeVerifier } from './loop-harness.js'

// Schema Action (branded Ref) for the stored §A8 evidence; the runner-platform Action
// (plain-string ref) for collapseAnnotation, which consumes the adapter's legacy shape.
const clickAction: Action = { type: 'click', ref: asRef('e2') }
const clickPlatform: PlatformAction = { type: 'click', ref: asRef('e2') }
const passVerdict: VerifierVerdict = { pass: true, reasoning: 'goal met' }

describe('EvidenceRecorder.recordSubAction', () => {
  it('stores stateBefore as the FULL ScreenState with elements and refMap intact (Pitfall 3)', () => {
    const recorder = new EvidenceRecorder()
    const stateBefore = makeScreenState()
    recorder.recordSubAction({
      plan: 'click the login button',
      plannedAction: clickAction,
      stateBefore,
      result: { success: true },
    })

    const step = recorder.finalize(passVerdict, 0, 'log in')
    const stored = step.subActions[0].stateBefore

    expect(stored.elements.length).toBeGreaterThan(0)
    expect(Object.keys(stored.refMap).length).toBeGreaterThan(0)
    expect(stored.elements).toEqual(stateBefore.elements)
    expect(stored.refMap).toEqual(stateBefore.refMap)
  })

  it('passes result through toRecordedActionResult — no screenshot bytes are stored (T-353-06)', () => {
    const recorder = new EvidenceRecorder()
    recorder.recordSubAction({
      plan: 'tap submit',
      plannedAction: clickAction,
      stateBefore: makeScreenState(),
      result: { success: true, screenshot: new Uint8Array([1, 2, 3, 4]), data: { ok: true } },
    })

    const step = recorder.finalize(passVerdict, 0, 'submit')
    const stored = step.subActions[0].result

    expect('screenshot' in stored).toBe(false)
    expect(stored.success).toBe(true)
    expect(stored.data).toEqual({ ok: true })
  })
})

describe('EvidenceRecorder.recordSubAction — artifact references (CASS-02)', () => {
  const decisionRef: ArtifactRef = { id: 'decision-screenshot:abc', sha: 'a'.repeat(64) }
  const auxRefs: ArtifactRef[] = [
    { id: 'aux:1', sha: 'b'.repeat(64) },
    { id: 'aux:2', sha: 'c'.repeat(64) },
  ]

  it('copies a supplied decisionScreenshotRef byte-for-byte into the recorded evidence', () => {
    const recorder = new EvidenceRecorder()
    recorder.recordSubAction({
      plan: 'click',
      plannedAction: clickAction,
      stateBefore: makeScreenState(),
      result: { success: true },
      decisionScreenshotRef: decisionRef,
    })
    const step = recorder.finalize(passVerdict, 0, 'click')
    expect(step.subActions[0].decisionScreenshotRef).toEqual(decisionRef)
  })

  it('preserves supplied auxiliary artifactRefs order and identity', () => {
    const recorder = new EvidenceRecorder()
    recorder.recordSubAction({
      plan: 'click',
      plannedAction: clickAction,
      stateBefore: makeScreenState(),
      result: { success: true },
      artifactRefs: auxRefs,
    })
    const step = recorder.finalize(passVerdict, 0, 'click')
    expect(step.subActions[0].artifactRefs).toEqual(auxRefs)
    // shallow copy — a mutation of the stored array must not alias the input
    expect(step.subActions[0].artifactRefs).not.toBe(auxRefs)
  })

  it('leaves both artifact fields structurally absent when not supplied', () => {
    const recorder = new EvidenceRecorder()
    recorder.recordSubAction({
      plan: 'click',
      plannedAction: clickAction,
      stateBefore: makeScreenState(),
      result: { success: true },
    })
    const step = recorder.finalize(passVerdict, 0, 'click')
    expect('decisionScreenshotRef' in step.subActions[0]).toBe(false)
    expect('artifactRefs' in step.subActions[0]).toBe(false)
  })

  it('records the ArtifactRef while the inline result screenshot bytes stay excluded (T-353-06)', () => {
    const recorder = new EvidenceRecorder()
    recorder.recordSubAction({
      plan: 'tap submit',
      plannedAction: clickAction,
      stateBefore: makeScreenState(),
      result: { success: true, screenshot: new Uint8Array([9, 9, 9]) },
      decisionScreenshotRef: decisionRef,
    })
    const step = recorder.finalize(passVerdict, 0, 'submit')
    expect('screenshot' in step.subActions[0].result).toBe(false)
    expect(step.subActions[0].decisionScreenshotRef).toEqual(decisionRef)
  })

  it('emits the artifact-bearing evidence through onSubActionRecorded', () => {
    const observed: SubActionEvidence[] = []
    const recorder = new EvidenceRecorder({
      onSubActionRecorded: (evidence) => observed.push(evidence),
    })
    recorder.recordSubAction({
      plan: 'click',
      plannedAction: clickAction,
      stateBefore: makeScreenState(),
      result: { success: true },
      decisionScreenshotRef: decisionRef,
      artifactRefs: auxRefs,
    })
    expect(observed).toHaveLength(1)
    expect(observed[0].decisionScreenshotRef).toEqual(decisionRef)
    expect(observed[0].artifactRefs).toEqual(auxRefs)
  })
})

describe('makeEmptyServedBrief', () => {
  it('returns a self-consistent digest over empty channels (Pitfall 4 / D-05)', () => {
    const scope: ScopeKey = { tier: 'test', key: 'checkout' }
    const brief = makeEmptyServedBrief(scope, 42)

    expect(brief.channel1).toEqual([])
    expect(brief.channel2).toEqual([])
    expect(brief.channel3).toEqual([])
    expect(brief.budget).toBe(0)
    expect(brief.truncation).toContain('no brief served')
    expect(brief.briefDigest).toBe(computeBriefDigest(brief))
  })
})

describe('foldCacheStatus', () => {
  it('all-hit ⇒ hit', () => {
    expect(foldCacheStatus([true, true, true])).toBe('hit')
  })

  it('any-miss ⇒ miss', () => {
    expect(foldCacheStatus([true, false, true])).toBe('miss')
  })

  it('empty step ⇒ hit vacuously', () => {
    expect(foldCacheStatus([])).toBe('hit')
  })
})

describe('projectLegacyTrace', () => {
  it('produces the v1 string-shaped trace from a populated StepEvidence (tree round-trips)', () => {
    const recorder = new EvidenceRecorder()
    const before = makeScreenState()
    const after = makeScreenState({ url: 'https://example.test/after' })
    const idx = recorder.recordSubAction({
      plan: 'click the login button',
      plannedAction: clickAction,
      stateBefore: before,
      result: { success: true, data: 'v' },
      cached: true,
    })
    recorder.attachStateAfter(idx, after)

    const step = recorder.finalize(passVerdict, 0, 'log in')
    const trace = projectLegacyTrace(step)

    expect(trace).toHaveLength(1)
    expect(trace[0].index).toBe(0)
    expect(trace[0].screenStateBefore).toBe(before.tree)
    expect(trace[0].observation).toBe(before.tree)
    expect(trace[0].screenStateAfter).toBe(after.tree)
    expect(trace[0].result).toBe('success')
    expect(trace[0].reasoning).toBe('click the login button')
    expect(trace[0].plannedAction).toEqual(clickAction)
    expect(trace[0].data).toBe('v')
    // richer→poorer: the legacy trace is strings only, never the full ScreenState.
    expect(typeof trace[0].screenStateBefore).toBe('string')
  })

  it('projects a collapsed annotation onto the legacy StepAnnotation', () => {
    const recorder = new EvidenceRecorder()
    const exec: PlatformActionResult = { success: true, coordinates: { x: 40, y: 50 }, boundingBox: { x: 10, y: 20, width: 60, height: 30 } }
    const annotation = collapseAnnotation(clickPlatform, exec, { width: 390, height: 844 })
    recorder.recordSubAction({
      plan: 'click',
      plannedAction: clickAction,
      stateBefore: makeScreenState(),
      result: { success: true, annotation },
    })

    const step = recorder.finalize(passVerdict, 0, 'click')
    const trace = projectLegacyTrace(step)

    expect(trace[0].annotation?.type).toBe('click')
    expect(trace[0].annotation?.clickPoint).toEqual({ x: 40, y: 50 })
    expect(trace[0].annotation?.boundingBox).toEqual({ x: 10, y: 20, width: 60, height: 30 })
  })
})

describe('EvidenceRecorder.recordSelfHeal', () => {
  it('stores the {failedDecision, recoveringDecision} pair on the finalized StepEvidence (D-12)', () => {
    const recorder = new EvidenceRecorder()
    recorder.recordSubAction({
      plan: 'click wrong element',
      plannedAction: clickAction,
      stateBefore: makeScreenState(),
      result: { success: false, error: 'element not found' },
    })

    const failedDecision: Decision = {
      plan: 'click wrong element',
      plannedAction: clickAction,
      result: { success: false, error: 'element not found' },
    }
    const recoveringDecision: Decision = {
      plan: 'click the correct element',
      plannedAction: { type: 'click', ref: asRef('e1') },
      result: { success: true },
    }
    recorder.recordSelfHeal(failedDecision, recoveringDecision)

    const step = recorder.finalize({ pass: true, reasoning: 'recovered' }, 1, 'log in')

    expect(step.selfHeal).toBeDefined()
    expect(step.selfHeal?.failedDecision).toEqual(failedDecision)
    expect(step.selfHeal?.recoveringDecision).toEqual(recoveringDecision)
  })
})

describe('collapseAnnotation', () => {
  it('maps a click execResult onto the schema point annotation', () => {
    const exec: PlatformActionResult = { success: true, coordinates: { x: 40, y: 50 } }
    const annotation = collapseAnnotation(clickPlatform, exec, { width: 390, height: 844 })
    expect(annotation.kind).toBe('point')
    if (annotation.kind === 'point') {
      expect(annotation.point.x).toBe(40)
      expect(annotation.point.y).toBe(50)
    }
  })

  it('maps a swipe execResult onto the schema path annotation', () => {
    const swipe: PlatformAction = { type: 'swipe', mode: 'direction', direction: 'up', durationMs: 300 }
    const exec: PlatformActionResult = { success: true, startCoordinates: { x: 10, y: 200 }, endCoordinates: { x: 10, y: 40 } }
    const annotation = collapseAnnotation(swipe, exec, { width: 390, height: 844 })
    expect(annotation.kind).toBe('path')
    if (annotation.kind === 'path') {
      expect(annotation.path.start).toEqual({ x: 10, y: 200 })
      expect(annotation.path.end).toEqual({ x: 10, y: 40 })
    }
    expect(annotation.direction).toBe('up')
  })
})

// ---------------------------------------------------------------------------
// 381-41 (G-381-3 capture half · PROC-01 · D-03/D-08): variable-name provenance
// ---------------------------------------------------------------------------

describe('EvidenceRecorder.finalize — interpolatedVariables stamp', () => {
  const pairs = [
    { name: 'PROBE_USER', value: 'qa.user@example.com' },
    { name: 'PROBE_ORDER', value: 'ORD-123' },
  ]

  it('stamps the supplied pairs verbatim onto the finalized StepEvidence', () => {
    const recorder = new EvidenceRecorder()
    const step = recorder.finalize(passVerdict, 0, 'log in as qa.user@example.com', {
      interpolatedVariables: pairs,
    })
    expect(step.interpolatedVariables).toEqual(pairs)
  })

  it('leaves the field structurally ABSENT when the loop supplied nothing', () => {
    const recorder = new EvidenceRecorder()
    const step = recorder.finalize(passVerdict, 0, 'log in')
    expect('interpolatedVariables' in step).toBe(false)
  })

  it('leaves the field structurally ABSENT for an empty list (base fixture unchanged)', () => {
    const recorder = new EvidenceRecorder()
    const step = recorder.finalize(passVerdict, 0, 'log in', { interpolatedVariables: [] })
    expect('interpolatedVariables' in step).toBe(false)
  })

  it('copies the list — a later mutation of the input never aliases the evidence', () => {
    const recorder = new EvidenceRecorder()
    const input = [{ name: 'PROBE_USER', value: 'qa.user@example.com' }]
    const step = recorder.finalize(passVerdict, 0, 'log in', { interpolatedVariables: input })
    expect(step.interpolatedVariables).not.toBe(input)
    expect(step.interpolatedVariables).toEqual(input)
  })
})

// GREEN-ONLY REGRESSION GUARDS (no pre-fix path can make these red — the field did not
// exist before this plan). They exist to stop a future "hardening" change from routing the
// provenance value through maskValue at the loop's finalize call site. Masking here would
// transform email-valued and credential-named bindings while plannedAction stayed raw,
// breaking the emit fold's exact-string classification and REINTRODUCING G-381-3.
describe('executeStep — provenance pairs are never masked (G-381-3 regression guard)', () => {
  // A masking port that WOULD transform both shapes the real mask() transforms:
  // emails (unconditional, registration-free) and credential-NAMED env values
  // (sensitiveEnvSlice registers by name suffix).
  const transformingMasking = {
    mask: (text: string) => `MASKED(${text})`,
    unmask: (text: string) => text,
  } as unknown as MaskingContext

  async function stampedPairs(
    interpolatedVariables: { name: string; value: string }[],
  ): Promise<unknown> {
    const result = await executeStep(
      'log in',
      { adapter: makeAdapter(), planner: makePlanner(), verifier: makeVerifier(), masking: transformingMasking } as never,
      makeStepContext({ interpolatedVariables }),
    )
    return (result.evidence as { interpolatedVariables?: unknown } | undefined)
      ?.interpolatedVariables
  }

  it('an EMAIL-valued binding survives byte-identically through a transforming masking port', async () => {
    const pair = { name: 'PROBE_USER', value: 'qa.user@example.com' }
    expect(await stampedPairs([pair])).toEqual([pair])
  })

  it('a CREDENTIAL-NAMED binding survives byte-identically through a transforming masking port', async () => {
    const pair = { name: 'PROBE_API_TOKEN', value: 'tok-live-9f3a2b' }
    expect(await stampedPairs([pair])).toEqual([pair])
  })
})
