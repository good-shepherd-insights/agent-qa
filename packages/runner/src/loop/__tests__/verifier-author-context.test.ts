// P2: the step verifier sees the test author's suite/test context, in the per-call turn, with
// the exact text the planner's context tier carries. Without context the prompt bytes are
// unchanged (pinned literal captured from prompts.ts at agent-qa 14d504bca).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateText } from 'ai'
import { asRef } from '@vostride/agent-qa-schema'
import type { Action } from '../../platform.js'
import type { Verifier } from '../types.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import {
  buildContextTier,
  buildVerificationPrompt,
  buildVerifierStableTier,
  formatAuthorContext,
} from '../prompts.js'
import { LLMVerifier } from '../verifier.js'
import { executeStep } from '../index.js'
import {
  makeActionPlan,
  makeAdapter,
  makeFakeTokenAccounting,
  makePlanner,
  makeStepContext,
} from './loop-harness.js'

vi.mock('ai', async importOriginal => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: vi.fn(),
}))

const HEADER =
  "Test author's instructions (from the test definition; they also govern this verification):"

const PINNED = `Step goal: "Reply to the post"
Action taken: click on ref="e2" (button "Log in")

Screen BEFORE action:
Current page: https://example.test/login
[viewport: 2 elements visible, 0 scrolled above, 0 below viewport]

[Viewport: 390x844] [2 elements]
- textbox "Email" [ref=e1] @(20,120 350x44)
- button "Log in" [ref=e2] @(20,200 350x44)

Screen AFTER action:
Current page: https://example.test/after
[viewport: 2 elements visible, 0 scrolled above, 0 below viewport]

[Viewport: 390x844] [2 elements]
- textbox "Email" [ref=e1] @(20,120 350x44)
- button "Log in" [ref=e2] @(20,200 350x44)

A screenshot of the AFTER state is attached for visual verification.`

const before = makeScreenState()
const after = makeScreenState({ url: 'https://example.test/after' })
const action: Action = { type: 'click', ref: asRef('e2') }

describe('buildVerificationPrompt — author context (P2)', () => {
  it('produces the pinned bytes with no context', () => {
    expect(buildVerificationPrompt('Reply to the post', before, after, action, true, '', undefined)).toBe(PINNED)
  })

  it.each([
    ['an undefined eighth argument', undefined],
    ['an empty object', {}],
    ['empty strings', { suiteContext: '', testContext: '' }],
  ])('produces the pinned bytes with %s', (_label, authorContext) => {
    expect(buildVerificationPrompt('Reply to the post', before, after, action, true, '', undefined, authorContext)).toBe(PINNED)
  })

  it.each([
    ['test only', undefined, 'Only the final screen is graded.'],
    ['suite only', 'Bluesky social app, signed in.', undefined],
    ['both', 'Bluesky social app, signed in.', 'Only the final screen is graded.'],
  ])('prefixes the labelled author section for %s', (_label, suiteContext, testContext) => {
    const out = buildVerificationPrompt('Reply to the post', before, after, action, true, '', undefined, {
      ...(suiteContext ? { suiteContext } : {}),
      ...(testContext ? { testContext } : {}),
    })
    expect(out).toBe(`${HEADER}\n${formatAuthorContext(suiteContext, testContext)}\n\n${PINNED}`)
  })

  it('carries the same text the planner context tier gets', () => {
    const suiteContext = 'Bluesky social app, signed in.'
    const testContext = 'Only the final screen is graded.'
    const formatted = formatAuthorContext(suiteContext, testContext)
    expect(formatted).toBe(`Suite context: ${suiteContext}\nTest context: ${testContext}`)
    expect(buildContextTier(makeStepContext({ suiteContext, testContext })).content).toBe(formatted)
    const out = buildVerificationPrompt('Reply to the post', before, after, action, true, '', undefined, {
      suiteContext,
      testContext,
    })
    expect(out).toContain(formatted!)
  })
})

describe('LLMVerifier — author context (P2)', () => {
  beforeEach(() => {
    vi.mocked(generateText).mockReset()
    vi.mocked(generateText).mockResolvedValue({
      output: { success: true, reasoning: 'ok', isAppError: false },
      usage: { inputTokens: 1, outputTokens: 1 },
    } as any)
  })

  function sentTurn(): { text: string; system: unknown } {
    const call = vi.mocked(generateText).mock.calls[0][0] as any
    const turn = call.messages[call.messages.length - 1]
    return { text: turn.content[0].text, system: call.system }
  }

  it('sends the author section in the turn and leaves the system tier unchanged', async () => {
    const sentence =
      'Only the final screen is graded, so finish on a screen that shows the requested end state itself.'
    const verifier = new LLMVerifier({} as any, makeFakeTokenAccounting())
    await verifier.verify('Reply to the post', before, after, action, undefined, undefined, undefined, undefined, {
      testContext: sentence,
    })
    const { text, system } = sentTurn()
    expect(text).toContain(HEADER)
    expect(text).toContain(sentence)
    expect((system as any[])[0].content).toBe(buildVerifierStableTier())
  })

  it('sends the unchanged no-context prompt without author context', async () => {
    const verifier = new LLMVerifier({} as any, makeFakeTokenAccounting())
    await verifier.verify('Reply to the post', before, after, action)
    expect(sentTurn().text).toBe(buildVerificationPrompt('Reply to the post', before, after, action, false))
    expect(sentTurn().text).not.toContain(HEADER)
  })
})

describe('executeStep — verifier author context wiring (P2)', () => {
  async function ninthArgFor(context: { testContext?: string; suiteContext?: string }): Promise<unknown[]> {
    const verify = vi.fn().mockResolvedValue({
      verification: { success: true, reasoning: 'done', isAppError: false },
    })
    const verifier: Verifier = { verify }
    const result = await executeStep(
      'Click the Log in button',
      { adapter: makeAdapter(), planner: makePlanner([makeActionPlan()]), verifier },
      makeStepContext(context),
    )
    expect(result.status).toBe('passed')
    expect(verify).toHaveBeenCalledTimes(1)
    return verify.mock.calls[0]
  }

  it('passes suite and test context as the ninth argument', async () => {
    const args = await ninthArgFor({ testContext: 'T', suiteContext: 'S' })
    expect(args).toHaveLength(9)
    expect(args[8]).toEqual({ suiteContext: 'S', testContext: 'T' })
  })

  it('passes undefined when neither is set', async () => {
    const args = await ninthArgFor({})
    expect(args[8]).toBeUndefined()
  })

  it('passes only the keys that are set', async () => {
    const args = await ninthArgFor({ testContext: 'T' })
    expect(args[8]).toEqual({ testContext: 'T' })
  })
})
