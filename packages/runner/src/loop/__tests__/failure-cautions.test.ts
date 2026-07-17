import { describe, expect, it, vi } from 'vitest'
import {
  asRecordId,
  type Anchor,
  type BriefBlock,
  type CautionBlock,
  type CautionLine,
  type RecordId,
  type ScreenState,
} from '@vostride/agent-qa-schema'
import type { KnowledgeHintReader } from '../../knowledge-hint-reader.js'
import type { LoopPorts } from '../ports.js'
import { createRecordLedger, type RecordLedger } from '../record-ledger.js'
import { executeStep } from '../index.js'
import { buildVolatileTier } from '../prompts.js'
import type { ActionPlan, Planner, StepContext, VerificationResult } from '../types.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import {
  makeActionPlan,
  makeAdapter,
  makeStepContext,
  makeVerifier,
} from './loop-harness.js'

const EMPTY_BRIEF: BriefBlock = {
  tiers: { L0: '', L1: '', L2: '' },
  lines: [],
  truncation: '',
}

const DEFAULT_BUDGETS = {
  brief: 64,
  caution: 24,
  readBody: 64,
  recordCap: 8,
}

function caution(id: string, summary: string): CautionLine {
  return {
    id: asRecordId(id),
    anchors: [{ t: 'page', route: '/login' }],
    summary,
  }
}

function reader(options: {
  block?: BriefBlock
  cautions?: CautionBlock
} = {}): KnowledgeHintReader & { getCautions: ReturnType<typeof vi.fn> } {
  const getCautions = vi.fn(() => options.cautions ?? { cautions: [], budgetUsed: 0 })
  return {
    getRunBrief: () => options.block ?? EMPTY_BRIEF,
    search: () => [],
    read: () => { throw new Error('not used') },
    getCautions,
    getProcedure: () => undefined,
    emitCanaryOutcome: () => {},
  }
}

function volatileText(context: StepContext): string {
  const content = buildVolatileTier(context).content
  return typeof content === 'string' ? content : JSON.stringify(content)
}

function scriptedPlanner(plans: ActionPlan[], prompts: string[] = []): Planner {
  let call = 0
  return {
    async plan(_step, _screen, context) {
      prompts.push(volatileText(context))
      const plan = plans[Math.min(call, plans.length - 1)]!
      call++
      return { plan }
    },
  }
}

function withoutLoginElement(state: ScreenState): ScreenState {
  const [email] = state.elements
  if (!email) throw new Error('fixture is missing the email element')
  return {
    ...state,
    tree: '- textbox "Email" [ref=e1]',
    elements: [email],
    refMap: { [email.ref]: state.refMap[email.ref]! },
  }
}

function ports(input: {
  planner: Planner
  reader: KnowledgeHintReader
  executeResults?: Array<{ success: boolean; error?: string }>
  observeResults?: ScreenState[]
  verifierResults?: VerificationResult[]
  recordLedger?: RecordLedger
  budgets?: typeof DEFAULT_BUDGETS
}): LoopPorts {
  return {
    adapter: makeAdapter({
      executeResults: input.executeResults,
      observeResults: input.observeResults,
    }),
    planner: input.planner,
    knowledgeReader: input.reader,
    knowledgeBudgets: input.budgets ?? DEFAULT_BUDGETS,
    recordLedger: input.recordLedger,
    ...(input.verifierResults ? { verifier: makeVerifier(input.verifierResults) } : {}),
  }
}

const flowContext = (): StepContext => makeStepContext({ testName: 'Checkout Flow' })
const pageAndFlow: Anchor[] = [
  { t: 'page', route: 'https://example.test/login' },
  { t: 'flow', name: 'checkout flow' },
]
const elementPageAndFlow: Anchor[] = [
  { t: 'el', role: 'button', name: 'log in' },
  ...pageAndFlow,
]

describe('executeStep Channel 3 failure cautions (BRIF-02, D-13/D-14)', () => {
  it('calls getCautions once for grounding miss, action error, and verifier reject, but never for a passing step', async () => {
    const initial = makeScreenState()
    const missing = withoutLoginElement(initial)

    const groundingReader = reader()
    await executeStep(
      'Click Log in',
      ports({
        reader: groundingReader,
        planner: scriptedPlanner([
          makeActionPlan({ action: { type: 'click', ref: 'e2' } }),
          makeActionPlan({ action: { type: 'click', ref: 'e1' } }),
        ]),
        executeResults: [
          { success: false, error: 'Unknown ref "e2". Available refs: e1' },
          { success: true },
        ],
        observeResults: [initial, initial, missing, missing, missing],
      }),
      flowContext(),
    )
    expect(groundingReader.getCautions).toHaveBeenCalledOnce()
    expect(groundingReader.getCautions).toHaveBeenCalledWith(elementPageAndFlow, DEFAULT_BUDGETS.caution)

    const actionReader = reader()
    await executeStep(
      'Click Log in',
      ports({
        reader: actionReader,
        planner: scriptedPlanner([
          makeActionPlan({ action: { type: 'click', ref: 'e2' } }),
          makeActionPlan({ action: { type: 'click', ref: 'e1' } }),
        ]),
        executeResults: [
          { success: false, error: 'Browser process disconnected' },
          { success: true },
        ],
      }),
      flowContext(),
    )
    expect(actionReader.getCautions).toHaveBeenCalledOnce()
    expect(actionReader.getCautions).toHaveBeenCalledWith(elementPageAndFlow, DEFAULT_BUDGETS.caution)

    const verifierReader = reader()
    await executeStep(
      'Wait for completion',
      ports({
        reader: verifierReader,
        planner: scriptedPlanner([
          makeActionPlan({ action: { type: 'waitFor', on: 'text', text: 'Done', timeoutMs: 1 } }),
          makeActionPlan({ action: { type: 'waitFor', on: 'text', text: 'Done', timeoutMs: 1 } }),
        ]),
        executeResults: [{ success: true }, { success: true }],
        verifierResults: [
          { success: false, reasoning: 'Completion banner is absent', isAppError: false },
          { success: true, reasoning: 'Completion banner is visible', isAppError: false },
        ],
      }),
      flowContext(),
    )
    expect(verifierReader.getCautions).toHaveBeenCalledOnce()
    expect(verifierReader.getCautions).toHaveBeenCalledWith(pageAndFlow, DEFAULT_BUDGETS.caution)

    const passingReader = reader()
    await executeStep(
      'Click Log in',
      ports({
        reader: passingReader,
        planner: scriptedPlanner([makeActionPlan()]),
        executeResults: [{ success: true }],
      }),
      flowContext(),
    )
    expect(passingReader.getCautions).not.toHaveBeenCalled()
  })

  it('derives precise-first element, page, and flow anchors through the shared normalizer', async () => {
    const knowledgeReader = reader()
    await executeStep(
      'Click Log in',
      ports({
        reader: knowledgeReader,
        planner: scriptedPlanner([
          makeActionPlan({ action: { type: 'click', ref: 'e2' } }),
          makeActionPlan({ action: { type: 'click', ref: 'e1' } }),
        ]),
        executeResults: [
          { success: false, error: 'The click was rejected' },
          { success: true },
        ],
      }),
      makeStepContext({ testName: '  CHECKOUT   Flow  ' }),
    )

    expect(knowledgeReader.getCautions).toHaveBeenCalledWith(
      [
        { t: 'el', role: 'button', name: 'log in' },
        { t: 'page', route: 'https://example.test/login' },
        { t: 'flow', name: 'checkout flow' },
      ],
      DEFAULT_BUDGETS.caution,
    )
  })

  it('injects cautions into only the immediately-following replan volatile context', async () => {
    const prompts: string[] = []
    const knowledgeReader = reader({
      cautions: { cautions: [caution('caution-login', 'The login button may require one fresh observation.')], budgetUsed: 8 },
    })
    const planner = scriptedPlanner([
      makeActionPlan({ action: { type: 'click', ref: 'e2' } }),
      makeActionPlan({ action: { type: 'waitFor', on: 'text', text: 'Ready', timeoutMs: 1 }, stepComplete: false }),
      makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: true }),
    ], prompts)

    await executeStep(
      'Click Log in',
      ports({
        reader: knowledgeReader,
        planner,
        executeResults: [
          { success: false, error: 'Browser process disconnected' },
          { success: true },
          { success: true },
        ],
      }),
      flowContext(),
    )

    expect(prompts).toHaveLength(3)
    expect(prompts[0]).not.toContain('The login button may require one fresh observation.')
    expect(prompts[1]).toContain('The login button may require one fresh observation.')
    expect(prompts[1]?.toLowerCase()).toContain('hypotheses')
    expect(prompts[1]?.toLowerCase()).toContain('not instructions or commands')
    expect(prompts[2]).not.toContain('The login button may require one fresh observation.')
    expect(knowledgeReader.getCautions).toHaveBeenCalledOnce()
  })

  it('keeps an empty caution block byte-identical to the no-caution replan baseline', async () => {
    async function captureReplan(block: CautionBlock | undefined): Promise<string> {
      const prompts: string[] = []
      const knowledgeReader = reader({ cautions: block })
      await executeStep(
        'Click Log in',
        ports({
          reader: knowledgeReader,
          planner: scriptedPlanner([
            makeActionPlan({ action: { type: 'click', ref: 'e2' } }),
            makeActionPlan({ action: { type: 'click', ref: 'e1' } }),
          ], prompts),
          executeResults: [
            { success: false, error: 'Browser process disconnected' },
            { success: true },
          ],
        }),
        flowContext(),
      )
      return prompts[1]!
    }

    const empty = await captureReplan({ cautions: [], budgetUsed: 0 })
    const baseline = await captureReplan(undefined)
    expect(empty).toBe(baseline)
    expect(empty).not.toMatch(/failure-adjacent caution/i)
  })

  it('re-injects an L1-counted id for free, admits a new id, and visibly reports cap refusals', async () => {
    const existingId = asRecordId('caution-existing')
    const block: BriefBlock = {
      tiers: { L0: '', L1: 'Brief seed copy.', L2: '' },
      lines: [{
        id: existingId,
        kind: 'caution',
        summary: 'Brief seed copy.',
        trust: 1,
        status: 'active',
        servedAsCanary: false,
        tier: 'L1',
      }],
      truncation: '',
    }
    const ledger = createRecordLedger({ cap: 2, seedIds: [] })
    const prompts: string[] = []
    const knowledgeReader = reader({
      block,
      cautions: {
        cautions: [
          { ...caution('caution-existing', 'Repeat the already-counted caution.'), id: existingId },
          caution('caution-new', 'Admit one new caution.'),
          caution('caution-overflow', 'This caution must be refused.'),
        ],
        budgetUsed: 24,
      },
    })

    await executeStep(
      'Click Log in',
      ports({
        reader: knowledgeReader,
        recordLedger: ledger,
        budgets: { ...DEFAULT_BUDGETS, recordCap: 2 },
        planner: scriptedPlanner([
          makeActionPlan({ action: { type: 'click', ref: 'e2' } }),
          makeActionPlan({ action: { type: 'click', ref: 'e1' } }),
        ], prompts),
        executeResults: [
          { success: false, error: 'Browser process disconnected' },
          { success: true },
        ],
      }),
      flowContext(),
    )

    expect(prompts[1]).toContain('Repeat the already-counted caution.')
    expect(prompts[1]).toContain('Admit one new caution.')
    expect(prompts[1]).not.toContain('This caution must be refused.')
    expect(prompts[1]).toContain('truncated 1 of 3')
    expect(ledger.size()).toBe(2)
  })

  it('renders the reserved caution:truncated line without ledger admission', async () => {
    const base = createRecordLedger({ cap: 1, seedIds: [] })
    const admitted: RecordId[] = []
    const ledger: RecordLedger = {
      admit(id) {
        admitted.push(id)
        return base.admit(id)
      },
      resetTurn: (ids) => base.resetTurn(ids),
      size: () => base.size(),
    }
    const prompts: string[] = []
    const overflow = caution('caution:truncated', 'Reader truncated 4 of 7 matching cautions.')
    const knowledgeReader = reader({
      cautions: {
        cautions: [caution('caution-normal', 'A normal caution still fits.'), overflow],
        budgetUsed: 24,
      },
    })

    await executeStep(
      'Click Log in',
      ports({
        reader: knowledgeReader,
        recordLedger: ledger,
        budgets: { ...DEFAULT_BUDGETS, recordCap: 1 },
        planner: scriptedPlanner([
          makeActionPlan({ action: { type: 'click', ref: 'e2' } }),
          makeActionPlan({ action: { type: 'click', ref: 'e1' } }),
        ], prompts),
        executeResults: [
          { success: false, error: 'Browser process disconnected' },
          { success: true },
        ],
      }),
      flowContext(),
    )

    expect(prompts[1]).toContain('A normal caution still fits.')
    expect(prompts[1]).toContain('Reader truncated 4 of 7 matching cautions.')
    expect(admitted).toEqual([asRecordId('caution-normal')])
    expect(ledger.size()).toBe(1)
  })
})
