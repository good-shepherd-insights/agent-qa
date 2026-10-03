// P6: the verifier's stable tier judges the step goal on the AFTER screen, not only the last action.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateText } from 'ai'
import { asRef } from '@vostride/agent-qa-schema'
import type { Action } from '../../platform.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import { buildVerificationPrompt, buildVerifierStableTier } from '../prompts.js'
import { LLMVerifier } from '../verifier.js'
import { makeFakeTokenAccounting } from './loop-harness.js'

vi.mock('ai', async importOriginal => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: vi.fn(),
}))

const PINNED_STABLE = `You are verifying whether a test step was successfully completed.

Verification approach:
Evaluate whether the step goal was accomplished. Look for NEGATIVE evidence — signs the action FAILED or the goal was NOT met:
- Application errors (HTTP errors, error toasts, crashes, "not found" messages)
- Contradicting state (wrong page, target element missing, unexpected content)
- Clear evidence the action did not execute (element still in pre-action state when it should have changed)

IMPORTANT: Absence of visible screen change is NOT evidence of failure. Many interactions produce results outside the current page (navigating to new tabs, triggering background processes, initiating file operations, updating server state). If the action targeted a valid element and no error or contradicting state is visible, the goal is likely accomplished.

For verification/assertion steps (step says "verify", "check", "confirm"): require POSITIVE evidence — the claimed condition must be visible on screen or in the ARIA tree.
For action steps (step uses the surface-correct interaction verb, such as "click" on web or "tap"/"press" on mobile, or says "fill" or "select"): if the target element existed and no error appeared, return success unless there is clear evidence of failure.
For every step, the verdict is about the step goal on the AFTER screen, not about the last action alone: when the AFTER screen shows that an outcome the step goal requires has not happened (text typed but not sent when the step asks to send, reply or post; a form filled but not submitted when the step asks to submit; the wrong app or screen in front), return success false even if the last action succeeded and its target existed. That is clear evidence of failure, unlike the mere absence of a visible change. An outcome the step does not ask for, such as sending text the step only asks to type, is not required.

Analyze the attached screenshot for visual cues the ARIA tree cannot capture: colors, layout, images, visual indicators, error states. When the screenshot and ARIA tree conflict, visual evidence takes precedence. For quantity claims, only confirm what you can count in the screenshot.

Return a JSON object with:
- success (boolean): whether the step goal was accomplished
- reasoning (string): explanation of your judgment
- isAppError (boolean): whether the page shows an application error`

const IMPORTANT_LINE =
  'IMPORTANT: Absence of visible screen change is NOT evidence of failure. Many interactions produce results outside the current page (navigating to new tabs, triggering background processes, initiating file operations, updating server state). If the action targeted a valid element and no error or contradicting state is visible, the goal is likely accomplished.'
const ASSERTION_LINE =
  'For verification/assertion steps (step says "verify", "check", "confirm"): require POSITIVE evidence — the claimed condition must be visible on screen or in the ARIA tree.'
const ACTION_LINE =
  'For action steps (step uses the surface-correct interaction verb, such as "click" on web or "tap"/"press" on mobile, or says "fill" or "select"): if the target element existed and no error appeared, return success unless there is clear evidence of failure.'

const HEADER =
  "Test author's instructions (from the test definition; they also govern this verification):"
const CONTEXT = 'Only the final screen is graded.'

const before = makeScreenState()
const after = makeScreenState({ url: 'https://example.test/after' })
const action: Action = { type: 'click', ref: asRef('e2') }

describe('buildVerifierStableTier — step-goal rule (P6)', () => {
  it('produces the pinned bytes', () => {
    expect(buildVerifierStableTier()).toBe(PINNED_STABLE)
  })

  it.each([
    'the verdict is about the step goal on the AFTER screen',
    'text typed but not sent',
    'a form filled but not submitted',
    'the wrong app or screen in front',
    'return success false even if the last action succeeded',
  ])('contains %s', fragment => {
    expect(buildVerifierStableTier()).toContain(fragment)
  })

  it('keeps the absence-of-change rule and both step-type lines verbatim', () => {
    const tier = buildVerifierStableTier()
    expect(tier).toContain(IMPORTANT_LINE)
    expect(tier).toContain(ASSERTION_LINE)
    expect(tier).toContain(ACTION_LINE)
  })

  it('stays argument-less and stable', () => {
    expect(buildVerifierStableTier.length).toBe(0)
    expect(buildVerifierStableTier()).toBe(buildVerifierStableTier())
  })

  it('leaves the per-call turn without the rule and the tier without the author header', () => {
    const plain = buildVerificationPrompt('Reply to the post', before, after, action, true, '', undefined)
    const withContext = buildVerificationPrompt('Reply to the post', before, after, action, true, '', undefined, {
      testContext: CONTEXT,
    })
    expect(plain).not.toContain('the verdict is about the step goal')
    expect(withContext).not.toContain('the verdict is about the step goal')
    expect(buildVerifierStableTier()).not.toContain("Test author's instructions")
  })
})

describe('LLMVerifier — step-goal rule in the system tier (P6)', () => {
  beforeEach(() => {
    vi.mocked(generateText).mockReset()
    vi.mocked(generateText).mockResolvedValue({
      output: { success: true, reasoning: 'ok', isAppError: false },
      usage: { inputTokens: 1, outputTokens: 1 },
    } as any)
  })

  function sent(): { text: string; system: any[] } {
    const call = vi.mocked(generateText).mock.calls[0][0] as any
    const turn = call.messages[call.messages.length - 1]
    return { text: turn.content[0].text, system: call.system }
  }

  it('sends the pinned tier as the system content, with the author context in the turn', async () => {
    const verifier = new LLMVerifier({} as any, makeFakeTokenAccounting())
    await verifier.verify('Reply to the post', before, after, action, undefined, undefined, undefined, undefined, {
      testContext: CONTEXT,
    })
    const { text, system } = sent()
    expect(system[0].content).toBe(PINNED_STABLE)
    expect(text).toContain(HEADER)
    expect(text).toContain(CONTEXT)
  })

  it('sends the same system content and the unchanged turn without author context', async () => {
    const verifier = new LLMVerifier({} as any, makeFakeTokenAccounting())
    await verifier.verify('Reply to the post', before, after, action)
    const { text, system } = sent()
    expect(system[0].content).toBe(PINNED_STABLE)
    expect(text).toBe(buildVerificationPrompt('Reply to the post', before, after, action, false))
  })
})
