// 2026-10-08, 436-13 (D-18, D-17): the runtime key sets beside the new limit, usage and operation
// evidence types, the planner-limit defaults and the run's limits record. They govern the persisted
// values new runs write: StepEvidence.limitStop and .limitUsage, SubActionEvidence.operationEvidence,
// StepEvidence.operationCapture, CompletedRunHandoff.plannerLimits and the runs.start acknowledgement's
// limits, all optional at CURRENT_HANDOFF_SCHEMA_VERSION 7. localEffect, stagnation and cycle stay
// reader-only. Every expected set is spelled by hand, never derived from the module under test.
import { readFileSync } from 'node:fs'

import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  CLIPBOARD_EVIDENCE_KEYS,
  CURRENT_HANDOFF_SCHEMA_VERSION,
  DEFAULT_PLANNER_LIMITS,
  DOWNLOAD_EVIDENCE_KEYS,
  LIMIT_STOP_EVIDENCE_KEYS,
  OPERATION_CAPTURE_AVAILABILITY_KEYS,
  PLANNER_LIMIT_KEYS,
  PlannerLimitsRecordSchema,
  projectSubActionRecorded,
  RunStartAcknowledgementSchema,
  STEP_LIMIT_USAGE_KEYS,
} from '../index'
import type {
  ClipboardEvidence,
  CompletedRunHandoff,
  DownloadEvidence,
  LimitStopEvidence,
  OperationCaptureAvailability,
  PlannerLimits,
  StepLimitUsage,
} from '../index'

type Shaped = { shape: Record<string, unknown> }
type Wrapped = { unwrap(): unknown }

const sorted = (values: readonly string[]) => [...values].sort()
const keysOf = (value: unknown): string[] => Object.keys((value as Shaped).shape).sort()

describe('C436-KEY-SETS', () => {
  it('the limit stop carries exactly its seven members', () => {
    expect(sorted(LIMIT_STOP_EVIDENCE_KEYS)).toEqual([
      'configured', 'lastPlannerReasoning', 'lastVerifierRejection', 'limit', 'reason', 'requestedOutcome', 'used',
    ])
    expectTypeOf<keyof LimitStopEvidence>().toEqualTypeOf<(typeof LIMIT_STOP_EVIDENCE_KEYS)[number]>()
  })

  it('the per-step usage carries exactly its six members', () => {
    expect(sorted(STEP_LIMIT_USAGE_KEYS)).toEqual([
      'actionsUsed', 'compoundInputs', 'judgeCalls', 'limits', 'planningCallsUsed', 'verifierCalls',
    ])
    expectTypeOf<keyof StepLimitUsage>().toEqualTypeOf<(typeof STEP_LIMIT_USAGE_KEYS)[number]>()
  })

  it('the planner limits are the action and planning-turn pair, defaulting to 30 and 30', () => {
    expect(sorted(PLANNER_LIMIT_KEYS)).toEqual(['maxActions', 'maxPlanningTurns'])
    expectTypeOf<keyof PlannerLimits>().toEqualTypeOf<(typeof PLANNER_LIMIT_KEYS)[number]>()
    expect(DEFAULT_PLANNER_LIMITS).toEqual({ maxActions: 30, maxPlanningTurns: 30 })
    expect(Object.isFrozen(DEFAULT_PLANNER_LIMITS)).toBe(true)
  })

  it('the run limits record names its per-test entries and nothing else', () => {
    expect(keysOf(PlannerLimitsRecordSchema)).toEqual(['maxActions', 'maxPlanningTurns', 'perTest'])
    const perTest = (PlannerLimitsRecordSchema.shape.perTest as unknown as Wrapped).unwrap() as { element: unknown }
    expect(keysOf(perTest.element)).toEqual(['filePath', 'maxActions', 'maxPlanningTurns', 'testName'])
    const ackLimits = (RunStartAcknowledgementSchema.shape.limits as unknown as Wrapped).unwrap()
    expect(keysOf(ackLimits)).toEqual(['maxActions', 'maxPlanningTurns', 'perTest'])
  })

  it('download, clipboard and capture-availability evidence carry exactly their members', () => {
    // 2026-10-08 (436-16): late, the WR-05 marker
    expect(sorted(DOWNLOAD_EVIDENCE_KEYS)).toEqual(['extension', 'failure', 'late', 'sha256', 'size', 'state', 'suggestedFilename'])
    expectTypeOf<keyof DownloadEvidence>().toEqualTypeOf<(typeof DOWNLOAD_EVIDENCE_KEYS)[number]>()
    expect(sorted(CLIPBOARD_EVIDENCE_KEYS)).toEqual(['readBack', 'source', 'text', 'truncated'])
    expectTypeOf<keyof ClipboardEvidence>().toEqualTypeOf<(typeof CLIPBOARD_EVIDENCE_KEYS)[number]>()
    expect(sorted(OPERATION_CAPTURE_AVAILABILITY_KEYS)).toEqual(['clipboard', 'download', 'reason'])
    expectTypeOf<keyof OperationCaptureAvailability>().toEqualTypeOf<(typeof OPERATION_CAPTURE_AVAILABILITY_KEYS)[number]>()
  })

  it('the handoff schema version did not move for the new optional members', () => {
    expect(CURRENT_HANDOFF_SCHEMA_VERSION).toBe(7)
  })

  it('projectSubActionRecorded still drops localEffect, a reader-only member (D-17)', () => {
    const handoff = JSON.parse(readFileSync(
      new URL('../../../../test-fixtures/legacy-handoff/handoff.json', import.meta.url), 'utf8')) as CompletedRunHandoff
    const subAction = handoff.tests[0]!.steps[0]!.subActions[0]!
    expect(subAction.localEffect, 'the frozen fixture lost its localEffect').toBeDefined()
    const payload = projectSubActionRecorded(subAction, { testIndex: 0, stepIndex: 0, subActionIndex: 0 }, (value) => value)
    expect(Object.keys(payload)).not.toContain('localEffect')
    expect(Object.keys(payload)).toContain('screenStateHash')
  })
})
