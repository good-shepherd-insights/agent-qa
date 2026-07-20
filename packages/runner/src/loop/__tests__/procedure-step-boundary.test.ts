// F-381-51-1 collision proof (381-52 · D-09): whole-flow guarded replay must NOT consume a
// committed procedure's entire multi-step body inside the single test step whose consult
// matched. The harness mirrors the committed ladder page's navigate-on-submit shape
// (T-381-126 fidelity mitigation): a form screen with a username textbox + submit button,
// and a form-less received screen on a DIFFERENT route behind the stored click. A
// non-navigating fixture would prove the wrong mechanism — the round-11 synthetic-fixture
// failure mode.
//
// RED rows R1-R3 assert the D-09 per-step contract — a test step dispatches exactly ONE
// stored action, records a per-step-complete guard fold, and never navigates past its own
// boundary — and each FAILS on the shipped build, which dispatches BOTH stored actions
// inside test step 0 (loop/index.ts §2b to exhaustion, isFinal at body end) and navigates.
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
import type { Action, ActionResult, PlatformAdapter } from '../../platform.js'
import { executeStep } from '../index.js'
import type { LoopPorts } from '../ports.js'
import type { ActionPlan, Planner, StepContext } from '../types.js'
import { makeActionPlan, makeStepContext } from './loop-harness.js'

const FORM_ROUTE = 'http://127.0.0.1:8931/form.html'
const RECEIVED_ROUTE = 'http://127.0.0.1:8931/received.html'
const PROBE_EMAIL = 'qa.user+381@example.com'

const flowAnchor: Anchor = { t: 'flow', name: 'local-form' }
const PROCEDURE_ID = asRecordId('procedure-flow-local-form')

const emptyBrief: BriefBlock = {
  tiers: { L0: '', L1: '', L2: '' },
  lines: [],
  truncation: '',
  admissions: [],
}

/** The committed ladder-shaped form screen: a labelled Username textbox + a Submit button. */
function formScreen(): ScreenState {
  const usernameRef = asRef('e1')
  const submitRef = asRef('e2')
  const usernameBounds = { x: 20, y: 120, width: 350, height: 44 }
  const submitBounds = { x: 20, y: 200, width: 350, height: 44 }
  return {
    platform: 'web',
    tree: [
      '[Viewport: 390x844] [2 elements]',
      '- textbox "Username" [ref=e1] @(20,120 350x44)',
      '- button "Submit" [ref=e2] @(20,200 350x44)',
    ].join('\n'),
    elements: [
      {
        ref: usernameRef,
        role: 'textbox',
        name: 'Username',
        nameNormalized: 'username',
        bounds: usernameBounds,
        center: { x: 195, y: 142 },
        state: { enabled: true, focused: false, visible: true },
        labels: { placeholder: 'Username' },
        attributes: {},
      },
      {
        ref: submitRef,
        role: 'button',
        name: 'Submit',
        nameNormalized: 'submit',
        bounds: submitBounds,
        center: { x: 195, y: 222 },
        state: { enabled: true, focused: false, visible: true },
        labels: { ariaLabel: 'Submit' },
        attributes: {},
      },
    ],
    refMap: {
      [usernameRef]: { bounds: usernameBounds, center: { x: 195, y: 142 } },
      [submitRef]: { bounds: submitBounds, center: { x: 195, y: 222 } },
    },
    url: FORM_ROUTE,
    timestamp: 1700000000000,
    metadata: {
      captureMode: 'textOnly',
      coordSpace: 'viewport',
      viewportWidth: 390,
      viewportHeight: 844,
      scroll: { offsetX: 0, offsetY: 0, contentWidth: 390, contentHeight: 844 },
    },
  }
}

/**
 * The form-less received page on a DIFFERENT route — only the confirmation heading and a
 * back link, mirroring the committed serve-local-form.mjs RECEIVED_HTML. Neither the
 * username textbox nor the submit button exists here.
 */
function receivedScreen(): ScreenState {
  const headingRef = asRef('e1')
  const backRef = asRef('e2')
  const headingBounds = { x: 20, y: 80, width: 350, height: 40 }
  const backBounds = { x: 20, y: 160, width: 200, height: 24 }
  return {
    platform: 'web',
    tree: [
      '[Viewport: 390x844] [2 elements]',
      '- heading "Received!" [ref=e1] @(20,80 350x40)',
      '- link "Back to the form" [ref=e2] @(20,160 200x24)',
    ].join('\n'),
    elements: [
      {
        ref: headingRef,
        role: 'heading',
        name: 'Received!',
        nameNormalized: 'received!',
        bounds: headingBounds,
        center: { x: 195, y: 100 },
        state: { enabled: true, focused: false, visible: true },
        labels: {},
        attributes: {},
      },
      {
        ref: backRef,
        role: 'link',
        name: 'Back to the form',
        nameNormalized: 'back to the form',
        bounds: backBounds,
        center: { x: 120, y: 172 },
        state: { enabled: true, focused: false, visible: true },
        labels: {},
        attributes: {},
      },
    ],
    refMap: {
      [headingRef]: { bounds: headingBounds, center: { x: 195, y: 100 } },
      [backRef]: { bounds: backBounds, center: { x: 120, y: 172 } },
    },
    url: RECEIVED_ROUTE,
    timestamp: 1700000000000,
    metadata: {
      captureMode: 'textOnly',
      coordSpace: 'viewport',
      viewportWidth: 390,
      viewportHeight: 844,
      scroll: { offsetX: 0, offsetY: 0, contentWidth: 390, contentHeight: 844 },
    },
  }
}

interface NavigatingHarness {
  adapter: PlatformAdapter
  executed: Action[]
  /** The screen a fresh observation would return RIGHT NOW. */
  currentScreen: () => ScreenState
}

/**
 * The navigate-on-submit adapter: observations serve the form screen until a click-shaped
 * action has EXECUTED, after which every observation serves the form-less received screen —
 * exactly the committed ladder page's behavior. `navigateOn`/`failClicks` let rows script
 * early navigation (drift) and execution failures without changing the shape.
 */
function navigatingAdapter(options?: {
  navigateOn?: 'click' | 'fill'
  /** The first N click executions fail (no navigation) before clicks succeed again. */
  failClicks?: number
}): NavigatingHarness {
  const executed: Action[] = []
  const navigateOn = options?.navigateOn ?? 'click'
  let remainingClickFailures = options?.failClicks ?? 0
  let navigated = false
  const currentScreen = (): ScreenState => (navigated ? receivedScreen() : formScreen())
  const adapter: PlatformAdapter = {
    platform: 'web',
    async setup() {},
    async cleanup() {},
    async observe() {
      return currentScreen()
    },
    async execute(action): Promise<ActionResult> {
      executed.push(action)
      if (action.type === 'click' && remainingClickFailures > 0) {
        remainingClickFailures--
        return { success: false, error: 'simulated click execution failure' }
      }
      if (action.type === navigateOn) navigated = true
      return { success: true }
    },
  }
  return { adapter, executed, currentScreen }
}

/** The committed 2-step flow body: fill the username, then click submit (form-anchored). */
function flowPayload(): ProcedureBodyPayload {
  return {
    schemaVersion: 1,
    parameters: [{ name: 'PROBE_USER', type: 'string', required: true }],
    steps: [
      {
        instruction: 'Type the probe email into the Username field',
        action: {
          type: 'fill',
          targets: { ref: { role: 'textbox', nameNormalized: 'username' } },
          values: { text: { param: 'PROBE_USER' } },
        },
        guard: {
          target: { role: 'textbox', nameNormalized: 'username' },
          pageAnchor: { t: 'page', route: FORM_ROUTE },
        },
      },
      {
        instruction: 'Click the Submit button',
        action: {
          type: 'click',
          targets: { ref: { role: 'button', nameNormalized: 'submit' } },
          values: {},
        },
        guard: {
          target: { role: 'button', nameNormalized: 'submit' },
          pageAnchor: { t: 'page', route: FORM_ROUTE },
        },
      },
    ],
    successAssertion: 'The form was submitted',
  }
}

function makeFlowMatch(): ProcedureMatch {
  return {
    id: PROCEDURE_ID,
    flowAnchor,
    confidence: 0.9,
    authoringModelTier: 'full',
    parameterSchema: [{ name: 'PROBE_USER', type: 'string', required: true }],
    replayRecommendation: 'replay',
  }
}

interface FlowReader {
  reader: KnowledgeHintReader
  consultCount: () => number
}

/**
 * A form-anchored reader: the consult matches ONLY on the form route. Post-navigation the
 * flow anchor no longer matches the received page, so the consult returns undefined —
 * the healthy fail-closed behavior the live run exhibited (planSource null at step 1).
 */
function makeFlowReader(): FlowReader {
  let consults = 0
  const reader: KnowledgeHintReader = {
    getRunBrief() {
      return emptyBrief
    },
    search() {
      return []
    },
    read(id) {
      return {
        id,
        title: 'Local form procedure',
        body: serializeProcedureBody(flowPayload()),
        anchors: [flowAnchor],
        evidenceDigest: 'digest',
        relations: [],
      }
    },
    getCautions() {
      return { cautions: [], budgetUsed: 0, admissions: [] }
    },
    getProcedure(_intent, screenState) {
      consults++
      return screenState.url === FORM_ROUTE ? makeFlowMatch() : undefined
    },
    emitCanaryOutcome() {},
  }
  return { reader, consultCount: () => consults }
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

function context(overrides: Partial<StepContext> = {}): StepContext {
  return makeStepContext({
    testName: 'local-form ladder',
    variables: { PROBE_USER: PROBE_EMAIL },
    ...overrides,
  })
}

function ports(overrides: Partial<LoopPorts> & Pick<LoopPorts, 'adapter' | 'planner'>): LoopPorts {
  return { ...overrides }
}

const STEP_0_TEXT = `Type "${PROBE_EMAIL}" into the Username field`

describe('procedure step boundary (F-381-51-1 · D-09)', () => {
  it('harness fidelity: the stored click navigates to a form-less received page on a different route', async () => {
    // T-381-126 mitigation: assert the navigate-on-submit shape IN-SUITE before any
    // contract row leans on it. A fixture whose form persists after submit would prove the
    // wrong mechanism (the stale self-posting probe page of the 381-45 UAT session).
    const { adapter } = navigatingAdapter()
    const before = await adapter.observe()
    expect(before.url).toBe(FORM_ROUTE)
    expect(before.elements.some(
      (el) => el.role === 'textbox' && el.nameNormalized === 'username',
    )).toBe(true)
    expect(before.elements.some(
      (el) => el.role === 'button' && el.nameNormalized === 'submit',
    )).toBe(true)

    await adapter.execute({ type: 'click', ref: 'e2' } as unknown as Action)

    const after = await adapter.observe()
    expect(after.url).toBe(RECEIVED_ROUTE)
    expect(after.url).not.toBe(before.url)
    expect(after.elements.some((el) => el.role === 'textbox')).toBe(false)
    expect(after.elements.some(
      (el) => el.role === 'button' && el.nameNormalized === 'submit',
    )).toBe(false)
  })

  it('R1: test step 0 dispatches exactly ONE stored action — the fill', async () => {
    const { adapter, executed } = navigatingAdapter()
    const { reader } = makeFlowReader()
    const planner = capturingPlanner([makeActionPlan()])

    const result = await executeStep(
      STEP_0_TEXT,
      ports({ adapter, planner: planner.planner, knowledgeReader: reader }),
      context(),
    )

    expect(result.status).toBe('passed')
    // D-09: a replay-recommendation match drives THAT STEP's actions — the step consumes
    // exactly the one body step at the cursor. The shipped build dispatches BOTH stored
    // actions (fill + click) inside step 0.
    expect(executed).toHaveLength(1)
    expect(executed[0]).toMatchObject({ type: 'fill' })
    expect(result.evidence?.subActions).toHaveLength(1)
  })

  it('R2: step 0 records a per-step-complete guard fold, not the whole-body fold', async () => {
    const { adapter } = navigatingAdapter()
    const { reader } = makeFlowReader()
    const planner = capturingPlanner([makeActionPlan()])

    const result = await executeStep(
      STEP_0_TEXT,
      ports({ adapter, planner: planner.planner, knowledgeReader: reader }),
      context(),
    )

    expect(result.status).toBe('passed')
    const planSource = result.evidence?.planSource
    expect(planSource?.kind).toBe('procedure-replay')
    if (planSource?.kind !== 'procedure-replay') {
      throw new Error('expected a procedure-replay planSource')
    }
    // The fold is PER-STEP (D-12 under the D-09 boundary): total = stored actions
    // attempted within THIS test step. The shipped build records the whole-body 2/2.
    expect(planSource.guard.checksPassed).toBe(1)
    expect(planSource.guard.total).toBe(1)
    expect(planSource.guard.miss).toBeUndefined()
  })

  it('R3: the stored click is NOT dispatched during test step 0 — the harness stays on the form screen', async () => {
    const { adapter, executed, currentScreen } = navigatingAdapter()
    const { reader } = makeFlowReader()
    const planner = capturingPlanner([makeActionPlan()])

    const result = await executeStep(
      STEP_0_TEXT,
      ports({ adapter, planner: planner.planner, knowledgeReader: reader }),
      context(),
    )

    expect(result.status).toBe('passed')
    // Replay is naturally bounded by the step (D-09): body step 1's click belongs to test
    // step 1. On the shipped build the click fires inside step 0 and the screen is the
    // form-less received page — which makes the scripted step 1 imperative unsatisfiable.
    expect(executed.filter((action) => action.type === 'click')).toHaveLength(0)
    expect(currentScreen().url).toBe(FORM_ROUTE)
  })
})
