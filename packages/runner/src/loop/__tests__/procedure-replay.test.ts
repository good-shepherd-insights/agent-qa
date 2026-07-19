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
  ServingRecordMetadata,
} from '@vostride/agent-qa-schema'
import { APP_OBSERVED_DATA_CLOSE, APP_OBSERVED_DATA_OPEN } from '@vostride/agent-qa-safety'
import type { KnowledgeHintReader } from '../../knowledge-hint-reader.js'
import type { Action, PlatformAdapter } from '../../platform.js'
import type {
  ActionPlanCache,
  CacheablePlannedAction,
  CachedPlanValue,
} from '../../cache/port.js'
import { executeStep } from '../index.js'
import { buildVolatileTier } from '../prompts.js'
import type { RecordLedger } from '../record-ledger.js'
import type { LoopPorts, WorkingMemoryPort } from '../ports.js'
import type { ActionPlan, Planner, StepContext } from '../types.js'
import { SecretStore } from '../secrets.js'
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
    getProcedure(intent, screenState, availability) {
      record('getProcedure', [intent, screenState, availability])
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

function singleActionPayload(input: {
  parameters?: ProcedureBodyPayload['parameters']
  type: string
  target?: { role: string; nameNormalized: string }
  values: ProcedureBodyPayload['steps'][number]['action']['values']
  instruction?: string
}): ProcedureBodyPayload {
  const target = input.target ?? { role: 'button', nameNormalized: 'log in' }
  return {
    schemaVersion: 1,
    parameters: input.parameters ?? [],
    steps: [{
      instruction: input.instruction ?? `Replay ${input.type}`,
      action: {
        type: input.type,
        targets: { ref: target },
        values: input.values,
      },
      guard: {
        target,
        pageAnchor: { t: 'page', route: 'https://example.test/login' },
      },
    }],
    successAssertion: 'The stored action completed',
  }
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

  it('aborts after a replayed adapter execution fails without advancing the guard fold', async () => {
    const spy = makeReader({ match: makeMatch(), payload: loginPayload() })
    const executed: Action[] = []
    const base = makeAdapter({
      observeResults: [makeScreenState()],
      executeResults: [
        { success: false, error: 'simulated replay adapter failure' },
        { success: true },
      ],
    })
    const adapter: PlatformAdapter = {
      ...base,
      async execute(action) {
        executed.push(action)
        return base.execute(action)
      },
    }
    const planner = capturingPlanner([
      makeActionPlan({ action: { type: 'click', ref: 'e1' }, stepComplete: true }),
    ])

    const result = await executeStep(
      'Log in as the saved user',
      ports({ adapter, planner: planner.planner, knowledgeReader: spy.reader }),
      context(),
    )

    expect(result.status).toBe('passed')
    expect(planner.calls).toHaveLength(1)
    expect(executed).toMatchObject([
      { type: 'fill', ref: 'e1' },
      { type: 'click', ref: 'e1' },
    ])
    expect(executed).not.toContainEqual(expect.objectContaining({ type: 'click', ref: 'e2' }))

    const learned = `${planner.calls[0].l1 ?? ''}\n${planner.calls[0].l2 ?? ''}`
    expect(learned).toContain('Fill the email field')
    expect(learned).toContain('simulated replay adapter failure')
    expect(result.evidence?.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId: PROCEDURE_ID,
      guard: {
        checksPassed: 0,
        total: 2,
        executionFailure: { procedureStepIndex: 0 },
      },
    })
  })

  it('preserves literal boolean value slots instead of treating them as parameter refs', async () => {
    const payload = loginPayload()
    payload.steps[0].action.values.submit = true
    const spy = makeReader({ match: makeMatch(), payload })
    const { adapter, executed } = capturingAdapter([makeScreenState()])
    const planner = capturingPlanner([makeActionPlan()])

    const result = await executeStep(
      'Log in as the saved user',
      ports({ adapter, planner: planner.planner, knowledgeReader: spy.reader }),
      context(),
    )

    expect(result.status).toBe('passed')
    expect(planner.calls).toHaveLength(0)
    expect(executed[0]).toMatchObject({ type: 'fill', submit: true })
  })

  it('preserves literal numeric value slots as numbers through replay', async () => {
    const payload = singleActionPayload({
      type: 'doubleClick',
      values: { clickDelay: 4 },
    })
    const spy = makeReader({ match: makeMatch({ parameterSchema: [] }), payload })
    const { adapter, executed } = capturingAdapter([makeScreenState()])
    const planner = capturingPlanner([makeActionPlan()])

    const result = await executeStep(
      'Double-click Log in with the stored delay',
      ports({ adapter, planner: planner.planner, knowledgeReader: spy.reader }),
      context(),
    )

    expect(result.status).toBe('passed')
    expect(planner.calls).toHaveLength(0)
    expect(executed[0]).toMatchObject({ type: 'doubleClick', clickDelay: 4 })
    expect(typeof (executed[0] as Extract<Action, { type: 'doubleClick' }>).clickDelay)
      .toBe('number')
  })

  it('unwraps a tagged file list before canonical file-upload validation and execution', async () => {
    const payload = singleActionPayload({
      type: 'fileUpload',
      values: { files: { json: ['a.png'] } },
    })
    const spy = makeReader({ match: makeMatch({ parameterSchema: [] }), payload })
    const { adapter, executed } = capturingAdapter([makeScreenState()])
    const planner = capturingPlanner([makeActionPlan()])

    const result = await executeStep(
      'Upload the stored file list',
      ports({ adapter, planner: planner.planner, knowledgeReader: spy.reader }),
      context(),
    )

    expect(result.status).toBe('passed')
    expect(planner.calls).toHaveLength(0)
    expect(executed[0]).toMatchObject({ type: 'fileUpload' })
    expect((executed[0] as Extract<Action, { type: 'fileUpload' }>).files).toEqual([
      'a.png',
    ])
  })

  it('unwraps a tagged relative position before canonical double-click execution', async () => {
    const payload = singleActionPayload({
      type: 'doubleClick',
      values: { relativePosition: { json: { x: 5, y: 7 } } },
    })
    const spy = makeReader({ match: makeMatch({ parameterSchema: [] }), payload })
    const { adapter, executed } = capturingAdapter([makeScreenState()])
    const planner = capturingPlanner([makeActionPlan()])

    const result = await executeStep(
      'Double-click at the stored relative position',
      ports({ adapter, planner: planner.planner, knowledgeReader: spy.reader }),
      context(),
    )

    expect(result.status).toBe('passed')
    expect(planner.calls).toHaveLength(0)
    expect(executed[0]).toMatchObject({
      type: 'doubleClick',
      relativePosition: { x: 5, y: 7 },
    })
  })

  it('keeps a navigating final replay guard on the pre-action page', async () => {
    const spy = makeReader({ match: makeMatch(), payload: loginPayload() })
    const login = makeScreenState()
    const dashboard = makeScreenState({ url: 'https://example.test/dashboard' })
    // Contract pin: replay guards stay pre-action while StepEvidence records the final
    // post-action navigation. Neither side may silently drift to the other's URL semantics.
    const { adapter, executed } = capturingAdapter([login, login, login, login, dashboard])
    const planner = capturingPlanner([makeActionPlan()])
    const verifier = makeVerifier()

    const result = await executeStep(
      'Log in as the saved user',
      ports({ adapter, planner: planner.planner, verifier, knowledgeReader: spy.reader }),
      context(),
    )

    expect(result.status).toBe('passed')
    expect(planner.calls).toHaveLength(0)
    expect(executed.map((action) => action.type)).toEqual(['fill', 'click'])
    expect(result.evidence?.planSource?.kind).toBe('procedure-replay')
    if (result.evidence?.planSource?.kind !== 'procedure-replay') {
      throw new Error('expected procedure-replay planSource')
    }
    expect(result.evidence.planSource.guard.miss).toBeUndefined()
    expect(result.evidence.planSource.guard.checksPassed).toBe(
      result.evidence.planSource.guard.total,
    )
    const completing = result.evidence.subActions.at(-1)!
    expect(completing.stateBefore.url).toBe('https://example.test/login')
    expect(completing.stateAfter?.url).toBe('https://example.test/dashboard')
    expect(completing.stateAfter?.url).not.toBe(completing.stateBefore.url)
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

  it('aborts before dispatch when the declared guard target is missing even though the action target resolves', async () => {
    const payload = loginPayload()
    payload.steps = [{
      ...payload.steps[0],
      guard: {
        ...payload.steps[0].guard,
        target: { role: 'button', nameNormalized: 'reset password' },
      },
    }]
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
    expect(spy.countOf('getProcedure')).toBe(1)
    expect(executed.map((action) => action.type)).toEqual(['click'])
    expect(planner.calls).toHaveLength(1)
    const learned = `${planner.calls[0].l1 ?? ''}\n${planner.calls[0].l2 ?? ''}`
    expect(learned.toLowerCase()).toContain('diverged')
    expect(learned.toLowerCase()).toContain('declared guard target')
    expect(learned.toLowerCase()).toContain('reset password')
    expect(result.evidence?.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId: PROCEDURE_ID,
      guard: {
        checksPassed: 0,
        total: 1,
        miss: { procedureStepIndex: 0, reason: 'descriptor-missing' },
      },
    })
  })

  it('aborts before dispatch when the declared guard target is ambiguous even though the action target resolves', async () => {
    const payload = loginPayload()
    payload.steps = [{
      ...payload.steps[0],
      guard: {
        ...payload.steps[0].guard,
        target: { role: 'button', nameNormalized: 'log in' },
      },
    }]
    const spy = makeReader({ match: makeMatch(), payload })
    const { adapter, executed } = capturingAdapter([duplicateButtonScreen()])
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
    expect(executed.map((action) => action.type)).toEqual(['click'])
    expect(planner.calls).toHaveLength(1)
    const learned = `${planner.calls[0].l1 ?? ''}\n${planner.calls[0].l2 ?? ''}`
    expect(learned.toLowerCase()).toContain('diverged')
    expect(learned.toLowerCase()).toContain('declared guard target')
    expect(learned.toLowerCase()).toContain('log in')
    expect(result.evidence?.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId: PROCEDURE_ID,
      guard: {
        checksPassed: 0,
        total: 1,
        miss: { procedureStepIndex: 0, reason: 'descriptor-ambiguous' },
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
    const l2 = planner.calls[0].l2 ?? ''
    const open = l2.indexOf(APP_OBSERVED_DATA_OPEN)
    const close = l2.indexOf(APP_OBSERVED_DATA_CLOSE)
    const divergence = l2.indexOf('Guarded replay verifier rejected procedure step 1')
    expect(open).toBeGreaterThanOrEqual(0)
    expect(divergence).toBeGreaterThan(open)
    expect(l2).toContain('not done yet')
    expect(close).toBeGreaterThan(divergence)
    expect(result.evidence?.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId: PROCEDURE_ID,
      guard: {
        checksPassed: 1,
        total: 1,
        verifierRejection: { procedureStepIndex: 0 },
      },
    })
  })

  it('a verifier rejection aborts a multi-action procedure without replay re-entry', async () => {
    const spy = makeReader({ match: makeMatch(), payload: loginPayload() })
    const { adapter, executed } = capturingAdapter([makeScreenState()])
    const planner = capturingPlanner([
      makeActionPlan({ action: { type: 'click', ref: 'e1' }, stepComplete: true }),
    ])
    const verifier = makeVerifier([
      { success: false, reasoning: 'stored login did not complete', isAppError: false },
      { success: true, reasoning: 'live recovery completed', isAppError: false },
    ])

    const result = await executeStep(
      'Log in as the saved user',
      ports({ adapter, planner: planner.planner, verifier, knowledgeReader: spy.reader }),
      context(),
    )

    expect(result.status).toBe('passed')
    expect(spy.countOf('getProcedure')).toBe(1)
    expect(planner.calls).toHaveLength(1)
    expect(executed).toMatchObject([
      { type: 'fill', ref: 'e1' },
      { type: 'click', ref: 'e2' },
      { type: 'click', ref: 'e1' },
    ])
    expect(executed.filter((action) => action.type === 'click' && action.ref === 'e2'))
      .toHaveLength(1)
    const l2 = planner.calls[0].l2 ?? ''
    expect(l2).toContain(APP_OBSERVED_DATA_OPEN)
    expect(l2).toContain('Guarded replay verifier rejected procedure step 2')
    expect(l2).toContain('stored login did not complete')
    expect(l2).toContain(APP_OBSERVED_DATA_CLOSE)
    expect(result.evidence?.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId: PROCEDURE_ID,
      guard: {
        checksPassed: 2,
        total: 2,
        verifierRejection: { procedureStepIndex: 1 },
      },
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
    const getProcedureArgs = JSON.parse(
      spy.calls.find((call) => call.method === 'getProcedure')!.args,
    ) as [unknown, unknown, unknown]
    expect(getProcedureArgs[2]).toEqual({
      variables: ['userEmail'],
      memory: ['otpCode'],
      secrets: [],
    })
    for (const call of spy.calls) {
      expect(call.args).not.toContain('user@example.com')
      expect(call.args).not.toContain('123456')
    }
  })

  it('reports a missing loop-side value as parameter-unbound, then plans with the demoted hint', async () => {
    const payload = singleActionPayload({
      parameters: [{ name: 'missingEmail', type: 'string', required: true }],
      type: 'fill',
      target: { role: 'textbox', nameNormalized: 'email' },
      values: { text: { param: 'missingEmail' } },
      instruction: 'Fill the missing email',
    })
    const spy = makeReader({
      match: makeMatch({
        parameterSchema: [{ name: 'missingEmail', type: 'string', required: true }],
      }),
      payload,
    })
    const { adapter, executed } = capturingAdapter([makeScreenState()])
    const planner = capturingPlanner([
      makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: true }),
    ])

    const result = await executeStep(
      'Continue after the unavailable email',
      ports({ adapter, planner: planner.planner, knowledgeReader: spy.reader }),
      context(),
    )

    expect(result.status).toBe('passed')
    expect(planner.calls).toHaveLength(1)
    expect(executed.map((action) => action.type)).toEqual(['click'])
    expect(`${planner.calls[0].l1 ?? ''}\n${planner.calls[0].l2 ?? ''}`)
      .toContain('has no loop-side binding source')
    expect(result.evidence?.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId: PROCEDURE_ID,
      guard: {
        checksPassed: 0,
        total: 1,
        miss: { procedureStepIndex: 0, reason: 'parameter-unbound' },
      },
    })
  })

  it('coerces a finite number parameter and rejects a non-number as parameter-unbound', async () => {
    const payload = singleActionPayload({
      parameters: [{ name: 'delay', type: 'number', required: true }],
      type: 'doubleClick',
      values: { clickDelay: { param: 'delay' } },
    })
    const match = makeMatch({
      parameterSchema: [{ name: 'delay', type: 'number', required: true }],
    })

    const validSpy = makeReader({ match, payload })
    const validAdapter = capturingAdapter([makeScreenState()])
    const validPlanner = capturingPlanner([makeActionPlan()])
    const valid = await executeStep(
      'Double-click with a numeric delay',
      ports({
        adapter: validAdapter.adapter,
        planner: validPlanner.planner,
        knowledgeReader: validSpy.reader,
      }),
      context({ variables: { delay: '5' } }),
    )

    expect(valid.status).toBe('passed')
    expect(validPlanner.calls).toHaveLength(0)
    expect(validAdapter.executed[0]).toMatchObject({ type: 'doubleClick', clickDelay: 5 })
    expect(typeof (validAdapter.executed[0] as Extract<Action, { type: 'doubleClick' }>).clickDelay)
      .toBe('number')

    const invalidSpy = makeReader({ match, payload })
    const invalidAdapter = capturingAdapter([makeScreenState()])
    const invalidPlanner = capturingPlanner([
      makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: true }),
    ])
    const invalid = await executeStep(
      'Fall back when the delay is not numeric',
      ports({
        adapter: invalidAdapter.adapter,
        planner: invalidPlanner.planner,
        knowledgeReader: invalidSpy.reader,
      }),
      context({ variables: { delay: 'not-a-number' } }),
    )

    expect(invalid.status).toBe('passed')
    expect(invalidPlanner.calls).toHaveLength(1)
    expect(invalidAdapter.executed.map((action) => action.type)).toEqual(['click'])
    expect(invalid.evidence?.planSource).toMatchObject({
      guard: { miss: { reason: 'parameter-unbound' } },
    })
  })

  it('maps strict boolean strings to booleans and rejects non-strict spellings', async () => {
    const payload = singleActionPayload({
      parameters: [{ name: 'submitNow', type: 'boolean', required: true }],
      type: 'fill',
      target: { role: 'textbox', nameNormalized: 'email' },
      values: { text: 'user@example.com', submit: { param: 'submitNow' } },
    })
    const match = makeMatch({
      parameterSchema: [{ name: 'submitNow', type: 'boolean', required: true }],
    })

    const validSpy = makeReader({ match, payload })
    const validAdapter = capturingAdapter([makeScreenState()])
    const validPlanner = capturingPlanner([makeActionPlan()])
    await executeStep(
      'Fill and submit using a strict boolean',
      ports({
        adapter: validAdapter.adapter,
        planner: validPlanner.planner,
        knowledgeReader: validSpy.reader,
      }),
      context({ variables: { submitNow: 'true' } }),
    )

    expect(validPlanner.calls).toHaveLength(0)
    expect(validAdapter.executed[0]).toMatchObject({ type: 'fill', submit: true })
    expect(typeof (validAdapter.executed[0] as Extract<Action, { type: 'fill' }>).submit)
      .toBe('boolean')

    const invalidSpy = makeReader({ match, payload })
    const invalidAdapter = capturingAdapter([makeScreenState()])
    const invalidPlanner = capturingPlanner([
      makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: true }),
    ])
    const invalid = await executeStep(
      'Reject a non-strict boolean spelling',
      ports({
        adapter: invalidAdapter.adapter,
        planner: invalidPlanner.planner,
        knowledgeReader: invalidSpy.reader,
      }),
      context({ variables: { submitNow: 'TRUE' } }),
    )

    expect(invalidPlanner.calls).toHaveLength(1)
    expect(invalidAdapter.executed.map((action) => action.type)).toEqual(['click'])
    expect(invalid.evidence?.planSource).toMatchObject({
      guard: { miss: { reason: 'parameter-unbound' } },
    })
  })

  it.each([
    {
      type: 'number' as const,
      name: 'delay',
      secretValue: '5',
      payload: singleActionPayload({
        parameters: [{ name: 'delay', type: 'number', required: true }],
        type: 'doubleClick',
        values: { clickDelay: { param: 'delay' } },
      }),
    },
    {
      type: 'boolean' as const,
      name: 'submitNow',
      secretValue: 'true',
      payload: singleActionPayload({
        parameters: [{ name: 'submitNow', type: 'boolean', required: true }],
        type: 'fill',
        target: { role: 'textbox', nameNormalized: 'email' },
        values: { text: 'user@example.com', submit: { param: 'submitNow' } },
      }),
    },
  ])('fails safe when a stale replay recommendation offers a secret-only $type', async ({
    type,
    name,
    secretValue,
    payload,
  }) => {
    const spy = makeReader({
      // Force the stale/over-admitted recommendation so this test exercises the independent
      // loop-side half of WR-01 even though the corrected matcher now downranks it to a hint.
      match: makeMatch({
        parameterSchema: [{ name, type, required: true }],
        replayRecommendation: 'replay',
      }),
      payload,
    })
    const { adapter, executed } = capturingAdapter([makeScreenState()])
    const planner = capturingPlanner([
      makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: true }),
    ])

    const result = await executeStep(
      `Fall back from a secret-only ${type} binding`,
      ports({
        adapter,
        planner: planner.planner,
        knowledgeReader: spy.reader,
        secretStore: new SecretStore({ [name]: secretValue }),
      }),
      context({ variables: {} }),
    )

    expect(result.status).toBe('passed')
    expect(planner.calls).toHaveLength(1)
    expect(executed.map((action) => action.type)).toEqual(['click'])
    expect(`${planner.calls[0].l1 ?? ''}\n${planner.calls[0].l2 ?? ''}`)
      .toContain('has no loop-side binding source')
    expect(result.evidence?.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId: PROCEDURE_ID,
      guard: {
        checksPassed: 0,
        total: 1,
        miss: { procedureStepIndex: 0, reason: 'parameter-unbound' },
      },
    })
  })

  it('binds a secret parameter only from the secret store, never from variables', async () => {
    const payload = singleActionPayload({
      parameters: [{ name: 'loginSecret', type: 'secret', required: true }],
      type: 'fill',
      target: { role: 'textbox', nameNormalized: 'email' },
      values: { text: { param: 'loginSecret' } },
    })
    const match = makeMatch({
      parameterSchema: [{ name: 'loginSecret', type: 'secret', required: true }],
    })
    const variableOnlySpy = makeReader({ match, payload })
    const variableOnlyAdapter = capturingAdapter([makeScreenState()])
    const variableOnlyPlanner = capturingPlanner([
      makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: true }),
    ])
    const variableOnly = await executeStep(
      'Do not use a variable as a secret',
      ports({
        adapter: variableOnlyAdapter.adapter,
        planner: variableOnlyPlanner.planner,
        knowledgeReader: variableOnlySpy.reader,
      }),
      context({ variables: { loginSecret: 'variable-value' } }),
    )

    expect(variableOnlyPlanner.calls).toHaveLength(1)
    expect(variableOnlyAdapter.executed.map((action) => action.type)).toEqual(['click'])
    expect(variableOnly.evidence?.planSource).toMatchObject({
      guard: { miss: { reason: 'parameter-unbound' } },
    })

    const storeSpy = makeReader({ match, payload })
    const storeAdapter = capturingAdapter([makeScreenState()])
    const storePlanner = capturingPlanner([makeActionPlan()])
    const storeBacked = await executeStep(
      'Use the provisioned secret',
      ports({
        adapter: storeAdapter.adapter,
        planner: storePlanner.planner,
        knowledgeReader: storeSpy.reader,
        secretStore: new SecretStore({ loginSecret: 'store-value' }),
      }),
      context({ variables: { loginSecret: 'variable-value' } }),
    )

    expect(storeBacked.status).toBe('passed')
    expect(storePlanner.calls).toHaveLength(0)
    expect(storeAdapter.executed[0]).toMatchObject({ type: 'fill', text: 'store-value' })
  })

  it('rejects a schema-invalid rebuilt action before it reaches the adapter', async () => {
    const payload = singleActionPayload({
      type: 'fill',
      target: { role: 'textbox', nameNormalized: 'email' },
      values: { submit: true },
      instruction: 'Invalid fill missing its required text',
    })
    const spy = makeReader({ match: makeMatch({ parameterSchema: [] }), payload })
    const { adapter, executed } = capturingAdapter([makeScreenState()])
    const planner = capturingPlanner([
      makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: true }),
    ])

    const result = await executeStep(
      'Fall back from an invalid stored fill',
      ports({ adapter, planner: planner.planner, knowledgeReader: spy.reader }),
      context(),
    )

    expect(result.status).toBe('passed')
    expect(planner.calls).toHaveLength(1)
    expect(executed.map((action) => action.type)).toEqual(['click'])
    expect(result.evidence?.planSource).toMatchObject({
      guard: { miss: { reason: 'non-replayable-action' } },
    })
    expect(`${planner.calls[0].l1 ?? ''}\n${planner.calls[0].l2 ?? ''}`)
      .toContain('failed canonical action-schema validation')
  })
})

// ---------------------------------------------------------------------------
// Task 2: planSource evidence + hint rendering through the ledger (D-12 / T-381-20)
// ---------------------------------------------------------------------------

function makeCacheSpy(hit: CachedPlanValue | null): { cache: ActionPlanCache; gets: () => number } {
  let gets = 0
  return {
    cache: {
      async get() { gets++; return hit },
      async set() {},
      async invalidate() {},
    },
    gets: () => gets,
  }
}

interface LedgerSpy {
  ledger: RecordLedger
  admits: ServingRecordMetadata[]
}

function makeLedgerSpy(admitted: boolean): LedgerSpy {
  const admits: ServingRecordMetadata[] = []
  const decision = admitted ? { admitted: true as const } : { admitted: false as const, reason: 'budget-cap' as const }
  return {
    admits,
    ledger: {
      inspect: () => decision,
      admit: (record) => { admits.push(record); return decision },
      resetTurn: () => {},
      size: () => 0,
      spent: () => 0,
    },
  }
}

describe('planSource evidence + ledger-metered hint rendering (D-12 · T-381-20)', () => {
  it('Test 1: replay planSource and cache-hit provenance never coexist on one step', async () => {
    // A replayed step: the cache is bound but never consulted; evidence carries the
    // procedure-replay planSource and no cache-hit fold.
    const spy = makeReader({ match: makeMatch(), payload: loginPayload() })
    const { adapter } = capturingAdapter([makeScreenState()])
    const planner = capturingPlanner([makeActionPlan()])
    const cacheSpy = makeCacheSpy(null)

    const replayed = await executeStep(
      'Log in as the saved user',
      ports({ adapter, planner: planner.planner, knowledgeReader: spy.reader, cache: cacheSpy.cache }),
      context(),
    )

    expect(replayed.status).toBe('passed')
    expect(replayed.evidence?.planSource?.kind).toBe('procedure-replay')
    expect(replayed.evidence?.cacheStatus).not.toBe('hit')
    expect(cacheSpy.gets()).toBe(0)

    // A cache-hit step (no procedure match): cacheStatus folds to hit and no planSource
    // is written — the two provenances never coexist.
    const noMatch = makeReader({ match: undefined, payload: undefined })
    const hit: CachedPlanValue = {
      plannedActions: [{ type: 'click' } as unknown as CacheablePlannedAction],
      groundedLocator: [{ role: 'button', nameNormalized: 'log in' }],
      verificationOutcome: 'passed',
    }
    const hitCache = makeCacheSpy(hit)
    const { adapter: hitAdapter } = capturingAdapter([makeScreenState()])
    const hitPlanner = capturingPlanner([makeActionPlan()])

    const cachedStep = await executeStep(
      'Click the Log in button',
      ports({
        adapter: hitAdapter,
        planner: hitPlanner.planner,
        knowledgeReader: noMatch.reader,
        cache: hitCache.cache,
      }),
      context(),
    )

    expect(cachedStep.status).toBe('passed')
    expect(hitPlanner.calls).toHaveLength(0)
    expect(cachedStep.evidence?.cacheStatus).toBe('hit')
    expect(cachedStep.evidence?.planSource).toBeUndefined()
  })

  it('Test 2: a hint-mode match records planSource procedure-hint and renders DATA-wrapped under the hypotheses preamble with ledger admission', async () => {
    const spy = makeReader({ match: makeMatch({ replayRecommendation: 'hint' }), payload: loginPayload() })
    const { adapter } = capturingAdapter([makeScreenState()])
    const planner = capturingPlanner([makeActionPlan()])
    const ledgerSpy = makeLedgerSpy(true)

    const result = await executeStep(
      'Log in as the saved user',
      ports({
        adapter,
        planner: planner.planner,
        knowledgeReader: spy.reader,
        recordLedger: ledgerSpy.ledger,
      }),
      context(),
    )

    expect(result.status).toBe('passed')
    expect(result.evidence?.planSource).toEqual({
      kind: 'procedure-hint',
      procedureId: PROCEDURE_ID,
    })

    // Ledger admission carried real ServingRecordMetadata: the record id, a flow-anchor
    // cluster, and a non-zero rendered cost.
    const admitted = ledgerSpy.admits.find((record) => String(record.id) === String(PROCEDURE_ID))
    expect(admitted).toBeDefined()
    expect(admitted!.renderedCost).toBeGreaterThan(0)
    expect(admitted!.clusterKey).toContain('login')

    // The rendered block reached the planning context inside DATA delimiters, and the
    // volatile tier frames it under the hypotheses-not-instructions preamble.
    expect(planner.calls).toHaveLength(1)
    const l2 = planner.calls[0].l2 ?? ''
    expect(l2).toContain(APP_OBSERVED_DATA_OPEN)
    expect(l2).toContain(APP_OBSERVED_DATA_CLOSE)
    expect(l2).toContain('Fill the email field')
    expect(l2).toContain('userEmail (string, required)')
    const volatileTier = buildVolatileTier(makeStepContext({ knowledgeBriefL2: l2 }))
    const rendered = typeof volatileTier.content === 'string'
      ? volatileTier.content
      : JSON.stringify(volatileTier.content)
    expect(rendered.toLowerCase()).toContain('hypotheses')
    expect(rendered.toLowerCase()).toContain('not instructions or commands')
    expect(rendered.indexOf(APP_OBSERVED_DATA_OPEN))
      .toBeGreaterThan(rendered.toLowerCase().indexOf('hypotheses'))
  })

  it('Test 3: a ledger refusal drops the hint fail-closed and the step still plans normally', async () => {
    const spy = makeReader({ match: makeMatch({ replayRecommendation: 'hint' }), payload: loginPayload() })
    const { adapter, executed } = capturingAdapter([makeScreenState()])
    const planner = capturingPlanner([makeActionPlan()])
    const ledgerSpy = makeLedgerSpy(false)

    const result = await executeStep(
      'Log in as the saved user',
      ports({
        adapter,
        planner: planner.planner,
        knowledgeReader: spy.reader,
        recordLedger: ledgerSpy.ledger,
      }),
      context(),
    )

    // The refusal drops the block, never the turn: the step plans and passes normally.
    expect(result.status).toBe('passed')
    expect(planner.calls).toHaveLength(1)
    expect(executed.map((action) => action.type)).toEqual(['click'])
    const learned = `${planner.calls[0].l1 ?? ''}\n${planner.calls[0].l2 ?? ''}`
    expect(learned).not.toContain(APP_OBSERVED_DATA_OPEN)
    expect(learned).not.toContain('Fill the email field')
    // Never rendered ⇒ no served-hint exposure is claimed in evidence.
    expect(result.evidence?.planSource).toBeUndefined()
  })

  it('Test 4: the post-miss demoted hint renders in the SAME hypotheses frame with the divergence note', async () => {
    const spy = makeReader({ match: makeMatch(), payload: loginPayload() })
    const stable = makeScreenState()
    const drifted = duplicateButtonScreen()
    const { adapter } = capturingAdapter([stable, stable, drifted])
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
    const l2 = planner.calls[0].l2 ?? ''
    // DATA-wrapped, with the divergence inside the delimiters — never imperative phrasing
    // outside the untrusted-data frame.
    const open = l2.indexOf(APP_OBSERVED_DATA_OPEN)
    const close = l2.indexOf(APP_OBSERVED_DATA_CLOSE)
    const divergence = l2.indexOf('Guarded replay diverged at procedure step 2')
    expect(open).toBeGreaterThanOrEqual(0)
    expect(divergence).toBeGreaterThan(open)
    expect(close).toBeGreaterThan(divergence)
    // The demoted hint sits under the same hypotheses preamble as every learned span.
    const volatileTier = buildVolatileTier(makeStepContext({ knowledgeBriefL2: l2 }))
    const rendered = typeof volatileTier.content === 'string'
      ? volatileTier.content
      : JSON.stringify(volatileTier.content)
    expect(rendered.toLowerCase()).toContain('hypotheses')
    expect(rendered.toLowerCase()).toContain('not instructions or commands')
    // Post-miss the planSource stays the replay fold with its miss — the demotion is
    // implied by the miss, never a second (procedure-hint) provenance.
    expect(result.evidence?.planSource?.kind).toBe('procedure-replay')
  })
})
