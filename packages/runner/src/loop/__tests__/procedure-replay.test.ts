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
