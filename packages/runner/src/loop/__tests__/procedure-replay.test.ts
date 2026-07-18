// PROC-02 loop-harness suite (381-07): step-start procedure consult, guarded per-action
// replay riding the cache-replay discipline, one-shot miss semantics with hint demotion,
// and the typed planSource evidence (D-09..D-12). Follows the brief-routing/failure-cautions
// loop-harness idiom: fake adapter/planner/ports, no real model or storage.
import { describe, expect, it } from 'vitest'
import { asRecordId, asRef, serializeProcedureBody } from '@vostride/agent-qa-schema'
import type {
  Anchor,
  BriefBlock,
  ProcedureBodyPayload,
  ProcedureMatch,
  ScreenState,
} from '@vostride/agent-qa-schema'
import type { KnowledgeHintReader } from '../../knowledge-hint-reader.js'
import type { Action, PlatformAdapter } from '../../platform.js'
import { executeStep } from '../index.js'
import type { LoopPorts, WorkingMemoryPort } from '../ports.js'
import type { ActionPlan, Planner, StepContext } from '../types.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import { makeActionPlan, makeAdapter, makeStepContext, makeVerifier } from './loop-harness.js'

const emptyBrief: BriefBlock = {
  tiers: { L0: '', L1: '', L2: '' },
  lines: [],
  truncation: '',
  admissions: [],
}

const flowAnchor: Anchor = { t: 'flow', name: 'login' }
const PROCEDURE_ID = asRecordId('proc-login')

function makeMatch(overrides: Partial<ProcedureMatch> = {}): ProcedureMatch {
  return {
    id: PROCEDURE_ID,
    flowAnchor,
    confidence: 0.9,
    authoringModelTier: 'full',
    parameterSchema: [{ name: 'userEmail', type: 'string', required: true }],
    replayRecommendation: 'replay',
    ...overrides,
  }
}

/** Two-action login payload matched against the default makeScreenState fixture. */
function loginPayload(): ProcedureBodyPayload {
  return {
    schemaVersion: 1,
    parameters: [{ name: 'userEmail', type: 'string', required: true }],
    steps: [
      {
        instruction: 'Fill the email field',
        action: {
          type: 'fill',
          targets: { ref: { role: 'textbox', nameNormalized: 'email' } },
          values: { text: { param: 'userEmail' } },
        },
        guard: {
          target: { role: 'textbox', nameNormalized: 'email' },
          pageAnchor: { t: 'page', route: 'https://example.test/login' },
        },
      },
      {
        instruction: 'Click the Log in button',
        action: {
          type: 'click',
          targets: { ref: { role: 'button', nameNormalized: 'log in' } },
          values: {},
        },
        guard: {
          target: { role: 'button', nameNormalized: 'log in' },
          pageAnchor: { t: 'page', route: 'https://example.test/login' },
        },
      },
    ],
    successAssertion: 'Login completed',
  }
}

interface ReaderSpy {
  reader: KnowledgeHintReader
  /** One JSON-stringified args entry per reader call, keyed by method name. */
  calls: { method: string; args: string }[]
  countOf(method: string): number
}

function makeReader(input: {
  match?: ProcedureMatch
  payload?: ProcedureBodyPayload
}): ReaderSpy {
  const calls: { method: string; args: string }[] = []
  const record = (method: string, args: unknown[]): void => {
    calls.push({ method, args: JSON.stringify(args, (_key, value) =>
      typeof value === 'function' ? undefined : value,
    ) })
  }
  const reader: KnowledgeHintReader = {
    getRunBrief(scope, budget) {
      record('getRunBrief', [scope, budget])
      return emptyBrief
    },
    search(query, options) {
      record('search', [query, options])
      return []
    },
    read(id, options) {
      record('read', [id, options])
      if (input.payload === undefined) return undefined
      return {
        id,
        title: 'Login procedure',
        body: serializeProcedureBody(input.payload),
        anchors: [flowAnchor],
        evidenceDigest: 'digest',
        relations: [],
      }
    },
    getCautions(anchors, budget) {
      record('getCautions', [anchors, budget])
      return { cautions: [], budgetUsed: 0, admissions: [] }
    },
    getProcedure(intent, screenState, bindingNames) {
      record('getProcedure', [intent, screenState, bindingNames])
      return input.match
    },
    emitCanaryOutcome(payload) {
      record('emitCanaryOutcome', [payload])
    },
  }
  return { reader, calls, countOf: (method) => calls.filter((c) => c.method === method).length }
}

function capturingAdapter(observeResults: ScreenState[]): { adapter: PlatformAdapter; executed: Action[] } {
  const executed: Action[] = []
  const base = makeAdapter({ observeResults })
  const adapter: PlatformAdapter = {
    ...base,
    async execute(action) {
      executed.push(action)
      return base.execute(action)
    },
  }
  return { adapter, executed }
}

interface PlannerSpy {
  planner: Planner
  /** Volatile-tier learned slots snapshotted at each live planning call. */
  calls: { l1?: string; l2?: string }[]
}

function capturingPlanner(plans: ActionPlan[]): PlannerSpy {
  const calls: { l1?: string; l2?: string }[] = []
  const planner: Planner = {
    async plan(_step, _screen, context) {
      calls.push({ l1: context.knowledgeBriefL1, l2: context.knowledgeBriefL2 })
      const idx = Math.min(calls.length - 1, plans.length - 1)
      return { plan: plans[idx] }
    },
  }
  return { planner, calls }
}

/** A screen whose second stored descriptor ("Log in" button) resolves ambiguously. */
function duplicateButtonScreen(): ScreenState {
  const base = makeScreenState()
  const extraRef = asRef('e3')
  const extraBounds = { x: 20, y: 260, width: 350, height: 44 }
  return {
    ...base,
    tree: `${base.tree}\n- button "Log in" [ref=e3] @(20,260 350x44)`,
    elements: [
      ...base.elements,
      {
        ref: extraRef,
        role: 'button',
        name: 'Log in',
        nameNormalized: 'log in',
        bounds: extraBounds,
        center: { x: 195, y: 282 },
        state: { enabled: true, focused: false, visible: true },
        labels: { ariaLabel: 'Log in' },
        attributes: {},
      },
    ],
    refMap: {
      ...base.refMap,
      [extraRef]: { bounds: extraBounds, center: { x: 195, y: 282 } },
    },
  }
}

/** Two-textbox screen for the value-binding test: Email (e1), Code (e2), Log in (e3). */
function twoFieldScreen(): ScreenState {
  const base = makeScreenState()
  const codeRef = asRef('e5')
  const codeBounds = { x: 20, y: 160, width: 350, height: 44 }
  return {
    ...base,
    tree: `${base.tree}\n- textbox "Code" [ref=e5] @(20,160 350x44)`,
    elements: [
      ...base.elements,
      {
        ref: codeRef,
        role: 'textbox',
        name: 'Code',
        nameNormalized: 'code',
        bounds: codeBounds,
        center: { x: 195, y: 182 },
        state: { enabled: true, focused: false, visible: true },
        labels: { placeholder: 'Code' },
        attributes: {},
      },
    ],
    refMap: {
      ...base.refMap,
      [codeRef]: { bounds: codeBounds, center: { x: 195, y: 182 } },
    },
  }
}

function makeWorkingMemory(entries: { key: string; value: string }[]): WorkingMemoryPort {
  return {
    capture: () => {},
    entries: () =>
      entries.map((entry) => ({
        key: entry.key,
        value: entry.value,
        kind: 'extracted-value' as const,
        provenance: 'toolResult' as const,
      })),
    dispose: () => {},
  }
}

function context(overrides: Partial<StepContext> = {}): StepContext {
  return makeStepContext({
    testName: 'login',
    variables: { userEmail: 'user@example.com' },
    ...overrides,
  })
}

function ports(overrides: Partial<LoopPorts> & Pick<LoopPorts, 'adapter' | 'planner'>): LoopPorts {
  return { ...overrides }
}

describe('procedure guarded replay (PROC-02 · D-09..D-12)', () => {
  it('Test 1: a replay-recommendation match drives the step with no planning-turn LLM call', async () => {
    const spy = makeReader({ match: makeMatch(), payload: loginPayload() })
    const { adapter, executed } = capturingAdapter([makeScreenState()])
    const planner = capturingPlanner([makeActionPlan()])

    const result = await executeStep(
      'Log in as the saved user',
      ports({ adapter, planner: planner.planner, knowledgeReader: spy.reader }),
      context(),
    )

    expect(result.status).toBe('passed')
    expect(planner.calls).toHaveLength(0)
    expect(spy.countOf('getProcedure')).toBe(1)
    expect(executed.map((action) => action.type)).toEqual(['fill', 'click'])

    const evidence = result.evidence!
    expect(evidence.subActions).toHaveLength(2)
    for (const sub of evidence.subActions) {
      expect(sub.grounding).toBeDefined()
      expect(sub.grounding!.attempts.length).toBeGreaterThan(0)
    }
    expect(evidence.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId: PROCEDURE_ID,
      guard: { checksPassed: 2, total: 2 },
    })
  })

  it('Test 2: an ambiguous second descriptor aborts replay once and demotes to hint with the divergence noted', async () => {
    const spy = makeReader({ match: makeMatch(), payload: loginPayload() })
    const stable = makeScreenState()
    const drifted = duplicateButtonScreen()
    const { adapter, executed } = capturingAdapter([stable, stable, drifted])
    const planner = capturingPlanner([
      makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: true }),
    ])

    const result = await executeStep(
      'Log in as the saved user',
      ports({ adapter, planner: planner.planner, knowledgeReader: spy.reader }),
      context(),
    )

    expect(result.status).toBe('passed')
    expect(spy.countOf('getProcedure')).toBe(1)
    // Replay drove the first action; planning took over for the remainder — exactly once.
    expect(executed.map((action) => action.type)).toEqual(['fill', 'click'])
    expect(planner.calls).toHaveLength(1)
    // The demoted procedure hint reached the planning context with the divergence noted.
    const learned = `${planner.calls[0].l1 ?? ''}\n${planner.calls[0].l2 ?? ''}`
    expect(learned).toContain('Fill the email field')
    expect(learned.toLowerCase()).toContain('diverged')
    expect(learned.toLowerCase()).toContain('ambiguous')

    expect(result.evidence?.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId: PROCEDURE_ID,
      guard: {
        checksPassed: 1,
        total: 2,
        miss: { procedureStepIndex: 1, reason: 'descriptor-ambiguous' },
      },
    })
  })

  it('Test 3: a live page anchor differing from the stored one is a miss even with a unique descriptor', async () => {
    const payload = loginPayload()
    payload.steps = [
      {
        ...payload.steps[1],
        guard: {
          target: { role: 'button', nameNormalized: 'log in' },
          pageAnchor: { t: 'page', route: 'https://example.test/checkout' },
        },
      },
    ]
    const spy = makeReader({ match: makeMatch(), payload })
    const { adapter, executed } = capturingAdapter([makeScreenState()])
    const planner = capturingPlanner([
      makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: true }),
    ])

    const result = await executeStep(
      'Log in as the saved user',
      ports({ adapter, planner: planner.planner, knowledgeReader: spy.reader }),
      context(),
    )

    expect(result.status).toBe('passed')
    expect(planner.calls).toHaveLength(1)
    // No replayed action executed — the click came from the planning turn.
    expect(executed.map((action) => action.type)).toEqual(['click'])
    expect(result.evidence?.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId: PROCEDURE_ID,
      guard: {
        checksPassed: 0,
        total: 1,
        miss: { procedureStepIndex: 0, reason: 'page-anchor-mismatch' },
      },
    })
  })

  it('Test 4: replayed actions never exceed the sequence length and exhaustion hands over to planning', async () => {
    const payload = loginPayload()
    payload.steps = [payload.steps[1]]
    const spy = makeReader({ match: makeMatch(), payload })
    const { adapter, executed } = capturingAdapter([makeScreenState()])
    const planner = capturingPlanner([
      makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: true }),
    ])
    const verifier = makeVerifier([
      { success: false, reasoning: 'not done yet', isAppError: false },
      { success: true, reasoning: 'done', isAppError: false },
    ])

    const result = await executeStep(
      'Log in as the saved user',
      ports({ adapter, planner: planner.planner, verifier, knowledgeReader: spy.reader }),
      context(),
    )

    expect(result.status).toBe('passed')
    expect(spy.countOf('getProcedure')).toBe(1)
    // One replayed click, then the verifier rejection forced a live planning turn (no replay
    // re-entry after the sequence exhausted).
    expect(executed.map((action) => action.type)).toEqual(['click', 'click'])
    expect(planner.calls).toHaveLength(1)
    expect(result.evidence?.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId: PROCEDURE_ID,
      guard: { checksPassed: 1, total: 1 },
    })
  })

  it('Test 5a: an unbound reader leaves the loop behavior unchanged with no planSource', async () => {
    const { adapter, executed } = capturingAdapter([makeScreenState()])
    const planner = capturingPlanner([makeActionPlan()])

    const result = await executeStep(
      'Click the Log in button',
      ports({ adapter, planner: planner.planner }),
      context(),
    )

    expect(result.status).toBe('passed')
    expect(planner.calls).toHaveLength(1)
    expect(executed.map((action) => action.type)).toEqual(['click'])
    expect(result.evidence?.planSource).toBeUndefined()
  })

  it('Test 5b: a hint-recommendation match triggers no replay and no read-body requirement failure', async () => {
    const spy = makeReader({ match: makeMatch({ replayRecommendation: 'hint' }), payload: undefined })
    const { adapter, executed } = capturingAdapter([makeScreenState()])
    const planner = capturingPlanner([makeActionPlan()])

    const result = await executeStep(
      'Click the Log in button',
      ports({ adapter, planner: planner.planner, knowledgeReader: spy.reader }),
      context(),
    )

    expect(result.status).toBe('passed')
    expect(spy.countOf('getProcedure')).toBe(1)
    expect(planner.calls).toHaveLength(1)
    // No replayed action — the planner drove the single click.
    expect(executed.map((action) => action.type)).toEqual(['click'])
  })

  it('Test 6: parameter values bind loop-side by NAME and never cross the reader port', async () => {
    const payload: ProcedureBodyPayload = {
      schemaVersion: 1,
      parameters: [
        { name: 'userEmail', type: 'string', required: true },
        { name: 'otpCode', type: 'string', required: true },
      ],
      steps: [
        {
          instruction: 'Fill the email field',
          action: {
            type: 'fill',
            targets: { ref: { role: 'textbox', nameNormalized: 'email' } },
            values: { text: { param: 'userEmail' } },
          },
          guard: {
            target: { role: 'textbox', nameNormalized: 'email' },
            pageAnchor: { t: 'page', route: 'https://example.test/login' },
          },
        },
        {
          instruction: 'Fill the one-time code',
          action: {
            type: 'fill',
            targets: { ref: { role: 'textbox', nameNormalized: 'code' } },
            values: { text: { param: 'otpCode' } },
          },
          guard: {
            target: { role: 'textbox', nameNormalized: 'code' },
            pageAnchor: { t: 'page', route: 'https://example.test/login' },
          },
        },
      ],
      successAssertion: 'Both fields are filled',
    }
    const spy = makeReader({
      match: makeMatch({
        parameterSchema: [
          { name: 'userEmail', type: 'string', required: true },
          { name: 'otpCode', type: 'string', required: true },
        ],
      }),
      payload,
    })
    const { adapter, executed } = capturingAdapter([twoFieldScreen()])
    const planner = capturingPlanner([makeActionPlan()])

    const result = await executeStep(
      'Log in with the saved email and one-time code',
      ports({
        adapter,
        planner: planner.planner,
        knowledgeReader: spy.reader,
        workingMemory: makeWorkingMemory([{ key: 'otpCode', value: '123456' }]),
      }),
      context(),
    )

    expect(result.status).toBe('passed')
    expect(planner.calls).toHaveLength(0)
    const fills = executed as Extract<Action, { type: 'fill' }>[]
    expect(fills.map((action) => action.type)).toEqual(['fill', 'fill'])
    expect(fills[0].text).toBe('user@example.com')
    expect(fills[1].text).toBe('123456')

    // Binding NAMES crossed the reader port; bound VALUES never did — in any argument of
    // any reader call.
    const getProcedureArgs = spy.calls.find((call) => call.method === 'getProcedure')!.args
    expect(getProcedureArgs).toContain('userEmail')
    expect(getProcedureArgs).toContain('otpCode')
    for (const call of spy.calls) {
      expect(call.args).not.toContain('user@example.com')
      expect(call.args).not.toContain('123456')
    }
  })
})
