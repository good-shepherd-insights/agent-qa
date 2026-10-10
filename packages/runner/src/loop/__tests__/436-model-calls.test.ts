// D-29/HARN-03: planner and verifier model calls per executed action on a fixed LLM-driven
// fixture, pinned at agent-qa 5e3e932a2d586f89c805a385483da1800b941fff. Change a pin only with a
// dated 436-RECORD.md note.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { asRef } from '@vostride/agent-qa-schema'
import type { ElementInfo, ScreenState } from '@vostride/agent-qa-schema'
import type { Action, ActionResult, PlatformAdapter } from '../../platform.js'
import { executeStep } from '../index.js'
import { LLMPlanner } from '../planner.js'
import { LLMVerifier } from '../verifier.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import { makeFakeTokenAccounting, makeStepContext } from './loop-harness.js'

vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>()
  return { ...actual, generateText: vi.fn() }
})

const PINNED_EXECUTED_ACTIONS = 3
const PINNED_PLANNING_CALLS = 3
const PINNED_VERIFICATION_CALLS = 1

const STEP = 'Sign in with the demo email'
const USAGE = { inputTokens: 10, outputTokens: 2 }

function el(ref: string, role: string, name: string, y: number, value?: string): ElementInfo {
  const bounds = { x: 20, y, width: 350, height: 44 }
  return {
    ref: asRef(ref),
    role,
    name,
    nameNormalized: name.toLowerCase(),
    ...(value !== undefined ? { value } : {}),
    bounds,
    center: { x: 195, y: y + 22 },
    state: { enabled: true, focused: false, visible: true },
    labels: {},
    attributes: {},
  }
}

function screen(url: string, elements: ElementInfo[]): ScreenState {
  const refMap: ScreenState['refMap'] = {}
  for (const element of elements) {
    refMap[element.ref] = { bounds: element.bounds!, center: element.center! }
  }
  return makeScreenState({
    url,
    tree: elements
      .map(element => `- ${element.role} "${element.name}" [ref=${element.ref}]`)
      .join('\n'),
    elements,
    refMap,
  })
}

const SCREENS: ScreenState[] = [
  screen('https://shop.test/', [
    el('e1', 'link', 'Sign in', 120),
    el('e2', 'button', 'Browse', 200),
  ]),
  screen('https://shop.test/login', [
    el('e1', 'textbox', 'Email', 120),
    el('e2', 'button', 'Continue', 200),
  ]),
  screen('https://shop.test/login', [
    el('e1', 'textbox', 'Email', 120, 'shopper@example.test'),
    el('e2', 'button', 'Continue', 200),
    el('e3', 'text', 'Email accepted', 260),
  ]),
  screen('https://shop.test/account', [el('e1', 'heading', 'Welcome back', 80)]),
]

function envelope(reasoning: string, stepComplete: boolean) {
  return { reasoning, confidence: 0.9, stepComplete, doesActionAdvanceUsTowardsGoal: true }
}

const PLANNING_RESPONSES = [
  { toolName: 'web_click', input: { ref: 'e1', ...envelope('Open sign in', false) } },
  {
    toolName: 'web_fill',
    input: { ref: 'e1', text: 'shopper@example.test', ...envelope('Enter the demo email', false) },
  },
  { toolName: 'web_click', input: { ref: 'e2', ...envelope('Continue to the account', true) } },
].map((call, index) => ({
  toolCalls: [{ type: 'tool-call', toolCallId: `tc-${index}`, ...call }],
  usage: USAGE,
}))

describe('C436-MODEL-CALLS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('model calls per action do not exceed the 5e3e932a2 pins', async () => {
    const { generateText } = await import('ai')
    const planning = [...PLANNING_RESPONSES]
    let planningCalls = 0
    let verificationCalls = 0
    vi.mocked(generateText).mockImplementation(async (args: { tools?: unknown }) => {
      if (args.tools !== undefined) {
        planningCalls++
        const next = planning.shift()
        if (!next) throw new Error('scripted planning responses exhausted')
        return next as never
      }
      verificationCalls++
      return {
        output: {
          conditions: [{
            quote: STEP,
            verdict: 'met',
            needs: 'none',
            controlRef: '',
            file: { name: '', match: 'none', text: '' },
            citations: [{ source: 'final-screen', quote: 'heading "Welcome back"' }],
            reasoning: 'The account page is shown',
          }],
          dialogs: [],
          isAppError: false,
          reasoning: 'The account page is shown',
        },
        usage: USAGE,
      } as never
    })

    let index = 0
    const executed: Action[] = []
    const adapter: PlatformAdapter = {
      platform: 'web',
      async setup() {},
      async cleanup() {},
      async observe() {
        return SCREENS[Math.min(index, SCREENS.length - 1)]
      },
      async execute(action: Action): Promise<ActionResult> {
        executed.push(action)
        index++
        return { success: true }
      },
    }

    const result = await executeStep(
      STEP,
      {
        adapter,
        planner: new LLMPlanner(
          {} as never,
          'web',
          undefined,
          undefined,
          makeFakeTokenAccounting(),
        ),
        verifier: new LLMVerifier({} as never, makeFakeTokenAccounting()),
      },
      makeStepContext({ stepInstruction: STEP }),
    )

    expect(result.status).toBe('passed')
    expect(executed.map(action => action.type)).toEqual(['click', 'fill', 'click'])
    expect(executed.length).toBe(PINNED_EXECUTED_ACTIONS)
    expect(planningCalls + verificationCalls).toBe(vi.mocked(generateText).mock.calls.length)
    expect(planningCalls / executed.length)
      .toBeLessThanOrEqual(PINNED_PLANNING_CALLS / PINNED_EXECUTED_ACTIONS)
    expect(verificationCalls / executed.length)
      .toBeLessThanOrEqual(PINNED_VERIFICATION_CALLS / PINNED_EXECUTED_ACTIONS)
  })
})
