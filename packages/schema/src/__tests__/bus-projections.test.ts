// Wave-0 RED scaffold (361-01, Task 1). Pins the Plan 03 masked-payload-projection
// contract BEFORE any implementation exists — RED strictly on the unresolved import
// of the not-yet-existing `../run/bus-projections` module (right-reason RED).
//
// Contract source: 361-CONTEXT.md D-09 (every projection routes through the masking
// port; 362 activates it with zero further wiring — proven here with a synthetic mask)
// and D-10 (one pure schema-in/schema-out projection module: StepEvidence→stepFinalized,
// SubActionEvidence→subActionRecorded with states collapsed to screenStateHash identity,
// PerTestOutcome→testFinished never embedding steps). spec/v2/runner.md §2.2 payload discipline.
//
// Schema module-discipline law: extension-less relative import specifiers, no node builtins.
import { describe, expect, it } from 'vitest'

import {
  projectStepFinalized,
  projectSubActionRecorded,
  projectTestFinished,
} from '../run/bus-projections'
import type { MaskFn } from '../run/bus-projections'
import { screenStateHash } from '../determinism/screen-hash'
import { asRef } from '../primitives/ref'
import type { Action } from '../action/index'
import type { ScopeKey } from '../identity/scope-key'
import type { ScreenState } from '../screen/screen-state'
import type { ServedBrief } from '../brief/served-brief'
import type { RecordedActionResult } from '../result/index'
import type { StepEvidence } from '../handoff/step-evidence'
import type { SubActionEvidence } from '../handoff/sub-action-evidence'
import type { PerTestOutcome } from '../handoff/per-test-outcome'

const SECRET = 'SECRET-42'
// The synthetic mask the 362 masking-context will replace (identity pre-362, D-09).
const mask: MaskFn = (value: string) => value.replaceAll(SECRET, '[masked]')

const scope: ScopeKey = { tier: 'test', key: 'checkout::happy-path' }

function makeServedBrief(): ServedBrief {
  return {
    scope,
    asOfBuild: 1,
    budget: 4096,
    truncation: 'none',
    channel1: [],
    channel2: [],
    channel3: [],
    briefDigest: 'brief-digest-deadbeef',
  }
}

function makeScreenState(): ScreenState {
  return {
    platform: 'web',
    tree: `root ${SECRET}`,
    elements: [],
    refMap: {},
    url: `https://example.test/?token=${SECRET}`,
    timestamp: 1_700_000_000_000,
    metadata: {
      captureMode: 'textOnly',
      coordSpace: 'viewport',
      viewportWidth: 1280,
      viewportHeight: 720,
      scroll: { offsetX: 0, offsetY: 0, contentWidth: 1280, contentHeight: 2000 },
    },
  }
}

const plannedAction = { type: 'click', ref: asRef('e2') } as unknown as Action

function makeRecordedResult(): RecordedActionResult {
  return { success: true, data: { note: `value ${SECRET}` } }
}

function makeSubActionEvidence(): SubActionEvidence {
  return {
    plan: `Click the Save button holding ${SECRET}`,
    plannedAction,
    stateBefore: makeScreenState(),
    result: makeRecordedResult(),
  }
}

function makeStepEvidence(withSelfHeal: boolean): StepEvidence {
  const evidence: StepEvidence = {
    stepIndex: 0,
    stepText: `Save the record ${SECRET}`,
    cacheStatus: 'miss',
    servedBrief: makeServedBrief(),
    subActions: [makeSubActionEvidence()],
    verifierVerdict: { pass: true, reasoning: `Record saved (${SECRET})` },
  }
  if (withSelfHeal) {
    const decision = {
      plan: 'retry',
      plannedAction,
      result: makeRecordedResult(),
    }
    evidence.selfHeal = { failedDecision: decision, recoveringDecision: decision }
  }
  return evidence
}

function makePerTestOutcome(): PerTestOutcome {
  return {
    testId: 'checkout::happy-path',
    testIndex: 0,
    outcome: 'passed',
    steps: [makeStepEvidence(false)],
  }
}

describe('projectStepFinalized (D-10, spec §2.2 step lifecycle)', () => {
  it('carries cacheStatus, verifierVerdict, a boolean selfHealOccurred, and a briefDigest string', () => {
    const payload = projectStepFinalized(
      makeStepEvidence(false),
      { testIndex: 0, stepIndex: 0 },
      mask,
    )
    expect(payload.cacheStatus).toBe('miss')
    expect(payload.verifierVerdict.pass).toBe(true)
    expect(typeof payload.selfHealOccurred).toBe('boolean')
    expect(payload.selfHealOccurred).toBe(false)
    expect(typeof payload.briefDigest).toBe('string')
    expect(payload.briefDigest).toBe('brief-digest-deadbeef')
  })

  it('flags selfHealOccurred true when a heal is present — never leaks the full ServedBrief body', () => {
    const payload = projectStepFinalized(
      makeStepEvidence(true),
      { testIndex: 0, stepIndex: 0 },
      mask,
    )
    expect(payload.selfHealOccurred).toBe(true)
    // Payload discipline: the brief travels as a digest, never as the ServedBrief object.
    expect(payload).not.toHaveProperty('servedBrief')
  })

  it('routes evidence string fields through the mask (D-09 identity-pre-362 proof)', () => {
    const payload = projectStepFinalized(
      makeStepEvidence(false),
      { testIndex: 0, stepIndex: 0 },
      mask,
    )
    expect(JSON.stringify(payload)).not.toContain(SECRET)
    expect(payload.verifierVerdict.reasoning).toContain('[masked]')
  })

  it('JSON-round-trips deep-equal (JSON-serializable, no functions/undefined holes)', () => {
    const payload = projectStepFinalized(
      makeStepEvidence(true),
      { testIndex: 0, stepIndex: 0 },
      mask,
    )
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload)
  })
})

describe('projectSubActionRecorded (D-10, spec §2.2 sub-action tick)', () => {
  it('collapses stateBefore to a screenStateHash string and carries result as RecordedActionResult', () => {
    const sub = makeSubActionEvidence()
    const payload = projectSubActionRecorded(
      sub,
      { testIndex: 0, stepIndex: 0, subActionIndex: 0 },
      mask,
    )
    expect(payload.screenStateHash).toBe(screenStateHash(sub.stateBefore))
    expect(typeof payload.screenStateHash).toBe('string')
    // The full ScreenState never rides the bus — only its identity hash.
    expect(payload).not.toHaveProperty('stateBefore')
    expect(payload.result.success).toBe(true)
    expect(payload.result).not.toHaveProperty('screenshot')
  })

  it('masks planted secrets and JSON-round-trips deep-equal', () => {
    const payload = projectSubActionRecorded(
      makeSubActionEvidence(),
      { testIndex: 0, stepIndex: 0, subActionIndex: 0 },
      mask,
    )
    expect(JSON.stringify(payload)).not.toContain(SECRET)
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload)
  })
})

describe('projectTestFinished (D-10, spec §2.2 member-test lifecycle)', () => {
  it('carries the PerTestOutcome identity + outcome but never the embedded steps', () => {
    const payload = projectTestFinished(makePerTestOutcome(), mask)
    expect(payload.testId).toBe('checkout::happy-path')
    expect(payload.testIndex).toBe(0)
    expect(payload.outcome).toBe('passed')
    expect(payload).not.toHaveProperty('steps')
  })

  it('JSON-round-trips deep-equal', () => {
    const payload = projectTestFinished(makePerTestOutcome(), mask)
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload)
  })
})
