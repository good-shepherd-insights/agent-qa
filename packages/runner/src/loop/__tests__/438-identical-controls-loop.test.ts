// C438-IDENTICAL-CONTROLS-PROCEDURE (438 D-11, D-14, SC4): a committed procedure step whose target
// is 'Okay' never replays onto either of two identical Okay buttons. The body's guard records a
// 'descriptor-ambiguous' miss and nothing is dispatched from the body. The real loop
// (executeStep) runs over a makeScreenState screen with a stub knowledge reader.
import { describe, expect, it } from 'vitest'
import { asRecordId, asRef, serializeProcedureBody } from '@vostride/agent-qa-schema'
import type {
  ElementInfo,
  ProcedureBodyPayload,
  ProcedureGuardTarget,
  ProcedureMatch,
  ScreenState,
} from '@vostride/agent-qa-schema'
import type { KnowledgeHintReader } from '../../knowledge-hint-reader.js'
import type { Action, PlatformAdapter } from '../../platform.js'
import { executeStep } from '../index.js'
import type { ActionPlan, Planner } from '../types.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import { makeActionPlan, makeStepContext } from './loop-harness.js'
import { noCautions, servedBrief } from './fixtures/served-trace.js'

const ROUTE = 'https://example.test/confirm'
const PROCEDURE_ID = asRecordId('proc-identical-okay')

const OKAY: ProcedureGuardTarget = { role: 'button', nameNormalized: 'okay', name: 'Okay' }

function okayButton(ref: string, x: number): ElementInfo {
  return {
    ref: asRef(ref),
    role: 'button',
    name: 'Okay',
    nameNormalized: 'okay',
    bounds: { x, y: 10, width: 100, height: 40 },
    center: { x: x + 50, y: 30 },
    state: { enabled: true, focused: false, visible: true },
    labels: {},
    attributes: {},
  }
}

function twoOkays(): ScreenState {
  const elements = [okayButton('e1', 10), okayButton('e2', 130)]
  const refMap: ScreenState['refMap'] = {}
  for (const e of elements) refMap[e.ref] = { bounds: e.bounds!, center: e.center! }
  return makeScreenState({ elements, refMap })
}

const body: ProcedureBodyPayload = {
  schemaVersion: 1,
  parameters: [],
  steps: [{
    instruction: 'Click the okay button',
    action: { type: 'click', targets: { ref: OKAY }, values: {} },
    guard: { target: OKAY, pageAnchor: { t: 'page', route: ROUTE } },
  }],
  successAssertion: 'The Okay click completed',
}

function readerOf(payload: ProcedureBodyPayload): KnowledgeHintReader {
  const match: ProcedureMatch = {
    id: PROCEDURE_ID,
    flowAnchor: { t: 'flow', name: 'identical-okay' },
    confidence: 0.9,
    authoringModelTier: 'full',
    parameterSchema: [],
    replayRecommendation: 'replay',
  }
  return {
    getRunBrief: () =>
      servedBrief({ tiers: { L0: '', L1: '', L2: '' }, lines: [], truncation: '', admissions: [] }),
    search: () => [],
    read: (id) => ({
      id,
      title: 'Identical Okay procedure',
      body: serializeProcedureBody(payload),
      anchors: [{ t: 'flow', name: 'identical-okay' }],
      evidenceDigest: 'digest',
      relations: [],
    }),
    getCautions: () => noCautions(),
    getProcedure: () => match,
    emitCanaryOutcome: () => {},
  }
}

function recordingAdapter(screen: ScreenState): PlatformAdapter & { executed: Action[] } {
  const executed: Action[] = []
  return {
    platform: 'web',
    executed,
    async setup() {},
    async cleanup() {},
    async observe() {
      return screen
    },
    async execute(action: Action) {
      executed.push(action)
      return { success: true }
    },
  }
}

function countingPlanner(plan: ActionPlan): Planner & { calls: number } {
  const planner = {
    calls: 0,
    async plan() {
      planner.calls++
      return { plan }
    },
  }
  return planner
}

describe('C438-IDENTICAL-CONTROLS-PROCEDURE', () => {
  it('procedure path: a body Okay on two identical buttons is a guard miss', async () => {
    const adapter = recordingAdapter(twoOkays())
    const planner = countingPlanner(makeActionPlan({
      reasoning: 'Two identical Okay buttons; the step does not say which',
      action: { type: 'delay', ms: 0 },
      stepComplete: false,
      stepFailed: true,
    }))

    const result = await executeStep(
      'Click the okay button',
      { adapter, planner, knowledgeReader: readerOf(body) },
      makeStepContext({ testName: 'identical okay' }),
    )

    expect(result.evidence?.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId: PROCEDURE_ID,
      guard: {
        checksPassed: 0,
        total: 1,
        miss: { procedureStepIndex: 0, reason: 'descriptor-ambiguous' },
      },
      flow: { cursor: 0, length: 1 },
    })
    expect(adapter.executed).toEqual([])
    expect(planner.calls).toBe(1)
    expect(result.status).toBe('failed')
  })
})
